import type { PrismaClient } from '@prisma/client';
import { CAPABILITIES, ROLES, type Capability, type RoleKey } from '../../src/lib/constants';
import { RBAC_MATRIX, ROLE_META } from '../../src/lib/rbac-matrix';

/**
 * Permissions, roles and the grant matrix.
 *
 * Idempotent: re-running upserts rather than duplicating, and re-syncs the
 * grants to match the matrix exactly — so a capability removed from the matrix
 * is revoked in the database, not merely left behind. That matters: a stale
 * grant is a permission nobody intended and nobody can see.
 */

const MODULE_OF: Record<string, string> = {
  APPLICATION: 'applications',
  DRAWING: 'drawings',
  SCRUTINY: 'scrutiny',
  DOCUMENT: 'documents',
  FEE: 'fees',
  PAYMENT: 'payments',
  WORKFLOW: 'workflow',
  CHECKLIST: 'applications',
  SITE: 'inspections',
  NOC: 'nocs',
  SHORTFALL: 'shortfalls',
  SHOW: 'proceedings',
  REVOCATION: 'proceedings',
  OUTWARD: 'outward',
  LTP_CHANGE: 'ltp-change',
  COMMENCEMENT: 'post-approval',
  OCCUPANCY: 'post-approval',
  DEVELOPER: 'developers',
  LTP_REG: 'ltp',
  ORDER: 'approvals',
  USER: 'administration',
  ROLE: 'administration',
  ORG: 'administration',
  MASTER: 'administration',
  SETTINGS: 'administration',
  NOTIFICATION: 'administration',
  INTEGRATION: 'administration',
  AUDIT: 'oversight',
  REPORT: 'oversight',
  ANALYTICS: 'oversight',
};

function moduleFor(key: string): string {
  // Two-word prefixes first: LTP_REG_* is not LTP_CHANGE_*.
  const two = key.split('_').slice(0, 2).join('_');
  if (MODULE_OF[two]) return MODULE_OF[two];
  const prefix = key.split('_')[0] ?? '';
  return MODULE_OF[prefix] ?? 'general';
}

/** "APPLICATION_VIEW_ALL" → "View all applications"-ish, without a lookup table. */
function humanise(key: string): string {
  const words = key.toLowerCase().split('_');
  const first = words[0] ?? '';
  return (first.charAt(0).toUpperCase() + first.slice(1) + ' ' + words.slice(1).join(' ')).trim();
}

export async function seedRbac(prisma: PrismaClient) {
  // ── Permissions ───────────────────────────────────────────────────────
  const keys = Object.values(CAPABILITIES) as Capability[];

  for (const key of keys) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: moduleFor(key), name: humanise(key) },
      update: { module: moduleFor(key), name: humanise(key) },
    });
  }

  // Remove any permission no longer in the catalogue, so the table cannot
  // accumulate keys nothing grants and nothing checks.
  const orphanPermissions = await prisma.permission.deleteMany({
    where: { key: { notIn: keys } },
  });

  // ── Roles ─────────────────────────────────────────────────────────────
  const roleKeys = Object.values(ROLES) as RoleKey[];

  for (const key of roleKeys) {
    const meta = ROLE_META[key];
    await prisma.role.upsert({
      where: { key },
      create: { key, name: meta.name, description: meta.description, rank: meta.rank, isSystem: true },
      update: { name: meta.name, description: meta.description, rank: meta.rank, isSystem: true },
    });
  }

  // ── Grants ────────────────────────────────────────────────────────────
  const permissionIdByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id])
  );

  let granted = 0;
  let revoked = 0;

  for (const roleKey of roleKeys) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const wanted = RBAC_MATRIX[roleKey];
    const wantedIds = wanted
      .map((c) => permissionIdByKey.get(c))
      .filter((id): id is string => Boolean(id));

    if (wantedIds.length !== wanted.length) {
      const missing = wanted.filter((c) => !permissionIdByKey.has(c));
      throw new Error(`Role ${roleKey} references unknown capabilities: ${missing.join(', ')}`);
    }

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const existingIds = new Set(existing.map((e) => e.permissionId));

    const toAdd = wantedIds.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !wantedIds.includes(id));

    if (toAdd.length) {
      await prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
      granted += toAdd.length;
    }

    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove } },
      });
      revoked += toRemove.length;
    }
  }

  return {
    permissions: keys.length,
    roles: roleKeys.length,
    granted,
    revoked,
    orphansRemoved: orphanPermissions.count,
  };
}
