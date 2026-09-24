import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import type { AuthUser } from '../../../src/server/auth/context';
import {
  addProfessionalChangeDocuments,
  decideProfessionalChange,
  requestProfessionalChange,
  reviewProfessionalChange,
  verifyProfessionalChange,
} from '../../../src/server/services/professional-changes';
import { PROFESSIONAL_CHANGE_STAGES } from '../workflow/bbas-standard';

/**
 * PHASE 8 — CHANGE OF TECHNICAL PROFESSIONAL, ON TOP OF THE DEMO.
 *
 * An add-on in the shape of `./proceedings`: run at the end of `index.ts`
 * over whatever files the plan built, and by
 * `scripts/seed-professional-changes.ts` against an existing database. It
 * never touches the plan and never builds an application of its own.
 *
 * Every step goes through the REAL service, and so through the workflow
 * engine — REQUEST_, VERIFY_, REVIEW_, APPROVE_ and REJECT_PROFESSIONAL_CHANGE
 * — by a real officer of the file's zone holding that step's capability.
 * Nothing writes a request, an engagement or `ltpUserId` by hand.
 *
 * Afterwards the demo shows one request in each state: pending verification,
 * under review, approved (the file now held by a different professional, the
 * old one kept in its history) and rejected.
 *
 * ── Idempotent ────────────────────────────────────────────────────────────
 *
 * If any change of professional request exists, nothing is created. The
 * documents are labelled demo placeholders (DEMO_MODE only).
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-professional-changes', correlationId: 'phase8' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Target = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

/** Which stage each example prefers its file to be at — varied, so the branch is seen at several desks. */
const PLAN: Array<{ target: Target; stages: string[]; reason: string; documents: string[]; late?: string[] }> = [
  {
    target: 'PENDING',
    stages: ['TPA_REVIEW', 'LTP_SHORTFALL_ACTION', 'TPA_SITE_INSPECTION'],
    reason:
      'The owner writes that the architect has relocated to another city and can no longer attend site inspections or answer the department; the owner wishes to engage a local professional.',
    // Registered without the outgoing professional's release: verification is
    // blocked until the NOC or a termination letter is added.
    documents: ['OWNER_REQUEST_LETTER', 'NEW_PROFESSIONAL_CONSENT', 'INDEMNITY'],
  },
  {
    target: 'UNDER_REVIEW',
    stages: ['PLANNING_OFFICER_REVIEW', 'ZDD_REVIEW', 'TPA_REVIEW'],
    reason: 'The owner and the architect have ended their engagement by mutual consent over a fee dispute that has since been settled.',
    documents: ['OWNER_REQUEST_LETTER', 'NEW_PROFESSIONAL_CONSENT', 'INDEMNITY', 'FEE_SETTLEMENT'],
    // The NOC arrives after the request — "Documents added".
    late: ['CURRENT_PROFESSIONAL_NOC', 'RESPONSIBILITY_HANDOVER'],
  },
  {
    target: 'APPROVED',
    stages: ['CLOSED_APPROVED', 'ZJD_REVIEW'],
    reason:
      'Construction is about to begin. The owner wishes the supervising professional to be a firm with structural engineering capacity, and the present architect has agreed to hand over.',
    documents: [
      'OWNER_REQUEST_LETTER',
      'CURRENT_PROFESSIONAL_NOC',
      'FEE_SETTLEMENT',
      'INDEMNITY',
      'RESPONSIBILITY_HANDOVER',
      'STRUCTURAL_RESPONSIBILITY_HANDOVER',
      'NEW_PROFESSIONAL_CONSENT',
    ],
  },
  {
    target: 'REJECTED',
    stages: ['ZJD_REVIEW', 'ZDD_REVIEW', 'PLANNING_OFFICER_REVIEW'],
    reason: 'The owner has terminated the architect’s engagement and asks that the proposed professional be recorded in their place.',
    documents: ['OWNER_REQUEST_LETTER', 'TERMINATION_LETTER', 'NEW_PROFESSIONAL_CONSENT'],
  },
];

type Log = (line: string) => void;

