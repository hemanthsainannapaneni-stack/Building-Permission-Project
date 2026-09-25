/**
 * PHASE 12 VERIFICATION — professional registration.
 *
 *   npm run professionals:verify
 *
 * READ-ONLY apart from the expiry sweep every register read runs. The full
 * flow with its writes and refusals is the integration suite
 * (tests/integration/professional-registrations.test.ts), which runs only
 * against a throwaway database. This script checks a LIVE one:
 *
 * 1. CONFIGURATION: tables and columns, grants as the database holds them,
 *    settings, professional types.
 * 2. THE REGISTER: every status and register present; numbers well formed;
 *    one current row per professional and no duplicate live registration;
 *    validity coherent and never past the licence; every approval's required
 *    documents verified; renewals continuous; Outward letters; event chains;
 *    every move audited.
 * 3. APPLICATIONS: who the LTP step and the change of professional may name —
 *    only approved, in-force entries; every licensed LTP account registered.
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { isApiError } from '../src/server/http/errors';
import {
  PROFESSIONAL_REGISTERS,
  PROFESSIONAL_STATUSES,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
  dayOf,
  latestProfessionalDocuments,
  type ProfessionalDocument,
} from '../src/lib/professional-registration';
import {
  availableProfessionals,
  listProfessionalRegistrations,
  professionalRegisterSummary,
  professionalTypes,
} from '../src/server/services/professional-registrations';
import { eligibleProfessionals } from '../src/server/services/professional-changes';

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

async function main() {
  // ── 1. Configuration ────────────────────────────────────────────────────
  console.log('\n1. Configuration');
  const tables = await prisma.$queryRawUnsafe<Array<{ r: string | null }>>(
    `SELECT to_regclass('public.professional_registrations')::text AS r UNION ALL SELECT to_regclass('public.professional_registration_events')::text`
  );
  check('tables exist', tables.every((t) => t.r));
  const cols = await prisma.$queryRawUnsafe<Array<{ c: string }>>(
    `SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'applicants' AND column_name IN ('ltpRegistrationId', 'structuralEngineerRegistrationId')`
  );
  check('applicants carry the two register links', cols.length === 2);
  const grants = await prisma.rolePermission.findMany({
    where: { permission: { key: { startsWith: 'PROFESSIONAL_REG_' } } },
    select: { role: { select: { key: true } }, permission: { select: { key: true } } },
  });
  const holders = (cap: string) => grants.filter((g) => g.permission.key === cap).map((g) => g.role.key).sort().join(',');
  check('PROFESSIONAL_REG_REGISTER held by TPA only', holders('PROFESSIONAL_REG_REGISTER') === 'TPA', holders('PROFESSIONAL_REG_REGISTER'));
  check('PROFESSIONAL_REG_VERIFY held by PLANNING_OFFICER only', holders('PROFESSIONAL_REG_VERIFY') === 'PLANNING_OFFICER', holders('PROFESSIONAL_REG_VERIFY'));
  check('PROFESSIONAL_REG_DECIDE held by ZJD only', holders('PROFESSIONAL_REG_DECIDE') === 'ZJD', holders('PROFESSIONAL_REG_DECIDE'));
  const settings = await prisma.systemSetting.findMany({ where: { group: 'professionals' } });
  check('validity settings present', settings.length === 2, settings.map((s) => `${s.key}=${s.value}`).join(', '));
  const types = await professionalTypes();
  check('professional types configured', types.length >= 4, types.map((t) => t.code).join(', '));
  check('each type has its own number prefix', new Set(types.map((t) => t.prefix)).size === types.length);
  check('a type may hold files and a type is structural', types.some((t) => t.canHoldFile) && types.some((t) => t.structural));

  // ── 2. The register ─────────────────────────────────────────────────────
  console.log('\n2. The register');
  const viewer = await actor('VIEWER');
  if (viewer) await listProfessionalRegistrations(viewer, {}); // the expiry sweep, as a register read runs it
  const rows = await prisma.professionalRegistration.findMany({ include: { events: { orderBy: { occurredAt: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  check('professionals present', rows.length >= 10, `${rows.length} rows`);
  for (const s of PROFESSIONAL_STATUSES) check(`a registration is ${s}`, rows.some((r) => r.status === s));
  check('a renewal has been approved', rows.some((r) => r.kind === 'RENEWAL' && r.status === 'APPROVED'));
  check('a renewal is under way', rows.some((r) => r.kind === 'RENEWAL' && !['APPROVED', 'REJECTED', 'EXPIRED'].includes(r.status)));
  check('a registration was approved after a shortfall round', rows.some((r) => r.status === 'APPROVED' && r.round > 1));
  check('a registration ends with its licence', rows.some((r) => r.cappedByLicence));

  if (viewer) {
    const summary = await professionalRegisterSummary(viewer);
    for (const reg of PROFESSIONAL_REGISTERS) {
      const list = await listProfessionalRegistrations(viewer, { register: reg, pageSize: 100 });
      check(`register ${reg} lists entries and agrees with its count`, list.total > 0 && list.total === summary[reg], `${list.total} / ${summary[reg]}`);
    }
  }

  check('application references are PRA/yyyy/nnnnnn and unique', rows.every((r) => /^PRA\/\d{4}\/\d{6}$/.test(r.applicationNumber)) && new Set(rows.map((r) => r.applicationNumber)).size === rows.length);
  const prefixOf = new Map(types.map((t) => [t.code, t.prefix]));
  const issued = rows.filter((r) => r.registrationNumber);
  check(
    'registration numbers carry their type’s prefix',
    issued.every((r) => new RegExp(`^${prefixOf.get(r.professionalType) ?? 'PRF'}/\\d{4}/\\d{6}$`).test(r.registrationNumber!)),
    issued.filter((r) => !r.registrationNumber!.startsWith(prefixOf.get(r.professionalType) ?? 'PRF')).map((r) => r.registrationNumber).join(', ')
  );
  const owners = new Map<string, Set<string>>();
  for (const r of issued) owners.set(r.registrationNumber!, (owners.get(r.registrationNumber!) ?? new Set()).add(r.lineageId));
  check('one registration number per professional, kept across renewals', [...owners.values()].every((s) => s.size === 1));

  const lineages = new Map<string, typeof rows>();
  for (const r of rows) lineages.set(r.lineageId, [...(lineages.get(r.lineageId) ?? []), r]);
  check('exactly one current row per professional', [...lineages.values()].every((l) => l.filter((r) => r.isCurrent).length === 1));
  const live = rows.filter((r) => r.isCurrent && !['DRAFT', 'REJECTED', 'EXPIRED'].includes(r.status));
  const key = (r: (typeof rows)[number], by: 'licence' | 'user') => `${r.professionalType}|${by === 'licence' ? r.licenceNo.toUpperCase() : r.userId}`;
  check('no licence registered twice for a type', new Set(live.map((r) => key(r, 'licence'))).size === live.length);
  const withUser = live.filter((r) => r.userId);
  check('no account registered twice for a type', new Set(withUser.map((r) => key(r, 'user'))).size === withUser.length);

  const decided = rows.filter((r) => r.decision === 'APPROVED');
  check(
    'every approval has issue date, validity and renewal due, in order',
    decided.every((r) => r.issueDate && r.validFrom && r.validTo && r.renewalDueDate && r.validFrom <= r.validTo && r.renewalDueDate <= r.validTo)
  );
  check('no registration runs past its licence', decided.every((r) => r.licenceValidTo && r.validTo! <= dayOf(r.licenceValidTo)));
  check(
    'every approval rests on verified required documents',
    decided.every((r) => {
      const latest = latestProfessionalDocuments(r.documents as unknown as ProfessionalDocument[]);
      return REQUIRED_PROFESSIONAL_DOCUMENTS.every((k) => latest.get(k)?.doc.status === 'VERIFIED');
    })
  );
  check('every approval had consent', decided.every((r) => r.consentGiven && r.consentAt && r.consentText));
  const today = dayOf(new Date());
  check('no current APPROVED registration has lapsed', rows.every((r) => !(r.isCurrent && r.status === 'APPROVED' && r.validTo! < today)));
  check('every EXPIRED registration had lapsed', rows.filter((r) => r.status === 'EXPIRED').every((r) => r.validTo! < today && r.expiredAt));

  const byId = new Map(rows.map((r) => [r.id, r]));
  check(
    'approved renewals continue their predecessor, which is superseded',
    rows
      .filter((r) => r.kind === 'RENEWAL' && r.status === 'APPROVED')
      .every((r) => {
        const prev = byId.get(r.renewalOfId!)!;
        const continuing = prev.validTo! >= dayOf(r.decidedAt!);
        const ok = continuing ? r.validFrom!.getTime() - prev.validTo!.getTime() === DAY : dayOf(r.validFrom!).getTime() === dayOf(r.decidedAt!).getTime();
        return ok && !prev.isCurrent && prev.supersededAt;
      })
  );
  const outward = await prisma.outwardEntry.findMany({ where: { sourceType: 'ProfessionalRegistration' } });
  check(
    'every approval sent a registration letter to Outward',
    decided.every((r) => outward.some((o) => o.id === r.outwardEntryId && o.documentType === 'REGISTRATION_LETTER' && o.documentReference === r.registrationNumber && o.sourceId === r.id))
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
  const audits = await prisma.auditLog.groupBy({ by: ['entityId'], where: { entityType: 'ProfessionalRegistration' }, _count: { _all: true } });
  const auditCount = new Map(audits.map((a) => [a.entityId, a._count._all]));
  const unaudited = rows.filter((r) => (auditCount.get(r.id) ?? 0) < r.events.filter((e) => e.fromStatus !== e.toStatus || e.action.startsWith('DOCUMENT_')).length);
  check('every move and every document check is audited', !unaudited.length, unaudited.map((r) => r.applicationNumber).join(', '));

  // ── 3. Applications ─────────────────────────────────────────────────────
  console.log('\n3. Applications');
  const holdersNow = await availableProfessionals({ purpose: 'FILE_HOLDER' });
  const structural = await availableProfessionals({ purpose: 'STRUCTURAL' });
  check('the LTP step can name a file-holding professional', holdersNow.length > 0, `${holdersNow.length} available`);
  check('the LTP step can name a structural engineer', structural.length > 0, `${structural.length} available`);
  const avail = [...holdersNow, ...structural].map((a) => byId.get(a.registrationId)!);
  check('only approved, current, in-force entries are offered', avail.every((r) => r.status === 'APPROVED' && r.isCurrent && r.validTo! >= today));
  check('file-holders are linked to a portal account; structural engineers are structural types', holdersNow.every((h) => h.userId) && structural.every((s) => types.find((t) => t.code === s.professionalType)?.structural));
  const ltpAccounts = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, ltpLicenceNo: { not: null }, ltpValidUpto: { gte: today }, roles: { some: { role: { key: 'LTP' } } } },
    select: { id: true, email: true, professionalRegistrations: { select: { id: true } } },
  });
  const unregistered = ltpAccounts.filter((u) => !u.professionalRegistrations.length);
  check('every licensed LTP account is on the register (linked, not copied)', !unregistered.length, unregistered.map((u) => u.email).join(', '));
  const eligible = await eligibleProfessionals('00000000-0000-0000-0000-000000000000');
  check('change of professional offers only registered professionals', eligible.every((e) => holdersNow.some((h) => h.userId === e.id)) && eligible.every((e) => e.registrationNumber));
  const named = await prisma.applicant.findMany({ where: { OR: [{ ltpRegistrationId: { not: null } }, { structuralEngineerRegistrationId: { not: null } }] }, select: { ltpRegistrationId: true, structuralEngineerRegistrationId: true } });
  check('every register link on an application names a real registration', named.every((n) => (!n.ltpRegistrationId || byId.has(n.ltpRegistrationId)) && (!n.structuralEngineerRegistrationId || byId.has(n.structuralEngineerRegistrationId))), `${named.length} linked`);

  const ltp = await actor('LTP');
  if (ltp) {
    let status = 0;
    try {
      await listProfessionalRegistrations(ltp, {});
    } catch (e) {
      status = isApiError(e) ? e.status : -1;
    }
    check('LTP cannot read the register itself', status === 403);
  }

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
