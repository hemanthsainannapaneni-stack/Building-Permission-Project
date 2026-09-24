import 'server-only';
import type { Prisma, ScanStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isLtp, type AuthUser } from '@/server/auth/context';
import { badRequest, forbidden, notFound } from '@/server/http/errors';
import { isUuid } from '@/lib/utils';
import {
  BIM_FILE_KINDS,
  BIM_FILE_KIND_CODES,
  CRS_OPTIONS,
  bimLabel,
  canEditBim,
  canReviewBim,
  evaluateReadiness,
  extensionsFor,
  normaliseSchema,
  normaliseViewDefinition,
  whyCannotEditBim,
  type BimRecordLike,
  type IfcFacts,
} from '@/lib/bim';
import type { ReviewBimInput, UpdateBimInput } from '@/lib/schemas/bim';
import { readIfc } from '@/server/bim/ifc';
import { audit } from './audit';
import { recordEvent, EVENT_TYPES } from './timeline';
import { storeUpload, readFileObject, isServable, extensionOf } from './files';

/**
 * THE BIM SUBMISSION — the building information model that travels with the
 * drawings.
 *
 * Three things live here, and they are kept apart on purpose:
 *
 *   1. The MODEL FILES (IFC, BCF, COBie, BEP), versioned exactly as drawings
 *      are: a correction is a new version, nothing is overwritten, and every
 *      IFC version carries the facts the server read out of its bytes.
 *
 *   2. The PARTICULARS the LTP states about the model — authoring, schema,
 *      LOD, georeferencing, the model's own quantities, coordination and who
 *      answers for it — ending in a declaration.
 *
 *   3. The DEPARTMENT'S REVIEW of all of that.
 *
 * ── The declaration is about a specific model ─────────────────────────────
 *
 * Uploading a new IFC version, or changing any particular, withdraws the LTP
 * declaration and resets the review. A declaration that survived a change of
 * the thing declared would be a signature on a document someone edited
 * afterwards.
 *
 * ── Authorization ─────────────────────────────────────────────────────────
 *
 * Every query merges `applicationScope(user)`, as the drawings service does,
 * so an id from someone else's application resolves to "not found".
 */

type Meta = { ip?: string; userAgent?: string; correlationId?: string };

const SUBMISSION_SELECT = {
  id: true,
  applicationId: true,
  modelReference: true,
  authoringSoftware: true,
  authoringVersion: true,
  ifcSchema: true,
  modelViewDefinition: true,
  levelOfDevelopment: true,
  classificationSystem: true,
  lengthUnit: true,
  disciplines: true,
  crsCode: true,
  verticalDatum: true,
  siteLatitude: true,
  siteLongitude: true,
  originEasting: true,
  originNorthing: true,
  originHeightM: true,
  trueNorthDeg: true,
  modelPlotAreaSqm: true,
  modelBuiltUpAreaSqm: true,
  modelCoverageAreaSqm: true,
  modelFarAreaSqm: true,
  modelBuildingHeightM: true,
  modelNumFloors: true,
  modelNumBasements: true,
  modelDwellingUnits: true,
  modelParkingSpaces: true,
  modelSetbackFrontM: true,
  modelSetbackRearM: true,
  modelSetbackLeftM: true,
  modelSetbackRightM: true,
  storeys: true,
  contentChecklist: true,
  clashDetectionDone: true,
  clashTool: true,
  clashDetectionDate: true,
  unresolvedHardClashes: true,
  unresolvedSoftClashes: true,
  ifcValidationDone: true,
  ifcValidationTool: true,
  drawingsFromModel: true,
  bepReference: true,
  cdePlatform: true,
  informationStandard: true,
  bimManagerName: true,
  bimManagerOrganisation: true,
  bimManagerEmail: true,
  bimManagerPhone: true,
  bimManagerCredential: true,
  remarks: true,
  declaredAt: true,
  declaredById: true,
  reviewStatus: true,
  reviewRemarks: true,
  reviewedAt: true,
  reviewedById: true,
  updatedAt: true,
} satisfies Prisma.BimSubmissionSelect;

