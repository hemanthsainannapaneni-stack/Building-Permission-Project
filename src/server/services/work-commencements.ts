import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, isLtp, type AuthUser } from '@/server/auth/context';
import { badRequest, conflict, forbidden, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES } from '@/lib/constants';
import { ACTIONS, stageName } from '@/lib/workflow';
import {
  COMMENCEMENT_DOCUMENTS,
  COMMENCEMENT_DOCUMENT_LABEL,
  commencementBlocker,
  commencementDateProblem,
  commencementState,
  dayOf,
  isCommencementDocumentKind,
  missingCommencementDocuments,
  type CommencementDocument,
  type CommencementDocumentKind,
  type CommencementState,
} from '@/lib/commencement';
import type { NotifyCommencementInput } from '@/lib/schemas/commencement';
import { performSystemActionInTx } from '@/server/workflow/engine';
import { renderDemoAttachment } from '@/server/proceedings/documents';
import { storeUpload } from './files';

/**
 * THE WORK INITIATED SERVICE — commencement of work after approval.
 *
 *   Approved → Proceeding issued → [NOTIFY_WORK_COMMENCEMENT] → Work initiated
 *
 * The register is built over APPROVED files, not over notices: a file whose
 * proceeding is issued and on which nothing has been notified is exactly the
 * row the department wants to see ("Proceeding issued"), and it has no notice
 * row to list.
 *
 * The notice itself is the workflow transition NOTIFY_WORK_COMMENCEMENT,
 * raised here as a SYSTEM step on the professional's behalf once this service
 * has checked COMMENCEMENT_NOTIFY and row scope. The engine then re-checks
 * everything that matters inside its transaction — the file is APPROVED (the
 * row's fromStatus), the order is ISSUED (`proceeding_issued`), nothing was
 * notified before (`no_work_commencement`) — writes the history row and the
 * audit row, and emits WORK_INITIATED. The checks here exist to explain a
 * refusal before anything is uploaded, never to replace the engine's.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
export type Upload = { name: string; type: string; bytes: Buffer };
export type CommencementUploads = Partial<Record<CommencementDocumentKind, Upload>>;

const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  ltpUserId: true,
  approvedAt: true,
  zone: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true } },
  ltp: { select: { id: true, name: true, ltpLicenceNo: true, firmName: true } },
  approvalOrder: {
    select: { id: true, orderNumber: true, status: true, issuedAt: true, validUntil: true, revokedAt: true },
  },
  workCommencement: true,
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const docs = (v: unknown): CommencementDocument[] => (Array.isArray(v) ? (v as CommencementDocument[]) : []);
const ownerOf = (app: ApplicationRow) => app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '';
const orderIssued = (app: ApplicationRow) =>
  app.approvalOrder?.status === 'ISSUED' && !app.approvalOrder.revokedAt;

function stateOf(app: ApplicationRow, now = new Date()): CommencementState {
  return commencementState({ orderIssued: orderIssued(app), commencementDate: app.workCommencement?.commencementDate, now });
}

function blockerOf(app: ApplicationRow, now = new Date()) {
  return commencementBlocker({
    applicationStatus: app.status,
    order: app.approvalOrder,
    alreadyNotified: Boolean(app.workCommencement),
    now,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.COMMENCEMENT_VIEW)) {
    throw forbidden('Your role does not include the Work Initiated register.');
  }
}

/** Approved files, and any file that has a notice (it may since have been revoked). */
const registerWhere = (user: AuthUser): Prisma.ApplicationWhereInput => ({
  deletedAt: null,
  ...applicationScope(user),
  OR: [{ status: 'APPROVED' }, { workCommencement: { isNot: null } }],
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

/** The role the notice is given in: one the caller holds that the DATABASE grants COMMENCEMENT_NOTIFY to. */
async function actingRole(user: AuthUser): Promise<string | null> {
  if (!can(user, CAPABILITIES.COMMENCEMENT_NOTIFY)) return null;
  const role = await prisma.role.findFirst({
    where: { key: { in: user.roleKeys }, permissions: { some: { permission: { key: CAPABILITIES.COMMENCEMENT_NOTIFY } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return role?.key ?? null;
}

/** Whether the file's workflow carries the notice at the stage and status the file is at. */
async function workflowAllows(app: { id: string; status: string }): Promise<{ allowed: boolean; reason: string }> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { applicationId: app.id },
    select: { workflowId: true, currentStageId: true },
  });
  if (!instance?.currentStageId) return { allowed: false, reason: 'The file has no workflow position.' };
  const t = await prisma.workflowTransition.findFirst({
    where: {
      workflowId: instance.workflowId,
      fromStageId: instance.currentStageId,
      isActive: true,
      action: { code: ACTIONS.NOTIFY_WORK_COMMENCEMENT },
      OR: [{ fromStatus: app.status as never }, { fromStatus: null }],
    },
    select: { id: true },
  });
  return t
    ? { allowed: true, reason: '' }
    : { allowed: false, reason: 'The workflow does not allow a commencement notice on this file where it stands.' };
}

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type CommencementListQuery = { q?: string; state?: string; page?: number; pageSize?: number };

function stateWhere(state: string, now: Date): Prisma.ApplicationWhereInput | null {
  const today = dayOf(now);
  switch (state) {
    case 'AWAITING_PROCEEDING':
      return {
        status: 'APPROVED',
        workCommencement: { is: null },
        OR: [{ approvalOrder: { is: null } }, { approvalOrder: { status: { not: 'ISSUED' } } }, { approvalOrder: { revokedAt: { not: null } } }],
      };
    case 'PROCEEDING_ISSUED':
      return { status: 'APPROVED', workCommencement: { is: null }, approvalOrder: { status: 'ISSUED', revokedAt: null } };
    case 'PENDING_COMMENCEMENT':
      return { workCommencement: { commencementDate: { gt: today } } };
    case 'WORK_INITIATED':
      return { workCommencement: { commencementDate: { lte: today } } };
    default:
      return null;
  }
}

export async function listWorkCommencements(user: AuthUser, query: CommencementListQuery = {}) {
  requireView(user);
  const now = new Date();
  const and: Prisma.ApplicationWhereInput[] = [registerWhere(user)];
  const byState = query.state ? stateWhere(query.state, now) : null;
  if (byState) and.push(byState);
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: 'insensitive' } },
        { applicant: { ownerName: { contains: q, mode: 'insensitive' } } },
        { applicant: { name: { contains: q, mode: 'insensitive' } } },
        { ltp: { name: { contains: q, mode: 'insensitive' } } },
        { approvalOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { workCommencement: { contractorName: { contains: q, mode: 'insensitive' } } },
        { workCommencement: { commencementNumber: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  const where = { AND: and };
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const [total, rows] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where,
      orderBy: [{ approvedAt: { sort: 'desc', nulls: 'last' } }, { applicationNumber: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: APPLICATION_SELECT,
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((app) => {
      const wc = app.workCommencement;
      return {
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        applicationStatus: app.status,
        zone: app.zone?.name ?? '',
        owner: ownerOf(app),
        ltp: { name: wc?.ltpName || app.ltp.name, licenceNo: wc?.ltpLicenceNo || app.ltp.ltpLicenceNo || '' },
        order: app.approvalOrder
          ? { orderNumber: app.approvalOrder.orderNumber, status: app.approvalOrder.revokedAt ? 'REVOKED' : app.approvalOrder.status, issuedAt: app.approvalOrder.issuedAt }
          : null,
        contractor: wc?.contractorName ?? '',
        commencementNumber: wc?.commencementNumber ?? '',
        commencementDate: wc?.commencementDate ?? null,
        notifiedAt: wc?.notifiedAt ?? null,
        state: stateOf(app, now),
      };
    }),
  };
}

export async function workCommencementSummary(user: AuthUser) {
  requireView(user);
  const now = new Date();
  const count = (state: string) => prisma.application.count({ where: { AND: [registerWhere(user), stateWhere(state, now)!] } });
  const [awaiting, issued, pending, initiated] = await Promise.all([
    count('AWAITING_PROCEEDING'),
    count('PROCEEDING_ISSUED'),
    count('PENDING_COMMENCEMENT'),
    count('WORK_INITIATED'),
  ]);
  return { awaiting, issued, pending, initiated };
}

// ═══════════════════════════════════════════════════════════════════════════
// One file — the detail page and the application's Work Initiated tab
// ═══════════════════════════════════════════════════════════════════════════

export async function getApplicationCommencement(user: AuthUser, applicationId: string) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const now = new Date();

  const [plan, scrutiny, step, roleKey, wf] = await Promise.all([
    // The approved plan: the drawings in force when the file was approved.
    prisma.drawingVersion.findMany({
      where: { isActive: true, drawing: { applicationId: app.id } },
      orderBy: { uploadedAt: 'asc' },
      select: {
        id: true,
        versionNo: true,
        uploadedAt: true,
        drawing: { select: { title: true, category: true } },
        file: { select: { originalName: true } },
      },
    }),
    prisma.scrutinyResult.findFirst({
      where: { request: { drawingVersion: { drawing: { applicationId: app.id } } } },
      orderBy: { evaluatedAt: 'desc' },
      select: { id: true, outcome: true, evaluatedAt: true, checksRun: true, checksPassed: true, report: { select: { id: true, isDemo: true } } },
    }),
    app.workCommencement?.workflowSequence != null
      ? prisma.workflowHistory.findFirst({
          where: { instance: { applicationId: app.id }, sequence: app.workCommencement.workflowSequence },
          select: { sequence: true, actionCode: true, actorName: true, actorRoleKey: true, occurredAt: true },
        })
      : null,
    actingRole(user),
    workflowAllows(app),
  ]);

  const blocker = blockerOf(app, now);
  const notify = roleKey
    ? { offered: true, available: !blocker && wf.allowed, reason: blocker ?? wf.reason }
    : { offered: false, available: false, reason: '' };
  const order = app.approvalOrder;
  const wc = app.workCommencement;

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      fileDesk: stageName(app.currentStageCode),
      zone: app.zone?.name ?? '',
      approvedAt: app.approvedAt,
    },
    state: stateOf(app, now),
    owner: ownerOf(app),
    ltp: { id: app.ltp.id, name: app.ltp.name, licenceNo: app.ltp.ltpLicenceNo ?? '', firmName: app.ltp.firmName ?? '' },
    order: order
      ? {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.revokedAt ? 'REVOKED' : order.status,
          issuedAt: order.issuedAt,
          validUntil: order.validUntil,
          // An applicant may open the order only once it is issued — the PDF route says so too.
          downloadable: !isLtp(user) || order.status === 'ISSUED',
        }
      : null,
    approvedPlan: plan.map((v) => ({
      id: v.id,
      title: v.drawing.title,
      category: v.drawing.category,
      versionNo: v.versionNo,
      fileName: v.file.originalName,
      uploadedAt: v.uploadedAt,
    })),
    scrutiny: scrutiny
      ? {
          id: scrutiny.id,
          outcome: scrutiny.outcome,
          evaluatedAt: scrutiny.evaluatedAt,
          checksRun: scrutiny.checksRun,
          checksPassed: scrutiny.checksPassed,
          hasReport: Boolean(scrutiny.report),
          isDemo: scrutiny.report?.isDemo ?? false,
        }
      : null,
    commencement: wc
      ? {
          id: wc.id,
          commencementNumber: wc.commencementNumber,
          orderNumber: wc.orderNumber,
          contractor: { name: wc.contractorName, licenceNo: wc.contractorLicenceNo, phone: wc.contractorPhone, address: wc.contractorAddress },
          ltpName: wc.ltpName,
          ltpLicenceNo: wc.ltpLicenceNo,
          commencementDate: wc.commencementDate,
          notifiedAt: wc.notifiedAt,
          notifiedByName: wc.notifiedByName,
          notifiedByRoleKey: wc.notifiedByRoleKey,
          documents: docs(wc.documents),
          remarks: wc.remarks,
          workflowStep: step,
        }
      : null,
    blocker,
    permissions: { notify, demoDocumentAllowed: env.demoMode },
  };
}

export async function readCommencementDocument(user: AuthUser, applicationId: string, index: number) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const doc = docs(app.workCommencement?.documents)[index];
  if (!app.workCommencement || !doc) throw notFound('That document could not be found.');
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
  const html = renderDemoAttachment(doc.fileName, `${app.workCommencement.commencementNumber} — ${COMMENCEMENT_DOCUMENT_LABEL[doc.kind].toLowerCase()}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}

// ═══════════════════════════════════════════════════════════════════════════
// Notify work commencement — the workflow transition
// ═══════════════════════════════════════════════════════════════════════════

async function storeDocuments(
  applicationId: string,
  user: AuthUser,
  uploads: CommencementUploads,
  demoKinds: CommencementDocumentKind[]
): Promise<CommencementDocument[]> {
  if (demoKinds.length && !env.demoMode) {
    throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  }
  const now = new Date().toISOString();
  const out: CommencementDocument[] = [];
  for (const kind of COMMENCEMENT_DOCUMENTS) {
    const file = uploads[kind];
    if (file) {
      const stored = await storeUpload({
        applicationId,
        kind: 'commencements',
        file,
        uploadedById: user.id,
        allowedExtensions: DOCUMENT_EXTENSIONS,
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      out.push({ kind, fileObjectId: stored.id, fileName: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, isDemo: false, addedAt: now, addedByName: user.name });
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

export async function notifyWorkCommencement(
  user: AuthUser,
  applicationId: string,
  input: NotifyCommencementInput & { uploads?: CommencementUploads },
  meta: Meta
) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  // Everything below is asked before any upload, so a refused caller never
  // writes to storage. The engine asks the same questions again, in its
  // transaction, and is the one that decides.
  const roleKey = await actingRole(user);
  if (!roleKey) throw forbidden('Commencement of work is notified by the file’s technical professional.');
  const blocker = blockerOf(app);
  if (blocker) throw conflict(blocker);
  const wf = await workflowAllows(app);
  if (!wf.allowed) throw conflict(wf.reason);
  const dateProblem = commencementDateProblem(input.commencementDate, app.approvalOrder!);
  if (dateProblem) throw badRequest(dateProblem, [{ path: 'commencementDate', message: dateProblem }]);

  const uploads = input.uploads ?? {};
  const named = input.demoKinds.split(',').map((k) => k.trim()).filter(isCommencementDocumentKind);
  const demoKinds = input.demoDocuments ? COMMENCEMENT_DOCUMENTS.filter((k) => !uploads[k] && (!named.length || named.includes(k))) : [];
  const provided = [...Object.keys(uploads).filter((k) => uploads[k as CommencementDocumentKind]), ...demoKinds];
  const missing = missingCommencementDocuments(provided);
  if (missing.length) {
    throw badRequest(`Attach the ${missing.map((k) => COMMENCEMENT_DOCUMENT_LABEL[k].toLowerCase()).join(' and the ')}.`);
  }
  const documents = await storeDocuments(app.id, user, uploads, demoKinds);

  const result = await prisma.$transaction(
    (tx) =>
      performSystemActionInTx(tx, {
        applicationId: app.id,
        actionCode: ACTIONS.NOTIFY_WORK_COMMENCEMENT,
        input: {
          remarks: input.remarks,
          expectedSequence: input.expectedSequence,
          proceeding: {
            commencementDate: input.commencementDate,
            contractor: {
              name: input.contractorName,
              licenceNo: input.contractorLicenceNo,
              phone: input.contractorPhone,
              address: input.contractorAddress,
            },
            documents,
          },
        },
        meta,
        onBehalfOf: { id: user.id, name: user.name, roleKey },
      }),
    TX_LIMITS
  );
  return { ...result, message: 'Commencement of work notified. The department and the owner have been told.' };
}
