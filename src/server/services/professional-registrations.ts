import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { can, type AuthUser } from '@/server/auth/context';
import { badRequest, businessRule, conflict, forbidden, isApiError, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import {
  CLOSED_PROFESSIONAL_STATUSES,
  CONSENT_TEXT,
  DEFAULT_PROFESSIONAL_TYPES,
  DEFAULT_PROFESSIONAL_RENEWAL_WINDOW_DAYS,
  DEFAULT_PROFESSIONAL_VALIDITY_YEARS,
  PROFESSIONAL_APPLICATION_PREFIX,
  PROFESSIONAL_DOCUMENTS,
  PROFESSIONAL_DOCUMENT_LABEL,
  PROFESSIONAL_NEXT_STEPS,
  PROFESSIONAL_REGISTERS,
  PROFESSIONAL_RENEWAL_WINDOW_SETTING,
  PROFESSIONAL_STEP_CAPABILITY,
  PROFESSIONAL_STEP_FROM,
  PROFESSIONAL_TYPE_CATEGORY,
  PROFESSIONAL_VALIDITY_SETTING,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
  computeProfessionalValidity,
  dayOf,
  isAvailableForApplications,
  isLapsed,
  isProfessionalDocumentKind,
  isProfessionalOpen,
  latestProfessionalDocuments,
  missingProfessionalDocuments,
  professionalProblems,
  professionalRenewalBlocker,
  typeOption,
  unverifiedRequired,
  type ProfessionalDocument,
  type ProfessionalDocumentKind,
  type ProfessionalRegister,
  type ProfessionalStatus,
  type ProfessionalStep,
  type ProfessionalTypeOption,
} from '@/lib/professional-registration';
import type {
  ProfessionalDecideInput,
  ProfessionalDocumentCheckInput,
  ProfessionalDraftInput,
  ProfessionalRemarksInput,
  ProfessionalRenewInput,
  ProfessionalRespondInput,
  ProfessionalShortfallInput,
  ProfessionalTypeInput,
  ProfessionalVerifyInput,
  UpdateProfessionalTypeInput,
} from '@/lib/schemas/professional-registration';
import { PUBLIC_APPLICANT_ROLE, isPublicApplicant } from '@/server/public-portal/actor';
import { createOutwardEntry } from '@/server/proceedings/engine';
import { renderDemoAttachment } from '@/server/proceedings/documents';
import { formatNumber, nextSequence } from './numbering';
import { settingNumber } from './settings';
import { roleTitle } from './show-cause';
import { storeUpload } from './files';
import { audit } from './audit';

/**
 * THE PROFESSIONAL REGISTRATION SERVICE.
 *
 *   Register desk: open a draft, submit it, record the answer to a shortfall, renew
 *   Verify desk:   take it up, verify or reject each document, raise a
 *                  shortfall, verify the registration
 *   Decide desk:   approve (registration number, validity, Outward letter) │ reject
 *   Sweep:         an approved registration past its validity becomes EXPIRED
 *
 * And, for applications: which approved professionals may be named on a file
 * (`availableProfessionals`, `requireAvailable`). A professional who signs in
 * is linked by `userId` to their existing account — never copied.
 *
 * Every step moves the row only from the status it starts at (a conditional
 * update), and writes an event and a hash-chained audit row in the same
 * transaction. Nothing is deleted.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
type Actor = { id: string; name: string };
export type Upload = { name: string; type: string; bytes: Buffer };
export type ProfessionalUploads = Partial<Record<ProfessionalDocumentKind, Upload>>;
type Offer = { offered: boolean; available: boolean; reason: string };

const NONE: Offer = { offered: false, available: false, reason: '' };
const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';
const ENTITY = 'ProfessionalRegistration';

const docs = (v: unknown): ProfessionalDocument[] => (Array.isArray(v) ? (v as ProfessionalDocument[]) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const today = () => dayOf(new Date());

/**
 * The moment each step is taken at — real time, except while the demo seed
 * builds a registration's past (`withProfessionalClock`), as for developers.
 * Audit rows always record when they were actually written.
 */
let clock: () => Date = () => new Date();

export async function withProfessionalClock<T>(at: Date, fn: () => Promise<T>): Promise<T> {
  if (env.isProduction) throw new Error('The LTP clock can only be set by the demo seed.');
  const previous = clock;
  clock = () => new Date(at.getTime());
  try {
    return await fn();
  } finally {
    clock = previous;
  }
}

async function allocate(tx: Tx, prefix: string, now: Date) {
  const year = now.getFullYear();
  return formatNumber(NUMBER_FORMAT, { prefix, year, seq: await nextSequence(tx, `${prefix}-${year}`) });
}

// ═══════════════════════════════════════════════════════════════════════════
// Types (configuration)
// ═══════════════════════════════════════════════════════════════════════════

export async function professionalTypes(opts: { activeOnly?: boolean } = {}): Promise<ProfessionalTypeOption[]> {
  const rows = await prisma.masterData.findMany({
    where: { category: PROFESSIONAL_TYPE_CATEGORY, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
  });
  if (rows.length === 0) {
    return DEFAULT_PROFESSIONAL_TYPES.map(t => typeOption({ code: t.code, label: t.label, isActive: true, metadata: t.metadata }));
  }
  return rows.map(r => typeOption(r as any));
}

const typeCodes = async (pred: (t: ProfessionalTypeOption) => boolean) => (await professionalTypes()).filter(pred).map((t) => t.code);

// ═══════════════════════════════════════════════════════════════════════════
// Access and desks
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.LTP_REG_VIEW)) throw forbidden('Your role does not include the LTP register.');
}