type SubmissionRow = Prisma.BimSubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

const VERSION_SELECT = {
  id: true,
  versionNo: true,
  remarks: true,
  ifcFacts: true,
  uploadedById: true,
  uploadedAt: true,
  isActive: true,
  file: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      scanStatus: true,
      checksumSha256: true,
    },
  },
} satisfies Prisma.BimModelVersionSelect;

const MODEL_SELECT = {
  id: true,
  kind: true,
  discipline: true,
  title: true,
  currentVersionNo: true,
  createdAt: true,
  versions: { select: VERSION_SELECT, orderBy: { versionNo: 'desc' } },
} satisfies Prisma.BimModelSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

async function requireApplication(user: AuthUser, applicationId: string) {
  if (!isUuid(applicationId)) throw notFound('That application could not be found.');

  const app = await prisma.application.findFirst({
    where: { id: applicationId, deletedAt: null, ...applicationScope(user) },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      ltpUserId: true,
      building: {
        select: {
          plotAreaSqm: true,
          builtUpAreaSqm: true,
          floorAreaSqm: true,
          coverageAreaSqm: true,
          buildingHeightM: true,
          numFloors: true,
          numBasements: true,
          numDwellingUnits: true,
          achievedFar: true,
          setbackFrontM: true,
          setbackRearM: true,
          setbackLeftM: true,
          setbackRightM: true,
        },
      },
    },
  });

  if (!app) throw notFound('That application could not be found.');
  return app;
}

