import 'server-only';
import type { Tx } from '@/server/db/prisma';
import { audit } from '@/server/services/audit';
import { formatNumber, nextSequence } from '@/server/services/numbering';
import { businessRule, conflict } from '@/server/http/errors';
import { ROLES } from '@/lib/constants';
import { fileHoldingRegistrationOf } from '@/server/services/professional-registrations';
import {
  NEXT_STEP,
  OPEN_PROFESSIONAL_CHANGE_STATUSES,
  PROFESSIONAL_CHANGE_DOCUMENT_LABEL,
  PROFESSIONAL_CHANGE_STEP_CAPABILITY,
  hasRelease,
  licenceValidOn,
  missingAtRequest,
  type ProfessionalChangeDocument,
  type ProfessionalChangeStatus,
  type ProfessionalSnapshot,
} from '@/lib/professional-change';

/**
 * THE WRITES BEHIND THE CHANGE OF PROFESSIONAL TRANSITIONS.
 *
 * Called only from the workflow effect PROFESSIONAL_CHANGE, inside the
 * transition's transaction — the arrangement show cause and revocation use.
 * So every request, and every change of who holds a file, is provably
 * attached to a recorded workflow step by a named officer: there is no other
 * code path that creates a request or moves `applications.ltpUserId` after
 * filing.
 *
 * Nothing here deletes anything. The outgoing professional's engagement is
 * CLOSED, the filing declaration is left as signed, and the request keeps both
 * professionals' particulars as they stood on the day it was made.
 */

type Actor = { id: string; name: string; roleKeys?: string[] };
type Meta = { ip: string; userAgent: string; correlationId?: string };

export type ProfessionalChangeCtx = {
  tx: Tx;
  actor: Actor;
  roleKey: string;
  now: Date;
  meta: Meta;
  application: { id: string; applicationNumber: string; status: string; ltpUserId: string };
  stageCode: string;
  sequence: number;
  remarks: string;
};

const inCapacity = (actor: Actor, roleKey: string) => ({ id: actor.id, name: actor.name, roleKeys: [roleKey] });

const docs = (v: unknown): ProfessionalChangeDocument[] => (Array.isArray(v) ? (v as ProfessionalChangeDocument[]) : []);

/**
 * The desk a step belongs to: the departmental roles holding its capability,
 * as the DATABASE grants them. The System Administrator is never a desk.
 */
export async function deskFor(tx: Tx, status: ProfessionalChangeStatus): Promise<string> {
  const step = NEXT_STEP[status];
  if (!step) return '';
  const roles = await tx.role.findMany({
    where: {
      key: { not: ROLES.SYSTEM_ADMIN },
      permissions: { some: { permission: { key: PROFESSIONAL_CHANGE_STEP_CAPABILITY[step] } } },
    },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return roles.map((r) => r.key).join(',');
}

/** A licensed technical professional's particulars, frozen. */
export async function snapshotOf(tx: Tx, userId: string): Promise<ProfessionalSnapshot & { status: string; isLtp: boolean }> {
  const u = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      deletedAt: true,
      ltpLicenceNo: true,
      ltpLicenceClass: true,
      ltpValidUpto: true,
      firmName: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!u) throw businessRule('That professional could not be found.');
  const registration = await fileHoldingRegistrationOf(tx, u.id);
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
    licenceNo: u.ltpLicenceNo ?? '',
    licenceClass: u.ltpLicenceClass ?? '',
    validUpto: u.ltpValidUpto ? u.ltpValidUpto.toISOString() : null,
    firmName: u.firmName ?? '',
    registrationNumber: registration?.registrationNumber ?? '',
    status: u.deletedAt ? 'DELETED' : u.status,
    isLtp: u.roles.some((r) => r.role.key === ROLES.LTP),
  };
}

