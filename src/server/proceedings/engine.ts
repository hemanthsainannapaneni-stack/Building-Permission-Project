import 'server-only';
import type { Tx } from '@/server/db/prisma';
import { audit } from '@/server/services/audit';
import { formatNumber, nextSequence } from '@/server/services/numbering';
import { businessRule, conflict } from '@/server/http/errors';
import {
  OPEN_SHOW_CAUSE_STATUSES,
  SHOW_CAUSE_DECISION_RESULT,
  isShowCauseDecision,
} from '@/lib/show-cause';
import { OPEN_REVOCATION_STATUSES } from '@/lib/revocation';
import type { OutwardDocumentType } from '@/lib/outward';

/**
 * THE WRITES BEHIND THE SHOW CAUSE AND REVOCATION TRANSITIONS.
 *
 * Called only from the workflow effects SHOW_CAUSE and REVOCATION, inside the
 * transition's transaction — the same arrangement as RAISE_SHORTFALL and the
 * shortfall engine. That is what makes every notice and every revocation
 * provably attached to a recorded workflow decision by a named officer at a
 * named stage: there is no other code path that creates one.
 *
 * Also home to `createOutwardEntry`, which the effects call to send the
 * generated document to the Outward register in the SAME transaction. A
 * notice that exists with nothing in Outward is the state this rules out.
 *
 * Nothing here touches the shortfall tables.
 */

type Actor = { id: string; name: string; roleKeys?: string[] };
type Meta = { ip: string; userAgent: string; correlationId?: string };

type Ctx = {
  tx: Tx;
  actor: Actor;
  /** The role the actor acted in, for the record. */
  roleKey: string;
  now: Date;
  meta: Meta;
  application: { id: string; applicationNumber: string; status: string };
  stageCode: string;
  sequence: number;
  remarks: string;
};

const NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';

async function allocate(tx: Tx, prefix: string, now: Date) {
  const year = now.getFullYear();
  const seq = await nextSequence(tx, `${prefix}-${year}`);
  return formatNumber(NUMBER_FORMAT, { prefix, year, seq });
}

const inCapacity = (actor: Actor, roleKey: string) => ({ id: actor.id, name: actor.name, roleKeys: [roleKey] });

