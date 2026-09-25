import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { ROLES } from '@/lib/constants';
import {
  DEVELOPER_TYPE_LABEL,
  DEVELOPER_TYPES,
  CLOSED_DEVELOPER_STATUSES,
  daysUntil,
  dayOf,
  isLapsed,
  renewalBlocker,
  type DeveloperType,
} from '@/lib/developer-registration';
import {
  PROFESSIONAL_TYPE_CATEGORY,
  professionalRenewalBlocker,
  typeOption,
  CLOSED_PROFESSIONAL_STATUSES,
  type ProfessionalTypeOption,
} from '@/lib/professional-registration';
import { publicRegistrationStatus } from '@/lib/public-portal';

/**
 * THE PUBLIC REGISTERS — developers, licensed technical persons, TPAs.
 *
 * Same rule as the rest of this folder: a field is public because it is named
 * here. What each register shows is what its list page promises and nothing
 * more — number, name, type, status, validity. PAN, GSTIN, mobile, email,
 * address, the authorised signatory, documents, shortfall text, verification
 * remarks and every officer's name stay in the internal register.
 *
 * ── "Registered" means DECIDED ──────────────────────────────────────────
 *
 * The public list holds registrations the authority has approved (and those
 * that later lapsed, so a reader can tell "no longer in force" from "never
 * registered"). A draft, a pending application and a rejected one are not on
 * it — and a lookup by number treats a draft as absent.
 *
 * ── Lapsed is worked out, not read ──────────────────────────────────────
 *
 * The expiry sweep marks a lapsed registration EXPIRED, but it runs lazily and
 * a public page must never say "Registered" for one whose validity ended
 * yesterday. Every row is judged against today's date here as well.
 */

const today = () => dayOf(new Date());
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number; totalPages: number };

