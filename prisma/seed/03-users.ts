import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/server/auth/password';
import { ROLES, type RoleKey } from '../../src/lib/constants';

/**
 * The twelve demo accounts — one per desk.
 *
 * All share one password, read from DEMO_PASSWORD (default `Demo@12345`) and
 * documented in the README. They exist so a tester can walk the whole
 * lifecycle without touching the database — which is the definition of done.
 *
 * `DEMO_MODE=false` is refused in production by the env guardrails, and these
 * accounts are only seeded when DEMO_MODE is on.
 */

type DemoUser = {
  email: string;
  name: string;
  role: RoleKey;
  designation: string;
  officeCode: string;
  /** Zonal officers are scoped to these; city-wide roles list none. */
  zoneCodes: string[];
  phone: string;
  ltp?: { licenceNo: string; licenceClass: string; firmName: string };
};

export const DEMO_USERS: DemoUser[] = [
  {
    email: 'ltp.demo@example.com',
    name: 'Ravi Kumar',
    role: ROLES.LTP,
    designation: 'Licensed Technical Person',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000001',
    ltp: { licenceNo: 'LTP/2026/0001', licenceClass: 'Class-I', firmName: 'Kumar & Associates' },
  },
  {
    email: 'tpa.demo@example.com',
    name: 'Priya Sharma',
    role: ROLES.TPA,
    designation: 'Town Planning Assistant',
    officeCode: 'TP-Z1',
    zoneCodes: ['Z1', 'Z2'],
    phone: '9000000002',
  },
  {
    // The BBAS chain's second desk. Zoned like the other zonal officers rather
    // than given every zone: jurisdiction scoping is a real guarantee, and an
    // officer who can see everything makes it invisible. Z4 and Z5 are covered
    // by po2.demo in the demo staff seed, so every zone has a Planning Officer.
    email: 'po.demo@example.com',
    name: 'Ananya Krishnan',
    role: ROLES.PLANNING_OFFICER,
    designation: 'Planning Officer',
    officeCode: 'TP-Z1',
    zoneCodes: ['Z1', 'Z2', 'Z3'],
    phone: '9000000013',
  },
  {
    email: 'zad.demo@example.com',
    name: 'Anil Reddy',
    role: ROLES.ZAD,
    designation: 'Zonal Assistant Director',
    officeCode: 'TP-Z1',
    zoneCodes: ['Z1', 'Z2'],
    phone: '9000000003',
  },
  {
    email: 'zdd.demo@example.com',
    name: 'Meena Iyer',
    role: ROLES.ZDD,
    designation: 'Zonal Deputy Director',
    officeCode: 'TP-Z3',
    zoneCodes: ['Z3', 'Z4'],
    phone: '9000000004',
  },
  {
    email: 'zjd.demo@example.com',
    name: 'Suresh Naidu',
    role: ROLES.ZJD,
    designation: 'Zonal Joint Director',
    officeCode: 'TP-Z1',
    zoneCodes: ['Z1', 'Z2', 'Z3'],
    phone: '9000000005',
  },
  {
    email: 'director.demo@example.com',
    name: 'Lakshmi Rao',
    role: ROLES.DIRECTOR_DP,
    designation: 'Director (Development Plan)',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000006',
  },
  {
    email: 'addlcommissioner.demo@example.com',
    name: 'Vikram Singh',
    role: ROLES.ADDL_COMMISSIONER,
    designation: 'Additional Commissioner',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000007',
  },
  {
    email: 'commissioner.demo@example.com',
    name: 'Deepa Menon',
    role: ROLES.COMMISSIONER,
    designation: 'Commissioner',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000008',
  },
  {
    email: 'finance.demo@example.com',
    name: 'Rajesh Gupta',
    role: ROLES.FINANCE_OFFICER,
    designation: 'Finance Officer',
    officeCode: 'FIN-HO',
    zoneCodes: [],
    phone: '9000000009',
  },
  {
    email: 'admin.demo@example.com',
    name: 'System Administrator',
    role: ROLES.SYSTEM_ADMIN,
    designation: 'System Administrator',
    officeCode: 'IT',
    zoneCodes: [],
    phone: '9000000010',
  },
  {
    email: 'viewer.demo@example.com',
    name: 'Audit Viewer',
    role: ROLES.VIEWER,
    designation: 'Auditor',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000011',
  },
  {
    email: 'super.demo@example.com',
    name: 'All Access Admin',
    role: ROLES.SYSTEM_ADMIN,
    designation: 'Super Administrator',
    officeCode: 'HO',
    zoneCodes: [],
    phone: '9000000012',
  },
];

export async function seedUsers(prisma: PrismaClient, demoPassword: string) {
  // Hashed once — Argon2id is deliberately slow, and eleven separate hashes
  // of the same string would add seconds to every seed run for no benefit.
  const passwordHash = await hashPassword(demoPassword);

  let created = 0;
  let updated = 0;

  for (const demo of DEMO_USERS) {
    const office = await prisma.office.findUniqueOrThrow({ where: { code: demo.officeCode } });
    const roles = demo.email === 'super.demo@example.com' || demo.email === 'admin.demo@example.com'
      ? await prisma.role.findMany()
      : [await prisma.role.findUniqueOrThrow({ where: { key: demo.role } })];

    const primaryZoneId = demo.zoneCodes[0]
      ? (await prisma.zone.findUniqueOrThrow({ where: { code: demo.zoneCodes[0] } })).id
      : null;

    const existing = await prisma.user.findUnique({ where: { email: demo.email } });

    const data = {
      name: demo.name,
      designation: demo.designation,
      phone: demo.phone,
      status: 'ACTIVE' as const,
      officeId: office.id,
      departmentId: office.departmentId,
      primaryZoneId,
      ltpLicenceNo: demo.ltp?.licenceNo ?? null,
      ltpLicenceClass: demo.ltp?.licenceClass ?? null,
      ltpValidUpto: demo.ltp ? new Date('2028-03-31') : null,
      firmName: demo.ltp?.firmName ?? null,
      // Demo accounts do not force a password change — the whole point is that
      // a tester can sign straight in.
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      deletedAt: null,
    };

    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { ...data, passwordHash } })
      : await prisma.user.create({ data: { ...data, email: demo.email, passwordHash } });

    if (existing) updated += 1;
    else created += 1;

    // Assign roles, re-synced on every run.
    const roleIds = roles.map(r => r.id);
    await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: { notIn: roleIds.length ? roleIds : ['00000000-0000-0000-0000-000000000000'] } } });
    for (const r of roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: r.id } },
        create: { userId: user.id, roleId: r.id },
        update: {},
      });
    }

    // Jurisdictions, re-synced so removing a zone here removes it there.
    const zoneIds = demo.email === 'super.demo@example.com' || demo.email === 'admin.demo@example.com'
      ? (await prisma.zone.findMany()).map(z => z.id)
      : await Promise.all(
          demo.zoneCodes.map(async (code) => (await prisma.zone.findUniqueOrThrow({ where: { code } })).id)
        );
    await prisma.userJurisdiction.deleteMany({
      where: { userId: user.id, zoneId: { notIn: zoneIds.length ? zoneIds : ['00000000-0000-0000-0000-000000000000'] } },
    });
    for (const zoneId of zoneIds) {
      await prisma.userJurisdiction.upsert({
        where: { userId_zoneId: { userId: user.id, zoneId } },
        create: { userId: user.id, zoneId },
        update: {},
      });
    }
  }

  return { created, updated, total: DEMO_USERS.length };
}
