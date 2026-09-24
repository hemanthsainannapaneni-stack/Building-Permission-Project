import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import type { AuthUser } from '../../../src/server/auth/context';
import { advanceOrder } from '../../../src/server/services/approval-orders';
import { storeApprovalOrderPdf } from '../../../src/server/services/approval-order-pdf';
import { notifyWorkCommencement } from '../../../src/server/services/work-commencements';
import {
  decideOccupancyApplication,
  issueOccupancyCertificateFor,
  raiseOccupancyShortfallFor,
  recommendOccupancyApplication,
  recordOccupancyInspection,
  respondOccupancyShortfall,
  scheduleOccupancyInspection,
  submitOccupancyApplication,
} from '../../../src/server/services/occupancy';

/**
 * PHASE 10 — OCCUPANCY, ON TOP OF THE DEMO.
 *
 * An add-on in the shape of `./work-commencements`: run at the end of
 * `index.ts`, and by `scripts/seed-occupancy.ts` against an existing
 * database. It never builds an application.
 *
 * Every step goes through the REAL services — so through the workflow engine
 * and its guards — as a real account holding the step's capability in the
 * file's zone: the file's own LTP submits and answers, a TPA schedules and
 * inspects, a ZDD reviews, a ZJD decides and issues. Where a file needs its
 * order issued or its work commenced first, that too is done through the
 * real order and commencement services, never by writing a row.
 *
 * Afterwards the register shows every state:
 *
 *   completion pending · submitted · inspection pending · inspection completed
 *   · shortfall · recommended · approved · certificate issued (after a full
 *   shortfall round) · rejected
 *
 * At least one approved file is left at "proceeding issued" for Phase 9.
 * Files with a show cause, revocation or change of professional are left to
 * their own stories. Idempotent: if any occupancy application exists,
 * nothing is created. Documents, photographs and as-built figures are
 * labelled demo data (DEMO_MODE only).
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-occupancy', correlationId: 'phase10' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Target =
  | 'COMPLETION_PENDING'
  | 'SUBMITTED'
  | 'INSPECTION_PENDING'
  | 'INSPECTION_COMPLETED'
  | 'SHORTFALL'
  | 'RECOMMENDED'
  | 'APPROVED'
  | 'CERTIFICATE_ISSUED'
  | 'REJECTED';

/** Required first; RECOMMENDED and REJECTED only if files allow. */
const TARGETS: Target[] = [
  'CERTIFICATE_ISSUED',
  'COMPLETION_PENDING',
  'SUBMITTED',
  'INSPECTION_PENDING',
  'INSPECTION_COMPLETED',
  'SHORTFALL',
  'APPROVED',
  'RECOMMENDED',
  'REJECTED',
];

type Log = (line: string) => void;