const paged = <T>(rows: T[], total: number, page: number, pageSize: number): Paged<T> => ({ rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

/** APPROVED past its validity reads as EXPIRED, whatever the sweep has got to. */
const effectiveStatus = (status: string, validTo: Date | null): string => (status === 'APPROVED' && isLapsed(validTo, new Date()) ? 'EXPIRED' : status);

/** "in force" filter → the where clause that finds it, without depending on the sweep. */
function validityWhere(status: string): { status?: string | { in: string[] }; validTo?: Prisma.DateTimeFilter | null; OR?: unknown[] } {
  if (status === 'APPROVED') return { status: 'APPROVED', validTo: { gte: today() } };
  if (status === 'EXPIRED') return { OR: [{ status: 'EXPIRED' }, { status: 'APPROVED', validTo: { lt: today() } }] };
  return { status: { in: ['APPROVED', 'EXPIRED'] } };
}

// ═══════════════════════════════════════════════════════════════════════════
// Developers
// ═══════════════════════════════════════════════════════════════════════════

export type PublicDeveloperRow = {
  registrationNumber: string;
  name: string;
  organization: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  validFrom: string | null;
  validTo: string | null;
};

export type DeveloperListQuery = { q?: string; type?: string; status?: string; page?: number; pageSize?: number };

export async function listPublicDevelopers(query: DeveloperListQuery = {}): Promise<Paged<PublicDeveloperRow>> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 10));
  const q = query.q?.trim();
  const and: Prisma.DeveloperRegistrationWhereInput[] = [
    { isCurrent: true, registrationNumber: { not: null } },
    validityWhere(query.status ?? '') as Prisma.DeveloperRegistrationWhereInput,
  ];
  if (query.type && (DEVELOPER_TYPES as readonly string[]).includes(query.type)) and.push({ developerType: query.type });
  if (q) {
    and.push({
      OR: [
        { registrationNumber: { contains: q, mode: 'insensitive' } },
        { developerName: { contains: q, mode: 'insensitive' } },
        { organization: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where: Prisma.DeveloperRegistrationWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.developerRegistration.count({ where }),
    prisma.developerRegistration.findMany({
      where,
      orderBy: [{ registrationNumber: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { registrationNumber: true, developerName: true, organization: true, developerType: true, status: true, validFrom: true, validTo: true },
    }),
  ]);

  return paged(
    rows.map((r) => {
      const status = effectiveStatus(r.status, r.validTo);
      const meta = publicRegistrationStatus(status);
      return {
        registrationNumber: r.registrationNumber ?? '',
        name: r.developerName,
        organization: r.organization && r.organization !== r.developerName ? r.organization : '',
        typeLabel: DEVELOPER_TYPE_LABEL[r.developerType as DeveloperType] ?? r.developerType,
        status,
        statusLabel: meta.label,
        tone: meta.tone,
        validFrom: iso(r.validFrom),
        validTo: iso(r.validTo),
      };
    }),
    total,
    page,
    pageSize
  );
}

export type PublicRenewalState = {
  /** NOT_DUE | DUE | LAPSED | IN_PROGRESS | NONE */
  state: 'NOT_DUE' | 'DUE' | 'LAPSED' | 'IN_PROGRESS' | 'NONE';
  label: string;
  renewalDueOn: string | null;
  openRenewal: { applicationNumber: string; statusLabel: string; submittedOn: string | null } | null;
};

export type PublicDeveloperStatus = {
  applicationNumber: string;
  registrationNumber: string | null;
  kindLabel: string;
  developerName: string;
  organization: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  submittedOn: string | null;
  decidedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysToExpiry: number | null;
  renewal: PublicRenewalState;
};

const SELECT_DEVELOPER = {
  id: true,
  applicationNumber: true,
  registrationNumber: true,
  kind: true,
  lineageId: true,
  isCurrent: true,
  status: true,
  developerType: true,
  developerName: true,
  organization: true,
  submittedAt: true,
  decidedAt: true,
  validFrom: true,
  validTo: true,
  renewalDueDate: true,
  createdAt: true,
} satisfies Prisma.DeveloperRegistrationSelect;

type DeveloperRow = Prisma.DeveloperRegistrationGetPayload<{ select: typeof SELECT_DEVELOPER }>;

/** A lookup finds a row by registration or application number; a draft is treated as absent. */
async function findDeveloperRow(reference: string): Promise<DeveloperRow | null> {
  const ref = reference.trim();
  if (ref.length < 6 || ref.length > 40) return null;
  const eq = { equals: ref, mode: 'insensitive' as const };
  const rows = await prisma.developerRegistration.findMany({
    where: { status: { not: 'DRAFT' }, OR: [{ applicationNumber: eq }, { registrationNumber: eq }] },
    orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
    select: SELECT_DEVELOPER,
    take: 10,
  });
  // An application number names one row. A registration number names a lineage: show its current row.
  return rows.find((r) => r.applicationNumber.toLowerCase() === ref.toLowerCase()) ?? rows[0] ?? null;
}

async function developerRenewalState(row: DeveloperRow): Promise<PublicRenewalState> {
  const open = await prisma.developerRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: { notIn: [...CLOSED_DEVELOPER_STATUSES, 'DRAFT'] }, id: { not: row.id } },
    orderBy: { createdAt: 'desc' },
    select: { applicationNumber: true, status: true, submittedAt: true },
  });
  const openRenewal = open ? { applicationNumber: open.applicationNumber, statusLabel: publicRegistrationStatus(open.status).label, submittedOn: iso(open.submittedAt) } : null;
  const dueOn = iso(row.renewalDueDate);
  const now = new Date();

  if (openRenewal) return { state: 'IN_PROGRESS', label: `Renewal ${openRenewal.applicationNumber} is ${openRenewal.statusLabel.toLowerCase()}`, renewalDueOn: dueOn, openRenewal };
  if (!row.isCurrent || (row.status !== 'APPROVED' && row.status !== 'EXPIRED')) return { state: 'NONE', label: 'Not applicable', renewalDueOn: null, openRenewal: null };
  if (row.status === 'EXPIRED' || isLapsed(row.validTo, now)) return { state: 'LAPSED', label: 'Registration has lapsed — a renewal can be filed', renewalDueOn: dueOn, openRenewal: null };
  if (row.renewalDueDate && dayOf(now).getTime() >= dayOf(row.renewalDueDate).getTime()) return { state: 'DUE', label: 'Renewal is open', renewalDueOn: dueOn, openRenewal: null };
  return { state: 'NOT_DUE', label: row.renewalDueDate ? `Not due until ${dayOf(row.renewalDueDate).toISOString().slice(0, 10)}` : 'Not due', renewalDueOn: dueOn, openRenewal: null };
}

export async function getPublicDeveloperStatus(reference: string): Promise<PublicDeveloperStatus | null> {
  const row = await findDeveloperRow(reference);
  if (!row) return null;
  const status = effectiveStatus(row.status, row.validTo);
  const meta = publicRegistrationStatus(status);
  return {
    applicationNumber: row.applicationNumber,
    registrationNumber: row.registrationNumber,
    kindLabel: row.kind === 'RENEWAL' ? 'Renewal' : 'New registration',
    developerName: row.developerName,
    organization: row.organization && row.organization !== row.developerName ? row.organization : '',
    typeLabel: DEVELOPER_TYPE_LABEL[row.developerType as DeveloperType] ?? row.developerType,
    status,
    statusLabel: meta.label,
    tone: meta.tone,
    submittedOn: iso(row.submittedAt),
    decidedOn: iso(row.decidedAt),
    validFrom: iso(row.validFrom),
    validTo: iso(row.validTo),
    daysToExpiry: row.validTo && status === 'APPROVED' ? daysUntil(row.validTo, new Date()) : null,
    renewal: await developerRenewalState(row),
  };
}

export type PublicDeveloperRenewal = PublicDeveloperStatus & {
  /** The current registration this renewal would replace. */
  registrationId: string;
  /** Null when a renewal can be filed now; otherwise why it cannot. */
  blocker: string | null;
};

/** What the developer renewal page needs: the current registration for a number, and whether it can be renewed today. */
export async function getPublicDeveloperRenewal(registrationNumber: string): Promise<PublicDeveloperRenewal | null> {
  const ref = registrationNumber.trim();
  if (ref.length < 6 || ref.length > 40) return null;
  const row = await prisma.developerRegistration.findFirst({
    where: { registrationNumber: { equals: ref, mode: 'insensitive' }, isCurrent: true, status: { not: 'DRAFT' } },
    select: SELECT_DEVELOPER,
  });
  if (!row) return null;
  const view = await getPublicDeveloperStatus(row.registrationNumber ?? '');
  if (!view) return null;
  const open = await prisma.developerRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: { notIn: [...CLOSED_DEVELOPER_STATUSES] }, id: { not: row.id } },
    select: { applicationNumber: true },
  });
  const blocker = renewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: open?.applicationNumber ?? null, now: new Date() });
  return { ...view, registrationId: row.id, blocker };
}

