import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, type AuthUser } from '@/server/auth/context';
import {
  badRequest,
  conflict,
  forbidden,
  guardFailed,
  notFound,
} from '@/server/http/errors';
import { performActionInTx, type ActionResult } from '@/server/workflow/engine';
import { emit, EVENTS } from '@/server/events/outbox';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES, STAGE_CODES } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { isValidResponse } from '@/lib/checklist';
import {
  DEMO_ESIGN_OTP,
  DEMO_SIGNATURE_DISCLAIMER,
  DEMO_TOKEN_PIN,
  INSPECTION_STATUS,
  MAX_PHOTO_BYTES,
  OPEN_INSPECTION_STATUSES,
  PHOTO_CATEGORY_LABEL,
  PHOTO_EXTENSIONS,
  PROVISIONAL_QUESTIONS_LABEL,
  PROVISIONAL_QUESTIONS_NOTE,
  RECOMMENDATION_ACTION,
  RECOMMENDATION_LABEL,
  SIGNATURE_METHOD_LABEL,
  canonicalReport,
  demoSiteLocation,
  formatCoordinates,
  inspectionReadiness,
  isInspectionOpen,
  isPhotoCategory,
  isRecommendation,
  questionTally,
  type PhotoCategory,
  type Recommendation,
  type SignatureMethod,
} from '@/lib/site-inspection';
import type {
  PhotoMetadataInput,
  RescheduleInspectionInput,
  SaveInspectionInput,
  ScheduleInspectionInput,
  SubmitInspectionInput,
} from '@/lib/schemas/site-inspections';
import { audit } from './audit';
import { storeUpload } from './files';
import { formatNumber, nextSequence } from './numbering';

/**
 * THE SITE INSPECTION SUBSYSTEM — TPA manual §5.8.
 *
 *   schedule → inspect → 27 questions → photographs → recommendation
 *            → sign (DEMO) → submit → the file moves
 *
 * ── Two statements of intent, each one transaction ───────────────────────
 *
 * Booking a visit and moving the file to the inspection desk are the same
 * act, and so are signing a report and routing it. Each is ONE transaction
 * that writes the inspection and calls `performActionInTx`, so a signed report
 * with the file still sitting at the desk — or a booking the workflow never
 * heard of — is not a reachable state. The engine's guards
 * (`site_inspection_scheduled`, `site_inspection_signed`) refuse the same
 * transitions from anywhere else.
 *
 * ── Who may write ────────────────────────────────────────────────────────
 *
 * Booking needs SITE_INSPECTION_SCHEDULE. Everything written about the SITE —
 * answers, photographs, the recommendation, the signature — needs
 * SITE_INSPECTION_CONDUCT **and** being the named inspector. A supervisor can
 * re-book the visit with somebody else; they cannot answer for the officer
 * who went.
 *
 * ── Nothing here is a real signature or a real GPS fix ───────────────────
 *
 * See src/lib/site-inspection.ts. The demo providers fill the same columns a
 * real integration would, and every row and every screen says DEMO.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

/** Twenty-seven response rows, a transition, the audit chain's lock. */
const TX_LIMITS = { timeout: 30_000, maxWait: 10_000 } as const;

/** Photographs per report. Generous; the four cardinal views are the minimum. */
const MAX_PHOTOS = 30;

const INSPECTION_NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';

const DESKS_THAT_SCHEDULE: readonly string[] = [
  STAGE_CODES.TPA_REVIEW,
  STAGE_CODES.TPA_SITE_INSPECTION,
];

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

const APPLICATION_SUMMARY_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  zoneId: true,
  ltpUserId: true,
  zone: { select: { name: true } },
  ltp: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true } },
  property: {
    select: {
      district: true,
      mandal: true,
      village: true,
      localityName: true,
      streetName: true,
      doorNo: true,
      plotNo: true,
      surveyNumbers: true,
      layoutName: true,
      pincode: true,
    },
  },
} satisfies Prisma.ApplicationSelect;

type ApplicationSummaryRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SUMMARY_SELECT }>;

