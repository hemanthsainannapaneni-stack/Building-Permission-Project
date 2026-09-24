/**
 * FIRE NOCs FOR THE DEMONSTRATION.
 *
 *   npm run nocs:seed              report what would happen, change nothing
 *   npm run nocs:seed -- --apply   perform it
 *
 * Takes files at the TPA, ZDD and ZJD desks (and the Planning Officer's, for
 * the applicant-only states) and drives each Fire NOC through the REAL
 * services — createNoc, applicantUpdate, officerAction — as the officer who
 * works that desk in that zone, or as the file's own LTP. The desk check, the
 * lifecycle rules, the verification readiness rules, the events and the audit
 * rows all run exactly as they do from the screens. Nothing here writes a NOC
 * row by hand.
 *
 * Every state the screens draw exists afterwards:
 *
 *   NOT_REQUIRED  PENDING  REQUIRED  APPLIED  RECEIVED  VERIFIED  SHORTFALL
 *   REJECTED      EXPIRED
 *
 * Certificates are DEMO PLACEHOLDERS (no file), stamped DEMO wherever they are
 * shown. The one direct write is to make an EXPIRED example: a received
 * certificate's validity date is moved into the past, and then the real expiry
 * sweep moves it to EXPIRED with its own event and audit row.
 *
 * Idempotent: a file that already has a Fire NOC is skipped.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { applicantUpdate, createNoc, expireLapsedNocs, officerAction } from '../src/server/services/nocs';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const META = { ip: '127.0.0.1', userAgent: 'seed-nocs', correlationId: 'phase6' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Outcome =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'REQUIRED'
  | 'APPLIED'
  | 'RECEIVED'
  | 'VERIFIED'
  | 'SHORTFALL'
  | 'REJECTED'
  | 'EXPIRED'
  | 'APPLIED_BY_LTP';

/** Per desk, in application-number order. Files beyond the list are left without a NOC. */
const PLAN: Record<string, Outcome[]> = {
  TPA_REVIEW: ['VERIFIED', 'SHORTFALL', 'RECEIVED', 'APPLIED', 'NOT_REQUIRED', 'PENDING', 'REQUIRED', 'REJECTED', 'RECEIVED'],
  ZDD_REVIEW: ['VERIFIED', 'RECEIVED', 'APPLIED', 'NOT_REQUIRED', 'SHORTFALL'],
  ZJD_REVIEW: ['VERIFIED', 'VERIFIED', 'NOT_REQUIRED', 'RECEIVED', 'PENDING'],
  // The Planning Officer holds no NOC_VERIFY, so only the applicant acts here.
  PLANNING_OFFICER_REVIEW: ['PENDING', 'APPLIED_BY_LTP', 'EXPIRED'],
};

const NOT_REQUIRED_REASONS = [
  'Residential building of ground + 2 floors; the Fire Services department’s NOC is not called for on this proposal.',
  'Individual residence, no assembly or mercantile occupancy proposed. Not required.',
  'Proposal is below the scale at which the desk refers files to the Fire Services. Recorded as not required.',
];

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

/**
 * The officer who works this desk in this zone — a real account holding the
 * desk's role. The account with the FEWEST roles wins: a demo "all roles"
 * account also matches every desk, and a register full of decisions made by
 * the super account is not what a desk looks like.
 */
