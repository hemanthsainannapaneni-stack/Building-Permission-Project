import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { claimNext, enqueue, markFailed, markSucceeded, releaseStale, JOB_TYPES } from './queue';
import { getHandler, registeredTypes } from './handlers';

/**
 * The worker loop.
 *
 * Runs out of process (`npm run worker`) from the same image as the web app,
 * with a different entrypoint. Scrutiny can take minutes, PDF rendering is
 * CPU-heavy and notification dispatch must retry with backoff — none of which
 * is reliable inside a request timeout.
 */

export type WorkerHandle = { stop: () => Promise<void> };

export function startWorker(): WorkerHandle {
  const workerId = env.workerId || `${process.pid}-${randomUUID().slice(0, 8)}`;
  let running = true;
  let active = 0;
  let idleSince = Date.now();

  console.log(`[worker] ${workerId} starting`);
  console.log(`[worker] handlers: ${registeredTypes().join(', ')}`);

  const loop = (async () => {
    // Recover anything a previous worker died holding.
    const released = await releaseStale().catch(() => 0);
    if (released) console.log(`[worker] released ${released} stale job(s)`);

    await scheduleRecurring();

    while (running) {
      if (active >= env.workerConcurrency) {
        await sleep(50);
        continue;
      }

      let job;
      try {
        job = await claimNext(workerId);
      } catch (err) {
        console.error('[worker] could not claim a job', err);
        await sleep(5_000);
        continue;
      }

      if (!job) {
        // Nothing to do. Re-arm the recurring jobs occasionally.
        if (Date.now() - idleSince > 60_000) {
          idleSince = Date.now();
          await scheduleRecurring().catch(() => {});
        }
        await sleep(env.workerPollMs);
        continue;
      }

      idleSince = Date.now();
      active += 1;

      void (async () => {
        const started = Date.now();
        try {
          const handler = getHandler(job.type);
          if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);

          await handler(job);
          await markSucceeded(job.id);
          console.log(`[worker] ${job.type} ok in ${Date.now() - started}ms`);
        } catch (err) {
          console.error(`[worker] ${job.type} failed (attempt ${job.attempts}/${job.maxAttempts})`, err);
          await markFailed(job, err).catch((e) => console.error('[worker] could not record failure', e));
        } finally {
          active -= 1;
        }
      })();
    }

    // Let in-flight handlers finish before the process exits.
    while (active > 0) await sleep(100);
    console.log(`[worker] ${workerId} stopped`);
  })();

  return {
    async stop() {
      running = false;
      await loop;
    },
  };
}

/**
 * Recurring work, kept idempotent by a dedupe key that rolls over on a fixed
 * cadence. Enqueueing the same tick twice is a no-op, so this is safe to call
 * from several workers.
 */
async function scheduleRecurring() {
  const now = Date.now();
  const everyMinute = Math.floor(now / 60_000);
  const every15Minutes = Math.floor(now / (15 * 60_000));
  const daily = new Date().toISOString().slice(0, 10);

  await enqueue(prisma, {
    type: JOB_TYPES.DISPATCH_OUTBOX,
    dedupeKey: `outbox:${everyMinute}`,
  });

  await enqueue(prisma, {
    type: JOB_TYPES.RECOUNT_SHORTFALLS,
    dedupeKey: `recount:${daily}`,
  });

  await enqueue(prisma, {
    type: JOB_TYPES.VERIFY_AUDIT_CHAIN,
    dedupeKey: `auditchain:${daily}`,
  });

  // Validity is counted in days, so a daily sweep is exact. The register also
  // sweeps before it is read, for deployments with no worker.
  await enqueue(prisma, {
    type: JOB_TYPES.EXPIRE_DEVELOPER_REGISTRATIONS,
    dedupeKey: `developer-expiry:${daily}`,
  });
  await enqueue(prisma, {
    type: JOB_TYPES.NOTIFY_DEVELOPER_RENEWALS_DUE,
    dedupeKey: `developer-renewal-due:${daily}`,
  });
  await enqueue(prisma, {
    type: JOB_TYPES.EXPIRE_PROFESSIONAL_REGISTRATIONS,
    dedupeKey: `professional-expiry:${daily}`,
  });

  // Every five minutes rather than fifteen: this sweep is what recovers a
  // payer who closed the browser mid-payment, and the difference between a
  // five-minute and a fifteen-minute wait is the difference between "it caught
  // up" and "I paid and nothing happened, so I rang the office".
  await enqueue(prisma, {
    type: JOB_TYPES.RECONCILE_PAYMENTS,
    dedupeKey: `payments:${Math.floor(now / (5 * 60_000))}`,
  });

  // The SLA sweep. Every fifteen minutes is frequent enough that "due soon"
  // arrives while there is still a day to act on it, and infrequent enough
  // that a queue of five hundred live clocks costs nothing. It notifies once
  // per change of state, so a shorter cadence would not produce more messages
  // — only more queries.
  await enqueue(prisma, {
    type: JOB_TYPES.SWEEP_SLA,
    dedupeKey: `sla:${every15Minutes}`,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