const INSPECTION_ROW_SELECT = {
  id: true,
  inspectionNumber: true,
  applicationId: true,
  round: true,
  status: true,
  inspectorId: true,
  inspectorName: true,
  scheduledByName: true,
  scheduledFor: true,
  scheduleRemarks: true,
  inspectedAt: true,
  stageCode: true,
  latitude: true,
  longitude: true,
  locationSource: true,
  siteAddress: true,
  generalObservation: true,
  recommendation: true,
  recommendationRemarks: true,
  signatureMethod: true,
  signedByName: true,
  signedByRoleKey: true,
  signedAt: true,
  signatureRef: true,
  documentHash: true,
  signatureMetadata: true,
  submittedAt: true,
  lockedAt: true,
  scheduleSequence: true,
  submitSequence: true,
  routedAt: true,
  routedActionCode: true,
  shortfallId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SiteInspectionSelect;

const RESPONSE_SELECT = {
  id: true,
  itemId: true,
  itemNumber: true,
  question: true,
  category: true,
  responseType: true,
  isMandatory: true,
  isProvisional: true,
  response: true,
  observation: true,
  remarks: true,
  status: true,
  answeredAt: true,
  item: { select: { helpText: true, description: true } },
} satisfies Prisma.SiteInspectionResponseSelect;

const PHOTO_SELECT = {
  id: true,
  category: true,
  description: true,
  fileObjectId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  latitude: true,
  longitude: true,
  capturedAt: true,
  isDemoLocation: true,
  uploadedByName: true,
  uploadedAt: true,
} satisfies Prisma.SiteInspectionPhotoSelect;

/** "Plot 14, Sy. No. 212/3, Kondapur, Serilingampally, Rangareddy" */
export function siteAddressOf(property: ApplicationSummaryRow['property']): string {
  if (!property) return '';
  const parts = [
    property.doorNo && `D.No ${property.doorNo}`,
    property.plotNo && `Plot ${property.plotNo}`,
    property.surveyNumbers && `Sy. No. ${property.surveyNumbers}`,
    property.layoutName,
    property.streetName,
    property.localityName,
    property.village,
    property.mandal,
    property.district,
    property.pincode,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.join(', ');
}

const ownerOf = (app: ApplicationSummaryRow) =>
  app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '';

function applicationSummary(app: ApplicationSummaryRow) {
  return {
    id: app.id,
    applicationNumber: app.applicationNumber,
    status: app.status,
    currentStageCode: app.currentStageCode,
    zone: app.zone?.name ?? '',
    ltpName: app.ltp?.name ?? '',
    owner: ownerOf(app),
    site: siteAddressOf(app.property),
    district: app.property?.district ?? '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireCapability(user: AuthUser, capability: string, message: string) {
  if (!can(user, capability as never)) throw forbidden(message);
}

/** An application the caller may see, or 404. Same answer for "not yours". */
async function requireApplication(db: Tx | typeof prisma, user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');
  const app = await db.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: APPLICATION_SUMMARY_SELECT,
  });
  if (!app) throw notFound('That application could not be found.');
  return app;
}

/** An inspection whose application the caller may see, or 404. */
async function requireInspection(db: Tx | typeof prisma, user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That inspection could not be found.');
  const row = await db.siteInspection.findFirst({
    where: { id, application: { deletedAt: null, ...applicationScope(user) } },
    select: {
      ...INSPECTION_ROW_SELECT,
      application: { select: APPLICATION_SUMMARY_SELECT },
    },
  });
  if (!row) throw notFound('That inspection could not be found.');
  return row;
}

/**
 * The write gate for everything recorded about the site.
 *
 * Locked is checked FIRST, and it is final: a signed report is refused
 * whoever asks, including its own inspector.
 */
function assertInspectorMayWrite(
  user: AuthUser,
  inspection: { status: string; lockedAt: Date | null; inspectorId: string; inspectorName: string }
) {
  if (inspection.lockedAt || !isInspectionOpen(inspection.status)) {
    throw conflict('This inspection report has been signed and submitted. It is locked and cannot be changed.');
  }
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_CONDUCT, 'Your role does not conduct site inspections.');
  if (inspection.inspectorId !== user.id) {
    throw forbidden(
      `This inspection is assigned to ${inspection.inspectorName}. Only the assigned inspector can record findings.`
    );
  }
}

/** The zone's TPAs — whoever may be sent to the site. */
async function inspectorCandidates(db: Tx | typeof prisma, zoneId: string | null) {
  return db.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: 'TPA' } } },
      ...(zoneId
        ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] }
        : {}),
    },
    select: { id: true, name: true, designation: true },
    orderBy: { name: 'asc' },
  });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function parseDate(value: string, path: string, message: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(message, [{ path, message }]);
  return d;
}

/**
 * Hands the file's open task to the inspector.
 *
 * The desk belongs to the TPA role; the VISIT belongs to one officer. Without
 * this the booked inspector would find the file in a shared queue that any
 * TPA could claim — and the engine would then refuse the inspector's own
 * submission because somebody else held the task.
 */