// ═══════════════════════════════════════════════════════════════════════════
// Licensed technical persons
// ═══════════════════════════════════════════════════════════════════════════

/** The professional types that act as an LTP: the ones that may hold a building-permission file. */
export async function ltpTypes(opts: { activeOnly?: boolean } = {}): Promise<ProfessionalTypeOption[]> {
  const rows = await prisma.masterData.findMany({
    where: { category: PROFESSIONAL_TYPE_CATEGORY, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map(typeOption).filter((t) => t.canHoldFile);
}

export type PublicLtpRow = {
  registrationNumber: string;
  name: string;
  typeCode: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  validFrom: string | null;
  validTo: string | null;
};

export type LtpListQuery = { q?: string; type?: string; status?: string; page?: number; pageSize?: number };

export async function listPublicLtps(query: LtpListQuery = {}): Promise<Paged<PublicLtpRow> & { types: { code: string; label: string }[] }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 10));
  const types = await ltpTypes();
  const codes = types.map((t) => t.code);
  const q = query.q?.trim();

  const and: Prisma.ProfessionalRegistrationWhereInput[] = [
    { isCurrent: true, registrationNumber: { not: null }, professionalType: { in: query.type && codes.includes(query.type) ? [query.type] : codes } },
    validityWhere(query.status ?? '') as Prisma.ProfessionalRegistrationWhereInput,
  ];
  if (q) and.push({ OR: [{ registrationNumber: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] });
  const where: Prisma.ProfessionalRegistrationWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    codes.length ? prisma.professionalRegistration.count({ where }) : Promise.resolve(0),
    codes.length
      ? prisma.professionalRegistration.findMany({
          where,
          orderBy: [{ registrationNumber: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { registrationNumber: true, name: true, professionalType: true, status: true, validFrom: true, validTo: true },
        })
      : Promise.resolve([]),
  ]);

  const label = new Map(types.map((t) => [t.code, t.label]));
  const result = paged(
    rows.map((r) => {
      const status = effectiveStatus(r.status, r.validTo);
      const meta = publicRegistrationStatus(status);
      return {
        registrationNumber: r.registrationNumber ?? '',
        name: r.name,
        typeCode: r.professionalType,
        typeLabel: label.get(r.professionalType) ?? r.professionalType,
        status,
        statusLabel: meta.label,
        tone: meta.tone,
        validFrom: iso(r.validFrom),
        validTo: iso(r.validTo),
      };
    }),
    total,
    page,
    pageSize
  );
  return { ...result, types: types.map((t) => ({ code: t.code, label: t.label })) };
}

const SELECT_PROFESSIONAL = {
  id: true,
  applicationNumber: true,
  registrationNumber: true,
  kind: true,
  lineageId: true,
  isCurrent: true,
  status: true,
  professionalType: true,
  userId: true,
  name: true,
  registrationBody: true,
  qualification: true,
  experienceYears: true,
  organization: true,
  district: true,
  submittedAt: true,
  decidedAt: true,
  validFrom: true,
  validTo: true,
  renewalDueDate: true,
  licenceValidTo: true,
  cappedByLicence: true,
  createdAt: true,
} satisfies Prisma.ProfessionalRegistrationSelect;

type ProfessionalRow = Prisma.ProfessionalRegistrationGetPayload<{ select: typeof SELECT_PROFESSIONAL }>;

async function findLtpRow(reference: string, opts: { currentOnly?: boolean } = {}): Promise<{ row: ProfessionalRow; types: ProfessionalTypeOption[] } | null> {
  const ref = reference.trim();
  if (ref.length < 6 || ref.length > 40) return null;
  const types = await ltpTypes();
  const codes = types.map((t) => t.code);
  if (!codes.length) return null;
  const eq = { equals: ref, mode: 'insensitive' as const };
  const rows = await prisma.professionalRegistration.findMany({
    where: { status: { not: 'DRAFT' }, professionalType: { in: codes }, OR: [{ registrationNumber: eq }, ...(opts.currentOnly ? [] : [{ applicationNumber: eq }])], ...(opts.currentOnly ? { isCurrent: true } : {}) },
    orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
    select: SELECT_PROFESSIONAL,
    take: 10,
  });
  const row = rows.find((r) => r.applicationNumber.toLowerCase() === ref.toLowerCase()) ?? rows[0];
  return row ? { row, types } : null;
}

async function professionalRenewalState(row: ProfessionalRow): Promise<PublicRenewalState> {
  const open = await prisma.professionalRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: { notIn: [...CLOSED_PROFESSIONAL_STATUSES, 'DRAFT'] }, id: { not: row.id } },
    orderBy: { createdAt: 'desc' },
    select: { applicationNumber: true, status: true, submittedAt: true },
  });
  const openRenewal = open ? { applicationNumber: open.applicationNumber, statusLabel: publicRegistrationStatus(open.status).label, submittedOn: iso(open.submittedAt) } : null;
  const dueOn = iso(row.renewalDueDate);
  const now = new Date();

  if (openRenewal) return { state: 'IN_PROGRESS', label: `Renewal ${openRenewal.applicationNumber} is ${openRenewal.statusLabel.toLowerCase()}`, renewalDueOn: dueOn, openRenewal };
  if (!row.isCurrent || (row.status !== 'APPROVED' && row.status !== 'EXPIRED')) return { state: 'NONE', label: 'Not applicable', renewalDueOn: null, openRenewal: null };
  if (row.status === 'EXPIRED' || isLapsed(row.validTo, now)) return { state: 'LAPSED', label: 'Registration has lapsed — a renewal can be filed', renewalDueOn: dueOn, openRenewal: null };
  if (row.renewalDueDate && dayOf(now).getTime() >= dayOf(row.renewalDueDate).getTime()) return { state: 'DUE', label: 'Renewal is open', renewalDueOn: dueOn, openRenewal: null };
  return { state: 'NOT_DUE', label: row.renewalDueDate ? `Not due until ${dayOf(row.renewalDueDate).toISOString().slice(0, 10)}` : 'Not due', renewalDueOn: dueOn, openRenewal: null };
}