async function officerFor(roleKeys: string[], zoneId: string) {
  const candidates = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: { in: roleKeys } } } },
      OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, _count: { select: { roles: true } } },
  });
  const u = candidates.sort((a, b) => a._count.roles - b._count.roles)[0];
  return u ? actorFor(u.id) : null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const fire = await prisma.nocType.findUnique({ where: { code: 'FIRE' } });
  if (!fire) throw new Error('The FIRE NOC type is missing. Run `npm run nocs:config` first.');

  const stages = await prisma.workflowStage.findMany({
    where: { code: { in: Object.keys(PLAN) }, workflow: { code: 'BBAS_STANDARD' } },
    select: { id: true, code: true, ownerRoleKeys: true },
  });

  const counts: Record<string, number> = {};
  let skipped = 0;
  let serial = 0;

  for (const stage of stages) {
    const apps = await prisma.application.findMany({
      where: { deletedAt: null, currentStageId: stage.id, zoneId: { not: null } },
      orderBy: { applicationNumber: 'asc' },
      select: { id: true, applicationNumber: true, zoneId: true, ltpUserId: true, submittedAt: true, createdAt: true },
    });
    const plan = PLAN[stage.code] ?? [];

    for (const [i, app] of apps.entries()) {
      const outcome = plan[i];
      if (!outcome) break;

      const existing = await prisma.applicationNoc.findUnique({
        where: { applicationId_nocTypeId: { applicationId: app.id, nocTypeId: fire.id } },
        select: { nocNumber: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      console.log(`  ${app.applicationNumber.padEnd(16)} ${stage.code.padEnd(24)} → ${outcome}`);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      if (!APPLY) continue;

      const ltp = await actorFor(app.ltpUserId);
      const desk = await officerFor(stage.ownerRoleKeys as string[], app.zoneId!);
      const needsDesk = !['PENDING', 'APPLIED_BY_LTP', 'EXPIRED'].includes(outcome);
      if (needsDesk && !desk) {
        console.log(`    ! no officer for ${stage.code} in this zone — skipped`);
        continue;
      }

      serial += 1;
      const filed = app.submittedAt ?? app.createdAt;
      const applied = new Date(Math.min(Date.now() - 2 * DAY, filed.getTime() + 3 * DAY));
      const issued = new Date(Math.min(Date.now() - DAY, applied.getTime() + 12 * DAY));
      const expiry = new Date(issued.getTime() + 3 * 365 * DAY);
      const appRef = `FS/APP/${filed.getFullYear()}/${String(4100 + serial).padStart(5, '0')}`;
      const nocRef = `FS/NOC/${issued.getFullYear()}/${String(7300 + serial).padStart(5, '0')}`;

      // ── Open ──────────────────────────────────────────────────────────
      const ltpOpens = ['PENDING', 'APPLIED_BY_LTP', 'EXPIRED'].includes(outcome);
      const opened = ltpOpens
        ? await createNoc(ltp, app.id, { nocTypeId: fire.id, authority: '', remarks: 'Declared by the applicant with the application.' }, META)
        : await createNoc(
            desk!,
            app.id,
            {
              nocTypeId: fire.id,
              required: outcome !== 'NOT_REQUIRED',
              authority: '',
              remarks:
                outcome === 'NOT_REQUIRED'
                  ? NOT_REQUIRED_REASONS[serial % NOT_REQUIRED_REASONS.length]!
                  : 'Fire Services NOC to be obtained before the file can be decided.',
            },
            META
          );
      if (['NOT_REQUIRED', 'PENDING', 'REQUIRED'].includes(outcome)) continue;

      // ── The applicant applies ─────────────────────────────────────────
      await applicantUpdate(
        ltp,
        opened.id,
        {
          action: 'RECORD_APPLICATION',
          applicationReference: appRef,
          appliedDate: day(applied),
          issuedDate: null,
          expiryDate: null,
          remarks: 'Applied online on the Fire Services portal.',
          demoDocument: false,
        },
        META
      );
      if (outcome === 'APPLIED' || outcome === 'APPLIED_BY_LTP') continue;

      // ── The certificate comes back ────────────────────────────────────
      const flawed = outcome === 'SHORTFALL';
      await applicantUpdate(
        ltp,
        opened.id,
        {
          action: 'RECORD_RECEIPT',
          referenceNumber: nocRef,
          appliedDate: null,
          issuedDate: day(issued),
          expiryDate: day(expiry),
          remarks: flawed ? 'Certificate attached.' : 'Certificate received and attached.',
          demoDocument: true,
        },
        META
      );

      if (outcome === 'EXPIRED') {
        // The one direct write: move validity into the past, then let the
        // real sweep expire it.
        await prisma.applicationNoc.update({
          where: { id: opened.id },
          data: { expiryDate: new Date(Date.now() - 3 * DAY) },
        });
        continue;
      }
      if (outcome === 'RECEIVED') continue;

      // ── The desk decides ──────────────────────────────────────────────
      const decision =
        outcome === 'VERIFIED'
          ? { action: 'VERIFY' as const, remarks: 'Certificate checked against the Fire Services register. In order.' }
          : outcome === 'SHORTFALL'
            ? {
                action: 'SHORTFALL' as const,
                remarks: 'The certificate names the survey number as 212/2; the application is for 212/3. Obtain a corrected NOC.',
              }
            : {
                action: 'REJECT' as const,
                remarks: 'The certificate was issued for a different building height than the one proposed. A fresh NOC is required.',
              };
      await officerAction(desk!, opened.id, decision, META);
    }
  }

  if (APPLY) {
    const expired = await expireLapsedNocs({ force: true });
    console.log(`\n  Expiry sweep moved ${expired} NOC(s) to EXPIRED.`);
    const summary = await prisma.applicationNoc.groupBy({ by: ['status'], _count: true });
    console.log(`  NOCs now: ${summary.map((s) => `${s.status} ${s._count}`).join(' · ')}`);
  }
  console.log(
    `\n${APPLY ? 'Seeded' : 'Would seed'}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing'}` +
      (skipped ? ` (${skipped} file(s) already had a Fire NOC)` : '') +
      (APPLY ? '' : '\nRe-run with --apply to perform it.')
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