async function handTaskTo(tx: Tx, applicationId: string, inspectorId: string, now: Date) {
  const task = await tx.workflowTask.findFirst({
    where: { instance: { applicationId }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    select: { id: true, assignedUserId: true },
  });
  if (!task) return null;
  if (task.assignedUserId !== inspectorId) {
    await tx.workflowTask.update({
      where: { id: task.id },
      data: { assignedUserId: inspectorId, assignedRoleKey: 'TPA', claimedAt: now, status: 'IN_PROGRESS' },
    });
  }
  return task.id;
}

async function currentSequence(db: Tx | typeof prisma, applicationId: string): Promise<number> {
  const last = await db.workflowHistory.findFirst({
    where: { instance: { applicationId } },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  return last?.sequence ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Register
// ═══════════════════════════════════════════════════════════════════════════

export type InspectionListQuery = {
  q?: string;
  applicationId?: string;
  inspectorId?: string;
  /** SCHEDULED | IN_PROGRESS | SUBMITTED | OPEN | OVERDUE */
  status?: string;
  recommendation?: string;
  /** Scheduled-date window, inclusive, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

function listWhere(user: AuthUser, query: InspectionListQuery, now = new Date()): Prisma.SiteInspectionWhereInput {
  const and: Prisma.SiteInspectionWhereInput[] = [
    { application: { deletedAt: null, ...applicationScope(user) } },
  ];

  if (query.applicationId && isUuid(query.applicationId)) and.push({ applicationId: query.applicationId });
  if (query.inspectorId && isUuid(query.inspectorId)) and.push({ inspectorId: query.inspectorId });

  switch (query.status) {
    case 'SCHEDULED':
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      and.push({ status: query.status });
      break;
    case 'OPEN':
      and.push({ status: { in: [...OPEN_INSPECTION_STATUSES] } });
      break;
    case 'OVERDUE':
      and.push({ status: { in: [...OPEN_INSPECTION_STATUSES] }, scheduledFor: { lt: startOfDay(now) } });
      break;
  }

  if (query.recommendation) {
    if (query.recommendation === 'NONE') and.push({ recommendation: '' });
    else if (isRecommendation(query.recommendation)) and.push({ recommendation: query.recommendation });
  }

  const from = query.from ? new Date(`${query.from}T00:00:00`) : null;
  const to = query.to ? new Date(`${query.to}T23:59:59.999`) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    and.push({
      scheduledFor: {
        ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
        ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
      },
    });
  }

  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { inspectionNumber: { contains: q, mode: 'insensitive' } },
        { application: { applicationNumber: { contains: q, mode: 'insensitive' } } },
        { application: { applicant: { ownerName: { contains: q, mode: 'insensitive' } } } },
        { application: { applicant: { name: { contains: q, mode: 'insensitive' } } } },
        { inspectorName: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: and };
}

export async function listInspections(user: AuthUser, query: InspectionListQuery = {}) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const now = new Date();
  const where = listWhere(user, query, now);

  const [total, rows] = await Promise.all([
    prisma.siteInspection.count({ where }),
    prisma.siteInspection.findMany({
      where,
      // Open visits first, soonest first; then the finished ones, newest first.
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'first' } }, { scheduledFor: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...INSPECTION_ROW_SELECT,
        application: { select: APPLICATION_SUMMARY_SELECT },
        _count: { select: { photos: true } },
      },
    }),
  ]);

  const today = startOfDay(now).getTime();

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => ({
      id: r.id,
      inspectionNumber: r.inspectionNumber,
      round: r.round,
      status: r.status,
      inspectorId: r.inspectorId,
      inspectorName: r.inspectorName,
      scheduledFor: r.scheduledFor,
      inspectedAt: r.inspectedAt,
      submittedAt: r.submittedAt,
      recommendation: r.recommendation,
      photoCount: r._count.photos,
      overdue: isInspectionOpen(r.status) && r.scheduledFor.getTime() < today,
      application: applicationSummary(r.application),
    })),
  };
}

export async function inspectionSummary(user: AuthUser) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');
  const scope: Prisma.SiteInspectionWhereInput = {
    application: { deletedAt: null, ...applicationScope(user) },
  };
  const now = new Date();

  const [byStatus, byRecommendation, overdue, mine] = await Promise.all([
    prisma.siteInspection.groupBy({ by: ['status'], where: scope, _count: true }),
    prisma.siteInspection.groupBy({
      by: ['recommendation'],
      where: { ...scope, status: INSPECTION_STATUS.SUBMITTED },
      _count: true,
    }),
    prisma.siteInspection.count({
      where: { ...scope, status: { in: [...OPEN_INSPECTION_STATUSES] }, scheduledFor: { lt: startOfDay(now) } },
    }),
    prisma.siteInspection.count({
      where: { ...scope, inspectorId: user.id, status: { in: [...OPEN_INSPECTION_STATUSES] } },
    }),
  ]);

  const status = Object.fromEntries(byStatus.map((g) => [g.status, g._count])) as Record<string, number>;
  const rec = Object.fromEntries(byRecommendation.map((g) => [g.recommendation, g._count])) as Record<string, number>;

  return {
    scheduled: status.SCHEDULED ?? 0,
    inProgress: status.IN_PROGRESS ?? 0,
    submitted: status.SUBMITTED ?? 0,
    recommended: rec.RECOMMENDED ?? 0,
    shortfall: rec.SHORTFALL ?? 0,
    reject: rec.REJECT ?? 0,
    overdue,
    mine,
  };
}

/** The register's filter options: inspectors who appear in scope. */
export async function registerMeta(user: AuthUser) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');
  const inspectors = await prisma.siteInspection.findMany({
    where: { application: { deletedAt: null, ...applicationScope(user) } },
    distinct: ['inspectorId'],
    select: { inspectorId: true, inspectorName: true },
    orderBy: { inspectorName: 'asc' },
  });
  return { inspectors: inspectors.map((i) => ({ id: i.inspectorId, name: i.inspectorName })) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Detail
// ═══════════════════════════════════════════════════════════════════════════

type FullInspection = Prisma.SiteInspectionGetPayload<{
  select: typeof INSPECTION_ROW_SELECT & {
    responses: { select: typeof RESPONSE_SELECT };
    photos: { select: typeof PHOTO_SELECT };
  };
}>;

/** Recomputes the report hash from the rows as they stand now. */
function recomputeHash(inspection: FullInspection, applicationNumber: string): string {
  return sha256(
    canonicalReport({
      inspectionNumber: inspection.inspectionNumber,
      applicationNumber,
      round: inspection.round,
      inspectorName: inspection.inspectorName,
      scheduledFor: inspection.scheduledFor,
      inspectedAt: inspection.inspectedAt,
      latitude: inspection.latitude,
      longitude: inspection.longitude,
      generalObservation: inspection.generalObservation,
      recommendation: inspection.recommendation,
      recommendationRemarks: inspection.recommendationRemarks,
      responses: inspection.responses,
      photos: inspection.photos,
    })
  );
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function getInspection(user: AuthUser, id: string) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');
  const base = await requireInspection(prisma, user, id);

  const [inspection, sequence, shortfall, candidates] = await Promise.all([
    prisma.siteInspection.findUniqueOrThrow({
      where: { id: base.id },
      select: {
        ...INSPECTION_ROW_SELECT,
        responses: { select: RESPONSE_SELECT, orderBy: { itemNumber: 'asc' } },
        photos: { select: PHOTO_SELECT, orderBy: [{ category: 'asc' }, { capturedAt: 'asc' }] },
      },
    }),
    currentSequence(prisma, base.applicationId),
    base.shortfallId
      ? prisma.shortfall.findUnique({
          where: { id: base.shortfallId },
          select: { id: true, shortfallNumber: true, status: true },
        })
      : null,
    can(user, CAPABILITIES.SITE_INSPECTION_SCHEDULE) && isInspectionOpen(base.status)
      ? inspectorCandidates(prisma, base.application.zoneId)
      : [],
  ]);

  const open = isInspectionOpen(inspection.status) && !inspection.lockedAt;
  const isInspector = inspection.inspectorId === user.id;
  const canConduct = can(user, CAPABILITIES.SITE_INSPECTION_CONDUCT);

  const signatureValid =
    inspection.status === INSPECTION_STATUS.SUBMITTED && inspection.documentHash
      ? recomputeHash(inspection, base.application.applicationNumber) === inspection.documentHash
      : null;

  return {
    ...inspection,
    responses: inspection.responses.map(({ item, ...r }) => ({
      ...r,
      helpText: item?.helpText ?? '',
      description: item?.description ?? '',
    })),
    application: applicationSummary(base.application),
    tally: questionTally(inspection.responses),
    shortfall,
    signatureValid,
    expectedSequence: sequence,
    provisional: { label: PROVISIONAL_QUESTIONS_LABEL, note: PROVISIONAL_QUESTIONS_NOTE },
    candidates,
    permissions: {
      canEdit: open && isInspector && canConduct,
      canSign: open && isInspector && canConduct,
      canReschedule: open && can(user, CAPABILITIES.SITE_INSPECTION_SCHEDULE),
      isInspector,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The application's tab
// ═══════════════════════════════════════════════════════════════════════════

export async function getApplicationInspections(user: AuthUser, applicationId: string) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');
  const app = await requireApplication(prisma, user, applicationId);

  const [rounds, task, sequence] = await Promise.all([
    prisma.siteInspection.findMany({
      where: { applicationId: app.id },
      orderBy: { round: 'desc' },
      select: {
        ...INSPECTION_ROW_SELECT,
        responses: { select: { status: true, response: true } },
        photos: { select: { id: true, category: true, latitude: true, longitude: true } },
      },
    }),
    prisma.workflowTask.findFirst({
      where: { instance: { applicationId: app.id }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      select: { assignedUserId: true, assignee: { select: { name: true } } },
    }),
    currentSequence(prisma, app.id),
  ]);

  const open = rounds.find((r) => isInspectionOpen(r.status)) ?? null;
  const atDesk = DESKS_THAT_SCHEDULE.includes(app.currentStageCode ?? '');
  const mayBook = can(user, CAPABILITIES.SITE_INSPECTION_SCHEDULE);
  const heldByOther =
    !!task?.assignedUserId && task.assignedUserId !== user.id && !can(user, CAPABILITIES.WORKFLOW_REASSIGN);

  let scheduleBlockedReason = '';
  if (!mayBook) scheduleBlockedReason = 'Only the TPA desk books site inspections.';
  else if (open) scheduleBlockedReason = `${open.inspectionNumber} is already booked.`;
  else if (!atDesk)
    scheduleBlockedReason =
      'A visit is booked from the TPA desk. This file is not at the TPA desk or the site inspection desk.';
  else if (heldByOther)
    scheduleBlockedReason = `This file is with ${task?.assignee?.name ?? 'another officer'}. Ask them to release it first.`;

  const canSchedule = !scheduleBlockedReason;

  return {
    application: applicationSummary(app),
    provisional: { label: PROVISIONAL_QUESTIONS_LABEL, note: PROVISIONAL_QUESTIONS_NOTE },
    rounds: rounds.map(({ responses, photos, ...r }) => ({
      ...r,
      tally: questionTally(responses),
      photoCount: photos.length,
      photoCategories: [...new Set(photos.map((p) => p.category))],
    })),
    canSchedule,
    scheduleBlockedReason: mayBook ? scheduleBlockedReason : '',
    candidates: canSchedule ? await inspectorCandidates(prisma, app.zoneId) : [],
    expectedSequence: sequence,
    demoLocation: demoSiteLocation(app.id, app.property?.district),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Schedule
// ═══════════════════════════════════════════════════════════════════════════

export async function scheduleInspection(
  user: AuthUser,
  applicationId: string,
  input: ScheduleInspectionInput,
  meta: Meta
) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_SCHEDULE, 'Only the TPA desk books site inspections.');

  const scheduledFor = parseDate(input.scheduledFor, 'scheduledFor', 'Choose the date of the visit.');
  if (startOfDay(scheduledFor) < startOfDay(new Date())) {
    throw badRequest('A visit cannot be booked for a date that has passed.', [
      { path: 'scheduledFor', message: 'Choose today or a later date.' },
    ]);
  }

  return prisma.$transaction(async (tx) => {
    const app = await requireApplication(tx, user, applicationId);

    if (!DESKS_THAT_SCHEDULE.includes(app.currentStageCode ?? '')) {
      throw conflict('A site inspection is booked from the TPA desk, and this file is not there.');
    }

    const candidates = await inspectorCandidates(tx, app.zoneId);
    const inspector = candidates.find((c) => c.id === input.inspectorId);
    if (!inspector) {
      throw badRequest('That officer cannot be sent to this site.', [
        { path: 'inspectorId', message: 'Choose a TPA who works in this zone.' },
      ]);
    }

    const existing = await tx.siteInspection.findMany({
      where: { applicationId: app.id },
      select: { round: true, status: true, inspectionNumber: true },
      orderBy: { round: 'desc' },
    });
    const open = existing.find((e) => isInspectionOpen(e.status));
    if (open) throw conflict(`${open.inspectionNumber} is already booked for this application.`);

    const now = new Date();
    const year = now.getFullYear();
    const seq = await nextSequence(tx, `SI-${year}`);
    const inspectionNumber = formatNumber(INSPECTION_NUMBER_FORMAT, { prefix: 'SI', year, seq });
    const round = (existing[0]?.round ?? 0) + 1;
    const location = demoSiteLocation(app.id, app.property?.district);

    const created = await tx.siteInspection.create({
      data: {
        inspectionNumber,
        applicationId: app.id,
        round,
        status: INSPECTION_STATUS.SCHEDULED,
        inspectorId: inspector.id,
        inspectorName: inspector.name,
        scheduledById: user.id,
        scheduledByName: user.name,
        scheduledFor,
        scheduleRemarks: input.remarks ?? '',
        stageCode: app.currentStageCode ?? '',
        latitude: location.latitude,
        longitude: location.longitude,
        locationSource: 'DEMO',
        siteAddress: siteAddressOf(app.property),
      },
      select: { id: true },
    });

    // The questions as they read TODAY, copied onto the report. A signed
    // report must not change when an administrator edits the wording.
    const definitions = await tx.checklistItemDefinition.findMany({
      where: { kind: 'SITE_INSPECTION', isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { itemNumber: 'asc' }],
    });
    if (!definitions.length) {
      throw conflict('No site inspection questions are configured. An administrator must add them in Settings → Checklists.');
    }
    await tx.siteInspectionResponse.createMany({
      data: definitions.map((d) => ({
        inspectionId: created.id,
        itemId: d.id,
        itemNumber: d.itemNumber,
        question: d.question,
        category: d.category,
        responseType: d.responseType,
        isMandatory: d.isMandatory,
        isProvisional: d.isProvisional,
      })),
    });

    const remarks =
      `Site inspection ${inspectionNumber} booked with ${inspector.name} for ` +
      `${scheduledFor.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` +
      (input.remarks ? `. ${input.remarks}` : '.');

    const workflow = await performActionInTx(
      tx,
      user,
      app.id,
      ACTIONS.SCHEDULE_SITE_INSPECTION,
      { remarks, expectedSequence: input.expectedSequence },
      meta,
      now
    );

    await tx.siteInspection.update({
      where: { id: created.id },
      data: { scheduleSequence: workflow.sequence },
    });

    const taskId = await handTaskTo(tx, app.id, inspector.id, now);

    await emit(tx, {
      eventCode: EVENTS.INSPECTION_DUE,
      applicationId: app.id,
      payload: {
        applicationNumber: app.applicationNumber,
        inspectionNumber,
        inspectorName: inspector.name,
        assignedUserId: inspector.id,
        ltpUserId: app.ltpUserId,
        dueDate: scheduledFor,
        taskId,
      },
    });

    await audit(tx, {
      actor: user,
      action: 'SITE_INSPECTION_SCHEDULED',
      entityType: 'SiteInspection',
      entityId: created.id,
      applicationId: app.id,
      after: {
        inspectionNumber,
        round,
        inspectorId: inspector.id,
        inspectorName: inspector.name,
        scheduledFor,
        questions: definitions.length,
        location,
        locationSource: 'DEMO',
        workflowSequence: workflow.sequence,
        taskId,
      },
      remarks: input.remarks ?? '',
      ...meta,
    });

    return { id: created.id, inspectionNumber, round, workflow };
  }, TX_LIMITS);
}

export async function rescheduleInspection(
  user: AuthUser,
  id: string,
  input: RescheduleInspectionInput,
  meta: Meta
) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_SCHEDULE, 'Only the TPA desk books site inspections.');

  return prisma.$transaction(async (tx) => {
    const inspection = await requireInspection(tx, user, id);
    if (inspection.lockedAt || !isInspectionOpen(inspection.status)) {
      throw conflict('A submitted inspection cannot be rescheduled.');
    }

    const data: Prisma.SiteInspectionUpdateInput = {};
    const before = {
      inspectorId: inspection.inspectorId,
      inspectorName: inspection.inspectorName,
      scheduledFor: inspection.scheduledFor,
    };

    if (input.scheduledFor) {
      const d = parseDate(input.scheduledFor, 'scheduledFor', 'Choose the date of the visit.');
      if (startOfDay(d) < startOfDay(new Date())) {
        throw badRequest('A visit cannot be booked for a date that has passed.', [
          { path: 'scheduledFor', message: 'Choose today or a later date.' },
        ]);
      }
      data.scheduledFor = d;
    }

    let inspector: { id: string; name: string } | null = null;
    if (input.inspectorId && input.inspectorId !== inspection.inspectorId) {
      if (inspection.status !== INSPECTION_STATUS.SCHEDULED) {
        throw conflict(
          `${inspection.inspectorName} has already started recording findings. The inspector cannot be changed now.`
        );
      }
      const candidates = await inspectorCandidates(tx, inspection.application.zoneId);
      inspector = candidates.find((c) => c.id === input.inspectorId) ?? null;
      if (!inspector) {
        throw badRequest('That officer cannot be sent to this site.', [
          { path: 'inspectorId', message: 'Choose a TPA who works in this zone.' },
        ]);
      }
      data.inspector = { connect: { id: inspector.id } };
      data.inspectorName = inspector.name;
    }

    if (!data.scheduledFor && !inspector) {
      throw badRequest('Nothing to change — choose a new date or a different inspector.');
    }

    data.scheduleRemarks = [inspection.scheduleRemarks, `Rescheduled: ${input.remarks}`]
      .filter(Boolean)
      .join('\n');

    const updated = await tx.siteInspection.update({
      where: { id: inspection.id },
      data,
      select: { inspectorId: true, inspectorName: true, scheduledFor: true },
    });

    const now = new Date();
    const taskId = await handTaskTo(tx, inspection.applicationId, updated.inspectorId, now);

    await emit(tx, {
      eventCode: EVENTS.INSPECTION_DUE,
      applicationId: inspection.applicationId,
      payload: {
        applicationNumber: inspection.application.applicationNumber,
        inspectionNumber: inspection.inspectionNumber,
        inspectorName: updated.inspectorName,
        assignedUserId: updated.inspectorId,
        ltpUserId: inspection.application.ltpUserId,
        dueDate: updated.scheduledFor,
        taskId,
        rescheduled: true,
      },
    });

    await audit(tx, {
      actor: user,
      action: 'SITE_INSPECTION_RESCHEDULED',
      entityType: 'SiteInspection',
      entityId: inspection.id,
      applicationId: inspection.applicationId,
      before,
      after: updated,
      remarks: input.remarks,
      ...meta,
    });

    return { id: inspection.id, ...updated };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Draft
// ═══════════════════════════════════════════════════════════════════════════

export async function saveInspectionDraft(
  user: AuthUser,
  id: string,
  input: SaveInspectionInput,
  meta: Meta
) {
  return prisma.$transaction(async (tx) => {
    const inspection = await requireInspection(tx, user, id);
    assertInspectorMayWrite(user, inspection);

    const now = new Date();
    const data: Prisma.SiteInspectionUpdateInput = {};
    const changed: string[] = [];

    if (input.inspectedAt !== undefined) {
      if (input.inspectedAt === null) {
        data.inspectedAt = null;
      } else {
        const d = parseDate(input.inspectedAt, 'inspectedAt', 'Enter the date of the visit.');
        if (d.getTime() > now.getTime() + 5 * 60_000) {
          throw badRequest('The inspection date cannot be in the future.', [
            { path: 'inspectedAt', message: 'The visit cannot have happened yet.' },
          ]);
        }
        data.inspectedAt = d;
      }
      changed.push('inspectedAt');
    }
    const plain = {
      latitude: input.latitude,
      longitude: input.longitude,
      siteAddress: input.siteAddress,
      generalObservation: input.generalObservation,
      recommendation: input.recommendation,
      recommendationRemarks: input.recommendationRemarks,
    };
    for (const [key, value] of Object.entries(plain)) {
      if (value === undefined) continue;
      (data as Record<string, unknown>)[key] = value;
      changed.push(key);
    }

    let answered = 0;
    if (input.responses?.length) {
      const rows = await tx.siteInspectionResponse.findMany({
        where: { inspectionId: inspection.id },
        select: {
          id: true,
          itemId: true,
          itemNumber: true,
          responseType: true,
          response: true,
          observation: true,
          remarks: true,
          status: true,
        },
      });
      const byItem = new Map(rows.map((r) => [r.itemId, r]));

      const problems: Array<{ path: string; message: string }> = [];
      for (const r of input.responses) {
        const row = byItem.get(r.itemId);
        if (!row) {
          problems.push({ path: `responses.${r.itemId}`, message: 'That question is not on this report.' });
          continue;
        }
        if (r.response && !isValidResponse(row.responseType, r.response)) {
          problems.push({
            path: `responses.${row.itemNumber}`,
            message: `Question ${row.itemNumber}: that answer does not fit the question.`,
          });
        }
      }
      if (problems.length) throw badRequest('Some answers could not be saved.', problems);

      // Only rows that actually changed. Twenty-seven blind updates over a
      // pooled connection is most of the latency of a save.
      for (const r of input.responses) {
        const row = byItem.get(r.itemId)!;
        if (
          row.response === r.response &&
          row.observation === r.observation &&
          row.remarks === r.remarks &&
          row.status === r.status
        ) {
          continue;
        }
        await tx.siteInspectionResponse.update({
          where: { id: row.id },
          data: {
            response: r.response,
            observation: r.observation,
            remarks: r.remarks,
            status: r.status,
            answeredById: user.id,
            answeredAt: now,
          },
        });
        answered += 1;
      }
      if (answered) changed.push(`responses:${answered}`);
    }

    // The first write is when the visit is under way. The file's status says
    // so too — the stage's working status, not a new desk.
    const starting = inspection.status === INSPECTION_STATUS.SCHEDULED;
    if (starting) data.status = INSPECTION_STATUS.IN_PROGRESS;

    await tx.siteInspection.update({ where: { id: inspection.id }, data });

    if (starting && inspection.application.status === 'SITE_INSPECTION_SCHEDULED') {
      await tx.application.update({
        where: { id: inspection.applicationId },
        data: { status: 'SITE_INSPECTION_IN_PROGRESS' },
      });
    }

    await audit(tx, {
      actor: user,
      action: starting ? 'SITE_INSPECTION_STARTED' : 'SITE_INSPECTION_DRAFT_SAVED',
      entityType: 'SiteInspection',
      entityId: inspection.id,
      applicationId: inspection.applicationId,
      after: { changed, recommendation: input.recommendation ?? inspection.recommendation },
      ...meta,
    });

    return { id: inspection.id, saved: true, changed, status: starting ? INSPECTION_STATUS.IN_PROGRESS : inspection.status };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Photographs
// ═══════════════════════════════════════════════════════════════════════════

export async function addInspectionPhoto(
  user: AuthUser,
  id: string,
  input: PhotoMetadataInput & { file?: { name: string; type: string; bytes: Buffer } | null },
  meta: Meta
) {
  const inspection = await requireInspection(prisma, user, id);
  assertInspectorMayWrite(user, inspection);

  if (!isPhotoCategory(input.category)) {
    throw badRequest('Choose which view this photograph shows.', [{ path: 'category', message: 'Choose a category.' }]);
  }
  const capturedAt = parseDate(input.capturedAt, 'capturedAt', 'Enter when the photograph was taken.');
  if (capturedAt.getTime() > Date.now() + 5 * 60_000) {
    throw badRequest('A photograph cannot have been taken in the future.', [
      { path: 'capturedAt', message: 'Check the date and time.' },
    ]);
  }

  const count = await prisma.siteInspectionPhoto.count({ where: { inspectionId: inspection.id } });
  if (count >= MAX_PHOTOS) throw conflict(`A report carries at most ${MAX_PHOTOS} photographs.`);

  // The upload pipeline runs OUTSIDE the transaction: it writes to storage,
  // and a storage write cannot be rolled back by Postgres.
  const stored = input.file
    ? await storeUpload({
        applicationId: inspection.applicationId,
        kind: 'inspections',
        file: input.file,
        uploadedById: user.id,
        allowedExtensions: PHOTO_EXTENSIONS,
        maxBytes: MAX_PHOTO_BYTES,
      })
    : null;

  return prisma.$transaction(async (tx) => {
    // Re-checked inside: the report may have been signed while the bytes uploaded.
    const fresh = await tx.siteInspection.findUniqueOrThrow({
      where: { id: inspection.id },
      select: { status: true, lockedAt: true, inspectorId: true, inspectorName: true },
    });
    assertInspectorMayWrite(user, fresh);

    const photo = await tx.siteInspectionPhoto.create({
      data: {
        inspectionId: inspection.id,
        applicationId: inspection.applicationId,
        category: input.category,
        description: input.description ?? '',
        fileObjectId: stored?.id ?? null,
        fileName: stored?.originalName ?? '',
        mimeType: stored?.mimeType ?? '',
        sizeBytes: stored?.sizeBytes ?? 0,
        latitude: input.latitude,
        longitude: input.longitude,
        capturedAt,
        isDemoLocation: true,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
      select: PHOTO_SELECT,
    });

    if (fresh.status === INSPECTION_STATUS.SCHEDULED) {
      await tx.siteInspection.update({ where: { id: inspection.id }, data: { status: INSPECTION_STATUS.IN_PROGRESS } });
      if (inspection.application.status === 'SITE_INSPECTION_SCHEDULED') {
        await tx.application.update({
          where: { id: inspection.applicationId },
          data: { status: 'SITE_INSPECTION_IN_PROGRESS' },
        });
      }
    }

    await audit(tx, {
      actor: user,
      action: 'SITE_INSPECTION_PHOTO_ADDED',
      entityType: 'SiteInspectionPhoto',
      entityId: photo.id,
      applicationId: inspection.applicationId,
      after: {
        inspectionNumber: inspection.inspectionNumber,
        category: photo.category,
        latitude: photo.latitude,
        longitude: photo.longitude,
        capturedAt: photo.capturedAt,
        fileObjectId: photo.fileObjectId,
        checksum: stored?.checksumSha256 ?? null,
        demoPlaceholder: !stored,
      },
      ...meta,
    });

    return photo;
  }, TX_LIMITS);
}

export async function removeInspectionPhoto(user: AuthUser, id: string, photoId: string, meta: Meta) {
  if (!isUuid(photoId)) throw notFound('That photograph could not be found.');
  return prisma.$transaction(async (tx) => {
    const inspection = await requireInspection(tx, user, id);
    assertInspectorMayWrite(user, inspection);

    const photo = await tx.siteInspectionPhoto.findFirst({
      where: { id: photoId, inspectionId: inspection.id },
      select: PHOTO_SELECT,
    });
    if (!photo) throw notFound('That photograph could not be found.');

    await tx.siteInspectionPhoto.delete({ where: { id: photo.id } });

    await audit(tx, {
      actor: user,
      action: 'SITE_INSPECTION_PHOTO_REMOVED',
      entityType: 'SiteInspectionPhoto',
      entityId: photo.id,
      applicationId: inspection.applicationId,
      before: photo,
      ...meta,
    });

    return { removed: true };
  }, TX_LIMITS);
}

/**
 * The bytes of one photograph, or — for a seeded demo photograph with no
 * file — a labelled SVG placeholder that says it is one.
 */
export async function readInspectionPhoto(user: AuthUser, photoId: string) {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_VIEW, 'Your role does not include site inspections.');
  if (!isUuid(photoId)) throw notFound('That photograph could not be found.');

  const photo = await prisma.siteInspectionPhoto.findFirst({
    where: {
      id: photoId,
      inspection: { application: { deletedAt: null, ...applicationScope(user) } },
    },
    select: {
      ...PHOTO_SELECT,
      inspection: { select: { inspectionNumber: true } },
    },
  });
  if (!photo) throw notFound('That photograph could not be found.');

  let caption = 'DEMO PHOTOGRAPH — placeholder, no image file';

  if (photo.fileObjectId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: photo.fileObjectId },
      select: { storageKey: true, mimeType: true, scanStatus: true },
    });
    // Served only once the scanner has cleared it (or no scanner is
    // configured) — the same rule every other download follows.
    if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
      return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType };
    }
    caption =
      file?.scanStatus === 'PENDING'
        ? 'Photograph awaiting virus scan'
        : 'Photograph withheld — it did not pass the virus scan';
  }

  return {
    bytes: Buffer.from(placeholderSvg(photo, photo.inspection.inspectionNumber, caption), 'utf8'),
    mimeType: 'image/svg+xml',
  };
}

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const PLACEHOLDER_HUES: Record<string, number> = {
  NORTH: 205,
  SOUTH: 25,
  EAST: 140,
  WEST: 265,
  ACCESS_ROAD: 45,
  BOUNDARY: 175,
  ENCUMBRANCE: 0,
  EXISTING_STRUCTURE: 300,
  OTHER: 220,
};

function placeholderSvg(
  photo: { category: string; latitude: number; longitude: number; capturedAt: Date; description: string },
  inspectionNumber: string,
  caption: string
): string {
  const hue = PLACEHOLDER_HUES[photo.category] ?? 220;
  const label = PHOTO_CATEGORY_LABEL[photo.category as PhotoCategory] ?? photo.category;
  const when = photo.capturedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="hsl(${hue},45%,78%)"/><stop offset="0.62" stop-color="hsl(${hue},35%,62%)"/>
    <stop offset="0.62" stop-color="hsl(95,25%,48%)"/><stop offset="1" stop-color="hsl(95,25%,36%)"/>
  </linearGradient></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <path d="M0 300 L120 250 L220 280 L330 230 L460 270 L640 240 L640 300 Z" fill="hsl(${hue},20%,45%)" opacity="0.45"/>
  <rect x="0" y="392" width="640" height="88" fill="rgba(0,0,0,0.55)"/>
  <text x="24" y="60" font-family="system-ui,sans-serif" font-size="40" font-weight="700" fill="#fff">${escapeXml(label)}</text>
  <text x="24" y="92" font-family="system-ui,sans-serif" font-size="16" fill="#fff">${escapeXml(inspectionNumber)}</text>
  <text x="24" y="422" font-family="ui-monospace,monospace" font-size="16" fill="#fff">${escapeXml(formatCoordinates(photo.latitude, photo.longitude))} · demo coordinates</text>
  <text x="24" y="448" font-family="system-ui,sans-serif" font-size="14" fill="#fde68a">${escapeXml(caption)}</text>
  <text x="24" y="468" font-family="system-ui,sans-serif" font-size="12" fill="#e5e7eb">${escapeXml(when)}${photo.description ? ` · ${escapeXml(photo.description.slice(0, 70))}` : ''}</text>
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sign & submit
// ═══════════════════════════════════════════════════════════════════════════

/** The demo provider's answer. Shaped like a real one; trusted by nothing. */
function demoSignature(method: SignatureMethod, user: AuthUser, input: SubmitInspectionInput, hash: string) {
  const ref = `${method === 'AADHAAR_ESIGN_DEMO' ? 'ESIGN' : 'DSC'}-DEMO-${randomBytes(6).toString('hex').toUpperCase()}`;
  const common = {
    provider: 'DEMO',
    methodLabel: SIGNATURE_METHOD_LABEL[method],
    certificateSubject: `CN=${user.name}, OU=Town Planning, O=Nirman Demo`,
    certificateIssuer: 'CN=Nirman Demo CA (not a licensed CA)',
    hashAlgorithm: 'SHA-256',
    signedDigest: hash,
    disclaimer: DEMO_SIGNATURE_DISCLAIMER,
  };
  if (method === 'AADHAAR_ESIGN_DEMO') {
    return {
      ref,
      metadata: { ...common, maskedAadhaar: `XXXX-XXXX-${input.aadhaarLast4}`, otpVerified: true, esignVersion: 'demo-2.1' },
    };
  }
  return {
    ref,
    metadata: {
      ...common,
      tokenSerial: `DEMO-TKN-${sha256(user.id).slice(0, 10).toUpperCase()}`,
      pinVerified: true,
      tokenClass: 'Class 3 (demo)',
    },
  };
}

export async function submitInspection(
  user: AuthUser,
  id: string,
  input: SubmitInspectionInput,
  meta: Meta
): Promise<{ id: string; inspectionNumber: string; recommendation: Recommendation; documentHash: string; signatureRef: string; workflow: ActionResult }> {
  requireCapability(user, CAPABILITIES.SITE_INSPECTION_CONDUCT, 'Your role does not conduct site inspections.');

  // The demo credentials, checked before anything is opened. Published on the
  // signing dialog — they prove a deliberate act, not an identity.
  if (input.method === 'AADHAAR_ESIGN_DEMO' && input.otp !== DEMO_ESIGN_OTP) {
    throw badRequest('That OTP is not correct.', [{ path: 'otp', message: `The demo OTP is ${DEMO_ESIGN_OTP}.` }]);
  }
  if (input.method === 'USB_TOKEN_DEMO' && input.pin !== DEMO_TOKEN_PIN) {
    throw badRequest('That token PIN is not correct.', [{ path: 'pin', message: `The demo PIN is ${DEMO_TOKEN_PIN}.` }]);
  }

  return prisma.$transaction(async (tx) => {
    const base = await requireInspection(tx, user, id);

    // Serialise two presses of Sign on the same report: the second waits
    // here and then finds it locked.
    await tx.$queryRaw`SELECT id FROM site_inspections WHERE id = ${base.id} FOR UPDATE`;

    const inspection = await tx.siteInspection.findUniqueOrThrow({
      where: { id: base.id },
      select: {
        ...INSPECTION_ROW_SELECT,
        responses: { select: RESPONSE_SELECT, orderBy: { itemNumber: 'asc' } },
        photos: { select: PHOTO_SELECT },
      },
    });
    assertInspectorMayWrite(user, inspection);

    const now = new Date();
    const issues = inspectionReadiness({
      scheduledOn: inspection.createdAt,
      inspectedAt: inspection.inspectedAt,
      latitude: inspection.latitude,
      longitude: inspection.longitude,
      recommendation: inspection.recommendation,
      recommendationRemarks: inspection.recommendationRemarks,
      responses: inspection.responses,
      photos: inspection.photos,
      now,
    });
    if (issues.length) {
      throw guardFailed(`The report is not ready to sign — ${issues.length} ${issues.length === 1 ? 'thing needs' : 'things need'} attention.`, issues);
    }

    const recommendation = inspection.recommendation as Recommendation;
    const documentHash = recomputeHash(inspection, base.application.applicationNumber);
    const signature = demoSignature(input.method, user, input, documentHash);
    const signerRole = user.roleKeys.includes('TPA' as never) ? 'TPA' : (user.roleKeys[0] ?? '');

    await tx.siteInspection.update({
      where: { id: inspection.id },
      data: {
        status: INSPECTION_STATUS.SUBMITTED,
        signatureMethod: input.method,
        signedById: user.id,
        signedByName: user.name,
        signedByRoleKey: signerRole,
        signedAt: now,
        signatureRef: signature.ref,
        documentHash,
        signatureMetadata: signature.metadata,
        submittedAt: now,
        lockedAt: now,
      },
    });

    // ── The file moves ─────────────────────────────────────────────────
    const actionCode = RECOMMENDATION_ACTION[recommendation];
    const shortfallItems = inspection.responses
      .filter((r) => r.status === 'SHORTFALL')
      .map((r) => ({
        description: `Q${r.itemNumber}. ${r.question} — Observed: ${r.observation}`,
        category: r.category || 'Site inspection',
        requiredAction: r.remarks || 'Rectify on site and confirm with photographs.',
        remarks: `Raised by site inspection ${inspection.inspectionNumber}.`,
        isMandatory: true,
      }));

    const workflow = await performActionInTx(
      tx,
      user,
      inspection.applicationId,
      actionCode,
      {
        remarks: `${RECOMMENDATION_LABEL[recommendation]} — ${inspection.recommendationRemarks}`,
        expectedSequence: input.expectedSequence,
        ...(recommendation === 'SHORTFALL'
          ? {
              shortfall: {
                title: `Site inspection shortfall — ${inspection.inspectionNumber}`,
                description: inspection.recommendationRemarks,
                requiredAction: 'Correct the deviations found on site and respond with evidence.',
                items: shortfallItems,
              },
            }
          : {}),
      },
      meta,
      now
    );

    await tx.siteInspection.update({
      where: { id: inspection.id },
      data: { submitSequence: workflow.sequence, routedActionCode: actionCode },
    });

    await audit(tx, {
      actor: user,
      action: 'SITE_INSPECTION_SIGNED_AND_SUBMITTED',
      entityType: 'SiteInspection',
      entityId: inspection.id,
      applicationId: inspection.applicationId,
      before: { status: inspection.status },
      after: {
        inspectionNumber: inspection.inspectionNumber,
        status: INSPECTION_STATUS.SUBMITTED,
        recommendation,
        signatureMethod: input.method,
        signatureRef: signature.ref,
        documentHash,
        tally: questionTally(inspection.responses),
        photos: inspection.photos.length,
        workflowAction: actionCode,
        workflowSequence: workflow.sequence,
        toStageCode: workflow.toStageCode,
        shortfalls: workflow.shortfallNumbers,
      },
      remarks: inspection.recommendationRemarks,
      ...meta,
    });

    return {
      id: inspection.id,
      inspectionNumber: inspection.inspectionNumber,
      recommendation,
      documentHash,
      signatureRef: signature.ref,
      workflow,
    };
  }, TX_LIMITS);
}
