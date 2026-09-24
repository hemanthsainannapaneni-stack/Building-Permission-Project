import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import type { AuthUser } from '../../../src/server/auth/context';
import { notifyWorkCommencement } from '../../../src/server/services/work-commencements';

/**
 * PHASE 9 — WORK INITIATED, ON TOP OF THE DEMO.
 *
 * An add-on in the shape of `./professional-changes`: run at the end of
 * `index.ts` over whatever files the plan built, and by
 * `scripts/seed-work-commencements.ts` against an existing database. It never
 * builds an application and never issues an order.
 *
 * Every notice goes through the REAL service, and so through the workflow
 * engine (NOTIFY_WORK_COMMENCEMENT), in the name of the file's own technical
 * professional. Nothing writes `work_commencements` by hand.
 *
 * Afterwards the register shows each state:
 *
 *   Proceeding issued      approved files with an issued order, left alone
 *   Work initiated         notified, start date a few days past
 *   Pending commencement   notified in advance, start date still to come
 *
 * Only approved BBAS files whose order is ISSUED and which carry no show
 * cause, revocation or change of professional are used, so the Phase 7 and 8
 * examples keep their own stories.
 *
 * ── Idempotent ────────────────────────────────────────────────────────────
 *
 * If any commencement notice exists, nothing is created. Documents are
 * labelled demo placeholders (DEMO_MODE only).
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-work-commencements', correlationId: 'phase9' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Target = 'WORK_INITIATED' | 'PENDING_COMMENCEMENT';

const PLAN: Array<{
  target: Target;
  offsetDays: number;
  contractor: { name: string; licenceNo: string; phone: string; address: string };
  documents: string;
  remarks: string;
}> = [
  {
    target: 'WORK_INITIATED',
    offsetDays: -6,
    contractor: {
      name: 'Sri Venkateswara Constructions',
      licenceNo: 'CL/GHMC/2023/0412',
      phone: '9848012345',
      address: 'Plot 14, Kukatpally Industrial Estate, Hyderabad',
    },
    documents: 'COMMENCEMENT_NOTICE,SITE_PHOTOGRAPH,CONTRACTOR_UNDERTAKING',
    remarks: 'Excavation for footings began on the commencement date. Site hoarding and the permission board are in place.',
  },
  {
    target: 'PENDING_COMMENCEMENT',
    offsetDays: 12,
    contractor: {
      name: 'Deccan Buildcon Pvt. Ltd.',
      licenceNo: 'CL/GHMC/2021/0877',
      phone: '9866054321',
      address: '3-6-289, Hyderguda, Hyderabad',
    },
    documents: 'COMMENCEMENT_NOTICE',
    remarks: 'Notice given in advance. Work will start once the existing compound wall is taken down.',
  },
];

type Log = (line: string) => void;

export async function seedWorkCommencements(prisma: PrismaClient, options: { apply: boolean; log: Log }) {
  const { apply, log } = options;

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
      sessionId: 'seed',
    };
  }

  const existing = await prisma.workCommencement.count();
  if (existing) {
    log(`${existing} commencement notice(s) already exist — nothing created.`);
    return { applied: false };
  }

  const candidates = await prisma.application.findMany({
    where: {
      deletedAt: null,
      status: 'APPROVED',
      currentStageCode: 'CLOSED_APPROVED',
      workflowInstance: { workflow: { code: 'BBAS_STANDARD' } },
      approvalOrder: { status: 'ISSUED', revokedAt: null },
      showCauses: { none: {} },
      revocations: { none: {} },
      ltpChanges: { none: {} },
    },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      ltpUserId: true,
      approvalOrder: { select: { orderNumber: true, issuedAt: true, validUntil: true } },
    },
  });

  // Keep at least one file at "Proceeding issued" for the register.
  const usable = candidates.slice(0, Math.max(0, candidates.length - 1));
  const picks = PLAN.map((plan, i) => ({ plan, app: usable[i] })).filter((p) => p.app);
  log(`${candidates.length} approved file(s) with an issued proceeding; ${apply ? 'applying' : 'dry run'} — ${picks.length} example(s)`);
  if (picks.length < PLAN.length) {
    log('  Not enough approved files with an issued order for every example. Issue more orders, then run again.');
  }

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const plans = picks.map(({ plan, app }) => {
    const order = app!.approvalOrder!;
    const issued = new Date(day(order.issuedAt));
    let date = new Date(Date.now() + plan.offsetDays * DAY);
    // Work cannot start before the order was issued; a recent order moves the
    // past example to its issue day.
    if (date < issued) date = issued;
    if (plan.target === 'PENDING_COMMENCEMENT' && order.validUntil && date > order.validUntil) date = new Date(order.validUntil);
    return { plan, app: app!, date: day(date) };
  });
  for (const p of plans) log(`  ${p.app.applicationNumber} (${p.app.approvalOrder!.orderNumber})  →  ${p.plan.target}, commencing ${p.date}`);
  if (!apply) return { applied: false };

  for (const { plan, app, date } of plans) {
    const ltp = await actorFor(app.ltpUserId);
    const r = await notifyWorkCommencement(
      ltp,
      app.id,
      {
        commencementDate: date,
        contractorName: plan.contractor.name,
        contractorLicenceNo: plan.contractor.licenceNo,
        contractorPhone: plan.contractor.phone,
        contractorAddress: plan.contractor.address,
        remarks: plan.remarks,
        demoDocuments: true,
        demoKinds: plan.documents,
      },
      META
    );
    log(`  ${app.applicationNumber}: notified by ${ltp.name} — workflow step #${r.sequence ?? '?'}`);
  }

  // Deliver the WORK_INITIATED notices the transitions emitted, as the demo
  // seed does for everything else it produces.
  const { dispatchOutbox } = await import('../../../src/server/notifications/dispatcher');
  for (let i = 0; i < 10; i += 1) {
    const report = await dispatchOutbox(50);
    if (!report.events) break;
  }
  return { applied: true };
}
