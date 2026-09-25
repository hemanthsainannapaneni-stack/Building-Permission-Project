import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { can, type AuthUser } from '@/server/auth/context';
import { badRequest, businessRule, conflict, forbidden, isApiError, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { ROLES } from '@/lib/constants';
import {
  CLOSED_DEVELOPER_STATUSES,
  DEFAULT_DEVELOPER_RENEWAL_WINDOW_DAYS,
  DEFAULT_DEVELOPER_VALIDITY_YEARS,
  DEVELOPER_APPLICATION_PREFIX,
  DEVELOPER_DOCUMENTS,
  DEVELOPER_DOCUMENT_LABEL,
  DEVELOPER_NEXT_STEPS,
  DEVELOPER_REGISTERS,
  DEVELOPER_REGISTRATION_PREFIX,
  DEVELOPER_RENEWAL_WINDOW_SETTING,
  DEVELOPER_STEP_CAPABILITY,
  DEVELOPER_STEP_FROM,
  DEVELOPER_STEP_TO,
  DEVELOPER_VALIDITY_SETTING,
  PENDING_DEVELOPER_STATUSES,
  computeValidity,
  dayOf,
  isDeveloperDocumentKind,
  isDeveloperAvailable,
  isDeveloperOpen,
  latestDocuments,
  missingDeveloperDocuments,
  particularsProblems,
  renewalBlocker,
  requiredDeveloperDocuments,
  type DeveloperDocument,
  type DeveloperDocumentKind,
  type DeveloperRegister,
  type DeveloperStatus,
  type DeveloperStep,
} from '@/lib/developer-registration';
import type {
  DeveloperDecideInput,
  DeveloperDraftInput,
  DeveloperRenewInput,
  DeveloperRespondInput,
  DeveloperShortfallInput,
  DeveloperSubmitInput,
  DeveloperVerifyInput,
} from '@/lib/schemas/developer-registration';
import { PUBLIC_APPLICANT_ROLE, isPublicApplicant } from '@/server/public-portal/actor';
import { createOutwardEntry } from '@/server/proceedings/engine';
import { renderDemoAttachment } from '@/server/proceedings/documents';
import { formatNumber, nextSequence } from './numbering';
import { settingNumber } from './settings';
import { roleTitle } from './show-cause';
import { storeUpload } from './files';
import { audit, entityAudit } from './audit';
import { emit, EVENTS } from '@/server/events/outbox';

/**
 * THE DEVELOPER REGISTRATION SERVICE.
 *
 *   Register desk: open a draft, submit it, record the developer's answer to
 *                  a shortfall, open a renewal
 *   Verify desk:   take it up, raise a shortfall, verify the documents
 *   Decide desk:   approve (registration number, validity, Outward letter) │ reject
 *   Sweep:         an approved registration past its validity becomes EXPIRED
 *
 * A developer registration belongs to no building permission file, so it runs
 * no file workflow. Each step checks its DEVELOPER_* capability, moves the row
 * only from the status the step starts at (a conditional update, so two
 * officers acting at once cannot both succeed), and writes an event and a
 * hash-chained audit row in the same transaction. Nothing is deleted.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
type Actor = { id: string; name: string };
export type Upload = { name: string; type: string; bytes: Buffer };
export type DeveloperUploads = Partial<Record<DeveloperDocumentKind, Upload>>;
type Offer = { offered: boolean; available: boolean; reason: string };

const NONE: Offer = { offered: false, available: false, reason: '' };
const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';
const ENTITY = 'DeveloperRegistration';

const docs = (v: unknown): DeveloperDocument[] => (Array.isArray(v) ? (v as DeveloperDocument[]) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const today = () => dayOf(new Date());

/**
 * The moment each step is taken at. Real time — except while the demo seed
 * builds a registration's past with `withDeveloperClock`, so a registration
 * approved three years ago carries that year's number, dates and events,
 * exactly as if it had been approved then. Audit rows are never affected:
 * they always record when they were actually written.
 */
let clock: () => Date = () => new Date();

export async function withDeveloperClock<T>(at: Date, fn: () => Promise<T>): Promise<T> {
  if (env.isProduction) throw new Error('The developer clock can only be set by the demo seed.');
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
// Access and desks
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, 'DEVELOPER_VIEW')) throw forbidden('Your role does not include the developer register.');
}

