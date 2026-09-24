import 'server-only';
import type { Prisma, ShortfallStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import type { AuthUser } from '@/server/auth/context';
import { BUCKETS, SHORTFALL as SHORTFALL_STATUSES } from '@/lib/application-buckets';
import { CLOSED_SHORTFALL_STATUSES, TERMINAL_STATUSES } from '@/lib/constants';

/**
 * The closed set, as enum members.
 *
 * `src/lib/constants.ts` states these as plain strings on purpose — it is
 * isomorphic and must not pull `@prisma/client` into a client bundle. This is
 * the one place the cast happens, on the server, rather than at each of the
 * five call sites below.
 */
const CLOSED = [...CLOSED_SHORTFALL_STATUSES] as ShortfallStatus[];
import { STAGE_LABELS, deskForStageCode } from '@/lib/workflow';
import { memoizeAsync } from '@/server/cache/memoize';
import { OUTSTANDING_NOC_STATUSES } from '@/lib/noc';

/**
 * EVERY NUMBER ON EVERY DASHBOARD COMES FROM HERE.
 *
 * That is the entire point of the module. A dashboard tile reading 70 and an
 * application register listing 68 is not a cosmetic inconsistency — it is the
 * moment a user stops believing any figure on the screen, and from then on
 * they go and count by hand. The only durable fix is that there is exactly one
 * implementation of "how many applications are there", and every screen calls
 * it.
 *
 * Three rules hold throughout:
 *
 *   1. EVERY query is scoped through `applicationScope(user)`, merged into the
 *      WHERE clause rather than filtered afterwards. An LTP's "total" counts
 *      their own files; a zonal officer's counts their jurisdiction; a
 *      Commissioner's counts the city. Nobody gets a total that includes rows
 *      they may not open.
 *
 *   2. NOTHING is cached, denormalised or hand-maintained. `openShortfalls` on
 *      the application row is a cache the engine maintains, and this module
 *      deliberately does NOT read it for the shortfall figures — it counts the
 *      shortfall rows, because that is the number that must be right.
 *
 *   3. Money is summed from SETTLED payments only. "Collected" means the money
 *      arrived; an initiated payment is not revenue.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shared scope fragments
// ═══════════════════════════════════════════════════════════════════════════

const liveApplications = (user: AuthUser): Prisma.ApplicationWhereInput => ({
  deletedAt: null,
  ...applicationScope(user),
});

/** The same scope, expressed for a table that hangs off an application. */
const throughApplication = (user: AuthUser) => ({ application: liveApplications(user) });

const OPEN_SHORTFALL_STATUSES = [
  'RAISED',
  'NOTIFIED',
  'ACTION_REQUIRED',
  'RESOLUTION_SUBMITTED',
  'UNDER_REVIEW',
  'RESOLUTION_REJECTED',
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// Applications
// ═══════════════════════════════════════════════════════════════════════════

export type ApplicationOverview = {
  total: number;
  byStatus: Record<string, number>;
  /** The KPI vocabulary — the same definitions the register filters by. */
  byBucket: Record<string, number>;
  byStage: Array<{ code: string; label: string; count: number }>;
  byType: Array<{ id: string; code: string; name: string; count: number }>;
  byZone: Array<{ id: string; code: string; name: string; count: number }>;
  draft: number;
  inProgress: number;
  approved: number;
  rejected: number;
  closed: number;
};

export async function applicationOverview(user: AuthUser): Promise<ApplicationOverview> {
  const where = liveApplications(user);

  const [grouped, byStageRows, byTypeRows, byZoneRows, types, zones] = await Promise.all([
    prisma.application.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['currentStageCode'], where, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['applicationTypeId'], where, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['zoneId'], where, _count: { _all: true } }),
    prisma.applicationType.findMany({ select: { id: true, code: true, name: true } }),
    prisma.zone.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
    total += row._count._all;
  }

  // Buckets are read from the shared definitions rather than re-listed here,
  // so a tile and the list it links to cannot drift apart.
  const byBucket: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    byBucket[bucket.key] = bucket.statuses.length
      ? bucket.statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0)
      : total;
  }

  const typeById = new Map(types.map((t) => [t.id, t]));
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const terminal = new Set<string>(TERMINAL_STATUSES);
  const closed = Object.entries(byStatus)
    .filter(([status]) => terminal.has(status))
    .reduce((sum, [, count]) => sum + count, 0);

  const draft = byStatus.DRAFT ?? 0;

  return {
    total,
    byStatus,
    byBucket,
    byStage: byStageRows
      .filter((row) => row.currentStageCode)
      .map((row) => ({
        code: row.currentStageCode!,
        label: STAGE_LABELS[row.currentStageCode!] ?? row.currentStageCode!,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    byType: byTypeRows
      .map((row) => ({
        id: row.applicationTypeId,
        code: typeById.get(row.applicationTypeId)?.code ?? '—',
        name: typeById.get(row.applicationTypeId)?.name ?? 'Unknown type',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    byZone: byZoneRows
      .filter((row) => row.zoneId)
      .map((row) => ({
        id: row.zoneId!,
        code: zoneById.get(row.zoneId!)?.code ?? '—',
        name: zoneById.get(row.zoneId!)?.name ?? 'Unknown zone',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    draft,
    // Everything that is neither a draft nor closed is live work.
    inProgress: total - draft - closed,
    approved: byStatus.APPROVED ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    closed,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Money
// ═══════════════════════════════════════════════════════════════════════════

export type FinanceSummary = {
  /** Every demand that has actually been issued. DRAFT demands are not money. */
  demandsIssued: number;
  generated: number;
  collected: number;
  outstanding: number;
  byDemandStatus: Record<string, number>;
  payments: {
    total: number;
    successful: number;
    failed: number;
    pending: number;
    cancelled: number;
    /** Settled attempts as a share of attempts that reached a verdict. */
    successRate: number;
  };
  receipts: number;
  /** Demands raised by a fee shortfall rather than by the schedule. */
  shortfallDemands: number;
};

const toNumber = (value: Prisma.Decimal | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

export async function financeSummary(user: AuthUser): Promise<FinanceSummary> {
  const feeWhere: Prisma.ApplicationFeeWhereInput = {
    ...throughApplication(user),
    // A cancelled demand is not owed and was never collected.
    status: { not: 'CANCELLED' },
  };

  const [demandAgg, demandGroups, paymentGroups, collectedAgg, receipts, shortfallDemands] =
    await Promise.all([
      prisma.applicationFee.aggregate({
        where: feeWhere,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      prisma.applicationFee.groupBy({
        by: ['status'],
        where: throughApplication(user),
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ['status'],
        where: throughApplication(user),
        _count: { _all: true },
      }),
      // The single source of truth for "collected": money on payments the
      // gateway actually settled. Never the demand's `paidAmount`, which is a
      // derived convenience column.
      prisma.payment.aggregate({
        where: { ...throughApplication(user), status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      prisma.paymentReceipt.count({ where: { payment: throughApplication(user) } }),
      prisma.applicationFee.count({
        where: { ...throughApplication(user), raisedByShortfallId: { not: null } },
      }),
    ]);

  const byDemandStatus: Record<string, number> = {};
  for (const row of demandGroups) byDemandStatus[row.status] = row._count._all;

  const byPaymentStatus: Record<string, number> = {};
  for (const row of paymentGroups) byPaymentStatus[row.status] = row._count._all;

  const generated = toNumber(demandAgg._sum.totalAmount);
  const collected = toNumber(collectedAgg._sum.amount);

  const successful = byPaymentStatus.SUCCESS ?? 0;
  const failed = byPaymentStatus.FAILED ?? 0;
  const cancelled = (byPaymentStatus.CANCELLED ?? 0) + (byPaymentStatus.TIMEOUT ?? 0);
  const pending =
    (byPaymentStatus.INITIATED ?? 0) +
    (byPaymentStatus.PENDING ?? 0) +
    (byPaymentStatus.PROCESSING ?? 0);

  // Attempts still in flight have not succeeded or failed yet, so counting
  // them in the denominator would make the rate drop simply because somebody
  // opened a payment window a minute ago.
  const decided = successful + failed + cancelled;

  return {
    demandsIssued: demandAgg._count._all,
    generated,
    collected,
    // What is genuinely still owed on live demands, floored at zero: an
    // overpayment is a refund question, not a negative receivable.
    outstanding: Math.max(0, Math.round((generated - toNumber(demandAgg._sum.paidAmount)) * 100) / 100),
    byDemandStatus,
    payments: {
      total: Object.values(byPaymentStatus).reduce((a, b) => a + b, 0),
      successful,
      failed,
      pending,
      cancelled,
      successRate: decided ? Math.round((successful / decided) * 1000) / 10 : 0,
    },
    receipts,
    shortfallDemands,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scrutiny
// ═══════════════════════════════════════════════════════════════════════════

export type ScrutinySummary = {
  runs: number;
  passed: number;
  failed: number;
  running: number;
  errored: number;
  /** Applications currently sitting on a failed result. */
  awaitingCorrection: number;
  issues: { critical: number; major: number; minor: number; info: number };
};

export async function scrutinySummary(user: AuthUser): Promise<ScrutinySummary> {
  const throughDrawing = {
    drawingVersion: { drawing: { application: liveApplications(user) } },
  } satisfies Prisma.ScrutinyRequestWhereInput;

  const [statusGroups, outcomeGroups, awaitingCorrection, issueAgg] = await Promise.all([
    prisma.scrutinyRequest.groupBy({
      by: ['status'],
      where: throughDrawing,
      _count: { _all: true },
    }),
    prisma.scrutinyResult.groupBy({
      by: ['outcome'],
      where: { request: throughDrawing },
      _count: { _all: true },
    }),
    prisma.application.count({
      where: { ...liveApplications(user), status: 'SCRUTINY_FAILED' },
    }),
    prisma.scrutinyResult.aggregate({
      where: { request: throughDrawing },
      _sum: { criticalCount: true, majorCount: true, minorCount: true, infoCount: true },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusGroups) byStatus[row.status] = row._count._all;

  const byOutcome: Record<string, number> = {};
  for (const row of outcomeGroups) byOutcome[row.outcome] = row._count._all;

  return {
    runs: Object.values(byStatus).reduce((a, b) => a + b, 0),
    passed: byOutcome.PASS ?? 0,
    failed: byOutcome.FAIL ?? 0,
    running: (byStatus.QUEUED ?? 0) + (byStatus.RUNNING ?? 0),
    errored: byStatus.ERRORED ?? 0,
    awaitingCorrection,
    issues: {
      critical: issueAgg._sum.criticalCount ?? 0,
      major: issueAgg._sum.majorCount ?? 0,
      minor: issueAgg._sum.minorCount ?? 0,
      info: issueAgg._sum.infoCount ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════════════════════════════════════

export type DocumentSummary = {
  uploaded: number;
  verified: number;
  rejected: number;
  awaitingVerification: number;
  applicationsPending: number;
  applicationsComplete: number;
};

export async function documentSummary(user: AuthUser): Promise<DocumentSummary> {
  const where = throughApplication(user);

  const [groups, pending, complete] = await Promise.all([
    prisma.applicationDocument.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.application.count({
      where: { ...liveApplications(user), status: 'DOCUMENT_UPLOAD_PENDING' },
    }),
    prisma.application.count({
      where: { ...liveApplications(user), status: 'DOCUMENTS_COMPLETED' },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of groups) byStatus[row.status] = row._count._all;

  return {
    uploaded: byStatus.UPLOADED ?? 0,
    verified: byStatus.VERIFIED ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    awaitingVerification: byStatus.UNDER_VERIFICATION ?? 0,
    applicationsPending: pending,
    applicationsComplete: complete,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shortfalls
// ═══════════════════════════════════════════════════════════════════════════

export type ShortfallSummary = {
  total: number;
  open: number;
  resolved: number;
  cancelled: number;
  byKind: Record<string, number>;
  byMode: { blocking: number; reported: number };
  /** Open shortfalls at each desk that raised one. */
  byStage: Array<{ code: string; label: string; count: number }>;
  awaitingReview: number;
  /** Raised but never announced — the failure that looks exactly like silence. */
  neverNotified: number;
  overdue: number;
};

export async function shortfallSummary(user: AuthUser): Promise<ShortfallSummary> {
  const where = throughApplication(user);
  const openWhere: Prisma.ShortfallWhereInput = {
    ...where,
    status: { notIn: CLOSED },
  };

  const [statusGroups, kindGroups, modeGroups, stageGroups, overdue] =
    await Promise.all([
      prisma.shortfall.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.shortfall.groupBy({ by: ['kind'], where: openWhere, _count: { _all: true } }),
      prisma.shortfall.groupBy({ by: ['mode'], where: openWhere, _count: { _all: true } }),
      prisma.shortfall.groupBy({
        by: ['raisedAtStageCode'],
        where: openWhere,
        _count: { _all: true },
      }),
      prisma.shortfall.count({
        where: {
          ...where,
          status: { notIn: CLOSED },
          dueDate: { not: null, lt: new Date() },
        },
      }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusGroups) byStatus[row.status] = row._count._all;

  const awaitingReview = (byStatus.RESOLUTION_SUBMITTED ?? 0) + (byStatus.UNDER_REVIEW ?? 0);
  const neverNotified = byStatus.RAISED ?? 0;

  const byKind: Record<string, number> = {};
  for (const row of kindGroups) byKind[row.kind] = row._count._all;

  const byMode: Record<string, number> = {};
  for (const row of modeGroups) byMode[row.mode] = row._count._all;

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const resolved = byStatus.RESOLVED ?? 0;
  const cancelled = byStatus.CANCELLED ?? 0;

  return {
    total,
    open: total - resolved - cancelled,
    resolved,
    cancelled,
    byKind,
    byMode: { blocking: byMode.BLOCKING ?? 0, reported: byMode.REPORTED ?? 0 },
    byStage: stageGroups
      .map((row) => ({
        code: row.raisedAtStageCode,
        label: STAGE_LABELS[row.raisedAtStageCode] ?? row.raisedAtStageCode,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    awaitingReview,
    neverNotified,
    overdue,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Service standards
// ═══════════════════════════════════════════════════════════════════════════

export type SlaSummary = {
  onTrack: number;
  dueSoon: number;
  overdue: number;
  paused: number;
  /** Applications whose own denormalised clock says OVERDUE. */
  applicationsOverdue: number;
  /** Mean days a closed file took, filing to decision. Null with no closures. */
  averageDaysToClose: number | null;
};

export async function slaSummary(user: AuthUser): Promise<SlaSummary> {
  const taskScoped = {
    task: { instance: { application: liveApplications(user) } },
  } satisfies Prisma.SlaInstanceWhereInput;

  // Compute averageDaysToClose in SQL instead of loading all closed applications
  // into memory. The previous implementation did findMany on every closed file.
  const [groups, applicationsOverdue, avgResult] = await Promise.all([
    prisma.slaInstance.groupBy({
      by: ['status'],
      where: { ...taskScoped, completedAt: null },
      _count: { _all: true },
    }),
    prisma.application.count({ where: { ...liveApplications(user), slaStatus: 'OVERDUE' } }),
    prisma.$queryRaw<Array<{ avg_days: number | null }>>`
      SELECT ROUND(AVG(
        EXTRACT(EPOCH FROM (COALESCE("approvedAt", "rejectedAt") - "submittedAt")) / 86400.0
      )::numeric, 1) as avg_days
      FROM "applications"
      WHERE "deletedAt" IS NULL
        AND "status" IN ('APPROVED', 'REJECTED')
        AND "submittedAt" IS NOT NULL
        AND COALESCE("approvedAt", "rejectedAt") IS NOT NULL
    `,
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of groups) byStatus[row.status] = row._count._all;

  return {
    onTrack: byStatus.ON_TRACK ?? 0,
    dueSoon: byStatus.DUE_SOON ?? 0,
    overdue: byStatus.OVERDUE ?? 0,
    paused: byStatus.PAUSED ?? 0,
    applicationsOverdue,
    averageDaysToClose: avgResult[0]?.avg_days != null
      ? Number(avgResult[0]!.avg_days)
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Trend
// ═══════════════════════════════════════════════════════════════════════════

export type TrendPoint = {
  /** ISO date of the bucket's first day. */
  period: string;
  label: string;
  created: number;
  submitted: number;
  approved: number;
  rejected: number;
};

/**
 * Volume over the last `months` calendar months.
 *
 * Bucketed in SQL rather than in JavaScript because the alternative is loading
 * every application row to count them — which works at seventy and does not at
 * seventy thousand. The scope fragment is applied by counting ids the scoped
 * query already returned, so the aggregate cannot see further than the caller.
 */
export async function applicationTrend(user: AuthUser, months = 9): Promise<TrendPoint[]> {
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  from.setMonth(from.getMonth() - (months - 1));

  // Use SQL aggregation instead of loading all rows into memory.
  // The previous implementation loaded every application from the last N months
  // then counted them in JavaScript — which works at 70 and does not at 7000.
  const [created, submitted, approved, rejected] = await Promise.all([
    prisma.$queryRaw<Array<{ period: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM-DD') as period, COUNT(*) as count
      FROM "applications" WHERE "deletedAt" IS NULL AND "createdAt" >= ${from}
      GROUP BY DATE_TRUNC('month', "createdAt") ORDER BY period`,
    prisma.$queryRaw<Array<{ period: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('month', "submittedAt"), 'YYYY-MM-DD') as period, COUNT(*) as count
      FROM "applications" WHERE "deletedAt" IS NULL AND "submittedAt" >= ${from}
      GROUP BY DATE_TRUNC('month', "submittedAt") ORDER BY period`,
    prisma.$queryRaw<Array<{ period: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('month', "approvedAt"), 'YYYY-MM-DD') as period, COUNT(*) as count
      FROM "applications" WHERE "deletedAt" IS NULL AND "approvedAt" >= ${from}
      GROUP BY DATE_TRUNC('month', "approvedAt") ORDER BY period`,
    prisma.$queryRaw<Array<{ period: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('month', "rejectedAt"), 'YYYY-MM-DD') as period, COUNT(*) as count
      FROM "applications" WHERE "deletedAt" IS NULL AND "rejectedAt" >= ${from}
      GROUP BY DATE_TRUNC('month', "rejectedAt") ORDER BY period`,
  ]);

  const toMap = (rows: Array<{ period: string; count: bigint }>) =>
    new Map(rows.map((r) => [r.period, Number(r.count)]));
  const createdMap = toMap(created);
  const submittedMap = toMap(submitted);
  const approvedMap = toMap(approved);
  const rejectedMap = toMap(rejected);

  const result: TrendPoint[] = [];
  for (let i = 0; i < months; i += 1) {
    const date = new Date(from);
    date.setMonth(from.getMonth() + i);
    const key = monthKey(date);
    result.push({
      period: key,
      label: date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      created: createdMap.get(key) ?? 0,
      submitted: submittedMap.get(key) ?? 0,
      approved: approvedMap.get(key) ?? 0,
      rejected: rejectedMap.get(key) ?? 0,
    });
  }

  return result;
}

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

// ═══════════════════════════════════════════════════════════════════════════
// Activity
// ═══════════════════════════════════════════════════════════════════════════

export type ActivityEntry = {
  id: string;
  applicationId: string;
  applicationNumber: string;
  type: string;
  title: string;
  description: string;
  actorName: string;
  actorRoleKey: string;
  occurredAt: string;
};

/** The most recent things that happened, within the caller's scope. */
export async function recentActivity(user: AuthUser, limit = 12): Promise<ActivityEntry[]> {
  const rows = await prisma.applicationEvent.findMany({
    where: throughApplication(user),
    select: {
      id: true,
      applicationId: true,
      type: true,
      title: true,
      description: true,
      actorName: true,
      actorRoleKey: true,
      occurredAt: true,
      application: { select: { applicationNumber: true } },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    applicationId: row.applicationId,
    applicationNumber: row.application.applicationNumber,
    type: row.type,
    title: row.title,
    description: row.description,
    actorName: row.actorName || 'System',
    actorRoleKey: row.actorRoleKey,
    occurredAt: row.occurredAt.toISOString(),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Workload
// ═══════════════════════════════════════════════════════════════════════════

export type WorkloadRow = {
  userId: string | null;
  name: string;
  roleKey: string;
  open: number;
  overdue: number;
};

/**
 * Who is holding what. Unclaimed work is reported as a row of its own rather
 * than hidden, because "nobody has picked these up" is the single most useful
 * thing a supervisor can learn from this table.
 */
export async function workload(user: AuthUser): Promise<WorkloadRow[]> {
  const tasks = await prisma.workflowTask.findMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      instance: { application: liveApplications(user) },
    },
    select: {
      assignedRoleKey: true,
      assignedUserId: true,
      assignee: { select: { name: true } },
      sla: { select: { status: true } },
    },
  });

  const rows = new Map<string, WorkloadRow>();

  for (const task of tasks) {
    const key = task.assignedUserId ?? `unclaimed:${task.assignedRoleKey}`;
    const existing =
      rows.get(key) ??
      ({
        userId: task.assignedUserId,
        name: task.assignee?.name ?? `Unclaimed — ${task.assignedRoleKey}`,
        roleKey: task.assignedRoleKey,
        open: 0,
        overdue: 0,
      } satisfies WorkloadRow);

    existing.open += 1;
    if (task.sla?.status === 'OVERDUE') existing.overdue += 1;
    rows.set(key, existing);
  }

  return [...rows.values()].sort((a, b) => b.open - a.open);
}

// ═══════════════════════════════════════════════════════════════════════════
// The whole picture
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approvals, permission orders and the notification backlog.
 *
 * ── Every figure here is a live count, and several are deliberately blunt ──
 *
 * `approvalPending` counts files sitting at a desk that can actually approve
 * them — read from the workflow configuration, not from a list of stage codes,
 * so a chain that gains an approving desk is counted without anybody editing
 * this file.
 *
 * `notificationsPending` counts OUTBOX rows the dispatcher has not processed.
 * That is the number that means something operationally: a backlog here means
 * people have not been told things the system has already decided, which is
 * the failure the transactional outbox exists to make visible. It is NOT the
 * count of unread in-app notifications, which measures whether users read
 * their inbox and is nobody's problem to fix.
 */
export type ApprovalSummary = {
  /** Files at a desk that can approve them, waiting for a decision. */
  approvalPending: number;
  /** Permission orders released to applicants. */
  ordersIssued: number;
  /** Drafted or generated, not yet issued — work waiting at the signing desk. */
  ordersPending: number;
  /** Orders that were issued and later revoked. */
  ordersRevoked: number;
  /** Undispatched outbox rows: people who have not been told yet. */
  notificationsPending: number;
  /** Outbox rows the dispatcher gave up on. Always worth showing. */
  notificationsFailed: number;
};

export async function approvalSummary(user: AuthUser): Promise<ApprovalSummary> {
  const scope = liveApplications(user);

  const [orderGroups, revoked, approvalPending, outbox] = await Promise.all([
    prisma.approvalOrder.groupBy({
      by: ['status'],
      where: { application: scope },
      _count: { _all: true },
    }),
    prisma.approvalOrder.count({ where: { application: scope, revokedAt: { not: null } } }),
    // "At a desk that can approve" — asked of the transition table rather than
    // asserted about a stage code. `WorkflowInstance` carries the stage as a
    // plain id with no relation, so the set of approving stages is resolved
    // first and matched by id.
    approvingStageIds(user).then((stageIds) =>
      stageIds.length === 0
        ? 0
        : prisma.application.count({
            where: {
              ...scope,
              status: { notIn: ['APPROVED', 'REJECTED', 'DRAFT'] },
              workflowInstance: { status: 'ACTIVE', currentStageId: { in: stageIds } },
            },
          })
    ),
    // The outbox has no status column: `processed` is the flag, and a row that
    // has been tried and is still unprocessed carries the error that stopped
    // it. Pending and failed are therefore both subsets of unprocessed, and
    // failed is the subset somebody has to do something about.
    Promise.all([
      prisma.outboxEvent.count({ where: { processed: false } }),
      prisma.outboxEvent.count({ where: { processed: false, attempts: { gte: 1 } } }),
    ]),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of orderGroups) byStatus[row.status] = row._count._all;

  const [pending, failed] = outbox;

  return {
    approvalPending,
    ordersIssued: byStatus.ISSUED ?? 0,
    ordersPending:
      (byStatus.DRAFT ?? 0) + (byStatus.PREVIEW ?? 0) + (byStatus.GENERATED ?? 0) + (byStatus.APPROVED ?? 0),
    ordersRevoked: revoked,
    notificationsPending: pending,
    notificationsFailed: failed,
  };
}

/**
 * Stages an APPROVE transition actually leaves, in the workflows in use.
 *
 * Read from configuration so the count follows a chain that is edited rather
 * than a list of stage codes somebody has to remember to update. Memoised for
 * a minute because it changes only when an administrator republishes a
 * workflow, and it is asked on every dashboard render.
 */
async function approvingStageIds(_user: AuthUser): Promise<string[]> {
  return memoizeAsync('analytics:approving-stages', 60, async () => {
    const rows = await prisma.workflowTransition.findMany({
      where: { isActive: true, action: { code: 'APPROVE' } },
      select: { fromStageId: true },
      distinct: ['fromStageId'],
    });
    return rows.map((r) => r.fromStageId);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOCs
// ═══════════════════════════════════════════════════════════════════════════

export type NocDashboardSummary = {
  total: number;
  /** Not yet verified and not ruled out — src/lib/noc.ts OUTSTANDING_NOC_STATUSES. */
  pending: number;
  /** RECEIVED: the certificate is in, the desk has not verified it. */
  awaitingVerification: number;
  verified: number;
};

export async function nocDashboardSummary(user: AuthUser): Promise<NocDashboardSummary> {
  const groups = await prisma.applicationNoc.groupBy({
    by: ['status'],
    where: throughApplication(user),
    _count: { _all: true },
  });
  const by: Record<string, number> = {};
  for (const g of groups) by[g.status] = g._count._all;
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return {
    total,
    pending: OUTSTANDING_NOC_STATUSES.reduce((sum, s) => sum + (by[s] ?? 0), 0),
    awaitingVerification: by.RECEIVED ?? 0,
    verified: by.VERIFIED ?? 0,
  };
}

export type DashboardData = {
  applications: ApplicationOverview;
  finance: FinanceSummary;
  scrutiny: ScrutinySummary;
  documents: DocumentSummary;
  shortfalls: ShortfallSummary;
  sla: SlaSummary;
  approvals: ApprovalSummary;
  trend: TrendPoint[];
  activity: ActivityEntry[];
  workload: WorkloadRow[];
  nocs: NocDashboardSummary;
};

/** One round trip's worth of parallel queries, for the executive dashboards. */
export async function dashboardData(user: AuthUser, options: { months?: number } = {}): Promise<DashboardData> {
  return memoizeAsync(`analytics:dashboard:${user.id}:${user.roleKeys.join(',')}:${options.months ?? 9}`, 60, async () => {
    const [applications, finance, scrutiny, documents, shortfalls, sla, approvals, trend, activity, load, nocs] =
      await Promise.all([
        applicationOverview(user),
        financeSummary(user),
        scrutinySummary(user),
        documentSummary(user),
        shortfallSummary(user),
        slaSummary(user),
        approvalSummary(user),
        applicationTrend(user, options.months ?? 9),
        recentActivity(user, 12),
        workload(user),
        nocDashboardSummary(user),
      ]);

    return {
      applications,
      finance,
      scrutiny,
      documents,
      shortfalls,
      sla,
      approvals,
      trend,
      activity,
      workload: load,
      nocs,
    };
  });
}

export { OPEN_SHORTFALL_STATUSES };

// ═══════════════════════════════════════════════════════════════════════════
// Consolidation — every desk and every login, in one place
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WHAT EACH ROLE WOULD SEE, GATHERED FOR SOMEBODY WHO SEES EVERYTHING.
 *
 * The seven review dashboards each answer "what is on MY desk". An
 * administrator's question is the union of those: which desks are loaded,
 * which are idle, where work is unclaimed, and which desk is holding the files
 * that are late. Answering it by signing in as seven different officers is how
 * that question stops being asked.
 *
 * Every figure here is the SAME query the desk's own dashboard runs, grouped
 * by stage instead of filtered to one — so a TPA reading "6 at your desk" and
 * an administrator reading "TPA · 6" are reading one number, not two that
 * happen to agree today.
 */
export type DeskRow = {
  stageCode: string;
  label: string;
  sequence: number;
  roleKeys: string[];
  /** Active accounts that may work this desk. Zero is worth seeing. */
  officers: number;
  /** Applications whose current stage is this one. */
  applications: number;
  openTasks: number;
  unclaimed: number;
  claimed: number;
  dueSoon: number;
  overdue: number;
  /** Open shortfalls raised AT this desk, wherever the file is now. */
  openShortfalls: number;
  /** Mean whole days the open tasks here have been waiting. */
  averageDaysWaiting: number | null;
  isTerminal: boolean;
};

export async function deskConsolidation(user: AuthUser): Promise<DeskRow[]> {
  const scoped = liveApplications(user);

  const [workflow, byStage, tasks, shortfalls, roleCounts] = await Promise.all([
    // The desks of the workflow new applications actually run through. There
    // is more than one published workflow now — BBAS_STANDARD is the default
    // and BP_STANDARD is retained as an option — so "any published one" would
    // have picked a chain at random and drawn the wrong desks.
    prisma.workflow.findFirst({
      where: { isPublished: true, applicationTypes: { some: { deletedAt: null } } },
      orderBy: { version: 'desc' },
      select: {
        stages: {
          where: { isActive: true },
          orderBy: { sequence: 'asc' },
          select: {
            code: true,
            name: true,
            sequence: true,
            ownerRoleKeys: true,
            isTerminal: true,
          },
        },
      },
    }),

    prisma.application.groupBy({
      by: ['currentStageCode'],
      where: scoped,
      _count: { _all: true },
    }),

    // The open task queue, exactly as `taskScope` would hand it to an officer
    // — minus the per-role narrowing, because that is the whole point here.
    prisma.workflowTask.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        instance: { application: scoped },
      },
      select: {
        assignedUserId: true,
        receivedAt: true,
        stage: { select: { code: true } },
        sla: { select: { status: true } },
      },
    }),

    prisma.shortfall.groupBy({
      by: ['raisedAtStageCode'],
      where: { ...throughApplication(user), status: { notIn: CLOSED } },
      _count: { _all: true },
    }),

    prisma.role.findMany({
      select: {
        key: true,
        _count: { select: { users: { where: { user: { status: 'ACTIVE', deletedAt: null } } } } },
      },
    }),
  ]);

  const applicationsAt = new Map(
    byStage.filter((r) => r.currentStageCode).map((r) => [r.currentStageCode!, r._count._all])
  );
  // A shortfall raised at a BP_STANDARD desk is still open work, and its file
  // now waits at a BBAS desk. `raisedAtStageCode` is history and stays as it
  // is; this only decides which row of the panel counts it. Without the
  // forwarding, five open shortfalls raised at the old Director and
  // Commissioner desks were attributed to no desk at all and vanished from the
  // panel while still blocking their applications' approval.
  const deskCodes = new Set((workflow?.stages ?? []).map((s) => s.code));
  const shortfallsAt = new Map<string, number>();
  for (const row of shortfalls) {
    const desk = deskForStageCode(row.raisedAtStageCode, deskCodes);
    shortfallsAt.set(desk, (shortfallsAt.get(desk) ?? 0) + row._count._all);
  }
  const activeByRole = new Map(roleCounts.map((r) => [r.key, r._count.users]));

  const now = Date.now();

  return (workflow?.stages ?? []).map((stage) => {
    const here = tasks.filter((t) => t.stage.code === stage.code);
    const waiting = here.map((t) => Math.floor((now - t.receivedAt.getTime()) / 86_400_000));

    return {
      stageCode: stage.code,
      label: STAGE_LABELS[stage.code] ?? stage.name,
      sequence: stage.sequence,
      roleKeys: Array.isArray(stage.ownerRoleKeys) ? (stage.ownerRoleKeys as string[]) : [],
      // A desk owned by two roles (ZAD and ZDD share one) counts the holders
      // of either, without double-counting a person who holds both.
      officers: (Array.isArray(stage.ownerRoleKeys) ? (stage.ownerRoleKeys as string[]) : []).reduce((sum, key) => sum + (activeByRole.get(key) ?? 0), 0),
      applications: applicationsAt.get(stage.code) ?? 0,
      openTasks: here.length,
      unclaimed: here.filter((t) => !t.assignedUserId).length,
      claimed: here.filter((t) => t.assignedUserId).length,
      dueSoon: here.filter((t) => t.sla?.status === 'DUE_SOON').length,
      overdue: here.filter((t) => t.sla?.status === 'OVERDUE').length,
      openShortfalls: shortfallsAt.get(stage.code) ?? 0,
      averageDaysWaiting: waiting.length
        ? Math.round((waiting.reduce((a, b) => a + b, 0) / waiting.length) * 10) / 10
        : null,
      isTerminal: stage.isTerminal,
    };
  });
}

/**
 * The applicant side, aggregated across every LTP.
 *
 * This is the LTP dashboard's own vocabulary — the same buckets, counted over
 * everybody's files rather than one person's. It is the half of the system an
 * officer never sees, and the half where most files actually are.
 */
export type ApplicantSideSummary = {
  drafts: number;
  awaitingDrawing: number;
  inScrutiny: number;
  scrutinyFailed: number;
  documentsPending: number;
  awaitingPayment: number;
  paymentFailed: number;
  /** Parked with the applicant on a shortfall. */
  withApplicant: number;
  /** Answered, waiting for an officer's verdict. */
  responded: number;
  totalWithApplicant: number;
};

export async function applicantSideSummary(user: AuthUser): Promise<ApplicantSideSummary> {
  const grouped = await prisma.application.groupBy({
    by: ['status'],
    where: liveApplications(user),
    _count: { _all: true },
  });

  const n = (...statuses: string[]) =>
    statuses.reduce(
      (sum, status) => sum + (grouped.find((g) => g.status === status)?._count._all ?? 0),
      0
    );

  const summary = {
    drafts: n('DRAFT'),
    awaitingDrawing: n('SUBMITTED'),
    inScrutiny: n('DRAWING_UPLOADED', 'SCRUTINY_IN_PROGRESS'),
    scrutinyFailed: n('SCRUTINY_FAILED'),
    documentsPending: n('SCRUTINY_PASSED', 'DOCUMENT_UPLOAD_PENDING'),
    awaitingPayment: n('DOCUMENTS_COMPLETED', 'FEE_GENERATED', 'PAYMENT_PENDING'),
    paymentFailed: n('PAYMENT_FAILED'),
    // Read from the shared bucket rather than re-listed here. This used to be
    // its own copy of the same statuses and drifted the moment a desk was
    // added: three files parked at the new ZDD desk fell out of the partition
    // entirely, and the dashboard's headline strip stopped adding up to the
    // register. One list, one place.
    withApplicant: n(...SHORTFALL_STATUSES),
    responded: n('SHORTFALL_RESPONDED'),
  };

  return {
    ...summary,
    totalWithApplicant:
      summary.drafts +
      summary.awaitingDrawing +
      summary.inScrutiny +
      summary.scrutinyFailed +
      summary.documentsPending +
      summary.awaitingPayment +
      summary.paymentFailed +
      summary.withApplicant,
  };
}

/**
 * Who is filing, and how their files are doing.
 *
 * An administrator asking "is this LTP submitting work that passes?" currently
 * has no way to answer it. Scrutiny failure rate per filer is the honest
 * version of that question — and it is descriptive, not a score: a Class-II
 * licensee doing difficult sites will fail more often than one filing simple
 * dwellings, and the column says what happened, not who is at fault.
 */
export type FilerRow = {
  userId: string;
  name: string;
  firmName: string | null;
  licenceNo: string | null;
  total: number;
  drafts: number;
  approved: number;
  rejected: number;
  openShortfalls: number;
  lastFiledAt: string | null;
};

export async function filerBreakdown(user: AuthUser, limit = 12): Promise<FilerRow[]> {
  // Use aggregation instead of loading ALL applications per user into memory.
  // The previous implementation did a nested select that loaded every application
  // row for every user, then counted in JS — an unbounded memory load.
  const rows = await prisma.user.findMany({
    where: { deletedAt: null, applications: { some: liveApplications(user) } },
    select: {
      id: true,
      name: true,
      firmName: true,
      ltpLicenceNo: true,
      _count: {
        select: {
          applications: { where: liveApplications(user) },
        },
      },
    },
    orderBy: { applications: { _count: 'desc' } },
    take: limit,
  });

  // For the small result set (≤ limit), fetch the breakdowns with targeted queries
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.id);

  const [statusGroups, shortfallSums, lastFiled] = await Promise.all([
    prisma.application.groupBy({
      by: ['ltpUserId', 'status'],
      where: { ...liveApplications(user), ltpUserId: { in: userIds } },
      _count: { _all: true },
    }),
    prisma.application.groupBy({
      by: ['ltpUserId'],
      where: { ...liveApplications(user), ltpUserId: { in: userIds }, openShortfalls: { gt: 0 } },
      _sum: { openShortfalls: true },
    }),
    prisma.application.groupBy({
      by: ['ltpUserId'],
      where: { ...liveApplications(user), ltpUserId: { in: userIds }, submittedAt: { not: null } },
      _max: { submittedAt: true },
    }),
  ]);

  const statusByUser = new Map<string, Map<string, number>>();
  for (const row of statusGroups) {
    const map = statusByUser.get(row.ltpUserId) ?? new Map();
    map.set(row.status, row._count._all);
    statusByUser.set(row.ltpUserId, map);
  }
  const shortfallByUser = new Map(shortfallSums.map((r) => [r.ltpUserId, r._sum.openShortfalls ?? 0]));
  const lastFiledByUser = new Map(lastFiled.map((r) => [r.ltpUserId, r._max.submittedAt]));

  return rows.map((row) => {
    const statuses = statusByUser.get(row.id) ?? new Map();
    return {
      userId: row.id,
      name: row.name,
      firmName: row.firmName,
      licenceNo: row.ltpLicenceNo,
      total: row._count.applications,
      drafts: statuses.get('DRAFT') ?? 0,
      approved: statuses.get('APPROVED') ?? 0,
      rejected: statuses.get('REJECTED') ?? 0,
      openShortfalls: shortfallByUser.get(row.id) ?? 0,
      lastFiledAt: lastFiledByUser.get(row.id)?.toISOString() ?? null,
    };
  });
}

/**
 * The accounts themselves: who exists, who is active, and who has ever signed in.
 *
 * `neverSignedIn` is the one worth surfacing. An account created for somebody
 * who never used it is either a person who was never told, or a desk nobody is
 * covering — and both look exactly like a working system until a file arrives.
 */
export type AccountSummary = {
  byRole: Array<{
    roleKey: string;
    name: string;
    total: number;
    active: number;
    inactive: number;
    neverSignedIn: number;
    signedInLast7Days: number;
    openTasks: number;
  }>;
  totals: { users: number; active: number; neverSignedIn: number };
};

export async function accountSummary(): Promise<AccountSummary> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      status: true,
      lastLoginAt: true,
      roles: { select: { role: { select: { key: true, name: true, rank: true } } } },
      _count: { select: { tasks: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } } } },
    },
  });

  const byRole = new Map<string, AccountSummary['byRole'][number] & { rank: number }>();

  for (const user of users) {
    for (const { role } of user.roles) {
      const row =
        byRole.get(role.key) ??
        {
          roleKey: role.key,
          name: role.name,
          rank: role.rank,
          total: 0,
          active: 0,
          inactive: 0,
          neverSignedIn: 0,
          signedInLast7Days: 0,
          openTasks: 0,
        };

      row.total += 1;
      if (user.status === 'ACTIVE') row.active += 1;
      else row.inactive += 1;
      if (!user.lastLoginAt) row.neverSignedIn += 1;
      else if (user.lastLoginAt >= weekAgo) row.signedInLast7Days += 1;
      row.openTasks += user._count.tasks;

      byRole.set(role.key, row);
    }
  }

  return {
    byRole: [...byRole.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .map(({ rank: _rank, ...row }) => row),
    totals: {
      users: users.length,
      active: users.filter((u) => u.status === 'ACTIVE').length,
      neverSignedIn: users.filter((u) => !u.lastLoginAt).length,
    },
  };
}

export type ConsolidatedView = {
  desks: DeskRow[];
  applicantSide: ApplicantSideSummary;
  filers: FilerRow[];
  accounts: AccountSummary;
};

/**
 * Everything the administrator's consolidated view needs, in one round trip.
 *
 * Kept separate from `dashboardData` rather than folded into it: only the
 * System Administrator renders this, and making every officer's dashboard pay
 * for four more aggregate queries to display nothing would be a poor trade.
 */
export async function consolidatedView(user: AuthUser): Promise<ConsolidatedView> {
  return memoizeAsync(`analytics:consolidated:${user.id}`, 60, async () => {
    const [desks, applicantSide, filers, accounts] = await Promise.all([
      deskConsolidation(user),
      applicantSideSummary(user),
      filerBreakdown(user, 10),
      accountSummary(),
    ]);

    return { desks, applicantSide, filers, accounts };
  });
}
