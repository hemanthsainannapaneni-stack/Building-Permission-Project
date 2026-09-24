import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, isLtp, type AuthUser } from '@/server/auth/context';
import { badRequest, conflict, forbidden, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES } from '@/lib/constants';
import { stageName } from '@/lib/workflow';
import { ACTIONS } from '@/lib/workflow';
import {
  AWAITING_DECISION_STATUSES,
  OPEN_SHOW_CAUSE_STATUSES,
  SHOW_CAUSE_STATUS_LABEL,
  canDecide,
  canRespond,
  canTakeUp,
  isShowCauseStatus,
  type ShowCauseStatus,
} from '@/lib/show-cause';
import { REVOCATION_STATUS_LABEL, type RevocationStatus } from '@/lib/revocation';
import type {
  DecideShowCauseInput,
  IssueShowCauseInput,
  RespondShowCauseInput,
  TakeUpShowCauseInput,
} from '@/lib/schemas/proceedings';
import { getWorkflowState, performActionInTx, performSystemActionInTx, type ActionOption } from '@/server/workflow/engine';
import type { SupportingDocument } from '@/server/proceedings/engine';
import { renderDemoAttachment, renderShowCauseNotice } from '@/server/proceedings/documents';
import { storeUpload } from './files';

/**
 * THE SHOW CAUSE SERVICE.
 *
 *   desk: Issue → Outward: Dispatch → applicant: Respond →
 *   desk: Review Show Cause Submission → desk: Decide
 *
 * ── Who may do what is the WORKFLOW's answer ─────────────────────────────
 *
 * Every step but dispatch is a workflow transition (ISSUE_SHOW_CAUSE,
 * RESPOND_SHOW_CAUSE, TAKE_UP_SHOW_CAUSE, DECIDE_SHOW_CAUSE), ordered by the
 * guards on those rows. This service never asks "is this the ZJD?" — it asks
 * the engine which actions this caller may take on this file right now, and
 * offers exactly those. The applicant's answer is raised as a SYSTEM
 * transition on their behalf, after this service has checked it is the file's
 * own applicant.
 *
 * ── Separate from shortfalls, all the way down ───────────────────────────
 *
 * Different table, different numbers, different actions and effects. Nothing
 * in this file reads or writes a shortfall.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
type Upload = { name: string; type: string; bytes: Buffer };

const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  ltpUserId: true,
  approvedAt: true,
  zone: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true, address: true, ownerAddress: true } },
  property: { select: { plotNo: true, localityName: true, village: true, mandal: true, district: true } },
  approvalOrder: { select: { orderNumber: true, status: true, revokedAt: true } },
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const isTerminalStage = (code: string | null) => Boolean(code?.startsWith('CLOSED_'));

export function applicationSummary(app: ApplicationRow) {
  return {
    id: app.id,
    applicationNumber: app.applicationNumber,
    status: app.status,
    currentStageCode: app.currentStageCode,
    currentDesk: stageName(app.currentStageCode),
    zone: app.zone?.name ?? '',
    owner: app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '',
    orderNumber: app.approvalOrder?.orderNumber ?? '',
    orderRevoked: Boolean(app.approvalOrder?.revokedAt),
    approvedAt: app.approvedAt,
  };
}

export function siteOf(app: Pick<ApplicationRow, 'property'>): string {
  const p = app.property;
  if (!p) return '';
  return [p.plotNo ? `Plot ${p.plotNo}` : '', p.localityName, p.village, p.mandal, p.district].filter(Boolean).join(', ');
}

/**
 * Where the notice is waiting, in one phrase. A decided notice waits nowhere.
 * An answered notice waits at the desk the file is at — or, on a closed file,
 * with the role that issued it, since a terminal stage is not a desk.
 */
export function currentDeskOf(
  status: string,
  app: { currentStageCode: string | null },
  issuedByRoleKey: string
): string {
  switch (status) {
    case 'ISSUED':
      return 'Outward — awaiting dispatch';
    case 'AWAITING_RESPONSE':
      return 'Applicant';
    case 'RESPONDED':
    case 'UNDER_REVIEW':
      return isTerminalStage(app.currentStageCode) ? issuedByRoleKey || '—' : stageName(app.currentStageCode);
    default:
      return 'Decided';
  }
}

const docs = (v: unknown): SupportingDocument[] => (Array.isArray(v) ? (v as SupportingDocument[]) : []);

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.SHOW_CAUSE_VIEW)) throw forbidden('Your role does not include show cause notices.');
}

const scopeWhere = (user: AuthUser): Prisma.ShowCauseNoticeWhereInput => ({
  application: { deletedAt: null, ...applicationScope(user) },
});

