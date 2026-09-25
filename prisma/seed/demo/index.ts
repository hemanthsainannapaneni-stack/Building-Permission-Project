import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import { type RoleKey } from '../../../src/lib/constants';
import { sweepSla } from '../../../src/server/workflow/sla';
import { invalidateSettingsCache } from '../../../src/server/services/settings';
import { makeRng } from './rng';
import { BUILDING_PROFILES } from './dataset';
import { PLAN, PLANNED_TOTAL, planItems, type Stop } from './plan';
import { seedDemoStaff } from './users';
import {
  buildApplication,
  META as META_SEED,
  type Actor,
  type JourneyContext,
  type JourneyResult,
} from './journey';
import { backdateApplication, backdateFileObjects, withTriggersDisabled } from './backdate';

/**
 * THE DEMO ENVIRONMENT.
 *
 *   npm run seed:demo            build it, or report that it is already built
 *   npm run seed:demo:reset      wipe the application data and rebuild it
 *
 * ── Idempotence ──────────────────────────────────────────────────────────
 *
 * The manifest in `system_settings.demo_seed_manifest` records exactly which
 * applications this seed created. A second run reads it, finds those rows
 * still present, and stops — so `npm run seed:demo` twice leaves seventy
 * applications, not a hundred and forty.
 *
 * It cannot instead delete and rebuild: an application that has taken money is
 * not deletable by design (`payments.applicationId` is ON DELETE RESTRICT) and
 * workflow history refuses DELETE at the database level. Those rules are
 * correct and this script does not get an exception from them. `--reset` is
 * the documented way out, and it TRUNCATEs — which the constraints migration
 * deliberately left available precisely so a development database can be
 * rebuilt.
 *
 * ── Refusals ─────────────────────────────────────────────────────────────
 *
 * Neither mode runs when NODE_ENV is production. `--reset` additionally
 * refuses unless LAMS_ALLOW_DEMO_RESET is set, because a truncate that hits
 * the wrong database is not recoverable by apologising.
 */

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const RESET = process.argv.includes('--reset');
const SEED = Number(process.env.DEMO_SEED ?? 20260831);

const MANIFEST_KEY = 'demo_seed_manifest';
const MANIFEST_VERSION = 1;

type Manifest = {
  version: number;
  seededAt: string;
  rngSeed: number;
  applications: Array<{ id: string; number: string; stop: string; status: string }>;
};

/** Application data only. RBAC, org, catalogue, workflow config and audit stay. */
const TRUNCATE_TABLES = [
  'applications',
  'application_drafts',
  'applicants',
  'property_details',
  'building_details',
  'application_events',
  'drawings',
  'drawing_versions',
  'bim_submissions',
  'bim_models',
  'bim_model_versions',
  'scrutiny_requests',
  'scrutiny_results',
  'scrutiny_issues',
  'scrutiny_reports',
  'application_documents',
  'document_versions',
  'file_objects',
  'application_fees',
  'fee_line_items',
  'payments',
  'payment_transactions',
  'payment_webhook_events',
  'payment_receipts',
  'refunds',
  'workflow_instances',
  'workflow_tasks',
  'workflow_history',
  'sla_instances',
  'shortfalls',
  'shortfall_items',
  'shortfall_resolutions',
  'notifications',
  'notification_logs',
  'approval_orders',
  'outbox_events',
  'jobs',
  'number_sequences',
  'audit_logs',
];

// ═══════════════════════════════════════════════════════════════════════════
// Job queue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs the queue to a standstill, the way the worker would.
 *
 * Scanning, scrutiny and notification dispatch are all jobs. Without this the
 * seed would leave every file at "virus check pending" and no application
 * would ever be allowed near the scrutiny engine.
 */
async function drainJobs(maxPasses = 200): Promise<number> {
  const { claimNext, markSucceeded, markFailed } = await import('../../../src/server/jobs/queue');
  const { getHandler } = await import('../../../src/server/jobs/handlers');

  let ran = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let job = await claimNext('demo-seed');

    if (!job) {
      // A retry or a re-scheduled poll sits PENDING with `runAt` in the
      // future. The worker waits; a seed must not.
      const pulled = await prisma.job.updateMany({
        where: { status: 'PENDING', runAt: { gt: new Date() } },
        data: { runAt: new Date() },
      });
      if (pulled.count === 0) break;

      job = await claimNext('demo-seed');
      if (!job) break;
    }

    const handler = getHandler(job.type);
    if (!handler) {
      await markFailed(job, new Error(`No handler registered for ${job.type}`));
      throw new Error(`No handler registered for job type ${job.type}`);
    }

    try {
      await handler(job);
      await markSucceeded(job.id);
    } catch (err) {
      // Exactly what the worker does: back off, and dead-letter once the
      // attempts are spent.
      await markFailed(job, err);
    }
    ran += 1;
  }

  return ran;
}

