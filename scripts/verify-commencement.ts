/**
 * PHASE 9 VERIFICATION — Work Initiated (commencement of work).
 *
 *   npm run commencement:verify
 *
 * Read-only against the data. The refusals it provokes are refused before
 * anything is written, or inside a transaction that is rolled back — and the
 * script counts the rows afterwards to prove it.
 *
 *   · the demo shows each state      proceeding issued, pending, work initiated
 *   · every notice                    one workflow step, by the file's LTP, that
 *                                     did not move the file; audited; WORK_INITIATED
 *                                     emitted and delivered; order ISSUED; date
 *                                     within the permission
 *   · NO WORK BEFORE APPROVAL         a file still under review, a file whose
 *                                     order is not issued, a revoked file, a
 *                                     second notice, a date before the order —
 *                                     each refused by the service AND by the
 *                                     workflow engine on its own
 *   · access                          an officer cannot notify; another LTP
 *                                     cannot see the file
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { performSystemActionInTx } from '../src/server/workflow/engine';
import { listWorkCommencements, notifyWorkCommencement } from '../src/server/services/work-commencements';

const prisma = new PrismaClient();
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const META = { ip: '127.0.0.1', userAgent: 'verify-commencement', correlationId: 'phase9-verify' };
const ROLLBACK = '__rollback__';

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function actorFor(userId: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });
  const roleKeys = u.roles.map((r) => r.role.key);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleKeys: roleKeys as never,
    roleNames: u.roles.map((r) => r.role.name),
    capabilities: [...new Set(roleKeys.flatMap((k) => MATRIX[k] ?? []))],
    zoneIds: [...new Set([...(u.primaryZoneId ? [u.primaryZoneId] : []), ...u.jurisdictions.map((j) => j.zoneId)])],
    officeId: u.officeId ?? null,
    sessionId: 'verify',
  };
}

/**
 * A real account holding the role (in the zone). FEWEST roles wins: the demo's
 * all-roles System Administrator also holds LTP, and a refusal test run as it
 * would be testing nothing — it would pass, and write.
 */
async function userWithRole(roleKey: string, zoneId?: string | null) {
  const c = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: roleKey } } },
      ...(zoneId ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, _count: { select: { roles: true } } },
  });
  const u = c.sort((a, b) => a._count.roles - b._count.roles)[0];
  return u ? actorFor(u.id) : null;
}

/** The refusal message, or '' if it was NOT refused. */
async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const payload = (date: string) => ({
  commencementDate: date,
  contractor: { name: 'Verification Contractor', licenceNo: '', phone: '', address: '' },
  documents: [
    { kind: 'COMMENCEMENT_NOTICE', fileObjectId: null, fileName: 'verify-DEMO.pdf', mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: '', addedByName: '' },
  ],
});

/**
 * Asks the ENGINE directly — no service in front of it — inside a transaction
 * that is always rolled back. `prepare` may alter the file first (also rolled
 * back). Returns the engine's refusal, or '' if it would have accepted.
 */