/** Where the notice or order goes: the owner, falling back to the applicant. */
export async function addressee(tx: Tx, applicationId: string) {
  const a = await tx.applicant.findUnique({
    where: { applicationId },
    select: { name: true, ownerName: true, address: true, ownerAddress: true },
  });
  return {
    recipient: a?.ownerName?.trim() || a?.name?.trim() || 'The applicant',
    address: a?.ownerAddress?.trim() || a?.address?.trim() || '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Outward
// ═══════════════════════════════════════════════════════════════════════════

export type CreateOutwardInput = {
  applicationId: string | null;
  documentType: OutwardDocumentType;
  documentReference: string;
  sourceType: string;
  sourceId: string;
  subject: string;
  recipient: string;
  address: string;
  status: 'DRAFT' | 'READY_FOR_DISPATCH';
  remarks?: string;
};

/**
 * One row in the Outward register, with its first event and its audit row.
 * Used by the effects below and by the Outward service's manual Create.
 */
export async function createOutwardEntry(
  tx: Tx,
  input: CreateOutwardInput,
  by: { actor: Actor; roleKey: string; now: Date; meta: Meta }
) {
  const outwardNumber = await allocate(tx, 'OUT', by.now);
  const row = await tx.outwardEntry.create({
    data: {
      outwardNumber,
      applicationId: input.applicationId,
      documentType: input.documentType,
      documentReference: input.documentReference,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      subject: input.subject,
      recipient: input.recipient,
      address: input.address,
      status: input.status,
      assignedDate: by.now,
      remarks: input.remarks ?? '',
      createdById: by.actor.id,
      createdByName: by.actor.name,
    },
    select: { id: true, outwardNumber: true, status: true },
  });
  await tx.outwardEvent.create({
    data: {
      outwardId: row.id,
      action: 'CREATED',
      fromStatus: '',
      toStatus: input.status,
      actorId: by.actor.id,
      actorName: by.actor.name,
      actorRoleKey: by.roleKey,
      remarks: input.sourceType ? `Generated with ${input.documentReference}.` : input.remarks ?? '',
      occurredAt: by.now,
    },
  });
  await audit(tx, {
    actor: inCapacity(by.actor, by.roleKey),
    action: 'OUTWARD_CREATED',
    entityType: 'OutwardEntry',
    entityId: row.id,
    applicationId: input.applicationId,
    after: {
      outwardNumber,
      documentType: input.documentType,
      documentReference: input.documentReference,
      status: input.status,
      recipient: input.recipient,
    },
    remarks: input.remarks ?? '',
    ...by.meta,
  });
  return row;
}

// ═══════════════════════════════════════════════════════════════════════════
// Show cause
// ═══════════════════════════════════════════════════════════════════════════

export type SupportingDocument = {
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
};

export type IssuePayload = {
  reason: string;
  violation: string;
  responseDueDate: string;
  supportingDocuments?: SupportingDocument[];
};

export async function issueShowCause(c: Ctx, payload: IssuePayload | undefined) {
  if (!payload?.reason?.trim() || !payload.violation?.trim() || !payload.responseDueDate) {
    // A bare POST to the generic action endpoint lands here: the notice's
    // particulars come from the Proceedings tab, not the action modal.
    throw businessRule('Issue the show cause notice from the Proceedings tab — it needs the reason, the violation and a response date.');
  }
  const due = new Date(payload.responseDueDate);
  if (Number.isNaN(due.getTime()) || due.getTime() <= c.now.getTime()) {
    throw businessRule('The response due date must be in the future.');
  }

  const open = await c.tx.showCauseNotice.findFirst({
    where: { applicationId: c.application.id, status: { in: [...OPEN_SHOW_CAUSE_STATUSES] } },
    select: { noticeNumber: true },
  });
  if (open) throw conflict(`${open.noticeNumber} is still open on this file. Decide it before issuing another.`);

  const noticeNumber = await allocate(c.tx, 'SCN', c.now);
  const notice = await c.tx.showCauseNotice.create({
    data: {
      noticeNumber,
      applicationId: c.application.id,
      status: 'ISSUED',
      reason: payload.reason.trim(),
      violation: payload.violation.trim(),
      responseDueDate: due,
      supportingDocuments: (payload.supportingDocuments ?? []) as never,
      issuedById: c.actor.id,
      issuedByName: c.actor.name,
      issuedByRoleKey: c.roleKey,
      issuedStageCode: c.stageCode,
      issuedAt: c.now,
      issueSequence: c.sequence,
    },
    select: { id: true, noticeNumber: true },
  });

  const to = await addressee(c.tx, c.application.id);
  const outward = await createOutwardEntry(
    c.tx,
    {
      applicationId: c.application.id,
      documentType: 'SHOW_CAUSE_NOTICE',
      documentReference: noticeNumber,
      sourceType: 'ShowCauseNotice',
      sourceId: notice.id,
      subject: `Show cause notice ${noticeNumber} — ${c.application.applicationNumber}`,
      recipient: to.recipient,
      address: to.address,
      status: 'READY_FOR_DISPATCH',
    },
    c
  );

  await c.tx.showCauseEvent.create({
    data: {
      showCauseId: notice.id,
      action: 'ISSUED',
      fromStatus: '',
      toStatus: 'ISSUED',
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: `Notice generated and sent to Outward as ${outward.outwardNumber}.`,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'SHOW_CAUSE_ISSUED',
    entityType: 'ShowCauseNotice',
    entityId: notice.id,
    applicationId: c.application.id,
    after: {
      noticeNumber,
      violation: payload.violation.trim(),
      responseDueDate: due.toISOString(),
      outwardNumber: outward.outwardNumber,
      stageCode: c.stageCode,
      workflowSequence: c.sequence,
    },
    remarks: payload.reason.trim(),
    ...c.meta,
  });

  return { showCauseId: notice.id, noticeNumber, outwardNumber: outward.outwardNumber };
}

export type RespondPayload = { showCauseId?: string; response?: string; documents?: SupportingDocument[] };

/**
 * The applicant's answer — step RESPOND, raised by the show cause service as
 * a SYSTEM transition on the applicant's behalf (see performSystemActionInTx).
 * Only a DISPATCHED notice can be answered: "Notice → Outward → Response".
 */
export async function respondToShowCause(c: Ctx, payload: RespondPayload | undefined) {
  const response = payload?.response?.trim() ?? '';
  if (!payload?.showCauseId || response.length < 10) {
    throw businessRule('Answer the notice from its page — the written response is required.');
  }
  const documents = payload.documents ?? [];
  const notice = await c.tx.showCauseNotice.findFirst({
    where: { id: payload.showCauseId, applicationId: c.application.id },
    select: { id: true, noticeNumber: true, status: true },
  });
  if (!notice) throw conflict('That show cause notice is not on this file.');
  if (notice.status !== 'AWAITING_RESPONSE') {
    throw conflict(
      notice.status === 'ISSUED'
        ? 'This notice has not been dispatched yet. It can be answered once it has been sent.'
        : 'This notice has already been answered.'
    );
  }
  const { count } = await c.tx.showCauseNotice.updateMany({
    where: { id: notice.id, status: 'AWAITING_RESPONSE' },
    data: {
      status: 'RESPONDED',
      responseText: response,
      responseDocuments: documents as never,
      respondedById: c.actor.id,
      respondedByName: c.actor.name,
      respondedAt: c.now,
    },
  });
  if (!count) throw conflict('This notice changed while your response was uploading. Reload and try again.', 'STALE_WRITE');

  await c.tx.showCauseEvent.create({
    data: {
      showCauseId: notice.id,
      action: 'RESPONDED',
      fromStatus: 'AWAITING_RESPONSE',
      toStatus: 'RESPONDED',
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: `${documents.length} document${documents.length === 1 ? '' : 's'} attached.`,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'SHOW_CAUSE_RESPONDED',
    entityType: 'ShowCauseNotice',
    entityId: notice.id,
    applicationId: c.application.id,
    before: { status: 'AWAITING_RESPONSE' },
    after: {
      status: 'RESPONDED',
      noticeNumber: notice.noticeNumber,
      workflowSequence: c.sequence,
      documents: documents.map((d) => ({ fileObjectId: d.fileObjectId, fileName: d.fileName, isDemo: d.isDemo })),
    },
    remarks: response.slice(0, 500),
    ...c.meta,
  });
  return { showCauseId: notice.id, noticeNumber: notice.noticeNumber };
}

/** "Review Show Cause Submission" — step REVIEW: the desk takes the answer up. */
export async function reviewShowCause(c: Ctx, payload: { showCauseId?: string } | undefined) {
  const notice = await c.tx.showCauseNotice.findFirst({
    where: { applicationId: c.application.id, status: 'RESPONDED', ...(payload?.showCauseId ? { id: payload.showCauseId } : {}) },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, noticeNumber: true },
  });
  if (!notice) throw conflict('There is no answered show cause notice on this file to take up.');
  const { count } = await c.tx.showCauseNotice.updateMany({
    where: { id: notice.id, status: 'RESPONDED' },
    data: { status: 'UNDER_REVIEW', reviewerId: c.actor.id, reviewerName: c.actor.name, reviewerRoleKey: c.roleKey, reviewStartedAt: c.now },
  });
  if (!count) throw conflict('Somebody else acted on this notice just now. Reload to see what changed.', 'STALE_WRITE');
  await c.tx.showCauseEvent.create({
    data: {
      showCauseId: notice.id,
      action: 'TAKEN_UP',
      fromStatus: 'RESPONDED',
      toStatus: 'UNDER_REVIEW',
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: c.remarks,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'SHOW_CAUSE_REVIEW_STARTED',
    entityType: 'ShowCauseNotice',
    entityId: notice.id,
    applicationId: c.application.id,
    before: { status: 'RESPONDED' },
    after: { status: 'UNDER_REVIEW', noticeNumber: notice.noticeNumber, workflowSequence: c.sequence },
    remarks: c.remarks,
    ...c.meta,
  });
  return { showCauseId: notice.id, noticeNumber: notice.noticeNumber };
}

export type DecidePayload = { showCauseId?: string; decision?: string };

export async function decideShowCause(c: Ctx, payload: DecidePayload | undefined) {
  const decision = payload?.decision ?? '';
  if (!isShowCauseDecision(decision)) {
    throw businessRule('Decide the show cause from the Proceedings tab — choose one of the four decisions.');
  }
  const notice = await c.tx.showCauseNotice.findFirst({
    where: {
      applicationId: c.application.id,
      // Decided only after it has been taken up: Response → Review → Decision.
      status: 'UNDER_REVIEW',
      ...(payload?.showCauseId ? { id: payload.showCauseId } : {}),
    },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, noticeNumber: true, status: true },
  });
  if (!notice) throw conflict('There is no show cause response under review on this file to decide.');

  const to = SHOW_CAUSE_DECISION_RESULT[decision];
  const { count } = await c.tx.showCauseNotice.updateMany({
    where: { id: notice.id, status: notice.status },
    data: {
      status: to,
      decision,
      decisionRemarks: c.remarks,
      decidedById: c.actor.id,
      decidedByName: c.actor.name,
      decidedByRoleKey: c.roleKey,
      decidedAt: c.now,
      decisionSequence: c.sequence,
    },
  });
  if (!count) throw conflict('Somebody else acted on this notice just now. Reload to see what changed.', 'STALE_WRITE');

  await c.tx.showCauseEvent.create({
    data: {
      showCauseId: notice.id,
      action: 'DECIDED',
      fromStatus: notice.status,
      toStatus: to,
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: c.remarks,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'SHOW_CAUSE_DECIDED',
    entityType: 'ShowCauseNotice',
    entityId: notice.id,
    applicationId: c.application.id,
    before: { status: notice.status },
    after: { status: to, decision, noticeNumber: notice.noticeNumber, workflowSequence: c.sequence },
    remarks: c.remarks,
    ...c.meta,
  });

  return { showCauseId: notice.id, noticeNumber: notice.noticeNumber, decision, status: to };
}

// ═══════════════════════════════════════════════════════════════════════════
// Revocation
// ═══════════════════════════════════════════════════════════════════════════

export type ProposePayload = { reason?: string; grounds?: string[]; showCauseId?: string | null };

export async function proposeRevocation(c: Ctx, payload: ProposePayload | undefined) {
  const reason = payload?.reason?.trim() ?? '';
  const grounds = (payload?.grounds ?? []).map((g) => g.trim()).filter(Boolean);
  if (!reason || !grounds.length) {
    throw businessRule('Initiate the revocation from the Proceedings tab — it needs a reason and at least one ground.');
  }
  const open = await c.tx.revocationProceeding.findFirst({
    where: { applicationId: c.application.id, status: { in: [...OPEN_REVOCATION_STATUSES] } },
    select: { revocationNumber: true },
  });
  if (open) throw conflict(`${open.revocationNumber} is already open on this file.`);

  let showCauseId: string | null = null;
  if (payload?.showCauseId) {
    const sc = await c.tx.showCauseNotice.findFirst({
      where: { id: payload.showCauseId, applicationId: c.application.id },
      select: { id: true },
    });
    if (!sc) throw businessRule('That show cause notice is not on this file.');
    showCauseId = sc.id;
  }

  const order = await c.tx.approvalOrder.findUnique({
    where: { applicationId: c.application.id },
    select: { orderNumber: true },
  });

  const revocationNumber = await allocate(c.tx, 'REV', c.now);
  const row = await c.tx.revocationProceeding.create({
    data: {
      revocationNumber,
      applicationId: c.application.id,
      showCauseId,
      orderNumber: order?.orderNumber ?? '',
      status: 'PROPOSED',
      reason,
      grounds,
      initiatedById: c.actor.id,
      initiatedByName: c.actor.name,
      initiatedByRoleKey: c.roleKey,
      initiatedAt: c.now,
    },
    select: { id: true },
  });
  await c.tx.revocationEvent.create({
    data: {
      revocationId: row.id,
      action: 'INITIATED',
      toStatus: 'PROPOSED',
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: reason,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'REVOCATION_INITIATED',
    entityType: 'RevocationProceeding',
    entityId: row.id,
    applicationId: c.application.id,
    after: { revocationNumber, status: 'PROPOSED', orderNumber: order?.orderNumber ?? '', grounds, showCauseId },
    remarks: reason,
    ...c.meta,
  });
  return { revocationId: row.id, revocationNumber };
}

async function openRevocation(c: Ctx, status: 'PROPOSED' | 'UNDER_REVIEW', id?: string) {
  const row = await c.tx.revocationProceeding.findFirst({
    where: { applicationId: c.application.id, status, ...(id ? { id } : {}) },
    select: { id: true, revocationNumber: true, status: true, orderNumber: true, reason: true },
  });
  if (!row) {
    throw conflict(
      status === 'PROPOSED'
        ? 'There is no proposed revocation on this file to take up.'
        : 'There is no revocation under review on this file to decide.'
    );
  }
  return row;
}

export async function reviewRevocation(c: Ctx, payload: { revocationId?: string } | undefined) {
  const row = await openRevocation(c, 'PROPOSED', payload?.revocationId);
  await c.tx.revocationProceeding.update({
    where: { id: row.id },
    data: {
      status: 'UNDER_REVIEW',
      reviewerId: c.actor.id,
      reviewerName: c.actor.name,
      reviewerRoleKey: c.roleKey,
      reviewStartedAt: c.now,
    },
  });
  await c.tx.revocationEvent.create({
    data: {
      revocationId: row.id,
      action: 'TAKEN_UP',
      fromStatus: 'PROPOSED',
      toStatus: 'UNDER_REVIEW',
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: c.remarks,
      occurredAt: c.now,
    },
  });
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'REVOCATION_TAKEN_UP',
    entityType: 'RevocationProceeding',
    entityId: row.id,
    applicationId: c.application.id,
    before: { status: 'PROPOSED' },
    after: { status: 'UNDER_REVIEW', revocationNumber: row.revocationNumber },
    remarks: c.remarks,
    ...c.meta,
  });
  return { revocationId: row.id, revocationNumber: row.revocationNumber };
}

export async function decideRevocation(
  c: Ctx,
  outcome: 'REVOKED' | 'REJECTED',
  payload: { revocationId?: string } | undefined
) {
  const row = await openRevocation(c, 'UNDER_REVIEW', payload?.revocationId);

  let revocationOrderNumber = '';
  let outwardNumber = '';
  if (outcome === 'REVOKED') {
    revocationOrderNumber = await allocate(c.tx, 'ROR', c.now);
  }

  await c.tx.revocationProceeding.update({
    where: { id: row.id },
    data: {
      status: outcome,
      decision: outcome,
      decisionRemarks: c.remarks,
      decidedById: c.actor.id,
      decidedByName: c.actor.name,
      decidedByRoleKey: c.roleKey,
      decidedAt: c.now,
      ...(outcome === 'REVOKED' ? { revocationOrderNumber, orderGeneratedAt: c.now } : {}),
    },
  });

  if (outcome === 'REVOKED') {
    // The approval order is MARKED, never rewritten or removed: its number,
    // snapshot and verification code stay exactly as issued, so the public
    // verification page can say "this permission was granted, and revoked".
    const order = await c.tx.approvalOrder.findUnique({
      where: { applicationId: c.application.id },
      select: { id: true, orderNumber: true, status: true },
    });
    if (order) {
      await c.tx.approvalOrder.update({
        where: { id: order.id },
        data: { status: 'REVOKED', revokedAt: c.now, revokeReason: `${row.revocationNumber}: ${c.remarks}`.slice(0, 2000) },
      });
    }

    const to = await addressee(c.tx, c.application.id);
    const outward = await createOutwardEntry(
      c.tx,
      {
        applicationId: c.application.id,
        documentType: 'REVOCATION_ORDER',
        documentReference: revocationOrderNumber,
        sourceType: 'RevocationProceeding',
        sourceId: row.id,
        subject: `Revocation order ${revocationOrderNumber} — ${row.orderNumber || c.application.applicationNumber}`,
        recipient: to.recipient,
        address: to.address,
        status: 'READY_FOR_DISPATCH',
      },
      c
    );
    outwardNumber = outward.outwardNumber;

    await audit(c.tx, {
      actor: inCapacity(c.actor, c.roleKey),
      action: 'REVOCATION_APPROVED',
      entityType: 'RevocationProceeding',
      entityId: row.id,
      applicationId: c.application.id,
      before: { status: 'UNDER_REVIEW' },
      after: { status: 'REVOKED', revocationNumber: row.revocationNumber, revocationOrderNumber, outwardNumber },
      remarks: c.remarks,
      ...c.meta,
    });
    await audit(c.tx, {
      actor: inCapacity(c.actor, c.roleKey),
      action: 'PROCEEDING_REVOKED',
      entityType: 'Application',
      entityId: c.application.id,
      applicationId: c.application.id,
      before: { status: c.application.status, orderStatus: order?.status ?? null },
      after: {
        status: 'PROCEEDING_REVOKED',
        orderNumber: order?.orderNumber ?? null,
        orderStatus: order ? 'REVOKED' : null,
        revocationNumber: row.revocationNumber,
        revocationOrderNumber,
        workflowSequence: c.sequence,
      },
      remarks: c.remarks,
      ...c.meta,
    });
  } else {
    await audit(c.tx, {
      actor: inCapacity(c.actor, c.roleKey),
      action: 'REVOCATION_REJECTED',
      entityType: 'RevocationProceeding',
      entityId: row.id,
      applicationId: c.application.id,
      before: { status: 'UNDER_REVIEW' },
      after: { status: 'REJECTED', revocationNumber: row.revocationNumber },
      remarks: c.remarks,
      ...c.meta,
    });
  }

  await c.tx.revocationEvent.create({
    data: {
      revocationId: row.id,
      action: outcome === 'REVOKED' ? 'REVOKED' : 'REJECTED',
      fromStatus: 'UNDER_REVIEW',
      toStatus: outcome,
      actorId: c.actor.id,
      actorName: c.actor.name,
      actorRoleKey: c.roleKey,
      stageCode: c.stageCode,
      remarks: outcome === 'REVOKED' ? `${c.remarks} — Order ${revocationOrderNumber} sent to Outward as ${outwardNumber}.` : c.remarks,
      occurredAt: c.now,
    },
  });

  return { revocationId: row.id, revocationNumber: row.revocationNumber, revocationOrderNumber, outwardNumber, outcome };
}

export type ProceedingCtx = Ctx;