/** The role the step is taken in: one the caller holds that the DATABASE grants the step's capability to. */
async function actingRole(user: AuthUser, step: DeveloperStep): Promise<string | null> {
  const capability = DEVELOPER_STEP_CAPABILITY[step];
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

async function requireRole(user: AuthUser, step: DeveloperStep) {
  const roleKey = await actingRole(user, step);
  if (!roleKey) throw forbidden('This step of a developer registration is not your desk’s.');
  return roleKey;
}

/** The departmental roles holding the next step's capability, as the database grants them. */
async function deskFor(tx: Tx, status: DeveloperStatus): Promise<string> {
  const steps = DEVELOPER_NEXT_STEPS[status];
  if (!steps.length) return '';
  const caps = [...new Set(steps.map((s) => DEVELOPER_STEP_CAPABILITY[s]))];
  const roles = await tx.role.findMany({
    where: { key: { not: ROLES.SYSTEM_ADMIN }, permissions: { some: { permission: { key: { in: caps } } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return roles.map((r) => r.key).join(',');
}

function deskLabel(roleKeys: string, status: string) {
  if (!isDeveloperOpen(status)) return 'Closed';
  const keys = roleKeys.split(',').filter(Boolean);
  return keys.length ? keys.map(roleTitle).join(' / ') : '—';
}

async function requireRow(id: string) {
  if (!isUuid(id)) throw notFound('That developer registration could not be found.');
  const row = await prisma.developerRegistration.findUnique({ where: { id } });
  if (!row) throw notFound('That developer registration could not be found.');
  return row;
}

type Row = Awaited<ReturnType<typeof requireRow>>;

// ═══════════════════════════════════════════════════════════════════════════
// Moving a registration — one place, so every move is guarded and recorded
// ═══════════════════════════════════════════════════════════════════════════

async function event(tx: Tx, registrationId: string, action: string, fromStatus: string, toStatus: string, actor: Actor | null, roleKey: string, remarks: string, now: Date) {
  await tx.developerRegistrationEvent.create({
    data: {
      registrationId,
      action,
      fromStatus,
      toStatus,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? 'System',
      actorRoleKey: roleKey || 'SYSTEM',
      remarks,
      occurredAt: now,
    },
  });
}

type Move = {
  row: {
    id: string;
    applicationNumber: string;
    registrationNumber: string | null;
    /** Present on every real row (precheck's), absent only where a caller has none to give. */
    developerName?: string;
    email?: string;
    mobile?: string;
  };
  from: DeveloperStatus;
  to: DeveloperStatus;
  data?: Prisma.DeveloperRegistrationUpdateManyMutationInput;
  eventAction: string;
  auditAction: string;
  actor: Actor | null;
  roleKey: string;
  remarks: string;
  now: Date;
  meta: Meta;
  after?: Record<string, unknown>;
  /**
   * Puts one row on the outbox in the same transaction as the move, exactly
   * as the workflow engine's `notify` does for a file — see
   * src/server/events/outbox.ts and src/server/notifications/recipients.ts.
   * `assignedRoleKey` is always the DESK THE ROW MOVED TO (`desk`, computed
   * below), so "review required" always reaches wherever the row now sits.
   */
  notify?: { eventCode: string; extra?: Record<string, unknown> };
};

async function move(tx: Tx, m: Move) {
  const desk = await deskFor(tx, m.to);
  const { count } = await tx.developerRegistration.updateMany({
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
  if (m.notify) {
    await emit(tx, {
      eventCode: m.notify.eventCode,
      applicationId: null,
      payload: {
        developerRegistrationId: m.row.id,
        registrationNumber: m.row.registrationNumber || m.row.applicationNumber,
        developerName: m.row.developerName ?? '',
        contactName: m.row.developerName ?? '',
        contactEmail: m.row.email ?? '',
        contactPhone: m.row.mobile ?? '',
        assignedRoleKey: desk,
        ...m.notify.extra,
      },
    });
  }
  return { id: m.row.id, applicationNumber: m.row.applicationNumber, status: m.to };
}

/** Refuses a step that is not this caller's, or a registration that has moved on. */
async function precheck(user: AuthUser, id: string, step: Exclude<DeveloperStep, 'RENEW'>, expectedStatus?: string) {
  requireView(user);
  const roleKey = await requireRole(user, step);
  const row = await requireRow(id);
  if (expectedStatus && expectedStatus !== row.status) throw conflict('This registration has moved on. Reload to see where it stands.', 'STALE_WRITE');
  if (row.status !== DEVELOPER_STEP_FROM[step]) {
    throw conflict(`This step is not open while the registration is ${row.status.toLowerCase().replace(/_/g, ' ')}.`);
  }
  return { row, roleKey };
}

// ═══════════════════════════════════════════════════════════════════════════
// Expiry — the one move nobody takes
// ═══════════════════════════════════════════════════════════════════════════

let lastSweep = 0;

/**
 * Marks every current APPROVED registration whose validity has ended as
 * EXPIRED, each with its event and audit row (actor: system). Idempotent and
 * safe to run concurrently — the conditional update lets one caller win.
 * Run daily by the worker, and before a register is read so the register is
 * right even where no worker runs (a serverless deployment).
 */
export async function expireLapsedDeveloperRegistrations(now = new Date()) {
  const lapsed = await prisma.developerRegistration.findMany({
    where: { isCurrent: true, status: 'APPROVED', validTo: { lt: dayOf(now) } },
    select: { id: true, applicationNumber: true, registrationNumber: true, validTo: true },
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
            auditAction: 'DEVELOPER_REGISTRATION_EXPIRED',
            actor: null,
            roleKey: 'SYSTEM',
            remarks: `Validity ended on ${row.validTo!.toISOString().slice(0, 10)}.`,
            now,
            meta: { ip: '', userAgent: 'developer-expiry-sweep' },
          }),
        TX_LIMITS
      );
      expired += 1;
    } catch (error) {
      // Another sweep won the race. Anything else is a real failure.
      if (!(isApiError(error) && error.code === 'STALE_WRITE')) throw error;
    }
  }
  return { examined: lapsed.length, expired };
}

/**
 * Tells a developer once that their renewal window has opened — a threshold
 * crossing, not a step anybody takes, so it is a flag (`renewalNotifiedAt`)
 * and a notification, never a status move or a workflow event. Mirrors how
 * the SLA sweep notifies once per change of state without touching what an
 * officer may do (docs R.1.1): this never changes `status`.
 */
export async function notifyDeveloperRenewalsDue(now = new Date()) {
  const due = await prisma.developerRegistration.findMany({
    where: { isCurrent: true, status: 'APPROVED', renewalDueDate: { lte: now }, renewalNotifiedAt: null },
    select: { id: true, applicationNumber: true, registrationNumber: true, developerName: true, email: true, mobile: true, validTo: true, renewalDueDate: true },
  });
  let notified = 0;
  for (const row of due) {
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.developerRegistration.updateMany({ where: { id: row.id, renewalNotifiedAt: null }, data: { renewalNotifiedAt: now } });
        if (!count) return; // another sweep already sent it
        await emit(tx, {
          eventCode: EVENTS.DEVELOPER_REGISTRATION_RENEWAL_DUE,
          applicationId: null,
          payload: {
            developerRegistrationId: row.id,
            registrationNumber: row.registrationNumber ?? row.applicationNumber,
            developerName: row.developerName,
            contactName: row.developerName,
            contactEmail: row.email,
            contactPhone: row.mobile,
            validTo: row.validTo?.toISOString().slice(0, 10) ?? '',
            renewalDueDate: row.renewalDueDate?.toISOString().slice(0, 10) ?? '',
          },
        });
        await audit(tx, {
          action: 'DEVELOPER_REGISTRATION_RENEWAL_DUE_NOTIFIED',
          entityType: ENTITY,
          entityId: row.id,
          after: { registrationNumber: row.registrationNumber, renewalDueDate: row.renewalDueDate?.toISOString().slice(0, 10) },
          ip: '',
          userAgent: 'developer-renewal-due-sweep',
        });
      });
      notified += 1;
    } catch (error) {
      console.error('[developers] renewal-due notification failed', row.id, error);
    }
  }
  return { examined: due.length, notified };
}

/** At most once a minute per process: registers are read far more often than a day turns over. */
async function sweepIfDue() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  await expireLapsedDeveloperRegistrations()
    .then(() => notifyDeveloperRenewalsDue())
    .catch((error) => {
      lastSweep = 0;
      console.error('[developers] expiry sweep failed', error);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// The registers
// ═══════════════════════════════════════════════════════════════════════════

const OPEN_RENEWAL: Prisma.DeveloperRegistrationWhereInput = { kind: 'RENEWAL', status: { notIn: [...CLOSED_DEVELOPER_STATUSES] } };

function registerWhere(register: DeveloperRegister): Prisma.DeveloperRegistrationWhereInput {
  switch (register) {
    case 'ALL':
      return { isCurrent: true };
    case 'PENDING':
      return { status: { in: [...PENDING_DEVELOPER_STATUSES] } };
    case 'SHORTFALL':
      return { status: 'SHORTFALL' };
    case 'APPROVED':
      return { isCurrent: true, status: 'APPROVED' };
    case 'REJECTED':
      return { status: 'REJECTED' };
    case 'EXPIRED':
      return { isCurrent: true, status: 'EXPIRED' };
    case 'RENEWAL':
      return {
        OR: [{ isCurrent: true, status: 'APPROVED', renewalDueDate: { lte: today() } }, { isCurrent: true, status: 'EXPIRED' }, OPEN_RENEWAL],
      };
  }
}

export type DeveloperListQuery = {
  register?: DeveloperRegister;
  q?: string;
  type?: string;
  /** Narrows further within a register — chiefly useful on ALL. */
  status?: DeveloperStatus;
  /** Submitted on or after / on or before this day (inclusive). */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export async function listDeveloperRegistrations(user: AuthUser, query: DeveloperListQuery = {}) {
  requireView(user);
  await sweepIfDue();
  const and: Prisma.DeveloperRegistrationWhereInput[] = [registerWhere(query.register ?? 'ALL')];
  if (query.type) and.push({ developerType: query.type });
  if (query.status) and.push({ status: query.status });
  if (query.dateFrom) and.push({ submittedAt: { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } });
  if (query.dateTo) and.push({ submittedAt: { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } });
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: 'insensitive' } },
        { registrationNumber: { contains: q, mode: 'insensitive' } },
        { developerName: { contains: q, mode: 'insensitive' } },
        { organization: { contains: q, mode: 'insensitive' } },
        { authorizedPerson: { contains: q, mode: 'insensitive' } },
        { pan: { contains: q, mode: 'insensitive' } },
        { gstin: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where = { AND: and };
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const [total, rows] = await Promise.all([
    prisma.developerRegistration.count({ where }),
    prisma.developerRegistration.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const openRenewals = await prisma.developerRegistration.findMany({
    where: { ...OPEN_RENEWAL, lineageId: { in: [...new Set(rows.map((r) => r.lineageId))] } },
    select: { id: true, lineageId: true, applicationNumber: true, status: true },
  });
  const now = today();
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => {
      const renewal = r.kind === 'NEW' || r.isCurrent ? openRenewals.find((o) => o.lineageId === r.lineageId && o.id !== r.id) : undefined;
      return {
        id: r.id,
        applicationNumber: r.applicationNumber,
        registrationNumber: r.registrationNumber ?? '',
        kind: r.kind,
        developerType: r.developerType,
        developerName: r.developerName,
        organization: r.organization,
        authorizedPerson: r.authorizedPerson,
        pan: r.pan,
        status: r.status,
        isCurrent: r.isCurrent,
        submittedAt: r.submittedAt,
        validFrom: r.validFrom,
        validTo: r.validTo,
        renewalDueDate: r.renewalDueDate,
        renewalDue: r.isCurrent && r.status === 'APPROVED' && Boolean(r.renewalDueDate && r.renewalDueDate.getTime() <= now.getTime()),
        openRenewal: renewal ? { id: renewal.id, applicationNumber: renewal.applicationNumber, status: renewal.status } : null,
        currentDesk: deskLabel(r.currentDeskRoleKey, r.status),
      };
    }),
  };
}

export async function developerRegisterSummary(user: AuthUser) {
  requireView(user);
  const counts = await Promise.all(DEVELOPER_REGISTERS.map((r) => prisma.developerRegistration.count({ where: registerWhere(r) })));
  return Object.fromEntries(DEVELOPER_REGISTERS.map((r, i) => [r, counts[i]])) as Record<DeveloperRegister, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// One registration
// ═══════════════════════════════════════════════════════════════════════════

async function openRenewalOf(lineageId: string, exceptId: string) {
  return prisma.developerRegistration.findFirst({ where: { ...OPEN_RENEWAL, lineageId, id: { not: exceptId } }, select: { id: true, applicationNumber: true } });
}

async function offer(user: AuthUser, step: Exclude<DeveloperStep, 'RENEW'>, status: string, blocker: string | null = null): Promise<Offer> {
  if (status !== DEVELOPER_STEP_FROM[step]) return NONE;
  if (!(await actingRole(user, step))) return NONE;
  return { offered: true, available: !blocker, reason: blocker ?? '' };
}

/** Why this registration cannot be submitted — or null when it can. */
function submitBlocker(row: Row) {
  const problems = particularsProblems(row);
  if (Object.keys(problems).length) return `Complete the particulars first: ${Object.values(problems).join(' ')}`;
  const have = [...latestDocuments(docs(row.documents)).keys()];
  const missing = missingDeveloperDocuments(requiredDeveloperDocuments(row.developerType, row.gstin), have);
  if (missing.length) return `Attach the ${missing.map((k) => DEVELOPER_DOCUMENT_LABEL[k].toLowerCase()).join('; the ')}.`;
  return null;
}

export async function getDeveloperRegistration(user: AuthUser, id: string) {
  requireView(user);
  await sweepIfDue();
  const row = await requireRow(id);
  const [events, chain, openRenewal, auditTrail] = await Promise.all([
    prisma.developerRegistrationEvent.findMany({ where: { registrationId: row.id }, orderBy: { occurredAt: 'desc' } }),
    prisma.developerRegistration.findMany({
      where: { lineageId: row.lineageId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, applicationNumber: true, kind: true, status: true, isCurrent: true, validFrom: true, validTo: true, decidedAt: true, createdAt: true },
    }),
    openRenewalOf(row.lineageId, row.id),
    // The hash-chained audit trail, not the domain event log above: the same
    // rows `move()` writes on every step, `entityType` 'DeveloperRegistration'.
    entityAudit(ENTITY, row.id),
  ]);

  const renewRole = await actingRole(user, 'RENEW');
  const renewBlock = renewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: openRenewal?.applicationNumber ?? null, now: new Date() });
  const renew: Offer =
    renewRole && (row.status === 'APPROVED' || row.status === 'EXPIRED') && row.isCurrent ? { offered: true, available: !renewBlock, reason: renewBlock ?? '' } : NONE;

  const [edit, submit, takeUp, shortfall, respond, verify, decide] = await Promise.all([
    offer(user, 'EDIT', row.status),
    offer(user, 'SUBMIT', row.status, submitBlocker(row)),
    offer(user, 'TAKE_UP', row.status),
    offer(user, 'SHORTFALL', row.status),
    offer(user, 'RESPOND', row.status),
    offer(user, 'VERIFY', row.status),
    offer(user, 'DECIDE', row.status),
  ]);

  const documents = docs(row.documents);
  return {
    registration: {
      ...row,
      documents,
      shortfallItems: strings(row.shortfallItems),
      currentDesk: deskLabel(row.currentDeskRoleKey, row.status),
      renewalDue: row.isCurrent && row.status === 'APPROVED' && Boolean(row.renewalDueDate && row.renewalDueDate.getTime() <= today().getTime()),
    },
    requiredDocuments: requiredDeveloperDocuments(row.developerType, row.gstin),
    submitBlocker: row.status === 'DRAFT' ? submitBlocker(row) : null,
    openRenewal,
    chain,
    events,
    auditTrail,
    permissions: { edit, submit, takeUp, shortfall, respond, verify, decide, renew, demoAllowed: env.demoMode },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents — stored BEFORE the transaction (storage cannot be rolled back)
// ═══════════════════════════════════════════════════════════════════════════

async function storeDocuments(registrationId: string, user: AuthUser, uploads: DeveloperUploads, demoKinds: DeveloperDocumentKind[], round: number) {
  if (demoKinds.length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const now = clock().toISOString();
  const out: DeveloperDocument[] = [];
  for (const kind of DEVELOPER_DOCUMENTS) {
    const file = uploads[kind];
    if (file) {
      const stored = await storeUpload({
        applicationId: registrationId,
        root: 'developer-registrations',
        kind: 'developers',
        file,
        uploadedById: user.id,
        allowedExtensions: DOCUMENT_EXTENSIONS,
        maxBytes: MAX_BYTES,
      });
      out.push({ kind, fileObjectId: stored.id, fileName: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, isDemo: false, addedAt: now, addedByName: user.name, round });
    } else if (demoKinds.includes(kind)) {
      out.push({ kind, fileObjectId: null, fileName: `${kind.toLowerCase().replace(/_/g, '-')}-DEMO.pdf`, mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: now, addedByName: user.name, round });
    }
  }
  return out;
}

const demoKindsOf = (input: { demoDocuments: boolean; demoKinds: string }, uploads: DeveloperUploads) =>
  input.demoDocuments ? input.demoKinds.split(',').map((k) => k.trim()).filter(isDeveloperDocumentKind).filter((k) => !uploads[k]) : [];

function particularsOf(input: DeveloperDraftInput) {
  return {
    developerType: input.developerType,
    developerName: input.developerName,
    organization: input.organization,
    authorizedPerson: input.authorizedPerson,
    authorizedDesignation: input.authorizedDesignation,
    address: input.address,
    district: input.district,
    pincode: input.pincode,
    mobile: input.mobile,
    email: input.email,
    pan: input.pan,
    gstin: input.gstin,
    incorporationNo: input.incorporationNo,
    incorporationDate: input.incorporationDate ? new Date(input.incorporationDate) : null,
    reraNo: input.reraNo,
    experienceYears: input.experienceYears,
    projectsCompleted: input.projectsCompleted,
    registrationInfo: input.registrationInfo,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Register desk: draft, submit, answer, renew
// ═══════════════════════════════════════════════════════════════════════════

export async function createDeveloperDraft(user: AuthUser, input: DeveloperDraftInput & { uploads?: DeveloperUploads }, meta: Meta) {
  requireView(user);
  const roleKey = await requireRole(user, 'EDIT');
  const id = randomUUID();
  const uploads = input.uploads ?? {};
  const documents = await storeDocuments(id, user, uploads, demoKindsOf(input, uploads), 1);
  const now = clock();
  return prisma.$transaction(async (tx) => {
    const applicationNumber = await allocate(tx, DEVELOPER_APPLICATION_PREFIX, now);
    await tx.developerRegistration.create({
      data: {
        id,
        applicationNumber,
        kind: 'NEW',
        lineageId: id,
        status: 'DRAFT',
        ...particularsOf(input),
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
      action: 'DEVELOPER_REGISTRATION_DRAFTED',
      entityType: ENTITY,
      entityId: id,
      after: { applicationNumber, status: 'DRAFT', developerName: input.developerName, developerType: input.developerType, documents: documents.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })) },
      ...meta,
    });
    return { id, applicationNumber, status: 'DRAFT' as const };
  }, TX_LIMITS);
}

export async function updateDeveloperDraft(user: AuthUser, id: string, input: DeveloperDraftInput & { uploads?: DeveloperUploads }, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'EDIT', input.expectedStatus);
  const uploads = input.uploads ?? {};
  const added = await storeDocuments(row.id, user, uploads, demoKindsOf(input, uploads), 1);
  const next = particularsOf(input);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => String(next[k] ?? '') !== String((row as Record<string, unknown>)[k] ?? ''));
  const now = clock();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.developerRegistration.updateMany({
      where: { id: row.id, status: 'DRAFT', updatedAt: row.updatedAt },
      data: { ...next, documents: [...docs(row.documents), ...added] as never },
    });
    if (!count) throw conflict('Somebody else changed this draft just now. Reload to see what changed.', 'STALE_WRITE');
    await audit(tx, {
      actor: { id: user.id, name: user.name, roleKeys: [roleKey] },
      action: 'DEVELOPER_REGISTRATION_DRAFT_UPDATED',
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

export async function submitDeveloperRegistration(user: AuthUser, id: string, input: DeveloperSubmitInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'SUBMIT', input.expectedStatus);
  const problems = particularsProblems(row);
  if (Object.keys(problems).length) {
    throw businessRule('The particulars are not complete.', Object.entries(problems).map(([path, message]) => ({ path, message })));
  }
  const blocked = submitBlocker(row);
  if (blocked) throw businessRule(blocked);
  // One live registration per PAN: a developer already registered, or already
  // applying, is renewed — not registered twice.
  const clash = await prisma.developerRegistration.findFirst({
    where: { pan: row.pan, lineageId: { not: row.lineageId }, isCurrent: true, status: { notIn: ['DRAFT', 'REJECTED', 'EXPIRED'] } },
    select: { applicationNumber: true, registrationNumber: true },
  });
  if (clash) throw conflict(`PAN ${row.pan} is already on ${clash.registrationNumber ?? clash.applicationNumber}. Renew or amend that registration instead.`);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'DRAFT',
        to: DEVELOPER_STEP_TO.SUBMIT,
        data: { submittedById: user.id, submittedByName: user.name, submittedAt: now },
        eventAction: 'SUBMITTED',
        auditAction: 'DEVELOPER_REGISTRATION_SUBMITTED',
        actor: user,
        roleKey,
        remarks: input.remarks || (row.kind === 'RENEWAL' ? 'Renewal application submitted.' : 'Registration application submitted.'),
        now,
        meta,
        after: { kind: row.kind, documents: docs(row.documents).length },
        notify: { eventCode: EVENTS.DEVELOPER_REGISTRATION_SUBMITTED },
      }),
    TX_LIMITS
  );
}

export async function respondDeveloperShortfall(user: AuthUser, id: string, input: DeveloperRespondInput & { uploads?: DeveloperUploads }, meta: Meta) {
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
        to: DEVELOPER_STEP_TO.RESPOND,
        data: { round, shortfallResponse: input.remarks, shortfallRespondedAt: now, documents: [...docs(row.documents), ...added] as never },
        eventAction: 'SHORTFALL_ANSWERED',
        auditAction: 'DEVELOPER_REGISTRATION_SHORTFALL_ANSWERED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { round, documents: added.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })) },
        notify: { eventCode: EVENTS.DEVELOPER_REGISTRATION_RESPONSE_RECEIVED },
      }),
    TX_LIMITS
  );
}

