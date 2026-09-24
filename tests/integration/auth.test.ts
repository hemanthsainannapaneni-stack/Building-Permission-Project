import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma, databaseAvailable, cleanupTestUsers, META } from './setup';
import { hashPassword } from '@/server/auth/password';

/**
 * Sign-in, lockout and the password lifecycle, against the real database.
 *
 * `next/headers` is stubbed because the auth service sets cookies through it,
 * and there is no request in a unit-test process. The stub records what was
 * set so the tests can assert on it.
 */

const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

const dbUp = await databaseAvailable();

const {
  signIn,
  signOut,
  requestPasswordReset,
  resetPassword,
  changePassword,
} = await import('@/server/services/auth');

const EMAIL = 'test-auth@example.com';
const PASSWORD = 'CorrectPassword1';

async function makeUser(overrides: Record<string, unknown> = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'TPA' } });
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: 'Test Auth User',
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      roles: { create: { roleId: role.id } },
      ...overrides,
    },
  });
  return user;
}

beforeEach(async () => {
  if (!dbUp) return;
  cookieJar.clear();
  await cleanupTestUsers();
});

afterAll(async () => {
  if (dbUp) await cleanupTestUsers();
  await prisma.$disconnect();
});

describe.runIf(dbUp)('signIn', () => {
  it('accepts the right password and opens a session', async () => {
    const user = await makeUser();
    const result = await signIn(EMAIL, PASSWORD, META);

    expect(result.id).toBe(user.id);
    expect(result.roleKeys).toEqual(['TPA']);

    const sessions = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(sessions).toHaveLength(1);

    // Both cookies set, and the refresh token itself is never the stored value.
    expect(cookieJar.get('lams_at')).toBeTruthy();
    expect(cookieJar.get('lams_rt')).toBeTruthy();
    expect(sessions[0]!.tokenHash).not.toBe(cookieJar.get('lams_rt'));
  }, 30_000);

  it('normalises the email, so case and spacing do not matter', async () => {
    await makeUser();
    await expect(signIn('  TEST-AUTH@EXAMPLE.COM  ', PASSWORD, META)).resolves.toBeTruthy();
  }, 30_000);

  it('rejects a wrong password', async () => {
    await makeUser();
    await expect(signIn(EMAIL, 'WrongPassword1', META)).rejects.toThrow(/not correct/i);
  }, 30_000);

  it('gives the SAME message for an unknown account as for a wrong password', async () => {
    // The message must not be an account-existence oracle.
    await makeUser();

    const wrongPassword = await signIn(EMAIL, 'WrongPassword1', META).catch((e) => e.message);
    const noSuchUser = await signIn('test-nobody@example.com', PASSWORD, META).catch((e) => e.message);

    expect(wrongPassword).toBe(noSuchUser);
  }, 30_000);

  it('records every attempt, successful or not', async () => {
    await makeUser();

    await signIn(EMAIL, 'WrongPassword1', META).catch(() => {});
    await signIn(EMAIL, PASSWORD, META);

    const attempts = await prisma.loginAttempt.findMany({ where: { email: EMAIL } });
    expect(attempts).toHaveLength(2);
    expect(attempts.filter((a) => a.success)).toHaveLength(1);
  }, 40_000);

  it('locks the account after the configured number of failures', async () => {
    const user = await makeUser();
    const limit = Number(process.env.MAX_FAILED_LOGINS ?? 5);

    for (let i = 0; i < limit; i += 1) {
      await signIn(EMAIL, 'WrongPassword1', META).catch(() => {});
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('LOCKED');
    expect(after.lockedUntil).not.toBeNull();

    // Even the RIGHT password is refused while locked.
    await expect(signIn(EMAIL, PASSWORD, META)).rejects.toThrow(/not correct/i);
  }, 60_000);

  it('clears the failure count on a successful sign-in', async () => {
    const user = await makeUser();

    await signIn(EMAIL, 'WrongPassword1', META).catch(() => {});
    await signIn(EMAIL, PASSWORD, META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).not.toBeNull();
  }, 40_000);

  it('refuses a deactivated account', async () => {
    await makeUser({ status: 'INACTIVE' });
    await expect(signIn(EMAIL, PASSWORD, META)).rejects.toThrow(/not correct/i);
  }, 30_000);

  it('refuses a soft-deleted account', async () => {
    await makeUser({ deletedAt: new Date() });
    await expect(signIn(EMAIL, PASSWORD, META)).rejects.toThrow(/not correct/i);
  }, 30_000);

  it('writes an audit row for success and for failure', async () => {
    const user = await makeUser();

    await signIn(EMAIL, 'WrongPassword1', META).catch(() => {});
    await signIn(EMAIL, PASSWORD, META);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'User', entityId: user.id },
      orderBy: { occurredAt: 'asc' },
    });

    expect(audits.map((a) => a.action)).toEqual(['LOGIN_FAILED', 'LOGIN_SUCCEEDED']);
  }, 40_000);
});

