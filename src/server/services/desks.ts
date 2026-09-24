import 'server-only';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { ROLES, type RoleKey } from '@/lib/constants';

/**
 * THE DESKS A DEMONSTRATION CAN BE GIVEN FROM.
 *
 * The Switch Desk control used to carry a hard-coded array of six people in a
 * client component — their names, their emails, their descriptions and the
 * demo password, all as string literals in the bundle. Adding the Planning
 * Officer would have meant editing a React file, and the list had already
 * drifted: it offered a Commissioner and no ZDD, which is the wrong way round
 * for the workflow the product now runs.
 *
 * So the list is read from the database, from the accounts the seed actually
 * created, in the order the approval chain visits them.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * It is not a way to act as somebody else. Switching signs in AS that account,
 * through the ordinary sign-in route, and the session that results carries
 * exactly the capabilities that account holds and no others. Nothing here
 * grants anything; RBAC is unchanged and unaware of it.
 */

/** The chain a demonstration walks, in order. */
const DESK_ORDER: RoleKey[] = [
  ROLES.LTP,
  ROLES.TPA,
  ROLES.PLANNING_OFFICER,
  ROLES.ZDD,
  ROLES.ZJD,
  ROLES.SYSTEM_ADMIN,
];

/** One line saying what this desk is for, in the demonstration's terms. */
const PURPOSE: Record<string, string> = {
  [ROLES.LTP]: 'File applications, upload drawings, answer shortfalls, pay fees',
  [ROLES.TPA]: 'Technical scrutiny, site inspection, document verification',
  [ROLES.PLANNING_OFFICER]: 'Endorse the TPA recommendation, or return the file',
  [ROLES.ZDD]: 'Senior zonal review, shortfalls and show cause',
  [ROLES.ZJD]: 'Final review and approval — the apex desk',
  [ROLES.SYSTEM_ADMIN]: 'Full oversight, configuration and audit',
};

const GROUP: Record<string, string> = {
  [ROLES.LTP]: 'Applicant',
  [ROLES.TPA]: 'Department',
  [ROLES.PLANNING_OFFICER]: 'Department',
  [ROLES.ZDD]: 'Department',
  [ROLES.ZJD]: 'Department',
  [ROLES.SYSTEM_ADMIN]: 'Administration',
};

export type Desk = {
  email: string;
  name: string;
  roleKey: string;
  /** The role's own display name, from the roles table. */
  roleName: string;
  designation: string;
  purpose: string;
  group: string;
  /** Zones this officer covers. Empty for city-wide and applicant accounts. */
  zones: string[];
};

export type DeskList = {
  desks: Desk[];
  /**
   * The shared demo password, so the control does not carry it as a literal.
   *
   * Only ever populated when DEMO_MODE is on — and when it is off, `desks` is
   * empty too, so there is nothing to sign in to anyway. It is not a secret in
   * that mode: it is printed by the seed and written in the README.
   */
  password: string | null;
};

/**
 * The switchable desks, or nothing at all.
 *
 * Returns an empty list when DEMO_MODE is off, which is what makes this safe
 * to ship: outside a demonstration the control renders nothing and the
 * endpoint hands out no addresses.
 */
export async function listDesks(): Promise<DeskList> {
  if (!env.demoMode) return { desks: [], password: null };

  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      // The seeded demonstration accounts, and only those. A real officer's
      // account is never offered here, whatever mode the system is in.
      email: { endsWith: '.demo@example.com' },
      roles: { some: { role: { key: { in: DESK_ORDER } } } },
    },
    select: {
      email: true,
      name: true,
      designation: true,
      primaryZone: { select: { code: true } },
      jurisdictions: { select: { zone: { select: { code: true } } } },
      roles: { select: { role: { select: { key: true, name: true, rank: true } } } },
    },
  });

  const desks: Desk[] = [];

  for (const roleKey of DESK_ORDER) {
    // The first holder of each desk, by email, so the list is stable between
    // requests. Second holders exist for the shared-inbox demonstration and
    // are reached by signing in, not from here.
    const holder = users
      .filter((u) => u.roles.some((r) => r.role.key === roleKey))
      // An administrator holds every role; it must not be offered as the LTP.
      .filter((u) => roleKey === ROLES.SYSTEM_ADMIN || u.roles.length === 1)
      .sort((a, b) => a.email.localeCompare(b.email))[0];

    if (!holder) continue;

    const role = holder.roles.find((r) => r.role.key === roleKey)?.role;

    desks.push({
      email: holder.email,
      name: holder.name,
      roleKey,
      roleName: role?.name ?? roleKey,
      designation: holder.designation,
      purpose: PURPOSE[roleKey] ?? '',
      group: GROUP[roleKey] ?? 'Department',
      zones: [
        ...new Set(
          [
            holder.primaryZone?.code,
            ...holder.jurisdictions.map((j) => j.zone.code),
          ].filter((c): c is string => Boolean(c))
        ),
      ].sort(),
    });
  }

  return { desks, password: env.demoPassword };
}