/**
 * Empties the transactional outbox, the way the worker does.
 *
 * Batched rather than one pass: `dispatchOutbox` claims a page at a time, and
 * seventy applications generate several thousand events. The loop stops when a
 * pass claims nothing, and is bounded so a permanently failing event cannot
 * spin here for ever — an event that errors is deliberately left unprocessed
 * so the real worker returns to it.
 */
async function drainOutbox(maxPasses = 400) {
  const { dispatchOutbox } = await import('../../../src/server/notifications/dispatcher');

  const total = { events: 0, sent: 0, failed: 0, skipped: 0, errored: 0 };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const report = await dispatchOutbox(50);
    if (report.events === 0) break;

    total.events += report.events;
    total.sent += report.sent;
    total.failed += report.failed;
    total.skipped += report.skipped;
    total.errored += report.errored;

    // Every event in the batch errored rather than merely failing to deliver.
    // That is infrastructure, not a message problem, and grinding through
    // another three hundred passes will not fix it.
    if (report.errored === report.events) break;
  }

  return total;
}

// ═══════════════════════════════════════════════════════════════════════════
// Settings the mock providers read
// ═══════════════════════════════════════════════════════════════════════════

async function setSetting(key: string, value: string, group: string, type: 'STRING' | 'NUMBER') {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value, type, group, label: key, description: 'Demo seed.' },
  });
  invalidateSettingsCache();
}

const setScrutinyPassFrom = (version: number) =>
  setSetting('mock_scrutiny_pass_from_version', String(version), 'scrutiny', 'NUMBER');

// ═══════════════════════════════════════════════════════════════════════════
// Actors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A synthetic AuthUser carrying the capabilities its role REALLY holds, and
 * the zones the stored account really covers.
 *
 * Not a shortcut: giving the seed a superuser would let it build applications
 * the product itself could never produce — a Zone V file reviewed by an
 * officer with no Zone V jurisdiction, say — and the demo would then be
 * showing states the running system cannot reach.
 */
async function actorFor(email: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });

  const roleKeys = user.roles.map((r) => r.role.key as RoleKey);

  const zoneIds = [
    ...new Set([
      ...(user.primaryZoneId ? [user.primaryZoneId] : []),
      ...user.jurisdictions.map((j) => j.zoneId),
    ]),
  ];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys,
    roleNames: user.roles.map((r) => r.role.name),
    capabilities: [...new Set(roleKeys.flatMap((key) => RBAC_MATRIX[key] as unknown as string[]))],
    zoneIds,
    officeId: user.officeId,
    sessionId: 'demo-seed',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function readManifest(): Promise<Manifest | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: MANIFEST_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Manifest;
    return parsed.version === MANIFEST_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: Manifest) {
  await prisma.systemSetting.upsert({
    where: { key: MANIFEST_KEY },
    update: { value: JSON.stringify(manifest) },
    create: {
      key: MANIFEST_KEY,
      value: JSON.stringify(manifest),
      type: 'JSON',
      group: 'demo',
      label: 'Demo seed manifest',
      description:
        'What `npm run seed:demo` created, so a second run does not duplicate it. Not business configuration.',
    },
  });
}

