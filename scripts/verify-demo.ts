/**
 * RECONCILIATION.
 *
 *   npm run demo:verify
 *
 * Asks the database the same questions the dashboards ask, by a DIFFERENT
 * route, and complains when the two answers differ.
 *
 * That difference of route is the whole value. `src/server/services/analytics.ts`
 * answers "how much money came in" with one aggregate over settled payments;
 * this script answers it by walking the payments and adding them up. If both
 * used the same query they would agree by construction and prove nothing —
 * they would only be testing that Prisma can run a query twice.
 *
 * It checks two families of thing:
 *
 *   CONSISTENCY  the analytics service and a hand count agree.
 *   INTEGRITY    combinations the system is supposed to make impossible are
 *                in fact absent — an approved file with an open shortfall, a
 *                settled payment with no receipt, an application sitting at
 *                two stages at once.
 *
 * Exit code 1 on any failure, so CI can run it.
 */
import { prisma } from '../src/server/db/prisma';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import { ROLES } from '../src/lib/constants';
import { listShortfalls } from '../src/server/shortfalls/queries';
import { findPublicRecord } from '../src/server/services/public-verification';
import { deriveRiskCategory } from '../src/lib/checklist';
import { createHash } from 'node:crypto';
import { canonicalReport, inspectionReadiness, RECOMMENDATION_ACTION, type Recommendation } from '../src/lib/site-inspection';
import { inspectionSummary, listInspections } from '../src/server/services/site-inspections';
import { checkPlotAreas } from '../src/lib/plot-area';
import { EVENTS } from '../src/server/events/outbox';
import { isKnownEvent } from '../src/server/notifications/recipients';
import { hasFallbackTemplate } from '../src/server/notifications/templates';
import {
  applicationOverview,
  approvalSummary,
  financeSummary,
  shortfallSummary,
  scrutinySummary,
  slaSummary,
  applicationTrend,
  consolidatedView,
  nocDashboardSummary,
} from '../src/server/services/analytics';
import { listNocs, nocSummary } from '../src/server/services/nocs';
import { OUTSTANDING_NOC_STATUSES, NOC_STATUSES, verificationProblems } from '../src/lib/noc';
import type { AuthUser } from '../src/server/auth/context';
import { listShowCauses, showCauseSummary } from '../src/server/services/show-cause';
import { listRevocations } from '../src/server/services/revocations';
import { listOutward } from '../src/server/services/outward';
import { isShowCauseOpen } from '../src/lib/show-cause';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = '') {
  checks += 1;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const eq = (name: string, a: number, b: number, aLabel = 'dashboard', bLabel = 'database') =>
  check(name, a === b, a === b ? String(a) : `${aLabel}=${a} but ${bLabel}=${b}`);

/** A System Administrator sees everything, which is what a total must count. */
async function superAdmin(): Promise<AuthUser> {
  const user = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: { key: ROLES.SYSTEM_ADMIN } } }, deletedAt: null },
    select: { id: true, name: true, email: true, officeId: true },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys: [ROLES.SYSTEM_ADMIN],
    roleNames: ['System Administrator'],
    capabilities: RBAC_MATRIX[ROLES.SYSTEM_ADMIN] as unknown as string[],
    zoneIds: [],
    officeId: user.officeId,
    sessionId: 'verify-demo',
  };
}

