import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, type AuthUser } from '@/server/auth/context';
import { badRequest, conflict, forbidden, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { ACTIONS, stageName } from '@/lib/workflow';
import {
  INSPECTION_RECOMMENDATION_LABEL,
  OCCUPANCY_DOCUMENTS,
  OCCUPANCY_DOCUMENT_LABEL,
  OCCUPANCY_PHOTO_LABEL,
  OCCUPANCY_PHOTO_VIEWS,
  OCCUPANCY_STEP_ACTION,
  OCCUPANCY_STEP_CAPABILITY,
  REVIEW_RECOMMENDATION_LABEL,
  STEP_FROM,
  compareAsBuilt,
  completionDateProblem,
  demoAsBuilt,
  isOccupancyDocumentKind,
  isOccupancyOpen,
  missingOccupancyDocuments,
  occupancyBlocker,
  type AsBuiltFigures,
  type InspectionRecommendation,
  type OccupancyDocument,
  type OccupancyDocumentKind,
  type OccupancyPhoto,
  type OccupancyPhotoView,
  type OccupancyRegisterState,
  type OccupancyStatus,
  type OccupancyStep,
  type ReviewRecommendation,
} from '@/lib/occupancy';
import type {
  DecideOccupancyInput,
  InspectOccupancyInput,
  RecommendOccupancyInput,
  RespondOccupancyInput,
  ScheduleOccupancyInput,
  ShortfallOccupancyInput,
  SubmitOccupancyInput,
} from '@/lib/schemas/occupancy';
import { performSystemActionInTx } from '@/server/workflow/engine';
import { renderDemoAttachment } from '@/server/proceedings/documents';
import { roleTitle } from './show-cause';
import { storeUpload } from './files';
import { audit } from './audit';
import { certificateFilename, renderOccupancyCertificate, type CertificateSnapshot } from '@/server/occupancy/certificate-pdf';

/**
 * THE OCCUPANCY SERVICE.
 *
 *   LTP: completion intimation + occupancy submission
 *   TPA: schedule and record the final inspection
 *   ZDD: as-built review — recommend, or raise a shortfall
 *   LTP: answer the shortfall (the building is inspected again)
 *   ZJD: approve │ reject, then issue the occupancy certificate
 *
 * Every step is a workflow transition on the building permission file (the
 * nine OCCUPANCY rows at CLOSED_APPROVED), raised here as a SYSTEM step once
 * this service has checked the step's OCCUPANCY_* capability and row scope.
 * The engine re-checks inside its transaction — the file is APPROVED, the
 * order ISSUED, work initiated, the occupancy application in the right
 * status — runs the OCCUPANCY effect, and writes the history and audit rows.
 * Checks made here only explain a refusal before anything is uploaded.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };
export type Upload = { name: string; type: string; bytes: Buffer };
export type OccupancyUploads = { documents: Partial<Record<OccupancyDocumentKind, Upload>>; photos: Partial<Record<OccupancyPhotoView, Upload>> };

const TX_LIMITS = { timeout: 25_000, maxWait: 10_000 } as const;
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const PHOTO_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;
const MAX_BYTES = 10 * 1024 * 1024;

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  ltpUserId: true,
  zoneId: true,
  approvedAt: true,
  zone: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true } },
  ltp: { select: { id: true, name: true, ltpLicenceNo: true } },
  approvalOrder: { select: { id: true, orderNumber: true, status: true, issuedAt: true, validUntil: true, revokedAt: true } },
  workCommencement: { select: { commencementNumber: true, commencementDate: true, notifiedAt: true } },
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const docs = (v: unknown): OccupancyDocument[] => (Array.isArray(v) ? (v as OccupancyDocument[]) : []);
const photos = (v: unknown): OccupancyPhoto[] => (Array.isArray(v) ? (v as OccupancyPhoto[]) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const ownerOf = (app: ApplicationRow) => app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '';
const today = () => new Date(new Date().toISOString().slice(0, 10));

/** "TPA,ZDD" → "Town Planning Assistant / Zonal Deputy Director". */
function deskLabel(roleKeys: string, status: string) {
  if (!isOccupancyOpen(status)) return 'Closed';
  const keys = roleKeys.split(',').filter(Boolean);
  return keys.length ? keys.map(roleTitle).join(' / ') : '—';
}

/** Recommendation column: the reviewing desk's, else the inspector's. */
function recommendationLabel(review: string, inspection: string | undefined) {
  if (review) return REVIEW_RECOMMENDATION_LABEL[review as ReviewRecommendation] ?? review;
  if (inspection) return INSPECTION_RECOMMENDATION_LABEL[inspection as InspectionRecommendation] ?? inspection;
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.OCCUPANCY_VIEW)) throw forbidden('Your role does not include the occupancy register.');
}