/** Refuses a proposed professional who could not lawfully hold the file. */
function assertEligible(p: Awaited<ReturnType<typeof snapshotOf>>, currentId: string, on: Date) {
  if (p.userId === currentId) throw businessRule('The proposed professional already holds this file.');
  if (!p.isLtp || !p.licenceNo) throw businessRule(`${p.name} is not a registered technical professional.`);
  if (p.status !== 'ACTIVE') throw businessRule(`${p.name}'s account is not active.`);
  if (!licenceValidOn(p.validUpto, on)) throw businessRule(`${p.name}'s licence (${p.licenceNo}) is not in force.`);
  // Phase 12: a file passes only to a professional the register has approved and holds in force.
  if (!p.registrationNumber) throw businessRule(`${p.name} holds no approved professional registration in force.`);
}

const strip = ({ status: _s, isLtp: _l, ...snap }: Awaited<ReturnType<typeof snapshotOf>>): ProfessionalSnapshot => snap;

async function event(
  c: ProfessionalChangeCtx,
  requestId: string,
  action: string,
  fromStatus: string,
  toStatus: string,
  remarks: string
) {
  await c.tx.professionalChangeEvent.create({
    data: {
      requestId,
      action,
      fromStatus,
      toStatus,
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks,
      occurredAt: c.now,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Request
// ═══════════════════════════════════════════════════════════════════════════

export type RequestPayload = {
  proposedProfessionalId?: string;
  requestDate?: string;
  reason?: string;
  documents?: ProfessionalChangeDocument[];
};

export async function requestProfessionalChange(c: ProfessionalChangeCtx, payload: RequestPayload | undefined) {
  const reason = payload?.reason?.trim() ?? '';
  const documents = payload?.documents ?? [];
  if (!payload?.proposedProfessionalId || !payload.requestDate || reason.length < 10) {
    throw businessRule('Register the change from the Technical Professional tab — it needs the proposed professional, the request date and the reason.');
  }
  const requestDate = new Date(payload.requestDate);
  if (Number.isNaN(requestDate.getTime()) || requestDate.getTime() > c.now.getTime() + 86_400_000) {
    throw businessRule('The request date cannot be in the future.');
  }
  const missing = missingAtRequest(documents.map((d) => d.kind));
  if (missing.length) {
    throw businessRule(`Attach the ${missing.map((k) => PROFESSIONAL_CHANGE_DOCUMENT_LABEL[k].toLowerCase()).join(' and the ')}.`);
  }

  const open = await c.tx.professionalChangeRequest.findFirst({
    where: { applicationId: c.application.id, status: { in: [...OPEN_PROFESSIONAL_CHANGE_STATUSES] } },
    select: { requestNumber: true },
  });
  if (open) throw conflict(`${open.requestNumber} is still open on this file. Decide it before registering another.`);

  const current = await snapshotOf(c.tx, c.application.ltpUserId);
  const proposed = await snapshotOf(c.tx, payload.proposedProfessionalId);
  assertEligible(proposed, current.userId, c.now);

  const applicant = await c.tx.applicant.findUnique({
    where: { applicationId: c.application.id },
    select: { name: true, ownerName: true },
  });
  const ownerName = applicant?.ownerName?.trim() || applicant?.name?.trim() || '';

  const year = c.now.getFullYear();
  const requestNumber = formatNumber('{prefix}/{year}/{seq:6}', {
    prefix: 'TPC',
    year,
    seq: await nextSequence(c.tx, `TPC-${year}`),
  });
  const desk = await deskFor(c.tx, 'PENDING_VERIFICATION');

  const row = await c.tx.professionalChangeRequest.create({
    data: {
      requestNumber,
      applicationId: c.application.id,
      status: 'PENDING_VERIFICATION',
      currentProfessionalId: current.userId,
      currentSnapshot: strip(current) as never,
      proposedProfessionalId: proposed.userId,
      proposedSnapshot: strip(proposed) as never,
      ownerName,
      requestDate,
      reason,
      documents: documents as never,
      currentDeskRoleKey: desk,
      requestedById: c.actor.id,
      requestedByName: c.actor.name,
      requestedByRoleKey: c.roleKey,
      requestedStageCode: c.stageCode,
      requestedAt: c.now,
      requestSequence: c.sequence,
    },
    select: { id: true },
  });

  await event(c, row.id, 'REQUESTED', '', 'PENDING_VERIFICATION', reason);
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'PROFESSIONAL_CHANGE_REQUESTED',
    entityType: 'ProfessionalChangeRequest',
    entityId: row.id,
    applicationId: c.application.id,
    after: {
      requestNumber,
      status: 'PENDING_VERIFICATION',
      currentProfessional: { id: current.userId, name: current.name, licenceNo: current.licenceNo },
      proposedProfessional: { id: proposed.userId, name: proposed.name, licenceNo: proposed.licenceNo },
      ownerName,
      requestDate: requestDate.toISOString(),
      stageCode: c.stageCode,
      workflowSequence: c.sequence,
    },
    remarks: reason,
    ...c.meta,
  });
  if (documents.length) await documentsAdded(c, row.id, requestNumber, 'PENDING_VERIFICATION', documents);

  return { requestId: row.id, requestNumber };
}

/** One event and one audit row for documents placed on a request. */
export async function documentsAdded(
  c: Pick<ProfessionalChangeCtx, 'tx' | 'actor' | 'roleKey' | 'now' | 'meta' | 'application' | 'stageCode'>,
  requestId: string,
  requestNumber: string,
  status: string,
  added: ProfessionalChangeDocument[]
) {
  const names = added.map((d) => PROFESSIONAL_CHANGE_DOCUMENT_LABEL[d.kind]).join(', ');
  await c.tx.professionalChangeEvent.create({
    data: {
      requestId,
      action: 'DOCUMENTS_ADDED',
      fromStatus: status,
      toStatus: status,
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: names,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'PROFESSIONAL_CHANGE_DOCUMENTS_ADDED',
    entityType: 'ProfessionalChangeRequest',
    entityId: requestId,
    applicationId: c.application.id,
    after: {
      requestNumber,
      documents: added.map((d) => ({ kind: d.kind, fileObjectId: d.fileObjectId, fileName: d.fileName, isDemo: d.isDemo })),
    },
    remarks: names,
    ...c.meta,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Verify, review
// ═══════════════════════════════════════════════════════════════════════════

type StepPayload = { requestId?: string };

async function openRequest(c: ProfessionalChangeCtx, status: ProfessionalChangeStatus, id?: string) {
  const row = await c.tx.professionalChangeRequest.findFirst({
    where: { applicationId: c.application.id, status, ...(id ? { id } : {}) },
    select: { id: true, requestNumber: true, status: true, documents: true, currentProfessionalId: true, proposedProfessionalId: true },
  });
  if (!row) throw conflict('That change of professional request has already moved on. Reload to see where it stands.', 'STALE_WRITE');
  return row;
}

async function advance(
  c: ProfessionalChangeCtx,
  row: { id: string; requestNumber: string },
  from: ProfessionalChangeStatus,
  to: ProfessionalChangeStatus,
  data: Record<string, unknown>,
  eventAction: string,
  auditAction: string
) {
  const desk = await deskFor(c.tx, to);
  const { count } = await c.tx.professionalChangeRequest.updateMany({
    where: { id: row.id, status: from },
    data: { ...data, status: to, currentDeskRoleKey: desk },
  });
  if (!count) throw conflict('Somebody else acted on this request just now. Reload to see what changed.', 'STALE_WRITE');
  await event(c, row.id, eventAction, from, to, c.remarks);
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: auditAction,
    entityType: 'ProfessionalChangeRequest',
    entityId: row.id,
    applicationId: c.application.id,
    before: { status: from },
    after: { status: to, requestNumber: row.requestNumber, nextDesk: desk, workflowSequence: c.sequence },
    remarks: c.remarks,
    ...c.meta,
  });
}

export async function verifyProfessionalChange(c: ProfessionalChangeCtx, payload: StepPayload | undefined) {
  const row = await openRequest(c, 'PENDING_VERIFICATION', payload?.requestId);
  if (!hasRelease(docs(row.documents).map((d) => d.kind))) {
    throw businessRule(
      'Add the current professional’s NOC or the owner’s termination letter before verifying — the file cannot pass to a new professional without a release from the old one.'
    );
  }
  await advance(
    c,
    row,
    'PENDING_VERIFICATION',
    'UNDER_REVIEW',
    { verifiedById: c.actor.id, verifiedByName: c.actor.name, verifiedByRoleKey: c.roleKey, verifiedAt: c.now, verificationRemarks: c.remarks },
    'VERIFIED',
    'PROFESSIONAL_CHANGE_VERIFIED'
  );
  return { requestId: row.id, requestNumber: row.requestNumber, status: 'UNDER_REVIEW' };
}

export async function reviewProfessionalChange(c: ProfessionalChangeCtx, payload: StepPayload | undefined) {
  const row = await openRequest(c, 'UNDER_REVIEW', payload?.requestId);
  await advance(
    c,
    row,
    'UNDER_REVIEW',
    'PENDING_DECISION',
    { reviewedById: c.actor.id, reviewedByName: c.actor.name, reviewedByRoleKey: c.roleKey, reviewedAt: c.now, reviewRemarks: c.remarks },
    'REVIEWED',
    'PROFESSIONAL_CHANGE_REVIEWED'
  );
  return { requestId: row.id, requestNumber: row.requestNumber, status: 'PENDING_DECISION' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Decide
// ═══════════════════════════════════════════════════════════════════════════

export async function decideProfessionalChange(
  c: ProfessionalChangeCtx,
  outcome: 'APPROVED' | 'REJECTED',
  payload: StepPayload | undefined
) {
  const row = await openRequest(c, 'PENDING_DECISION', payload?.requestId);

  const decided = {
    decision: outcome,
    decisionRemarks: c.remarks,
    decidedById: c.actor.id,
    decidedByName: c.actor.name,
    decidedByRoleKey: c.roleKey,
    decidedAt: c.now,
    decisionSequence: c.sequence,
  };

  if (outcome === 'REJECTED') {
    await advance(c, row, 'PENDING_DECISION', 'REJECTED', decided, 'REJECTED', 'PROFESSIONAL_CHANGE_REJECTED');
    return { requestId: row.id, requestNumber: row.requestNumber, status: 'REJECTED' };
  }

  // The file must still be held by the professional the request names. If it
  // is not, the request was overtaken and approving it would replace the
  // wrong person.
  if (c.application.ltpUserId !== row.currentProfessionalId) {
    throw conflict('This file is no longer held by the professional this request names. Reject it and register a fresh one.');
  }
  const incoming = await snapshotOf(c.tx, row.proposedProfessionalId);
  assertEligible(incoming, row.currentProfessionalId, c.now);
  const outgoing = await snapshotOf(c.tx, row.currentProfessionalId);

  await advance(c, row, 'PENDING_DECISION', 'APPROVED', decided, 'APPROVED', 'PROFESSIONAL_CHANGE_APPROVED');

  // ── 1. The outgoing engagement: closed, never removed ──────────────────
  //
  // A file filed before this module has no engagement row. Its original one
  // is written now, from the filing record, so the history starts at filing.
  let active = await c.tx.applicationProfessional.findFirst({
    where: { applicationId: c.application.id, status: 'ACTIVE' },
    select: { id: true, userId: true },
  });
  if (active && active.userId !== outgoing.userId) {
    throw conflict('The engagement history does not match the file. An administrator must reconcile it before the change is approved.');
  }
  if (!active) {
    const app = await c.tx.application.findUniqueOrThrow({
      where: { id: c.application.id },
      select: { submittedAt: true, createdAt: true, ltpDeclaration: true },
    });
    const declared = (app.ltpDeclaration ?? {}) as Partial<Record<string, string>>;
    active = await c.tx.applicationProfessional.create({
      data: {
        applicationId: c.application.id,
        userId: outgoing.userId,
        status: 'ACTIVE',
        snapshot: {
          ...strip(outgoing),
          // As declared at filing, where the declaration recorded it.
          licenceNo: declared.licenceNo || outgoing.licenceNo,
          licenceClass: declared.licenceClass || outgoing.licenceClass,
          firmName: declared.firmName || outgoing.firmName,
          validUpto: declared.validUpto ?? outgoing.validUpto,
        } as never,
        drawingRights: true,
        source: 'ORIGINAL_FILING',
        engagedFrom: app.submittedAt ?? app.createdAt,
      },
      select: { id: true, userId: true },
    });
  }
  await c.tx.applicationProfessional.update({
    where: { id: active.id },
    data: { status: 'SUPERSEDED', engagedUntil: c.now, drawingRights: false, endedByChangeRequestId: row.id },
  });

  // ── 2. The incoming engagement ─────────────────────────────────────────
  const engagement = await c.tx.applicationProfessional.create({
    data: {
      applicationId: c.application.id,
      userId: incoming.userId,
      status: 'ACTIVE',
      snapshot: strip(incoming) as never,
      drawingRights: true,
      source: 'CHANGE_REQUEST',
      engagedFrom: c.now,
      changeRequestId: row.id,
    },
    select: { id: true },
  });

  // ── 3. Who holds the file — and so who may submit drawings ─────────────
  //
  // `ltpUserId` is the column the drawing, BIM, scrutiny and document services
  // check. Moving it is the transfer of drawing rights; the outgoing
  // professional loses access to the file from this commit.
  await c.tx.application.update({ where: { id: c.application.id }, data: { ltpUserId: incoming.userId } });
  // A task the outgoing professional had claimed follows the file.
  await c.tx.workflowTask.updateMany({
    where: { instance: { applicationId: c.application.id }, status: { in: ['PENDING', 'IN_PROGRESS'] }, assignedUserId: outgoing.userId },
    data: { assignedUserId: incoming.userId },
  });

  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'PROFESSIONAL_CHANGED',
    entityType: 'Application',
    entityId: c.application.id,
    applicationId: c.application.id,
    before: { ltpUserId: outgoing.userId, professional: outgoing.name, licenceNo: outgoing.licenceNo, engagementId: active.id },
    after: {
      ltpUserId: incoming.userId,
      professional: incoming.name,
      licenceNo: incoming.licenceNo,
      engagementId: engagement.id,
      requestNumber: row.requestNumber,
      workflowSequence: c.sequence,
    },
    remarks: c.remarks,
    ...c.meta,
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'DRAWING_RIGHTS_TRANSFERRED',
    entityType: 'Application',
    entityId: c.application.id,
    applicationId: c.application.id,
    before: { drawingRightsHolder: outgoing.userId, name: outgoing.name },
    after: { drawingRightsHolder: incoming.userId, name: incoming.name, requestNumber: row.requestNumber },
    remarks: `Drawing submission rights moved from ${outgoing.name} to ${incoming.name}.`,
    ...c.meta,
  });
  await event(
    c,
    row.id,
    'PROFESSIONAL_CHANGED',
    'APPROVED',
    'APPROVED',
    `${incoming.name} (${incoming.licenceNo}) now holds the file and its drawing rights. ${outgoing.name} is kept in the history.`
  );

  return { requestId: row.id, requestNumber: row.requestNumber, status: 'APPROVED', newProfessionalId: incoming.userId };
}