/** Opens a renewal: a new application carrying the registration number, particulars and documents forward. */
export async function renewDeveloperRegistration(user: AuthUser, id: string, input: DeveloperRenewInput, meta: Meta) {
  requireView(user);
  const roleKey = await requireRole(user, 'RENEW');
  const row = await requireRow(id);
  const open = await openRenewalOf(row.lineageId, row.id);
  const blocked = renewalBlocker({ status: row.status, isCurrent: row.isCurrent, renewalDueDate: row.renewalDueDate, openRenewalNumber: open?.applicationNumber ?? null, now: clock() });
  if (blocked) throw conflict(blocked);
  const now = clock();
  const newId = randomUUID();
  const carried = latestDocuments(docs(row.documents));
  const documents: DeveloperDocument[] = [...carried.values()].map(({ doc }) => ({ ...doc, round: 1, carriedForward: true }));
  return prisma.$transaction(async (tx) => {
    // Checked again under the transaction: two officers pressing Renew together open one renewal.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `developer-renewal:${row.lineageId}`);
    const again = await tx.developerRegistration.findFirst({ where: { ...OPEN_RENEWAL, lineageId: row.lineageId }, select: { applicationNumber: true } });
    if (again) throw conflict(`Renewal ${again.applicationNumber} is already under way.`);
    const applicationNumber = await allocate(tx, DEVELOPER_APPLICATION_PREFIX, now);
    await tx.developerRegistration.create({
      data: {
        id: newId,
        applicationNumber,
        kind: 'RENEWAL',
        registrationNumber: row.registrationNumber,
        lineageId: row.lineageId,
        renewalOfId: row.id,
        isCurrent: false,
        status: 'DRAFT',
        developerType: row.developerType,
        developerName: row.developerName,
        organization: row.organization,
        authorizedPerson: row.authorizedPerson,
        authorizedDesignation: row.authorizedDesignation,
        address: row.address,
        district: row.district,
        pincode: row.pincode,
        mobile: row.mobile,
        email: row.email,
        pan: row.pan,
        gstin: row.gstin,
        incorporationNo: row.incorporationNo,
        incorporationDate: row.incorporationDate,
        reraNo: row.reraNo,
        experienceYears: row.experienceYears,
        projectsCompleted: row.projectsCompleted,
        registrationInfo: row.registrationInfo,
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
      action: 'DEVELOPER_RENEWAL_OPENED',
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

export async function takeUpDeveloperRegistration(user: AuthUser, id: string, input: DeveloperSubmitInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'TAKE_UP', input.expectedStatus);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'SUBMITTED',
        to: DEVELOPER_STEP_TO.TAKE_UP,
        data: { takenUpById: user.id, takenUpByName: user.name, takenUpAt: now },
        eventAction: 'TAKEN_UP',
        auditAction: 'DEVELOPER_REGISTRATION_TAKEN_UP',
        actor: user,
        roleKey,
        remarks: input.remarks || 'Taken up for scrutiny.',
        now,
        meta,
      }),
    TX_LIMITS
  );
}

export async function raiseDeveloperShortfall(user: AuthUser, id: string, input: DeveloperShortfallInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'SHORTFALL', input.expectedStatus);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'IN_PROCESS',
        to: DEVELOPER_STEP_TO.SHORTFALL,
        data: {
          shortfallItems: input.items as never,
          shortfallRemarks: input.remarks,
          shortfallRaisedByName: user.name,
          shortfallRaisedAt: now,
          shortfallResponse: '',
          shortfallRespondedAt: null,
        },
        eventAction: 'SHORTFALL_RAISED',
        auditAction: 'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { round: row.round, items: input.items },
        notify: { eventCode: EVENTS.DEVELOPER_REGISTRATION_SHORTFALL_RAISED, extra: { items: input.items.join('; ') } },
      }),
    TX_LIMITS
  );
}