/** Files that have reached occupancy: work initiated, or an application made. */
const registerWhere = (user: AuthUser): Prisma.ApplicationWhereInput => ({
  deletedAt: null,
  ...applicationScope(user),
  OR: [{ workCommencement: { is: { commencementDate: { lte: today() } } } }, { occupancies: { some: {} } }],
});

function stateWhere(state: string): Prisma.ApplicationWhereInput | null {
  if (state === 'COMPLETION_PENDING') {
    return { status: 'APPROVED', occupancies: { none: {} }, workCommencement: { is: { commencementDate: { lte: today() } } } };
  }
  if (state) return { occupancies: { some: { isCurrent: true, status: state } } };
  return null;
}

async function requireApplication(user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');
  const app = await prisma.application.findFirst({ where: { id, deletedAt: null, ...applicationScope(user) }, select: APPLICATION_SELECT });
  if (!app) throw notFound('That application could not be found.');
  return app;
}

/** The role the step is taken in: one the caller holds that the DATABASE grants the step's capability to. */
async function actingRole(user: AuthUser, step: OccupancyStep): Promise<string | null> {
  const capability = OCCUPANCY_STEP_CAPABILITY[step];
  if (!can(user, capability)) return null;
  const role = await prisma.role.findFirst({
    where: { key: { in: user.roleKeys }, permissions: { some: { permission: { key: capability } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return role?.key ?? null;
}

const actionFor = (step: OccupancyStep, outcome?: string) =>
  step === 'DECIDE' ? (outcome === 'REJECTED' ? ACTIONS.REJECT_OCCUPANCY : ACTIONS.APPROVE_OCCUPANCY) : OCCUPANCY_STEP_ACTION[step];

/** Whether the file's workflow carries this step where the file is. */
async function workflowAllows(app: { id: string; status: string }, actionCode: string) {
  const instance = await prisma.workflowInstance.findUnique({ where: { applicationId: app.id }, select: { workflowId: true, currentStageId: true } });
  if (!instance?.currentStageId) return { allowed: false, reason: 'The file has no workflow position.', guards: [] as string[] };
  const t = await prisma.workflowTransition.findFirst({
    where: {
      workflowId: instance.workflowId,
      fromStageId: instance.currentStageId,
      isActive: true,
      action: { code: actionCode },
      OR: [{ fromStatus: app.status as never }, { fromStatus: null }],
    },
    select: { guards: true },
  });
  return t
    ? { allowed: true, reason: '', guards: (t.guards as string[]) ?? [] }
    : { allowed: false, reason: 'The workflow does not allow this occupancy step on this file where it stands.', guards: [] as string[] };
}

type Offer = { offered: boolean; available: boolean; reason: string };
const NONE: Offer = { offered: false, available: false, reason: '' };

async function currentOf(applicationId: string) {
  return prisma.occupancyApplication.findFirst({ where: { applicationId, isCurrent: true } });
}

/** Blocker for a fresh application, asked as the engine will. */
async function submitBlocker(app: ApplicationRow) {
  const [wf, open, issued] = await Promise.all([
    workflowAllows(app, ACTIONS.SUBMIT_OCCUPANCY),
    prisma.occupancyApplication.findFirst({
      where: { applicationId: app.id, status: { notIn: ['REJECTED', 'CERTIFICATE_ISSUED'] } },
      select: { occupancyNumber: true },
    }),
    prisma.occupancyApplication.count({ where: { applicationId: app.id, status: 'CERTIFICATE_ISSUED' } }),
  ]);
  const blocked = occupancyBlocker({
    applicationStatus: app.status,
    order: app.approvalOrder,
    commencementDate: app.workCommencement?.commencementDate ?? null,
    // "Where required" is the workflow row's guard, not a code switch.
    requiresCommencement: wf.guards.includes('work_initiated'),
    openOccupancyNumber: open?.occupancyNumber ?? null,
    certificateIssued: issued > 0,
    now: new Date(),
  });
  return blocked ?? (wf.allowed ? null : wf.reason);
}

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type OccupancyListQuery = { q?: string; state?: string; page?: number; pageSize?: number };

export async function listOccupancy(user: AuthUser, query: OccupancyListQuery = {}) {
  requireView(user);
  const and: Prisma.ApplicationWhereInput[] = [registerWhere(user)];
  const byState = query.state ? stateWhere(query.state) : null;
  if (byState) and.push(byState);
  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: 'insensitive' } },
        { applicant: { ownerName: { contains: q, mode: 'insensitive' } } },
        { applicant: { name: { contains: q, mode: 'insensitive' } } },
        { approvalOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { occupancies: { some: { occupancyNumber: { contains: q, mode: 'insensitive' } } } },
        { occupancies: { some: { certificateNumber: { contains: q, mode: 'insensitive' } } } },
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
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...APPLICATION_SELECT,
        occupancies: {
          where: { isCurrent: true },
          take: 1,
          include: { inspections: { orderBy: { round: 'desc' }, take: 1 } },
        },
      },
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((app) => {
      const occ = app.occupancies[0];
      const insp = occ?.inspections[0];
      const state: OccupancyRegisterState = (occ?.status as OccupancyStatus) ?? 'COMPLETION_PENDING';
      return {
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        occupancyNumber: occ?.occupancyNumber ?? '',
        orderNumber: app.approvalOrder?.orderNumber ?? '',
        owner: occ?.ownerName || ownerOf(app),
        completionDate: occ?.completionDate ?? null,
        submissionDate: occ?.submittedAt ?? null,
        inspectionDate: insp ? insp.inspectedAt ?? insp.scheduledFor : null,
        inspectionDone: insp?.status === 'COMPLETED',
        state,
        recommendation: occ ? recommendationLabel(occ.recommendation, insp?.recommendation) : '',
        currentDesk: occ ? deskLabel(occ.currentDeskRoleKey, occ.status) : 'Applicant',
        certificateNumber: occ?.certificateNumber ?? '',
      };
    }),
  };
}

export async function occupancySummary(user: AuthUser) {
  requireView(user);
  const states = ['COMPLETION_PENDING', 'SUBMITTED', 'INSPECTION_PENDING', 'INSPECTION_COMPLETED', 'SHORTFALL', 'RECOMMENDED', 'APPROVED', 'CERTIFICATE_ISSUED', 'REJECTED'];
  const counts = await Promise.all(states.map((s) => prisma.application.count({ where: { AND: [registerWhere(user), stateWhere(s)!] } })));
  return Object.fromEntries(states.map((s, i) => [s, counts[i]])) as Record<OccupancyRegisterState, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// One file
// ═══════════════════════════════════════════════════════════════════════════

async function offer(user: AuthUser, app: ApplicationRow, step: Exclude<OccupancyStep, 'SUBMIT'>, status: string | undefined, outcome?: string): Promise<Offer> {
  if (!can(user, OCCUPANCY_STEP_CAPABILITY[step])) return NONE;
  if (status !== STEP_FROM[step]) return NONE;
  const wf = await workflowAllows(app, actionFor(step, outcome));
  return { offered: true, available: wf.allowed, reason: wf.reason };
}

/** Officers who may conduct a final inspection in the file's zone. */
async function inspectorsFor(zoneId: string | null) {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: { not: ROLES.SYSTEM_ADMIN }, permissions: { some: { permission: { key: CAPABILITIES.OCCUPANCY_INSPECT } } } } } },
      ...(zoneId ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, designation: true },
    take: 50,
  });
  return users.map((u) => ({ id: u.id, name: u.name, designation: u.designation ?? '' }));
}