async function actingRole(user: AuthUser, step: ProfessionalStep): Promise<string | null> {
  const capability = PROFESSIONAL_STEP_CAPABILITY[step];
  if (!can(user, capability)) return null;
  // The public portal's applicant has no account and no role. Its steps are recorded as the
  // applicant's own, not as the inward desk that keys applications in — see public-portal/actor.ts.
  if (isPublicApplicant(user)) return PUBLIC_APPLICANT_ROLE;
  const role = await prisma.role.findFirst({
    where: { key: { in: user.roleKeys }, permissions: { some: { permission: { key: capability } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return role?.key ?? null;
}

async function requireRole(user: AuthUser, step: ProfessionalStep) {
  const roleKey = await actingRole(user, step);
  if (!roleKey) throw forbidden('This step of an LTP registration is not your desk’s.');
  return roleKey;
}

async function deskFor(tx: Tx, status: ProfessionalStatus): Promise<string> {
  const steps = PROFESSIONAL_NEXT_STEPS[status];
  if (!steps.length) return '';
  const caps = [...new Set(steps.map((s) => PROFESSIONAL_STEP_CAPABILITY[s]))];
  const roles = await tx.role.findMany({
    where: { key: { not: ROLES.SYSTEM_ADMIN }, permissions: { some: { permission: { key: { in: caps } } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return roles.map((r) => r.key).join(',');
}

function deskLabel(roleKeys: string, status: string) {
  if (!isProfessionalOpen(status)) return 'Closed';
  const keys = roleKeys.split(',').filter(Boolean);
  return keys.length ? keys.map(roleTitle).join(' / ') : '—';
}

async function requireRow(id: string) {
  if (!isUuid(id)) throw notFound('That LTP registration could not be found.');
  const row = await prisma.professionalRegistration.findUnique({ where: { id } });
  if (!row) throw notFound('That LTP registration could not be found.');
  return row;
}

type Row = Awaited<ReturnType<typeof requireRow>>;

// ═══════════════════════════════════════════════════════════════════════════
// Moving a registration
// ═══════════════════════════════════════════════════════════════════════════

async function event(tx: Tx, registrationId: string, action: string, fromStatus: string, toStatus: string, actor: Actor | null, roleKey: string, remarks: string, now: Date) {
  await tx.professionalRegistrationEvent.create({
    data: { registrationId, action, fromStatus, toStatus, actorId: actor?.id ?? null, actorName: actor?.name ?? 'System', actorRoleKey: roleKey || 'SYSTEM', remarks, occurredAt: now },
  });
}

type Move = {
  row: { id: string; applicationNumber: string; registrationNumber: string | null };
  from: ProfessionalStatus;
  to: ProfessionalStatus;
  data?: Prisma.ProfessionalRegistrationUpdateManyMutationInput;
  eventAction: string;
  auditAction: string;
  actor: Actor | null;
  roleKey: string;
  remarks: string;
  now: Date;
  meta: Meta;
  after?: Record<string, unknown>;
};

async function move(tx: Tx, m: Move) {
  const desk = await deskFor(tx, m.to);
  const { count } = await tx.professionalRegistration.updateMany({
    where: { id: m.row.id, status: m.from },
    data: { ...m.data, status: m.to, currentDeskRoleKey: desk },
  });
  if (!count) throw conflict('Somebody else acted on this registration just now. Reload to see what changed.', 'STALE_WRITE');
  await event(tx, m.row.id, m.eventAction, m.from, m.to, m.actor, m.roleKey, m.remarks, m.now);
  await audit(tx, {
    actor: m.actor ? { id: m.actor.id, name: m.actor.name, roleKeys: [m.roleKey] } : undefined,
    action: m.auditAction,
    entityType: ENTITY,
    entityId: m.row.id,
    before: { status: m.from },
    after: { status: m.to, applicationNumber: m.row.applicationNumber, registrationNumber: m.row.registrationNumber, nextDesk: desk, ...m.after },
    remarks: m.remarks,
    ...m.meta,
  });
  return { id: m.row.id, applicationNumber: m.row.applicationNumber, status: m.to };
}

async function precheck(user: AuthUser, id: string, step: Exclude<ProfessionalStep, 'RENEW'>, expectedStatus?: string) {
  requireView(user);
  const roleKey = await requireRole(user, step);
  const row = await requireRow(id);
  if (expectedStatus && expectedStatus !== row.status) throw conflict('This registration has moved on. Reload to see where it stands.', 'STALE_WRITE');
  if (row.status !== PROFESSIONAL_STEP_FROM[step]) {
    throw conflict(`This step is not open while the registration is ${row.status.toLowerCase().replace(/_/g, ' ')}.`);
  }
  return { row, roleKey };
}

// ═══════════════════════════════════════════════════════════════════════════
// Expiry
// ═══════════════════════════════════════════════════════════════════════════

let lastSweep = 0;

/** Current APPROVED registrations past their validity become EXPIRED, each audited. Idempotent. */
export async function expireLapsedProfessionalRegistrations(now = new Date()) {
  const lapsed = await prisma.professionalRegistration.findMany({
    where: { isCurrent: true, status: 'APPROVED', validTo: { lt: dayOf(now) } },
    select: { id: true, applicationNumber: true, registrationNumber: true, validTo: true, cappedByLicence: true },
  });
  let expired = 0;
  for (const row of lapsed) {
    try {
      await prisma.$transaction(
        (tx) =>
          move(tx, {
            row,
            from: 'APPROVED',
            to: 'EXPIRED',
            data: { expiredAt: now },
            eventAction: 'EXPIRED',
            auditAction: 'PROFESSIONAL_REGISTRATION_EXPIRED',
            actor: null,
            roleKey: 'SYSTEM',
            remarks: `Validity ended on ${row.validTo!.toISOString().slice(0, 10)}${row.cappedByLicence ? ', with the licence' : ''}.`,
            now,
            meta: { ip: '', userAgent: 'professional-expiry-sweep' },
          }),
        TX_LIMITS
      );
      expired += 1;
    } catch (error) {
      if (!(isApiError(error) && error.code === 'STALE_WRITE')) throw error;
    }
  }
  return { examined: lapsed.length, expired };
}

async function sweepIfDue() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  await expireLapsedProfessionalRegistrations().catch((error) => {
    lastSweep = 0;
    console.error('[professionals] expiry sweep failed', error);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The registers
// ═══════════════════════════════════════════════════════════════════════════

const OPEN_RENEWAL: Prisma.ProfessionalRegistrationWhereInput = { kind: 'RENEWAL', status: { notIn: [...CLOSED_PROFESSIONAL_STATUSES] } };

function registerWhere(register: ProfessionalRegister): Prisma.ProfessionalRegistrationWhereInput {
  switch (register) {
    case 'ALL':
      return { isCurrent: true };
    case 'PENDING':
      return { status: 'SUBMITTED' };
    case 'IN_PROCESS':
      return { status: 'IN_PROCESS' };
    case 'SHORTFALL':
      return { status: 'SHORTFALL' };
    case 'VERIFIED':
      return { status: 'VERIFIED' };
    case 'REJECTED':
      return { status: 'REJECTED' };
    case 'EXPIRED':
      return { isCurrent: true, status: 'EXPIRED' };
    case 'RENEWAL':
      return { OR: [{ isCurrent: true, status: 'APPROVED', renewalDueDate: { lte: today() } }, { isCurrent: true, status: 'EXPIRED' }, OPEN_RENEWAL] };
  }
}

export type ProfessionalListQuery = { register?: ProfessionalRegister; q?: string; type?: string; status?: string; page?: number; pageSize?: number };

export async function listProfessionalRegistrations(user: AuthUser, query: ProfessionalListQuery = {}) {
  requireView(user);
  await sweepIfDue();
  const and: Prisma.ProfessionalRegistrationWhereInput[] = [registerWhere(query.register ?? 'ALL')];
  if (query.type) and.push({ professionalType: query.type });
  if (query.status) and.push({ status: query.status });
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: 'insensitive' } },
        { registrationNumber: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { licenceNo: { contains: q, mode: 'insensitive' } },
        { organization: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where = { AND: and };
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const [total, rows, types] = await Promise.all([
    prisma.professionalRegistration.count({ where }),
    prisma.professionalRegistration.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { email: true } } } }),
    professionalTypes(),
  ]);
  const openRenewals = await prisma.professionalRegistration.findMany({
    where: { ...OPEN_RENEWAL, lineageId: { in: [...new Set(rows.map((r) => r.lineageId))] } },
    select: { id: true, lineageId: true, applicationNumber: true, status: true },
  });
  const now = new Date();
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => {
      const renewal = r.isCurrent ? openRenewals.find((o) => o.lineageId === r.lineageId && o.id !== r.id) : undefined;
      return {
        id: r.id,
        applicationNumber: r.applicationNumber,
        registrationNumber: r.registrationNumber ?? '',
        kind: r.kind,
        professionalType: r.professionalType,
        typeLabel: types.find((t) => t.code === r.professionalType)?.label ?? r.professionalType,
        name: r.name,
        licenceNo: r.licenceNo,
        organization: r.organization,
        account: r.user?.email ?? '',
        status: r.status,
        isCurrent: r.isCurrent,
        submittedAt: r.submittedAt,
        validTo: r.validTo,
        renewalDueDate: r.renewalDueDate,
        renewalDue: r.isCurrent && r.status === 'APPROVED' && Boolean(r.renewalDueDate && r.renewalDueDate.getTime() <= today().getTime()),
        available: isAvailableForApplications(r, now),
        openRenewal: renewal ? { id: renewal.id, applicationNumber: renewal.applicationNumber, status: renewal.status } : null,
        currentDesk: deskLabel(r.currentDeskRoleKey, r.status),
      };
    }),
  };
}

export async function professionalRegisterSummary(user: AuthUser) {
  requireView(user);
  const counts = await Promise.all(PROFESSIONAL_REGISTERS.map((r) => prisma.professionalRegistration.count({ where: registerWhere(r) })));
  const available = await prisma.professionalRegistration.count({ where: { isCurrent: true, status: 'APPROVED', validTo: { gte: today() } } });
  return { ...(Object.fromEntries(PROFESSIONAL_REGISTERS.map((r, i) => [r, counts[i]])) as Record<ProfessionalRegister, number>), AVAILABLE: available };
}

// ═══════════════════════════════════════════════════════════════════════════
// One registration
// ═══════════════════════════════════════════════════════════════════════════

async function openRenewalOf(lineageId: string, exceptId: string) {
  return prisma.professionalRegistration.findFirst({ where: { ...OPEN_RENEWAL, lineageId, id: { not: exceptId } }, select: { id: true, applicationNumber: true } });
}

async function offer(user: AuthUser, step: Exclude<ProfessionalStep, 'RENEW'>, status: string, blocker: string | null = null): Promise<Offer> {
  if (status !== PROFESSIONAL_STEP_FROM[step]) return NONE;
  if (!(await actingRole(user, step))) return NONE;
  return { offered: true, available: !blocker, reason: blocker ?? '' };
}

async function submitBlocker(row: Row, types: ProfessionalTypeOption[]) {
  const problems = professionalProblems(row, types, clock());
  if (Object.keys(problems).length) return `Complete the particulars first: ${Object.values(problems).join(' ')}`;
  const missing = missingProfessionalDocuments([...latestProfessionalDocuments(docs(row.documents)).keys()]);
  if (missing.length) return `Attach the ${missing.map((k) => PROFESSIONAL_DOCUMENT_LABEL[k].toLowerCase()).join('; the ')}.`;
  return accountProblem(row, types);
}

/** A linked account must be an active LTP account, and must carry the same licence if it carries one. */
async function accountProblem(row: { userId: string | null; licenceNo: string; professionalType: string }, types: ProfessionalTypeOption[]) {
  if (!row.userId) return null;
  const type = types.find((t) => t.code === row.professionalType);
  if (type && !type.canHoldFile) return `A ${type.label.toLowerCase()} does not hold files, so no portal account is linked.`;
  const u = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { status: true, deletedAt: true, ltpLicenceNo: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!u || u.deletedAt || u.status !== 'ACTIVE') return 'The linked portal account is not active.';
  if (!u.roles.some((r) => r.role.key === ROLES.LTP)) return 'The linked portal account is not an LTP’s account.';
  if (u.ltpLicenceNo && row.licenceNo && u.ltpLicenceNo.trim().toUpperCase() !== row.licenceNo.trim().toUpperCase()) {
    return `The linked account holds licence ${u.ltpLicenceNo}, not ${row.licenceNo}.`;
  }
  return null;
}

export async function getProfessionalRegistration(user: AuthUser, id: string) {
  requireView(user);
  await sweepIfDue();
  const row = await requireRow(id);
  const [events, chain, openRenewal, types, account, filesNamed] = await Promise.all([
    prisma.professionalRegistrationEvent.findMany({ where: { registrationId: row.id }, orderBy: { occurredAt: 'desc' } }),
    prisma.professionalRegistration.findMany({
      where: { lineageId: row.lineageId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, applicationNumber: true, kind: true, status: true, isCurrent: true, validFrom: true, validTo: true, decidedAt: true, createdAt: true },
    }),
    openRenewalOf(row.lineageId, row.id),
    professionalTypes(),
    row.userId ? prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, name: true, email: true, ltpLicenceNo: true } }) : null,
    // Where applications name this professional — any registration of the lineage.
    prisma.professionalRegistration
      .findMany({ where: { lineageId: row.lineageId }, select: { id: true } })
      .then((l) => l.map((r) => r.id))
      .then((ids) => prisma.applicant.count({ where: { OR: [{ ltpRegistrationId: { in: ids } }, { structuralEngineerRegistrationId: { in: ids } }] } })),
  ]);

  const renewRole = await actingRole(user, 'RENEW');
  const renewBlock = professionalRenewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: openRenewal?.applicationNumber ?? null, now: new Date() });
  const renew: Offer =
    renewRole && (row.status === 'APPROVED' || row.status === 'EXPIRED') && row.isCurrent ? { offered: true, available: !renewBlock, reason: renewBlock ?? '' } : NONE;

  const pendingDocs = unverifiedRequired(docs(row.documents));
  const blocker = row.status === 'DRAFT' ? await submitBlocker(row, types) : null;
  const [edit, submit, takeUp, checkDocument, shortfall, respond, verify, decide] = await Promise.all([
    offer(user, 'EDIT', row.status),
    offer(user, 'SUBMIT', row.status, blocker),
    offer(user, 'TAKE_UP', row.status),
    offer(user, 'CHECK_DOCUMENT', row.status),
    offer(user, 'SHORTFALL', row.status),
    offer(user, 'RESPOND', row.status),
    offer(user, 'VERIFY', row.status),
    offer(user, 'DECIDE', row.status),
  ]);
  const type = types.find((t) => t.code === row.professionalType);

  return {
    registration: {
      ...row,
      documents: docs(row.documents),
      shortfallItems: strings(row.shortfallItems),
      currentDesk: deskLabel(row.currentDeskRoleKey, row.status),
      typeLabel: type?.label ?? row.professionalType,
      renewalDue: row.isCurrent && row.status === 'APPROVED' && Boolean(row.renewalDueDate && row.renewalDueDate.getTime() <= today().getTime()),
      available: isAvailableForApplications(row, new Date()),
    },
    type: type ?? null,
    account,
    filesNamed,
    requiredDocuments: [...REQUIRED_PROFESSIONAL_DOCUMENTS],
    unverifiedDocuments: pendingDocs,
    submitBlocker: blocker,
    openRenewal,
    chain,
    events,
    consentText: CONSENT_TEXT,
    permissions: { edit, submit, takeUp, checkDocument, shortfall, respond, verify, decide, renew, demoAllowed: env.demoMode },
  };
}

/** Portal accounts a registration may be linked to: active LTP accounts, with any registration they already hold. */
export async function linkableAccounts(user: AuthUser) {
  if (!can(user, CAPABILITIES.LTP_REG_REGISTER)) throw forbidden('Only the registering desk links accounts.');
  const users = await prisma.user.findMany({
    // Administrators' all-roles accounts hold LTP too; they are not professionals.
    where: { status: 'ACTIVE', deletedAt: null, AND: [{ roles: { some: { role: { key: ROLES.LTP } } } }, { roles: { none: { role: { key: ROLES.SYSTEM_ADMIN } } } }] },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, ltpLicenceNo: true, professionalRegistrations: { where: { isCurrent: true }, select: { professionalType: true, registrationNumber: true, status: true } } },
    take: 200,
  });
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email, licenceNo: u.ltpLicenceNo ?? '', registrations: u.professionalRegistrations }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents — stored BEFORE the transaction
// ═══════════════════════════════════════════════════════════════════════════

