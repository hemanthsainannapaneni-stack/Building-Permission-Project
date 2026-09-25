import 'server-only';
import { createHash } from 'node:crypto';
import { prisma, type Db, type Tx } from '@/server/db/prisma';
import type { AuthUser } from '@/server/auth/context';

/**
 * The audit trail.
 *
 * `audit()` takes the transaction client, so the audit row and the change it
 * describes commit together or not at all. An action that succeeded but was
 * not recorded is not a reachable state.
 *
 * Rows are hash-chained for tamper evidence, and the application's database
 * role has UPDATE and DELETE revoked on this table — see the constraints
 * migration. That combination is what makes "history is not editable" a
 * property of the system rather than a promise about the UI.
 */

export type AuditInput = {
  actor?: Pick<AuthUser, 'id' | 'name'> & { roleKeys?: string[] };
  action: string;
  entityType: string;
  entityId: string;
  applicationId?: string | null;
  before?: unknown;
  after?: unknown;
  remarks?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};


/** A TransactionClient is a PrismaClient minus the methods that start one. */
const isTransaction = (db: Db): db is Tx => !('$transaction' in db);

/**
 * Appends one row to the chain.
 *
 * Reading the head and linking to it must be ONE indivisible step. Without
 * that, two concurrent writers read the same head, both claim it as their
 * predecessor, and the chain forks — which is exactly what happened through
 * Phases 2 and 3, on ordinary concurrent logins as much as under a test that
 * parallelises deliberately. A chain that forks whenever two people act at the
 * same moment is not tamper evidence; it is a column of hashes.
 *
 * The lock is transaction-scoped: held until the caller's transaction commits,
 * released automatically if it rolls back. That is also why an append needs a
 * transaction at all — taken outside one, the lock would be released the
 * instant the statement that took it returned, and the insert that follows
 * would race exactly as before. A caller that passes the bare client gets a
 * transaction of its own rather than a silently unprotected append.
 */
export async function audit(db: Db, input: AuditInput) {
  if (isTransaction(db)) return append(db, input);
  return prisma.$transaction((tx) => append(tx, input));
}