export async function getApplicationOccupancy(user: AuthUser, applicationId: string) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const [all, blocker] = await Promise.all([
    prisma.occupancyApplication.findMany({
      where: { applicationId: app.id },
      orderBy: { submittedAt: 'desc' },
      include: { inspections: { orderBy: { round: 'asc' } }, events: { orderBy: { occurredAt: 'desc' } } },
    }),
    submitBlocker(app),
  ]);
  const occ = all.find((o) => o.isCurrent) ?? null;
  const status = occ?.status;

  const submitRole = await actingRole(user, 'SUBMIT');
  const submit: Offer = submitRole ? { offered: true, available: !blocker, reason: blocker ?? '' } : NONE;
  const [schedule, inspect, recommend, shortfall, respond, approve, reject, issue] = await Promise.all([
    offer(user, app, 'SCHEDULE', status),
    offer(user, app, 'INSPECT', status),
    offer(user, app, 'RECOMMEND', status),
    offer(user, app, 'SHORTFALL', status),
    offer(user, app, 'RESPOND', status),
    offer(user, app, 'DECIDE', status, 'APPROVED'),
    offer(user, app, 'DECIDE', status, 'REJECTED'),
    offer(user, app, 'ISSUE', status),
  ]);
  const latest = occ?.inspections.filter((i) => i.status === 'COMPLETED').at(-1);
  const approved = (occ?.approvedFigures ?? {}) as AsBuiltFigures;
  const asBuilt = (latest?.asBuiltFigures ?? {}) as AsBuiltFigures;

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      fileDesk: stageName(app.currentStageCode),
      zone: app.zone?.name ?? '',
      approvedAt: app.approvedAt,
    },
    owner: ownerOf(app),
    ltp: { name: app.ltp.name, licenceNo: app.ltp.ltpLicenceNo ?? '' },
    order: app.approvalOrder
      ? { id: app.approvalOrder.id, orderNumber: app.approvalOrder.orderNumber, status: app.approvalOrder.revokedAt ? 'REVOKED' : app.approvalOrder.status, issuedAt: app.approvalOrder.issuedAt }
      : null,
    commencement: app.workCommencement,
    state: (status ?? 'COMPLETION_PENDING') as OccupancyRegisterState,
    occupancy: occ
      ? {
          id: occ.id,
          occupancyNumber: occ.occupancyNumber,
          status: occ.status,
          round: occ.round,
          currentDesk: deskLabel(occ.currentDeskRoleKey, occ.status),
          orderNumber: occ.orderNumber,
          commencementNumber: occ.commencementNumber,
          commencementDate: occ.commencementDate,
          completionDate: occ.completionDate,
          completionRemarks: occ.completionRemarks,
          documents: docs(occ.documents),
          submittedAt: occ.submittedAt,
          submittedByName: occ.submittedByName,
          recommendation: occ.recommendation,
          recommendationLabel: recommendationLabel(occ.recommendation, latest?.recommendation),
          recommendationNotes: occ.recommendationNotes,
          reviewedByName: occ.reviewedByName,
          reviewedAt: occ.reviewedAt,
          shortfall: occ.shortfallRaisedAt
            ? {
                items: strings(occ.shortfallItems),
                remarks: occ.shortfallRemarks,
                raisedByName: occ.shortfallRaisedByName,
                raisedAt: occ.shortfallRaisedAt,
                response: occ.shortfallResponse,
                respondedAt: occ.shortfallRespondedAt,
              }
            : null,
          decision: occ.decision,
          decisionRemarks: occ.decisionRemarks,
          decidedByName: occ.decidedByName,
          decidedAt: occ.decidedAt,
          certificate: occ.certificateNumber
            ? {
                certificateNumber: occ.certificateNumber,
                issuedAt: occ.certificateIssuedAt,
                issuedByName: occ.certificateIssuedByName,
                approvedAreaSqm: occ.approvedAreaSqm,
                completedAreaSqm: occ.completedAreaSqm,
                conditions: strings(occ.certificateConditions),
                outwardEntryId: occ.outwardEntryId,
                outwardNumber: occ.outwardNumber,
                isDemo: env.demoMode,
              }
            : null,
          inspections: occ.inspections.map((i) => ({
            id: i.id,
            round: i.round,
            status: i.status,
            scheduledFor: i.scheduledFor,
            inspectorName: i.inspectorName,
            scheduledByName: i.scheduledByName,
            inspectedAt: i.inspectedAt,
            siteCondition: i.siteCondition,
            actualConstruction: i.actualConstruction,
            approvedConstruction: i.approvedConstruction,
            deviations: i.deviations,
            remarks: i.remarks,
            photos: photos(i.photos),
            recommendation: i.recommendation,
            asBuiltSource: i.asBuiltSource,
          })),
          comparison: latest ? compareAsBuilt(approved, asBuilt) : compareAsBuilt(approved, {}),
          asBuiltSource: latest?.asBuiltSource ?? '',
          approvedFigures: approved,
          events: occ.events,
        }
      : null,
    history: all
      .filter((o) => !o.isCurrent)
      .map((o) => ({ id: o.id, occupancyNumber: o.occupancyNumber, status: o.status, submittedAt: o.submittedAt, decidedAt: o.decidedAt, decisionRemarks: o.decisionRemarks })),
    blocker,
    inspectors: schedule.offered ? await inspectorsFor(app.zoneId) : [],
    permissions: { submit, schedule, inspect, recommend, shortfall, respond, approve, reject, issue, demoAllowed: env.demoMode },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Files — stored before the transaction (storage cannot be rolled back)