async function storeDocuments(registrationId: string, user: AuthUser, uploads: ProfessionalUploads, demoKinds: ProfessionalDocumentKind[], round: number) {
  if (demoKinds.length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const now = clock().toISOString();
  const out: ProfessionalDocument[] = [];
  const fresh = { status: 'UPLOADED' as const, verifyRemarks: '', verifiedByName: '', verifiedAt: null };
  for (const kind of PROFESSIONAL_DOCUMENTS) {
    const file = uploads[kind];
    if (file) {
      const stored = await storeUpload({
        applicationId: registrationId,
        root: 'professional-registrations',
        kind: 'professionals',
        file,
        uploadedById: user.id,
        allowedExtensions: DOCUMENT_EXTENSIONS,
        maxBytes: MAX_BYTES,
      });
      out.push({ kind, fileObjectId: stored.id, fileName: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, isDemo: false, addedAt: now, addedByName: user.name, round, ...fresh });
    } else if (demoKinds.includes(kind)) {
      out.push({ kind, fileObjectId: null, fileName: `${kind.toLowerCase().replace(/_/g, '-')}-DEMO.pdf`, mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: now, addedByName: user.name, round, ...fresh });
    }
  }
  return out;
}

const demoKindsOf = (input: { demoDocuments: boolean; demoKinds: string }, uploads: ProfessionalUploads) =>
  input.demoDocuments ? input.demoKinds.split(',').map((k) => k.trim()).filter(isProfessionalDocumentKind).filter((k) => !uploads[k]) : [];

function particularsOf(input: ProfessionalDraftInput, now: Date) {
  return {
    professionalType: input.professionalType,
    name: input.name,
    userId: input.userId,
    licenceNo: input.licenceNo,
    registrationBody: input.registrationBody,
    qualification: input.qualification,
    experienceYears: input.experienceYears,
    organization: input.organization,
    address: input.address,
    district: input.district,
    pincode: input.pincode,
    mobile: input.mobile,
    email: input.email,
    licenceValidFrom: input.licenceValidFrom ? new Date(input.licenceValidFrom) : null,
    licenceValidTo: input.licenceValidTo ? new Date(input.licenceValidTo) : null,
    consentGiven: input.consentGiven,
    consentText: input.consentGiven ? CONSENT_TEXT : '',
    consentAt: input.consentGiven ? now : null,
  };
}

async function requireKnownType(code: string) {
  const types = await professionalTypes();
  const t = types.find((x) => x.code === code);
  if (!t) throw badRequest('Choose the LTP type.', [{ path: 'professionalType', message: 'Unknown LTP type.' }]);
  return { types, type: t };
}

// ═══════════════════════════════════════════════════════════════════════════
// Register desk
// ═══════════════════════════════════════════════════════════════════════════

export async function createProfessionalDraft(user: AuthUser, input: ProfessionalDraftInput & { uploads?: ProfessionalUploads }, meta: Meta) {
  requireView(user);
  const roleKey = await requireRole(user, 'EDIT');
  const { type } = await requireKnownType(input.professionalType);
  if (!type.isActive) throw badRequest('That LTP type is no longer registered.');
  const id = randomUUID();
  const uploads = input.uploads ?? {};
  const documents = await storeDocuments(id, user, uploads, demoKindsOf(input, uploads), 1);
  const now = clock();
  return prisma.$transaction(async (tx) => {
    const applicationNumber = await allocate(tx, PROFESSIONAL_APPLICATION_PREFIX, now);
    await tx.professionalRegistration.create({
      data: {
        id,
        applicationNumber,
        kind: 'NEW',
        lineageId: id,
        status: 'DRAFT',
        ...particularsOf(input, now),
        documents: documents as never,
        currentDeskRoleKey: await deskFor(tx, 'DRAFT'),
        createdById: user.id,
        createdByName: user.name,
        createdAt: now,
      },
    });
    await event(tx, id, 'DRAFT_OPENED', '', 'DRAFT', user, roleKey, 'Registration application opened.', now);
    await audit(tx, {
      actor: { id: user.id, name: user.name, roleKeys: [roleKey] },
      action: 'PROFESSIONAL_REGISTRATION_DRAFTED',
      entityType: ENTITY,
      entityId: id,
      after: {
        applicationNumber,
        status: 'DRAFT',
        name: input.name,
        professionalType: input.professionalType,
        licenceNo: input.licenceNo,
        linkedAccount: input.userId,
        consentGiven: input.consentGiven,
        documents: documents.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })),
      },
      ...meta,
    });
    return { id, applicationNumber, status: 'DRAFT' as const };
  }, TX_LIMITS);
}