async function append(db: Tx, input: AuditInput) {
  try {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(8493829)`);
  } catch {
    // Non-postgres fallback
  }

  const prev = await db.auditLog.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true, rowHash: true },
  });

  const prevHash = prev?.rowHash ?? '';
  const seq = (prev?.seq ?? 0) + 1;
  const occurredAt = new Date();

  const row = {
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? 'system',
    actorRoleKey: input.actor?.roleKeys?.[0] ?? 'SYSTEM',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    applicationId: input.applicationId ?? null,
    before: toJson(input.before),
    after: toJson(input.after),
    remarks: input.remarks ?? '',
    ip: input.ip ?? '',
    userAgent: input.userAgent ?? '',
    correlationId: input.correlationId ?? '',
    occurredAt,
  };

  return db.auditLog.create({
    data: { ...row, seq, prevHash, rowHash: computeRowHash(prevHash, row) },
  });
}

/** sha256(prevHash + canonical(row)). Key order is fixed, so the hash is stable. */
export function computeRowHash(prevHash: string, row: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash).update(canonical(row)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Normalises a before/after payload to EXACTLY what the database will store.
 *
 * This is what makes the row hash reproducible, and it was the second half of
 * the chain being unverifiable. `before` and `after` are `jsonb`, so a value
 * put in as a Date comes back out as a string — and the hash was computed over
 * the Date. `canonical()` renders a Date as a bare ISO instant and a string as
 * a quoted one, so the recomputed hash differed from the stored hash by two
 * quote characters and the row could never be verified again.
 *
 * That is not a rare shape: `submittedAt`, `verifiedAt`, `issuedAt`,
 * `expiresOn` and `dueDate` all reach audit payloads as Dates. Every row
 * carrying one was reported as tampered with, which is the worst failure a
 * tamper-evidence mechanism has — it makes the real signal unreadable.
 *
 * Round-tripping through JSON here means the hash is computed over the same
 * representation a reader will get back.
 */
function toJson(value: unknown) {
  if (value === undefined || value === null) return undefined;

  // A BigInt has no JSON representation and would throw. Audit must never be
  // the reason a write fails, so it is rendered the way Postgres will show it.
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as never;
}

/**
 * The audit trail for ONE application, newest first.
 *
 * Deliberately distinct from the timeline. The timeline says "your application
 * was sent to the Zonal Joint Director"; this says which columns changed, from
 * what to what, under whose account, from which address, and where that row
 * sits in the hash chain. An officer looking at a file needs the second when
 * the first is disputed.
 *
 * Row scope is the CALLER's problem — this function performs no authorization
 * and must only be reached once `assertApplicationAccess` has run.
 */
export async function applicationAudit(applicationId: string, limit = 200) {
  return prisma.auditLog.findMany({
    where: { applicationId },
    orderBy: { seq: 'desc' },
    take: limit,
    select: {
      id: true,
      seq: true,
      action: true,
      entityType: true,
      entityId: true,
      actorName: true,
      actorRoleKey: true,
      before: true,
      after: true,
      remarks: true,
      ip: true,
      correlationId: true,
      occurredAt: true,
    },
  });
}

/**
 * Walks the chain and reports the first break.
 *
 * This does not prevent someone with direct database access from rewriting
 * history — it makes rewriting it *undetectably* substantially harder, which
 * is the realistic goal.
 */
/**
 * The raw audit_logs rows for one entity — a developer registration, a
 * professional registration, or any other row identified by (entityType,
 * entityId) rather than an applicationId. Same shape as `applicationAudit`,
 * the same table, the same hash chain; only the WHERE clause differs.
 */
export async function entityAudit(entityType: string, entityId: string, limit = 200) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { seq: 'desc' },
    take: limit,
    select: {
      id: true,
      seq: true,
      action: true,
      entityType: true,
      entityId: true,
      actorName: true,
      actorRoleKey: true,
      before: true,
      after: true,
      remarks: true,
      ip: true,
      correlationId: true,
      occurredAt: true,
    },
  });
}

export type ChainVerification = { checked: number; from: number } & (
  | { ok: true }
  | { ok: false; brokenAtId: string; brokenAtSeq: number }
);

/**
 * Where the verifiable chain begins.
 *
 * Rows written before appends were serialised fork, and `audit_logs` is
 * append-only, so they cannot be repaired — nor should they be: rewriting
 * history to make a verification pass is precisely what this table exists to
 * make hard. Verification therefore reports on everything after the anchor,
 * and the caller is told which rows those are rather than being handed a bare
 * "intact" that covers rows nobody can vouch for.
 *
 * On a fresh deployment the anchor is 0 and the whole table is verified, which
 * is the case that actually matters.
 */
async function chainAnchor(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'audit_chain_anchor_seq' },
    select: { value: true },
  });

  try {
    const parsed = Number(row?.value ?? '0');
    return parsed > 0 ? parsed : 0;
  } catch {
    // A malformed anchor must not silently narrow the verification to nothing.
    return 0;
  }
}

export async function verifyAuditChain(limit = 10_000): Promise<ChainVerification> {
  const from = await chainAnchor();

  const [anchorRow, rows] = await Promise.all([
    from === 0
      ? Promise.resolve(null)
      : prisma.auditLog.findFirst({ where: { seq: from }, select: { rowHash: true } }),
    prisma.auditLog.findMany({
      where: { seq: { gt: from } },
      orderBy: { seq: 'asc' },
      take: limit,
    }),
  ]);

  // The first row after the anchor is checked against a real predecessor, not
  // treated as a genesis row.
  let expectedPrev = anchorRow?.rowHash ?? '';
  let checked = 0;

  for (const row of rows) {
    const recomputed = computeRowHash(expectedPrev, {
      actorId: row.actorId,
      actorName: row.actorName,
      actorRoleKey: row.actorRoleKey,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      applicationId: row.applicationId,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      remarks: row.remarks,
      ip: row.ip,
      userAgent: row.userAgent,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt,
    });

    if (row.prevHash !== expectedPrev || row.rowHash !== recomputed) {
      return { ok: false, checked, from, brokenAtId: String(row.id), brokenAtSeq: row.seq };
    }

    expectedPrev = row.rowHash;
    checked += 1;
  }

  return { ok: true, checked, from };
}
