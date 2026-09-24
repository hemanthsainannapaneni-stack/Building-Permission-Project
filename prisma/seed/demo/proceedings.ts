import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import type { AuthUser } from '../../../src/server/auth/context';
import {
  decideShowCauseNotice,
  issueShowCause,
  respondShowCause,
  takeUpShowCause,
} from '../../../src/server/services/show-cause';
import { decideRevocationProceeding, takeUpRevocation } from '../../../src/server/services/revocations';
import { createOutward, outwardAction } from '../../../src/server/services/outward';

/**
 * PHASE 7 — SHOW CAUSE, REVOCATION AND OUTWARD, ON TOP OF THE DEMO.
 *
 * An add-on to the demo seed in the same shape as `./bim`: run at the end of
 * `index.ts` over whatever files the plan built, and by
 * `scripts/seed-proceedings.ts` against an existing database. It never touches
 * the plan (`./plan.ts`) and never builds an application of its own.
 *
 * Every step goes through the REAL services, and so through the workflow
 * engine — ISSUE_SHOW_CAUSE, RESPOND_SHOW_CAUSE (raised on the applicant's
 * behalf), TAKE_UP_SHOW_CAUSE, DECIDE_SHOW_CAUSE, INITIATE_REVOCATION,
 * TAKE_UP_REVOCATION, REVOKE_PROCEEDING — with dispatch through the Outward
 * register by the ZJD, the role that keeps it. Nothing writes a notice, a
 * proceeding or an outward row by hand.
 *
 * ── Idempotent, step by step ─────────────────────────────────────────────
 *
 * A file already carrying a notice is not given a second one. The in-review
 * example is ADVANCED from wherever it stands to its target state, so a
 * re-run finishes what an earlier run began and otherwise changes nothing.
 *
 * Afterwards the demo shows: show cause pending, response received, under
 * review (in review), closed; revocation under review; revoked proceeding;
 * outward dispatched and acknowledged; a BPO entered by hand.
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-proceedings', correlationId: 'phase7' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Plan = 'SC_PENDING' | 'SC_RESPONDED' | 'SC_CLOSED' | 'REVOCATION_PENDING' | 'REVOKED';
/** In application-number order over the APPROVED files. */
const APPROVED_PLAN: Plan[] = ['SC_PENDING', 'SC_RESPONDED', 'SC_CLOSED', 'REVOCATION_PENDING', 'REVOKED'];

const CASES: Record<Plan, { violation: string; reason: string; response: string; decision?: string; grounds?: string[] }> = {
  SC_PENDING: {
    violation:
      'During the post-approval site visit the front setback was observed to be enclosed by a permanent structure, where the sanctioned plan shows it open.',
    reason: 'The observation departs from the sanctioned plan and the owner has not been heard on it.',
    response: '',
  },
  SC_RESPONDED: {
    violation: 'Construction has commenced but no notice of commencement is on the file.',
    reason: 'The permission requires written notice of commencement before work begins.',
    response:
      'Work began on the date shown in the enclosed letter. The notice of commencement was delivered by hand to the zonal office on that day; a copy of the acknowledged letter is attached.',
  },
  SC_CLOSED: {
    violation: 'The rainwater harvesting structure shown on the sanctioned plan was not visible at the time of inspection.',
    reason: 'The structure is a condition of the permission and its absence was recorded at inspection.',
    response:
      'The recharge pit is below the driveway slab, as the drawing shows at section B-B. Photographs of the pit before the slab was cast are attached.',
    decision: 'The explanation and photographs are accepted. The structure is in place as sanctioned. Closed.',
  },
  REVOCATION_PENDING: {
    violation: 'An additional floor has been constructed beyond the number of floors sanctioned.',
    reason: 'The construction exceeds the sanction and the deviation is material.',
    response: 'The additional floor is a temporary structure and will be removed. We request time.',
    decision: 'The response does not dispute the additional floor. The matter is referred for a revocation proceeding.',
    grounds: [
      'An additional floor has been constructed beyond the sanctioned number of floors.',
      'The owner does not dispute the construction in the response to the show cause notice.',
    ],
  },
  REVOKED: {
    violation: 'The permission was granted on a title document that the registering authority has since reported as not genuine.',
    reason: 'The permission appears to have been obtained on a document that has been reported as not genuine.',
    response: 'We were not aware of any defect in the title document and are making enquiries.',
    decision: 'The response does not answer the report on the title document. Referred for revocation.',
    grounds: [
      'The title document relied upon at the time of approval has been reported as not genuine.',
      'The applicant has not produced any other document establishing title.',
    ],
  },
};