async function resetApplicationData() {
  if (!process.env.LAMS_ALLOW_DEMO_RESET) {
    throw new Error(
      'Refusing to reset. Set LAMS_ALLOW_DEMO_RESET=1 to confirm you mean this database.\n' +
        `  DATABASE_URL host: ${describeDatabase()}`
    );
  }

  console.log(`  Reset       truncating application data on ${describeDatabase()}`);

  for (const t of TRUNCATE_TABLES) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`);
    } catch {
      // Table might not exist or already be empty
    }
  }
}

/** Host and database name only — never the credentials. */
function describeDatabase(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return `${url.host}${url.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main() {
  const started = Date.now();

  if (IS_PRODUCTION) {
    throw new Error('The demo seed does not run with NODE_ENV=production.');
  }

  console.log('\nLAMS demo environment\n');

  if (RESET) await resetApplicationData();

  // ── Preconditions ─────────────────────────────────────────────────────
  const workflow = await prisma.workflow.findFirst({
    where: { isPublished: true },
    select: { code: true, version: true },
  });

  if (!workflow) {
    throw new Error(
      'No published workflow. Run `npm run db:seed` first — without it no application can leave the payment gate.'
    );
  }

  const existing = await readManifest();
  if (existing && !RESET) {
    const stillThere = await prisma.application.count({
      where: { id: { in: existing.applications.map((a) => a.id) }, deletedAt: null },
    });

    if (stillThere === existing.applications.length) {
      console.log(
        `  Already seeded — ${stillThere} demo applications from ${new Date(existing.seededAt).toLocaleString('en-IN')}.\n` +
          '  Nothing to do. Use `npm run seed:demo:reset` to rebuild it.\n'
      );
      return;
    }

    console.log(
      `  Manifest lists ${existing.applications.length} applications but ${stillThere} are present. Rebuilding the missing ones is not\n` +
        '  supported — run `npm run seed:demo:reset` for a clean environment.\n'
    );
    return;
  }

  // ── Accounts ──────────────────────────────────────────────────────────
  const staff = await seedDemoStaff(prisma, DEMO_PASSWORD);
  console.log(`  Accounts    ${staff.total} extra demo users (${staff.created} new, ${staff.updated} updated)`);

  // ── Deterministic providers ───────────────────────────────────────────
  await setSetting('mock_scrutiny_mode', 'VERSION_LADDER', 'scrutiny', 'STRING');
  await setSetting('mock_scrutiny_delay_ms', '0', 'scrutiny', 'NUMBER');
  await setSetting('mock_scrutiny_error_rate', '0', 'scrutiny', 'NUMBER');
  await setSetting('mock_payment_mode', 'MANUAL', 'payments', 'STRING');
  await setSetting('mock_payment_delay_ms', '0', 'payments', 'NUMBER');

  // ── Actors ────────────────────────────────────────────────────────────
  const ltps = await Promise.all(
    ['ltp.demo@example.com', 'ltp2.demo@example.com', 'ltp3.demo@example.com', 'ltp4.demo@example.com'].map(
      actorFor
    )
  );

  const officers = await Promise.all(
    [
      // The BBAS_STANDARD desks. Between them every zone Z1–Z5 has a TPA,
      // a Planning Officer, a ZDD and a ZJD — officerFor() throws otherwise.
      'tpa.demo@example.com',
      'tpa2.demo@example.com',
      'po.demo@example.com',
      'po2.demo@example.com',
      'zdd.demo@example.com',
      'zdd2.demo@example.com',
      'zjd.demo@example.com',
      'zjd2.demo@example.com',
    ].map(actorFor)
  );

  const finance = await actorFor('finance.demo@example.com');
  const admin = await actorFor('admin.demo@example.com');

  /**
   * The officer who can actually see this zone at this level.
   *
   * City-wide roles hold no zones, so an empty `zoneIds` matches everything —
   * which is exactly what `applicationScope` does for them.
   */
  const officerFor = (roleKeys: string[], zoneId: string): Actor => {
    const found = officers.find(
      (o) =>
        o.roleKeys.some((r) => roleKeys.includes(r)) &&
        (o.zoneIds.length === 0 || o.zoneIds.includes(zoneId))
    );
    if (!found) throw new Error(`No demo officer for ${roleKeys.join('/')} in zone ${zoneId}`);
    return found;
  };

  const [applicationTypes, zones] = await Promise.all([
    prisma.applicationType.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, code: true, numberPrefix: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.zone.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const rng = makeRng(SEED);

  const ctx: JourneyContext = {
    prisma,
    rng,
    ltps,
    officerFor,
    finance,
    admin,
    applicationTypes,
    zones,
    drainJobs,
    setScrutinyPassFrom,
  };

  // ── The seventy ───────────────────────────────────────────────────────
  //
  // SCRUTINY_QUEUED goes LAST, and that ordering is load-bearing rather than
  // cosmetic: those two files rest with their scrutiny run still in the queue,
  // and any later application's `drainJobs()` would run it and move them on.
  const items = planItems().sort((a, b) => {
    const rank = (s: Stop) => (s === 'SCRUTINY_QUEUED' ? 1 : 0);
    return rank(a.stop) - rank(b.stop);
  });

  console.log(`  Building    ${items.length} applications through the real services…`);

  const built: Manifest['applications'] = [];
  const timings: Array<{ id: string; t0: Date; t1: Date; start: Date; end: Date }> = [];
  /** Files whose scrutiny run is requested after every other application. */
  const deferredScrutiny: Array<{ id: string; ltp: Actor }> = [];
  const now = Date.now();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const zone = zones[i % zones.length]!;

    // Layout approvals are genuinely rarer than building permissions, and the
    // mix is what makes the LP/ prefix visible in the register at all.
    const type = rng.chance(0.15)
      ? (applicationTypes.find((t) => t.numberPrefix === 'LP') ?? applicationTypes[0]!)
      : (applicationTypes.filter((t) => t.numberPrefix === 'BP')[rng.int(0, 1)] ??
        applicationTypes[0]!);

    const [minAge, maxAge] = item.entry.ageDays;
    const ageDays = rng.int(minAge, maxAge);

    // How long it has been sitting untouched since the last thing happened.
    const idleDays = Math.min(ageDays - 1, rng.int(0, Math.max(1, Math.floor(ageDays * 0.25))));

    const t0 = new Date();

    let result: JourneyResult | null = null;
    let attempts = 0;
    while (!result && attempts < 3) {
      attempts += 1;
      try {
        result = await buildApplication(ctx, {
          stop: item.stop,
          ageDays,
          ltp: ltps[i % ltps.length]!,
          applicationType: type,
          zone,
          profile: rng.pick(BUILDING_PROFILES),
        });
      } catch (err) {
        if (attempts >= 3) {
          console.error(`\n  [WARN] Failed application ${i + 1} (${item.stop}) after 3 attempts:`, (err as Error).message);
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!result) continue;

    const t1 = new Date();

    built.push({
      id: result.applicationId,
      number: result.applicationNumber,
      stop: result.stop,
      status: result.status,
    });

    if (result.deferScrutiny) deferredScrutiny.push({ id: result.applicationId, ltp: ltps[i % ltps.length]! });

    timings.push({
      id: result.applicationId,
      t0,
      t1,
      start: new Date(now - ageDays * 86_400_000),
      end: new Date(now - idleDays * 86_400_000),
    });

    if ((i + 1) % 5 === 0 || i + 1 === items.length) {
      process.stdout.write(`              ${i + 1}/${items.length}\n`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }

  // ── The runs that are meant to still be queued ────────────────────────
  //
  // Requested here, after the last `drainJobs()` in the loop above, so the
  // jobs are genuinely pending. A worker that starts later will run them and
  // the files will move on — which is correct, not a defect: "scrutiny in
  // progress" describes work that has not finished, and the demo should show
  // it finishing.
  if (deferredScrutiny.length) {
    const { requestScrutiny } = await import('../../../src/server/services/scrutiny');
    for (const item of deferredScrutiny) {
      await requestScrutiny(item.ltp, item.id, META_SEED);
    }
    console.log(
      `  Scrutiny    ${deferredScrutiny.length} run(s) left queued — they are what SCRUTINY_IN_PROGRESS means`
    );
  }

  // ── Tell everybody ────────────────────────────────────────────────────
  //
  // Every action above wrote an outbox event INSIDE its transaction — that is
  // what guarantees an officer's decision and the applicant's message cannot
  // diverge. But the outbox is drained by the worker on a schedule rather than
  // by a job enqueued per event, so a seed that only runs the job queue leaves
  // the whole backlog unprocessed: no in-app notifications, no delivery log,
  // and an admin dashboard truthfully reporting three thousand undispatched
  // events.
  //
  // Draining it here is also the honest thing to do. A shortfall resting at
  // RAISED means the decision was recorded and NOBODY WAS TOLD, and the demo
  // should not be full of those unless it means to be.
  const dispatched = await drainOutbox();
  console.log(
    `  Notices     ${dispatched.events} events dispatched · ${dispatched.sent} messages sent · ` +
      `${dispatched.skipped} skipped (no template or no recipient)`
  );

  // ── Give it a past ────────────────────────────────────────────────────
  console.log('  Backdating  stretching each file onto its own span…');

  await withTriggersDisabled(prisma, async () => {
    for (const t of timings) {
      await backdateApplication(prisma, t.id, t.t0, t.t1, t.start, t.end);
    }
    await backdateFileObjects(prisma);
  });

  // Now that the clocks have moved, work out what they actually say. This is
  // the real sweep — the same one the worker runs — so an OVERDUE badge in the
  // demo means the due date really has passed.
  const sla = await sweepSla();
  console.log(
    `  SLA         ${sla.dueSoon} due soon · ${sla.overdue} overdue · ${sla.examined} clocks examined`
  );

  for (const item of deferredScrutiny) {
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: item.id },
      select: { status: true },
    });
    const entry = built.find((b) => b.id === item.id);
    if (entry) entry.status = row.status;
  }

  // Files that stopped before their drawings (drafts, bare submissions) never
  // reached the journey's BIM step. The backfill gives them a model too, so
  // every application in the demo has a BIM tab with something on it.
  const { backfillBim } = await import('./bim');
  await backfillBim(prisma, { apply: true, log: (line) => console.log(`  BIM       ${line.trim()}`) });

  // Phase 7: show cause, revocation and outward examples on the files built
  // above, through the real services. Adds to the plan's files; never builds one.
  const { seedProceedings } = await import('./proceedings');
  await seedProceedings(prisma, { apply: true, log: (line) => console.log(`  Proceed.  ${line.trim()}`) });

  // Phase 8: change of technical professional examples — pending, under
  // review, approved, rejected — through the real service and workflow.
  const { seedProfessionalChanges } = await import('./professional-changes');
  await seedProfessionalChanges(prisma, { apply: true, log: (line) => console.log(`  TP chg.   ${line.trim()}`) });

  // Phase 9: commencement of work — work initiated, pending commencement, and
  // files left at "proceeding issued" — through the real service and workflow.
  const { seedWorkCommencements } = await import('./work-commencements');
  await seedWorkCommencements(prisma, { apply: true, log: (line) => console.log(`  Work init ${line.trim()}`) });

  // Phase 10: occupancy — every state from completion pending to certificate
  // issued — through the real services and workflow.
  const { seedOccupancy } = await import('./occupancy');
  await seedOccupancy(prisma, { apply: true, log: (line) => console.log(`  Occupancy ${line.trim()}`) });

  // Phase 11: developer registration — every status and register, through
  // the real service. Belongs to no application.
  const { seedDevelopers } = await import('./developers');
  await seedDevelopers(prisma, { apply: true, log: (line) => console.log(`  Developer ${line.trim()}`) });

  // Phase 12: professional registration — every LTP account registered, and
  // fictional professionals in every status, through the real service.
  const { seedProfessionals } = await import('./professionals');
  await seedProfessionals(prisma, { apply: true, log: (line) => console.log(`  Prof.     ${line.trim()}`) });

  await writeManifest({
    version: MANIFEST_VERSION,
    seededAt: new Date().toISOString(),
    rngSeed: SEED,
    applications: built,
  });

  // ── Report ────────────────────────────────────────────────────────────
  const byStatus = await prisma.application.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
    orderBy: { status: 'asc' },
  });

  console.log(`\n  ${built.length} applications built. Status distribution:\n`);
  for (const row of byStatus) {
    console.log(`    ${row.status.padEnd(36)} ${String(row._count._all).padStart(3)}`);
  }

  const mismatches = built.filter((b) => {
    const planned = PLAN.find((p) => p.stop === b.stop);
    return planned && planned.landsOn !== b.status;
  });

  if (mismatches.length) {
    console.log('\n  WARNING — these files did not land where the plan said they would:');
    for (const m of mismatches) {
      const planned = PLAN.find((p) => p.stop === m.stop);
      console.log(`    ${m.number}  ${m.stop}: expected ${planned?.landsOn}, got ${m.status}`);
    }
  }

  console.log(
    `\n  Planned ${PLANNED_TOTAL} · built ${built.length} · seeded in ${Math.round((Date.now() - started) / 1000)}s (${NODE_ENV})\n`
  );
  console.log(`  Sign in with any demo account and the password ${DEMO_PASSWORD}.`);
  console.log('  Super Admin: admin.demo@example.com\n');
}

main()
  .catch((err) => {
    console.error('\nDemo seed failed:\n', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
