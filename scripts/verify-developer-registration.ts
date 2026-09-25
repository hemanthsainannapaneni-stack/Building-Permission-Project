/**
 * PHASE 11 VERIFICATION — developer registration.
 *
 *   npm run developers:verify
 *
 * READ-ONLY apart from the expiry sweep every register read runs. The full
 * flow — with its writes, refusals and races — is the integration suite
 * (tests/integration/developer-registrations.test.ts), which runs only
 * against a throwaway database. This script checks a LIVE one:
 *
 * 1. CONFIGURATION: the tables, the grants as the database holds them, the
 *    validity settings.
 * 2. THE DEMO DATA: every status and every register present; numbers well
 *    formed and separate from application numbering; validity coherent;
 *    renewals continuous; one current row per developer; a registration
 *    letter in Outward for every approval; each row's events a coherent
 *    chain ending at its status, each move audited.
 * 3. READ REFUSALS only — see section 3.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { isApiError } from '../src/server/http/errors';
import { DEVELOPER_REGISTERS, DEVELOPER_STATUSES, dayOf } from '../src/lib/developer-registration';
import { developerRegisterSummary, listDeveloperRegistrations } from '../src/server/services/developer-registrations';

const prisma = new PrismaClient();
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** A plain account for the role — the one holding the fewest roles, never a multi-role superuser. */
async function actor(roleKey: string): Promise<AuthUser | null> {
  const candidates = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: roleKey } } } },
    include: { roles: { include: { role: true } } },
    orderBy: { email: 'asc' },
  });
  const u = candidates.sort((a, b) => a.roles.length - b.roles.length)[0];
  if (!u) return null;
  const roleKeys = u.roles.map((r) => r.role.key);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleKeys: roleKeys as never,
    roleNames: [],
    capabilities: [...new Set(roleKeys.flatMap((k) => MATRIX[k] ?? []))],
    zoneIds: [],
    officeId: null,
    sessionId: 'verify',
  };
}

/** The refusal's HTTP status, or 0 if the call went through (which is itself a failure). */
async function refusedWith(fn: () => Promise<unknown>) {
  try {
    await fn();
    return 0;
  } catch (e) {
    if (isApiError(e)) return e.status;
    throw e;
  }
}

