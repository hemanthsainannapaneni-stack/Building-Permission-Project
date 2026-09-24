import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma, databaseAvailable, cleanupTestUsers, actorFor, META } from './setup';
import {
  createUser,
  getUser,
  listUsers,
  setUserStatus,
  updateUser,
  resetUserPassword,
  unlockUser,
} from '@/server/services/users';
import { verifyPassword } from '@/server/auth/password';
import { ROLES } from '@/lib/constants';

/**
 * User CRUD against the real database, including the two rules that stop an
 * organisation locking itself out of its own system.
 */

const dbUp = await databaseAvailable();
let adminActor: ReturnType<typeof actorFor>;

beforeAll(async () => {
  if (!dbUp) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } });
  adminActor = actorFor(admin.id, admin.name);
});

afterEach(async () => {
  if (dbUp) await cleanupTestUsers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const base = {
  name: 'Test Officer',
  phone: '9876543210',
  designation: 'Tester',
  employeeCode: '',
  roleKey: ROLES.TPA,
  zoneIds: [],
  ltpLicenceNo: '',
  ltpLicenceClass: '',
  firmName: '',
};

describe.runIf(dbUp)('createUser', () => {
  it('creates an account with the requested role', async () => {
    const { user } = await createUser(
      { ...base, email: 'test-create@example.com' },
      adminActor,
      META
    );

    expect(user.email).toBe('test-create@example.com');
    expect(user.roleKeys).toEqual([ROLES.TPA]);
    expect(user.status).toBe('ACTIVE');
  });

  it('generates a password when none is given, and forces a change', async () => {
    const { user, generatedPassword } = await createUser(
      { ...base, email: 'test-generated@example.com' },
      adminActor,
      META
    );

    expect(generatedPassword).toBeTruthy();
    expect(generatedPassword!.length).toBeGreaterThanOrEqual(12);
    expect(user.mustChangePassword).toBe(true);

    // The generated password must actually work.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(generatedPassword!, row.passwordHash)).toBe(true);
  }, 20_000);

  it('does not force a change when an explicit password is set', async () => {
    const { user, generatedPassword } = await createUser(
      { ...base, email: 'test-explicit@example.com', password: 'ChosenByAdmin1' },
      adminActor,
      META
    );

    expect(generatedPassword).toBeNull();
    expect(user.mustChangePassword).toBe(false);
  }, 20_000);

  it('never stores the password in readable form', async () => {
    const { user, generatedPassword } = await createUser(
      { ...base, email: 'test-hash@example.com' },
      adminActor,
      META
    );

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(generatedPassword!);
  }, 20_000);

  it('refuses a duplicate email', async () => {
    await createUser({ ...base, email: 'test-dupe@example.com' }, adminActor, META);
    await expect(
      createUser({ ...base, email: 'test-dupe@example.com' }, adminActor, META)
    ).rejects.toThrow(/already exists/i);
  }, 20_000);

  it('writes an audit row', async () => {
    const { user } = await createUser({ ...base, email: 'test-audit@example.com' }, adminActor, META);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'User', entityId: user.id, action: 'USER_CREATED' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(adminActor.id);
  }, 20_000);
});

describe.runIf(dbUp)('updateUser', () => {
  it('changes details and records before/after', async () => {
    const { user } = await createUser({ ...base, email: 'test-update@example.com' }, adminActor, META);

    const updated = await updateUser(user.id, { name: 'Renamed Officer' }, adminActor, META);
    expect(updated.name).toBe('Renamed Officer');

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'User', entityId: user.id, action: 'USER_UPDATED' },
    });
    expect(audit).not.toBeNull();
  }, 20_000);

  it('reassigns the role, replacing rather than adding', async () => {
    const { user } = await createUser({ ...base, email: 'test-role@example.com' }, adminActor, META);

    const updated = await updateUser(user.id, { roleKey: ROLES.ZJD }, adminActor, META);
    expect(updated.roleKeys).toEqual([ROLES.ZJD]);

    const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
    expect(roles).toHaveLength(1);
  }, 20_000);

  it('refuses to let an administrator change their own role', async () => {
    await expect(
      updateUser(adminActor.id, { roleKey: ROLES.VIEWER }, adminActor, META)
    ).rejects.toThrow(/your own role/i);
  });
});

