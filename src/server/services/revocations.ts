import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, type AuthUser } from '@/server/auth/context';
import { conflict, forbidden, notFound } from '@/server/http/errors';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES } from '@/lib/constants';
import { ACTIONS, stageName } from '@/lib/workflow';
import { OPEN_REVOCATION_STATUSES, REVOCATION_STATUS_LABEL, isRevocationStatus, type RevocationStatus } from '@/lib/revocation';
import type { DecideRevocationInput, InitiateRevocationInput, TakeUpRevocationInput } from '@/lib/schemas/proceedings';
import { performActionInTx } from '@/server/workflow/engine';
import { renderRevocationOrder } from '@/server/proceedings/documents';
import { applicationSummary, roleTitle, siteOf, workflowOffers } from './show-cause';

/**
 * THE REVOCATION REGISTER.
 *
 *   Initiate (workflow) → Take up (workflow) → Revoke │ Reject (workflow)
 *
 * Every move is a workflow transition out of CLOSED_APPROVED, performed here
 * with the proposal's particulars. Which roles initiate, review and decide is
 * the transitions' `allowedRoleKeys` — this service only asks the engine what
 * it offers and refuses what it does not.
 *
 * Revoking moves the file to CLOSED_REVOKED (status PROCEEDING_REVOKED) and
 * sends the generated order to Outward. The approval's own history row, the
 * approval date and the approval order are left exactly where they were.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;

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

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.REVOCATION_VIEW)) throw forbidden('Your role does not include revocation proceedings.');
}

const scopeWhere = (user: AuthUser): Prisma.RevocationProceedingWhereInput => ({
  application: { deletedAt: null, ...applicationScope(user) },
});

async function requireRevocation(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That revocation proceeding could not be found.');
  const row = await prisma.revocationProceeding.findFirst({
    where: { id, ...scopeWhere(user) },
    include: {
      application: { select: APPLICATION_SELECT },
      showCause: { select: { id: true, noticeNumber: true, status: true, decision: true } },
    },
  });
  if (!row) throw notFound('That revocation proceeding could not be found.');
  return row;
}

const grounds = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function assertExpected(current: string, expected: string | undefined) {
  if (expected && expected !== current) {
    throw conflict(
      `This proceeding is now ${REVOCATION_STATUS_LABEL[current as RevocationStatus] ?? current}. Reload to see what changed.`,
      'STALE_WRITE'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type RevocationListQuery = { q?: string; status?: string; page?: number; pageSize?: number };

export async function listRevocations(user: AuthUser, query: RevocationListQuery = {}) {
  requireView(user);
  const and: Prisma.RevocationProceedingWhereInput[] = [scopeWhere(user)];
  if (query.status === 'OPEN') and.push({ status: { in: [...OPEN_REVOCATION_STATUSES] } });
  else if (query.status && isRevocationStatus(query.status)) and.push({ status: query.status });
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { revocationNumber: { contains: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
        { application: { applicationNumber: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  const where = { AND: and };
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const [total, rows] = await Promise.all([
    prisma.revocationProceeding.count({ where }),
    prisma.revocationProceeding.findMany({
      where,
      orderBy: { initiatedAt: 'desc' },
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
      revocationNumber: r.revocationNumber,
      status: r.status,
      orderNumber: r.orderNumber,
      reason: r.reason,
      grounds: grounds(r.grounds),
      initiatedByName: r.initiatedByName,
      initiatedByRoleKey: r.initiatedByRoleKey,
      initiatedAt: r.initiatedAt,
      decision: r.decision,
      decidedAt: r.decidedAt,
      revocationOrderNumber: r.revocationOrderNumber,
      application: applicationSummary(r.application),
    })),
  };
}

export async function revocationSummary(user: AuthUser) {
  requireView(user);
  const byStatus = await prisma.revocationProceeding.groupBy({ by: ['status'], where: scopeWhere(user), _count: { _all: true } });
  const s = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<string, number>;
  return {
    total: Object.values(s).reduce((a, b) => a + b, 0),
    proposed: s.PROPOSED ?? 0,
    underReview: s.UNDER_REVIEW ?? 0,
    revoked: s.REVOKED ?? 0,
    rejected: s.REJECTED ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// One proceeding
// ═══════════════════════════════════════════════════════════════════════════

export async function getRevocation(user: AuthUser, id: string) {
  requireView(user);
  const row = await requireRevocation(user, id);
  const [events, outward, approval, offers] = await Promise.all([
    prisma.revocationEvent.findMany({ where: { revocationId: row.id }, orderBy: { occurredAt: 'desc' } }),
    prisma.outwardEntry.findFirst({
      where: { sourceType: 'RevocationProceeding', sourceId: row.id },
      select: { id: true, outwardNumber: true, status: true, mode: true, dispatchDate: true, deliveredAt: true, acknowledgementDate: true },
    }),
    // The approval, as the workflow recorded it. Shown to prove it is still there.
    prisma.workflowHistory.findFirst({
      where: { instance: { applicationId: row.applicationId }, actionCode: ACTIONS.APPROVE },
      orderBy: { sequence: 'desc' },
      select: { sequence: true, actorName: true, actorRoleKey: true, occurredAt: true, remarks: true },
    }),
    workflowOffers(user, row.applicationId).catch(() => null),
  ]);
  const offer = (code: string) => offers?.offer(code) ?? { offered: false, available: false, reason: '' };
  const { application, ...rest } = row;
  return {
    ...rest,
    grounds: grounds(rest.grounds),
    application: { ...applicationSummary(application), site: siteOf(application) },
    outward,
    approval,
    events: events.map((e) => ({ ...e, stageName: e.stageCode ? stageName(e.stageCode) : '' })),
    permissions: {
      takeUp: row.status === 'PROPOSED' && offer(ACTIONS.TAKE_UP_REVOCATION).offered,
      decide: row.status === 'UNDER_REVIEW' && offer(ACTIONS.REVOKE_PROCEEDING).offered,
      sequence: offers?.sequence ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Moves — every one a workflow transition
// ═══════════════════════════════════════════════════════════════════════════

export async function initiateRevocation(user: AuthUser, applicationId: string, input: InitiateRevocationInput, meta: Meta) {
  requireView(user);
  if (!isUuid(applicationId)) throw notFound('That application could not be found.');
  return prisma.$transaction(
    (tx) =>
      performActionInTx(
        tx,
        user,
        applicationId,
        ACTIONS.INITIATE_REVOCATION,
        { remarks: input.reason, proceeding: { reason: input.reason, grounds: input.grounds, showCauseId: input.showCauseId ?? null } },
        meta
      ),
    TX_LIMITS
  );
}

export async function takeUpRevocation(user: AuthUser, id: string, input: TakeUpRevocationInput, meta: Meta) {
  requireView(user);
  const row = await requireRevocation(user, id);
  assertExpected(row.status, input.expectedStatus);
  if (row.status !== 'PROPOSED') throw conflict('Only a proposed revocation can be taken up.');
  return prisma.$transaction(
    (tx) =>
      performActionInTx(tx, user, row.applicationId, ACTIONS.TAKE_UP_REVOCATION, { remarks: input.remarks, proceeding: { revocationId: row.id } }, meta),
    TX_LIMITS
  );
}

export async function decideRevocationProceeding(user: AuthUser, id: string, input: DecideRevocationInput, meta: Meta) {
  requireView(user);
  const row = await requireRevocation(user, id);
  assertExpected(row.status, input.expectedStatus);
  if (row.status !== 'UNDER_REVIEW') throw conflict('Only a revocation under review can be decided.');
  const action = input.decision === 'REVOKED' ? ACTIONS.REVOKE_PROCEEDING : ACTIONS.REJECT_REVOCATION;
  return prisma.$transaction(
    (tx) => performActionInTx(tx, user, row.applicationId, action, { remarks: input.remarks, proceeding: { revocationId: row.id } }, meta),
    TX_LIMITS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The order
// ═══════════════════════════════════════════════════════════════════════════

export async function readRevocationOrder(user: AuthUser, id: string) {
  requireView(user);
  const row = await requireRevocation(user, id);
  if (row.status !== 'REVOKED' || !row.revocationOrderNumber) throw notFound('No revocation order has been generated for this proceeding.');
  const outward = await prisma.outwardEntry.findFirst({
    where: { sourceType: 'RevocationProceeding', sourceId: row.id },
    select: { outwardNumber: true },
  });
  const a = row.application.applicant;
  return renderRevocationOrder({
    revocationOrderNumber: row.revocationOrderNumber,
    revocationNumber: row.revocationNumber,
    applicationNumber: row.application.applicationNumber,
    orderNumber: row.orderNumber,
    approvedAt: row.application.approvedAt,
    recipient: a?.ownerName?.trim() || a?.name?.trim() || 'The applicant',
    address: a?.ownerAddress?.trim() || a?.address?.trim() || '',
    site: siteOf(row.application),
    reason: row.reason,
    grounds: grounds(row.grounds),
    showCauseNumber: row.showCause?.noticeNumber ?? '',
    decisionRemarks: row.decisionRemarks,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedByName,
    decidedByRole: roleTitle(row.decidedByRoleKey),
    outwardNumber: outward?.outwardNumber ?? '',
  });
}
