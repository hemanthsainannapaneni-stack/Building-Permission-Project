import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, databaseAvailable, actorFor, META } from './setup';
import { audit, verifyAuditChain } from '@/server/services/audit';

/**
 * The audit chain, against a real database and under real concurrency.
 *
 * The pure-function properties live in tests/unit/audit-chain.test.ts. What
 * needs a database is the property those tests cannot see: that CONCURRENT
 * appends produce ONE chain.
 *
 * Before appends were serialised, `audit()` read the head row and then
 * inserted, with nothing between the two. Two writers therefore read the same
 * head, both linked to it, and the chain forked. 154 rows in the development
 * database forked that way — including concurrent sign-ins, so it happened on
 * ordinary traffic and not only where a test parallelises on purpose.
 */

const dbUp = await databaseAvailable();

let actor: ReturnType<typeof actorFor>;

beforeAll(async () => {
  if (!dbUp) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } });
  actor = actorFor(admin.id, admin.name, ['SYSTEM_ADMIN']);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Rows that share a predecessor. On an intact chain there are none. */
async function forkCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM (
      SELECT "prevHash" FROM "audit_logs"
      WHERE "prevHash" <> ''
      GROUP BY "prevHash" HAVING count(*) > 1
    ) t`;
  return Number(rows[0]?.count ?? 0);
}

const write = (action: string) =>
  audit(prisma, {
    actor,
    action,
    entityType: 'SmokeTest',
    entityId: `concurrency-${action}`,
    ...META,
  });

describe.runIf(dbUp)('appending under concurrency', () => {
  it('gives twenty simultaneous writers one chain, not twenty branches', async () => {
    const forksBefore = await forkCount();

    await Promise.all(Array.from({ length: 20 }, (_, i) => write(`CONCURRENT_${i}`)));

    // Not "few forks" — none. One new fork is one place where history cannot
    // be shown to be unaltered.
    expect(await forkCount()).toBe(forksBefore);
  }, 60_000);

  it('leaves the chain verifiable afterwards', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => write(`VERIFY_${i}`)));

    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
  }, 60_000);

  it('gives every row a distinct sequence number', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => write(`SEQ_${i}`)));

    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'SmokeTest' },
      select: { seq: true },
      orderBy: { seq: 'desc' },
      take: 10,
    });

    expect(new Set(rows.map((r) => r.seq.toString())).size).toBe(rows.length);
  }, 60_000);

  it('rolls the row back with the transaction that wrote it', async () => {
    const before = await prisma.auditLog.count({ where: { entityId: 'rollback-probe' } });

    await expect(
      prisma.$transaction(async (tx) => {
        await audit(tx, {
          actor,
          action: 'ROLLED_BACK',
          entityType: 'SmokeTest',
          entityId: 'rollback-probe',
          ...META,
        });
        throw new Error('deliberate');
      })
    ).rejects.toThrow('deliberate');

    // An action that succeeded but was not recorded is unreachable; so is a
    // record of an action that never happened.
    expect(await prisma.auditLog.count({ where: { entityId: 'rollback-probe' } })).toBe(before);

    // And the failed append must not have left a gap the chain trips over.
    expect((await verifyAuditChain()).ok).toBe(true);
  }, 60_000);
});