export async function updateProfessionalDraft(user: AuthUser, id: string, input: ProfessionalDraftInput & { uploads?: ProfessionalUploads }, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'EDIT', input.expectedStatus);
  await requireKnownType(input.professionalType);
  const uploads = input.uploads ?? {};
  const added = await storeDocuments(row.id, user, uploads, demoKindsOf(input, uploads), 1);
  const now = clock();
  const next = particularsOf(input, row.consentAt ?? now);
  const keys = (Object.keys(next) as (keyof typeof next)[]).filter((k) => k !== 'consentAt' && k !== 'consentText');
  const changed = keys.filter((k) => String(next[k] ?? '') !== String((row as Record<string, unknown>)[k] ?? ''));
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.professionalRegistration.updateMany({
      where: { id: row.id, status: 'DRAFT', updatedAt: row.updatedAt },
      data: { ...next, consentAt: input.consentGiven ? row.consentAt ?? now : null, documents: [...docs(row.documents), ...added] as never },
    });
    if (!count) throw conflict('Somebody else changed this draft just now. Reload to see what changed.', 'STALE_WRITE');
    await audit(tx, {
      actor: { id: user.id, name: user.name, roleKeys: [roleKey] },
      action: 'PROFESSIONAL_REGISTRATION_DRAFT_UPDATED',
      entityType: ENTITY,
      entityId: row.id,
      before: Object.fromEntries(changed.map((k) => [k, (row as Record<string, unknown>)[k]])),
      after: { ...Object.fromEntries(changed.map((k) => [k, next[k]])), documentsAdded: added.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })) },
      ...meta,
    });
    if (changed.length || added.length) {
      const what = [changed.length ? `${changed.length} particular${changed.length === 1 ? '' : 's'}` : '', added.length ? `${added.length} document${added.length === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(' and ');
      await event(tx, row.id, 'DRAFT_UPDATED', 'DRAFT', 'DRAFT', user, roleKey, `Draft updated — ${what}.`, now);
    }
    return { id: row.id, applicationNumber: row.applicationNumber, status: 'DRAFT' as const };
  }, TX_LIMITS);
}

export async function submitProfessionalRegistration(user: AuthUser, id: string, input: ProfessionalRemarksInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'SUBMIT', input.expectedStatus);
  const types = await professionalTypes();
  const problems = professionalProblems(row, types, clock());
  if (Object.keys(problems).length) {
    throw businessRule('The particulars are not complete.', Object.entries(problems).map(([path, message]) => ({ path, message })));
  }
  const blocked = await submitBlocker(row, types);
  if (blocked) throw businessRule(blocked);
  // One live registration per licence per type, and per account per type:
  // the same professional is renewed, never registered twice.
  const clash = await prisma.professionalRegistration.findFirst({
    where: {
      professionalType: row.professionalType,
      lineageId: { not: row.lineageId },
      isCurrent: true,
      status: { notIn: ['DRAFT', 'REJECTED', 'EXPIRED'] },
      OR: [{ licenceNo: { equals: row.licenceNo, mode: 'insensitive' } }, ...(row.userId ? [{ userId: row.userId }] : [])],
    },
    select: { applicationNumber: true, registrationNumber: true },
  });
  if (clash) throw conflict(`This LTP is already on ${clash.registrationNumber ?? clash.applicationNumber}. Renew or amend that registration instead.`);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'DRAFT',
        to: 'SUBMITTED',
        data: { submittedById: user.id, submittedByName: user.name, submittedAt: now },
        eventAction: 'SUBMITTED',
        auditAction: 'PROFESSIONAL_REGISTRATION_SUBMITTED',
        actor: user,
        roleKey,
        remarks: input.remarks || (row.kind === 'RENEWAL' ? 'Renewal application submitted.' : 'Registration application submitted.'),
        now,
        meta,
        after: { kind: row.kind, documents: docs(row.documents).length },
      }),
    TX_LIMITS
  );
}

export async function respondProfessionalShortfall(user: AuthUser, id: string, input: ProfessionalRespondInput & { uploads?: ProfessionalUploads }, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'RESPOND', input.expectedStatus);
  const round = row.round + 1;
  const uploads = input.uploads ?? {};
  const added = await storeDocuments(row.id, user, uploads, demoKindsOf(input, uploads), round);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'SHORTFALL',
        to: 'IN_PROCESS',
        data: { round, shortfallResponse: input.remarks, shortfallRespondedAt: now, documents: [...docs(row.documents), ...added] as never },
        eventAction: 'SHORTFALL_ANSWERED',
        auditAction: 'PROFESSIONAL_REGISTRATION_SHORTFALL_ANSWERED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { round, documents: added.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })) },
      }),
    TX_LIMITS
  );
}

/** Opens a renewal carrying the registration number, particulars and verified documents forward. */
export async function renewProfessionalRegistration(user: AuthUser, id: string, input: ProfessionalRenewInput, meta: Meta) {
  requireView(user);
  const roleKey = await requireRole(user, 'RENEW');
  const row = await requireRow(id);
  const now = clock();
  const open = await openRenewalOf(row.lineageId, row.id);
  const blocked = professionalRenewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: open?.applicationNumber ?? null, now });
  if (blocked) throw conflict(blocked);
  const newId = randomUUID();
  // Carried forward UNVERIFIED: the renewal is checked afresh.
  const documents: ProfessionalDocument[] = [...latestProfessionalDocuments(docs(row.documents)).values()].map(({ doc }) => ({
    ...doc,
    round: 1,
    carriedForward: true,
    status: 'UPLOADED',
    verifyRemarks: '',
    verifiedByName: '',
    verifiedAt: null,
  }));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `professional-renewal:${row.lineageId}`);
    const again = await tx.professionalRegistration.findFirst({ where: { ...OPEN_RENEWAL, lineageId: row.lineageId }, select: { applicationNumber: true } });
    if (again) throw conflict(`Renewal ${again.applicationNumber} is already under way.`);
    const applicationNumber = await allocate(tx, PROFESSIONAL_APPLICATION_PREFIX, now);
    await tx.professionalRegistration.create({
      data: {
        id: newId,
        applicationNumber,
        kind: 'RENEWAL',
        registrationNumber: row.registrationNumber,
        lineageId: row.lineageId,
        renewalOfId: row.id,
        isCurrent: false,
        status: 'DRAFT',
        professionalType: row.professionalType,
        userId: row.userId,
        name: row.name,
        licenceNo: row.licenceNo,
        registrationBody: row.registrationBody,
        qualification: row.qualification,
        experienceYears: row.experienceYears,
        organization: row.organization,
        address: row.address,
        district: row.district,
        pincode: row.pincode,
        mobile: row.mobile,
        email: row.email,
        licenceValidFrom: row.licenceValidFrom,
        licenceValidTo: input.licenceValidTo ? new Date(input.licenceValidTo) : row.licenceValidTo,
        // Consent is given afresh for each registration.
        consentGiven: false,
        documents: documents as never,
        currentDeskRoleKey: await deskFor(tx, 'DRAFT'),
        createdById: user.id,
        createdByName: user.name,
        createdAt: now,
      },
    });
    const note = input.remarks || `Renewal of ${row.registrationNumber} opened.`;
    await event(tx, newId, 'RENEWAL_OPENED', '', 'DRAFT', user, roleKey, note, now);
    await event(tx, row.id, 'RENEWAL_OPENED', row.status, row.status, user, roleKey, `Renewal ${applicationNumber} opened.`, now);
    await audit(tx, {
      actor: { id: user.id, name: user.name, roleKeys: [roleKey] },
      action: 'PROFESSIONAL_RENEWAL_OPENED',
      entityType: ENTITY,
      entityId: newId,
      after: { applicationNumber, kind: 'RENEWAL', registrationNumber: row.registrationNumber, renewalOf: row.applicationNumber, documentsCarriedForward: documents.length },
      remarks: note,
      ...meta,
    });
    return { id: newId, applicationNumber, status: 'DRAFT' as const };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Verify desk
// ═══════════════════════════════════════════════════════════════════════════

export async function takeUpProfessionalRegistration(user: AuthUser, id: string, input: ProfessionalRemarksInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'TAKE_UP', input.expectedStatus);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'SUBMITTED',
        to: 'IN_PROCESS',
        data: { takenUpById: user.id, takenUpByName: user.name, takenUpAt: now },
        eventAction: 'TAKEN_UP',
        auditAction: 'PROFESSIONAL_REGISTRATION_TAKEN_UP',
        actor: user,
        roleKey,
        remarks: input.remarks || 'Taken up for scrutiny.',
        now,
        meta,
      }),
    TX_LIMITS
  );
}

/**
 * Verifies or rejects ONE document — the same act, and the same words, as
 * verifying a document on an application (VERIFIED / REJECTED, who, when,
 * why). Only the latest version of a kind is checked; a replaced one keeps
 * whatever was decided about it. Not a move of the registration.
 */
export async function checkProfessionalDocument(user: AuthUser, id: string, input: ProfessionalDocumentCheckInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'CHECK_DOCUMENT');
  const list = docs(row.documents);
  const doc = list[input.index];
  if (!doc) throw notFound('That document could not be found.');
  if (latestProfessionalDocuments(list).get(doc.kind)?.index !== input.index) throw conflict('A newer version of this document has been filed. Check that one.');
  if (input.decision === 'REJECTED' && input.remarks.trim().length < 5) {
    throw badRequest('Say why the document is rejected.', [{ path: 'remarks', message: 'Say why the document is rejected.' }]);
  }
  const now = clock();
  const updated = list.map((d, i) =>
    i === input.index ? { ...d, status: input.decision, verifyRemarks: input.remarks.trim(), verifiedByName: user.name, verifiedAt: now.toISOString() } : d
  );
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.professionalRegistration.updateMany({ where: { id: row.id, status: 'IN_PROCESS', updatedAt: row.updatedAt }, data: { documents: updated as never } });
    if (!count) throw conflict('Somebody else changed this registration just now. Reload to see what changed.', 'STALE_WRITE');
    const label = PROFESSIONAL_DOCUMENT_LABEL[doc.kind];
    await event(tx, row.id, input.decision === 'VERIFIED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED', 'IN_PROCESS', 'IN_PROCESS', user, roleKey, `${label}${input.remarks ? ` — ${input.remarks}` : ''}`, now);
    await audit(tx, {
      actor: { id: user.id, name: user.name, roleKeys: [roleKey] },
      action: input.decision === 'VERIFIED' ? 'PROFESSIONAL_DOCUMENT_VERIFIED' : 'PROFESSIONAL_DOCUMENT_REJECTED',
      entityType: ENTITY,
      entityId: row.id,
      before: { kind: doc.kind, status: doc.status },
      after: { kind: doc.kind, status: input.decision, fileName: doc.fileName, round: doc.round },
      remarks: input.remarks,
      ...meta,
    });
    return { id: row.id, index: input.index, status: input.decision };
  }, TX_LIMITS);
}

export async function raiseProfessionalShortfall(user: AuthUser, id: string, input: ProfessionalShortfallInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'SHORTFALL', input.expectedStatus);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'IN_PROCESS',
        to: 'SHORTFALL',
        data: { shortfallItems: input.items as never, shortfallRemarks: input.remarks, shortfallRaisedByName: user.name, shortfallRaisedAt: now, shortfallResponse: '', shortfallRespondedAt: null },
        eventAction: 'SHORTFALL_RAISED',
        auditAction: 'PROFESSIONAL_REGISTRATION_SHORTFALL_RAISED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { round: row.round, items: input.items },
      }),
    TX_LIMITS
  );
}

export async function verifyProfessionalRegistration(user: AuthUser, id: string, input: ProfessionalVerifyInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'VERIFY', input.expectedStatus);
  if (input.outcome === 'RECOMMEND_APPROVAL') {
    const pending = unverifiedRequired(docs(row.documents));
    if (pending.length) {
      throw businessRule(`Verify the ${pending.map((k) => PROFESSIONAL_DOCUMENT_LABEL[k].toLowerCase()).join('; the ')} before recommending approval.`);
    }
  }
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'IN_PROCESS',
        to: 'VERIFIED',
        data: { verificationOutcome: input.outcome, verificationRemarks: input.remarks, verifiedById: user.id, verifiedByName: user.name, verifiedByRoleKey: roleKey, verifiedAt: now },
        eventAction: 'VERIFIED',
        auditAction: 'PROFESSIONAL_REGISTRATION_VERIFIED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { outcome: input.outcome },
      }),
    TX_LIMITS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Decide desk
// ═══════════════════════════════════════════════════════════════════════════

export async function decideProfessionalRegistration(user: AuthUser, id: string, input: ProfessionalDecideInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'DECIDE', input.expectedStatus);
  const now = clock();
  const decided = { decision: input.decision, decisionRemarks: input.remarks, decidedById: user.id, decidedByName: user.name, decidedByRoleKey: roleKey, decidedAt: now };

  if (input.decision === 'REJECTED') {
    return prisma.$transaction(
      (tx) =>
        move(tx, {
          row,
          from: 'VERIFIED',
          to: 'REJECTED',
          data: decided,
          eventAction: 'REJECTED',
          auditAction: 'PROFESSIONAL_REGISTRATION_REJECTED',
          actor: user,
          roleKey,
          remarks: input.remarks,
          now,
          meta,
          after: { kind: row.kind, verificationOutcome: row.verificationOutcome },
        }),
      TX_LIMITS
    );
  }

  if (row.verificationOutcome !== 'RECOMMEND_APPROVAL' || unverifiedRequired(docs(row.documents)).length) {
    throw businessRule('Approval needs every required document verified and the verifying desk’s recommendation to approve.');
  }
  if (!row.licenceValidTo || isLapsed(row.licenceValidTo, now)) throw businessRule('The licence has lapsed. It cannot be registered until the registration body renews it.');
  const [years, windowDays, types] = await Promise.all([
    settingNumber(PROFESSIONAL_VALIDITY_SETTING, DEFAULT_PROFESSIONAL_VALIDITY_YEARS),
    settingNumber(PROFESSIONAL_RENEWAL_WINDOW_SETTING, DEFAULT_PROFESSIONAL_RENEWAL_WINDOW_DAYS),
    professionalTypes(),
  ]);
  if (!(years > 0)) throw businessRule('The registration validity setting must be a positive number of years.');
  const type = types.find((t) => t.code === row.professionalType);
  const problem = await accountProblem(row, types);
  if (problem) throw businessRule(problem);

  return prisma.$transaction(async (tx) => {
    const predecessor = row.renewalOfId
      ? await tx.professionalRegistration.findUniqueOrThrow({ where: { id: row.renewalOfId }, select: { id: true, applicationNumber: true, status: true, validTo: true } })
      : null;
    const validity = computeProfessionalValidity(now, years, windowDays, row.licenceValidTo, predecessor?.validTo);
    const registrationNumber = row.registrationNumber ?? (await allocate(tx, type?.prefix ?? 'PRF', now));

    const outward = await createOutwardEntry(
      tx,
      {
        applicationId: null,
        documentType: 'REGISTRATION_LETTER',
        documentReference: registrationNumber,
        sourceType: ENTITY,
        sourceId: row.id,
        subject: `${type?.label ?? 'LTP'} registration${row.kind === 'RENEWAL' ? ' renewed' : ''} ${registrationNumber} — ${row.name}`,
        recipient: [row.name, row.organization].filter(Boolean).join(', '),
        address: [row.address, row.district, row.pincode].filter(Boolean).join(', '),
        status: 'READY_FOR_DISPATCH',
      },
      { actor: user, roleKey, now, meta }
    );

    if (predecessor) {
      await tx.professionalRegistration.update({ where: { id: predecessor.id }, data: { isCurrent: false, supersededAt: now } });
      await event(tx, predecessor.id, 'SUPERSEDED', predecessor.status, predecessor.status, user, roleKey, `Renewed by ${row.applicationNumber}.`, now);
    }

    const r = await move(tx, {
      row,
      from: 'VERIFIED',
      to: 'APPROVED',
      data: {
        ...decided,
        registrationNumber,
        isCurrent: true,
        issueDate: validity.issueDate,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
        renewalDueDate: validity.renewalDueDate,
        validityYears: validity.validityYears,
        cappedByLicence: validity.cappedByLicence,
        outwardEntryId: outward.id,
        outwardNumber: outward.outwardNumber,
      },
      eventAction: 'APPROVED',
      auditAction: row.kind === 'RENEWAL' ? 'PROFESSIONAL_REGISTRATION_RENEWED' : 'PROFESSIONAL_REGISTRATION_APPROVED',
      actor: user,
      roleKey,
      remarks: input.remarks,
      now,
      meta,
      after: {
        registrationNumber,
        kind: row.kind,
        professionalType: row.professionalType,
        issueDate: validity.issueDate.toISOString().slice(0, 10),
        validFrom: validity.validFrom.toISOString().slice(0, 10),
        validTo: validity.validTo.toISOString().slice(0, 10),
        renewalDueDate: validity.renewalDueDate.toISOString().slice(0, 10),
        cappedByLicence: validity.cappedByLicence,
        validityYears: years,
        renewalWindowDays: windowDays,
        renewalOf: predecessor?.applicationNumber ?? null,
        outwardNumber: outward.outwardNumber,
      },
    });
    return { ...r, registrationNumber, outwardNumber: outward.outwardNumber, validTo: validity.validTo };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// For applications — who may be named on a file
// ═══════════════════════════════════════════════════════════════════════════

export type ProfessionalPurpose = 'FILE_HOLDER' | 'STRUCTURAL';

const availableWhere = (): Prisma.ProfessionalRegistrationWhereInput => ({ isCurrent: true, status: 'APPROVED', validTo: { gte: today() } });

/**
 * Approved, current, unexpired registrations an application may name.
 * FILE_HOLDER: a type that may hold a file, linked to an active LTP account
 * (the file's LTP, or the professional it is changed to). STRUCTURAL: a type
 * marked structural. The register is public: no row scope applies.
 */
export async function availableProfessionals(opts: { purpose: ProfessionalPurpose; userId?: string; excludeUserId?: string; q?: string }) {
  const codes = await typeCodes((t) => t.isActive && (opts.purpose === 'STRUCTURAL' ? t.structural : t.canHoldFile));
  if (!codes.length) return [];
  const rows = await prisma.professionalRegistration.findMany({
    where: {
      ...availableWhere(),
      professionalType: { in: codes },
      ...(opts.purpose === 'FILE_HOLDER'
        ? {
            userId: opts.userId ?? { not: null, ...(opts.excludeUserId ? { notIn: [opts.excludeUserId] } : {}) },
            user: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: ROLES.LTP } } } },
          }
        : {}),
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' as const } }, { registrationNumber: { contains: opts.q, mode: 'insensitive' as const } }, { licenceNo: { contains: opts.q, mode: 'insensitive' as const } }] } : {}),
    },
    orderBy: [{ name: 'asc' }],
    take: 200,
  });
  const types = await professionalTypes();
  return rows.map((r) => ({
    registrationId: r.id,
    registrationNumber: r.registrationNumber ?? '',
    userId: r.userId,
    professionalType: r.professionalType,
    typeLabel: types.find((t) => t.code === r.professionalType)?.label ?? r.professionalType,
    name: r.name,
    licenceNo: r.licenceNo,
    registrationBody: r.registrationBody,
    organization: r.organization,
    mobile: r.mobile,
    validTo: r.validTo,
  }));
}

/** A portal account's approved, in-force registration of a type that may hold a file — or null. */
export async function fileHoldingRegistrationOf(tx: Tx, userId: string) {
  const codes = (await professionalTypes()).filter((t) => t.isActive && t.canHoldFile).map((t) => t.code);
  if (!codes.length) return null;
  return tx.professionalRegistration.findFirst({
    where: { ...availableWhere(), userId, professionalType: { in: codes } },
    orderBy: { validTo: 'desc' },
    select: { id: true, registrationNumber: true, professionalType: true, validTo: true },
  });
}

/** The register entry an application names — refused unless it is available for that purpose today. */
export async function requireAvailable(tx: Tx, registrationId: string, purpose: ProfessionalPurpose, opts: { userId?: string } = {}) {
  const r = isUuid(registrationId) ? await tx.professionalRegistration.findUnique({ where: { id: registrationId } }) : null;
  const types = await professionalTypes();
  const type = r ? types.find((t) => t.code === r.professionalType) : undefined;
  const fits = type && (purpose === 'STRUCTURAL' ? type.structural : type.canHoldFile);
  if (!r || !fits || !isAvailableForApplications(r, new Date())) {
    throw businessRule(
      purpose === 'STRUCTURAL'
        ? 'Choose a structural engineer whose registration is approved and in force.'
        : 'Choose an LTP registration that is approved and in force.'
    );
  }
  if (purpose === 'FILE_HOLDER' && opts.userId && r.userId !== opts.userId) throw businessRule('That registration belongs to a different LTP.');
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading a document
// ═══════════════════════════════════════════════════════════════════════════

export async function readProfessionalDocument(user: AuthUser, id: string, index: number) {
  requireView(user);
  const row = await requireRow(id);
  const doc = docs(row.documents)[index];
  if (!doc) throw notFound('That document could not be found.');
  if (doc.fileObjectId) {
    const file = await prisma.fileObject.findUnique({ where: { id: doc.fileObjectId }, select: { storageKey: true, mimeType: true, scanStatus: true, originalName: true } });
    if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
      return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType, fileName: file.originalName };
    }
    throw conflict(file?.scanStatus === 'PENDING' ? 'The file is still being scanned.' : 'The file is withheld — it did not pass the virus scan.');
  }
  const html = renderDemoAttachment(doc.fileName, `${row.applicationNumber} — ${PROFESSIONAL_DOCUMENT_LABEL[doc.kind].toLowerCase()} — ${row.name}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}

// ═══════════════════════════════════════════════════════════════════════════
// Professional types (Settings → Professional Types)
// ═══════════════════════════════════════════════════════════════════════════

function requireConfigure(user: AuthUser) {
  if (!can(user, CAPABILITIES.MASTER_DATA_MANAGE)) throw forbidden('Only an administrator configures LTP types.');
}

export async function listProfessionalTypesForAdmin(user: AuthUser) {
  requireConfigure(user);
  const [rows, counts] = await Promise.all([
    prisma.masterData.findMany({ where: { category: PROFESSIONAL_TYPE_CATEGORY }, orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }] }),
    prisma.professionalRegistration.groupBy({ by: ['professionalType'], _count: { _all: true } }),
  ]);
  return rows.map((r) => ({ id: r.id, ...typeOption(r), registrations: counts.find((c) => c.professionalType === r.code)?._count._all ?? 0 }));
}