async function main() {
  // ── 1. Configuration ────────────────────────────────────────────────────
  console.log('\n1. Configuration');
  const [t1, t2] = await prisma.$queryRawUnsafe<Array<{ r: string | null }>>(
    `SELECT to_regclass('public.developer_registrations')::text AS r UNION ALL SELECT to_regclass('public.developer_registration_events')::text`
  );
  check('tables exist', Boolean(t1?.r && t2?.r));
  const grants = await prisma.rolePermission.findMany({
    where: { permission: { key: { startsWith: 'DEVELOPER_' } } },
    select: { role: { select: { key: true } }, permission: { select: { key: true } } },
  });
  const holders = (cap: string) => grants.filter((g) => g.permission.key === cap).map((g) => g.role.key).sort().join(',');
  check('DEVELOPER_REGISTER held by TPA only', holders('DEVELOPER_REGISTER') === 'TPA', holders('DEVELOPER_REGISTER'));
  check('DEVELOPER_VERIFY held by PLANNING_OFFICER only', holders('DEVELOPER_VERIFY') === 'PLANNING_OFFICER', holders('DEVELOPER_VERIFY'));
  check('DEVELOPER_DECIDE held by ZJD only', holders('DEVELOPER_DECIDE') === 'ZJD', holders('DEVELOPER_DECIDE'));
  check('DEVELOPER_VIEW not held by LTP', !holders('DEVELOPER_VIEW').split(',').includes('LTP'));
  const settings = await prisma.systemSetting.findMany({ where: { group: 'developers' } });
  const setting = (k: string) => Number(settings.find((s) => s.key === k)?.value);
  const years = setting('developer_registration_validity_years');
  const windowDays = setting('developer_renewal_window_days');
  check('validity settings present', years > 0 && windowDays >= 0, `${years} years, ${windowDays} days`);

  // ── 2. The demo data ────────────────────────────────────────────────────
  console.log('\n2. Demo data');
  const viewer = await actor('VIEWER');
  if (viewer) await listDeveloperRegistrations(viewer, {}); // runs the expiry sweep as a register read would
  const rows = await prisma.developerRegistration.findMany({ include: { events: { orderBy: { occurredAt: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  check('demo developers present', rows.length >= 10, `${rows.length} rows`);
  for (const s of DEVELOPER_STATUSES) check(`a registration is ${s}`, rows.some((r) => r.status === s));
  check('a renewal has been approved', rows.some((r) => r.kind === 'RENEWAL' && r.status === 'APPROVED'));
  check('a renewal is under way', rows.some((r) => r.kind === 'RENEWAL' && !['APPROVED', 'REJECTED', 'EXPIRED'].includes(r.status)));
  check('a registration was approved after a shortfall round', rows.some((r) => r.status === 'APPROVED' && r.round > 1));

  if (viewer) {
    const summary = await developerRegisterSummary(viewer);
    for (const reg of DEVELOPER_REGISTERS) {
      const list = await listDeveloperRegistrations(viewer, { register: reg, pageSize: 100 });
      check(`register ${reg} lists entries and agrees with its count`, list.total > 0 && list.total === summary[reg], `${list.total} / ${summary[reg]}`);
    }
  }

  check('application references are DRA/yyyy/nnnnnn and unique', rows.every((r) => /^DRA\/\d{4}\/\d{6}$/.test(r.applicationNumber)) && new Set(rows.map((r) => r.applicationNumber)).size === rows.length);
  const issued = rows.filter((r) => r.registrationNumber);
  check('registration numbers are DEV/yyyy/nnnnnn', issued.every((r) => /^DEV\/\d{4}\/\d{6}$/.test(r.registrationNumber!)));
  const numberOwners = new Map<string, Set<string>>();
  for (const r of issued) numberOwners.set(r.registrationNumber!, (numberOwners.get(r.registrationNumber!) ?? new Set()).add(r.lineageId));
  check('one registration number per developer, kept across renewals', [...numberOwners.values()].every((s) => s.size === 1));
  check('no registration number on a rejected first application', rows.every((r) => !(r.status === 'REJECTED' && r.kind === 'NEW' && r.registrationNumber)));
  const appNumbers = await prisma.application.count({ where: { OR: [{ applicationNumber: { startsWith: 'DRA/' } }, { applicationNumber: { startsWith: 'DEV/' } }] } });
  const appScopes = await prisma.numberSequence.count({ where: { scope: { in: ['application:DRA', 'application:DEV'] } } });
  check('application numbering untouched', appNumbers === 0 && appScopes === 0);

  const lineages = new Map<string, typeof rows>();
  for (const r of rows) lineages.set(r.lineageId, [...(lineages.get(r.lineageId) ?? []), r]);
  check('exactly one current row per developer', [...lineages.values()].every((l) => l.filter((r) => r.isCurrent).length === 1));

  const withValidity = rows.filter((r) => r.status === 'APPROVED' || r.status === 'EXPIRED');
  check(
    'every approval has issue date, validity and renewal due, in order',
    withValidity.every((r) => r.issueDate && r.validFrom && r.validTo && r.renewalDueDate && r.validFrom <= r.validTo && r.renewalDueDate <= r.validTo && r.validityYears)
  );
  const today = dayOf(new Date());
  check('no current APPROVED registration has lapsed', rows.every((r) => !(r.isCurrent && r.status === 'APPROVED' && r.validTo! < today)));
  check('every EXPIRED registration had lapsed', rows.filter((r) => r.status === 'EXPIRED').every((r) => r.validTo! < today && r.expiredAt));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const renewedOk = rows
    .filter((r) => r.kind === 'RENEWAL' && r.status === 'APPROVED')
    .every((r) => {
      const prev = byId.get(r.renewalOfId!)!;
      const continuing = prev.validTo! >= dayOf(r.decidedAt!);
      const gapOk = continuing ? r.validFrom!.getTime() - prev.validTo!.getTime() === DAY : dayOf(r.validFrom!).getTime() === dayOf(r.decidedAt!).getTime();
      return gapOk && !prev.isCurrent && prev.supersededAt;
    });
  check('approved renewals continue their predecessor, which is superseded', renewedOk);

  const outward = await prisma.outwardEntry.findMany({ where: { sourceType: 'DeveloperRegistration' } });
  const approvedEver = rows.filter((r) => r.decision === 'APPROVED');
  check(
    'every approval sent a registration letter to Outward',
    approvedEver.every((r) => outward.some((o) => o.id === r.outwardEntryId && o.documentType === 'REGISTRATION_LETTER' && o.documentReference === r.registrationNumber && o.sourceId === r.id))
  );

  const chainProblems: string[] = [];
  for (const r of rows) {
    let at = '';
    for (const e of r.events) {
      if (e.fromStatus !== at && !(e.fromStatus === e.toStatus && e.toStatus === at)) chainProblems.push(`${r.applicationNumber}: ${e.action} from ${e.fromStatus || '∅'} while at ${at || '∅'}`);
      at = e.toStatus;
    }
    if (at !== r.status) chainProblems.push(`${r.applicationNumber}: events end at ${at}, row is ${r.status}`);
  }
  check('every row’s events form a chain ending at its status', !chainProblems.length, chainProblems.slice(0, 3).join('; '));

  const audits = await prisma.auditLog.groupBy({ by: ['entityId'], where: { entityType: 'DeveloperRegistration' }, _count: { _all: true } });
  const auditCount = new Map(audits.map((a) => [a.entityId, a._count._all]));
  const moves = (r: (typeof rows)[number]) => r.events.filter((e) => e.fromStatus !== e.toStatus).length;
  const unaudited = rows.filter((r) => (auditCount.get(r.id) ?? 0) < moves(r));
  check('every status change is audited', !unaudited.length, unaudited.map((r) => r.applicationNumber).join(', '));

  // ── 3. Refusals ─────────────────────────────────────────────────────────
  // Only READ refusals here. A refusal of a step is proved by calling the
  // step, and a step that wrongly succeeds WRITES — which must never happen to
  // a live database. Those refusals are the integration suite's.
  console.log('\n3. Refusals');
  const ltp = await actor('LTP');
  if (ltp) check('LTP cannot read the register', (await refusedWith(() => listDeveloperRegistrations(ltp, {}))) === 403);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
