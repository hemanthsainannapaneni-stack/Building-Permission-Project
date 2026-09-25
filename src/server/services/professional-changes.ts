import 'server-only';
import type { Prisma } from '@prisma/client';
import { availableProfessionals } from './professional-registrations';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, type AuthUser } from '@/server/auth/context';
import { badRequest, conflict, forbidden, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES } from '@/lib/constants';
import { ACTIONS, stageName } from '@/lib/workflow';
import {
  NEXT_STEP,
  OPEN_PROFESSIONAL_CHANGE_STATUSES,
  PROFESSIONAL_CHANGE_DOCUMENTS,
  PROFESSIONAL_CHANGE_STEP_CAPABILITY,
  PROFESSIONAL_CHANGE_STATUS_LABEL,
  canDecide,
  canReview,
  canVerify,
  isProfessionalChangeDocumentKind,
  isProfessionalChangeOpen,
  isProfessionalChangeStatus,
  licenceValidOn,
  type ProfessionalChangeDocument,
  type ProfessionalChangeDocumentKind,
  type ProfessionalChangeStatus,
  type ProfessionalChangeStep,
  type ProfessionalSnapshot,
} from '@/lib/professional-change';
import type {
  AddProfessionalChangeDocumentsInput,
  DecideProfessionalChangeInput,
  ProfessionalChangeStepInput,
  RequestProfessionalChangeInput,
} from '@/lib/schemas/professional-change';
import { performSystemActionInTx } from '@/server/workflow/engine';
import { documentsAdded } from '@/server/professional-change/engine';
import { renderDemoAttachment } from '@/server/proceedings/documents';
import { roleTitle } from './show-cause';
import { storeUpload } from './files';

/**
 * THE CHANGE OF TECHNICAL PROFESSIONAL SERVICE.
 *
 *   TPA: Request → Planning Officer: Verify → ZDD: Review → ZJD: Approve │ Reject
 *
 * ── Every step is a workflow transition ──────────────────────────────────
 *
 * REQUEST_ / VERIFY_ / REVIEW_ / APPROVE_ / REJECT_PROFESSIONAL_CHANGE are rows
 * on the file's workflow, performed through the engine as SYSTEM transitions
 * raised on the officer's behalf (performSystemActionInTx). The engine checks
 * the transition exists at the file's stage, runs the guards that order the
 * steps, runs the PROFESSIONAL_CHANGE effect, and writes the history row — in
 * the officer's name — and the audit row, in one transaction.
 *
 * What this service decides, and the engine cannot: whether the step is THIS
 * officer's. A request moves desk to desk independently of the file, so the
 * answer is the step's capability (PROFESSIONAL_CHANGE_*) plus the officer's
 * jurisdiction over the file — never a role name in code.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
export type Upload = { name: string; type: string; bytes: Buffer };

const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  ltpUserId: true,
  submittedAt: true,
  createdAt: true,
  ltpDeclaration: true,
  zone: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true } },
  ltp: {
    select: { id: true, name: true, email: true, phone: true, ltpLicenceNo: true, ltpLicenceClass: true, ltpValidUpto: true, firmName: true },
  },
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const docs = (v: unknown): ProfessionalChangeDocument[] => (Array.isArray(v) ? (v as ProfessionalChangeDocument[]) : []);
const snap = (v: unknown): ProfessionalSnapshot => (v ?? {}) as ProfessionalSnapshot;

function applicationSummary(app: ApplicationRow) {
  return {
    id: app.id,
    applicationNumber: app.applicationNumber,
    status: app.status,
    currentStageCode: app.currentStageCode,
    fileDesk: stageName(app.currentStageCode),
    zone: app.zone?.name ?? '',
    owner: app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '',
  };
}

/** "TPA,ZDD" → "Town Planning Assistant / Zonal Deputy Director". Empty once decided. */
export function deskLabel(roleKeys: string, status: string): string {
  if (!isProfessionalChangeOpen(status)) return 'Decided';
  const keys = roleKeys.split(',').filter(Boolean);
  return keys.length ? keys.map(roleTitle).join(' / ') : '—';
}

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.PROFESSIONAL_CHANGE_VIEW)) {
    throw forbidden('Your role does not include change of technical professional requests.');
  }
}

const scopeWhere = (user: AuthUser): Prisma.ProfessionalChangeRequestWhereInput => ({
  application: { deletedAt: null, ...applicationScope(user) },
});