// ═══════════════════════════════════════════════════════════════════════════

async function storeDocuments(app: ApplicationRow, user: AuthUser, uploads: OccupancyUploads['documents'], demoKinds: OccupancyDocumentKind[]) {
  if (demoKinds.length && !env.demoMode) throw badRequest('A demo placeholder document can only be used in the demonstration environment.');
  const now = new Date().toISOString();
  const out: OccupancyDocument[] = [];
  for (const kind of OCCUPANCY_DOCUMENTS) {
    const file = uploads[kind];
    if (file) {
      const stored = await storeUpload({ applicationId: app.id, kind: 'occupancy', file, uploadedById: user.id, allowedExtensions: DOCUMENT_EXTENSIONS, maxBytes: MAX_BYTES });
      out.push({ kind, fileObjectId: stored.id, fileName: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, isDemo: false, addedAt: now, addedByName: user.name, round: 1 });
    } else if (demoKinds.includes(kind)) {
      out.push({ kind, fileObjectId: null, fileName: `${kind.toLowerCase().replace(/_/g, '-')}-DEMO.pdf`, mimeType: 'application/pdf', sizeBytes: 0, isDemo: true, addedAt: now, addedByName: user.name, round: 1 });
    }
  }
  return out;
}

async function storePhotos(app: ApplicationRow, user: AuthUser, uploads: OccupancyUploads['photos'], demoViews: OccupancyPhotoView[]) {
  if (demoViews.length && !env.demoMode) throw badRequest('Demo photographs can only be used in the demonstration environment.');
  const now = new Date().toISOString();
  const out: OccupancyPhoto[] = [];
  for (const view of OCCUPANCY_PHOTO_VIEWS) {
    const file = uploads[view];
    if (file) {
      const stored = await storeUpload({ applicationId: app.id, kind: 'occupancy', file, uploadedById: user.id, allowedExtensions: PHOTO_EXTENSIONS, maxBytes: MAX_BYTES });
      out.push({ view, fileObjectId: stored.id, fileName: stored.originalName, mimeType: stored.mimeType, isDemo: false, capturedAt: now });
    } else if (demoViews.includes(view)) {
      out.push({ view, fileObjectId: null, fileName: `${view.toLowerCase()}-DEMO.svg`, mimeType: 'image/svg+xml', isDemo: true, capturedAt: now });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Steps — every one a workflow transition
// ═══════════════════════════════════════════════════════════════════════════

async function raise(
  user: AuthUser,
  app: ApplicationRow,
  step: OccupancyStep,
  input: { remarks: string; proceeding: Record<string, unknown>; outcome?: string },
  meta: Meta
) {
  const roleKey = await actingRole(user, step);
  if (!roleKey) throw forbidden('This step of an occupancy application is not your desk’s.');
  const action = actionFor(step, input.outcome);
  const wf = await workflowAllows(app, action);
  if (!wf.allowed) throw conflict(wf.reason);
  return prisma.$transaction(
    (tx) =>
      performSystemActionInTx(tx, {
        applicationId: app.id,
        actionCode: action,
        input: { remarks: input.remarks, proceeding: input.proceeding },
        meta,
        onBehalfOf: { id: user.id, name: user.name, roleKey },
      }),
    TX_LIMITS
  );
}

/** Refuses before any upload when the step is not this caller's, or the application has moved on. */
async function precheck(user: AuthUser, app: ApplicationRow, step: Exclude<OccupancyStep, 'SUBMIT'>, expectedStatus?: string) {
  if (!(await actingRole(user, step))) throw forbidden('This step of an occupancy application is not your desk’s.');
  const occ = await currentOf(app.id);
  if (!occ) throw conflict('There is no occupancy application on this file.');
  if (expectedStatus && expectedStatus !== occ.status) throw conflict('This occupancy application has moved on. Reload to see where it stands.', 'STALE_WRITE');
  if (occ.status !== STEP_FROM[step]) throw conflict(`This step is not open while the application is ${occ.status.toLowerCase().replace(/_/g, ' ')}.`);
  return occ;
}

export async function submitOccupancyApplication(user: AuthUser, applicationId: string, input: SubmitOccupancyInput & { uploads?: OccupancyUploads }, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  if (!(await actingRole(user, 'SUBMIT'))) throw forbidden('Completion is intimated by the file’s technical professional.');
  const blocker = await submitBlocker(app);
  if (blocker) throw conflict(blocker);
  const dateProblem = completionDateProblem(input.completionDate, app.workCommencement?.commencementDate ?? null, new Date());
  if (dateProblem) throw badRequest(dateProblem, [{ path: 'completionDate', message: dateProblem }]);

  const uploads = input.uploads?.documents ?? {};
  const named = input.demoKinds.split(',').map((k) => k.trim()).filter(isOccupancyDocumentKind);
  const demoKinds = input.demoDocuments ? OCCUPANCY_DOCUMENTS.filter((k) => !uploads[k] && named.includes(k)) : [];
  const missing = missingOccupancyDocuments([...Object.keys(uploads).filter((k) => uploads[k as OccupancyDocumentKind]), ...demoKinds]);
  if (missing.length) throw badRequest(`Attach the ${missing.map((k) => OCCUPANCY_DOCUMENT_LABEL[k].toLowerCase()).join(' and the ')}.`);
  const documents = await storeDocuments(app, user, uploads, demoKinds);

  return raise(user, app, 'SUBMIT', { remarks: input.remarks, proceeding: { completionDate: input.completionDate, completionRemarks: input.remarks, documents } }, meta);
}

export async function scheduleOccupancyInspection(user: AuthUser, applicationId: string, input: ScheduleOccupancyInput, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'SCHEDULE', input.expectedStatus);
  return raise(user, app, 'SCHEDULE', { remarks: input.remarks, proceeding: { occupancyId: occ.id, scheduledFor: input.scheduledFor, inspectorId: input.inspectorId } }, meta);
}

export async function recordOccupancyInspection(user: AuthUser, applicationId: string, input: InspectOccupancyInput & { uploads?: OccupancyUploads }, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'INSPECT', input.expectedStatus);

  // As-built figures: measured ones as entered; in demo mode, generated ones
  // for any the inspector left blank — labelled DEMO on the record.
  const entered: AsBuiltFigures = input.asBuilt ?? {};
  const anyEntered = Object.values(entered).some((v) => v != null);
  let asBuilt = entered;
  let asBuiltSource: 'MEASURED' | 'DEMO' = 'MEASURED';
  if (input.demoAsBuilt) {
    if (!env.demoMode) throw badRequest('Demo as-built figures can only be used in the demonstration environment.');
    const demo = demoAsBuilt(occ.approvedFigures as AsBuiltFigures, occ.id + occ.round, input.demoVariant);
    asBuilt = { ...demo, ...Object.fromEntries(Object.entries(entered).filter(([, v]) => v != null)) };
    asBuiltSource = 'DEMO';
  } else if (!anyEntered) {
    throw badRequest('Record the as-built figures found on site.');
  }

  const demoViews = input.demoPhotos ? [...OCCUPANCY_PHOTO_VIEWS] : [];
  const stored = await storePhotos(app, user, input.uploads?.photos ?? {}, demoViews.filter((v) => !input.uploads?.photos[v]));
  return raise(
    user,
    app,
    'INSPECT',
    {
      remarks: input.remarks,
      proceeding: {
        occupancyId: occ.id,
        inspectionDate: input.inspectionDate,
        siteCondition: input.siteCondition,
        actualConstruction: input.actualConstruction,
        approvedConstruction: input.approvedConstruction,
        deviations: input.deviations,
        photos: stored,
        recommendation: input.recommendation,
        asBuilt,
        asBuiltSource,
      },
    },
    meta
  );
}

export async function recommendOccupancyApplication(user: AuthUser, applicationId: string, input: RecommendOccupancyInput, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'RECOMMEND', input.expectedStatus);
  return raise(user, app, 'RECOMMEND', { remarks: input.remarks, proceeding: { occupancyId: occ.id, recommendation: input.recommendation } }, meta);
}

