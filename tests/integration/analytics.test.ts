import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, databaseAvailable, actorFor } from './setup';
import {
  applicationOverview,
  financeSummary,
  scrutinySummary,
  shortfallSummary,
  slaSummary,
  documentSummary,
  applicationTrend,
  recentActivity,
  workload,
  dashboardData,
  consolidatedView,
  deskConsolidation,
  applicantSideSummary,
  accountSummary,
} from '@/server/services/analytics';
import { listApplications } from '@/server/services/applications';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';

/**
 * THE NUMBERS ON THE DASHBOARD ARE THE NUMBERS IN THE DATABASE.
 *
 * ── What this suite is asserting ─────────────────────────────────────────
 *
 * Not "the analytics module runs". Three properties, each of which is a
 * failure mode that destroys trust in every figure on the screen once it
 * happens even once:
 *
 *   1. RECONCILIATION. Every aggregate equals a hand count reached by a
 *      different route. If the tile and the register are computed the same
 *      way they agree trivially and prove nothing, so the assertions here
 *      deliberately count the rows themselves.
 *
 *   2. SELF-CONSISTENCY. The parts sum to the whole — statuses to the total,
 *      buckets to subsets of it, drafts plus live plus closed to everything.
 *      A dashboard whose own halves disagree is worse than one with no
 *      figures at all.
 *
 *   3. SCOPE. An LTP's total counts their files and a zonal officer's counts
 *      their jurisdiction, and the tile agrees with the list the tile links
 *      to. A total that silently includes rows the user cannot open is an
 *      authorization defect wearing a KPI tile.
 *
 * It runs against whatever is in the database — the demo environment, or a
 * single application, or none. Every assertion is relational rather than
 * absolute, so it neither depends on the demo seed nor passes vacuously
 * because of it.
 */

const dbUp = await databaseAvailable();

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;

async function userActor(email: string, role: RoleKey): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { jurisdictions: { select: { zoneId: true } } },
  });
  if (!user) return null;

  return actorFor(user.id, user.name, [role], {
    capabilities: RBAC_MATRIX[role] as unknown as string[],
    zoneIds: [
      ...new Set([
        ...(user.primaryZoneId ? [user.primaryZoneId] : []),
        ...user.jurisdictions.map((j) => j.zoneId),
      ]),
    ],
  });
}

