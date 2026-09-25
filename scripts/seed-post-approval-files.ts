/**
 * MORE APPROVED FILES, for the post-approval demonstrations (Phases 9 and 10).
 *
 *   npm run demo:approved              report what would happen, change nothing
 *   npm run demo:approved -- --apply   build them
 *
 * The demo plan approves five files, and Phase 7 put a show cause or a
 * revocation on each of them — so Work Initiated and Occupancy, which leave
 * those files to their own stories, had nothing to work on. This builds NEW
 * applications through the same journey the demo seed uses
 * (prisma/seed/demo/journey.ts): filed by an LTP, scrutinised, paid for, and
 * carried desk to desk to the ZJD's APPROVE — every step through the real
 * services and the workflow engine. It does not touch any existing file, so
 * the desks' queues are left exactly as they were.
 *
 * Idempotent: counts the approved files already free for post-approval work
 * and builds only the shortfall up to TARGET.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { RoleKey } from '../src/lib/constants';
import { invalidateSettingsCache } from '../src/server/services/settings';
import { makeRng } from '../prisma/seed/demo/rng';
import { BUILDING_PROFILES } from '../prisma/seed/demo/dataset';
import { buildApplication, type Actor, type JourneyContext } from '../prisma/seed/demo/journey';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
/** Work Initiated wants three, Occupancy nine — a dozen covers both. */
const TARGET = Number(process.env.POST_APPROVAL_FILES ?? 12);

async function actorFor(email: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { roles: { include: { role: true } }, jurisdictions: true } });
  const roleKeys = user.roles.map((r) => r.role.key as RoleKey);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys,
    roleNames: user.roles.map((r) => r.role.name),
    capabilities: [...new Set(roleKeys.flatMap((key) => RBAC_MATRIX[key] as unknown as string[]))],
    zoneIds: [...new Set([...(user.primaryZoneId ? [user.primaryZoneId] : []), ...user.jurisdictions.map((j) => j.zoneId)])],
    officeId: user.officeId,
    sessionId: 'demo-approved',
  };
}

async function setSetting(key: string, value: string, group: string, type: 'STRING' | 'NUMBER') {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value, type, group, label: key, description: 'Demo seed.' },
  });
  invalidateSettingsCache();
}

/** Runs the job queue to a standstill, the way the worker would — as the demo seed does. */
async function drainJobs(maxPasses = 200): Promise<number> {
  const { claimNext, markSucceeded, markFailed } = await import('../src/server/jobs/queue');
  const { getHandler } = await import('../src/server/jobs/handlers');
  let ran = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let job = await claimNext('demo-approved');
    if (!job) {
      const pulled = await prisma.job.updateMany({ where: { status: 'PENDING', runAt: { gt: new Date() } }, data: { runAt: new Date() } });
      if (pulled.count === 0) break;
      job = await claimNext('demo-approved');
      if (!job) break;
    }
    const handler = getHandler(job.type);
    if (!handler) {
      await markFailed(job, new Error(`No handler registered for ${job.type}`));
      continue;
    }
    try {
      await handler(job);
      await markSucceeded(job.id);
    } catch (err) {
      await markFailed(job, err);
    }
    ran += 1;
  }
  return ran;
}

async function main() {
  const free = await prisma.application.count({
    where: {
      deletedAt: null,
      status: 'APPROVED',
      currentStageCode: 'CLOSED_APPROVED',
      workflowInstance: { workflow: { code: 'BBAS_STANDARD' } },
      showCauses: { none: {} },
      revocations: { none: {} },
      ltpChanges: { none: {} },
    },
  });
  const needed = Math.max(0, TARGET - free);
  console.log(`${free} approved file(s) free for post-approval work; target ${TARGET}; ${needed} to build${APPLY ? '' : ' (dry run)'}.`);
  if (!needed || !APPLY) return;

  // The same deterministic mock providers the demo seed uses.
  await setSetting('mock_scrutiny_mode', 'VERSION_LADDER', 'scrutiny', 'STRING');
  await setSetting('mock_scrutiny_delay_ms', '0', 'scrutiny', 'NUMBER');
  await setSetting('mock_scrutiny_error_rate', '0', 'scrutiny', 'NUMBER');
  await setSetting('mock_payment_mode', 'MANUAL', 'payments', 'STRING');
  await setSetting('mock_payment_delay_ms', '0', 'payments', 'NUMBER');

  const ltps = await Promise.all(['ltp.demo@example.com', 'ltp2.demo@example.com', 'ltp3.demo@example.com', 'ltp4.demo@example.com'].map(actorFor));
  const officers = await Promise.all(
    ['tpa.demo@example.com', 'tpa2.demo@example.com', 'po.demo@example.com', 'po2.demo@example.com', 'zdd.demo@example.com', 'zdd2.demo@example.com', 'zjd.demo@example.com', 'zjd2.demo@example.com'].map(actorFor)
  );
  const officerFor = (roleKeys: string[], zoneId: string): Actor => {
    const found = officers.find((o) => o.roleKeys.some((r) => roleKeys.includes(r)) && (o.zoneIds.length === 0 || o.zoneIds.includes(zoneId)));
    if (!found) throw new Error(`No demo officer for ${roleKeys.join('/')} in zone ${zoneId}`);
    return found;
  };
  const [applicationTypes, zones] = await Promise.all([
    prisma.applicationType.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, code: true, numberPrefix: true, name: true }, orderBy: { code: 'asc' } }),
    prisma.zone.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
  ]);
  // A different seed from the main demo, so these are not copies of its first files.
  const rng = makeRng(Number(process.env.DEMO_SEED ?? 20260831) + 9_10);
  const ctx: JourneyContext = {
    prisma,
    rng,
    ltps,
    officerFor,
    finance: await actorFor('finance.demo@example.com'),
    admin: await actorFor('admin.demo@example.com'),
    applicationTypes,
    zones,
    drainJobs,
    setScrutinyPassFrom: (v: number) => setSetting('mock_scrutiny_pass_from_version', String(v), 'scrutiny', 'NUMBER'),
  };
  const bp = applicationTypes.filter((t) => t.numberPrefix === 'BP');

  for (let i = 0; i < needed; i += 1) {
    const zone = zones[i % zones.length]!;
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt += 1) {
      try {
        const r = await buildApplication(ctx, {
          stop: 'APPROVED',
          ageDays: rng.int(80, 200),
          ltp: ltps[i % ltps.length]!,
          applicationType: bp[i % Math.max(1, bp.length)] ?? applicationTypes[0]!,
          zone,
          profile: rng.pick(BUILDING_PROFILES),
        });
        console.log(`  ${i + 1}/${needed}  ${r.applicationNumber}  ${r.status}  (${zone.name})`);
        done = true;
      } catch (err) {
        console.error(`  ${i + 1}/${needed}  attempt ${attempt} failed: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }
  // Render the approval orders the APPROVE transitions enqueued.
  await drainJobs();
  const { dispatchOutbox } = await import('../src/server/notifications/dispatcher');
  for (let i = 0; i < 20; i += 1) if (!(await dispatchOutbox(50)).events) break;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
