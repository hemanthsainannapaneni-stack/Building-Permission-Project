/**
 * SITE INSPECTIONS FOR THE DEMONSTRATION.
 *
 *   npm run inspections:seed              report what would happen, change nothing
 *   npm run inspections:seed -- --apply   perform it
 *
 * Takes files sitting at the TPA desk (BBAS_STANDARD) and drives each through
 * the REAL site inspection services — scheduleInspection, saveInspectionDraft,
 * addInspectionPhoto, submitInspection — with their capability checks,
 * readiness rules, workflow transitions, tasks and audit rows. Nothing here
 * writes an inspection by hand.
 *
 * One file per outcome, so every state the screens know how to draw exists:
 *
 *   PENDING      booked, not started            (x2)
 *   IN_PROGRESS  booked, partly answered, 2 photographs
 *   RECOMMENDED  signed (Aadhaar eSign — Demo), file → Planning Officer
 *   SHORTFALL    signed (USB Token — Demo), itemised shortfall, file parked
 *   REJECT       signed, file → Planning Officer with a reject recommendation
 *
 * Photographs are labelled DEMO placeholders (no image files); coordinates are
 * demo coordinates; signatures are demo signatures. The questions are the
 * PROVISIONAL DEMO wording from prisma/seed/12-checklists.ts.
 *
 * The only direct write is BACKDATING a completed visit's booking by a few
 * days before it is signed, so "scheduled" and "inspected" are not the same
 * minute. It happens before signing, so the signed hash covers the backdated
 * values and the report still verifies. Idempotent: a file that already has an
 * inspection is skipped.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import { DEMO_ESIGN_OTP, DEMO_TOKEN_PIN, PHOTO_BEARING, offsetCoordinates } from '../src/lib/site-inspection';
import {
  addInspectionPhoto,
  getInspection,
  saveInspectionDraft,
  scheduleInspection,
  submitInspection,
} from '../src/server/services/site-inspections';
import type { AuthUser } from '../src/server/auth/context';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const META = { ip: '127.0.0.1', userAgent: 'seed-site-inspections', correlationId: 'phase5' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Outcome = 'PENDING' | 'IN_PROGRESS' | 'RECOMMENDED' | 'SHORTFALL' | 'REJECT';
const PLAN: Outcome[] = ['RECOMMENDED', 'SHORTFALL', 'REJECT', 'IN_PROGRESS', 'PENDING', 'PENDING'];

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

/** Plausible on-site findings, keyed by question number. */
const TEXT_ANSWERS: Record<number, string> = {
  13: 'Level',
  19: 'Vacant — no construction started',
  22: '2 coconut trees; none proposed to be felled',
  25: 'Residential, independent houses',
  27: 'Owner present during the inspection.',
};
const NEGATIVE_IS_GOOD = new Set([8, 9, 10, 11, 12, 15, 16, 18]);

function answerFor(itemNumber: number, responseType: string, plotArea: number, road: number): string {
  if (responseType === 'MEASUREMENT' || responseType === 'NUMBER') {
    if (itemNumber === 3) return String(plotArea);
    if (itemNumber === 5) return String(road);
    return '0';
  }
  if (responseType === 'TEXT') return TEXT_ANSWERS[itemNumber] ?? 'As seen on site';
  if (itemNumber === 17 || itemNumber === 24) return responseType === 'YES_NO_NA' ? 'NA' : 'NO';
  return NEGATIVE_IS_GOOD.has(itemNumber) ? 'NO' : 'YES';
}

/** What goes wrong on the shortfall and reject files. */
const FINDINGS: Record<'SHORTFALL' | 'REJECT', Record<number, { status: string; response?: string; observation: string; remarks?: string }>> = {
  SHORTFALL: {
    1: { status: 'SHORTFALL', response: 'NO', observation: 'Boundary stones missing on the east side; fence 0.6 m inside the plot line.', remarks: 'Re-fix boundary stones as per the sale deed.' },
    5: { status: 'SHORTFALL', observation: 'Abutting road measured 7.2 m against 9.0 m declared.', remarks: 'Submit a revised site plan showing the actual road width.' },
    6: { status: 'SHORTFALL', response: 'NO', observation: 'Road narrower than the width shown in the approved layout.' },
  },
  REJECT: {
    11: { status: 'OBJECTION', response: 'YES', observation: 'Irrigation tank bund within 15 m of the western boundary; proposed building line falls inside the buffer.' },
    9: { status: 'SHORTFALL', response: 'YES', observation: 'Compound wall encroaches about 1.2 m onto the storm-water drain.' },
  },
};