beforeAll(async () => {
  if (!dbUp) return;
  const user = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: { key: ROLES.SYSTEM_ADMIN } } }, deletedAt: null },
  });
  admin = actorFor(user.id, user.name, [ROLES.SYSTEM_ADMIN], {
    capabilities: RBAC_MATRIX[ROLES.SYSTEM_ADMIN] as unknown as string[],
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)('application analytics', () => {
  it('totals exactly what the applications table holds', async () => {
    const overview = await applicationOverview(admin);
    const raw = await prisma.application.count({ where: { deletedAt: null } });
    expect(overview.total).toBe(raw);
  });

  it('sums its own status breakdown to its own total', async () => {
    const overview = await applicationOverview(admin);
    const summed = Object.values(overview.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(overview.total);
  });

  it('counts approvals and rejections against the rows themselves', async () => {
    const overview = await applicationOverview(admin);

    const [approved, rejected] = await Promise.all([
      prisma.application.count({ where: { deletedAt: null, status: 'APPROVED' } }),
      prisma.application.count({ where: { deletedAt: null, status: 'REJECTED' } }),
    ]);

    expect(overview.approved).toBe(approved);
    expect(overview.rejected).toBe(rejected);
  });

  it('accounts for every file as draft, in progress or closed', async () => {
    const overview = await applicationOverview(admin);
    expect(overview.draft + overview.inProgress + overview.closed).toBe(overview.total);
  });

  it('never reports a bucket larger than the total', async () => {
    const overview = await applicationOverview(admin);
    for (const [key, value] of Object.entries(overview.byBucket)) {
      expect(value, `bucket ${key} exceeds the total`).toBeLessThanOrEqual(overview.total);
      expect(value, `bucket ${key} is negative`).toBeGreaterThanOrEqual(0);
    }
    expect(overview.byBucket.total).toBe(overview.total);
  });

  it('distributes every file across exactly one type', async () => {
    const overview = await applicationOverview(admin);
    const summed = overview.byType.reduce((sum, t) => sum + t.count, 0);
    expect(summed).toBe(overview.total);
  });

  it('counts stages only for files that carry one', async () => {
    const overview = await applicationOverview(admin);
    const summed = overview.byStage.reduce((sum, s) => sum + s.count, 0);
    const raw = await prisma.application.count({
      where: { deletedAt: null, currentStageCode: { not: null } },
    });
    expect(summed).toBe(raw);
  });
});

describe.skipIf(!dbUp)('the dashboard tile and the register it links to', () => {
  it('agree, tile by tile', async () => {
    // The property the bucket definitions exist to guarantee: a tile reading 4
    // and a list showing 3 is the moment a user stops believing any number on
    // the screen. Both read src/lib/application-buckets.ts, and this is what
    // proves the sharing is real rather than intended.
    const overview = await applicationOverview(admin);

    for (const bucket of ['draft', 'scrutinyFailed', 'paymentPending', 'underReview', 'approved']) {
      const list = await listApplications(admin, {
        bucket,
        page: 1,
        pageSize: 1,
        sort: 'updatedAt',
        dir: 'desc',
      } as never);

      expect(list.total, `bucket "${bucket}"`).toBe(overview.byBucket[bucket]);
    }
  });

  it('agrees on the unfiltered total too', async () => {
    const overview = await applicationOverview(admin);
    const list = await listApplications(admin, {
      page: 1,
      pageSize: 1,
      sort: 'updatedAt',
      dir: 'desc',
    } as never);

    expect(list.total).toBe(overview.total);
  });
});

describe.skipIf(!dbUp)('money', () => {
  it('reports collections as the sum of settled payments and nothing else', async () => {
    const finance = await financeSummary(admin);

    const settled = await prisma.payment.findMany({
      where: { status: 'SUCCESS', application: { deletedAt: null } },
      select: { amount: true },
    });

    const handCounted = settled.reduce((sum, p) => sum + Number(p.amount), 0);
    expect(finance.collected).toBeCloseTo(handCounted, 2);
  });

  it('never reports collecting more than it demanded', async () => {
    const finance = await financeSummary(admin);
    expect(finance.collected).toBeLessThanOrEqual(finance.generated + 0.005);
  });

  it('never reports a negative receivable', async () => {
    const finance = await financeSummary(admin);
    expect(finance.outstanding).toBeGreaterThanOrEqual(0);
  });

  it('bases the success rate only on attempts that reached a verdict', async () => {
    const finance = await financeSummary(admin);
    const decided = finance.payments.successful + finance.payments.failed + finance.payments.cancelled;

    if (decided === 0) {
      expect(finance.payments.successRate).toBe(0);
      return;
    }

    expect(finance.payments.successRate).toBeCloseTo((finance.payments.successful / decided) * 100, 1);
    expect(finance.payments.successRate).toBeLessThanOrEqual(100);
  });

  it('issues a receipt for every settled payment', async () => {
    const orphan = await prisma.payment.count({ where: { status: 'SUCCESS', receipt: null } });
    expect(orphan).toBe(0);
  });
});

describe.skipIf(!dbUp)('shortfalls', () => {
  it('counts open shortfalls from the rows, not from the cached counter', async () => {
    const summary = await shortfallSummary(admin);
    const raw = await prisma.shortfall.count({
      where: { application: { deletedAt: null }, status: { notIn: ['RESOLVED', 'CANCELLED'] } },
    });
    expect(summary.open).toBe(raw);
  });

  it('splits the total into open, resolved and cancelled with nothing left over', async () => {
    const summary = await shortfallSummary(admin);
    expect(summary.open + summary.resolved + summary.cancelled).toBe(summary.total);
  });

  it('accounts for every open shortfall in exactly one mode', async () => {
    const summary = await shortfallSummary(admin);
    expect(summary.byMode.blocking + summary.byMode.reported).toBe(summary.open);
  });

  it('leaves no approved application carrying an open one', async () => {
    // The one guard with no override, checked against the data rather than
    // against the code that is supposed to enforce it.
    const offending = await prisma.application.count({
      where: {
        deletedAt: null,
        status: 'APPROVED',
        shortfalls: { some: { status: { notIn: ['RESOLVED', 'CANCELLED'] } } },
      },
    });
    expect(offending).toBe(0);
  });
});

describe.skipIf(!dbUp)('scrutiny and documents', () => {
  it('counts pass and fail against the result rows', async () => {
    const summary = await scrutinySummary(admin);
    const raw = await prisma.scrutinyResult.count();
    expect(summary.passed + summary.failed).toBe(raw);
  });

  it('never reports a negative finding count', async () => {
    const summary = await scrutinySummary(admin);
    for (const value of Object.values(summary.issues)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts document states against the rows', async () => {
    const summary = await documentSummary(admin);
    const verified = await prisma.applicationDocument.count({ where: { status: 'VERIFIED' } });
    expect(summary.verified).toBe(verified);
  });
});

describe.skipIf(!dbUp)('service standards', () => {
  it('counts overdue clocks against the SLA table', async () => {
    const summary = await slaSummary(admin);
    const raw = await prisma.slaInstance.count({
      where: {
        completedAt: null,
        status: 'OVERDUE',
        task: { instance: { application: { deletedAt: null } } },
      },
    });
    expect(summary.overdue).toBe(raw);
  });

  it('never marks a clock overdue whose due date has not passed', async () => {
    const mislabelled = await prisma.slaInstance.count({
      where: { status: 'OVERDUE', completedAt: null, dueAt: { gt: new Date() } },
    });
    expect(mislabelled).toBe(0);
  });
});

describe.skipIf(!dbUp)('the trend chart', () => {
  it('returns one point per month in the window', async () => {
    const trend = await applicationTrend(admin, 9);
    expect(trend).toHaveLength(9);
  });

  it('counts the same applications the table does', async () => {
    const trend = await applicationTrend(admin, 9);
    const charted = trend.reduce((sum, point) => sum + point.created, 0);

    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    from.setMonth(from.getMonth() - 8);

    const raw = await prisma.application.count({
      where: { deletedAt: null, createdAt: { gte: from } },
    });

    expect(charted).toBe(raw);
  });

  it('never charts more approvals than exist', async () => {
    const trend = await applicationTrend(admin, 9);
    const charted = trend.reduce((sum, point) => sum + point.approved, 0);
    const raw = await prisma.application.count({ where: { deletedAt: null, status: 'APPROVED' } });
    expect(charted).toBeLessThanOrEqual(raw);
  });
});

describe.skipIf(!dbUp)('row scope', () => {
  it('gives an LTP their own files and nobody else’s', async () => {
    const ltp = await userActor('ltp.demo@example.com', ROLES.LTP);
    if (!ltp) return;

    const overview = await applicationOverview(ltp);
    const own = await prisma.application.count({ where: { deletedAt: null, ltpUserId: ltp.id } });

    expect(overview.total).toBe(own);

    // And the register agrees with the tile, which is the pairing that matters.
    const list = await listApplications(ltp, {
      page: 1,
      pageSize: 1,
      sort: 'updatedAt',
      dir: 'desc',
    } as never);
    expect(list.total).toBe(overview.total);
  });

  it('gives a zonal officer their jurisdiction and no more', async () => {
    const tpa = await userActor('tpa.demo@example.com', ROLES.TPA);
    if (!tpa || tpa.zoneIds.length === 0) return;

    const overview = await applicationOverview(tpa);
    const inZone = await prisma.application.count({
      where: { deletedAt: null, zoneId: { in: tpa.zoneIds } },
    });

    expect(overview.total).toBe(inZone);

    const everything = await prisma.application.count({ where: { deletedAt: null } });
    expect(overview.total).toBeLessThanOrEqual(everything);
  });

  it('scopes the money, the shortfalls and the activity feed too', async () => {
    // The subtle one. Scoping the application count and forgetting the payment
    // aggregate would show a zonal officer the city's collections under their
    // own jurisdiction's heading.
    const tpa = await userActor('tpa.demo@example.com', ROLES.TPA);
    if (!tpa || tpa.zoneIds.length === 0) return;

    const [scoped, all] = await Promise.all([financeSummary(tpa), financeSummary(admin)]);
    expect(scoped.collected).toBeLessThanOrEqual(all.collected + 0.005);
    expect(scoped.demandsIssued).toBeLessThanOrEqual(all.demandsIssued);

    const [scopedShortfalls, allShortfalls] = await Promise.all([
      shortfallSummary(tpa),
      shortfallSummary(admin),
    ]);
    expect(scopedShortfalls.total).toBeLessThanOrEqual(allShortfalls.total);

    const activity = await recentActivity(tpa, 20);
    if (activity.length) {
      const ids = [...new Set(activity.map((a) => a.applicationId))];
      const visible = await prisma.application.count({
        where: { id: { in: ids }, deletedAt: null, zoneId: { in: tpa.zoneIds } },
      });
      expect(visible).toBe(ids.length);
    }
  });

  it('gives an LTP no view of anybody else’s activity', async () => {
    const ltp = await userActor('ltp.demo@example.com', ROLES.LTP);
    if (!ltp) return;

    const activity = await recentActivity(ltp, 25);
    if (!activity.length) return;

    const ids = [...new Set(activity.map((a) => a.applicationId))];
    const own = await prisma.application.count({
      where: { id: { in: ids }, ltpUserId: ltp.id, deletedAt: null },
    });

    expect(own).toBe(ids.length);
  });
});

describe.skipIf(!dbUp)('the assembled dashboard', () => {
  it('returns every section in one call, agreeing with each part', async () => {
    const data = await dashboardData(admin, { months: 6 });
    const [overview, finance, load] = await Promise.all([
      applicationOverview(admin),
      financeSummary(admin),
      workload(admin),
    ]);

    expect(data.applications.total).toBe(overview.total);
    expect(data.finance.collected).toBeCloseTo(finance.collected, 2);
    expect(data.trend).toHaveLength(6);
    expect(data.workload.map((w) => w.open)).toEqual(load.map((w) => w.open));
  });

  it('reports a workload that matches the open tasks', async () => {
    const rows = await workload(admin);
    const summed = rows.reduce((sum, row) => sum + row.open, 0);

    const raw = await prisma.workflowTask.count({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        instance: { application: { deletedAt: null } },
      },
    });

    expect(summed).toBe(raw);
  });
});


describe.skipIf(!dbUp)('the administrator’s consolidated view', () => {
  it('accounts for every application across the desks and the unstaged', async () => {
    const desks = await deskConsolidation(admin);
    const atDesks = desks.reduce((sum, d) => sum + d.applications, 0);

    const unstaged = await prisma.application.count({
      where: { deletedAt: null, currentStageCode: null },
    });
    const total = await prisma.application.count({ where: { deletedAt: null } });

    expect(atDesks + unstaged).toBe(total);
  });

  it('partitions the register into applicant, desk and closed', async () => {
    // The identity the pipeline strip prints. If it stops holding, the
    // headline panel becomes arithmetic a reader cannot follow — and a
    // summary whose parts do not sum to the whole discredits every other
    // figure on the page.
    const [desks, applicantSide, overview] = await Promise.all([
      deskConsolidation(admin),
      applicantSideSummary(admin),
      applicationOverview(admin),
    ]);

    const inReview = desks
      .filter((d) => !d.isTerminal && d.roleKeys.some((r) => r !== 'LTP'))
      .reduce((sum, d) => sum + d.applications, 0);

    expect(applicantSide.totalWithApplicant + inReview + overview.approved + overview.rejected).toBe(
      overview.total
    );
  });

  it('splits every desk’s open tasks into claimed and unclaimed with nothing left over', async () => {
    const desks = await deskConsolidation(admin);
    for (const desk of desks) {
      expect(desk.claimed + desk.unclaimed, desk.label).toBe(desk.openTasks);
    }
  });

  it('counts the same open tasks the queue does', async () => {
    const desks = await deskConsolidation(admin);
    const summed = desks.reduce((sum, d) => sum + d.openTasks, 0);

    const raw = await prisma.workflowTask.count({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        instance: { application: { deletedAt: null } },
      },
    });

    expect(summed).toBe(raw);
  });

  it('attributes every open shortfall to the desk that raised it', async () => {
    const [desks, shortfalls] = await Promise.all([
      deskConsolidation(admin),
      shortfallSummary(admin),
    ]);

    expect(desks.reduce((sum, d) => sum + d.openShortfalls, 0)).toBe(shortfalls.open);
  });

  it('never reports more due-soon or overdue tasks than a desk has', async () => {
    const desks = await deskConsolidation(admin);
    for (const desk of desks) {
      expect(desk.dueSoon + desk.overdue, desk.label).toBeLessThanOrEqual(desk.openTasks);
    }
  });

  it('counts every live account exactly once per role it holds', async () => {
    const accounts = await accountSummary();
    const raw = await prisma.user.count({ where: { deletedAt: null } });

    expect(accounts.totals.users).toBe(raw);

    for (const row of accounts.byRole) {
      expect(row.active + row.inactive, row.roleKey).toBe(row.total);
      expect(row.neverSignedIn, row.roleKey).toBeLessThanOrEqual(row.total);
    }
  });

  it('never lets a filer claim more files than exist', async () => {
    const [view, overview] = await Promise.all([
      consolidatedView(admin),
      applicationOverview(admin),
    ]);

    const claimed = view.filers.reduce((sum, f) => sum + f.total, 0);
    expect(claimed).toBeLessThanOrEqual(overview.total);

    for (const filer of view.filers) {
      expect(filer.approved + filer.rejected + filer.drafts, filer.name).toBeLessThanOrEqual(filer.total);
    }
  });

  it('is scoped like everything else — a zonal officer sees only their zones', async () => {
    const tpa = await userActor('tpa.demo@example.com', ROLES.TPA);
    if (!tpa || tpa.zoneIds.length === 0) return;

    const [scoped, all] = await Promise.all([deskConsolidation(tpa), deskConsolidation(admin)]);

    const scopedFiles = scoped.reduce((sum, d) => sum + d.applications, 0);
    const allFiles = all.reduce((sum, d) => sum + d.applications, 0);

    expect(scopedFiles).toBeLessThanOrEqual(allFiles);

    const inZone = await prisma.application.count({
      where: { deletedAt: null, zoneId: { in: tpa.zoneIds }, currentStageCode: { not: null } },
    });
    expect(scopedFiles).toBe(inZone);
  });
});
