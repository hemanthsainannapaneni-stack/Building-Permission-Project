import { PrismaClient } from '@prisma/client';

/**
 * Integration tests run against a REAL Postgres — the same migrations, the
 * same constraints, the same triggers.
 *
 * A mocked database would happily accept the writes the append-only triggers
 * and CHECK constraints exist to refuse, which is precisely what these tests
 * are for.
 */

// Vitest already sets NODE_ENV=test; only the secret needs supplying, and
// only when the developer's .env has not.
process.env.AUTH_SECRET ??= 'test-only-secret-at-least-32-characters-long';

// Uploads land in a directory of their own, so a test run never touches the
// developer's `.storage` and can be wiped wholesale between suites. Set BEFORE
// anything imports server/config/env, which parses process.env once at boot —
// this file is imported first by every suite that needs it.
process.env.STORAGE_LOCAL_DIR ??= './.storage-test';

export const prisma = new PrismaClient();

/**
 * Whether this database may be used by the integration suite.
 *
 * These tests CREATE AND DELETE ROWS, disable append-only triggers, truncate
 * the job queue and overwrite system settings. That is correct against a
 * throwaway database and catastrophic against the demonstration one — which is
 * a hosted Postgres holding 263 applications, their history and their audit
 * chain, and which `DATABASE_URL` points at by default for everybody working on
 * this repository.
 *
 * So the suite does not ask "is a database reachable". It asks "is this a
 * database I am allowed to destroy", and the answer must be YES BY NAME:
 * a local host, a database called *_test, or an explicit override. Anything
 * else skips, loudly, rather than running.
 *
 *   docker compose up -d db
 *   DATABASE_URL=postgresql://lams:lams@localhost:5433/lams_test npm test
 *
 * The check is deliberately on the allow side rather than a deny-list of known
 * demo hosts: a new environment must be named before it can be written to, and
 * the failure mode of getting it wrong is unrecoverable.
 */
function destructiveTestsPermitted(): { ok: boolean; why: string } {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS === '1') {
    return { ok: true, why: 'ALLOW_DESTRUCTIVE_TESTS=1' };
  }

  const url = process.env.DATABASE_URL ?? '';
  if (!url) return { ok: false, why: 'DATABASE_URL is not set' };

  let host = '';
  let database = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, '');
  } catch {
    return { ok: false, why: 'DATABASE_URL could not be parsed' };
  }

  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'db';
  const testDatabase = /(^|[_-])test(\d*)$/i.test(database);

  if (localHost || testDatabase) {
    return { ok: true, why: `${database} on ${host}` };
  }

  return {
    ok: false,
    why: `refusing to write to "${database}" on ${host} — not a local or *_test database`,
  };
}

let announced = false;

/**
 * True when a database is reachable AND safe to write to, so suites can skip
 * rather than fail — or rather than quietly destroying a demonstration.
 */
