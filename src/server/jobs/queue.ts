import 'server-only';
import { prisma, type Db } from '@/server/db/prisma';

/**
 * A job queue in Postgres, driven by `FOR UPDATE SKIP LOCKED`.
 *
 * Postgres is already here, it is transactional with the business write, and
 * at this volume it needs no Redis. The interface is narrow enough that
 * swapping in pg-boss or BullMQ later would not touch a call site.
 */

export const JOB_TYPES = {
  DISPATCH_OUTBOX: 'DISPATCH_OUTBOX',
  RUN_SCRUTINY: 'RUN_SCRUTINY',
  POLL_SCRUTINY: 'POLL_SCRUTINY',
  SCAN_FILE: 'SCAN_FILE',
  RECONCILE_PAYMENTS: 'RECONCILE_PAYMENTS',
  SWEEP_SLA: 'SWEEP_SLA',
  RENDER_APPROVAL_ORDER: 'RENDER_APPROVAL_ORDER',
  RENDER_RECEIPT: 'RENDER_RECEIPT',
  RENDER_SCRUTINY_REPORT: 'RENDER_SCRUTINY_REPORT',
  VERIFY_AUDIT_CHAIN: 'VERIFY_AUDIT_CHAIN',
  RECOUNT_SHORTFALLS: 'RECOUNT_SHORTFALLS',
  EXPIRE_DEVELOPER_REGISTRATIONS: 'EXPIRE_DEVELOPER_REGISTRATIONS',
  EXPIRE_PROFESSIONAL_REGISTRATIONS: 'EXPIRE_PROFESSIONAL_REGISTRATIONS',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export type EnqueueInput = {
  type: JobType;
  payload?: Record<string, unknown>;
  /** Delay before the job becomes eligible to run. */
  delayMs?: number;
  maxAttempts?: number;
  /**
   * Natural key making the enqueue idempotent. A second enqueue with the same
   * key is a no-op — which is what stops a double-clicked button from running
   * the same job twice.
   */
  dedupeKey?: string;
};

/**
 * Takes a Db so a job can be enqueued inside the transaction that justifies
 * it. A job scheduled for work that then rolls back is a job that will fail.
 */
export async function enqueue(db: Db, input: EnqueueInput) {
  const runAt = new Date(Date.now() + (input.delayMs ?? 0));

  const data = {
    type: input.type,
    payload: (input.payload ?? {}) as never,
    runAt,
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
  };

  if (!input.dedupeKey) return db.job.create({ data });

  // Idempotent enqueue: if the key is taken, leave the existing job alone.
  return db.job.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: data,
    update: {},
  });
}

/**
 * Claims one job atomically. Two workers polling simultaneously cannot claim
 * the same row: SKIP LOCKED makes the second one see the next job instead.
 */
export async function claimNext(workerId: string): Promise<ClaimedJob | null> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        status: 'PENDING',
        runAt: { lte: new Date() },
      },
      orderBy: { runAt: 'asc' },
    });

    if (!job) return null;

    const updated = await tx.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
      select: {
        id: true,
        type: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    return updated as unknown as ClaimedJob;
  });
}

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export async function markSucceeded(id: string) {
  await prisma.job.update({
    where: { id },
    data: { status: 'SUCCEEDED', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: '' },
  });
}

/**
 * Retries with exponential backoff, then dead-letters.
 *
 * A DEAD job is not silently forgotten — it stays visible in the admin job
 * monitor with its last error, because a job that failed five times is
 * something a human needs to see.
 */
export async function markFailed(job: ClaimedJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  const backoffMs = Math.min(2 ** job.attempts * 1000, 15 * 60 * 1000);

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: exhausted ? 'DEAD' : 'PENDING',
      runAt: exhausted ? undefined : new Date(Date.now() + backoffMs),
      lockedAt: null,
      lockedBy: null,
      lastError: message.slice(0, 1000),
    },
  });
}

/**
 * Releases jobs whose worker died mid-run. Without this a crashed worker
 * leaves rows stuck in RUNNING forever.
 */
export async function releaseStale(olderThanMs = 10 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null },
  });
  return result.count;
}