export async function createProfessionalType(user: AuthUser, input: ProfessionalTypeInput, meta: Meta) {
  requireConfigure(user);
  return prisma.$transaction(async (tx) => {
    const exists = await tx.masterData.findUnique({ where: { category_code: { category: PROFESSIONAL_TYPE_CATEGORY, code: input.code } } });
    if (exists) throw conflict(`An LTP type ${input.code} already exists.`);
    const last = await tx.masterData.aggregate({ where: { category: PROFESSIONAL_TYPE_CATEGORY }, _max: { displayOrder: true } });
    const row = await tx.masterData.create({
      data: {
        category: PROFESSIONAL_TYPE_CATEGORY,
        code: input.code,
        label: input.label,
        isActive: input.isActive,
        displayOrder: (last._max.displayOrder ?? 0) + 1,
        metadata: { prefix: input.prefix, canHoldFile: input.canHoldFile, structural: input.structural, body: input.body },
      },
    });
    await audit(tx, { actor: user, action: 'PROFESSIONAL_TYPE_CREATED', entityType: 'MasterData', entityId: row.id, after: input, ...meta });
    return typeOption(row);
  }, TX_LIMITS);
}

export async function updateProfessionalType(user: AuthUser, id: string, input: UpdateProfessionalTypeInput, meta: Meta) {
  requireConfigure(user);
  if (!isUuid(id)) throw notFound('That LTP type could not be found.');
  return prisma.$transaction(async (tx) => {
    const before = await tx.masterData.findUnique({ where: { id } });
    if (!before || before.category !== PROFESSIONAL_TYPE_CATEGORY) throw notFound('That LTP type could not be found.');
    const old = typeOption(before);
    const { label, isActive, ...meta2 } = input;
    const metadata = {
      prefix: meta2.prefix ?? old.prefix,
      canHoldFile: meta2.canHoldFile ?? old.canHoldFile,
      structural: meta2.structural ?? old.structural,
      body: meta2.body ?? old.body,
    };
    const row = await tx.masterData.update({ where: { id }, data: { ...(label ? { label } : {}), ...(isActive != null ? { isActive } : {}), metadata } });
    await audit(tx, { actor: user, action: 'PROFESSIONAL_TYPE_UPDATED', entityType: 'MasterData', entityId: id, before: old, after: typeOption(row), ...meta });
    return typeOption(row);
  }, TX_LIMITS);
}