export async function raiseOccupancyShortfallFor(user: AuthUser, applicationId: string, input: ShortfallOccupancyInput, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'SHORTFALL', input.expectedStatus);
  return raise(user, app, 'SHORTFALL', { remarks: input.remarks, proceeding: { occupancyId: occ.id, items: input.items } }, meta);
}

export async function respondOccupancyShortfall(user: AuthUser, applicationId: string, input: RespondOccupancyInput & { uploads?: OccupancyUploads }, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'RESPOND', input.expectedStatus);
  const named = input.demoKinds.split(',').map((k) => k.trim()).filter(isOccupancyDocumentKind);
  const documents = await storeDocuments(app, user, input.uploads?.documents ?? {}, input.demoDocuments ? named : []);
  return raise(user, app, 'RESPOND', { remarks: input.remarks, proceeding: { occupancyId: occ.id, documents } }, meta);
}

export async function decideOccupancyApplication(user: AuthUser, applicationId: string, input: DecideOccupancyInput, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'DECIDE', input.expectedStatus);
  return raise(user, app, 'DECIDE', { remarks: input.remarks, outcome: input.decision, proceeding: { occupancyId: occ.id } }, meta);
}

export async function issueOccupancyCertificateFor(user: AuthUser, applicationId: string, input: { remarks: string; expectedStatus?: string }, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await precheck(user, app, 'ISSUE', input.expectedStatus);
  return raise(user, app, 'ISSUE', { remarks: input.remarks, proceeding: { occupancyId: occ.id } }, meta);
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading files
// ═══════════════════════════════════════════════════════════════════════════

async function readStored(fileObjectId: string) {
  const file = await prisma.fileObject.findUnique({ where: { id: fileObjectId }, select: { storageKey: true, mimeType: true, scanStatus: true, originalName: true } });
  if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
    return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType, fileName: file.originalName };
  }
  throw conflict(file?.scanStatus === 'PENDING' ? 'The file is still being scanned.' : 'The file is withheld — it did not pass the virus scan.');
}

