/**
 * RE-ROUTES ACTIVE FILES ONTO BBAS_STANDARD.
 *
 *   npm run bbas:align            report what would change, change nothing
 *   npm run bbas:align -- --apply perform it
 *
 * Seeding creates BBAS_STANDARD and points the application TYPES at it, so
 * every NEW file runs through the BBAS chain. That does nothing for the files
 * already in flight: a `workflow_instances` row pins the workflow and version
 * it started under, deliberately, so that editing configuration cannot corrupt
 * a file somebody is holding. Moving one is therefore never a side effect of a
 * seed. It is this — an explicit, audited operation you have to ask for.
 *
 * ── What it will not touch ───────────────────────────────────────────────
 *
 *   · Any application whose workflow instance is not ACTIVE. An approved or
 *     rejected file keeps the chain it was decided under, because its history
 *     names those desks and its approval order was issued by one of them.
 *     Re-routing a closed file would make its own record incoherent.
 *   · Any existing `audit_logs`, `workflow_history` or `application_events`
 *     row. All three are append-only; this adds rows, and rewrites none.
 *   · Application numbers, ids, documents, drawings, payments, fees,
 *     shortfalls or approval orders. None of them is read or written here.
 *   · Applications with no workflow instance at all — everything still on the
 *     applicant side of the payment gate. They have not been routed anywhere
 *     yet, and when they are it will be through their type's workflow, which
 *     is already BBAS_STANDARD.
 *
 * ── The desk map, and why it reads the way it does ───────────────────────
 *
 * BP_STANDARD has six departmental desks; BBAS_STANDARD has four. Files above
 * ZJD in the old chain have already passed every technical desk and are
 * waiting on a final decision — which in the BBAS chain is the ZJD's, because
 * the manuals put no authority above it. They therefore land at ZJD_REVIEW.
 * That is a judgement, it is recorded in the remarks of every row this writes,
 * and it is the only one this script makes.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { seedDemoStaff } from '../prisma/seed/demo/users';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
/** How many files to carry from the TPA desk to the Planning Officer. */
const POPULATE_PO = Number(
  process.argv.find((a) => a.startsWith('--populate-po='))?.split('=')[1] ?? '0'
);
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345';

/** Legacy stage code → the BBAS desk that inherits its work. */
const STAGE_MAP: Record<string, string> = {
  TPA_REVIEW: 'TPA_REVIEW',
  ZAD_ZDD_REVIEW: 'ZDD_REVIEW',
  ZJD_REVIEW: 'ZJD_REVIEW',
  // Above the ZJD in the old chain: already technically cleared, awaiting a
  // decision. In BBAS_STANDARD that decision is the ZJD's.
  DIRECTOR_DP_REVIEW: 'ZJD_REVIEW',
  ADDL_COMMISSIONER_REVIEW: 'ZJD_REVIEW',
  COMMISSIONER_REVIEW: 'ZJD_REVIEW',
  // Applicant-side stages keep their code; BBAS_STANDARD has the same ones.
  LTP_SHORTFALL_ACTION: 'LTP_SHORTFALL_ACTION',
  LTP_DRAFT: 'LTP_DRAFT',
  LTP_DRAWING: 'LTP_DRAWING',
  LTP_DOCUMENTS: 'LTP_DOCUMENTS',
  LTP_PAYMENT: 'LTP_PAYMENT',
};

/**
 * Legacy status → its BBAS equivalent.
 *
 * A status that names a desk has to move with the file, or the register would
 * show "Pending — Commissioner" on a file sitting in the ZJD's queue. Statuses
 * that name no desk — SHORTFALL_RESPONDED, RETURNED_TO_APPLICANT, every
 * applicant-side one — are absent here on purpose and are left exactly as they
 * are.
 */
const STATUS_MAP: Record<string, string> = {
  PENDING_ZAD_ZDD: 'PENDING_ZDD',
  ZAD_ZDD_REVIEW: 'ZDD_REVIEW',
  ZAD_ZDD_SHORTFALL: 'ZDD_SHORTFALL',

  PENDING_DIRECTOR_DP: 'PENDING_ZJD',
  DIRECTOR_REVIEW: 'ZJD_REVIEW',
  DIRECTOR_SHORTFALL: 'ZJD_SHORTFALL',
  // The file travels carrying an open REPORTED shortfall. It is waiting at the
  // apex desk, so that is what the register should say; the shortfall itself is
  // untouched and still blocks approval.
  DIRECTOR_REPORTED_SHORTFALL: 'PENDING_ZJD',

  PENDING_ADDITIONAL_COMMISSIONER: 'PENDING_ZJD',
  ADDITIONAL_COMMISSIONER_REVIEW: 'ZJD_REVIEW',
  ADDITIONAL_COMMISSIONER_SHORTFALL: 'ZJD_SHORTFALL',

  PENDING_COMMISSIONER: 'PENDING_ZJD',
  COMMISSIONER_REVIEW: 'ZJD_REVIEW',
  COMMISSIONER_SHORTFALL: 'ZJD_SHORTFALL',
};