export type PublicLtpProfile = {
  registrationNumber: string | null;
  applicationNumber: string;
  kindLabel: string;
  name: string;
  typeLabel: string;
  registrationBody: string;
  qualification: string;
  experienceYears: number | null;
  organization: string;
  district: string;
  status: string;
  statusLabel: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  submittedOn: string | null;
  decidedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysToExpiry: number | null;
  renewal: PublicRenewalState;
  /** Building permissions issued on files this professional held. Null when no portal account is linked. */
  permissionsIssued: number | null;
};

async function shapeLtp(row: ProfessionalRow, types: ProfessionalTypeOption[]): Promise<PublicLtpProfile> {
  const status = effectiveStatus(row.status, row.validTo);
  const meta = publicRegistrationStatus(status);
  const [renewal, issued] = await Promise.all([
    professionalRenewalState(row),
    row.userId
      ? prisma.application.count({ where: { deletedAt: null, ltpUserId: row.userId, approvalOrder: { status: 'ISSUED' } } })
      : Promise.resolve(null),
  ]);
  return {
    registrationNumber: row.registrationNumber,
    applicationNumber: row.applicationNumber,
    kindLabel: row.kind === 'RENEWAL' ? 'Renewal' : 'New registration',
    name: row.name,
    typeLabel: types.find((t) => t.code === row.professionalType)?.label ?? row.professionalType,
    registrationBody: row.registrationBody,
    qualification: row.qualification,
    experienceYears: row.experienceYears,
    organization: row.organization,
    district: row.district,
    status,
    statusLabel: meta.label,
    tone: meta.tone,
    submittedOn: iso(row.submittedAt),
    decidedOn: iso(row.decidedAt),
    validFrom: iso(row.validFrom),
    validTo: iso(row.validTo),
    daysToExpiry: row.validTo && status === 'APPROVED' ? daysUntil(row.validTo, new Date()) : null,
    renewal,
    permissionsIssued: issued,
  };
}