/** As above, plus the LTP-side write gate. */
async function requireEditable(user: AuthUser, applicationId: string) {
  const app = await requireApplication(user, applicationId);

  if (isLtp(user) && app.ltpUserId !== user.id) {
    throw forbidden('You may only change the BIM model on applications you filed.');
  }
  if (!canEditBim(app.status)) {
    throw forbidden(whyCannotEditBim(app.status) ?? 'The BIM model cannot be changed on this application.');
  }
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Read
// ═══════════════════════════════════════════════════════════════════════════

export async function getBim(user: AuthUser, applicationId: string) {
  const app = await requireApplication(user, applicationId);

  const [row, models] = await Promise.all([
    prisma.bimSubmission.findUnique({ where: { applicationId: app.id }, select: SUBMISSION_SELECT }),
    prisma.bimModel.findMany({
      where: { applicationId: app.id },
      select: MODEL_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const submission = row ?? emptySubmission(app.id);

  const names = await namesFor([
    ...models.flatMap((m) => m.versions.map((v) => v.uploadedById)),
    submission.declaredById ?? '',
    submission.reviewedById ?? '',
  ]);

  const ifcModels = models.filter((m) => m.kind === 'IFC_MODEL');
  // The first IFC model is the federated one by convention — it is what the
  // LTP is asked to upload first, and the one the reconciliation reads.
  const primary = ifcModels[0]?.versions.find((v) => v.isActive) ?? null;
  const ifc = (primary?.ifcFacts as IfcFacts | undefined) ?? null;

  const readiness = evaluateReadiness({
    bim: toRecordLike(submission),
    declared: {
      plotAreaSqm: app.building?.plotAreaSqm ?? null,
      builtUpAreaSqm: app.building?.builtUpAreaSqm ?? null,
      floorAreaSqm: app.building?.floorAreaSqm ?? null,
      coverageAreaSqm: app.building?.coverageAreaSqm ?? null,
      buildingHeightM: app.building?.buildingHeightM ?? null,
      numFloors: app.building?.numFloors ?? null,
      numBasements: app.building?.numBasements ?? null,
      numDwellingUnits: app.building?.numDwellingUnits ?? null,
      achievedFar: app.building?.achievedFar ?? null,
      setbackFrontM: app.building?.setbackFrontM ?? null,
      setbackRearM: app.building?.setbackRearM ?? null,
      setbackLeftM: app.building?.setbackLeftM ?? null,
      setbackRightM: app.building?.setbackRightM ?? null,
    },
    ifc: ifc && Object.keys(ifc).length ? ifc : null,
    ifcModelCount: ifcModels.length,
  });

  const isOwner = app.ltpUserId === user.id;
  const editable = canEditBim(app.status) && (!isLtp(user) || isOwner);

  return {
    application: { id: app.id, applicationNumber: app.applicationNumber, status: app.status },
    recorded: Boolean(row),
    bim: {
      ...submission,
      declaredByName: submission.declaredById ? (names.get(submission.declaredById) ?? 'Unknown user') : null,
      reviewedByName: submission.reviewedById ? (names.get(submission.reviewedById) ?? 'Unknown user') : null,
    },
    models: models.map((m) => ({
      ...m,
      versions: m.versions.map((v) => ({
        ...v,
        uploadedByName: names.get(v.uploadedById) ?? 'Unknown user',
        downloadable: isServable(v.file.scanStatus as ScanStatus),
      })),
    })),
    primaryFacts: ifc && Object.keys(ifc).length ? ifc : null,
    readiness,
    canEdit: editable,
    editBlockedReason:
      isLtp(user) && !isOwner
        ? 'You may only change the BIM model on applications you filed.'
        : whyCannotEditBim(app.status),
    // The route decides WHO may review (CHECKLIST_REVIEW); this decides WHEN.
    reviewOpen: canReviewBim(app.status),
    isApplicant: isLtp(user),
  };
}

export type BimPayload = Awaited<ReturnType<typeof getBim>>;

// ═══════════════════════════════════════════════════════════════════════════
// Particulars and declaration
// ═══════════════════════════════════════════════════════════════════════════

export async function updateBim(user: AuthUser, applicationId: string, input: UpdateBimInput, meta: Meta = {}) {
  const app = await requireEditable(user, applicationId);
  const { declare, ...fields } = input;

  if (declare === true && !isLtp(user)) {
    throw forbidden('Only the LTP who filed the application can make the BIM declaration.');
  }

  if (declare === true) {
    const models = await prisma.bimModel.count({ where: { applicationId: app.id, kind: 'IFC_MODEL' } });
    if (!models) throw badRequest('Upload the IFC model before declaring it.');
  }

  const before = await prisma.bimSubmission.findUnique({
    where: { applicationId: app.id },
    select: SUBMISSION_SELECT,
  });

  const changesParticulars = Object.keys(fields).length > 0;

  // Changing what was declared withdraws the declaration, unless this same
  // request re-declares. So does an explicit `declare: false`.
  const declaration: Prisma.BimSubmissionUncheckedUpdateInput =
    declare === true
      ? { declaredAt: new Date(), declaredById: user.id }
      : declare === false || (changesParticulars && before?.declaredAt)
        ? { declaredAt: null, declaredById: null }
        : {};

  const data = {
    ...(fields as Prisma.BimSubmissionUncheckedUpdateInput),
    ...(fields.storeys ? { storeys: fields.storeys as Prisma.InputJsonValue } : {}),
    ...(fields.contentChecklist ? { contentChecklist: fields.contentChecklist as Prisma.InputJsonValue } : {}),
    ...declaration,
    // A changed model is a new thing to review.
    ...(changesParticulars && before?.reviewStatus !== 'NOT_REVIEWED'
      ? { reviewStatus: 'NOT_REVIEWED', reviewedAt: null, reviewedById: null }
      : {}),
  };

  await prisma.$transaction(async (tx) => {
    const row = await tx.bimSubmission.upsert({
      where: { applicationId: app.id },
      create: { ...(data as Prisma.BimSubmissionUncheckedCreateInput), applicationId: app.id },
      update: data,
      select: SUBMISSION_SELECT,
    });

    await recordEvent(tx, {
      applicationId: app.id,
      type: declare === true ? EVENT_TYPES.BIM_DECLARED : EVENT_TYPES.BIM_UPDATED,
      title: declare === true ? 'BIM model declared' : 'BIM particulars updated',
      description:
        declare === true
          ? 'The LTP declared the IFC model consistent with the drawings on file.'
          : describeChange(Object.keys(fields)),
      actor: user,
      metadata: { fields: Object.keys(fields), declare: declare ?? null },
    });

    await audit(tx, {
      actor: user,
      action: declare === true ? 'BIM_DECLARED' : 'BIM_UPDATED',
      entityType: 'BimSubmission',
      entityId: row.id,
      applicationId: app.id,
      before,
      after: row,
      remarks: `${app.applicationNumber} — BIM`,
      ...meta,
    });
  });

  return getBim(user, app.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Department review
// ═══════════════════════════════════════════════════════════════════════════

export async function reviewBim(user: AuthUser, applicationId: string, input: ReviewBimInput, meta: Meta = {}) {
  const app = await requireApplication(user, applicationId);

  if (isLtp(user)) throw forbidden('The applicant cannot review their own model.');
  if (!canReviewBim(app.status)) throw forbidden('A draft has not been filed, so there is nothing to review yet.');

  const before = await prisma.bimSubmission.findUnique({
    where: { applicationId: app.id },
    select: SUBMISSION_SELECT,
  });

  const data = {
    reviewStatus: input.reviewStatus,
    reviewRemarks: input.reviewRemarks,
    reviewedAt: new Date(),
    reviewedById: user.id,
  };

  await prisma.$transaction(async (tx) => {
    const row = await tx.bimSubmission.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, ...data },
      update: data,
      select: SUBMISSION_SELECT,
    });

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.BIM_REVIEWED,
      title: `BIM model ${input.reviewStatus === 'ACCEPTED' ? 'accepted' : 'returned for correction'}`,
      description: input.reviewRemarks || bimLabel(input.reviewStatus),
      actor: user,
      metadata: { reviewStatus: input.reviewStatus },
    });

    await audit(tx, {
      actor: user,
      action: 'BIM_REVIEWED',
      entityType: 'BimSubmission',
      entityId: row.id,
      applicationId: app.id,
      before,
      after: row,
      remarks: `${app.applicationNumber} — BIM review: ${input.reviewStatus}`,
      ...meta,
    });
  });

  return getBim(user, app.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Files
// ═══════════════════════════════════════════════════════════════════════════

export type UploadBimInput = {
  applicationId: string;
  kind: string;
  discipline?: string;
  title?: string;
  remarks?: string;
  /** Uploading into an existing deliverable creates its next version. */
  bimModelId?: string;
  file: { name: string; type: string; bytes: Buffer };
};

/**
 * Stores a BIM deliverable as its next version.
 *
 * For an IFC model the bytes are READ before they are stored, and whatever
 * the file itself says — schema, view definition, units, storeys, site
 * position, map conversion — fills any particular the LTP has left blank.
 * It never overwrites an answer somebody gave: where the two disagree, the
 * readiness check says so, which is more useful than silently picking one.
 */
export async function uploadBimFile(user: AuthUser, input: UploadBimInput, meta: Meta) {
  const app = await requireEditable(user, input.applicationId);

  const existing = input.bimModelId
    ? await prisma.bimModel.findFirst({
        where: { id: input.bimModelId, applicationId: app.id },
        select: { id: true, kind: true, title: true, discipline: true },
      })
    : null;
  if (input.bimModelId && !existing) throw notFound('That BIM deliverable could not be found.');

  const kind = existing?.kind ?? input.kind;
  if (!BIM_FILE_KIND_CODES.includes(kind as never)) {
    throw badRequest('Choose what kind of BIM deliverable this is.');
  }

  const stored = await storeUpload({
    applicationId: app.id,
    kind: 'bim',
    file: input.file,
    uploadedById: user.id,
    allowedExtensions: extensionsFor(kind),
  });

  const facts: IfcFacts | null =
    kind === 'IFC_MODEL' ? readIfc(input.file.bytes, extensionOf(input.file.name)) : null;

  const result = await prisma.$transaction(async (tx) => {
    const model =
      existing ??
      (await tx.bimModel.create({
        data: {
          applicationId: app.id,
          kind,
          discipline: (input.discipline || 'FEDERATED').toUpperCase().replace(/[^A-Z_]/g, ''),
          title:
            (input.title ?? '').trim().slice(0, 200) ||
            (facts?.projectName ? `${facts.projectName} — IFC model` : defaultTitle(kind)),
        },
        select: { id: true, kind: true, title: true, discipline: true },
      }));

    const last = await tx.bimModelVersion.findFirst({
      where: { bimModelId: model.id },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const versionNo = (last?.versionNo ?? 0) + 1;

    await tx.bimModelVersion.updateMany({
      where: { bimModelId: model.id, isActive: true },
      data: { isActive: false },
    });

    const version = await tx.bimModelVersion.create({
      data: {
        bimModelId: model.id,
        versionNo,
        fileObjectId: stored.id,
        remarks: (input.remarks ?? '').slice(0, 1000),
        ifcFacts: (facts ?? {}) as Prisma.InputJsonValue,
        uploadedById: user.id,
        isActive: true,
      },
      select: { id: true, versionNo: true },
    });

    await tx.bimModel.update({ where: { id: model.id }, data: { currentVersionNo: versionNo } });

    // A new model withdraws the declaration and resets the review, and the
    // file's own facts fill whatever the LTP has not answered.
    if (kind === 'IFC_MODEL') {
      const current = await tx.bimSubmission.findUnique({
        where: { applicationId: app.id },
        select: SUBMISSION_SELECT,
      });
      const prefill = facts?.parsed ? prefillFromFacts(current, facts) : {};
      const reset = {
        declaredAt: null,
        declaredById: null,
        reviewStatus: 'NOT_REVIEWED',
        reviewedAt: null,
        reviewedById: null,
      };
      await tx.bimSubmission.upsert({
        where: { applicationId: app.id },
        create: { ...(prefill as Omit<Prisma.BimSubmissionUncheckedCreateInput, 'applicationId'>), ...reset, applicationId: app.id },
        update: { ...prefill, ...reset },
      });
    }

    await tx.application.update({ where: { id: app.id }, data: { updatedAt: new Date() } });

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.BIM_MODEL_UPLOADED,
      title:
        versionNo === 1
          ? `${bimLabel(kind)} uploaded`
          : `${bimLabel(kind)} revised to version ${versionNo}`,
      description: `${model.title} — ${stored.originalName}${
        facts?.parsed ? ` · ${facts.schema}, ${facts.storeys.length} storeys, ${facts.counts.IFCSPACE ?? 0} spaces` : ''
      }`,
      actor: user,
      metadata: {
        bimModelId: model.id,
        bimModelVersionId: version.id,
        versionNo,
        kind,
        fileName: stored.originalName,
        checksum: stored.checksumSha256,
      },
    });

    await audit(tx, {
      actor: user,
      action: 'BIM_MODEL_UPLOADED',
      entityType: 'BimModelVersion',
      entityId: version.id,
      applicationId: app.id,
      after: {
        bimModelId: model.id,
        versionNo,
        kind,
        fileName: stored.originalName,
        checksumSha256: stored.checksumSha256,
        sizeBytes: stored.sizeBytes,
        ifcSchema: facts?.schema ?? null,
      },
      ...meta,
    });

    return { bimModelId: model.id, versionId: version.id, versionNo, facts };
  });

  return result;
}

const defaultTitle = (kind: string): string =>
  BIM_FILE_KINDS.find((k) => k.code === kind)?.label ?? 'BIM deliverable';

/**
 * The particulars an IFC file can answer by itself, for the ones still blank.
 * Storeys below zero elevation are basements; the rest are floors.
 */
function prefillFromFacts(current: SubmissionRow | null, facts: IfcFacts): Prisma.BimSubmissionUncheckedUpdateInput {
  const out: Prisma.BimSubmissionUncheckedUpdateInput = {};
  const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  const schema = normaliseSchema(facts.schema);
  if (schema && blank(current?.ifcSchema)) out.ifcSchema = schema;

  const mvd = normaliseViewDefinition(facts.viewDefinition);
  if (mvd && blank(current?.modelViewDefinition)) out.modelViewDefinition = mvd;

  if (blank(current?.lengthUnit) && (facts.lengthUnit === 'MILLIMETRE' || facts.lengthUnit === 'METRE')) {
    out.lengthUnit = facts.lengthUnit;
  }

  if (blank(current?.authoringSoftware) && facts.originatingSystem) {
    const s = facts.originatingSystem.toLowerCase();
    const guess = [
      ['revit', 'REVIT'],
      ['archicad', 'ARCHICAD'],
      ['tekla', 'TEKLA'],
      ['allplan', 'ALLPLAN'],
      ['vectorworks', 'VECTORWORKS'],
      ['bricscad', 'BRICSCAD_BIM'],
      ['openbuildings', 'OPENBUILDINGS'],
      ['bonsai', 'BONSAI'],
      ['blenderbim', 'BONSAI'],
      ['ifcopenshell', 'BONSAI'],
    ].find(([needle]) => s.includes(needle!));
    out.authoringSoftware = guess?.[1] ?? 'OTHER';
    if (blank(current?.authoringVersion)) out.authoringVersion = facts.originatingSystem.slice(0, 200);
  }

  if (blank(current?.crsCode) && facts.georef.crsName) {
    const code = facts.georef.crsName.toUpperCase().replace(/\s+/g, '');
    if (CRS_OPTIONS.some((o) => o.code === code)) out.crsCode = code;
  }
  if (blank(current?.siteLatitude) && facts.georef.refLatitude !== null) out.siteLatitude = facts.georef.refLatitude;
  if (blank(current?.siteLongitude) && facts.georef.refLongitude !== null) out.siteLongitude = facts.georef.refLongitude;
  if (blank(current?.originEasting) && facts.georef.eastings !== null) out.originEasting = facts.georef.eastings;
  if (blank(current?.originNorthing) && facts.georef.northings !== null) out.originNorthing = facts.georef.northings;
  if (blank(current?.originHeightM) && facts.georef.orthogonalHeight !== null) {
    out.originHeightM = facts.georef.orthogonalHeight;
  }

  if (facts.storeys.length) {
    if (blank(current?.storeys)) {
      const sorted = facts.storeys;
      out.storeys = sorted.map((s, i) => {
        const next = sorted[i + 1];
        const height =
          s.elevationM !== null && next?.elevationM != null ? Math.round((next.elevationM - s.elevationM) * 100) / 100 : null;
        return { name: s.name, elevationM: s.elevationM, heightM: height, grossAreaSqm: null, use: '' };
      }) as Prisma.InputJsonValue;
    }
    const basements = facts.storeys.filter((s) => (s.elevationM ?? 0) < -0.5).length;
    if (blank(current?.modelNumBasements)) out.modelNumBasements = basements;
    if (blank(current?.modelNumFloors)) out.modelNumFloors = facts.storeys.length - basements;
  }

  return out;
}

/** Resolves a BIM file version the caller may read, scoped through its application. */
export async function downloadBimVersion(user: AuthUser, versionId: string, meta: Meta) {
  if (!isUuid(versionId)) throw notFound('That file could not be found.');

  const version = await prisma.bimModelVersion.findFirst({
    where: { id: versionId, bimModel: { application: { deletedAt: null, ...applicationScope(user) } } },
    select: {
      id: true,
      versionNo: true,
      fileObjectId: true,
      bimModel: { select: { title: true, applicationId: true } },
    },
  });
  if (!version) throw notFound('That file could not be found.');

  const { bytes, file } = await readFileObject(version.fileObjectId);

  await audit(prisma, {
    actor: user,
    action: 'BIM_MODEL_DOWNLOADED',
    entityType: 'BimModelVersion',
    entityId: version.id,
    applicationId: version.bimModel.applicationId,
    after: { versionNo: version.versionNo, fileName: file.originalName, model: version.bimModel.title },
    ...meta,
  });

  return { bytes, file, versionNo: version.versionNo, title: version.bimModel.title };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function toRecordLike(s: ReturnType<typeof emptySubmission> | SubmissionRow): BimRecordLike {
  return {
    ...s,
    contentChecklist: (s.contentChecklist ?? {}) as Record<string, boolean>,
    declaredAt: s.declaredAt,
  };
}

function emptySubmission(applicationId: string) {
  return {
    id: '',
    applicationId,
    modelReference: '',
    authoringSoftware: '',
    authoringVersion: '',
    ifcSchema: '',
    modelViewDefinition: '',
    levelOfDevelopment: '',
    classificationSystem: '',
    lengthUnit: '',
    disciplines: [] as string[],
    crsCode: '',
    verticalDatum: '',
    siteLatitude: null as number | null,
    siteLongitude: null as number | null,
    originEasting: null as number | null,
    originNorthing: null as number | null,
    originHeightM: null as number | null,
    trueNorthDeg: null as number | null,
    modelPlotAreaSqm: null as number | null,
    modelBuiltUpAreaSqm: null as number | null,
    modelCoverageAreaSqm: null as number | null,
    modelFarAreaSqm: null as number | null,
    modelBuildingHeightM: null as number | null,
    modelNumFloors: null as number | null,
    modelNumBasements: null as number | null,
    modelDwellingUnits: null as number | null,
    modelParkingSpaces: null as number | null,
    modelSetbackFrontM: null as number | null,
    modelSetbackRearM: null as number | null,
    modelSetbackLeftM: null as number | null,
    modelSetbackRightM: null as number | null,
    storeys: [] as Prisma.JsonValue,
    contentChecklist: {} as Prisma.JsonValue,
    clashDetectionDone: false,
    clashTool: '',
    clashDetectionDate: null as Date | null,
    unresolvedHardClashes: null as number | null,
    unresolvedSoftClashes: null as number | null,
    ifcValidationDone: false,
    ifcValidationTool: '',
    drawingsFromModel: false,
    bepReference: '',
    cdePlatform: '',
    informationStandard: '',
    bimManagerName: '',
    bimManagerOrganisation: '',
    bimManagerEmail: '',
    bimManagerPhone: '',
    bimManagerCredential: '',
    remarks: '',
    declaredAt: null as Date | null,
    declaredById: null as string | null,
    reviewStatus: 'NOT_REVIEWED',
    reviewRemarks: '',
    reviewedAt: null as Date | null,
    reviewedById: null as string | null,
    updatedAt: null as Date | null,
  };
}

function describeChange(keys: string[]): string {
  const blocks = new Set<string>();
  for (const key of keys) {
    if (['modelReference', 'authoringSoftware', 'authoringVersion', 'ifcSchema', 'modelViewDefinition', 'levelOfDevelopment', 'classificationSystem', 'lengthUnit', 'disciplines'].includes(key)) blocks.add('model particulars');
    else if (['crsCode', 'verticalDatum', 'siteLatitude', 'siteLongitude', 'originEasting', 'originNorthing', 'originHeightM', 'trueNorthDeg'].includes(key)) blocks.add('georeferencing');
    else if (key.startsWith('model') || key === 'storeys') blocks.add('model quantities');
    else if (key === 'contentChecklist') blocks.add('model content');
    else if (key.startsWith('clash') || key.startsWith('unresolved') || key.startsWith('ifcValidation') || key === 'drawingsFromModel') blocks.add('coordination');
    else if (key.startsWith('bimManager') || ['bepReference', 'cdePlatform', 'informationStandard'].includes(key)) blocks.add('information management');
    else if (key === 'remarks') blocks.add('remarks');
  }
  const list = [...blocks];
  if (!list.length) return 'The BIM particulars were updated.';
  if (list.length === 1) return `The ${list[0]} were updated.`;
  return `Updated: ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}.`;
}