async function requireApplication(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');
  const app = await prisma.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: APPLICATION_SELECT,
  });
  if (!app) throw notFound('That application could not be found.');
  return app;
}

async function requireRequest(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That request could not be found.');
  const row = await prisma.professionalChangeRequest.findFirst({
    where: { id, ...scopeWhere(user) },
    include: { application: { select: APPLICATION_SELECT } },
  });
  if (!row) throw notFound('That request could not be found.');
  return row;
}

/**
 * The role the officer takes this step in: one they hold that the DATABASE
 * grants the step's capability to. Recorded on the history, event and audit
 * rows, so a multi-role officer is named in the capacity they acted in.
 */
async function actingRole(user: AuthUser, step: ProfessionalChangeStep): Promise<string | null> {
  const capability = PROFESSIONAL_CHANGE_STEP_CAPABILITY[step];
  if (!can(user, capability)) return null;
  const role = await prisma.role.findFirst({
    where: { key: { in: user.roleKeys }, permissions: { some: { permission: { key: capability } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return role?.key ?? null;
}

const STEP_ACTION: Record<ProfessionalChangeStep, string> = {
  REQUEST: ACTIONS.REQUEST_PROFESSIONAL_CHANGE,
  VERIFY: ACTIONS.VERIFY_PROFESSIONAL_CHANGE,
  REVIEW: ACTIONS.REVIEW_PROFESSIONAL_CHANGE,
  DECIDE: ACTIONS.APPROVE_PROFESSIONAL_CHANGE,
};

/**
 * Whether the file's workflow carries this step at the stage the file is at.
 * The engine asks the same question and refuses; asking first lets a screen
 * say why a button is absent, and keeps a refused caller from uploading.
 */
async function workflowAllows(applicationId: string, actionCode: string): Promise<{ allowed: boolean; reason: string }> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { applicationId },
    select: { workflowId: true, currentStageId: true, status: true },
  });
  if (!instance?.currentStageId) {
    return { allowed: false, reason: 'The file has not reached the department yet. The professional can be changed once it has.' };
  }
  const t = await prisma.workflowTransition.findFirst({
    where: { workflowId: instance.workflowId, fromStageId: instance.currentStageId, isActive: true, action: { code: actionCode } },
    select: { id: true },
  });
  return t
    ? { allowed: true, reason: '' }
    : { allowed: false, reason: 'The workflow does not allow a change of professional on this file at its current stage.' };
}

type Offer = { offered: boolean; available: boolean; reason: string };
const NONE: Offer = { offered: false, available: false, reason: '' };

async function offerStep(user: AuthUser, applicationId: string, step: ProfessionalChangeStep, statusOk: boolean): Promise<Offer> {
  if (!can(user, PROFESSIONAL_CHANGE_STEP_CAPABILITY[step])) return NONE;
  if (!statusOk) return NONE;
  const wf = await workflowAllows(applicationId, STEP_ACTION[step]);
  return { offered: true, available: wf.allowed, reason: wf.reason };
}

function assertExpected(current: string, expected: string | undefined) {
  if (expected && expected !== current) {
    throw conflict(
      `This request is now ${PROFESSIONAL_CHANGE_STATUS_LABEL[current as ProfessionalChangeStatus] ?? current}. Reload to see what changed.`,
      'STALE_WRITE'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents — stored before the transaction (storage cannot be rolled back)
// ═══════════════════════════════════════════════════════════════════════════

export type DocumentUploads = Partial<Record<ProfessionalChangeDocumentKind, Upload>>;

async function storeDocuments(
  applicationId: string,
  user: AuthUser,
  uploads: DocumentUploads,
  demoKinds: ProfessionalChangeDocumentKind[]
): Promise<ProfessionalChangeDocument[]> {
  if (demoKinds.length && !env.demoMode) {
    throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  }
  const now = new Date().toISOString();
  const out: ProfessionalChangeDocument[] = [];
  for (const kind of PROFESSIONAL_CHANGE_DOCUMENTS) {
    const file = uploads[kind];
    if (file) {
      const stored = await storeUpload({
        applicationId,
        kind: 'proceedings',
        file,
        uploadedById: user.id,
        allowedExtensions: DOCUMENT_EXTENSIONS,
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      out.push({
        kind,
        fileObjectId: stored.id,
        fileName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        isDemo: false,
        addedAt: now,
        addedByName: user.name,
      });
    } else if (demoKinds.includes(kind)) {
      out.push({
        kind,
        fileObjectId: null,
        fileName: `${kind.toLowerCase().replace(/_/g, '-')}-DEMO.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 0,
        isDemo: true,
        addedAt: now,
        addedByName: user.name,
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type ProfessionalChangeListQuery = { q?: string; status?: string; applicationId?: string; page?: number; pageSize?: number };

export async function listProfessionalChanges(user: AuthUser, query: ProfessionalChangeListQuery = {}) {
  requireView(user);
  const and: Prisma.ProfessionalChangeRequestWhereInput[] = [scopeWhere(user)];
  if (query.applicationId && isUuid(query.applicationId)) and.push({ applicationId: query.applicationId });
  if (query.status === 'OPEN') and.push({ status: { in: [...OPEN_PROFESSIONAL_CHANGE_STATUSES] } });
  else if (query.status && isProfessionalChangeStatus(query.status)) and.push({ status: query.status });
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { requestNumber: { contains: q, mode: 'insensitive' } },
        { ownerName: { contains: q, mode: 'insensitive' } },
        { application: { applicationNumber: { contains: q, mode: 'insensitive' } } },
        { currentProfessional: { name: { contains: q, mode: 'insensitive' } } },
        { proposedProfessional: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  const where = { AND: and };
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const [total, rows] = await Promise.all([
    prisma.professionalChangeRequest.count({ where }),
    prisma.professionalChangeRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { application: { select: APPLICATION_SELECT } },
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => {
      const current = snap(r.currentSnapshot);
      const proposed = snap(r.proposedSnapshot);
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        status: r.status,
        owner: r.ownerName,
        requestDate: r.requestDate,
        requestedAt: r.requestedAt,
        currentProfessional: { name: current.name, licenceNo: current.licenceNo },
        proposedProfessional: { name: proposed.name, licenceNo: proposed.licenceNo },
        currentDesk: deskLabel(r.currentDeskRoleKey, r.status),
        decidedAt: r.decidedAt,
        application: applicationSummary(r.application),
      };
    }),
  };
}

export async function professionalChangeSummary(user: AuthUser) {
  requireView(user);
  const byStatus = await prisma.professionalChangeRequest.groupBy({ by: ['status'], where: scopeWhere(user), _count: { _all: true } });
  const s = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<string, number>;
  return {
    total: Object.values(s).reduce((a, b) => a + b, 0),
    pending: s.PENDING_VERIFICATION ?? 0,
    underReview: (s.UNDER_REVIEW ?? 0) + (s.PENDING_DECISION ?? 0),
    approved: s.APPROVED ?? 0,
    rejected: s.REJECTED ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The professional history of a file
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every professional who has held the file, oldest first. A file that has
 * never changed hands has no engagement rows; its one engagement is shown as
 * derived from the filing record (`derived: true`) and is written for real by
 * the first approved change.
 */
async function engagementsOf(app: ApplicationRow) {
  const rows = await prisma.applicationProfessional.findMany({
    where: { applicationId: app.id },
    orderBy: { engagedFrom: 'asc' },
    include: {
      user: { select: { name: true } },
    },
  });
  const requestIds = rows.flatMap((r) => [r.changeRequestId, r.endedByChangeRequestId]).filter((x): x is string => Boolean(x));
  const numbers = requestIds.length
    ? await prisma.professionalChangeRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, requestNumber: true } })
    : [];
  const numberOf = new Map(numbers.map((n) => [n.id, n.requestNumber]));
  if (rows.length) {
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: snap(r.snapshot).name || r.user.name,
      snapshot: snap(r.snapshot),
      status: r.status,
      drawingRights: r.drawingRights,
      source: r.source,
      engagedFrom: r.engagedFrom,
      engagedUntil: r.engagedUntil,
      broughtInBy: r.changeRequestId ? { id: r.changeRequestId, requestNumber: numberOf.get(r.changeRequestId) ?? '' } : null,
      endedBy: r.endedByChangeRequestId ? { id: r.endedByChangeRequestId, requestNumber: numberOf.get(r.endedByChangeRequestId) ?? '' } : null,
      derived: false,
    }));
  }
  const declared = (app.ltpDeclaration ?? {}) as Partial<Record<string, string>>;
  return [
    {
      id: `filing-${app.id}`,
      userId: app.ltp.id,
      name: app.ltp.name,
      snapshot: {
        userId: app.ltp.id,
        name: app.ltp.name,
        email: app.ltp.email,
        phone: app.ltp.phone ?? '',
        licenceNo: declared.licenceNo || app.ltp.ltpLicenceNo || '',
        licenceClass: declared.licenceClass || app.ltp.ltpLicenceClass || '',
        validUpto: declared.validUpto ?? app.ltp.ltpValidUpto?.toISOString() ?? null,
        firmName: declared.firmName || app.ltp.firmName || '',
      },
      status: 'ACTIVE',
      drawingRights: true,
      source: 'ORIGINAL_FILING',
      engagedFrom: app.submittedAt ?? app.createdAt,
      engagedUntil: null,
      broughtInBy: null,
      endedBy: null,
      derived: true,
    },
  ];
}

/**
 * Professionals a file could pass to: those the PROFESSIONAL REGISTER holds
 * approved and in force, of a type that may hold a file, with an active LTP
 * account (Phase 12). The register is the one record of who may practise; the
 * account supplies the licence particulars the snapshot freezes.
 */
export async function eligibleProfessionals(excludeUserId: string) {
  const entries = await availableProfessionals({ purpose: 'FILE_HOLDER', excludeUserId });
  const users = await prisma.user.findMany({
    where: { id: { in: entries.map((e) => e.userId!).filter(Boolean) } },
    select: { id: true, name: true, ltpLicenceNo: true, ltpLicenceClass: true, ltpValidUpto: true, firmName: true },
  });
  const now = new Date();
  const seen = new Set<string>();
  return entries
    .filter((e) => e.userId && !seen.has(e.userId) && seen.add(e.userId))
    .map((e) => ({ e, u: users.find((u) => u.id === e.userId)! }))
    .filter(({ u }) => u && licenceValidOn(u.ltpValidUpto, now))
    .map(({ e, u }) => ({
      id: u.id,
      name: u.name,
      licenceNo: u.ltpLicenceNo ?? e.licenceNo,
      licenceClass: u.ltpLicenceClass ?? '',
      validUpto: u.ltpValidUpto,
      firmName: u.firmName ?? e.organization,
      registrationNumber: e.registrationNumber,
      typeLabel: e.typeLabel,
    }));
}

/** The application's Technical Professional tab. */
export async function getApplicationProfessional(user: AuthUser, applicationId: string) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const [engagements, requests, open] = await Promise.all([
    engagementsOf(app),
    prisma.professionalChangeRequest.findMany({ where: { applicationId: app.id }, orderBy: { requestedAt: 'desc' } }),
    prisma.professionalChangeRequest.findFirst({
      where: { applicationId: app.id, status: { in: [...OPEN_PROFESSIONAL_CHANGE_STATUSES] } },
      select: { requestNumber: true },
    }),
  ]);
  let request = await offerStep(user, app.id, 'REQUEST', true);
  if (request.offered && request.available && open) {
    request = { offered: true, available: false, reason: `${open.requestNumber} is still open on this file.` };
  }
  return {
    application: applicationSummary(app),
    engagements,
    requests: requests.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      status: r.status,
      requestDate: r.requestDate,
      requestedAt: r.requestedAt,
      currentProfessional: snap(r.currentSnapshot).name,
      proposedProfessional: snap(r.proposedSnapshot).name,
      currentDesk: deskLabel(r.currentDeskRoleKey, r.status),
      decidedAt: r.decidedAt,
    })),
    professionals: request.offered ? await eligibleProfessionals(app.ltpUserId) : [],
    permissions: { request, demoDocumentAllowed: env.demoMode },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// One request
// ═══════════════════════════════════════════════════════════════════════════

export async function getProfessionalChange(user: AuthUser, id: string) {
  requireView(user);
  const row = await requireRequest(user, id);
  const [events, engagements, verify, review, decide] = await Promise.all([
    prisma.professionalChangeEvent.findMany({ where: { requestId: row.id }, orderBy: { occurredAt: 'desc' } }),
    engagementsOf(row.application),
    offerStep(user, row.applicationId, 'VERIFY', canVerify(row.status)),
    offerStep(user, row.applicationId, 'REVIEW', canReview(row.status)),
    offerStep(user, row.applicationId, 'DECIDE', canDecide(row.status)),
  ]);
  const { application, ...rest } = row;
  const open = isProfessionalChangeOpen(row.status);
  const next = NEXT_STEP[row.status as ProfessionalChangeStatus] ?? null;
  return {
    ...rest,
    currentSnapshot: snap(rest.currentSnapshot),
    proposedSnapshot: snap(rest.proposedSnapshot),
    documents: docs(rest.documents),
    currentDesk: deskLabel(row.currentDeskRoleKey, row.status),
    nextStep: next,
    requestedStageName: stageName(row.requestedStageCode),
    application: applicationSummary(application),
    /** Who holds the file now — after an approval, the proposed professional. */
    holderId: application.ltpUserId,
    engagements,
    events: events.map((e) => ({ ...e, stageName: e.stageCode ? stageName(e.stageCode) : '' })),
    permissions: {
      verify,
      review,
      decide,
      addDocuments: open && can(user, CAPABILITIES.PROFESSIONAL_CHANGE_REQUEST, CAPABILITIES.PROFESSIONAL_CHANGE_VERIFY),
      demoDocumentAllowed: env.demoMode,
    },
  };
}

export async function readProfessionalChangeDocument(user: AuthUser, id: string, index: number) {
  requireView(user);
  const row = await requireRequest(user, id);
  const doc = docs(row.documents)[index];
  if (!doc) throw notFound('That document could not be found.');
  if (doc.fileObjectId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: doc.fileObjectId },
      select: { storageKey: true, mimeType: true, scanStatus: true, originalName: true },
    });
    if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
      return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType, fileName: file.originalName };
    }
    throw conflict(file?.scanStatus === 'PENDING' ? 'The document is still being scanned.' : 'The document is withheld — it did not pass the virus scan.');
  }
  const html = renderDemoAttachment(doc.fileName, `${row.requestNumber} — ${doc.kind.replace(/_/g, ' ').toLowerCase()}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}

// ═══════════════════════════════════════════════════════════════════════════
// Steps — every one a workflow transition
// ═══════════════════════════════════════════════════════════════════════════

async function raise(
  user: AuthUser,
  step: ProfessionalChangeStep,
  applicationId: string,
  actionCode: string,
  input: { remarks: string; proceeding: Record<string, unknown>; expectedSequence?: number },
  meta: Meta
) {
  const roleKey = await actingRole(user, step);
  if (!roleKey) throw forbidden('This step of a change of professional request is not your desk’s.');
  const wf = await workflowAllows(applicationId, actionCode);
  if (!wf.allowed) throw conflict(wf.reason);
  return prisma.$transaction(
    (tx) =>
      performSystemActionInTx(tx, {
        applicationId,
        actionCode,
        input,
        meta,
        onBehalfOf: { id: user.id, name: user.name, roleKey },
      }),
    TX_LIMITS
  );
}

export async function requestProfessionalChange(
  user: AuthUser,
  applicationId: string,
  input: RequestProfessionalChangeInput & { uploads?: DocumentUploads },
  meta: Meta
) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  // Asked before any upload, so a refused caller never writes to storage.
  if (!(await actingRole(user, 'REQUEST'))) throw forbidden('Your desk does not register change of professional requests.');
  const wf = await workflowAllows(app.id, ACTIONS.REQUEST_PROFESSIONAL_CHANGE);
  if (!wf.allowed) throw conflict(wf.reason);
  if (input.proposedProfessionalId === app.ltpUserId) {
    throw badRequest('The proposed professional already holds this file.', [
      { path: 'proposedProfessionalId', message: 'Choose a different professional.' },
    ]);
  }
  // Refused before any upload: the engine asks again inside its transaction.
  if (!(await eligibleProfessionals(app.ltpUserId)).some((p) => p.id === input.proposedProfessionalId)) {
    throw badRequest('The proposed professional is not in the professional register, approved and in force.', [
      { path: 'proposedProfessionalId', message: 'Choose a professional from the register.' },
    ]);
  }

  const uploads = input.uploads ?? {};
  const named = input.demoKinds.split(',').map((k) => k.trim()).filter(isProfessionalChangeDocumentKind);
  const demoKinds = input.demoDocuments
    ? PROFESSIONAL_CHANGE_DOCUMENTS.filter((k) => !uploads[k] && (!named.length || named.includes(k)))
    : [];
  const documents = await storeDocuments(app.id, user, uploads, demoKinds);

  return raise(
    user,
    'REQUEST',
    app.id,
    ACTIONS.REQUEST_PROFESSIONAL_CHANGE,
    {
      remarks: input.reason,
      expectedSequence: input.expectedSequence,
      proceeding: {
        proposedProfessionalId: input.proposedProfessionalId,
        requestDate: input.requestDate,
        reason: input.reason,
        documents,
      },
    },
    meta
  );
}

/**
 * Documents that arrive after the request — the NOC the outgoing professional
 * sends a week later. Not a step of the workflow (the request does not move),
 * but recorded on the request's history and in the audit chain.
 */
export async function addProfessionalChangeDocuments(
  user: AuthUser,
  id: string,
  input: AddProfessionalChangeDocumentsInput & { uploads?: DocumentUploads },
  meta: Meta
) {
  requireView(user);
  const pre = await requireRequest(user, id);
  const roleKey = (await actingRole(user, 'REQUEST')) ?? (await actingRole(user, 'VERIFY'));
  if (!roleKey) throw forbidden('Your desk does not add documents to change of professional requests.');
  assertExpected(pre.status, input.expectedStatus);
  if (!isProfessionalChangeOpen(pre.status)) throw conflict('This request has been decided. Its documents can no longer change.');

  const demoKinds = input.demoDocuments
    ? input.demoKinds.split(',').map((k) => k.trim()).filter(isProfessionalChangeDocumentKind)
    : [];
  const added = await storeDocuments(pre.applicationId, user, input.uploads ?? {}, demoKinds);
  if (!added.length) throw badRequest('Attach at least one document.');

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const current = await tx.professionalChangeRequest.findUniqueOrThrow({ where: { id: pre.id }, select: { status: true, documents: true } });
    if (current.status !== pre.status) throw conflict('This request moved on while the documents were uploading. Reload and try again.', 'STALE_WRITE');
    await tx.professionalChangeRequest.update({
      where: { id: pre.id },
      data: { documents: [...docs(current.documents), ...added] as never },
    });
    await documentsAdded(
      {
        tx,
        actor: { id: user.id, name: user.name },
        roleKey,
        now,
        meta,
        application: { id: pre.applicationId, applicationNumber: pre.application.applicationNumber, status: pre.application.status, ltpUserId: pre.application.ltpUserId },
        stageCode: pre.application.currentStageCode ?? '',
      },
      pre.id,
      pre.requestNumber,
      pre.status,
      added
    );
    return { requestId: pre.id, added: added.length };
  }, TX_LIMITS);
}

export async function verifyProfessionalChange(user: AuthUser, id: string, input: ProfessionalChangeStepInput, meta: Meta) {
  requireView(user);
  const row = await requireRequest(user, id);
  assertExpected(row.status, input.expectedStatus);
  if (!canVerify(row.status)) throw conflict('Only a request pending verification can be verified.');
  return raise(user, 'VERIFY', row.applicationId, ACTIONS.VERIFY_PROFESSIONAL_CHANGE, { remarks: input.remarks, proceeding: { requestId: row.id } }, meta);
}

export async function reviewProfessionalChange(user: AuthUser, id: string, input: ProfessionalChangeStepInput, meta: Meta) {
  requireView(user);
  const row = await requireRequest(user, id);
  assertExpected(row.status, input.expectedStatus);
  if (!canReview(row.status)) throw conflict('Only a verified request can be reviewed.');
  return raise(user, 'REVIEW', row.applicationId, ACTIONS.REVIEW_PROFESSIONAL_CHANGE, { remarks: input.remarks, proceeding: { requestId: row.id } }, meta);
}

export async function decideProfessionalChange(user: AuthUser, id: string, input: DecideProfessionalChangeInput, meta: Meta) {
  requireView(user);
  const row = await requireRequest(user, id);
  assertExpected(row.status, input.expectedStatus);
  if (!canDecide(row.status)) throw conflict('Only a reviewed request can be decided.');
  const action = input.decision === 'APPROVED' ? ACTIONS.APPROVE_PROFESSIONAL_CHANGE : ACTIONS.REJECT_PROFESSIONAL_CHANGE;
  return raise(user, 'DECIDE', row.applicationId, action, { remarks: input.remarks, proceeding: { requestId: row.id } }, meta);
}
