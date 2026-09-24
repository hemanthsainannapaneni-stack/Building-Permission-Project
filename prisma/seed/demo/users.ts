import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../../src/server/auth/password';
import { ROLES, type RoleKey } from '../../../src/lib/constants';

/**
 * The demo environment's EXTRA accounts.
 *
 * `prisma/seed/03-users.ts` already creates one account per role — enough to
 * walk the lifecycle. These are the second and third holders of the desks that
 * really are staffed by more than one person, and they exist for one reason:
 * a queue with a single officer cannot demonstrate a shared inbox, a claim, a
 * reassignment or an uneven workload, and those are four of the things a
 * reviewer most wants to see working.
 *
 * Zones are deliberately NOT all the same. Zonal routing is scoped by
 * jurisdiction, so giving every officer every zone would make the scoping
 * invisible — and an invisible guarantee is one nobody checks.
 */

export type DemoStaff = {
  email: string;
  name: string;
  role: RoleKey;
  designation: string;
  officeCode: string;
  zoneCodes: string[];
  phone: string;
  employeeCode?: string;
  ltp?: { licenceNo: string; licenceClass: string; firmName: string };
  /** Seeded in a non-ACTIVE state so the user register has something to show. */
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
};

export const DEMO_STAFF: DemoStaff[] = [
  // ── Licensed technical persons ────────────────────────────────────────
  {
    email: 'ltp2.demo@example.com',
    name: 'Sunitha Varma',
    role: ROLES.LTP,
    designation: 'Licensed Technical Person',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000021',
    ltp: { licenceNo: 'LTP/2026/0002', licenceClass: 'Class-I', firmName: 'Skyline Design Studio' },
  },
  {
    email: 'ltp3.demo@example.com',
    name: 'Naveen Chowdary',
    role: ROLES.LTP,
    designation: 'Licensed Technical Person',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000022',
    ltp: { licenceNo: 'LTP/2026/0003', licenceClass: 'Class-II', firmName: 'Aakriti Architects' },
  },
  {
    email: 'ltp4.demo@example.com',
    name: 'Kavitha Murthy',
    role: ROLES.LTP,
    designation: 'Licensed Technical Person',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000023',
    ltp: { licenceNo: 'LTP/2026/0004', licenceClass: 'Class-II', firmName: 'Meridian Planners' },
  },

  // ── A second holder at each shared desk ───────────────────────────────
  {
    email: 'tpa2.demo@example.com',
    name: 'Srinivas Raju',
    role: ROLES.TPA,
    designation: 'Town Planning Assistant',
    officeCode: 'TP-Z3',
    zoneCodes: ['Z3', 'Z4', 'Z5'],
    phone: '9000000024',
    employeeCode: 'TP-0024',
  },
  {
    email: 'zad2.demo@example.com',
    name: 'Padma Sastry',
    role: ROLES.ZAD,
    designation: 'Zonal Assistant Director',
    officeCode: 'TP-Z5',
    zoneCodes: ['Z5'],
    phone: '9000000025',
    employeeCode: 'TP-0025',
  },
  {
    // Covers the zones po.demo does not, so no file can reach the Planning
    // Officer desk and find nobody with jurisdiction over it.
    email: 'po2.demo@example.com',
    name: 'Bhaskar Reddy',
    role: ROLES.PLANNING_OFFICER,
    designation: 'Planning Officer',
    officeCode: 'TP-Z4',
    zoneCodes: ['Z4', 'Z5'],
    phone: '9000000029',
    employeeCode: 'TP-0029',
  },
  {
    // Likewise for the ZDD desk: zdd.demo holds Z3 and Z4, this one the rest.
    email: 'zdd2.demo@example.com',
    name: 'Shalini Prasad',
    role: ROLES.ZDD,
    designation: 'Zonal Deputy Director',
    officeCode: 'TP-Z1',
    zoneCodes: ['Z1', 'Z2', 'Z5'],
    phone: '9000000030',
    employeeCode: 'TP-0030',
  },
  {
    email: 'zjd2.demo@example.com',
    name: 'Harish Pillai',
    role: ROLES.ZJD,
    designation: 'Zonal Joint Director',
    officeCode: 'TP-Z4',
    zoneCodes: ['Z4', 'Z5'],
    phone: '9000000026',
    employeeCode: 'TP-0026',
  },

  // ── Accounts in non-ACTIVE states ─────────────────────────────────────
  //
  // The user register's status filter, the "deactivated" badge and the
  // sign-in refusal all need a row to act on. Seeding them is the only way
  // those paths are visible without an administrator first breaking someone's
  // account by hand.
  {
    email: 'tpa3.demo@example.com',
    name: 'Bhavani Nair',
    role: ROLES.TPA,
    designation: 'Town Planning Assistant (on deputation)',
    officeCode: 'TP-Z2',
    zoneCodes: ['Z2'],
    phone: '9000000027',
    employeeCode: 'TP-0027',
    status: 'INACTIVE',
  },
  {
    email: 'viewer2.demo@example.com',
    name: 'Chandra Mohan',
    role: ROLES.VIEWER,
    designation: 'Internal Auditor',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000028',
    employeeCode: 'AU-0028',
    status: 'SUSPENDED',
  },
];

/**
 * Idempotent, in the same shape as 03-users.ts: upsert the account, re-sync
 * its single role, re-sync its jurisdictions.
 */
export async function seedDemoStaff(prisma: PrismaClient, demoPassword: string) {
  const passwordHash = await hashPassword(demoPassword);

  let created = 0;
  let updated = 0;

  for (const staff of DEMO_STAFF) {
    const office = await prisma.office.findUniqueOrThrow({ where: { code: staff.officeCode } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: staff.role } });

    const primaryZoneId = staff.zoneCodes[0]
      ? (await prisma.zone.findUniqueOrThrow({ where: { code: staff.zoneCodes[0] } })).id
      : null;

    const existing = await prisma.user.findUnique({ where: { email: staff.email } });

    const data = {
      name: staff.name,
      designation: staff.designation,
      phone: staff.phone,
      employeeCode: staff.employeeCode ?? null,
      status: staff.status ?? ('ACTIVE' as const),
      officeId: office.id,
      departmentId: office.departmentId,
      primaryZoneId,
      ltpLicenceNo: staff.ltp?.licenceNo ?? null,
      ltpLicenceClass: staff.ltp?.licenceClass ?? null,
      ltpValidUpto: staff.ltp ? new Date('2028-03-31') : null,
      firmName: staff.ltp?.firmName ?? null,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      deletedAt: null,
    };

    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { ...data, passwordHash } })
      : await prisma.user.create({ data: { ...data, email: staff.email, passwordHash } });

    if (existing) updated += 1;
    else created += 1;

    await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: { not: role.id } } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });

    const zoneIds = await Promise.all(
      staff.zoneCodes.map(async (code) => (await prisma.zone.findUniqueOrThrow({ where: { code } })).id)
    );

    await prisma.userJurisdiction.deleteMany({
      where: {
        userId: user.id,
        zoneId: { notIn: zoneIds.length ? zoneIds : ['00000000-0000-0000-0000-000000000000'] },
      },
    });

    for (const zoneId of zoneIds) {
      await prisma.userJurisdiction.upsert({
        where: { userId_zoneId: { userId: user.id, zoneId } },
        create: { userId: user.id, zoneId },
        update: {},
      });
    }
  }

  return { created, updated, total: DEMO_STAFF.length };
}