/** By registration number (the LTP view) or application number (a status check). Drafts do not exist. */
export async function getPublicLtp(reference: string): Promise<PublicLtpProfile | null> {
  const found = await findLtpRow(reference);
  return found ? shapeLtp(found.row, found.types) : null;
}

export type PublicLtpRenewal = PublicLtpProfile & {
  registrationId: string;
  blocker: string | null;
  /** The registration is only valid to the licence's own end; the form asks for the licence's new validity. */
  licenceValidTo: string | null;
};

export async function getPublicLtpRenewal(registrationNumber: string): Promise<PublicLtpRenewal | null> {
  const found = await findLtpRow(registrationNumber, { currentOnly: true });
  if (!found) return null;
  const { row, types } = found;
  const profile = await shapeLtp(row, types);
  const open = await prisma.professionalRegistration.findFirst({
    where: { lineageId: row.lineageId, kind: 'RENEWAL', status: { notIn: [...CLOSED_PROFESSIONAL_STATUSES] }, id: { not: row.id } },
    select: { applicationNumber: true },
  });
  const blocker = professionalRenewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: open?.applicationNumber ?? null, now: new Date() });
  return { ...profile, registrationId: row.id, blocker, licenceValidTo: iso(row.licenceValidTo) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Town Planning Assistants
// ═══════════════════════════════════════════════════════════════════════════

export type PublicTpaRow = { name: string; designation: string; zone: string; office: string };
export type TpaListQuery = { q?: string; zone?: string; page?: number; pageSize?: number };

/**
 * The Town Planning Assistants serving each zone.
 *
 * These are departmental officers, so the public list is the thinnest of the
 * three: a name, the designation they hold, and where they sit. No email, no
 * phone, no employee code, no account state — only ACTIVE, undeleted accounts,
 * and never an administrator's all-roles account.
 */
export async function listPublicTpas(query: TpaListQuery = {}): Promise<Paged<PublicTpaRow> & { zones: { code: string; name: string }[] }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 10));
  const q = query.q?.trim();

  const and: Prisma.UserWhereInput[] = [
    { status: 'ACTIVE', deletedAt: null },
    { roles: { some: { role: { key: ROLES.TPA } } } },
    { roles: { none: { role: { key: ROLES.SYSTEM_ADMIN } } } },
  ];
  if (q) and.push({ name: { contains: q, mode: 'insensitive' } });
  if (query.zone) and.push({ OR: [{ primaryZone: { code: query.zone } }, { jurisdictions: { some: { zone: { code: query.zone } } } }] });
  const where: Prisma.UserWhereInput = { AND: and };

  const [total, rows, zones] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { name: true, designation: true, primaryZone: { select: { name: true } }, office: { select: { name: true } } },
    }),
    prisma.zone.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { code: true, name: true } }),
  ]);

  const result = paged(
    rows.map((u) => ({ name: u.name, designation: u.designation || 'Town Planning Assistant', zone: u.primaryZone?.name ?? '', office: u.office?.name ?? '' })),
    total,
    page,
    pageSize
  );
  return { ...result, zones };
}