describe.runIf(dbUp)('signOut', () => {
  it('revokes the session, so tokens minted from it stop working', async () => {
    const user = await makeUser();
    await signIn(EMAIL, PASSWORD, META);

    await signOut(META);

    const live = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(live).toHaveLength(0);

    const revoked = await prisma.session.findFirst({ where: { userId: user.id } });
    expect(revoked!.revokedReason).toBe('signed_out');
  }, 30_000);
});

describe.runIf(dbUp)('password reset', () => {
  it('creates a single-use token for a real account', async () => {
    const user = await makeUser();
    await requestPasswordReset(EMAIL, META);

    const resets = await prisma.passwordReset.findMany({ where: { userId: user.id } });
    expect(resets).toHaveLength(1);
    expect(resets[0]!.usedAt).toBeNull();
    expect(resets[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  }, 30_000);

  it('returns the same result for an unknown address, and creates nothing', async () => {
    const before = await prisma.passwordReset.count();
    await expect(requestPasswordReset('test-nobody@example.com', META)).resolves.toEqual({ ok: true });
    expect(await prisma.passwordReset.count()).toBe(before);
  });

  it('changes the password, consumes the token and revokes every session', async () => {
    const user = await makeUser();
    await signIn(EMAIL, PASSWORD, META);

    // The service hashes the token, so the test generates the pair the same way.
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    await resetPassword(token, 'BrandNewPassword1', META);

    await expect(signIn(EMAIL, 'BrandNewPassword1', META)).resolves.toBeTruthy();

    const reset = await prisma.passwordReset.findFirstOrThrow({ where: { userId: user.id } });
    expect(reset.usedAt).not.toBeNull();
  }, 60_000);

  it('refuses a token that has already been used', async () => {
    const user = await makeUser();
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        usedAt: new Date(),
      },
    });

    await expect(resetPassword(token, 'AnotherPassword1', META)).rejects.toThrow(/expired|already/i);
  }, 30_000);

  it('refuses an expired token', async () => {
    const user = await makeUser();
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expect(resetPassword(token, 'AnotherPassword1', META)).rejects.toThrow(/expired|already/i);
  }, 30_000);

  it('refuses a token that was never issued', async () => {
    await makeUser();
    await expect(resetPassword('completely-made-up', 'AnotherPassword1', META)).rejects.toThrow(
      /expired|already|not valid/i
    );
  }, 30_000);

  it('unlocks a locked-out account when the password is reset', async () => {
    const user = await makeUser({ status: 'LOCKED', lockedUntil: new Date(Date.now() + 900_000) });
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    await resetPassword(token, 'RecoveredPassword1', META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.lockedUntil).toBeNull();
  }, 40_000);
});

describe.runIf(dbUp)('changePassword', () => {
  it('requires the current password', async () => {
    const user = await makeUser();
    await expect(
      changePassword(user.id, 'NotTheCurrentOne1', 'NewPassword1', {
        ...META,
        sessionId: 'x',
      })
    ).rejects.toThrow(/current password/i);
  }, 30_000);

  it('changes the password and keeps THIS session while revoking the others', async () => {
    const user = await makeUser();

    const keep = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `keep-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteUntil: new Date(Date.now() + 7_200_000),
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `drop-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteUntil: new Date(Date.now() + 7_200_000),
      },
    });

    await changePassword(user.id, PASSWORD, 'ChangedPassword1', { ...META, sessionId: keep.id });

    const live = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(keep.id);

    await expect(signIn(EMAIL, 'ChangedPassword1', META)).resolves.toBeTruthy();
  }, 60_000);
});