export async function databaseAvailable(): Promise<boolean> {
  const permitted = destructiveTestsPermitted();

  if (!permitted.ok) {
    if (!announced) {
      announced = true;
      console.warn(`\n  Integration tests skipped: ${permitted.why}.` +
        '\n  These suites write and delete rows. See tests/integration/setup.ts.\n');
    }
    return false;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Toggles an append-only trigger, tolerating one that is not installed.
 *
 * The triggers are created by SQL that lives outside the Prisma schema, so a
 * database stood up with `prisma db push` — which is how the throwaway test
 * database in docker-compose.yml is made — has the tables and none of the
 * triggers. A bare ALTER then fails with 42704 and takes the whole tidy-up
 * with it, which is how this suite came to be unable to clean up after itself
 * on a fresh database.
 *
 * Swallowing the error is safe in exactly this direction and no other: a
 * trigger that does not exist is not protecting anything, so there is nothing
 * to disable and nothing to restore. Any OTHER failure is re-thrown, so a
 * trigger that exists and refuses to be disabled still fails loudly — which is
 * the case that would matter.
 */
async function toggleTrigger(table: string, trigger: string, enable: boolean) {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${table} ${enable ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/does not exist/i.test(message)) throw error;
  }
}

/**
 * Removes the payments belonging to a set of LTPs, so their applications can
 * be deleted.
 *
 * Payments RESTRICT both the application and its demand: an application that
 * has taken money is not deletable, which is the point of the constraint. And
 * the append-only trigger on `payment_transactions` is BEFORE DELETE FOR EACH
 * ROW, so it fires on a CASCADE from the parent too — meaning nothing short of
 * disabling the trigger will remove a payment. That is exactly the property
 * the trigger exists to have in production.
 *
 * A test therefore disables it around its own tidy-up, in the same spirit as
 * TRUNCATE being deliberately left unblocked so `migrate reset` works. It is
 * re-enabled in a `finally`, so a failing cleanup cannot leave the development
 * database with an editable ledger.
 */
async function purgePayments(ltpUserIds: string[]) {
  if (!ltpUserIds.length) return 0;

  const payments = await prisma.payment.findMany({
    where: { application: { ltpUserId: { in: ltpUserIds } } },
    select: { id: true, paymentRef: true },
  });

  if (!payments.length) return 0;

  const ids = payments.map((p) => p.id);
  const refs = payments.map((p) => p.paymentRef);

  // Webhook events SET NULL rather than cascade, so they are cleared by hand.
  await prisma.paymentWebhookEvent.deleteMany({
    where: { OR: [{ paymentId: { in: ids } }, { paymentRef: { in: refs } }] },
  });

  await toggleTrigger('payment_transactions', 'payment_transactions_append_only', false);
  try {
    await toggleTrigger('payment_receipts', 'payment_receipts_immutable', false);
    try {
      await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await toggleTrigger('payment_receipts', 'payment_receipts_immutable', true);
    }
  } finally {
    await toggleTrigger('payment_transactions', 'payment_transactions_append_only', true);
  }

  return payments.length;
}

/**
 * Removes the workflow runs belonging to a set of LTPs.
 *
 * `workflow_history` is append-only by trigger, and the trigger is BEFORE
 * UPDATE OR DELETE FOR EACH ROW — so it fires on the CASCADE from the
 * application too, and nothing short of disabling it will remove a history
 * row. That is exactly the property the trigger exists to have in production:
 * a file's movement record is quoted back to applicants and must not be
 * editable, by anyone, including the application's own database role.
 *
 * A test therefore disables it around its own tidy-up, in the same spirit as
 * `purgePayments` above, and re-enables it in a `finally` so a failing cleanup
 * cannot leave the development database with an editable history.
 */
async function purgeWorkflow(ltpUserIds: string[]) {
  if (!ltpUserIds.length) return 0;

  const instances = await prisma.workflowInstance.findMany({
    where: { application: { ltpUserId: { in: ltpUserIds } } },
    select: { id: true },
  });

  if (!instances.length) return 0;

  const ids = instances.map((i) => i.id);

  await toggleTrigger('workflow_history', 'workflow_history_append_only', false);
  try {
    // Cascades to tasks, their SLA instances and the history rows. Shortfalls
    // point at history with ON DELETE SET NULL, so they survive to be removed
    // with the application itself.
    await prisma.workflowInstance.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await toggleTrigger('workflow_history', 'workflow_history_append_only', true);
  }

  return instances.length;
}

/** Removes only what a test created, identified by an email prefix. */
export async function cleanupTestUsers(prefix = 'test-') {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true, email: true },
  });
  if (!users.length) return 0;

  const ids = users.map((u) => u.id);
  const emails = users.map((u) => u.email);

  // Payments RESTRICT the application, so they go first — see purgePayments.
  await purgePayments(ids);
  await purgeWorkflow(ids);

  // Applications hold a REQUIRED reference to their LTP, with no cascade —
  // deleting the user first would fail the foreign key. Their own children
  // (applicant, property, building, draft, events) do cascade from here.
  await prisma.application.deleteMany({ where: { ltpUserId: { in: ids } } });

  // Order matters: children before parents.
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userJurisdiction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.loginAttempt.deleteMany({ where: { email: { in: emails } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  // audit_logs are append-only by design and are deliberately left behind.
  return users.length;
}

/** A minimal AuthUser for services that need an actor. */
export function actorFor(
  id: string,
  name = 'Test Actor',
  roleKeys: string[] = ['SYSTEM_ADMIN'],
  overrides: { capabilities?: string[]; zoneIds?: string[] } = {}
) {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@test.local`,
    roleKeys: roleKeys as never,
    // Display names only. Nothing under test branches on them, but AuthUser
    // carries them now and a stub that omits a field is a stub that stops
    // compiling the next time the real type grows.
    roleNames: roleKeys,
    capabilities: overrides.capabilities ?? [],
    zoneIds: overrides.zoneIds ?? [],
    officeId: null,
    sessionId: 'test-session',
  };
}

/**
 * Removes applications created by a test, and the number-sequence rows they
 * consumed.
 *
 * The sequences are reset too: without that, an assertion about the first
 * number a fresh scope issues would depend on how many times the suite had
 * been run before.
 */
export async function cleanupTestApplications(ltpUserIds: string[]) {
  if (!ltpUserIds.length) return 0;

  await purgePayments(ltpUserIds);
  await purgeWorkflow(ltpUserIds);

  // Children cascade from the application row.
  const { count } = await prisma.application.deleteMany({
    where: { ltpUserId: { in: ltpUserIds } },
  });
  return count;
}

export const META = { ip: '127.0.0.1', userAgent: 'vitest', correlationId: 'test' };


// ═══════════════════════════════════════════════════════════════════════════
// Jobs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs queued jobs to completion, the way the worker would.
 *
 * Tests exercise the REAL handler registry rather than calling services
 * directly, so the job wiring — payload shape, dedupe key, retry accounting —
 * is covered too. A handler that was never registered fails here loudly, which
 * is precisely the bug worth catching.
 *
 * `maxPasses` stops a job that re-enqueues itself (POLL_SCRUTINY does) from
 * spinning forever if something is wrong.
 */
export async function drainJobs(maxPasses = 60): Promise<number> {
  const { claimNext, markSucceeded, markFailed } = await import('@/server/jobs/queue');
  const { getHandler } = await import('@/server/jobs/handlers');

  let ran = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let job = await claimNext('vitest');

    if (!job) {
      // Nothing is due — but a retry after a failure, or a re-scheduled poll,
      // is PENDING with a `runAt` minutes into the future (exponential
      // backoff). The real worker waits; a test must not. Pulling those
      // forward is what lets the suite exercise the retry and polling paths
      // rather than skipping straight past them.
      const pulled = await prisma.job.updateMany({
        where: { status: 'PENDING', runAt: { gt: new Date() } },
        data: { runAt: new Date() },
      });
      if (pulled.count === 0) break;

      job = await claimNext('vitest');
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
      // attempts are exhausted.
      await markFailed(job, err);
    }
    ran += 1;
  }

  return ran;
}

/** Removes every job row, so one suite's queue cannot leak into the next. */
export async function clearJobs() {
  await prisma.job.deleteMany({});
}

/**
 * Removes FileObject rows that nothing references any more.
 *
 * Deleting an application cascades to its drawings and versions, but NOT to
 * `file_objects` — files deliberately outlive the applications that produced
 * them, because an approval order and its supporting documents are municipal
 * records (docs/07-subsystems.md P.6). The retention job that would sweep
 * genuine orphans is Phase 11 work and does not exist yet, so a test run would
 * otherwise leave its uploads behind for ever.
 */
export async function clearOrphanFiles() {
  const { count } = await prisma.fileObject.deleteMany({
    where: {
      drawingVersions: { none: {} },
      documentVersions: { none: {} },
    },
  });
  return count;
}

/** Wipes the test storage directory. */
export async function clearStorage() {
  const { rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  await rm(resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? './.storage-test'), {
    recursive: true,
    force: true,
  });
}

/**
 * Puts the mock scrutiny engine into a deterministic, synchronous mode.
 *
 * Zero latency makes `submit()` return a terminal result, so a test does not
 * have to sleep through simulated engine time. The asynchronous path is
 * covered separately by the polling test, which sets a real delay.
 */
export async function configureMockScrutiny(
  overrides: Partial<{ mode: string; passFromVersion: number; delayMs: number; errorRate: number }> = {}
) {
  const { invalidateSettingsCache } = await import('@/server/services/settings');

  const values: Array<[string, string]> = [
    ['mock_scrutiny_mode', overrides.mode ?? 'VERSION_LADDER'],
    ['mock_scrutiny_pass_from_version', String(overrides.passFromVersion ?? 3)],
    ['mock_scrutiny_delay_ms', String(overrides.delayMs ?? 0)],
    ['mock_scrutiny_error_rate', String(overrides.errorRate ?? 0)],
  ];

  for (const [key, value] of values) {
    await prisma.systemSetting.update({ where: { key }, data: { value } });
  }

  invalidateSettingsCache();
}

/**
 * Puts the mock payment gateway into a deterministic mode.
 *
 * MANUAL — the default — makes `verify()` answer PENDING and wait for somebody
 * to press a button on the demo gateway page, which is right for a
 * demonstration and useless in a test. The AUTO_* modes answer immediately, so
 * a suite drives every outcome with no browser and no sleeping, down the same
 * settlement path the real gateway uses.
 *
 * `amountDelta` is what exercises the amount-mismatch refusal: a non-zero
 * value makes the gateway claim a different figure from the demand, and the
 * settlement must then credit nothing at all.
 */
export async function configureMockGateway(
  overrides: Partial<{ mode: string; delayMs: number; amountDelta: number }> = {}
) {
  const { invalidateSettingsCache } = await import('@/server/services/settings');

  const values: Array<[string, string]> = [
    ['mock_payment_mode', overrides.mode ?? 'MANUAL'],
    ['mock_payment_delay_ms', String(overrides.delayMs ?? 0)],
    ['mock_payment_amount_delta', String(overrides.amountDelta ?? 0)],
  ];

  for (const [key, value] of values) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value, type: key === 'mock_payment_mode' ? 'STRING' : 'NUMBER', group: 'payments', label: key, description: 'Set by the test suite.' },
    });
  }

  invalidateSettingsCache();
}

/** Overrides a payment-window setting for one test, then restores it. */
export async function setPaymentSetting(key: string, value: string) {
  const { invalidateSettingsCache } = await import('@/server/services/settings');
  await prisma.systemSetting.update({ where: { key }, data: { value } });
  invalidateSettingsCache();
}