type Log = (line: string) => void;

export async function seedProceedings(prisma: PrismaClient, options: { apply: boolean; log: Log }) {
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

  /** A real account holding the role (in the zone, when given). Fewest roles wins — not the all-roles demo account. */
  async function officer(roleKey: string, zoneId?: string | null) {
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

  const day = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
  const tracking = (prefix: string) => `${prefix}${String(100000000 + Math.floor(Math.random() * 899999999))}IN`;
  const blank = { mode: undefined, dispatchDate: null, trackingNumber: '', deliveredAt: null, acknowledgement: '', acknowledgementDate: null, returnReason: '', remarks: '' };
  const outwardOf = (sourceId: string) =>
    prisma.outwardEntry.findFirstOrThrow({ where: { sourceId }, select: { id: true, outwardNumber: true } });
  const dispatch = (by: AuthUser, id: string, mode: 'SPEED_POST' | 'REGISTERED_POST', prefix: string) =>
    outwardAction(by, id, { ...blank, action: 'DISPATCH', mode, dispatchDate: day(0), trackingNumber: tracking(prefix) }, META);

  const approved = await prisma.application.findMany({
    where: { deletedAt: null, status: 'APPROVED', showCauses: { none: {} }, workflowInstance: { workflow: { code: 'BBAS_STANDARD' } } },
    orderBy: { applicationNumber: 'asc' },
    select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true },
  });
  // The in-review example: a file at the ZJD desk, whether or not an earlier
  // run already issued its notice.
  const inReview =
    (await prisma.application.findFirst({
      where: { deletedAt: null, status: { in: ['PENDING_ZJD', 'ZJD_REVIEW'] }, showCauses: { some: {} } },
      orderBy: { applicationNumber: 'asc' },
      select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true },
    })) ??
    (await prisma.application.findFirst({
      where: { deletedAt: null, status: 'PENDING_ZJD', showCauses: { none: {} } },
      orderBy: { applicationNumber: 'asc' },
      select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true },
    }));

  const alreadyPlanned = await prisma.showCauseNotice.count({ where: { application: { status: { in: ['APPROVED', 'PROCEEDING_REVOKED'] } } } });
  const plan = alreadyPlanned ? [] : approved.slice(0, APPROVED_PLAN.length).map((a, i) => ({ app: a, plan: APPROVED_PLAN[i]! }));

  log(`${apply ? 'Applying' : 'Dry run'} — ${plan.length} approved file(s) to start${alreadyPlanned ? ` (${alreadyPlanned} post-approval notice(s) already exist — not repeated)` : ''}${inReview ? `; in-review example ${inReview.applicationNumber}` : ''}`);
  for (const p of plan) log(`  ${p.app.applicationNumber}  →  ${p.plan}`);
  if (!apply) return { applied: false };

  const commissioner = await officer('COMMISSIONER');
  if (!commissioner && plan.length) throw new Error('No Commissioner account exists to decide revocations.');

  for (const { app, plan: step } of plan) {
    const zjd = await officer('ZJD', app.zoneId);
    if (!zjd) {
      log(`  ${app.applicationNumber}: no ZJD for this zone — skipped`);
      continue;
    }
    const ltp = await actorFor(app.ltpUserId);
    const c = CASES[step];

    await issueShowCause(zjd, app.id, { reason: c.reason, violation: c.violation, responseDueDate: day(15), demoDocument: true, files: [] }, META);
    const notice = await prisma.showCauseNotice.findFirstOrThrow({ where: { applicationId: app.id }, orderBy: { issuedAt: 'desc' } });
    const out = await outwardOf(notice.id);
    await dispatch(zjd, out.id, 'SPEED_POST', 'EM');

    if (step === 'SC_PENDING') {
      const bpo = await createOutward(
        zjd,
        { application: app.applicationNumber, documentType: 'BPO', documentReference: '', subject: '', recipient: '', address: '', readyForDispatch: true, remarks: 'Certified copy of the permission, on request.' },
        META
      );
      log(`  ${app.applicationNumber}: ${notice.noticeNumber} awaiting response · ${out.outwardNumber} dispatched · ${bpo.outwardNumber} BPO ready`);
      continue;
    }
    if (step === 'SC_RESPONDED') {
      await outwardAction(zjd, out.id, { ...blank, action: 'RECORD_DELIVERY', deliveredAt: day(0), remarks: 'Delivered per tracking.' }, META);
      await outwardAction(zjd, out.id, { ...blank, action: 'RECORD_ACKNOWLEDGEMENT', acknowledgement: 'Acknowledgement card signed by the owner', acknowledgementDate: day(0) }, META);
    }

    await respondShowCause(ltp, notice.id, { response: c.response, demoDocument: true, files: [] }, META);
    if (step === 'SC_RESPONDED') {
      log(`  ${app.applicationNumber}: ${notice.noticeNumber} response received · ${out.outwardNumber} acknowledged`);
      continue;
    }

    await takeUpShowCause(zjd, notice.id, { remarks: '' }, META);
    const decision = step === 'SC_CLOSED' ? 'CLOSED_SATISFACTORY' : 'REVOKE_PROCEEDING';
    await decideShowCauseNotice(zjd, notice.id, { decision, remarks: c.decision!, grounds: c.grounds ?? [] }, META);
    if (step === 'SC_CLOSED') {
      log(`  ${app.applicationNumber}: ${notice.noticeNumber} closed / satisfactory`);
      continue;
    }

    const rev = await prisma.revocationProceeding.findFirstOrThrow({ where: { applicationId: app.id, status: 'PROPOSED' } });
    await takeUpRevocation(commissioner!, rev.id, { remarks: 'Taken up for review.' }, META);
    if (step === 'REVOCATION_PENDING') {
      log(`  ${app.applicationNumber}: ${notice.noticeNumber} → ${rev.revocationNumber} under review`);
      continue;
    }
    await decideRevocationProceeding(
      commissioner!,
      rev.id,
      { decision: 'REVOKED', remarks: 'The grounds are made out and are not answered by the response. The permission is revoked.' },
      META
    );
    const orderOut = await outwardOf(rev.id);
    await dispatch(zjd, orderOut.id, 'REGISTERED_POST', 'RL');
    log(`  ${app.applicationNumber}: ${rev.revocationNumber} REVOKED · order dispatched as ${orderOut.outwardNumber}`);
  }

  // ── The in-review example, advanced to "Review Show Cause Submission" ──
  if (inReview) {
    const zjd = await officer('ZJD', inReview.zoneId);
    if (!zjd) {
      log(`  ${inReview.applicationNumber}: no ZJD for this zone — skipped`);
    } else {
      let notice = await prisma.showCauseNotice.findFirst({ where: { applicationId: inReview.id }, orderBy: { issuedAt: 'desc' } });
      if (!notice) {
        await issueShowCause(
          zjd,
          inReview.id,
          {
            reason: 'The plot boundary on the site plan does not match the survey sketch on the file; the applicant is asked to explain before the file is decided.',
            violation: 'The site plan shows the plot extending about 1.2 m beyond the boundary shown on the survey sketch along the eastern side.',
            responseDueDate: day(10),
            demoDocument: true,
            files: [],
          },
          META
        );
        notice = await prisma.showCauseNotice.findFirstOrThrow({ where: { applicationId: inReview.id }, orderBy: { issuedAt: 'desc' } });
      }
      const steps: string[] = [];
      if (notice.status === 'ISSUED') {
        await dispatch(zjd, (await outwardOf(notice.id)).id, 'SPEED_POST', 'EM');
        steps.push('dispatched');
        notice = await prisma.showCauseNotice.findUniqueOrThrow({ where: { id: notice.id } });
      }
      if (notice.status === 'AWAITING_RESPONSE') {
        await respondShowCause(
          await actorFor(inReview.ltpUserId),
          notice.id,
          {
            response:
              'The eastern boundary on the site plan follows the compound wall that has stood since 1998. A fresh survey sketch from the Mandal Surveyor is attached and agrees with the site plan.',
            demoDocument: true,
            files: [],
          },
          META
        );
        steps.push('answered');
        notice = await prisma.showCauseNotice.findUniqueOrThrow({ where: { id: notice.id } });
      }
      if (notice.status === 'RESPONDED') {
        await takeUpShowCause(zjd, notice.id, { remarks: 'Comparing the fresh survey sketch with the site plan.' }, META);
        steps.push('taken up for review');
      }
      log(`  ${inReview.applicationNumber}: ${notice.noticeNumber} ${steps.length ? steps.join(' → ') : 'already at its target state'}`);
    }
  }
  return { applied: true };
}
