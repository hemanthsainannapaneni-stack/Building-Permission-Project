/**
 * PHASE 10 VERIFICATION — occupancy.
 *
 *   npm run occupancy:verify
 *
 * 1. THE FULL FLOW, end to end, through the workflow engine — in ONE
 *    transaction that is rolled back at the end, so it leaves nothing behind:
 *      notify commencement → submit → schedule → inspect (deviations)
 *      → shortfall → answer → schedule → re-inspect → recommend → approve
 *      → issue certificate (+ Outward entry, + PDF)
 *    with the refusals along the way: no submission before the proceeding
 *    is issued or before work commences; no step out of order.
 * 2. REFUSALS through the service: a file still under review, the wrong desk.
 * 3. THE DEMO DATA: every state present; every application's steps are
 *    workflow history rows that did not move the file, audited; every
 *    certificate has its Outward entry and renders as a PDF.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { performSystemActionInTx } from '../src/server/workflow/engine';
import { decideOccupancyApplication, scheduleOccupancyInspection, submitOccupancyApplication } from '../src/server/services/occupancy';
import { renderOccupancyCertificate, type CertificateSnapshot } from '../src/server/occupancy/certificate-pdf';
import { demoAsBuilt, type AsBuiltFigures } from '../src/lib/occupancy';

const prisma = new PrismaClient();
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const META = { ip: '127.0.0.1', userAgent: 'verify-occupancy', correlationId: 'phase10-verify' };
const ROLLBACK = '__rollback__';
const OCC_ACTIONS = [
  'SUBMIT_OCCUPANCY',
  'SCHEDULE_FINAL_INSPECTION',
  'RECORD_FINAL_INSPECTION',
  'RECOMMEND_OCCUPANCY',
  'RAISE_OCCUPANCY_SHORTFALL',
  'RESPOND_OCCUPANCY_SHORTFALL',
  'APPROVE_OCCUPANCY',
  'REJECT_OCCUPANCY',
  'ISSUE_OCCUPANCY_CERTIFICATE',
];

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function actorFor(userId: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: { include: { role: true } }, jurisdictions: true } });
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

async function officer(roleKey: string, zoneId: string | null) {
  const c = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: roleKey } } },
      ...(zoneId ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] } : {}),
    },
    select: { id: true, name: true, _count: { select: { roles: true } } },
  });
  return c.sort((a, b) => a._count.roles - b._count.roles)[0] ?? null;
}

async function refused(fn: () => Promise<unknown>) {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const today = new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// 1. The full flow, rolled back
// ═══════════════════════════════════════════════════════════════════════════

async function fullFlow() {
  console.log('\n1. Full flow through the workflow engine (rolled back)');
  const file = await prisma.application.findFirst({
    where: {
      deletedAt: null,
      status: 'APPROVED',
      currentStageCode: 'CLOSED_APPROVED',
      workflowInstance: { workflow: { code: 'BBAS_STANDARD' } },
      approvalOrder: { is: { status: 'ISSUED', revokedAt: null } },
      occupancies: { none: {} },
      workCommencement: { is: null },
    },
    orderBy: { applicationNumber: 'asc' },
    select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true, approvalOrder: { select: { id: true } } },
  });
  if (!file) {
    check('an approved file with an issued order and no commencement exists for the full-flow test', false);
    return;
  }
  const [ltp, tpa, zdd, zjd] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: file.ltpUserId }, select: { id: true, name: true } }),
    officer('TPA', file.zoneId),
    officer('ZDD', file.zoneId),
    officer('ZJD', file.zoneId),
  ]);
  if (!tpa || !zdd || !zjd) {
    check(`zone of ${file.applicationNumber} has a TPA, ZDD and ZJD`, false);
    return;
  }
  console.log(`  on ${file.applicationNumber} — LTP ${ltp.name}, TPA ${tpa.name}, ZDD ${zdd.name}, ZJD ${zjd.name}`);
  const who = { LTP: ltp, TPA: tpa, ZDD: zdd, ZJD: zjd };
  const doc = (kind: string) => ({ kind, fileObjectId: null, fileName: `${kind.toLowerCase()}-DEMO.pdf`, mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: '', addedByName: '', round: 1 });

  try {
    await prisma.$transaction(
      async (tx) => {
        const step = async (actionCode: string, role: keyof typeof who, proceeding: Record<string, unknown>, remarks = 'Verification step.') =>
          performSystemActionInTx(tx, {
            applicationId: file.id,
            actionCode,
            input: { remarks, proceeding },
            meta: META,
            onBehalfOf: { id: who[role].id, name: who[role].name, roleKey: role },
          });
        const attempt = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
            return '';
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        };
        const status = async () =>
          (await tx.occupancyApplication.findFirst({ where: { applicationId: file.id, isCurrent: true }, select: { status: true } }))?.status ?? '(none)';
        const submitPayload = { completionDate: today, completionRemarks: 'Complete.', documents: [doc('COMPLETION_LETTER'), doc('AS_BUILT_DRAWING')] };

        // Before work has commenced.
        let r = await attempt(() => step('SUBMIT_OCCUPANCY', 'LTP', submitPayload));
        check('refused before work is initiated', /not been notified|not commenced/.test(r), r);

        await step('NOTIFY_WORK_COMMENCEMENT', 'LTP', {
          commencementDate: today,
          contractor: { name: 'Verification Contractor' },
          documents: [{ kind: 'COMMENCEMENT_NOTICE', fileObjectId: null, fileName: 'x-DEMO.pdf', mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: '', addedByName: '' }],
        });

        // Before the proceeding is issued (set back, then restored — all rolled back).
        await tx.approvalOrder.update({ where: { id: file.approvalOrder!.id }, data: { status: 'GENERATED' } });
        r = await attempt(() => step('SUBMIT_OCCUPANCY', 'LTP', submitPayload));
        check('refused while the BPO is not issued', /not been issued/.test(r), r);
        await tx.approvalOrder.update({ where: { id: file.approvalOrder!.id }, data: { status: 'ISSUED' } });

        // Out of order: no certificate, no inspection before their turn.
        r = await attempt(() => step('ISSUE_OCCUPANCY_CERTIFICATE', 'ZJD', {}));
        check('certificate refused before any application', Boolean(r), r);

        await step('SUBMIT_OCCUPANCY', 'LTP', submitPayload);
        check('submitted → SUBMITTED', (await status()) === 'SUBMITTED');
        r = await attempt(() => step('SUBMIT_OCCUPANCY', 'LTP', submitPayload));
        check('a second application is refused while one is open', /still open/.test(r), r);
        r = await attempt(() => step('RECORD_FINAL_INSPECTION', 'TPA', {}));
        check('inspection refused before it is scheduled', /No final inspection is booked/.test(r), r);

        await step('SCHEDULE_FINAL_INSPECTION', 'TPA', { scheduledFor: today, inspectorId: tpa.id });
        check('scheduled → INSPECTION_PENDING', (await status()) === 'INSPECTION_PENDING');

        const occ = await tx.occupancyApplication.findFirstOrThrow({ where: { applicationId: file.id, isCurrent: true } });
        const approved = occ.approvedFigures as AsBuiltFigures;
        const inspect = (variant: 'COMPLIANT' | 'DEVIATION', recommendation: string) =>
          step(
            'RECORD_FINAL_INSPECTION',
            'TPA',
            {
              inspectionDate: today,
              siteCondition: 'Complete',
              actualConstruction: variant === 'COMPLIANT' ? 'As approved' : 'Exceeds the sanction',
              deviations: variant === 'COMPLIANT' ? '' : 'Setback built over',
              recommendation,
              asBuilt: demoAsBuilt(approved, occ.id, variant),
              asBuiltSource: 'DEMO',
              photos: [],
            },
            'Inspected.'
          );
        await inspect('DEVIATION', 'RECOMMENDED');
        check('inspected → INSPECTION_COMPLETED', (await status()) === 'INSPECTION_COMPLETED');
        r = await attempt(() => step('APPROVE_OCCUPANCY', 'ZJD', {}, 'Approve'));
        check('decision refused before the as-built review', Boolean(r), r);

        await step('RAISE_OCCUPANCY_SHORTFALL', 'ZDD', { items: ['Remove the structure in the setback.'] }, 'Deviation from the approved plan.');
        check('shortfall → SHORTFALL', (await status()) === 'SHORTFALL');
        await step('RESPOND_OCCUPANCY_SHORTFALL', 'LTP', { documents: [doc('AS_BUILT_DRAWING')] }, 'The structure has been removed.');
        const round2 = await tx.occupancyApplication.findFirstOrThrow({ where: { id: occ.id }, select: { status: true, round: true } });
        check('answered → SUBMITTED, round 2', round2.status === 'SUBMITTED' && round2.round === 2);

        await step('SCHEDULE_FINAL_INSPECTION', 'TPA', { scheduledFor: today, inspectorId: tpa.id });
        await inspect('COMPLIANT', 'RECOMMENDED');
        const inspections = await tx.occupancyInspection.count({ where: { occupancyId: occ.id, status: 'COMPLETED' } });
        check('re-inspected: two completed inspections on record', inspections === 2);

        await step('RECOMMEND_OCCUPANCY', 'ZDD', { recommendation: 'APPROVE' }, 'Within tolerance.');
        check('recommended → RECOMMENDED', (await status()) === 'RECOMMENDED');
        await step('APPROVE_OCCUPANCY', 'ZJD', {}, 'Approved.');
        check('approved → APPROVED', (await status()) === 'APPROVED');
        await step('ISSUE_OCCUPANCY_CERTIFICATE', 'ZJD', {});
        const done = await tx.occupancyApplication.findFirstOrThrow({ where: { id: occ.id } });
        check('issued → CERTIFICATE_ISSUED with a certificate number', done.status === 'CERTIFICATE_ISSUED' && /^OC\/\d{4}\/\d{6}$/.test(done.certificateNumber ?? ''), done.certificateNumber ?? '');
        check('approved and completed areas recorded', done.approvedAreaSqm != null && done.completedAreaSqm != null);

        const out = done.outwardEntryId ? await tx.outwardEntry.findUnique({ where: { id: done.outwardEntryId } }) : null;
        check(
          'Outward entry created: OCCUPANCY_CERTIFICATE, ready for dispatch',
          out?.documentType === 'OCCUPANCY_CERTIFICATE' && out.status === 'READY_FOR_DISPATCH' && out.documentReference === done.certificateNumber && out.outwardNumber === done.outwardNumber
        );
        const pdf = renderOccupancyCertificate(done.certificateSnapshot as unknown as CertificateSnapshot);
        check('certificate renders as a PDF', pdf.subarray(0, 4).toString() === '%PDF', `${pdf.byteLength} bytes`);

        r = await attempt(() => step('SUBMIT_OCCUPANCY', 'LTP', submitPayload));
        check('no application after a certificate', /already been issued/.test(r), r);

        const app = await tx.application.findUniqueOrThrow({ where: { id: file.id }, select: { status: true, currentStageCode: true } });
        check('the file never moved (APPROVED at CLOSED_APPROVED)', app.status === 'APPROVED' && app.currentStageCode === 'CLOSED_APPROVED');
        const history = await tx.workflowHistory.findMany({
          where: { instance: { applicationId: file.id }, actionCode: { in: OCC_ACTIONS } },
          orderBy: { sequence: 'asc' },
          select: { actionCode: true, actorRoleKey: true, fromStatus: true, toStatus: true },
        });
        const expected = [
          'SUBMIT_OCCUPANCY:LTP',
          'SCHEDULE_FINAL_INSPECTION:TPA',
          'RECORD_FINAL_INSPECTION:TPA',
          'RAISE_OCCUPANCY_SHORTFALL:ZDD',
          'RESPOND_OCCUPANCY_SHORTFALL:LTP',
          'SCHEDULE_FINAL_INSPECTION:TPA',
          'RECORD_FINAL_INSPECTION:TPA',
          'RECOMMEND_OCCUPANCY:ZDD',
          'APPROVE_OCCUPANCY:ZJD',
          'ISSUE_OCCUPANCY_CERTIFICATE:ZJD',
        ];
        const got = history.map((h) => `${h.actionCode}:${h.actorRoleKey}`);
        check('ten workflow steps recorded in order, each by its desk (refusals recorded nothing)', JSON.stringify(got) === JSON.stringify(expected), got.join(' → '));
        const audits = await tx.auditLog.count({ where: { applicationId: file.id, action: { startsWith: 'OCCUPANCY_' } } });
        check('every step audited', audits >= 10, `${audits}`);
        const emitted = await tx.outboxEvent.count({ where: { applicationId: file.id, eventCode: 'OCCUPANCY_SUBMITTED' } });
        check('OCCUPANCY_SUBMITTED emitted', emitted === 1);

        throw new Error(ROLLBACK);
      },
      { timeout: 300_000, maxWait: 20_000 }
    );
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) check('full flow ran to the end', false, e instanceof Error ? e.message : String(e));
  }
  const left = await prisma.occupancyApplication.count({ where: { applicationId: file.id } });
  const wc = await prisma.workCommencement.count({ where: { applicationId: file.id } });
  check('the full-flow test left nothing behind', left === 0 && wc === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Refusals through the service
// ═══════════════════════════════════════════════════════════════════════════

async function serviceRefusals() {
  console.log('\n2. Refusals through the service');
  const before = await prisma.occupancyApplication.count();
  const underReview = await prisma.application.findFirst({
    where: { deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'PROCEEDING_REVOKED', 'DRAFT', 'WITHDRAWN'] }, workflowInstance: { isNot: null } },
    select: { id: true, applicationNumber: true, status: true, ltpUserId: true },
  });
  if (underReview) {
    const r = await refused(async () =>
      submitOccupancyApplication(await actorFor(underReview.ltpUserId), underReview.id, { completionDate: today, remarks: '', demoDocuments: true, demoKinds: 'COMPLETION_LETTER,AS_BUILT_DRAWING' }, META)
    );
    check(`a ${underReview.status} file cannot apply for occupancy (${underReview.applicationNumber})`, /approved/.test(r), r);
  }
  const recommended = await prisma.occupancyApplication.findFirst({ where: { status: 'RECOMMENDED', isCurrent: true }, select: { applicationId: true, application: { select: { zoneId: true, ltpUserId: true } } } });
  if (recommended) {
    const tpa = await officer('TPA', recommended.application.zoneId);
    if (tpa) {
      const r = await refused(async () => decideOccupancyApplication(await actorFor(tpa.id), recommended.applicationId, { decision: 'APPROVED', remarks: 'Trying to decide' }, META));
      check('a TPA cannot decide occupancy', /not your desk/.test(r), r);
    }
  }
  const submitted = await prisma.occupancyApplication.findFirst({ where: { status: 'SUBMITTED', isCurrent: true }, select: { applicationId: true, application: { select: { ltpUserId: true } } } });
  if (submitted) {
    const r = await refused(async () =>
      scheduleOccupancyInspection(await actorFor(submitted.application.ltpUserId), submitted.applicationId, { scheduledFor: today, inspectorId: submitted.application.ltpUserId, remarks: '' }, META)
    );
    check('the LTP cannot schedule its own inspection', /not your desk/.test(r), r);
  }
  check('no refusal wrote anything', (await prisma.occupancyApplication.count()) === before);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. The demo data
// ═══════════════════════════════════════════════════════════════════════════

async function demoData() {
  console.log('\n3. Demo data');
  const rows = await prisma.occupancyApplication.findMany({
    where: { isCurrent: true },
    orderBy: { occupancyNumber: 'asc' },
    include: { events: true, application: { select: { applicationNumber: true, status: true, currentStageCode: true } } },
  });
  const pending = await prisma.application.count({
    where: { status: 'APPROVED', occupancies: { none: {} }, workCommencement: { is: { commencementDate: { lte: new Date(today) } } } },
  });
  const states = new Set(rows.map((r) => r.status));
  check('completion pending present', pending > 0, `${pending}`);
  for (const s of ['SUBMITTED', 'INSPECTION_PENDING', 'INSPECTION_COMPLETED', 'SHORTFALL', 'APPROVED', 'CERTIFICATE_ISSUED']) check(`${s} present`, states.has(s));

  for (const o of rows) {
    console.log(`\n  ${o.occupancyNumber} · ${o.application.applicationNumber} · ${o.status}`);
    const history = await prisma.workflowHistory.findMany({
      where: { instance: { applicationId: o.applicationId }, actionCode: { in: OCC_ACTIONS } },
      select: { fromStageCode: true, toStageCode: true, fromStatus: true, toStatus: true },
    });
    check('one workflow step per event', history.length === o.events.length, `${history.length} steps, ${o.events.length} events`);
    check('no step moved the file', history.every((h) => h.fromStageCode === 'CLOSED_APPROVED' && h.toStageCode === 'CLOSED_APPROVED' && h.fromStatus === 'APPROVED' && h.toStatus === 'APPROVED'));
    const audits = await prisma.auditLog.count({ where: { entityType: 'OccupancyApplication', entityId: o.id } });
    check('each step audited', audits >= o.events.length, `${audits} audit rows`);
    if (o.status === 'CERTIFICATE_ISSUED') {
      const out = await prisma.outwardEntry.findUnique({ where: { id: o.outwardEntryId ?? '' } });
      check('certificate has its Outward entry', out?.documentType === 'OCCUPANCY_CERTIFICATE' && out.outwardNumber === o.outwardNumber, o.outwardNumber);
      const pdf = renderOccupancyCertificate(o.certificateSnapshot as unknown as CertificateSnapshot);
      check('certificate PDF renders', pdf.subarray(0, 4).toString() === '%PDF', `${pdf.byteLength} bytes`);
      check('went through a shortfall round before the certificate', o.round >= 2, `round ${o.round}`);
    }
  }
}

async function main() {
  await fullFlow();
  await serviceRefusals();
  await demoData();
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