/** The role a task at each BBAS desk is addressed to. */
const DESK_ROLE: Record<string, string> = {
  TPA_REVIEW: 'TPA',
  PLANNING_OFFICER_REVIEW: 'PLANNING_OFFICER',
  ZDD_REVIEW: 'ZDD',
  ZJD_REVIEW: 'ZJD',
  LTP_SHORTFALL_ACTION: 'LTP',
};

const REMARK =
  'Re-routed from BP_STANDARD to BBAS_STANDARD by scripts/align-bbas-workflow.ts. ' +
  'The file keeps its number, its history and its documents; only the desk it is ' +
  'waiting at has changed.';

async function main() {
  console.log(`\nBBAS workflow alignment${APPLY ? '' : ' — DRY RUN, nothing will be written'}\n`);

  const bbas = await prisma.workflow.findFirstOrThrow({
    where: { code: 'BBAS_STANDARD', version: 1 },
    select: { id: true, version: true, isPublished: true },
  });
  if (!bbas.isPublished) {
    throw new Error('BBAS_STANDARD is not published. Run `npm run db:seed` first.');
  }

  const bbasStages = await prisma.workflowStage.findMany({
    where: { workflowId: bbas.id },
    select: { id: true, code: true, entryStatus: true, workingStatus: true },
  });
  const bbasStageByCode = new Map(bbasStages.map((s) => [s.code, s]));

  // ── The extra desk holders ────────────────────────────────────────────
  //
  // po2 and zdd2 cover the zones the primary accounts do not. `npm run
  // seed:demo` would create them, but it stops early once the seventy
  // applications exist — which they do — so it never reaches the accounts.
  if (APPLY) {
    const staff = await seedDemoStaff(prisma, DEMO_PASSWORD);
    console.log(`  Desk holders  ${staff.total} demo staff (${staff.created} new, ${staff.updated} updated)\n`);
  }

  // ── The files in flight ───────────────────────────────────────────────
  const instances = await prisma.workflowInstance.findMany({
    where: {
      // ACTIVE is a file at a desk; PARKED is one waiting on the applicant to
      // answer a blocking shortfall. Both are in flight and both move. Only
      // COMPLETED is left alone — see the header.
      status: { in: ['ACTIVE', 'PARKED'] },
      workflow: { code: 'BP_STANDARD' },
      application: { deletedAt: null },
    },
    select: {
      id: true,
      currentStageId: true,
      parkedStageId: true,
      application: { select: { id: true, applicationNumber: true, status: true, zoneId: true } },
    },
  });

  const legacyStages = await prisma.workflowStage.findMany({
    where: { workflow: { code: 'BP_STANDARD' } },
    select: { id: true, code: true },
  });
  const legacyCodeById = new Map(legacyStages.map((s) => [s.id, s.code]));

  console.log(`  ${instances.length} file(s) in flight on BP_STANDARD.\n`);

  const tally = new Map<string, number>();
  let moved = 0;
  const skipped: string[] = [];

  for (const inst of instances) {
    const fromCode = inst.currentStageId ? legacyCodeById.get(inst.currentStageId) : undefined;
    if (!fromCode) {
      skipped.push(`${inst.application.applicationNumber}: no current stage`);
      continue;
    }

    const toCode = STAGE_MAP[fromCode];
    const toStage = toCode ? bbasStageByCode.get(toCode) : undefined;
    if (!toCode || !toStage) {
      skipped.push(`${inst.application.applicationNumber}: ${fromCode} has no BBAS equivalent`);
      continue;
    }

    // A parked file resumes at the desk that parked it, so that pointer has to
    // move with everything else or RESUBMIT would land it in another workflow.
    const parkedFrom = inst.parkedStageId ? legacyCodeById.get(inst.parkedStageId) : undefined;
    const parkedTo = parkedFrom ? bbasStageByCode.get(STAGE_MAP[parkedFrom] ?? '') : undefined;
    if (parkedFrom && !parkedTo) {
      skipped.push(`${inst.application.applicationNumber}: parked at ${parkedFrom}, no BBAS equivalent`);
      continue;
    }

    const fromStatus = inst.application.status;
    const toStatus = STATUS_MAP[fromStatus] ?? fromStatus;

    tally.set(`${fromCode} → ${toCode}`, (tally.get(`${fromCode} → ${toCode}`) ?? 0) + 1);
    moved += 1;

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      await reroute(tx, {
        instanceId: inst.id,
        applicationId: inst.application.id,
        workflowId: bbas.id,
        workflowVersion: bbas.version,
        toStageId: toStage.id,
        toStageCode: toCode,
        parkedStageId: parkedTo?.id ?? null,
        fromStageCode: fromCode,
        fromStatus,
        toStatus,
      });
    });
  }

  console.log('  Desk map applied:');
  for (const [move, n] of [...tally.entries()].sort()) {
    console.log(`    ${String(n).padStart(3)}  ${move}`);
  }
  if (skipped.length) {
    console.log('\n  Skipped:');
    for (const s of skipped) console.log(`    ${s}`);
  }

  console.log(
    `\n  ${APPLY ? 'Moved' : 'Would move'} ${moved} file(s). ` +
      `${instances.length - moved - skipped.length === 0 ? '' : 'Some were left in place.'}`
  );

  if (!APPLY) {
    console.log('\n  Nothing was written. Re-run with `-- --apply` to perform it.\n');
    return;
  }

  if (POPULATE_PO > 0) await populatePlanningOfficer(POPULATE_PO);

  console.log('\n  Re-run `npm run demo:verify` to confirm the registers still reconcile.\n');
}