export async function seedOccupancy(prisma: PrismaClient, options: { apply: boolean; log: Log }) {
  const { apply, log } = options;

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
      sessionId: 'seed',
    };
  }

  /** A real account holding the role in the zone. Fewest roles wins — not the all-roles demo account. */
  async function officer(roleKey: string, zoneId: string | null) {
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

  const existing = await prisma.occupancyApplication.count();
  if (existing) {
    log(`${existing} occupancy application(s) already exist — nothing created.`);
    return { applied: false };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const candidates = await prisma.application.findMany({
    where: {
      deletedAt: null,
      status: 'APPROVED',
      currentStageCode: 'CLOSED_APPROVED',
      workflowInstance: { workflow: { code: 'BBAS_STANDARD' } },
      approvalOrder: { is: { revokedAt: null } },
      showCauses: { none: {} },
      revocations: { none: {} },
      ltpChanges: { none: {} },
      OR: [{ workCommencement: { is: null } }, { workCommencement: { is: { commencementDate: { lte: new Date(todayStr) } } } }],
    },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      zoneId: true,
      ltpUserId: true,
      approvalOrder: { select: { id: true, orderNumber: true, status: true, issuedAt: true } },
      workCommencement: { select: { commencementDate: true } },
    },
  });

  // Commenced files first, then issued orders, then the rest.
  const rank = (c: (typeof candidates)[number]) => (c.workCommencement ? 0 : c.approvalOrder?.status === 'ISSUED' ? 1 : 2);
  candidates.sort((a, b) => rank(a) - rank(b));

  // Keep one issued-but-not-commenced file for the Work Initiated register.
  const spare = candidates.find((c) => !c.workCommencement && c.approvalOrder?.status === 'ISSUED');
  const pool = candidates.filter((c) => c !== spare);
  const picks = TARGETS.map((target, i) => ({ target, app: pool[i] })).filter((p) => p.app);

  log(`${candidates.length} approved file(s) eligible; ${apply ? 'applying' : 'dry run'} — ${picks.length} example(s)${spare ? `; ${spare.applicationNumber} kept at "proceeding issued"` : ''}`);
  for (const p of picks) {
    const needs = [p.app!.approvalOrder?.status !== 'ISSUED' && 'issue order', !p.app!.workCommencement && 'notify commencement'].filter(Boolean);
    log(`  ${p.app!.applicationNumber}  →  ${p.target}${needs.length ? ` (first: ${needs.join(', ')})` : ''}`);
  }
  if (picks.length < 7) log('  Fewer than seven eligible approved files — some states will be missing. Approve more files, then run again.');
  if (!apply) return { applied: false };

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const later = (a: Date, b: Date) => (a > b ? a : b);

  for (const { target, app } of picks) {
    const a = app!;
    const [ltp, tpa, zdd, zjd] = await Promise.all([actorFor(a.ltpUserId), officer('TPA', a.zoneId), officer('ZDD', a.zoneId), officer('ZJD', a.zoneId)]);
    if (!tpa || !zdd || !zjd) {
      log(`  ${a.applicationNumber}: the zone lacks a TPA, ZDD or ZJD — skipped`);
      continue;
    }

    // ── The proceeding, issued through the order lifecycle ────────────
    let order = await prisma.approvalOrder.findUniqueOrThrow({ where: { applicationId: a.id }, select: { id: true, status: true, issuedAt: true } });
    const chain: Record<string, string> = { DRAFT: 'GENERATED', PREVIEW: 'GENERATED', GENERATED: 'APPROVED', APPROVED: 'ISSUED' };
    while (order.status !== 'ISSUED' && chain[order.status]) {
      const to = chain[order.status]!;
      if (to === 'GENERATED') await storeApprovalOrderPdf(order.id);
      await advanceOrder({ orderId: order.id, to, actor: zjd, remarks: 'Issued for the occupancy demonstration.', meta: META });
      order = await prisma.approvalOrder.findUniqueOrThrow({ where: { applicationId: a.id }, select: { id: true, status: true, issuedAt: true } });
    }

    // ── Work initiated, through the commencement service ──────────────
    const now = new Date();
    let wc = await prisma.workCommencement.findUnique({ where: { applicationId: a.id }, select: { commencementDate: true } });
    if (!wc) {
      const date = later(new Date(day(order.issuedAt)), new Date(Date.now() - 150 * DAY));
      await notifyWorkCommencement(
        ltp,
        a.id,
        {
          commencementDate: day(date),
          contractorName: 'Sri Lakshmi Builders',
          contractorLicenceNo: 'CL/GHMC/2022/0655',
          contractorPhone: '9849011223',
          contractorAddress: 'Ameerpet, Hyderabad',
          remarks: 'Commencement notified for the occupancy demonstration.',
          demoDocuments: true,
          demoKinds: 'COMMENCEMENT_NOTICE',
        },
        META
      );
      wc = { commencementDate: date };
    }
    if (target === 'COMPLETION_PENDING') {
      log(`  ${a.applicationNumber}: work under way — completion pending`);
      continue;
    }

    // ── Completion intimation + submission ────────────────────────────
    const completion = later(new Date(day(wc.commencementDate)), new Date(Date.now() - 24 * DAY));
    await submitOccupancyApplication(
      ltp,
      a.id,
      {
        completionDate: day(completion),
        remarks: 'Construction is complete, including finishes, rainwater harvesting and the parking area. Completion letter and as-built drawing enclosed.',
        demoDocuments: true,
        demoKinds: 'COMPLETION_LETTER,AS_BUILT_DRAWING,STRUCTURAL_STABILITY_CERTIFICATE,SITE_PHOTOGRAPHS',
      },
      META
    );
    if (target === 'SUBMITTED') {
      log(`  ${a.applicationNumber}: occupancy submitted`);
      continue;
    }

    // ── Final inspection ──────────────────────────────────────────────
    const schedule = async (offsetDays: number) => {
      const when = later(new Date(day(completion)), new Date(now.getTime() + offsetDays * DAY));
      await scheduleOccupancyInspection(tpa, a.id, { scheduledFor: day(when), inspectorId: tpa.id, remarks: 'Final inspection booked.' }, META);
      return when;
    };
    const inspect = async (when: Date, variant: 'COMPLIANT' | 'DEVIATION', recommendation: 'RECOMMENDED' | 'SHORTFALL' | 'REJECT', remarks: string) =>
      recordOccupancyInspection(
        tpa,
        a.id,
        {
          inspectionDate: day(when),
          siteCondition: 'Construction complete; site cleared of debris; approach road and drains in place.',
          actualConstruction:
            variant === 'COMPLIANT'
              ? 'Building found as per the approved plan in extent, height and number of floors. Parking and setbacks kept open.'
              : 'Built-up area and coverage exceed the approved plan; the rear setback has been partly built over with a utility room.',
          approvedConstruction: 'As per the approved plan and building permission order.',
          deviations:
            variant === 'COMPLIANT'
              ? ''
              : 'Rear setback partly covered by a utility room — remove the structure.\nBuilt-up area exceeds the sanction — demolish the excess or apply for regularisation.',
          remarks,
          recommendation,
          asBuilt: {},
          demoAsBuilt: true,
          demoVariant: variant,
          demoPhotos: true,
        },
        META
      );

    if (target === 'INSPECTION_PENDING') {
      await schedule(3);
      log(`  ${a.applicationNumber}: final inspection pending`);
      continue;
    }

    if (target === 'CERTIFICATE_ISSUED') {
      // The full journey: deviation found → shortfall → answered → re-inspected.
      let when = await schedule(-14);
      await inspect(when, 'DEVIATION', 'RECOMMENDED', 'Deviations noted; referred for review.');
      await raiseOccupancyShortfallFor(
        zdd,
        a.id,
        {
          items: ['Remove the utility room built in the rear setback.', 'Reduce the built-up area to the sanctioned extent, or apply for regularisation.'],
          remarks: 'The as-built building exceeds the approved plan. Occupancy cannot be recommended until these are put right.',
        },
        META
      );
      await respondOccupancyShortfall(
        ltp,
        a.id,
        { remarks: 'The utility room in the rear setback has been removed and the excess area at the terrace level dismantled. Revised as-built drawing enclosed.', demoDocuments: true, demoKinds: 'AS_BUILT_DRAWING,SITE_PHOTOGRAPHS' },
        META
      );
      when = await schedule(-6);
      await inspect(when, 'COMPLIANT', 'RECOMMENDED', 'Re-inspected. The deviations have been put right; the building now agrees with the approved plan.');
    } else if (target === 'SHORTFALL') {
      const when = await schedule(-8);
      await inspect(when, 'DEVIATION', 'SHORTFALL', 'Deviations from the approved plan found on site. Returned to the applicant.');
      log(`  ${a.applicationNumber}: shortfall raised at the final inspection`);
      continue;
    } else if (target === 'REJECTED') {
      const when = await schedule(-9);
      await inspect(when, 'DEVIATION', 'REJECT', 'Substantial construction beyond the sanction; not fit for an occupancy certificate.');
    } else {
      const when = await schedule(-7);
      await inspect(when, 'COMPLIANT', 'RECOMMENDED', 'Building agrees with the approved plan. Recommended.');
    }
    if (target === 'INSPECTION_COMPLETED') {
      log(`  ${a.applicationNumber}: final inspection completed`);
      continue;
    }

    // ── As-built review and recommendation ────────────────────────────
    await recommendOccupancyApplication(
      zdd,
      a.id,
      target === 'REJECTED'
        ? { recommendation: 'REJECT', remarks: 'The as-built building exceeds the sanction beyond anything regularisable. Recommended for rejection.' }
        : { recommendation: 'APPROVE', remarks: 'As-built figures agree with the approved plan within tolerance. Recommended for approval.' },
      META
    );
    if (target === 'RECOMMENDED') {
      log(`  ${a.applicationNumber}: recommended — awaiting decision`);
      continue;
    }

    await decideOccupancyApplication(
      zjd,
      a.id,
      target === 'REJECTED'
        ? { decision: 'REJECTED', remarks: 'Rejected on the recommendation. The owner may apply afresh after regularisation.' }
        : { decision: 'APPROVED', remarks: 'Approved. Issue the occupancy certificate.' },
      META
    );
    if (target === 'APPROVED' || target === 'REJECTED') {
      log(`  ${a.applicationNumber}: occupancy ${target.toLowerCase()}`);
      continue;
    }

    await issueOccupancyCertificateFor(zjd, a.id, { remarks: 'Certificate issued.' }, META);
    const cert = await prisma.occupancyApplication.findFirst({ where: { applicationId: a.id, status: 'CERTIFICATE_ISSUED' }, select: { certificateNumber: true, outwardNumber: true } });
    log(`  ${a.applicationNumber}: certificate ${cert?.certificateNumber} issued (after a shortfall round) — Outward ${cert?.outwardNumber}`);
  }

  // Deliver what the transitions emitted (OCCUPANCY_SUBMITTED, WORK_INITIATED, ORDER_ISSUED).
  const { dispatchOutbox } = await import('../../../src/server/notifications/dispatcher');
  for (let i = 0; i < 10; i += 1) {
    const report = await dispatchOutbox(50);
    if (!report.events) break;
  }
  return { applied: true };
}