export async function readOccupancyDocument(user: AuthUser, applicationId: string, index: number) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await currentOf(app.id);
  const doc = docs(occ?.documents)[index];
  if (!occ || !doc) throw notFound('That document could not be found.');
  if (doc.fileObjectId) return readStored(doc.fileObjectId);
  const html = renderDemoAttachment(doc.fileName, `${occ.occupancyNumber} — ${OCCUPANCY_DOCUMENT_LABEL[doc.kind].toLowerCase()}`);
  return { bytes: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8', fileName: doc.fileName.replace(/\.pdf$/, '.html') };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function readOccupancyPhoto(user: AuthUser, applicationId: string, round: number, index: number) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await currentOf(app.id);
  const inspection = occ ? await prisma.occupancyInspection.findUnique({ where: { occupancyId_round: { occupancyId: occ.id, round } } }) : null;
  const photo = photos(inspection?.photos)[index];
  if (!occ || !inspection || !photo) throw notFound('That photograph could not be found.');
  if (photo.fileObjectId) return readStored(photo.fileObjectId);
  // A labelled placeholder — never a real photograph.
  const label = OCCUPANCY_PHOTO_LABEL[photo.view];
  const hue = (OCCUPANCY_PHOTO_VIEWS.indexOf(photo.view) * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440" viewBox="0 0 640 440">
<rect width="640" height="440" fill="hsl(${hue},18%,32%)"/>
<rect x="150" y="120" width="340" height="230" fill="hsl(${hue},12%,78%)" stroke="#fff" stroke-width="3"/>
<path d="M130 130 L320 50 L510 130 Z" fill="hsl(${hue},20%,55%)" stroke="#fff" stroke-width="3"/>
${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${180 + c * 78}" y="${145 + r * 62}" width="40" height="36" fill="hsl(${hue},30%,40%)"/>`).join('')).join('')}
<rect x="0" y="0" width="640" height="44" fill="rgba(0,0,0,.55)"/>
<text x="20" y="29" font-family="ui-sans-serif,system-ui,sans-serif" font-size="18" fill="#fff">${esc(label)} · ${esc(occ.occupancyNumber)} · round ${round}</text>
<rect x="0" y="396" width="640" height="44" fill="rgba(0,0,0,.55)"/>
<text x="20" y="424" font-family="ui-sans-serif,system-ui,sans-serif" font-size="16" fill="#fbbf24">DEMO PLACEHOLDER — not a photograph of the site</text>
</svg>`;
  return { bytes: Buffer.from(svg, 'utf8'), mimeType: 'image/svg+xml', fileName: photo.fileName };
}

/**
 * The occupancy certificate PDF, rendered from its frozen snapshot. Audited
 * before the bytes leave, as the building permission order's download is.
 */
export async function readOccupancyCertificate(user: AuthUser, applicationId: string, meta: Meta) {
  requireView(user);
  const app = await requireApplication(user, applicationId);
  const occ = await prisma.occupancyApplication.findFirst({
    where: { applicationId: app.id, status: 'CERTIFICATE_ISSUED' },
    select: { id: true, certificateNumber: true, certificateSnapshot: true },
  });
  if (!occ?.certificateNumber) throw notFound('No occupancy certificate has been issued on this file.');
  const bytes = renderOccupancyCertificate(occ.certificateSnapshot as unknown as CertificateSnapshot);
  await audit(prisma, {
    actor: user,
    action: 'OCCUPANCY_CERTIFICATE_DOWNLOADED',
    entityType: 'OccupancyApplication',
    entityId: occ.id,
    applicationId: app.id,
    after: { certificateNumber: occ.certificateNumber, isDemo: env.demoMode },
    ...meta,
  });
  return { bytes, fileName: certificateFilename(occ.certificateNumber) };
}