async function requireApplication(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');
  const app = await prisma.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: APPLICATION_SELECT,
  });
  if (!app) throw notFound('That application could not be found.');
  return app;
}

async function requireNotice(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That show cause notice could not be found.');
  const row = await prisma.showCauseNotice.findFirst({
    where: { id, ...scopeWhere(user) },
    include: { application: { select: APPLICATION_SELECT } },
  });
  if (!row) throw notFound('That show cause notice could not be found.');
  return row;
}

/** What the workflow offers this caller on this file, keyed by action code. */
export async function workflowOffers(user: AuthUser, applicationId: string) {
  const state = await getWorkflowState(user, applicationId);
  const byCode = new Map<string, ActionOption>(state.actions.map((a) => [a.code, a]));
  const offer = (code: string) => {
    const a = byCode.get(code);
    return { offered: Boolean(a), available: Boolean(a?.available), reason: a?.reason ?? '' };
  };
  return { offer, sequence: state.sequence };
}

const isApplicant = (user: AuthUser, app: { ltpUserId: string }) =>
  can(user, CAPABILITIES.SHOW_CAUSE_RESPOND) && isLtp(user) && app.ltpUserId === user.id;

function assertExpected(current: string, expected: string | undefined) {
  if (expected && expected !== current) {
    throw conflict(
      `This notice is now ${SHOW_CAUSE_STATUS_LABEL[current as ShowCauseStatus] ?? current}. Reload to see what changed.`,
      'STALE_WRITE'
    );
  }
}