export async function verifyDeveloperRegistration(user: AuthUser, id: string, input: DeveloperVerifyInput, meta: Meta) {
  const { row, roleKey } = await precheck(user, id, 'VERIFY', input.expectedStatus);
  const now = clock();
  return prisma.$transaction(
    (tx) =>
      move(tx, {
        row,
        from: 'IN_PROCESS',
        to: DEVELOPER_STEP_TO.VERIFY,
        data: {
          verificationOutcome: input.outcome,
          verificationRemarks: input.remarks,
          verifiedById: user.id,
          verifiedByName: user.name,
          verifiedByRoleKey: roleKey,
          verifiedAt: now,
        },
        eventAction: 'VERIFIED',
        auditAction: 'DEVELOPER_REGISTRATION_VERIFIED',
        actor: user,
        roleKey,
        remarks: input.remarks,
        now,
        meta,
        after: { outcome: input.outcome },
        notify: { eventCode: EVENTS.DEVELOPER_REGISTRATION_REVIEW_REQUIRED, extra: { outcome: input.outcome } },
      }),
    TX_LIMITS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Decide desk
// ═══════════════════════════════════════════════════════════════════════════

export async function decideDeveloperRegistration(user: AuthUser, id: string, input: DeveloperDecideInput, meta: Meta) {
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
          auditAction: 'DEVELOPER_REGISTRATION_REJECTED',
          actor: user,
          roleKey,
          remarks: input.remarks,
          now,
          meta,
          after: { kind: row.kind, verificationOutcome: row.verificationOutcome },
          notify: { eventCode: EVENTS.DEVELOPER_REGISTRATION_REJECTED, extra: { decisionRemarks: input.remarks } },
        }),
      TX_LIMITS
    );
  }

  // Read once, outside the transaction: the settings in force when approved.
  const [years, windowDays] = await Promise.all([
    settingNumber(DEVELOPER_VALIDITY_SETTING, DEFAULT_DEVELOPER_VALIDITY_YEARS),
    settingNumber(DEVELOPER_RENEWAL_WINDOW_SETTING, DEFAULT_DEVELOPER_RENEWAL_WINDOW_DAYS),
  ]);
  if (!(years > 0)) throw businessRule('The registration validity setting must be a positive number of years.');

  return prisma.$transaction(async (tx) => {
    const predecessor = row.renewalOfId
      ? await tx.developerRegistration.findUniqueOrThrow({ where: { id: row.renewalOfId }, select: { id: true, applicationNumber: true, registrationNumber: true, status: true, validTo: true, isCurrent: true } })
      : null;
    const validity = computeValidity(now, years, windowDays, predecessor?.validTo);
    const registrationNumber = row.registrationNumber ?? (await allocate(tx, DEVELOPER_REGISTRATION_PREFIX, now));

    const outward = await createOutwardEntry(
      tx,
      {
        applicationId: null,
        documentType: 'REGISTRATION_LETTER',
        documentReference: registrationNumber,
        sourceType: ENTITY,
        sourceId: row.id,
        subject: `Developer ${row.kind === 'RENEWAL' ? 'registration renewed' : 'registration'} ${registrationNumber} — ${row.organization || row.developerName}`,
        recipient: [row.organization || row.developerName, row.authorizedPerson && `Attn: ${row.authorizedPerson}`].filter(Boolean).join(', '),
        address: [row.address, row.district, row.pincode].filter(Boolean).join(', '),
        status: 'READY_FOR_DISPATCH',
      },
      { actor: user, roleKey, now, meta }
    );

    if (predecessor) {
      // The renewed registration stays on record exactly as issued; it is simply no longer the current one.
      await tx.developerRegistration.update({ where: { id: predecessor.id }, data: { isCurrent: false, supersededAt: now } });
      await event(tx, predecessor.id, 'SUPERSEDED', predecessor.status, predecessor.status, user, roleKey, `Renewed by ${row.applicationNumber}.`, now);
    }

    return move(tx, {
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
        outwardEntryId: outward.id,
        outwardNumber: outward.outwardNumber,
      },
      eventAction: 'APPROVED',
      auditAction: row.kind === 'RENEWAL' ? 'DEVELOPER_REGISTRATION_RENEWED' : 'DEVELOPER_REGISTRATION_APPROVED',
      actor: user,
      roleKey,
      remarks: input.remarks,
      now,
      meta,
      after: {
        registrationNumber,
        kind: row.kind,
        issueDate: validity.issueDate.toISOString().slice(0, 10),
        validFrom: validity.validFrom.toISOString().slice(0, 10),
        validTo: validity.validTo.toISOString().slice(0, 10),
        renewalDueDate: validity.renewalDueDate.toISOString().slice(0, 10),
        validityYears: years,
        renewalWindowDays: windowDays,
        renewalOf: predecessor?.applicationNumber ?? null,
        outwardNumber: outward.outwardNumber,
      },
      notify: {
        eventCode: EVENTS.DEVELOPER_REGISTRATION_APPROVED,
        extra: { registrationNumber, validFrom: validity.validFrom.toISOString().slice(0, 10), validTo: validity.validTo.toISOString().slice(0, 10) },
      },
    }).then((r) => ({ ...r, registrationNumber, outwardNumber: outward.outwardNumber, validTo: validity.validTo }));
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// For applications — who a building-permission file may name as its developer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approved, current, unexpired developer registrations a building-permission
 * application may name (Phase 11 application integration). Never the whole
 * administrative register — an LTP filing a form sees only this. Public, like
 * the occupied-professional register: no row scope applies.
 */
export async function availableDevelopers(opts: { q?: string } = {}) {
  const rows = await prisma.developerRegistration.findMany({
    where: {
      isCurrent: true,
      status: 'APPROVED',
      validTo: { gte: today() },
      ...(opts.q
        ? {
            OR: [
              { developerName: { contains: opts.q, mode: 'insensitive' as const } },
              { organization: { contains: opts.q, mode: 'insensitive' as const } },
              { registrationNumber: { contains: opts.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ developerName: 'asc' }],
    take: 200,
  });
  return rows.map((r) => ({
    registrationId: r.id,
    registrationNumber: r.registrationNumber ?? '',
    developerType: r.developerType,
    developerName: r.developerName,
    organization: r.organization,
    authorizedPerson: r.authorizedPerson,
    mobile: r.mobile,
    validTo: r.validTo,
  }));
}

/** The developer register entry an application names — refused unless approved and in force today. */
export async function requireAvailableDeveloper(tx: Tx, registrationId: string) {
  const r = isUuid(registrationId) ? await tx.developerRegistration.findUnique({ where: { id: registrationId } }) : null;
  if (!r || !isDeveloperAvailable(r, new Date())) {
    throw businessRule('Choose a developer registration that is approved and in force.');
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading a document
// ═══════════════════════════════════════════════════════════════════════════

export async function readDeveloperDocument(user: AuthUser, id: string, index: number) {
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
  const html = renderDemoAttachment(doc.fileName, `${row.applicationNumber} — ${DEVELOPER_DOCUMENT_LABEL[doc.kind].toLowerCase()} — ${row.organization || row.developerName}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}