/**
 * Carries files from the TPA desk to the Planning Officer, through the engine.
 *
 * The desk map cannot fill this queue. BP_STANDARD had no Planning Officer, so
 * no file was ever waiting at one, and inventing a cohort by writing
 * `PENDING_PLANNING_OFFICER` into a column would produce exactly the kind of
 * state the demo seed exists to avoid: a status with no history behind it, no
 * task, no SLA clock and no audit row.
 *
 * So the files are FORWARDED, by a real TPA with jurisdiction over the zone,
 * through `performAction` — the same call the officer's action bar makes. The
 * engine writes the history row, closes the TPA's task, opens the Planning
 * Officer's, starts the new clock and emits the notification. What ends up at
 * the desk is a file that genuinely arrived there.
 *
 * Only files with nothing outstanding are moved: an open shortfall means the
 * TPA is waiting on the applicant, and forwarding it would misrepresent the
 * case.
 */
async function populatePlanningOfficer(count: number) {
  const { performAction } = await import('../src/server/workflow/engine');

  const candidates = await prisma.application.findMany({
    where: {
      deletedAt: null,
      currentStageCode: 'TPA_REVIEW',
      status: { in: ['PENDING_TPA', 'TPA_REVIEW'] },
      openShortfalls: 0,
      workflowInstance: { status: 'ACTIVE', workflow: { code: 'BBAS_STANDARD' } },
    },
    select: { id: true, applicationNumber: true, zoneId: true },
    orderBy: { applicationNumber: 'asc' },
    take: count,
  });

  console.log(`\n  Planning Officer desk: forwarding ${candidates.length} file(s) from the TPA.`);

  let done = 0;
  for (const app of candidates) {
    const tpa = await actorForRoleInZone('TPA', app.zoneId);
    if (!tpa) {
      console.log(`    ${app.applicationNumber}: no TPA with jurisdiction — left at the TPA desk`);
      continue;
    }

    try {
      await performAction(
        tpa,
        app.id,
        'FORWARD',
        {
          remarks:
            'Technical scrutiny complete. Checklist, documents and fee position verified. ' +
            'Forwarded to the Planning Officer for endorsement.',
        },
        { ip: '127.0.0.1', userAgent: 'align-bbas-workflow', correlationId: 'bbas-alignment' }
      );
      done += 1;
      console.log(`    ${app.applicationNumber} → Planning Officer`);
    } catch (err) {
      console.log(`    ${app.applicationNumber}: refused — ${(err as Error).message}`);
    }
  }

  console.log(`  ${done} file(s) now waiting at the Planning Officer.`);
}

/**
 * A real officer of this role who covers this zone, as an AuthUser.
 *
 * The services' own type, carrying the capabilities the role really holds and
 * the zones the stored account really covers — not a superuser. Handing the
 * engine an actor with more authority than any real officer would let it write
 * transitions the product itself could never produce.
 */
async function actorForRoleInZone(roleKey: string, zoneId: string | null) {
  const { RBAC_MATRIX } = await import('../src/lib/rbac-matrix');

  const user = await prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: roleKey } } },
      ...(zoneId
        ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] }
        : {}),
    },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });
  if (!user) return null;

  const roleKeys = user.roles.map((r) => r.role.key);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys: roleKeys as never,
    roleNames: user.roles.map((r) => r.role.name),
    capabilities: [
      ...new Set(
        roleKeys.flatMap((key) => (RBAC_MATRIX[key as never] ?? []) as unknown as string[])
      ),
    ],
    zoneIds: [
      ...new Set([
        ...(user.primaryZoneId ? [user.primaryZoneId] : []),
        ...user.jurisdictions.map((j) => j.zoneId),
      ]),
    ],
    officeId: user.officeId,
    sessionId: 'bbas-alignment',
  };
}