async function storeAll(applicationId: string, userId: string, files: Upload[], demo: boolean): Promise<SupportingDocument[]> {
  if (demo && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const out: SupportingDocument[] = [];
  for (const file of files.slice(0, 5)) {
    const stored = await storeUpload({
      applicationId,
      kind: 'proceedings',
      file,
      uploadedById: userId,
      allowedExtensions: DOCUMENT_EXTENSIONS,
      maxBytes: MAX_DOCUMENT_BYTES,
    });
    out.push({
      fileObjectId: stored.id,
      fileName: stored.originalName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      isDemo: false,
    });
  }
  if (!out.length && demo) {
    out.push({ fileObjectId: null, fileName: 'supporting-document-DEMO.pdf', mimeType: 'application/pdf', sizeBytes: 0, isDemo: true });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type ShowCauseListQuery = {
  q?: string;
  /** A status, or OPEN (not yet decided). */
  status?: string;
  applicationId?: string;
  page?: number;
  pageSize?: number;
};

function listWhere(user: AuthUser, query: ShowCauseListQuery): Prisma.ShowCauseNoticeWhereInput {
  const and: Prisma.ShowCauseNoticeWhereInput[] = [scopeWhere(user)];
  if (query.applicationId && isUuid(query.applicationId)) and.push({ applicationId: query.applicationId });
  if (query.status === 'OPEN') and.push({ status: { in: [...OPEN_SHOW_CAUSE_STATUSES] } });
  else if (query.status && isShowCauseStatus(query.status)) and.push({ status: query.status });
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { noticeNumber: { contains: q, mode: 'insensitive' } },
        { violation: { contains: q, mode: 'insensitive' } },
        { application: { applicationNumber: { contains: q, mode: 'insensitive' } } },
        { application: { applicant: { ownerName: { contains: q, mode: 'insensitive' } } } },
        { application: { applicant: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }
  return { AND: and };
}

export async function listShowCauses(user: AuthUser, query: ShowCauseListQuery = {}) {
  requireView(user);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const where = listWhere(user, query);
  const [total, rows] = await Promise.all([
    prisma.showCauseNotice.count({ where }),
    prisma.showCauseNotice.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { application: { select: APPLICATION_SELECT } },
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => ({
      id: r.id,
      noticeNumber: r.noticeNumber,
      status: r.status,
      violation: r.violation,
      issuedByName: r.issuedByName,
      issuedByRoleKey: r.issuedByRoleKey,
      issuedAt: r.issuedAt,
      responseDueDate: r.responseDueDate,
      respondedAt: r.respondedAt,
      decision: r.decision,
      currentDesk: currentDeskOf(r.status, r.application, r.issuedByRoleKey),
      application: applicationSummary(r.application),
    })),
  };
}

export async function showCauseSummary(user: AuthUser) {
  requireView(user);
  const scope = scopeWhere(user);
  const [byStatus, overdue] = await Promise.all([
    prisma.showCauseNotice.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.showCauseNotice.count({
      where: { ...scope, status: { in: ['ISSUED', 'AWAITING_RESPONSE'] }, responseDueDate: { lt: new Date() } },
    }),
  ]);
  const s = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const get = (k: ShowCauseStatus) => s[k] ?? 0;
  return {
    total: Object.values(s).reduce((a, b) => a + b, 0),
    byStatus: s,
    open: OPEN_SHOW_CAUSE_STATUSES.reduce((n, k) => n + get(k), 0),
    awaitingDispatch: get('ISSUED'),
    awaitingResponse: get('AWAITING_RESPONSE'),
    awaitingDecision: AWAITING_DECISION_STATUSES.reduce((n, k) => n + get(k), 0),
    closed: get('CLOSED'),
    decided: get('CLOSED') + get('FURTHER_ACTION') + get('REJECTED') + get('REFERRED_FOR_REVOCATION'),
    referred: get('REFERRED_FOR_REVOCATION'),
    pastDue: overdue,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// One notice
// ═══════════════════════════════════════════════════════════════════════════

async function outwardFor(sourceId: string) {
  return prisma.outwardEntry.findFirst({
    where: { sourceType: 'ShowCauseNotice', sourceId },
    select: {
      id: true,
      outwardNumber: true,
      status: true,
      mode: true,
      trackingNumber: true,
      dispatchDate: true,
      deliveredAt: true,
      acknowledgement: true,
      acknowledgementDate: true,
    },
  });
}

export async function getShowCause(user: AuthUser, id: string) {
  requireView(user);
  const row = await requireNotice(user, id);
  const [events, outward, revocation, offers] = await Promise.all([
    prisma.showCauseEvent.findMany({ where: { showCauseId: row.id }, orderBy: { occurredAt: 'desc' } }),
    outwardFor(row.id),
    prisma.revocationProceeding.findFirst({
      where: { showCauseId: row.id },
      select: { id: true, revocationNumber: true, status: true },
    }),
    workflowOffers(user, row.applicationId).catch(() => null),
  ]);
  const none = { offered: false, available: false, reason: '' };
  const decide = offers?.offer(ACTIONS.DECIDE_SHOW_CAUSE) ?? none;
  const takeUp = offers?.offer(ACTIONS.TAKE_UP_SHOW_CAUSE) ?? none;
  const initiate = offers?.offer(ACTIONS.INITIATE_REVOCATION) ?? { offered: false, available: false, reason: '' };
  const { application, ...notice } = row;
  return {
    ...notice,
    supportingDocuments: docs(notice.supportingDocuments),
    responseDocuments: docs(notice.responseDocuments),
    currentDesk: currentDeskOf(row.status, application, row.issuedByRoleKey),
    application: { ...applicationSummary(application), site: siteOf(application) },
    outward,
    revocation: revocation ? { ...revocation, statusLabel: REVOCATION_STATUS_LABEL[revocation.status as RevocationStatus] } : null,
    events: events.map((e) => ({ ...e, stageName: e.stageCode ? stageName(e.stageCode) : '' })),
    permissions: {
      respond: isApplicant(user, application) && canRespond(row.status),
      takeUp: takeUp.offered && canTakeUp(row.status),
      decide: decide.offered && canDecide(row.status),
      decideReason: decide.reason || takeUp.reason,
      /** Whether REVOKE_PROCEEDING can follow — the workflow must also offer INITIATE_REVOCATION. */
      canReferForRevocation: initiate.offered,
      demoDocumentAllowed: env.demoMode,
      sequence: offers?.sequence ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The application's Proceedings tab
// ═══════════════════════════════════════════════════════════════════════════

export async function getApplicationProceedings(user: AuthUser, applicationId: string) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const [notices, revocations, outward, offers] = await Promise.all([
    prisma.showCauseNotice.findMany({ where: { applicationId: app.id }, orderBy: { issuedAt: 'desc' } }),
    can(user, CAPABILITIES.REVOCATION_VIEW)
      ? prisma.revocationProceeding.findMany({ where: { applicationId: app.id }, orderBy: { initiatedAt: 'desc' } })
      : [],
    can(user, CAPABILITIES.OUTWARD_VIEW)
      ? prisma.outwardEntry.findMany({
          where: { applicationId: app.id },
          orderBy: { assignedDate: 'desc' },
          select: { id: true, outwardNumber: true, documentType: true, documentReference: true, status: true, assignedDate: true, dispatchDate: true },
        })
      : [],
    workflowOffers(user, app.id).catch(() => null),
  ]);
  const offer = (code: string) => offers?.offer(code) ?? { offered: false, available: false, reason: '' };
  return {
    application: { ...applicationSummary(app), site: siteOf(app) },
    showCauses: notices.map((n) => ({
      id: n.id,
      noticeNumber: n.noticeNumber,
      status: n.status,
      violation: n.violation,
      reason: n.reason,
      issuedAt: n.issuedAt,
      issuedByName: n.issuedByName,
      issuedByRoleKey: n.issuedByRoleKey,
      responseDueDate: n.responseDueDate,
      respondedAt: n.respondedAt,
      decision: n.decision,
      decidedAt: n.decidedAt,
      currentDesk: currentDeskOf(n.status, app, n.issuedByRoleKey),
    })),
    revocations: revocations.map((r) => ({
      id: r.id,
      revocationNumber: r.revocationNumber,
      status: r.status,
      reason: r.reason,
      initiatedByName: r.initiatedByName,
      initiatedAt: r.initiatedAt,
      decidedAt: r.decidedAt,
      revocationOrderNumber: r.revocationOrderNumber,
    })),
    outward,
    permissions: {
      issueShowCause: offer(ACTIONS.ISSUE_SHOW_CAUSE),
      takeUpShowCause: offer(ACTIONS.TAKE_UP_SHOW_CAUSE),
      decideShowCause: offer(ACTIONS.DECIDE_SHOW_CAUSE),
      initiateRevocation: offer(ACTIONS.INITIATE_REVOCATION),
      takeUpRevocation: offer(ACTIONS.TAKE_UP_REVOCATION),
      revoke: offer(ACTIONS.REVOKE_PROCEEDING),
      rejectRevocation: offer(ACTIONS.REJECT_REVOCATION),
      isApplicant: isApplicant(user, app),
      demoDocumentAllowed: env.demoMode,
      sequence: offers?.sequence ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Issue — a workflow transition
// ═══════════════════════════════════════════════════════════════════════════

export async function issueShowCause(
  user: AuthUser,
  applicationId: string,
  input: IssueShowCauseInput & { files?: Upload[] },
  meta: Meta
) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  // Asked before any upload, so a refused caller never writes to storage.
  const { offer } = await workflowOffers(user, app.id);
  const issue = offer(ACTIONS.ISSUE_SHOW_CAUSE);
  if (!issue.offered) throw forbidden('The workflow does not let you issue a show cause notice on this file at its current stage.');
  if (!issue.available) throw conflict(issue.reason || 'A show cause notice cannot be issued on this file right now.');

  const due = new Date(input.responseDueDate.length === 10 ? `${input.responseDueDate}T23:59:59` : input.responseDueDate);
  if (due.getTime() <= Date.now()) {
    throw badRequest('The response due date must be in the future.', [{ path: 'responseDueDate', message: 'Choose a later date.' }]);
  }

  const supportingDocuments = await storeAll(app.id, user.id, input.files ?? [], input.demoDocument);

  return prisma.$transaction(
    (tx) =>
      performActionInTx(tx, user, app.id, ACTIONS.ISSUE_SHOW_CAUSE, {
        remarks: input.reason,
        expectedSequence: input.expectedSequence,
        proceeding: {
          reason: input.reason,
          violation: input.violation,
          responseDueDate: due.toISOString(),
          supportingDocuments,
        },
      }, meta),
    TX_LIMITS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The applicant's response — the notice's own bookkeeping
// ═══════════════════════════════════════════════════════════════════════════

export async function respondShowCause(
  user: AuthUser,
  id: string,
  input: RespondShowCauseInput & { files?: Upload[] },
  meta: Meta
) {
  requireView(user);
  const pre = await requireNotice(user, id);
  if (!isApplicant(user, pre.application)) throw forbidden('Only the applicant on this file answers its show cause notice.');
  assertExpected(pre.status, input.expectedStatus);
  if (!canRespond(pre.status)) {
    throw conflict(
      pre.status === 'ISSUED'
        ? 'This notice has not been dispatched yet. It can be answered once it has been sent.'
        : 'This notice has already been answered.'
    );
  }

  // Stored first: storage writes cannot be rolled back by Postgres.
  const documents = await storeAll(pre.applicationId, user.id, input.files ?? [], input.demoDocument);

  // RESPOND_SHOW_CAUSE is a SYSTEM transition, raised here on the applicant's
  // behalf — they own no desk to perform it from. Authorised above: the file's
  // own applicant, holding SHOW_CAUSE_RESPOND (checked by the route).
  return prisma.$transaction(
    (tx) =>
      performSystemActionInTx(tx, {
        applicationId: pre.applicationId,
        actionCode: ACTIONS.RESPOND_SHOW_CAUSE,
        input: { remarks: '', proceeding: { showCauseId: pre.id, response: input.response, documents } },
        meta,
        onBehalfOf: { id: user.id, name: user.name, roleKey: 'LTP' },
      }),
    TX_LIMITS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Review Show Cause Submission, then Decide — both workflow transitions
// ═══════════════════════════════════════════════════════════════════════════

export async function takeUpShowCause(user: AuthUser, id: string, input: TakeUpShowCauseInput, meta: Meta) {
  requireView(user);
  const pre = await requireNotice(user, id);
  assertExpected(pre.status, input.expectedStatus);
  if (!canTakeUp(pre.status)) throw conflict('Only an answered notice can be taken up for review.');
  return prisma.$transaction(
    (tx) =>
      performActionInTx(
        tx,
        user,
        pre.applicationId,
        ACTIONS.TAKE_UP_SHOW_CAUSE,
        { remarks: input.remarks, proceeding: { showCauseId: pre.id } },
        meta
      ),
    TX_LIMITS
  );
}

/**
 * Decide. REVOKE_PROCEEDING performs a SECOND transition in the same
 * transaction — INITIATE_REVOCATION — so the decision and the proposal it
 * calls for commit together or not at all. If the workflow does not offer
 * INITIATE_REVOCATION here (the file is still in review, say), the engine
 * refuses and the decision is not recorded either.
 */
export async function decideShowCauseNotice(user: AuthUser, id: string, input: DecideShowCauseInput, meta: Meta) {
  requireView(user);
  const pre = await requireNotice(user, id);
  assertExpected(pre.status, input.expectedStatus);
  if (!canDecide(pre.status)) {
    throw conflict('Take the response up for review before deciding it.');
  }

  return prisma.$transaction(async (tx) => {
    const decided = await performActionInTx(
      tx,
      user,
      pre.applicationId,
      ACTIONS.DECIDE_SHOW_CAUSE,
      { remarks: input.remarks, proceeding: { showCauseId: pre.id, decision: input.decision } },
      meta
    );
    if (input.decision !== 'REVOKE_PROCEEDING') return { decided, revocation: null };

    const revocation = await performActionInTx(
      tx,
      user,
      pre.applicationId,
      ACTIONS.INITIATE_REVOCATION,
      {
        remarks: input.remarks,
        proceeding: {
          reason: `Referred by show cause ${pre.noticeNumber}. ${input.remarks}`,
          grounds: input.grounds.filter((g) => g.trim()),
          showCauseId: pre.id,
        },
      },
      meta
    );
    return { decided, revocation };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════════════════════════════════════

const ROLE_TITLE: Record<string, string> = {
  ZJD: 'Zonal Joint Director',
  ZDD: 'Zonal Deputy Director',
  COMMISSIONER: 'Commissioner',
  TPA: 'Town Planning Assistant',
  PLANNING_OFFICER: 'Planning Officer',
};
export const roleTitle = (k: string) => ROLE_TITLE[k] ?? k;

export async function readShowCauseNotice(user: AuthUser, id: string) {
  requireView(user);
  const row = await requireNotice(user, id);
  const outward = await outwardFor(row.id);
  const a = row.application.applicant;
  return renderShowCauseNotice({
    noticeNumber: row.noticeNumber,
    applicationNumber: row.application.applicationNumber,
    orderNumber: row.application.approvalOrder?.orderNumber ?? '',
    recipient: a?.ownerName?.trim() || a?.name?.trim() || 'The applicant',
    address: a?.ownerAddress?.trim() || a?.address?.trim() || '',
    site: siteOf(row.application),
    reason: row.reason,
    violation: row.violation,
    issuedAt: row.issuedAt,
    responseDueDate: row.responseDueDate,
    issuedByName: row.issuedByName,
    issuedByRole: roleTitle(row.issuedByRoleKey),
    outwardNumber: outward?.outwardNumber ?? '',
  });
}

/** One attachment — a stored file, or the labelled placeholder for a demo one. */
export async function readShowCauseAttachment(user: AuthUser, id: string, kind: string, index: number) {
  requireView(user);
  const row = await requireNotice(user, id);
  const list = docs(kind === 'response' ? row.responseDocuments : row.supportingDocuments);
  const doc = list[index];
  if (!doc) throw notFound('That document could not be found.');
  if (doc.fileObjectId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: doc.fileObjectId },
      select: { storageKey: true, mimeType: true, scanStatus: true, originalName: true },
    });
    if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
      return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType, fileName: file.originalName };
    }
    throw conflict(file?.scanStatus === 'PENDING' ? 'The document is still being scanned.' : 'The document is withheld — it did not pass the virus scan.');
  }
  const html = renderDemoAttachment(doc.fileName, `${row.noticeNumber} — ${kind === 'response' ? 'response document' : 'supporting document'}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}