async function main() {
  console.log('\nDemo environment reconciliation\n');

  const admin = await superAdmin();

  // ── 1. Applications ───────────────────────────────────────────────────
  console.log('Applications');

  const overview = await applicationOverview(admin);
  const rawTotal = await prisma.application.count({ where: { deletedAt: null } });

  eq('total matches the applications table', overview.total, rawTotal);
  check(
    'at least 60 demo applications exist',
    rawTotal >= 60,
    `${rawTotal} rows`
  );

  const statusSum = Object.values(overview.byStatus).reduce((a, b) => a + b, 0);
  eq('status breakdown sums to the total', statusSum, overview.total, 'sum of statuses', 'total');

  const approvedRaw = await prisma.application.count({
    where: { deletedAt: null, status: 'APPROVED' },
  });
  eq('approved count matches APPROVED rows', overview.approved, approvedRaw);

  const rejectedRaw = await prisma.application.count({
    where: { deletedAt: null, status: 'REJECTED' },
  });
  eq('rejected count matches REJECTED rows', overview.rejected, rejectedRaw);

  eq(
    'draft + in progress + closed accounts for every file',
    overview.draft + overview.inProgress + overview.closed,
    overview.total,
    'parts',
    'total'
  );

  // The `total` bucket is defined as "every status", so it must equal the
  // total by construction — and every other bucket must be a subset of it.
  eq('the total bucket equals the total', overview.byBucket.total ?? -1, overview.total);

  const stageSum = overview.byStage.reduce((sum, s) => sum + s.count, 0);
  const withStage = await prisma.application.count({
    where: { deletedAt: null, currentStageCode: { not: null } },
  });
  eq('stage distribution matches applications carrying a stage', stageSum, withStage);

  const typeSum = overview.byType.reduce((sum, t) => sum + t.count, 0);
  eq('type distribution sums to the total', typeSum, overview.total);

  // ── 2. Workflow integrity ─────────────────────────────────────────────
  console.log('\nWorkflow');

  // `applications.currentStageCode` is a denormalised cache. If it has drifted
  // from the instance, the register and the workflow tab disagree about where
  // a file is — and the register is what an officer looks at first.
  const drifted = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM applications a
      JOIN workflow_instances i ON i."applicationId" = a.id
      LEFT JOIN workflow_stages s ON s.id = i."currentStageId"
     WHERE a."deletedAt" IS NULL
       AND COALESCE(a."currentStageCode", '') <> COALESCE(s.code, '')
  `;
  check(
    'no application disagrees with its workflow instance about its stage',
    Number(drifted[0]?.n ?? 0) === 0,
    `${Number(drifted[0]?.n ?? 0)} drifted`
  );

  const multiInstance = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "applicationId" FROM workflow_instances
       GROUP BY "applicationId" HAVING COUNT(*) > 1
    ) d
  `;
  check(
    'no application is in two workflow runs at once',
    Number(multiInstance[0]?.n ?? 0) === 0
  );

  const multiOpenTask = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "instanceId" FROM workflow_tasks
       WHERE status IN ('PENDING', 'IN_PROGRESS')
       GROUP BY "instanceId" HAVING COUNT(*) > 1
    ) d
  `;
  check(
    'no application has two open tasks at once',
    Number(multiOpenTask[0]?.n ?? 0) === 0,
    `${Number(multiOpenTask[0]?.n ?? 0)} with more than one`
  );

  const closedWithOpenTask = await prisma.workflowTask.count({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      instance: { status: { in: ['COMPLETED', 'CANCELLED'] } },
    },
  });
  check('no closed application still has an open task', closedWithOpenTask === 0);

  // ── 3. The approval guard ─────────────────────────────────────────────
  console.log('\nApproval integrity');

  const approvedWithOpenShortfall = await prisma.application.count({
    where: {
      deletedAt: null,
      status: 'APPROVED',
      shortfalls: { some: { status: { notIn: ['RESOLVED', 'CANCELLED'] } } },
    },
  });
  check(
    'no approved application carries an open shortfall',
    approvedWithOpenShortfall === 0,
    approvedWithOpenShortfall ? `${approvedWithOpenShortfall} found` : 'the guard held'
  );

  const approvedUnpaid = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT a.id) AS n
      FROM applications a
      JOIN application_fees f ON f."applicationId" = a.id
     WHERE a."deletedAt" IS NULL
       AND a.status = 'APPROVED'
       AND f.status NOT IN ('PAID', 'CANCELLED', 'WAIVED')
  `;
  check(
    'no approved application has an unpaid demand',
    Number(approvedUnpaid[0]?.n ?? 0) === 0,
    `${Number(approvedUnpaid[0]?.n ?? 0)} found`
  );

  const approvedWithoutOrder = await prisma.application.count({
    where: { deletedAt: null, status: 'APPROVED', approvalOrder: null },
  });
  check('every approved application has an approval order', approvedWithoutOrder === 0);

  const approvedWithoutDate = await prisma.application.count({
    where: { deletedAt: null, status: 'APPROVED', approvedAt: null },
  });
  check('every approved application carries an approval date', approvedWithoutDate === 0);

  // ── 3a. The permission order ──────────────────────────────────────────
  console.log('\nBuilding permission orders');

  const approvals = await approvalSummary(admin);
  const orderTotal = await prisma.approvalOrder.count();
  const issuedRaw = await prisma.approvalOrder.count({ where: { status: 'ISSUED' } });

  eq('issued orders match the order table', approvals.ordersIssued, issuedRaw);
  check(
    'every order is in a state the lifecycle defines',
    (await prisma.approvalOrder.count({
      where: { status: { notIn: ['DRAFT', 'PREVIEW', 'GENERATED', 'APPROVED', 'ISSUED', 'REVOKED'] } },
    })) === 0,
    `${orderTotal} orders`
  );

  // An order is evidence a permission was granted. One standing against a file
  // that is not approved is evidence of something that did not happen.
  //
  // The one exception is a revoked permission: its order stays on the record,
  // marked REVOKED, against a file that is PROCEEDING_REVOKED — revocation
  // keeps the evidence of the grant rather than deleting it.
  const orderWithoutApproval = await prisma.approvalOrder.count({
    where: {
      application: { status: { not: 'APPROVED' } },
      NOT: { status: 'REVOKED', revokedAt: { not: null }, application: { status: 'PROCEEDING_REVOKED' } },
    },
  });
  check(
    'no order stands against an application that is not approved',
    orderWithoutApproval === 0,
    orderWithoutApproval ? `${orderWithoutApproval} found` : 'orders never outrun their approval'
  );

  // The guard in `advanceOrder`: issuing without a rendered document would be
  // issuing the promise of a permission rather than the permission.
  const issuedWithoutDocument = await prisma.approvalOrder.count({
    where: { status: 'ISSUED', storageKey: '' },
  });
  check(
    'every issued order has a rendered document behind it',
    issuedWithoutDocument === 0,
    issuedWithoutDocument ? `${issuedWithoutDocument} without` : 'nothing was issued empty'
  );

  const withoutCode = await prisma.approvalOrder.count({ where: { verificationCode: '' } });
  check('every order carries a public verification code', withoutCode === 0);

  // ── 3b. Public verification ───────────────────────────────────────────
  //
  // Checked through the PUBLIC path, not by reading the table: the property
  // worth asserting is what a stranger actually receives, and that is decided
  // by the whitelist in public-verification.ts rather than by the row.
  const sampleIssued = await prisma.approvalOrder.findFirst({
    where: { status: 'ISSUED' },
    select: { orderNumber: true, verificationCode: true, application: { select: { applicationNumber: true } } },
  });

  if (sampleIssued) {
    const [byNumber, byCode] = await Promise.all([
      findPublicRecord(sampleIssued.application.applicationNumber),
      findPublicRecord(sampleIssued.verificationCode),
    ]);

    check('an issued order is findable by application number', byNumber != null);
    check('an issued order is findable by its verification code', byCode != null);
    check(
      'public verification reports the proceeding number for an issued order',
      byNumber?.proceedingNumber === sampleIssued.orderNumber,
      byNumber?.proceedingNumber ?? 'absent'
    );
  } else {
    check('an issued order exists to verify publicly', false, 'none issued');
  }

  const undecided = await prisma.application.findFirst({
    where: { deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'DRAFT'] } },
    select: { applicationNumber: true },
  });

  if (undecided) {
    const record = await findPublicRecord(undecided.applicationNumber);
    check(
      'public verification never names a desk or an internal status',
      record != null && ['UNDER_PROCESS', 'WITH_APPLICANT'].includes(record.status),
      record?.status ?? 'not found'
    );
    check(
      'public verification withholds the owner on an undecided application',
      record != null && record.ownerName === null && record.proceedingNumber === null
    );
  }

  check('a reference that does not exist returns nothing', (await findPublicRecord('BP/9999/999999')) == null);
  check('a too-short reference is refused outright', (await findPublicRecord('BP')) == null);

  // ── 3c. Notifications ─────────────────────────────────────────────────
  console.log('\nNotifications');

  // Every event the system can emit must have somewhere to send it. An event
  // with no template is an event that reaches nobody, silently.
  const declared = Object.values(EVENTS);
  const templated = new Set(
    (await prisma.notificationTemplate.findMany({ select: { eventCode: true } })).map((t) => t.eventCode)
  );
  // A database template OR a built-in fallback. The property worth asserting
  // is that nothing is DROPPED — an event the dispatcher can render reaches
  // somebody, whether the wording came from the templates table or from the
  // fallback in templates.ts. Insisting on a row would fail events that are
  // deliberately served by the fallback.
  const untemplated = declared.filter(
    (code) => !templated.has(code) && !hasFallbackTemplate(code)
  );

  check(
    'every declared event can be rendered — a template or a fallback',
    untemplated.length === 0,
    untemplated.length ? untemplated.join(', ') : `${declared.length} events`
  );

  const fallbackOnly = declared.filter((code) => !templated.has(code) && hasFallbackTemplate(code));
  if (fallbackOnly.length) {
    // Reported, not failed. A fallback delivers, but an administrator cannot
    // edit its wording, so knowing which events have no editable row is worth
    // seeing on every run.
    console.log(`  · ${fallbackOnly.length} events render from the built-in fallback: ${fallbackOnly.join(', ')}`);
  }

  const unroutable = declared.filter((code) => !isKnownEvent(code));
  check(
    'every declared event has a recipient rule',
    unroutable.length === 0,
    unroutable.length ? unroutable.join(', ') : 'nothing would be dropped'
  );

  // Reported rather than asserted: several events belong to phases that have
  // not been built, and an unproduced event is a fact worth seeing, not a
  // failure. It becomes a failure only if somebody expected it to fire.
  const emitted = new Set(
    (await prisma.outboxEvent.findMany({ select: { eventCode: true }, distinct: ['eventCode'] })).map(
      (e) => e.eventCode
    )
  );
  const neverEmitted = declared.filter((code) => !emitted.has(code));
  console.log(
    `  · ${declared.length - neverEmitted.length} of ${declared.length} events have been emitted` +
      (neverEmitted.length ? ` — never seen: ${neverEmitted.join(', ')}` : '')
  );

  const orphanLogs = await prisma.notificationLog.count({
    where: { status: 'SENT', sentAt: null },
  });
  check(
    'no delivery is recorded as sent without a time',
    orphanLogs === 0,
    orphanLogs ? `${orphanLogs} found` : 'every send is dated'
  );

  eq(
    'the dashboard notification backlog matches the outbox',
    approvals.notificationsPending,
    await prisma.outboxEvent.count({ where: { processed: false } })
  );

  // ── 4. Money ──────────────────────────────────────────────────────────
  console.log('\nFees and payments');

  const finance = await financeSummary(admin);

  const settled = await prisma.payment.findMany({
    where: { status: 'SUCCESS', application: { deletedAt: null } },
    select: { amount: true, applicationFeeId: true, applicationId: true, receipt: { select: { id: true } } },
  });

  const handCounted = settled.reduce((sum, p) => sum + Number(p.amount), 0);
  check(
    'collected matches the sum of settled payments',
    Math.abs(finance.collected - handCounted) < 0.005,
    `analytics=₹${finance.collected.toFixed(2)} hand-count=₹${handCounted.toFixed(2)} over ${settled.length} payments`
  );

  const noReceipt = settled.filter((p) => !p.receipt).length;
  check('every settled payment has a receipt', noReceipt === 0, `${noReceipt} without one`);

  const orphanPayments = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM payments p
      JOIN application_fees f ON f.id = p."applicationFeeId"
     WHERE p."applicationId" <> f."applicationId"
  `;
  check(
    'no payment is attached to a demand from another application',
    Number(orphanPayments[0]?.n ?? 0) === 0
  );

  const demandTotal = await prisma.applicationFee.aggregate({
    where: { application: { deletedAt: null }, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true },
  });
  const generatedHand = Number(demandTotal._sum.totalAmount ?? 0);
  check(
    'fees generated matches the demand ledger',
    Math.abs(finance.generated - generatedHand) < 0.005,
    `₹${finance.generated.toFixed(2)}`
  );

  check(
    'collected never exceeds generated',
    finance.collected <= finance.generated + 0.005,
    `₹${finance.collected.toFixed(2)} of ₹${finance.generated.toFixed(2)}`
  );

  const overpaid = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM application_fees
     WHERE "paidAmount" > "totalAmount"
  `;
  check('no demand is paid beyond its total', Number(overpaid[0]?.n ?? 0) === 0);

  const paidNotSettled = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM application_fees f
     WHERE f.status = 'PAID'
       AND NOT EXISTS (
         SELECT 1 FROM payments p
          WHERE p."applicationFeeId" = f.id AND p.status = 'SUCCESS'
       )
  `;
  check(
    'no demand is marked paid without a settled payment behind it',
    Number(paidNotSettled[0]?.n ?? 0) === 0
  );

  const multiOpenPayment = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "applicationFeeId" FROM payments
       WHERE status IN ('INITIATED', 'PENDING', 'PROCESSING')
       GROUP BY "applicationFeeId" HAVING COUNT(*) > 1
    ) d
  `;
  check(
    'no demand has two open payment attempts',
    Number(multiOpenPayment[0]?.n ?? 0) === 0
  );

  // ── 5. Shortfalls ─────────────────────────────────────────────────────
  console.log('\nShortfalls');

  const shortfalls = await shortfallSummary(admin);
  const openRaw = await prisma.shortfall.count({
    where: { application: { deletedAt: null }, status: { notIn: ['RESOLVED', 'CANCELLED'] } },
  });
  eq('open shortfalls matches unresolved rows', shortfalls.open, openRaw);

  const totalRaw = await prisma.shortfall.count({ where: { application: { deletedAt: null } } });
  eq('shortfall total matches the table', shortfalls.total, totalRaw);

  // `applications.openShortfalls` is the engine's cache. The approval guard
  // re-counts live and does not trust it — but if it has drifted, every list
  // that shows a shortfall badge is lying.
  const counterDrift = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT a.id
        FROM applications a
        LEFT JOIN shortfalls s
          ON s."applicationId" = a.id AND s.status NOT IN ('RESOLVED', 'CANCELLED')
       WHERE a."deletedAt" IS NULL
       GROUP BY a.id, a."openShortfalls"
      HAVING COUNT(s.id) <> a."openShortfalls"
    ) d
  `;
  check(
    'the openShortfalls counter agrees with the shortfall rows',
    Number(counterDrift[0]?.n ?? 0) === 0,
    `${Number(counterDrift[0]?.n ?? 0)} applications drifted`
  );

  const feeShortfallNoDemand = await prisma.shortfall.count({
    where: { kind: 'FEE', feeDemands: { none: {} } },
  });
  check(
    'every fee shortfall has a demand behind it',
    feeShortfallNoDemand === 0,
    feeShortfallNoDemand ? `${feeShortfallNoDemand} without` : 'money asked for is money payable'
  );

  // ── 5a. The register answers the same question the dashboard does ──────
  //
  // Two different routes to "how many shortfalls are open": the dashboard
  // aggregates, and the register pages. They are separate code paths with
  // separate WHERE builders, and a divergence between them is a badge that
  // sends somebody to a list that does not contain what the badge promised.
  const register = await listShortfalls(admin, { filter: 'all', pageSize: 5 });
  eq('the register total matches the shortfall table', register.total, totalRaw);
  eq(
    'the register open chip matches the dashboard open count',
    register.counts.open ?? 0,
    shortfalls.open,
    'register',
    'dashboard'
  );

  const registerResolved = await listShortfalls(admin, { filter: 'resolved', pageSize: 5 });
  eq(
    'open plus settled accounts for every shortfall',
    (register.counts.open ?? 0) + registerResolved.total,
    totalRaw,
    'open + settled',
    'table'
  );

  // ── 5b. Items ─────────────────────────────────────────────────────────

  const itemsTotal = await prisma.shortfallItem.count();
  check(
    'every shortfall lists at least one item, except clarifications',
    (await prisma.shortfall.count({
      where: { items: { none: {} }, kind: { notIn: ['CLARIFICATION', 'OTHER'] } },
    })) === 0,
    `${itemsTotal} items across ${totalRaw} shortfalls`
  );

  // `isResolved` is the column the approval guard reads and `status` is the one
  // the screens render. They are written together by the engine, and a row
  // where they disagree is a row that says one thing to an officer and another
  // to the guard.
  const itemStateDrift = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM shortfall_items
     WHERE ("isResolved" = true  AND status NOT IN ('ACCEPTED', 'WAIVED'))
        OR ("isResolved" = false AND status IN ('ACCEPTED', 'WAIVED'))
  `;
  check(
    'no shortfall item disagrees with itself about being resolved',
    Number(itemStateDrift[0]?.n ?? 0) === 0,
    `${Number(itemStateDrift[0]?.n ?? 0)} drifted`
  );

  // The guard this phase strengthened. An approved file carrying a mandatory
  // item nobody settled is the exact combination it exists to prevent.
  const approvedWithOpenItem = await prisma.shortfallItem.count({
    where: {
      isMandatory: true,
      isResolved: false,
      shortfall: { application: { status: 'APPROVED', deletedAt: null } },
    },
  });
  check(
    'no approved application carries an unresolved mandatory item',
    approvedWithOpenItem === 0,
    approvedWithOpenItem ? `${approvedWithOpenItem} found` : 'the item guard held'
  );

  // ── 5c. Cycles ────────────────────────────────────────────────────────

  const resolutionTotal = await prisma.shortfallResolution.count();

  // "Reached cycle 2", by the SAME definition `currentCycle` uses — a second
  // response on record, OR a first one that was rejected, which puts the
  // applicant on attempt 2 before attempt 2 exists. Counting resolution rows
  // alone would call a rejected shortfall cycle 1 while the register's Cycle
  // column, reading the same row, says 2.
  const multiCycle = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM shortfalls s
     WHERE s.status = 'RESOLUTION_REJECTED'
        OR (SELECT COUNT(*) FROM shortfall_resolutions r WHERE r."shortfallId" = s.id) > 1
  `;
  check(
    'the demo contains multi-cycle shortfalls',
    Number(multiCycle[0]?.n ?? 0) > 0,
    `${Number(multiCycle[0]?.n ?? 0)} of ${totalRaw} reached cycle 2, over ${resolutionTotal} responses`
  );

  // Attempts are 1..N with no gaps. A gap means a cycle was deleted, which is
  // the one thing an append-only history must never be able to show.
  const attemptGaps = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "shortfallId"
        FROM shortfall_resolutions
       GROUP BY "shortfallId"
      HAVING MIN("attemptNo") <> 1 OR MAX("attemptNo") <> COUNT(*)
    ) g
  `;
  check(
    'every shortfall numbers its cycles 1..N with no gaps',
    Number(attemptGaps[0]?.n ?? 0) === 0,
    `${Number(attemptGaps[0]?.n ?? 0)} broken sequences`
  );

  // An item response belongs to a cycle its shortfall actually had.
  const orphanItemResponses = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM shortfall_item_responses r
      JOIN shortfall_items i ON i.id = r."itemId"
     WHERE NOT EXISTS (
       SELECT 1 FROM shortfall_resolutions s
        WHERE s."shortfallId" = i."shortfallId" AND s."attemptNo" = r."attemptNo"
     )
  `;
  check(
    'every item response belongs to a cycle that happened',
    Number(orphanItemResponses[0]?.n ?? 0) === 0,
    `${Number(orphanItemResponses[0]?.n ?? 0)} orphaned`
  );

  // ── 6. Scrutiny ───────────────────────────────────────────────────────
  console.log('\nScrutiny');

  const scrutiny = await scrutinySummary(admin);
  const resultsRaw = await prisma.scrutinyResult.count();
  eq('pass + fail matches the result rows', scrutiny.passed + scrutiny.failed, resultsRaw);

  const failedNoIssues = await prisma.scrutinyResult.count({
    where: { outcome: 'FAIL', issues: { none: {} } },
  });
  check(
    'every failed scrutiny result lists its findings',
    failedNoIssues === 0,
    failedNoIssues ? `${failedNoIssues} with none` : 'a failure an applicant can act on'
  );

  const failedWithoutResult = await prisma.application.count({
    where: { deletedAt: null, status: 'SCRUTINY_FAILED', drawings: { none: {} } },
  });
  check('no application is SCRUTINY_FAILED without a drawing', failedWithoutResult === 0);

  // ── 6b. The checklist and the Others block ────────────────────────────
  //
  // These check three things the Phase 4 machinery is supposed to guarantee,
  // each by a route the services do not use.
  console.log('\nChecklist and others');

  const definitions = await prisma.checklistItemDefinition.findMany({
    where: { kind: 'APPLICATION', isActive: true },
    select: { id: true, itemNumber: true, affectsRisk: true, isProvisional: true },
  });

  check(
    'the application checklist has its nineteen questions',
    definitions.length === 19,
    `${definitions.length} active`
  );

  // Not a defect — a statement of fact about the demo, printed so nobody
  // mistakes the seeded sentences for the statutory ones.
  const provisional = definitions.filter((d) => d.isProvisional).length;
  if (provisional) {
    console.log(
      `  · ${provisional} of ${definitions.length} questions still carry PROVISIONAL DEMO WORDING. ` +
        'The BBAS manuals supplied do not reproduce the questions as text; replace them in Settings → Checklists.'
    );
  }

  const answered = await prisma.applicationChecklistResponse.count();
  const withChecklist = await prisma.application.count({
    where: { deletedAt: null, checklistResponses: { some: {} } },
  });
  check(
    'applications carry checklist answers',
    withChecklist > 0,
    `${withChecklist} application(s), ${answered} answers`
  );

  // INTEGRITY. Every answer must point at a question that exists, and carry
  // the number that question is known by — officers and letters refer to
  // "question 14", and a denormalised number that has drifted would make the
  // reference wrong retrospectively.
  const validIds = new Set(definitions.map((d) => d.id));
  const numberOf = new Map(definitions.map((d) => [d.id, d.itemNumber]));
  const responses = await prisma.applicationChecklistResponse.findMany({
    where: { kind: 'APPLICATION' },
    select: { id: true, itemId: true, itemNumber: true, status: true, response: true },
  });

  const orphaned = responses.filter((r) => !validIds.has(r.itemId)).length;
  check('every checklist answer points at a live question', orphaned === 0, `${orphaned} orphaned`);

  const misnumbered = responses.filter(
    (r) => numberOf.has(r.itemId) && numberOf.get(r.itemId) !== r.itemNumber
  ).length;
  check(
    'the denormalised question number agrees with the definition',
    misnumbered === 0,
    `${misnumbered} disagree`
  );

  // THE APPEND-ONLY GUARANTEE, checked from the data rather than from the
  // code: every answer that has been acted on must have left a trail, and a
  // question two desks reviewed must still carry both entries.
  const entries = await prisma.checklistReviewEntry.groupBy({
    by: ['responseId'],
    _count: { _all: true },
  });
  const entryCount = new Map(entries.map((e) => [e.responseId, e._count._all]));

  const touched = responses.filter((r) => r.response || r.status !== 'PENDING');
  const untraced = touched.filter((r) => !entryCount.has(r.id)).length;
  check(
    'every answer and verification left a history entry',
    untraced === 0,
    untraced ? `${untraced} with no trail` : `${entries.length} answers have a trail`
  );

  const revisited = entries.filter((e) => e._count._all > 1).length;
  check(
    'questions revisited by a second desk keep both entries',
    revisited > 0,
    `${revisited} question(s) carry more than one entry`
  );

  /**
   * NOBODY VERIFIED A CHECKLIST WHO COULD NOT HAVE.
   *
   * Checked from the DATA, against the matrix, by a route the service does not
   * use — which is the whole point of this script. The first enrichment run
   * recorded 1121 verifications against the role key "LTP" and every other
   * check here passed: the all-access demo accounts hold every role, and the
   * service was recording `roleKeys[0]` rather than the role actually being
   * acted in. A screen whose entire purpose is showing which desk said what
   * was saying an LTP verified a checklist, and nothing noticed.
   */
  const reviewRoles = await prisma.checklistReviewEntry.groupBy({
    by: ['actorRoleKey'],
    where: { entryType: 'REVIEW' },
    _count: { _all: true },
  });

  const matrix = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
  const cannotReview = reviewRoles.filter(
    (row) => !(matrix[row.actorRoleKey] ?? []).includes('CHECKLIST_REVIEW')
  );

  check(
    'every checklist verification is attributed to a role that may verify',
    cannotReview.length === 0,
    cannotReview.length
      ? `${cannotReview.map((r) => `${r.actorRoleKey || '(none)'}\u00d7${r._count._all}`).join(', ')} cannot hold CHECKLIST_REVIEW`
      : reviewRoles.map((r) => `${r.actorRoleKey}\u00d7${r._count._all}`).join(', ')
  );

  // And the mirror of it: an answer is the applicant's act.
  const answerRoles = await prisma.checklistReviewEntry.groupBy({
    by: ['actorRoleKey'],
    where: { entryType: 'APPLICANT_RESPONSE' },
    _count: { _all: true },
  });

  const cannotAnswer = answerRoles.filter(
    (row) => !(matrix[row.actorRoleKey] ?? []).includes('CHECKLIST_RESPOND')
  );

  check(
    'every checklist answer is attributed to a role that may answer',
    cannotAnswer.length === 0,
    cannotAnswer.length
      ? `${cannotAnswer.map((r) => `${r.actorRoleKey || '(none)'}\u00d7${r._count._all}`).join(', ')} cannot hold CHECKLIST_RESPOND`
      : answerRoles.map((r) => `${r.actorRoleKey}\u00d7${r._count._all}`).join(', ')
  );

  // The risk category is DERIVED, so it must agree with the answers it was
  // derived from. Recomputed here by hand, from the rows, by a different route
  // than the service used.
  const riskRows = await prisma.applicationChecklistResponse.findMany({
    where: { kind: 'APPLICATION' },
    select: { applicationId: true, response: true, status: true, itemId: true },
  });

  const riskByApp = new Map<string, Array<{ affectsRisk: boolean; response: string; status: string }>>();
  const affectsRisk = new Map(definitions.map((d) => [d.id, d.affectsRisk]));
  for (const row of riskRows) {
    if (!affectsRisk.has(row.itemId)) continue;
    const list = riskByApp.get(row.applicationId) ?? [];
    list.push({
      affectsRisk: affectsRisk.get(row.itemId) ?? false,
      response: row.response,
      status: row.status,
    });
    riskByApp.set(row.applicationId, list);
  }

  const stored = await prisma.application.findMany({
    where: { deletedAt: null, checklistResponses: { some: {} } },
    select: { id: true, applicationNumber: true, riskCategory: true },
  });

  const riskDisagreements = stored.filter(
    (app) => app.riskCategory !== deriveRiskCategory(riskByApp.get(app.id) ?? [])
  );
  check(
    'the stored risk category agrees with the answers it is derived from',
    riskDisagreements.length === 0,
    riskDisagreements.length
      ? `${riskDisagreements.length} disagree, first ${riskDisagreements[0]?.applicationNumber}`
      : `${stored.length} checked`
  );

  // The Others block. `installed` without `proposed` is the one combination
  // the screen cannot explain, and the schema comment says so.
  const others = await prisma.applicationOthers.findMany({
    select: {
      applicationId: true,
      solarProposed: true, solarInstalled: true,
      rwhProposed: true, rwhProvided: true,
      greeningProposed: true, greeningProvided: true,
      solarRequired: true,
    },
  });

  check('applications carry an Others block', others.length > 0, `${others.length} of ${overview.total}`);

  const impossible = others.filter(
    (o) =>
      (o.solarInstalled && !o.solarProposed) ||
      (o.rwhProvided && !o.rwhProposed) ||
      (o.greeningProvided && !o.greeningProposed)
  ).length;
  check(
    'nothing is provided that was never proposed',
    impossible === 0,
    impossible ? `${impossible} impossible combination(s)` : 'no impossible combinations'
  );

  // Not a failure — the state an officer acts on, counted so the demo can be
  // seen to contain some.
  const shortfallWaiting = others.filter((o) => o.solarRequired && !o.solarProposed).length;
  console.log(
    `  · ${shortfallWaiting} application(s) require solar and do not propose it — a shortfall waiting to be raised.`
  );

  // The plot arithmetic. Deliberately seeded with a few disagreements, because
  // the Plot card warns about them and a demo with none never shows the warning.
  const plots = await prisma.propertyDetail.findMany({
    where: { grossPlotAreaSqm: { not: null } },
    select: {
      applicationId: true,
      documentAreaSqm: true, groundAreaSqm: true, grossPlotAreaSqm: true,
      roadWideningDeductionSqm: true, greenBufferDeductionSqm: true,
      surrenderGiftAreaSqm: true, netPlotAreaSqm: true,
    },
  });

  check('applications carry the plot-area chain', plots.length > 0, `${plots.length} with a gross area`);

  const overDeducted = plots.filter((p) => checkPlotAreas(p).overDeducted).length;
  check(
    'no plot has deductions larger than its gross area',
    overDeducted === 0,
    overDeducted ? `${overDeducted} over-deducted` : 'every chain resolves to a positive net'
  );

  const netMismatches = plots.filter((p) => checkPlotAreas(p).netMismatch).length;
  console.log(
    `  · ${netMismatches} of ${plots.length} plots carry a net area that does not follow from their own deductions — ` +
      'seeded on purpose, and what the warning on the Plot card is for.'
  );

  // ── 7. Service standards ──────────────────────────────────────────────
  console.log('\nService standards');

  const sla = await slaSummary(admin);
  const overdueRaw = await prisma.slaInstance.count({
    where: {
      completedAt: null,
      status: 'OVERDUE',
      task: { instance: { application: { deletedAt: null } } },
    },
  });
  eq('overdue clocks match the SLA table', sla.overdue, overdueRaw);

  const overdueButFuture = await prisma.slaInstance.count({
    where: { status: 'OVERDUE', completedAt: null, dueAt: { gt: new Date() } },
  });
  check(
    'nothing is marked overdue whose due date has not passed',
    overdueButFuture === 0,
    `${overdueButFuture} mislabelled`
  );

  // ── 8. Trend ──────────────────────────────────────────────────────────
  console.log('\nTrend');

  const trend = await applicationTrend(admin, 9);
  const createdInWindow = trend.reduce((sum, p) => sum + p.created, 0);

  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  from.setMonth(from.getMonth() - 8);

  const createdRaw = await prisma.application.count({
    where: { deletedAt: null, createdAt: { gte: from } },
  });
  eq('the trend chart counts the same applications as the table', createdInWindow, createdRaw);

  // The chart plots approval EVENTS by `approvedAt`, so it is compared with
  // every file that was ever approved — including one whose permission was
  // later revoked, which was approved in that month all the same.
  const approvedInTrend = trend.reduce((sum, p) => sum + p.approved, 0);
  const everApproved = await prisma.application.count({ where: { deletedAt: null, approvedAt: { not: null } } });
  check(
    'approvals on the chart do not exceed approvals in the table',
    approvedInTrend <= everApproved,
    `${approvedInTrend} charted of ${everApproved} ever approved (${approvedRaw} still approved)`
  );

  // ── 9. The administrator's consolidated view ──────────────────────────
  console.log('\nConsolidation');

  const view = await consolidatedView(admin);

  const deskFiles = view.desks.reduce((sum, d) => sum + d.applications, 0);
  const noStage = await prisma.application.count({
    where: { deletedAt: null, currentStageCode: null },
  });
  eq(
    'desk totals plus files with no stage account for every application',
    deskFiles + noStage,
    overview.total,
    'desks + unstaged',
    'total'
  );

  // The partition the pipeline strip prints. Every file is with the applicant,
  // at a desk, or closed — exactly once. If these stop adding up, the headline
  // panel on the administrator's dashboard is arithmetic nobody can follow.
  const inReview = view.desks
    .filter((d) => !d.isTerminal && d.roleKeys.some((r) => r !== 'LTP'))
    .reduce((sum, d) => sum + d.applications, 0);
  // Every terminal status — APPROVED, REJECTED and PROCEEDING_REVOKED among
  // them — not approved + rejected alone, which undercounts once a status can
  // follow approval.
  const closedTotal = overview.closed;

  eq(
    'with-applicant + at-a-desk + closed partitions the register',
    view.applicantSide.totalWithApplicant + inReview + closedTotal,
    overview.total,
    'partition',
    'total'
  );

  const deskTasks = view.desks.reduce((sum, d) => sum + d.openTasks, 0);
  const rawOpenTasks = await prisma.workflowTask.count({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      instance: { application: { deletedAt: null } },
    },
  });
  eq('desk task counts match the open task queue', deskTasks, rawOpenTasks);

  const deskShortfalls = view.desks.reduce((sum, d) => sum + d.openShortfalls, 0);
  eq(
    'shortfalls attributed to desks match the open shortfalls',
    deskShortfalls,
    shortfalls.open,
    'by desk',
    'open'
  );

  for (const desk of view.desks) {
    check(
      `${desk.label}: claimed + unclaimed equals its open tasks`,
      desk.claimed + desk.unclaimed === desk.openTasks,
      `${desk.claimed} + ${desk.unclaimed} = ${desk.openTasks}`
    );
  }

  const rawUsers = await prisma.user.count({ where: { deletedAt: null } });
  eq('account summary counts every live user', view.accounts.totals.users, rawUsers);

  const filerTotal = view.filers.reduce((sum, f) => sum + f.total, 0);
  check(
    'the filer breakdown never claims more files than exist',
    filerTotal <= overview.total,
    `${filerTotal} across ${view.filers.length} filers, of ${overview.total}`
  );

  // ── 10. Dates ─────────────────────────────────────────────────────────
  console.log('\nChronology');

  const backwards = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM applications
     WHERE "deletedAt" IS NULL
       AND (
         ("submittedAt" IS NOT NULL AND "submittedAt" < "createdAt")
         OR ("approvedAt" IS NOT NULL AND "approvedAt" < "submittedAt")
         OR ("rejectedAt" IS NOT NULL AND "rejectedAt" < "submittedAt")
       )
  `;
  check(
    'no application was decided before it was filed',
    Number(backwards[0]?.n ?? 0) === 0,
    `${Number(backwards[0]?.n ?? 0)} out of order`
  );

  const eventsBeforeApplication = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM application_events e
      JOIN applications a ON a.id = e."applicationId"
     WHERE e."occurredAt" < a."createdAt" - interval '1 second'
  `;
  check(
    'no timeline entry predates its application',
    Number(eventsBeforeApplication[0]?.n ?? 0) === 0,
    `${Number(eventsBeforeApplication[0]?.n ?? 0)} early`
  );

  const futureDated = await prisma.application.count({
    where: { deletedAt: null, createdAt: { gt: new Date(Date.now() + 60_000) } },
  });
  check('nothing is dated in the future', futureDated === 0);

  // ── Site inspection ───────────────────────────────────────────────────
  console.log('\nSite inspection');
  {
    const admin = await superAdmin();
    const inspections = await prisma.siteInspection.findMany({
      include: {
        responses: true,
        photos: true,
        application: { select: { applicationNumber: true, currentStageCode: true, deletedAt: true } },
      },
    });
    const live = inspections.filter((i) => !i.application.deletedAt);
    const open = live.filter((i) => i.status !== 'SUBMITTED');
    const submitted = live.filter((i) => i.status === 'SUBMITTED');

    const [register, summary] = await Promise.all([listInspections(admin, { pageSize: 100 }), inspectionSummary(admin)]);
    eq('register total matches the table', register.total, live.length, 'register');
    eq('summary: submitted', summary.submitted, submitted.length, 'summary');
    eq('summary: pending', summary.scheduled + summary.inProgress, open.length, 'summary');

    const expectedQuestions = await prisma.checklistItemDefinition.count({ where: { kind: 'SITE_INSPECTION', isActive: true } });
    const wrongCount = live.filter((i) => i.responses.length !== expectedQuestions && i.status !== 'SUBMITTED');
    check(`every open report carries the ${expectedQuestions} questions`, wrongCount.length === 0, wrongCount.map((i) => i.inspectionNumber).join(', '));

    const multipleOpen = new Map<string, number>();
    for (const i of open) multipleOpen.set(i.applicationId, (multipleOpen.get(i.applicationId) ?? 0) + 1);
    check('no application has two open inspections', [...multipleOpen.values()].every((n) => n === 1));

    const misplaced = open.filter((i) => i.application.currentStageCode !== 'TPA_SITE_INSPECTION');
    check('every open inspection’s file is at the site inspection desk', misplaced.length === 0, misplaced.map((i) => i.inspectionNumber).join(', '));

    const unlocked = submitted.filter((i) => !i.lockedAt || !i.signedAt || !i.signatureMethod || !i.documentHash);
    check('every submitted report is signed and locked', unlocked.length === 0, unlocked.map((i) => i.inspectionNumber).join(', '));

    const tampered = submitted.filter((i) => {
      const hash = createHash('sha256')
        .update(
          canonicalReport({
            inspectionNumber: i.inspectionNumber,
            applicationNumber: i.application.applicationNumber,
            round: i.round,
            inspectorName: i.inspectorName,
            scheduledFor: i.scheduledFor,
            inspectedAt: i.inspectedAt,
            latitude: i.latitude,
            longitude: i.longitude,
            generalObservation: i.generalObservation,
            recommendation: i.recommendation,
            recommendationRemarks: i.recommendationRemarks,
            responses: i.responses,
            photos: i.photos,
          })
        )
        .digest('hex');
      return hash !== i.documentHash;
    });
    check('every signed report still matches its hash', tampered.length === 0, tampered.map((i) => i.inspectionNumber).join(', '));

    const unready = submitted.filter(
      (i) =>
        inspectionReadiness({
          scheduledOn: i.createdAt,
          inspectedAt: i.inspectedAt,
          latitude: i.latitude,
          longitude: i.longitude,
          recommendation: i.recommendation,
          recommendationRemarks: i.recommendationRemarks,
          responses: i.responses,
          photos: i.photos,
          now: i.signedAt ?? new Date(),
        }).length > 0
    );
    check('every signed report passes the readiness rules', unready.length === 0, unready.map((i) => i.inspectionNumber).join(', '));

    const unrouted = [];
    for (const i of submitted) {
      const history = i.submitSequence
        ? await prisma.workflowHistory.findFirst({
            where: { instance: { applicationId: i.applicationId }, sequence: i.submitSequence },
            select: { actionCode: true },
          })
        : null;
      const expected = RECOMMENDATION_ACTION[i.recommendation as Recommendation];
      if (!i.routedAt || history?.actionCode !== expected || i.routedActionCode !== expected) unrouted.push(i.inspectionNumber);
    }
    check('every signed report moved the file by the action its recommendation calls for', unrouted.length === 0, unrouted.join(', '));

    const shortfallLess = submitted.filter((i) => i.recommendation === 'SHORTFALL' && !i.shortfallId);
    check('every SHORTFALL recommendation raised a shortfall', shortfallLess.length === 0, shortfallLess.map((i) => i.inspectionNumber).join(', '));

    const nonDemo = live.filter((i) => i.locationSource !== 'DEMO' || i.photos.some((p) => !p.isDemoLocation));
    check('every coordinate is labelled DEMO', nonDemo.length === 0);
    console.log(`    ${live.length} inspections · ${open.length} pending · ${submitted.length} submitted`);
  }

  // ── NOCs ──────────────────────────────────────────────────────────────
  console.log('\nNOCs');
  {
    const admin = await superAdmin();
    const nocs = await prisma.applicationNoc.findMany({
      include: {
        nocType: true,
        events: { orderBy: { occurredAt: 'asc' } },
        application: { select: { deletedAt: true } },
      },
    });
    const live = nocs.filter((n) => !n.application.deletedAt);
    const outstanding = live.filter((n) => (OUTSTANDING_NOC_STATUSES as readonly string[]).includes(n.status));

    const [register, summary, dash] = await Promise.all([
      listNocs(admin, { pageSize: 100 }),
      nocSummary(admin),
      nocDashboardSummary(admin),
    ]);
    eq('register total matches the table', register.total, live.length, 'register');
    eq('summary: NOCs pending', summary.pending, outstanding.length, 'summary');
    eq('dashboard "NOCs pending" matches the register summary', dash.pending, summary.pending, 'dashboard', 'register');

    const unknown = live.filter((n) => !(NOC_STATUSES as readonly string[]).includes(n.status));
    check('every NOC carries a known status', unknown.length === 0, unknown.map((n) => n.nocNumber).join(', '));

    const demoStates = ['NOT_REQUIRED', 'PENDING', 'APPLIED', 'RECEIVED', 'VERIFIED', 'SHORTFALL'];
    const missing = demoStates.filter((st) => !live.some((n) => n.status === st));
    check('the demo shows every Fire NOC state', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : demoStates.join(' · '));

    const badRequired = live.filter(
      (n) =>
        (n.status === 'NOT_REQUIRED' && n.isRequired !== false) ||
        (n.status === 'PENDING' && n.isRequired !== null) ||
        (!['NOT_REQUIRED', 'PENDING'].includes(n.status) && n.status !== 'APPLIED' && n.status !== 'RECEIVED' && n.status !== 'EXPIRED' && n.isRequired !== true)
    );
    check('Required agrees with the status', badRequired.length === 0, badRequired.map((n) => `${n.nocNumber}:${n.status}`).join(', '));

    const unverified = live.filter(
      (n) =>
        n.status === 'VERIFIED' &&
        (!n.verifiedAt ||
          !n.verifiedByName ||
          verificationProblems(
            {
              referenceNumber: n.referenceNumber,
              issuedDate: n.issuedDate,
              expiryDate: n.expiryDate,
              hasDocument: Boolean(n.fileObjectId) || n.isDemoDocument,
              requiresExpiry: n.nocType.requiresExpiry,
            },
            n.verifiedAt ?? new Date()
          ).length > 0)
    );
    check('every verified NOC was complete when verified, and names its verifier', unverified.length === 0, unverified.map((n) => n.nocNumber).join(', '));

    const verifierRoles = new Set(
      Object.entries(RBAC_MATRIX)
        .filter(([, caps]) => (caps as readonly string[]).includes('NOC_VERIFY'))
        .map(([role]) => role)
    );
    const wrongVerifier = live.filter((n) => n.verifiedAt && !verifierRoles.has(n.verifiedByRoleKey));
    check('every verification was made by a role holding NOC_VERIFY', wrongVerifier.length === 0, wrongVerifier.map((n) => n.nocNumber).join(', '));

    const stale = live.filter((n) => ['RECEIVED', 'VERIFIED'].includes(n.status) && n.expiryDate && n.expiryDate < new Date());
    check('no lapsed certificate still reads Received or Verified', stale.length === 0, stale.map((n) => n.nocNumber).join(', '));

    const historyless = live.filter((n) => !n.events.length || n.events[n.events.length - 1]!.toStatus !== n.status);
    check('every NOC’s history ends at its current status', historyless.length === 0, historyless.map((n) => n.nocNumber).join(', '));

    const demoDocs = live.filter((n) => n.isDemoDocument);
    check('every demo certificate is a placeholder, not a stored file', demoDocs.every((n) => !n.fileObjectId));

    const dup = new Set<string>();
    let duplicates = 0;
    for (const n of live) {
      const k = `${n.applicationId}:${n.nocTypeId}`;
      if (dup.has(k)) duplicates += 1;
      dup.add(k);
    }
    check('no application carries the same NOC type twice', duplicates === 0);
    console.log(`    ${live.length} NOCs · ${outstanding.length} pending · ${summary.verified} verified · ${summary.notRequired} not required`);
  }

  // ── Show cause, revocation, outward (Phase 7) ─────────────────────────
  console.log('\nShow cause · Revocation · Outward');
  {
    const admin = await superAdmin();
    const [notices, revocations, outward, shortfalls] = await Promise.all([
      prisma.showCauseNotice.findMany({ include: { application: { select: { deletedAt: true } } } }),
      prisma.revocationProceeding.findMany({ include: { application: { select: { deletedAt: true, status: true, approvedAt: true } } } }),
      prisma.outwardEntry.findMany(),
      prisma.shortfall.findMany({ select: { shortfallNumber: true, historyId: true } }),
    ]);
    const live = notices.filter((n) => !n.application.deletedAt);

    // Shortfall ≠ Show Cause
    const noticeNumbers = new Set(notices.map((n) => n.noticeNumber));
    const shared = shortfalls.filter((sf) => noticeNumbers.has(sf.shortfallNumber) || sf.shortfallNumber.startsWith('SCN/'));
    check('Shortfall ≠ Show Cause: no show cause number is a shortfall number', shared.length === 0, shared.map((x) => x.shortfallNumber).join(', '));

    const scHistory = await prisma.workflowHistory.findMany({
      where: { actionCode: { in: ['ISSUE_SHOW_CAUSE', 'DECIDE_SHOW_CAUSE'] } },
      select: { id: true, instanceId: true, sequence: true, actionCode: true, effectsApplied: true, instance: { select: { applicationId: true } } },
    });
    const scHistoryIds = new Set(scHistory.map((h) => h.id));
    const raisedByShowCause = shortfalls.filter((sf) => sf.historyId && scHistoryIds.has(sf.historyId));
    const effectLeak = scHistory.filter((h) => Array.isArray(h.effectsApplied) && (h.effectsApplied as Array<{ type?: string }>).some((e) => e?.type === 'RAISE_SHORTFALL'));
    check(
      'Shortfall ≠ Show Cause: no show cause transition raised a shortfall',
      raisedByShowCause.length === 0 && effectLeak.length === 0,
      `${scHistory.length} show cause transitions checked`
    );
    const scTransitions = await prisma.workflowTransition.findMany({
      where: { isActive: true, action: { code: { in: ['ISSUE_SHOW_CAUSE', 'DECIDE_SHOW_CAUSE'] } } },
      select: { effects: true },
    });
    check(
      'Shortfall ≠ Show Cause: no show cause transition is configured with a shortfall effect',
      scTransitions.length > 0 &&
        scTransitions.every((t) => !(t.effects as Array<{ type?: string }>).some((e) => String(e?.type).includes('SHORTFALL'))),
      `${scTransitions.length} configured transitions`
    );

    // Routing lives in workflow rows: every issued/decided notice has its workflow history row.
    const bySeq = new Map(scHistory.map((h) => [`${h.instance.applicationId}:${h.sequence}`, h.actionCode]));
    const unrouted = live.filter(
      (n) =>
        bySeq.get(`${n.applicationId}:${n.issueSequence}`) !== 'ISSUE_SHOW_CAUSE' ||
        (n.decidedAt && bySeq.get(`${n.applicationId}:${n.decisionSequence}`) !== 'DECIDE_SHOW_CAUSE')
    );
    check('every notice was issued (and decided) by a workflow transition', unrouted.length === 0, unrouted.map((n) => n.noticeNumber).join(', '));

    // Every later step is a workflow row too. RESPOND_SHOW_CAUSE and
    // TAKE_UP_SHOW_CAUSE became transitions after the first demo notices were
    // answered; a response or review recorded before its action existed has
    // no row and is listed, not hidden. One recorded AFTER is a bypass and fails.
    const stepActions = await prisma.workflowAction.findMany({
      where: { code: { in: ['RESPOND_SHOW_CAUSE', 'TAKE_UP_SHOW_CAUSE'] } },
      select: { code: true, transitions: { orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } } },
    });
    const since = new Map(stepActions.map((a) => [a.code, a.transitions[0]?.createdAt ?? null]));
    const stepRows = await prisma.workflowHistory.findMany({
      where: { actionCode: { in: ['RESPOND_SHOW_CAUSE', 'TAKE_UP_SHOW_CAUSE'] } },
      select: { actionCode: true, actorId: true, actorRoleKey: true, effectsApplied: true, instance: { select: { application: { select: { ltpUserId: true } } } } },
    });
    const stepOf = (code: string, noticeId: string) =>
      stepRows.find(
        (h) => h.actionCode === code && (h.effectsApplied as Array<{ showCauseId?: string }>).some((e) => e?.showCauseId === noticeId)
      );
    const bypassed: string[] = [];
    const legacy: string[] = [];
    for (const n of live) {
      for (const [code, at] of [['RESPOND_SHOW_CAUSE', n.respondedAt], ['TAKE_UP_SHOW_CAUSE', n.reviewStartedAt]] as const) {
        if (!at || stepOf(code, n.id)) continue;
        const existed = since.get(code);
        (existed && at >= existed ? bypassed : legacy).push(`${n.noticeNumber}:${code}`);
      }
    }
    check('every show cause response and review since the branch was configured is a workflow transition', bypassed.length === 0, bypassed.join(', ') || `${stepRows.length} step rows`);
    if (legacy.length) console.log(`    · recorded before the step was a workflow transition (earlier Phase 7 demo data, not rewritten): ${legacy.join(', ')}`);
    const wrongActor = stepRows.filter(
      (h) => h.actionCode === 'RESPOND_SHOW_CAUSE' && (h.actorRoleKey !== 'LTP' || h.actorId !== h.instance.application.ltpUserId)
    );
    check('every show cause response is recorded in the name of the file’s own applicant', wrongActor.length === 0);

    // The branches are configuration, and optional
    const bbas = await prisma.workflowTransition.findMany({
      where: { isActive: true, workflow: { code: 'BBAS_STANDARD' } },
      select: { guards: true, effects: true, action: { select: { code: true } }, fromStage: { select: { code: true } }, toStage: { select: { code: true } } },
    });
    const branchCodes = ['ISSUE_SHOW_CAUSE', 'RESPOND_SHOW_CAUSE', 'TAKE_UP_SHOW_CAUSE', 'DECIDE_SHOW_CAUSE', 'INITIATE_REVOCATION', 'TAKE_UP_REVOCATION', 'REVOKE_PROCEEDING', 'REJECT_REVOCATION'];
    const unconfigured = branchCodes.filter((c) => !bbas.some((t) => t.action.code === c));
    check('BBAS_STANDARD carries every show cause and revoke step as a workflow transition', unconfigured.length === 0, unconfigured.join(', ') || `${bbas.filter((t) => branchCodes.includes(t.action.code)).length} rows`);
    const moving = bbas.filter(
      (t) => branchCodes.includes(t.action.code) && t.action.code !== 'REVOKE_PROCEEDING' && t.toStage?.code !== t.fromStage.code
    );
    check('no show cause or revoke step moves the file, except the revocation itself', moving.length === 0, moving.map((t) => `${t.fromStage.code}:${t.action.code}`).join(', '));
    const mandatory = bbas.filter(
      (t) =>
        !branchCodes.includes(t.action.code) &&
        ((t.guards as string[]).some((g) => /^(show_cause|revocation)_/.test(g)) ||
          (t.effects as Array<{ type?: string }>).some((e) => e?.type === 'SHOW_CAUSE' || e?.type === 'REVOCATION'))
    );
    check('neither branch is a required step of the normal chain', mandatory.length === 0, mandatory.map((t) => `${t.fromStage.code}:${t.action.code}`).join(', '));

    // Show Cause → Outward
    const outBySource = new Map<string, typeof outward>();
    for (const o of outward) outBySource.set(o.sourceId, [...(outBySource.get(o.sourceId) ?? []), o]);
    const noOutward = live.filter((n) => {
      const rows = (outBySource.get(n.id) ?? []).filter((o) => o.documentType === 'SHOW_CAUSE_NOTICE');
      return rows.length !== 1 || rows[0]!.documentReference !== n.noticeNumber;
    });
    check('Show Cause → Outward: every notice has exactly one Outward entry', noOutward.length === 0, noOutward.map((n) => n.noticeNumber).join(', ') || `${live.length} notices`);
    const answeredUndispatched = live.filter(
      (n) => n.status !== 'ISSUED' && !(outBySource.get(n.id) ?? []).some((o) => o.dispatchDate)
    );
    check('no notice is awaiting or past response without having been dispatched', answeredUndispatched.length === 0, answeredUndispatched.map((n) => n.noticeNumber).join(', '));

    // Revoke → Outward
    const revoked = revocations.filter((r) => r.status === 'REVOKED' && !r.application.deletedAt);
    const orderless = revoked.filter(
      (r) => !r.revocationOrderNumber || !(outBySource.get(r.id) ?? []).some((o) => o.documentType === 'REVOCATION_ORDER' && o.documentReference === r.revocationOrderNumber)
    );
    check('Revoke → Outward: every revocation order is in Outward', orderless.length === 0, orderless.map((r) => r.revocationNumber).join(', ') || `${revoked.length} revoked`);

    // Approval history remains intact
    const revokedApps = await prisma.application.findMany({
      where: { deletedAt: null, status: 'PROCEEDING_REVOKED' },
      select: {
        id: true,
        applicationNumber: true,
        approvedAt: true,
        currentStageCode: true,
        approvalOrder: { select: { status: true, revokedAt: true, snapshot: true } },
        workflowInstance: { select: { status: true, history: { orderBy: { sequence: 'asc' }, select: { sequence: true, actionCode: true } } } },
      },
    });
    const broken = revokedApps.filter((a) => {
      const h = a.workflowInstance?.history ?? [];
      const approveAt = h.findIndex((x) => x.actionCode === 'APPROVE');
      const revokeAt = h.findIndex((x) => x.actionCode === 'REVOKE_PROCEEDING');
      const contiguous = h.every((x, i) => x.sequence === i + 1);
      return (
        !a.approvedAt ||
        approveAt < 0 ||
        revokeAt <= approveAt ||
        !contiguous ||
        !a.approvalOrder ||
        a.approvalOrder.status !== 'REVOKED' ||
        !a.approvalOrder.revokedAt ||
        a.currentStageCode !== 'CLOSED_REVOKED' ||
        a.workflowInstance?.status !== 'COMPLETED'
      );
    });
    check(
      'Approval history intact: every revoked file keeps its approval, its date, its order and an unbroken history',
      revokedApps.length > 0 && broken.length === 0,
      broken.length ? broken.map((a) => a.applicationNumber).join(', ') : `${revokedApps.length} revoked file(s)`
    );
    const revokedWithoutProceeding = revokedApps.filter((a) => !revocations.some((r) => r.applicationId === a.id && r.status === 'REVOKED'));
    check(
      'every PROCEEDING_REVOKED file has a decided revocation behind it',
      revokedWithoutProceeding.length === 0,
      revokedWithoutProceeding.map((a) => a.applicationNumber).join(', ')
    );

    // Audit
    const needed = [
      'SHOW_CAUSE_ISSUED',
      'SHOW_CAUSE_RESPONDED',
      'SHOW_CAUSE_DECIDED',
      'OUTWARD_CREATED',
      'OUTWARD_DISPATCHED',
      'REVOCATION_INITIATED',
      'REVOCATION_APPROVED',
      'PROCEEDING_REVOKED',
    ];
    const audited = await prisma.auditLog.groupBy({ by: ['action'], where: { action: { in: needed } }, _count: { _all: true } });
    const have = new Set(audited.map((a) => a.action));
    const missingAudit = needed.filter((a) => !have.has(a));
    check('every Phase 7 audit event is recorded', missingAudit.length === 0, missingAudit.length ? `missing ${missingAudit.join(', ')}` : needed.join(' · '));
    const issuedAudits = audited.find((a) => a.action === 'SHOW_CAUSE_ISSUED')?._count._all ?? 0;
    eq('one SHOW_CAUSE_ISSUED audit row per notice', issuedAudits, notices.length, 'audit', 'notices');

    // The demo states
    const states: Array<[string, boolean]> = [
      ['show cause pending', live.some((n) => n.status === 'AWAITING_RESPONSE')],
      ['show cause response', live.some((n) => n.status === 'RESPONDED')],
      ['show cause under review', live.some((n) => n.status === 'UNDER_REVIEW')],
      ['show cause closed', live.some((n) => n.status === 'CLOSED')],
      ['revocation pending', revocations.some((r) => r.status === 'PROPOSED' || r.status === 'UNDER_REVIEW')],
      ['revoked proceeding', revokedApps.length > 0],
      ['outward dispatched', outward.some((o) => o.status === 'DISPATCHED')],
      ['outward acknowledged', outward.some((o) => o.status === 'ACKNOWLEDGED')],
    ];
    const absent = states.filter(([, ok]) => !ok).map(([n]) => n);
    check('the demo shows every Phase 7 example', absent.length === 0, absent.length ? `missing ${absent.join(', ')}` : states.map(([n]) => n).join(' · '));

    // Registers agree with a hand count
    const [scList, scSum, revList, outList] = await Promise.all([
      listShowCauses(admin, { pageSize: 100 }),
      showCauseSummary(admin),
      listRevocations(admin, { pageSize: 100 }),
      listOutward(admin, { pageSize: 100 }),
    ]);
    eq('show cause register total matches the table', scList.total, live.length, 'register');
    eq('show cause summary: open', scSum.open, live.filter((n) => isShowCauseOpen(n.status)).length, 'summary');
    eq('revocation register total matches the table', revList.total, revocations.filter((r) => !r.application.deletedAt).length, 'register');
    eq('outward register total matches the table', outList.total, outward.length, 'register');
    console.log(`    ${live.length} notices · ${revocations.length} revocations (${revoked.length} revoked) · ${outward.length} outward entries`);
  }

  // ── Result ────────────────────────────────────────────────────────────
  console.log(
    `\n${failures === 0 ? 'All' : `${checks - failures} of`} ${checks} checks passed${failures ? `, ${failures} FAILED` : ''}.\n`
  );

  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\nReconciliation could not run:\n', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
