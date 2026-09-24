import { describe, it, expect, afterAll } from 'vitest';
import { prisma, databaseAvailable } from './setup';
import { RBAC_MATRIX, ROLE_META } from '@/lib/rbac-matrix';
import { CAPABILITIES, ROLES, type RoleKey } from '@/lib/constants';

/**
 * The database must match the matrix.
 *
 * docs/04-rbac.md H.4 is only meaningful if the grants actually in Postgres
 * are the grants the matrix declares. This is the test that stops the document
 * from becoming a description of a system nobody built.
 */

// Resolved once at module load: suites skip rather than fail when no database
// is reachable, so `npm run test` still works on a machine without Docker.
const dbUp = await databaseAvailable();

afterAll(async () => {
  await prisma.$disconnect();
});

const allRoles = Object.values(ROLES) as RoleKey[];

describe.runIf(dbUp)('seeded RBAC', () => {
  it('has every role', async () => {
    const roles = await prisma.role.findMany({ select: { key: true } });
    expect(roles.map((r) => r.key).sort()).toEqual([...allRoles].sort());
  });

  it('has every capability', async () => {
    const permissions = await prisma.permission.findMany({ select: { key: true } });
    const expected = Object.values(CAPABILITIES).sort();
    expect(permissions.map((p) => p.key).sort()).toEqual(expected);
  });

  it.each(allRoles)('grants %s exactly what the matrix declares', async (roleKey) => {
    const role = await prisma.role.findUnique({
      where: { key: roleKey },
      include: { permissions: { include: { permission: true } } },
    });

    expect(role).not.toBeNull();

    const inDatabase = role!.permissions.map((p) => p.permission.key).sort();
    const inMatrix = [...RBAC_MATRIX[roleKey]].sort();

    expect(inDatabase).toEqual(inMatrix);
  });

  it('stores the role metadata', async () => {
    for (const roleKey of allRoles) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
      expect(role.name).toBe(ROLE_META[roleKey].name);
      expect(role.isSystem).toBe(true);
    }
  });

  it('has no orphaned grant pointing at a deleted permission', async () => {
    const orphans = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM role_permissions rp
      LEFT JOIN permissions p ON p.id = rp."permissionId"
      WHERE p.id IS NULL;
    `;
    expect(Number(orphans[0]?.count ?? 0)).toBe(0);
  });

  it('grants APPLICATION_APPROVE to the apex desks only', async () => {
    // Was "exactly one role", which encoded BP_STANDARD's chain. The BBAS
    // realignment made the ZJD the apex desk of the workflow every application
    // type now runs, so deciding is confined to those two and to nothing else.
    const grants = await prisma.rolePermission.findMany({
      where: { permission: { key: CAPABILITIES.APPLICATION_APPROVE } },
      include: { role: true },
    });

    expect(grants.map((g) => g.role.key).sort()).toEqual([ROLES.COMMISSIONER, ROLES.ZJD].sort());
  });

  it('has no SCRUTINY_OVERRIDE permission row at all', async () => {
    const row = await prisma.permission.findFirst({ where: { key: 'SCRUTINY_OVERRIDE' } });
    expect(row).toBeNull();
  });
});

describe.runIf(dbUp)('seeded demo accounts', () => {
  const demoEmails = [
    'ltp.demo@example.com',
    'tpa.demo@example.com',
    'zad.demo@example.com',
    'zdd.demo@example.com',
    'zjd.demo@example.com',
    'director.demo@example.com',
    'addlcommissioner.demo@example.com',
    'commissioner.demo@example.com',
    'finance.demo@example.com',
    'admin.demo@example.com',
    'viewer.demo@example.com',
  ];

  /**
   * The demo accounts, and the one that is deliberately not like the others.
   *
   * `admin.demo@example.com` is seeded with EVERY role, so that a
   * demonstration can be given from a single login without switching desk. It
   * is the only account in the set that carries more than one, and the
   * assertion names it rather than relaxing the rule for everybody — an
   * account that quietly grew a second role is exactly what this test is for.
   *
   * Worth being clear about what that grant costs: it hands the demo
   * administrator COMMISSIONER, and with it the power to approve. The RBAC
   * MATRIX keeps SYSTEM_ADMIN and approval apart (see the separation-of-duties
   * tests), and this account is an exception created in the seed for
   * demonstration convenience. It should not exist in an environment where the
   * audit trail has to mean something.
   */
  const MULTI_ROLE_DEMO_ACCOUNTS = new Set(['admin.demo@example.com']);

  it('has all eleven, active, each with exactly one role', async () => {
    for (const email of demoEmails) {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { roles: true },
      });

      expect(user, `${email} was not seeded`).not.toBeNull();
      expect(user!.status).toBe('ACTIVE');
      expect(user!.deletedAt).toBeNull();

      if (MULTI_ROLE_DEMO_ACCOUNTS.has(email)) {
        expect(user!.roles.length, `${email} should hold every role`).toBeGreaterThan(1);
      } else {
        expect(user!.roles, `${email} has more than the one role it should`).toHaveLength(1);
      }
    }
  });

  it('never stores a demo password in readable form', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: demoEmails } },
      select: { passwordHash: true },
    });

    for (const user of users) {
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain('Demo@12345');
    }
  });

  /**
   * THE CHECK THAT WAS MISSING.
   *
   * A workflow transition names a capability; a stage names the roles that own
   * it. If no role that owns the stage holds the capability, the transition is
   * configured and unreachable — the file arrives and nobody on earth can act
   * on it. That is not a hypothetical: the BBAS realignment made ZJD_REVIEW
   * the only desk with an APPROVE transition while APPLICATION_APPROVE stayed
   * with the Commissioner, and every application filed afterwards was
   * unapprovable until this was found.
   *
   * Checked against the seeded database rather than the matrix alone, because
   * the defect lives in the DISAGREEMENT between two things that are each
   * internally consistent.
   */
  it('leaves no transition that its own desk cannot perform', async () => {
    const transitions = await prisma.workflowTransition.findMany({
      where: { isActive: true, workflow: { applicationTypes: { some: {} } } },
      select: {
        action: { select: { code: true, capabilityKey: true } },
        fromStage: { select: { code: true, ownerRoleKeys: true, workflow: { select: { code: true } } } },
      },
    });

    expect(transitions.length).toBeGreaterThan(0);

    // Capabilities as the DATABASE holds them, not as the matrix declares
    // them: the seed is what the running system authorises against.
    const roles = await prisma.role.findMany({
      select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    const held = new Map(
      roles.map((r) => [r.key, new Set(r.permissions.map((p) => p.permission.key))])
    );

    const unreachable: string[] = [];

    for (const t of transitions) {
      const capability = t.action.capabilityKey;
      // An action with no capability is available to anyone who owns the desk.
      if (!capability) continue;

      const owners = Array.isArray(t.fromStage.ownerRoleKeys)
        ? (t.fromStage.ownerRoleKeys as string[])
        : [];
      // A stage owned by nobody is a system or terminal stage; the engine
      // never asks a person to act there.
      if (owners.length === 0) continue;

      const anyOwnerCan = owners.some((role) => held.get(role)?.has(capability));
      if (!anyOwnerCan) {
        unreachable.push(
          `${t.fromStage.workflow.code}/${t.fromStage.code} · ${t.action.code} needs ${capability}, ` +
            `owned by ${owners.join('/')}`
        );
      }
    }

    expect(unreachable, unreachable.join('\n')).toEqual([]);
  });

  it('puts an approving desk in every workflow an application type uses', async () => {
    // A chain with no APPROVE transition is a chain nothing can ever leave.
    const types = await prisma.applicationType.findMany({
      select: { code: true, workflowId: true, workflow: { select: { code: true } } },
    });

    for (const type of types) {
      if (!type.workflowId) continue;

      const approvals = await prisma.workflowTransition.count({
        where: { isActive: true, workflowId: type.workflowId, action: { code: 'APPROVE' } },
      });

      expect(approvals, `${type.code} runs ${type.workflow?.code} which cannot approve`).toBeGreaterThan(0);
    }
  });

  it('scopes zonal officers to zones and leaves city-wide roles unscoped', async () => {
    const tpa = await prisma.user.findUniqueOrThrow({
      where: { email: 'tpa.demo@example.com' },
      include: { jurisdictions: true },
    });
    expect(tpa.jurisdictions.length).toBeGreaterThan(0);
    expect(tpa.primaryZoneId).not.toBeNull();

    const commissioner = await prisma.user.findUniqueOrThrow({
      where: { email: 'commissioner.demo@example.com' },
      include: { jurisdictions: true },
    });
    expect(commissioner.jurisdictions).toHaveLength(0);
  });
});