async function engineRefuses(
  applicationId: string,
  ltpUserId: string,
  date: string,
  prepare?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>
): Promise<string> {
  const ltp = await prisma.user.findUniqueOrThrow({ where: { id: ltpUserId }, select: { id: true, name: true } });
  let message = '';
  try {
    await prisma.$transaction(
      async (tx) => {
        if (prepare) await prepare(tx);
        try {
          await performSystemActionInTx(tx, {
            applicationId,
            actionCode: 'NOTIFY_WORK_COMMENCEMENT',
            input: { remarks: '', proceeding: payload(date) },
            meta: META,
            onBehalfOf: { id: ltp.id, name: ltp.name, roleKey: 'LTP' },
          });
          message = '';
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
        }
        throw new Error(ROLLBACK);
      },
      { timeout: 25_000, maxWait: 10_000 }
    );
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) message = message || (e instanceof Error ? e.message : String(e));
  }
  return message;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const today = day(new Date());
  const notices = await prisma.workCommencement.findMany({
    orderBy: { commencementNumber: 'asc' },
    include: {
      application: {
        select: {
          id: true,
          applicationNumber: true,
          status: true,
          currentStageCode: true,
          ltpUserId: true,
          zoneId: true,
          approvalOrder: { select: { id: true, status: true, issuedAt: true, validUntil: true, revokedAt: true } },
        },
      },
    },
  });

  // ── The register ─────────────────────────────────────────────────────
  console.log('\nRegister');
  const admin = await userWithRole('SYSTEM_ADMIN');
  if (!admin) throw new Error('No System Administrator account to read the register with.');
  const states = new Map<string, number>();
  for (let page = 1; ; page += 1) {
    const list = await listWorkCommencements(admin, { page, pageSize: 100 });
    for (const r of list.rows) states.set(r.state, (states.get(r.state) ?? 0) + 1);
    if (page >= list.totalPages) break;
  }
  console.log(`  ${[...states].map(([s, n]) => `${s}: ${n}`).join(' · ')}`);
  for (const s of ['PROCEEDING_ISSUED', 'PENDING_COMMENCEMENT', 'WORK_INITIATED']) {
    check(`demo shows at least one file at ${s}`, (states.get(s) ?? 0) > 0);
  }

  // ── Every notice ─────────────────────────────────────────────────────
  console.log(`\n${notices.length} commencement notice(s)`);
  for (const n of notices) {
    const app = n.application;
    console.log(`\n${n.commencementNumber} · ${app.applicationNumber} · commencing ${day(n.commencementDate)}`);
    const history = await prisma.workflowHistory.findMany({
      where: { instance: { applicationId: app.id }, actionCode: 'NOTIFY_WORK_COMMENCEMENT' },
      select: { sequence: true, actorId: true, actorRoleKey: true, fromStageCode: true, toStageCode: true, fromStatus: true, toStatus: true },
    });
    check('exactly one workflow step recorded it', history.length === 1, `${history.length}`);
    const h = history[0];
    check('the step is the one the notice names', h?.sequence === n.workflowSequence);
    check('given by the file’s LTP, as LTP', h?.actorId === n.notifiedById && n.notifiedById === app.ltpUserId && h?.actorRoleKey === 'LTP');
    check('the file did not move (CLOSED_APPROVED, APPROVED)', h?.fromStageCode === 'CLOSED_APPROVED' && h?.toStageCode === 'CLOSED_APPROVED' && h?.fromStatus === 'APPROVED' && h?.toStatus === 'APPROVED');
    check('the file is still approved', app.status === 'APPROVED' && app.currentStageCode === 'CLOSED_APPROVED', `${app.status} @ ${app.currentStageCode}`);
    check('worked under an ISSUED, unrevoked order', app.approvalOrder?.status === 'ISSUED' && !app.approvalOrder.revokedAt && app.approvalOrder.id === n.approvalOrderId);
    check(
      'commencement date within the permission',
      day(n.commencementDate) >= day(n.orderIssuedAt) && (!n.orderValidUntil || day(n.commencementDate) <= day(n.orderValidUntil))
    );
    check('notice given after the order was issued', n.notifiedAt.getTime() >= n.orderIssuedAt.getTime());
    check('contractor and signed notice on record', n.contractorName.length > 1 && (n.documents as Array<{ kind: string }>).some((d) => d.kind === 'COMMENCEMENT_NOTICE'));

    const audits = await prisma.auditLog.findMany({ where: { applicationId: app.id, action: 'WORK_COMMENCEMENT_NOTIFIED' }, select: { entityId: true } });
    check('audited (WORK_COMMENCEMENT_NOTIFIED)', audits.length === 1 && audits[0]!.entityId === n.id);
    const events = await prisma.outboxEvent.findMany({ where: { applicationId: app.id, eventCode: 'WORK_INITIATED' }, select: { processed: true } });
    check('WORK_INITIATED emitted once', events.length === 1, `${events.length}`);
    check('…and dispatched', events.every((e) => e.processed));
    // Addressed, not necessarily delivered: the dispatcher sends the same event
    // to the same person on the same channel once a minute, so a seed that
    // notifies several of one LTP's files at once records the rest as SKIPPED.
    const addressed = await prisma.notificationLog.count({ where: { applicationId: app.id, eventCode: 'WORK_INITIATED', recipientUserId: app.ltpUserId } });
    check('the LTP was addressed (in-app and email)', addressed >= 1, `${addressed} log row(s)`);
  }

  // ── No work initiated before the applicable approval ─────────────────
  console.log('\nRefusals');
  const before = await prisma.workCommencement.count();
  const historyBefore = await prisma.workflowHistory.count({ where: { actionCode: 'NOTIFY_WORK_COMMENCEMENT' } });

  // 1. A file still under review.
  const underReview = await prisma.application.findFirst({
    where: { deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'PROCEEDING_REVOKED', 'DRAFT', 'WITHDRAWN'] }, workflowInstance: { isNot: null } },
    orderBy: { applicationNumber: 'asc' },
    select: { id: true, applicationNumber: true, status: true, ltpUserId: true },
  });
  if (underReview) {
    const ltp = await actorFor(underReview.ltpUserId);
    const svc = await refused(() =>
      notifyWorkCommencement(ltp, underReview.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
    );
    check(`service refuses a ${underReview.status} file (${underReview.applicationNumber})`, Boolean(svc), svc);
    const eng = await engineRefuses(underReview.id, underReview.ltpUserId, today);
    check('the workflow engine refuses it on its own (no transition before approval)', Boolean(eng), eng);
  } else {
    check('a file under review exists to test against', false);
  }

  // 2. Approved, but the proceeding not issued.
  const pending = await prisma.application.findFirst({
    where: { deletedAt: null, status: 'APPROVED', workCommencement: { is: null }, approvalOrder: { status: 'ISSUED' } },
    orderBy: { applicationNumber: 'asc' },
    select: { id: true, applicationNumber: true, ltpUserId: true, approvalOrder: { select: { id: true, issuedAt: true } } },
  });
  const notIssued = await prisma.application.findFirst({
    where: { deletedAt: null, status: 'APPROVED', OR: [{ approvalOrder: { is: null } }, { approvalOrder: { status: { not: 'ISSUED' } } }] },
    select: { id: true, applicationNumber: true, ltpUserId: true },
  });
  if (notIssued) {
    const ltp = await actorFor(notIssued.ltpUserId);
    const svc = await refused(() =>
      notifyWorkCommencement(ltp, notIssued.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
    );
    check(`service refuses approved ${notIssued.applicationNumber} whose order is not issued`, Boolean(svc), svc);
  }
  if (pending?.approvalOrder) {
    const orderId = pending.approvalOrder.id;
    const eng = await engineRefuses(pending.id, pending.ltpUserId, today, async (tx) => {
      await tx.approvalOrder.update({ where: { id: orderId }, data: { status: 'GENERATED' } });
    });
    check(`engine refuses when the order is not issued (${pending.applicationNumber}, order set back in a rolled-back tx)`, /not been issued/.test(eng), eng);
    const stillIssued = await prisma.approvalOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    check('…and the order is untouched afterwards', stillIssued?.status === 'ISSUED');

    // 5. A date before the order.
    const early = day(new Date(pending.approvalOrder.issuedAt.getTime() - 5 * 86_400_000));
    const ltp = await actorFor(pending.ltpUserId);
    const svc = await refused(() =>
      notifyWorkCommencement(ltp, pending.id, { commencementDate: early, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
    );
    check('service refuses a commencement date before the order', /before/.test(svc), svc);
    const eng2 = await engineRefuses(pending.id, pending.ltpUserId, early);
    check('…and so does the engine', /before/.test(eng2), eng2);

    // Access: an officer cannot notify; another LTP cannot see the file.
    const app = await prisma.application.findUniqueOrThrow({ where: { id: pending.id }, select: { zoneId: true } });
    const tpa = await userWithRole('TPA', app.zoneId);
    if (tpa) {
      const r = await refused(() =>
        notifyWorkCommencement(tpa, pending.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
      );
      check('a TPA cannot notify commencement', Boolean(r), r);
    }
    // An LTP and nothing else — not an account whose other roles see every file.
    const other = await prisma.user.findFirst({
      where: { id: { not: pending.ltpUserId }, status: 'ACTIVE', roles: { some: { role: { key: 'LTP' } }, every: { role: { key: 'LTP' } } } },
      select: { id: true },
    });
    if (other) {
      const r = await refused(async () =>
        notifyWorkCommencement(await actorFor(other.id), pending.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
      );
      check('another LTP cannot reach the file', /could not be found/.test(r), r);
    }
  } else {
    check('an approved file with an issued, un-notified order exists to test against', false);
  }

  // 3. A revoked permission.
  const revoked = await prisma.application.findFirst({ where: { deletedAt: null, status: 'PROCEEDING_REVOKED' }, select: { id: true, applicationNumber: true, ltpUserId: true } });
  if (revoked) {
    const ltp = await actorFor(revoked.ltpUserId);
    const svc = await refused(() =>
      notifyWorkCommencement(ltp, revoked.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
    );
    check(`service refuses revoked ${revoked.applicationNumber}`, Boolean(svc), svc);
    const eng = await engineRefuses(revoked.id, revoked.ltpUserId, today);
    check('…and so does the engine', Boolean(eng), eng);
  } else {
    console.log('  (no revoked file in the data — covered by the unit tests)');
  }

  // 4. A second notice.
  const done = notices[0];
  if (done) {
    const ltp = await actorFor(done.application.ltpUserId);
    const svc = await refused(() =>
      notifyWorkCommencement(ltp, done.application.id, { commencementDate: today, contractorName: 'X Builders', contractorLicenceNo: '', contractorPhone: '', contractorAddress: '', remarks: '', demoDocuments: true, demoKinds: '' }, META)
    );
    check('service refuses a second notice', /already/.test(svc), svc);
    const eng = await engineRefuses(done.application.id, done.application.ltpUserId, today);
    check('…and so does the engine (no_work_commencement)', /already/.test(eng), eng);
  }

  const after = await prisma.workCommencement.count();
  const historyAfter = await prisma.workflowHistory.count({ where: { actionCode: 'NOTIFY_WORK_COMMENCEMENT' } });
  check('no refusal wrote a notice or a workflow step', before === after && historyBefore === historyAfter, `${before}→${after}, ${historyBefore}→${historyAfter}`);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