async function candidates() {
  const tpaDesk = await prisma.workflowStage.findMany({
    where: { code: 'TPA_REVIEW', workflow: { code: 'BBAS_STANDARD' } },
    select: { id: true },
  });
  return prisma.application.findMany({
    where: {
      deletedAt: null,
      currentStageId: { in: tpaDesk.map((s) => s.id) },
      siteInspections: { none: {} },
      zoneId: { not: null },
    },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      zoneId: true,
      property: { select: { plotAreaSqm: true, roadWidthM: true } },
      workflowInstance: {
        select: { tasks: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, select: { assignedUserId: true } } },
      },
    },
  });
}

async function zoneTpas(zoneId: string) {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: 'TPA' } } },
      OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }],
    },
    select: { id: true, name: true, _count: { select: { roles: true } } },
    orderBy: { name: 'asc' },
  });
  // Dedicated TPA accounts first: the demo's all-roles admin also holds TPA,
  // and a report signed by "All Access Admin" is not a realistic register.
  return users.sort((a, b) => a._count.roles - b._count.roles);
}

async function run(outcome: Outcome, app: Awaited<ReturnType<typeof candidates>>[number], index: number) {
  const tpas = await zoneTpas(app.zoneId!);
  if (!tpas.length) return console.log(`    skip ${app.applicationNumber} — no TPA in its zone`);

  // The scheduler must hold the file (or it must be on the shared queue).
  const holder = app.workflowInstance?.tasks[0]?.assignedUserId ?? null;
  const schedulerId = holder && tpas.some((t) => t.id === holder) ? holder : tpas[0]!.id;
  if (holder && holder !== schedulerId) return console.log(`    skip ${app.applicationNumber} — held by a non-TPA`);
  const dedicated = tpas.filter((t) => t._count.roles === tpas[0]!._count.roles);
  const inspectorId = dedicated[index % dedicated.length]!.id;

  console.log(`    ${app.applicationNumber} → ${outcome} (inspector ${tpas.find((t) => t.id === inspectorId)!.name})`);
  if (!APPLY) return;

  const scheduler = await actorFor(schedulerId);
  const inspector = await actorFor(inspectorId);
  const pending = outcome === 'PENDING';
  const booked = await scheduleInspection(
    scheduler,
    app.id,
    {
      inspectorId,
      scheduledFor: new Date(Date.now() + (pending ? 2 + index : 0) * DAY).toISOString(),
      remarks: pending ? 'Owner to be present; call before the visit.' : '',
    },
    META
  );
  if (pending) return;

  // Give the visit a past: booked a few days ago, inspected yesterday.
  const bookedAt = new Date(Date.now() - (4 + index) * DAY);
  await prisma.siteInspection.update({ where: { id: booked.id }, data: { createdAt: bookedAt, scheduledFor: bookedAt } });
  const inspectedAt = new Date(Date.now() - DAY + index * 3_600_000);

  const detail = await getInspection(inspector, booked.id);
  const plot = Math.round(app.property?.plotAreaSqm ?? 250);
  const road = app.property?.roadWidthM ?? 9;
  const findings = outcome === 'SHORTFALL' || outcome === 'REJECT' ? FINDINGS[outcome] : {};
  const partial = outcome === 'IN_PROGRESS';

  await saveInspectionDraft(
    inspector,
    booked.id,
    {
      inspectedAt: inspectedAt.toISOString(),
      generalObservation:
        outcome === 'RECOMMENDED'
          ? 'Vacant, level plot with a formed approach road. Surroundings are residential. Site agrees with the application.'
          : outcome === 'SHORTFALL'
            ? 'Vacant plot. Boundaries and road width on the ground differ from the application; both are curable.'
            : outcome === 'REJECT'
              ? 'Plot adjoins an irrigation tank; the proposed building falls within the water-body buffer.'
              : 'Visit under way — boundaries and access checked so far.',
      responses: detail.responses
        .filter((r) => !partial || r.itemNumber <= 9)
        .map((r) => {
          const f = findings[r.itemNumber];
          return {
            itemId: r.itemId,
            response: f?.response ?? answerFor(r.itemNumber, r.responseType, plot, road),
            observation: f?.observation ?? '',
            remarks: f?.remarks ?? '',
            status: (f?.status ?? (r.itemNumber === 17 || r.itemNumber === 24 ? 'NA' : 'SATISFACTORY')) as never,
          };
        }),
    },
    META
  );

  const cats = partial ? (['NORTH', 'EAST'] as const) : (['NORTH', 'SOUTH', 'EAST', 'WEST', 'ACCESS_ROAD'] as const);
  for (const [n, category] of cats.entries()) {
    const bearing = PHOTO_BEARING[category] ?? 150;
    const p = offsetCoordinates(detail.latitude!, detail.longitude!, bearing, category === 'ACCESS_ROAD' ? 20 : 12);
    await addInspectionPhoto(
      inspector,
      booked.id,
      {
        category,
        latitude: p.latitude,
        longitude: p.longitude,
        capturedAt: new Date(inspectedAt.getTime() + n * 180_000).toISOString(),
        description: category === 'ACCESS_ROAD' ? 'Abutting road, looking towards the main road.' : `${category.toLowerCase()} boundary`,
      },
      META
    );
  }
  if (outcome === 'SHORTFALL' || outcome === 'REJECT') {
    await addInspectionPhoto(
      inspector,
      booked.id,
      {
        category: outcome === 'REJECT' ? 'ENCUMBRANCE' : 'BOUNDARY',
        ...offsetCoordinates(detail.latitude!, detail.longitude!, outcome === 'REJECT' ? 270 : 90, 18),
        capturedAt: new Date(inspectedAt.getTime() + 20 * 60_000).toISOString(),
        description: outcome === 'REJECT' ? 'Tank bund beyond the western boundary.' : 'Missing boundary stone, east side.',
      },
      META
    );
  }

  const rec = outcome === 'IN_PROGRESS' ? 'RECOMMENDED' : outcome;
  await saveInspectionDraft(
    inspector,
    booked.id,
    {
      recommendation: rec as never,
      recommendationRemarks:
        rec === 'RECOMMENDED'
          ? 'Site conforms to the application and the approved layout. Recommended for approval.'
          : rec === 'SHORTFALL'
            ? 'Boundary and road-width deviations must be rectified and a revised site plan submitted.'
            : 'Building line falls within the water-body buffer; the proposal cannot be permitted as designed.',
    },
    META
  );
  if (partial) return;

  const signed = await submitInspection(
    inspector,
    booked.id,
    outcome === 'SHORTFALL'
      ? { method: 'USB_TOKEN_DEMO', pin: DEMO_TOKEN_PIN, declaration: true }
      : { method: 'AADHAAR_ESIGN_DEMO', aadhaarLast4: String(4000 + index * 137).slice(-4), otp: DEMO_ESIGN_OTP, declaration: true },
    META
  );
  console.log(`      signed ${signed.inspectionNumber} → ${signed.workflow.toStageCode}${signed.workflow.shortfallNumbers.length ? ` (${signed.workflow.shortfallNumbers.join(', ')})` : ''}`);
}

async function main() {
  console.log(`\nSite inspections — ${APPLY ? 'APPLYING' : 'dry run (pass --apply to write)'}\n`);
  const apps = await candidates();
  console.log(`  ${apps.length} file(s) at the BBAS TPA desk with no inspection yet.`);
  for (const [i, outcome] of PLAN.entries()) {
    const app = apps[i];
    if (!app) {
      console.log(`    no file left for ${outcome}`);
      continue;
    }
    try {
      await run(outcome, app, i);
    } catch (error) {
      console.log(`    ✗ ${app.applicationNumber}: ${(error as Error).message}`);
      const details = (error as { details?: unknown }).details;
      if (details) console.log('     ', JSON.stringify(details).slice(0, 400));
    }
  }
  const counts = await prisma.siteInspection.groupBy({ by: ['status', 'recommendation'], _count: true });
  console.log('\n  Now in the register:', counts.map((c) => `${c.status}${c.recommendation ? `/${c.recommendation}` : ''}=${c._count}`).join(' · ') || 'none');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