export async function seedProfessionalChanges(prisma: PrismaClient, options: { apply: boolean; log: Log }) {
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

  /** A real account holding the role in the zone. Fewest roles wins — not the all-roles demo account. */
  async function officer(roleKey: string, zoneId: string | null) {
    const candidates = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        roles: { some: { role: { key: roleKey } } },
        ...(zoneId ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, _count: { select: { roles: true } } },
    });
    const u = candidates.sort((a, b) => a._count.roles - b._count.roles)[0];
    return u ? actorFor(u.id) : null;
  }

  const existing = await prisma.professionalChangeRequest.count();
  if (existing) {
    log(`${existing} change of professional request(s) already exist — nothing created.`);
    return { applied: false };
  }

  const candidates = await prisma.application.findMany({
    where: {
      deletedAt: null,
      currentStageCode: { in: [...PROFESSIONAL_CHANGE_STAGES] },
      workflowInstance: { workflow: { code: 'BBAS_STANDARD' } },
      // Keep the Phase 7 examples' story uncluttered.
      showCauses: { none: {} },
    },
    orderBy: { applicationNumber: 'asc' },
    select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true, currentStageCode: true },
  });

  const ltps = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, ltpLicenceNo: { not: null }, roles: { some: { role: { key: 'LTP' } } } },
    orderBy: { email: 'asc' },
    select: { id: true, name: true },
  });

  const used = new Set<string>();
  const picks: Array<{ plan: (typeof PLAN)[number]; app: (typeof candidates)[number]; proposed: { id: string; name: string } }> = [];
  for (const plan of PLAN) {
    const app =
      plan.stages.map((s) => candidates.find((c) => c.currentStageCode === s && !used.has(c.id))).find(Boolean) ??
      candidates.find((c) => !used.has(c.id));
    if (!app) continue;
    const proposed = ltps.find((l) => l.id !== app.ltpUserId);
    if (!proposed) continue;
    used.add(app.id);
    picks.push({ plan, app, proposed });
  }

  log(`${apply ? 'Applying' : 'Dry run'} — ${picks.length} example(s)`);
  for (const p of picks) log(`  ${p.app.applicationNumber} (${p.app.currentStageCode})  →  ${p.plan.target}, proposed ${p.proposed.name}`);
  if (!apply) return { applied: false };

  const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

  for (const { plan, app, proposed } of picks) {
    const [tpa, po, zdd, zjd] = await Promise.all([
      officer('TPA', app.zoneId),
      officer('PLANNING_OFFICER', app.zoneId),
      officer('ZDD', app.zoneId),
      officer('ZJD', app.zoneId),
    ]);
    if (!tpa || !po || !zdd || !zjd) {
      log(`  ${app.applicationNumber}: the zone lacks a TPA, Planning Officer, ZDD or ZJD — skipped`);
      continue;
    }

    await requestProfessionalChange(
      tpa,
      app.id,
      {
        proposedProfessionalId: proposed.id,
        requestDate: day(-3),
        reason: plan.reason,
        demoDocuments: true,
        demoKinds: plan.documents.join(','),
      },
      META
    );
    const req = await prisma.professionalChangeRequest.findFirstOrThrow({ where: { applicationId: app.id }, orderBy: { requestedAt: 'desc' } });
    if (plan.target === 'PENDING') {
      log(`  ${app.applicationNumber}: ${req.requestNumber} pending verification (no release from the outgoing professional yet)`);
      continue;
    }

    if (plan.late?.length) {
      await addProfessionalChangeDocuments(tpa, req.id, { demoDocuments: true, demoKinds: plan.late.join(','), expectedStatus: 'PENDING_VERIFICATION' }, META);
    }
    await verifyProfessionalChange(
      po,
      req.id,
      { remarks: 'Owner’s letter, the outgoing professional’s release and the incoming professional’s consent are on record and consistent.' },
      META
    );
    if (plan.target === 'UNDER_REVIEW') {
      log(`  ${app.applicationNumber}: ${req.requestNumber} verified — under review at the ZDD desk`);
      continue;
    }

    await reviewProfessionalChange(
      zdd,
      req.id,
      {
        remarks:
          plan.target === 'APPROVED'
            ? 'The incoming professional’s licence is in force and covers this class of building. Recommended for approval.'
            : 'There is no NOC from the outgoing architect, whose fee claim is recorded as unsettled. Not recommended until it is.',
      },
      META
    );
    await decideProfessionalChange(
      zjd,
      req.id,
      plan.target === 'APPROVED'
        ? { decision: 'APPROVED', remarks: 'Approved. The incoming professional takes over the file and its drawing submissions from today.' }
        : { decision: 'REJECTED', remarks: 'Rejected. The owner may apply again with the outgoing architect’s NOC or evidence that the fee dispute is settled.' },
      META
    );
    log(`  ${app.applicationNumber}: ${req.requestNumber} ${plan.target}`);
  }
  return { applied: true };
}