/**
 * One file's move, inside one transaction.
 *
 * Every write here either updates a MUTABLE pointer (which desk the file is
 * at) or APPENDS to an append-only record. Nothing existing is rewritten.
 */
async function reroute(
  tx: Prisma.TransactionClient,
  p: {
    instanceId: string;
    applicationId: string;
    workflowId: string;
    workflowVersion: number;
    toStageId: string;
    toStageCode: string;
    parkedStageId: string | null;
    fromStageCode: string;
    fromStatus: string;
    toStatus: string;
  }
) {
  // ── The instance's pin ──────────────────────────────────────────────
  await tx.workflowInstance.update({
    where: { id: p.instanceId },
    data: {
      workflowId: p.workflowId,
      workflowVersion: p.workflowVersion,
      currentStageId: p.toStageId,
      parkedStageId: p.parkedStageId,
    },
  });

  // ── The open task ───────────────────────────────────────────────────
  //
  // Re-addressed rather than closed and recreated: closing it would record a
  // completion that never happened, and recreating it would reset the received
  // date the officer's queue sorts and measures by. An officer who had claimed
  // the file keeps it — they are the same person, at a desk with a new name.
  const role = DESK_ROLE[p.toStageCode];
  if (role) {
    await tx.workflowTask.updateMany({
      where: { instanceId: p.instanceId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      data: { stageId: p.toStageId, assignedRoleKey: role },
    });
  }

  // ── The application's denormalised pointers ─────────────────────────
  await tx.application.update({
    where: { id: p.applicationId },
    data: {
      currentStageId: p.toStageId,
      currentStageCode: p.toStageCode,
      status: p.toStatus,
    },
  });

  // ── Append to the movement record ───────────────────────────────────
  const lastHistory = await tx.workflowHistory.findFirst({
    where: { instanceId: p.instanceId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  await tx.workflowHistory.create({
    data: {
      instanceId: p.instanceId,
      sequence: (lastHistory?.sequence ?? 0) + 1,
      fromStageCode: p.fromStageCode,
      toStageCode: p.toStageCode,
      fromStatus: p.fromStatus,
      toStatus: p.toStatus,
      actionCode: 'WORKFLOW_REALIGNED',
      actionLabel: 'Workflow realigned',
      // Null: nobody performed this. A name here would be a fiction on a record
      // that is quoted back to applicants.
      actorId: null,
      actorName: 'System',
      actorRoleKey: 'SYSTEM',
      remarks: REMARK,
    },
  });

  // ── Append to the human-readable timeline ───────────────────────────
  const lastEvent = await tx.applicationEvent.findFirst({
    where: { applicationId: p.applicationId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  await tx.applicationEvent.create({
    data: {
      applicationId: p.applicationId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      type: 'WORKFLOW_REALIGNED',
      title: 'Moved to the BBAS approval chain',
      description:
        `The file was at ${p.fromStageCode.replace(/_/g, ' ').toLowerCase()} and now waits at ` +
        `${p.toStageCode.replace(/_/g, ' ').toLowerCase()}. Nothing already decided has changed.`,
      actorName: 'System',
      actorRoleKey: 'SYSTEM',
      metadata: {
        fromWorkflow: 'BP_STANDARD',
        toWorkflow: 'BBAS_STANDARD',
        fromStageCode: p.fromStageCode,
        toStageCode: p.toStageCode,
        fromStatus: p.fromStatus,
        toStatus: p.toStatus,
      },
    },
  });

  // ── Append to the audit chain ───────────────────────────────────────
  //
  // Through the service, so the row is hashed onto the head of the chain under
  // the same advisory lock every other append takes.
  const { audit } = await import('../src/server/services/audit');
  await audit(tx, {
    action: 'WORKFLOW_REALIGNED',
    entityType: 'WorkflowInstance',
    entityId: p.instanceId,
    applicationId: p.applicationId,
    before: { workflow: 'BP_STANDARD', stageCode: p.fromStageCode, status: p.fromStatus },
    after: { workflow: 'BBAS_STANDARD', stageCode: p.toStageCode, status: p.toStatus },
    remarks: REMARK,
    ip: '127.0.0.1',
    userAgent: 'align-bbas-workflow',
    correlationId: 'bbas-alignment',
  });
}

main()
  .catch((err) => {
    console.error('\nAlignment failed:\n', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
