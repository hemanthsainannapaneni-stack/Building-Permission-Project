import 'server-only';
import { cache } from 'react';
import { prisma } from '@/server/db/prisma';
import { forbidden, unauthorized } from '@/server/http/errors';
import { CITYWIDE_ROLES, ROLES, type Capability, type RoleKey } from '@/lib/constants';
import { readAccessClaims } from './session';

/**
 * Resolving the signed-in user, and layer 1 of the three-layer authorization
 * model (docs/04-rbac.md H.1):
 *
 *   1. CAPABILITY       — does the role hold it?           ← this file
 *   2. ROW SCOPE        — may they see this row?           ← scope.ts
 *   3. STAGE OWNERSHIP  — may they act on it right now?    ← workflow engine
 *
 * A capability grants the *ability*; the workflow grants the *occasion*. Both
 * are required.
 */

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  /** Every role held. Most users have one; the model permits several. */
  roleKeys: RoleKey[];
  /** Union of the capabilities of every role held. */
  capabilities: string[];
  /** Zones this user may act in. Empty for city-wide and LTP roles. */
  zoneIds: string[];
  officeId: string | null;
  sessionId: string;
  roleNames: string[];
};

/**
 * The JWT is trusted for identity only. Role, capabilities and account status
 * are re-read from the database on every request, so suspending an account or
 * changing its role takes effect on the next request rather than whenever the
 * token happens to expire.
 *
 * Wrapped with React.cache() so that the portal layout and the page both
 * calling requirePageUser() resolve the same promise, not two. This removes
 * 4-5 redundant database queries on every page navigation.
 */
export const getAuthUser = cache(async function getAuthUser(): Promise<AuthUser | null> {
  const claims = await readAccessClaims();
  if (!claims) return null;

  const [user, session] = await Promise.all([
    prisma.user.findUnique({
      where: { id: claims.sub },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        jurisdictions: { select: { zoneId: true } },
      },
    }),
    prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true, absoluteUntil: true, userId: true },
    }),
  ]);

  if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

  // A revoked or expired session invalidates any token minted from it.
  const now = new Date();
  if (!session || session.userId !== user.id) return null;
  if (session.revokedAt || session.expiresAt < now || session.absoluteUntil < now) return null;

  const roleKeys = user.roles.map((r) => r.role.key as RoleKey);

  const capabilities = [
    ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
  ];

  const zoneIds = [
    ...new Set([
      ...(user.primaryZoneId ? [user.primaryZoneId] : []),
      ...user.jurisdictions.map((j) => j.zoneId),
    ]),
  ];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys,
    roleNames: user.roles.map((r) => r.role.name),
    capabilities,
    zoneIds,
    officeId: user.officeId,
    sessionId: claims.sid,
  };
});

/** As getAuthUser, but throws the 401 the route wrapper turns into JSON. */
export async function requireAuthUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) throw unauthorized();
  return user;
}

// ── Role helpers ─────────────────────────────────────────────────────────

export const hasRole = (user: AuthUser, ...roles: RoleKey[]) =>
  roles.some((r) => user.roleKeys.includes(r));

export const isSystemAdmin = (user: AuthUser) => hasRole(user, ROLES.SYSTEM_ADMIN);
export const isLtp = (user: AuthUser) => hasRole(user, ROLES.LTP);
export const isReadOnly = (user: AuthUser) => hasRole(user, ROLES.VIEWER) && user.roleKeys.length === 1;
export const isCitywide = (user: AuthUser) => user.roleKeys.some((r) => CITYWIDE_ROLES.includes(r));

// ── Capability checks ────────────────────────────────────────────────────

/**
 * True when the user holds ANY of the listed capabilities.
 *
 * Note what this deliberately does NOT do: there is no super-user bypass.
 * SYSTEM_ADMIN holds no approval capability, and this function will not
 * pretend otherwise — the separation is what makes the audit trail mean
 * something (docs/04-rbac.md H.4).
 */
export function can(user: AuthUser, ...capabilities: (Capability | string)[]): boolean {
  return capabilities.some((c) => user.capabilities.includes(c));
}

export function requireCapability(user: AuthUser, ...capabilities: (Capability | string)[]): void {
  if (!can(user, ...capabilities)) {
    throw forbidden(`Your role does not permit this action.`);
  }
}