describe.runIf(dbUp)('setUserStatus', () => {
  it('deactivates and revokes every live session', async () => {
    const { user } = await createUser({ ...base, email: 'test-deact@example.com' }, adminActor, META);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `test-hash-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteUntil: new Date(Date.now() + 7_200_000),
      },
    });

    await setUserStatus(user.id, 'INACTIVE', 'Left the department', adminActor, META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('INACTIVE');

    // An account that is "inactive" but still browsing is not deactivated.
    const live = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(live).toHaveLength(0);
  }, 20_000);

  it('clears a lockout when reactivating', async () => {
    const { user } = await createUser({ ...base, email: 'test-react@example.com' }, adminActor, META);

    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'LOCKED', lockedUntil: new Date(Date.now() + 900_000), failedLoginCount: 5 },
    });

    await setUserStatus(user.id, 'ACTIVE', '', adminActor, META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginCount).toBe(0);
  }, 20_000);

  it('refuses to let an administrator deactivate themselves', async () => {
    await expect(
      setUserStatus(adminActor.id, 'INACTIVE', '', adminActor, META)
    ).rejects.toThrow(/your own account/i);
  });

  it('refuses to remove the last active system administrator', async () => {
    // Create a second admin so the demo admin is not the only one, then
    // deactivate it — that must succeed. Deactivating the last one must not.
    const { user: second } = await createUser(
      { ...base, email: 'test-admin2@example.com', roleKey: ROLES.SYSTEM_ADMIN },
      adminActor,
      META
    );

    const other = actorFor(second.id, second.name);
    await expect(setUserStatus(second.id, 'INACTIVE', '', adminActor, META)).resolves.toBeTruthy();

    // With the second one inactive, the demo admin is now the last.
    await expect(setUserStatus(adminActor.id, 'INACTIVE', '', other, META)).rejects.toThrow(
      /only active system administrator|your own account/i
    );
  }, 30_000);
});

describe.runIf(dbUp)('resetUserPassword', () => {
  it('issues a working temporary password and revokes sessions', async () => {
    const { user } = await createUser(
      { ...base, email: 'test-reset@example.com', password: 'OriginalPass1' },
      adminActor,
      META
    );

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `test-reset-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteUntil: new Date(Date.now() + 7_200_000),
      },
    });

    const { temporaryPassword } = await resetUserPassword(user.id, adminActor, META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(await verifyPassword(temporaryPassword, after.passwordHash)).toBe(true);
    expect(await verifyPassword('OriginalPass1', after.passwordHash)).toBe(false);

    const live = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(live).toHaveLength(0);
  }, 30_000);
});

describe.runIf(dbUp)('unlockUser', () => {
  it('clears the lockout and the failure count', async () => {
    const { user } = await createUser({ ...base, email: 'test-unlock@example.com' }, adminActor, META);

    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'LOCKED', lockedUntil: new Date(Date.now() + 900_000), failedLoginCount: 5 },
    });

    await unlockUser(user.id, adminActor, META);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginCount).toBe(0);
    expect(after.status).toBe('ACTIVE');
  }, 20_000);
});

describe.runIf(dbUp)('listUsers and getUser', () => {
  it('paginates and reports a total', async () => {
    const result = await listUsers({ page: 1, pageSize: 5 });
    expect(result.data.length).toBeLessThanOrEqual(5);
    expect(result.total).toBeGreaterThanOrEqual(11);
    expect(result.totalPages).toBeGreaterThanOrEqual(3);
  });

  it('filters by role', async () => {
    const result = await listUsers({ page: 1, pageSize: 50, role: ROLES.COMMISSIONER });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    for (const user of result.data) {
      expect(user.roleKeys).toContain(ROLES.COMMISSIONER);
    }
  });

  it('searches by name and email', async () => {
    const result = await listUsers({ page: 1, pageSize: 50, q: 'commissioner.demo' });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  it('never returns a password hash', async () => {
    const result = await listUsers({ page: 1, pageSize: 5 });
    for (const user of result.data) {
      expect(user).not.toHaveProperty('passwordHash');
    }

    const one = await prisma.user.findFirstOrThrow({ where: { deletedAt: null } });
    const detail = await getUser(one.id);
    expect(detail).not.toHaveProperty('passwordHash');
  });

  it('throws a not-found for an unknown id', async () => {
    await expect(getUser('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/could not be found/i);
  });
});
