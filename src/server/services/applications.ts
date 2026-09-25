import 'server-only';
import type { Prisma } from '@prisma/client';
import { ApplicationStatus, type ShortfallStatus, type SlaStatus } from '@/types/enums';
import { prisma, type Tx } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isLtp, type AuthUser } from '@/server/auth/context';
import { audit } from './audit';
import { emit, EVENTS } from '@/server/events/outbox';
import { recordEvent, readTimeline, EVENT_TYPES } from './timeline';
import { allocateApplicationNumber } from './numbering';
import { badRequest, businessRule, forbidden, notFound, type ErrorDetail } from '@/server/http/errors';
import {
  STEP_SCHEMAS,
  isDataStepKey,
  type ApplicationListQuery,
  type CreateApplicationInput,
  type DataStepKey,
  type PaymentFilter,
  type SaveStepInput,
  type ScrutinyFilter,
  type ShortfallFilter,
} from '@/lib/schemas/applications';
import {
  REQUIRED_STEP_KEYS,
  WIZARD_STEPS,
  isEditableStatus,
  stepByKey,
  stepIndex,
  type StepKey,
} from '@/lib/application-steps';
import { BUCKETS, bucketFor } from '@/lib/application-buckets';
import { CLOSED_SHORTFALL_STATUSES } from '@/lib/constants';
import { isUuid } from '@/lib/utils';
import { requireAvailable } from './professional-registrations';

/**
 * LTP application management.
 *
 * ── The security rule this file exists to make structural ──────────────
 *
 * An application id arriving from a client means nothing on its own. EVERY
 * function here that touches one takes the `AuthUser` and merges
 * `applicationScope(user)` INTO the query, so the database is never asked for
 * a row the caller may not have:
 *
 *     findFirst({ where: { id, deletedAt: null, ...applicationScope(user) } })
 *                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *
 * Never `findUnique({ where: { id } })` followed by a check. The difference
 * matters for three reasons: an out-of-scope row is never loaded into memory
 * where a later refactor could leak it; counts and pagination stay correct;
 * and a missing row and a forbidden row produce the SAME response, so the
 * endpoint cannot be used to discover which application numbers exist.
 *
 * There is no unscoped read in this file. If one appears, that is the bug.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

// ═══════════════════════════════════════════════════════════════════════════
// Selects
// ═══════════════════════════════════════════════════════════════════════════

const LIST_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageCode: true,
  slaDueAt: true,
  slaStatus: true,
  openShortfalls: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  applicationType: { select: { id: true, code: true, name: true, numberPrefix: true } },
  applicant: { select: { name: true, phone: true } },
  property: {
    select: { district: true, localityName: true, surveyNumbers: true, plotNo: true, plotAreaSqm: true },
  },
  zone: { select: { id: true, code: true, name: true } },
  ltp: { select: { id: true, name: true, firmName: true } },
  // Who is holding the file right now. One row at most — the workflow
  // guarantees a single open task per instance, and the reconciliation script
  // checks that it really does.
  workflowInstance: {
    select: {
      tasks: {
        where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
        select: {
          assignedRoleKey: true,
          status: true,
          assignee: { select: { id: true, name: true } },
        },
        take: 1,
      },
    },
  },
  // The demand ledger and the latest payment attempt, so the register can show
  // a fee state and a payment state without a second round trip per row.
  fees: {
    where: { status: { not: 'CANCELLED' } },
    select: { status: true },
  },
  payments: {
    select: { status: true },
    orderBy: { initiatedAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ApplicationSelect;

const DETAIL_INCLUDE = {
  applicationType: {
    select: { id: true, code: true, name: true, description: true, numberPrefix: true, requiresScrutiny: true },
  },
  ltp: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      firmName: true,
      ltpLicenceNo: true,
      ltpLicenceClass: true,
      ltpValidUpto: true,
    },
  },
  zone: { select: { id: true, code: true, name: true } },
  applicant: true,
  property: true,
  building: true,
  draft: true,
} satisfies Prisma.ApplicationInclude;

type DetailApplication = Prisma.ApplicationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loads an application the caller is entitled to see, or throws.
 *
 * The SAME error for "does not exist" and "not yours" is deliberate — see the
 * note at the top of the file.
 */
async function requireApplication(user: AuthUser, id: string): Promise<DetailApplication> {
  // A malformed id would otherwise reach Postgres as a bad uuid cast and
  // surface as a 500. It is simply not found.
  if (!isUuid(id)) throw notFound('That application could not be found.');

  const app = await prisma.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    include: DETAIL_INCLUDE,
  });

  if (!app) throw notFound('That application could not be found.');
  return app;
}

/**
 * As above, and additionally requires the file to be in a state the LTP may
 * still edit.
 *
 * Two separate gates, deliberately: "may you see this?" and "may it change
 * right now?" are different questions, and a submitted application is
 * readable by its LTP long after it stops being editable.
 */
async function requireEditableApplication(user: AuthUser, id: string): Promise<DetailApplication> {
  const app = await requireApplication(user, id);

  if (!isEditableStatus(app.status)) {
    throw forbidden(
      app.status === 'SUBMITTED'
        ? 'This application has been filed and can no longer be edited.'
        : 'This application is with the department and can no longer be edited.'
    );
  }

  // An LTP may only edit their own file. `applicationScope` already enforces
  // this for the LTP role; the check is repeated because a future role that
  // can SEE everything must not silently inherit the ability to REWRITE it.
  if (isLtp(user) && app.ltpUserId !== user.id) {
    throw forbidden('You may only edit applications you filed.');
  }

  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How each wizard step reads from, and writes to, the real tables.
 *
 * Both directions live in ONE table so they cannot drift. That matters most at
 * submission: the completeness guard re-reads every step through `read()` and
 * re-validates it against the same schema the form used. It does NOT trust
 * `draft.completedSteps` — that is client-driven progress, and a guard that
 * trusts the thing it is guarding is not a guard.
 */

type StepWrite = {
  applicant?: Prisma.ApplicantUncheckedCreateWithoutApplicationInput;
  property?: Prisma.PropertyDetailUncheckedCreateWithoutApplicationInput;
  building?: Prisma.BuildingDetailUncheckedCreateWithoutApplicationInput;
  application?: Prisma.ApplicationUpdateInput;
};

type StepMapper = {
  read: (app: DetailApplication) => Record<string, unknown>;
  write: (data: never, app: DetailApplication) => StepWrite;
};

const STEP_MAPPERS: Record<DataStepKey, StepMapper> = {
  applicant: {
    read: (app) => ({
      name: app.applicant?.name ?? '',
      fatherName: app.applicant?.fatherName ?? '',
      email: app.applicant?.email ?? '',
      phone: app.applicant?.phone ?? '',
      aadhaarLast4: app.applicant?.aadhaarLast4 ?? '',
      panMasked: app.applicant?.panMasked ?? '',
      address: app.applicant?.address ?? '',
    }),
    write: (data: Record<string, unknown>) => ({ applicant: data as never }),
  },

  owner: {
    read: (app) => ({
      ownerSameAsApplicant: app.applicant?.ownerSameAsApplicant ?? true,
      ownerName: app.applicant?.ownerName ?? '',
      ownerPhone: app.applicant?.ownerPhone ?? '',
      ownerAddress: app.applicant?.ownerAddress ?? '',
    }),
    // When the owner IS the applicant the owner columns are cleared rather
    // than left holding a stale name from before the box was ticked.
    write: (data: Record<string, unknown>) =>
      data.ownerSameAsApplicant
        ? { applicant: { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' } as never }
        : { applicant: data as never },
  },

  property: {
    read: (app) => ({
      district: app.property?.district ?? '',
      mandal: app.property?.mandal ?? '',
      village: app.property?.village ?? '',
      localityName: app.property?.localityName ?? '',
      wardNo: app.property?.wardNo ?? '',
    }),
    write: (data: Record<string, unknown>) => ({ property: data as never }),
  },

  location: {
    read: (app) => ({
      zoneId: app.zoneId ?? '',
      doorNo: app.property?.doorNo ?? '',
      streetName: app.property?.streetName ?? '',
      pincode: app.property?.pincode ?? '',
      latitude: app.property?.latitude ?? null,
      longitude: app.property?.longitude ?? null,
      boundaryNorth: app.property?.boundaryNorth ?? '',
      boundarySouth: app.property?.boundarySouth ?? '',
      boundaryEast: app.property?.boundaryEast ?? '',
      boundaryWest: app.property?.boundaryWest ?? '',
    }),
    // The zone lives on the APPLICATION, not the property detail: it decides
    // which officers will ever see this file (applicationScope), so it belongs
    // on the row that authorization queries.
    write: (data: Record<string, unknown>) => {
      const { zoneId, ...property } = data as { zoneId: string } & Record<string, unknown>;
      return {
        property: property as never,
        application: { zone: { connect: { id: zoneId } } },
      };
    },
  },

  survey: {
    read: (app) => ({
      surveyNumbers: app.property?.surveyNumbers ?? '',
      plotNo: app.property?.plotNo ?? '',
      layoutName: app.property?.layoutName ?? '',
      lpNumber: app.property?.lpNumber ?? '',
      // '' rather than 0 for the columns that mean "not answered yet" when
      // NULL. It renders as an EMPTY input instead of a spurious zero, the
      // review screen prints "Not entered", and `z.coerce.number('')` is 0 so
      // the schema still reports "Enter the plot area in square metres".
      plotAreaSqm: app.property?.plotAreaSqm ?? '',
      roadWidthM: app.property?.roadWidthM ?? 0,
      landUseZone: app.property?.landUseZone ?? '',
      tenureType: app.property?.tenureType ?? '',
    }),
    write: (data: Record<string, unknown>) => ({
      property: data as never,
      // Keep the building record's copy of the plot area in step with the
      // survey. Two columns holding the same fact is a Phase 1 decision; this
      // is where they are kept honest, rather than asking the LTP to type it
      // twice and hoping the numbers agree.
      building: { plotAreaSqm: positiveOrNull(data.plotAreaSqm) } as never,
    }),
  },

  development: {
    read: (app) => ({
      buildingUse: app.building?.buildingUse ?? '',
      buildingSubUse: app.building?.buildingSubUse ?? '',
      occupancyType: app.building?.occupancyType ?? '',
      structureType: app.building?.structureType ?? '',
      numFloors: app.building?.numFloors ?? 0,
      numBasements: app.building?.numBasements ?? 0,
      numDwellingUnits: app.building?.numDwellingUnits ?? 0,
      buildingHeightM: app.building?.buildingHeightM ?? 0,
    }),
    write: (data: Record<string, unknown>) => ({ building: data as never }),
  },

  building: {
    read: (app) => ({
      // Sourced from the survey step, never re-typed. '' when unanswered —
      // see the note on the survey step above.
      plotAreaSqm: app.property?.plotAreaSqm ?? app.building?.plotAreaSqm ?? '',
      builtUpAreaSqm: app.building?.builtUpAreaSqm ?? '',
      floorAreaSqm: app.building?.floorAreaSqm ?? 0,
      coverageAreaSqm: app.building?.coverageAreaSqm ?? 0,
      parkingAreaSqm: app.building?.parkingAreaSqm ?? 0,
      setbackFrontM: app.building?.setbackFrontM ?? 0,
      setbackRearM: app.building?.setbackRearM ?? 0,
      setbackLeftM: app.building?.setbackLeftM ?? 0,
      setbackRightM: app.building?.setbackRightM ?? 0,
    }),
    write: (data: Record<string, unknown>, app) => {
      // The plot area is authoritative on the property record. Taking it from
      // the request would let the client change the divisor and so the
      // achieved FAR.
      // Null-preserving: if the survey step has not been done, the plot area
      // stays unanswered rather than becoming a zero nobody entered.
      const plotArea = app.property?.plotAreaSqm ?? positiveOrNull(data.plotAreaSqm);
      const floorArea = Number(data.floorAreaSqm) || 0;
      const coverageArea = Number(data.coverageAreaSqm) || 0;

      return {
        building: {
          ...(data as Record<string, unknown>),
          plotAreaSqm: plotArea,
          builtUpAreaSqm: positiveOrNull(data.builtUpAreaSqm),
          // Derived, never entered. Whether these values are PERMISSIBLE is a
          // byelaw question for scrutiny in Phase 3 — no schedule has been
          // supplied, so nothing is asserted about them here.
          achievedFar: plotArea ? round(floorArea / plotArea, 4) : 0,
          achievedCoverage: plotArea ? round((coverageArea / plotArea) * 100, 2) : 0,
        } as never,
      };
    },
  },

  ltp: {
    read: (app) => ({
      declarationAccepted: Boolean(app.ltpDeclaredAt),
      remarks: (app.ltpDeclaration as { remarks?: string } | null)?.remarks ?? '',
      professionalRegistrationId: app.applicant?.ltpRegistrationId ?? '',
      structuralEngineerRegistrationId: app.applicant?.structuralEngineerRegistrationId ?? '',
    }),
    // Written by saveStep directly — the licence particulars are read from the
    // filing LTP's own record on the server and never accepted from the
    // client. See applyLtpStep().
    write: () => ({}),
  },
};

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * A measurement, or null when it was not supplied.
 *
 * Zero and blank both mean "not answered" for the areas a filed application
 * must carry, and storing either as `0` would make an unmeasured plot
 * indistinguishable from a plot measured at nothing. See the phase-2 follow-up
 * migration.
 */
function positiveOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Create
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Starts a new file.
 *
 * The application number is allocated inside this transaction, so it commits
 * with the row or not at all — see services/numbering.ts for why gap-free
 * matters for a statutory register, and how the race is closed.
 *
 * `ltpUserId` is the SIGNED-IN user, always. There is no field for it in the
 * request, because filing on someone else's behalf is not a thing this system
 * permits.
 */
export async function createApplication(user: AuthUser, input: CreateApplicationInput, meta: Meta) {
  const type = await prisma.applicationType.findFirst({
    where: { id: input.applicationTypeId, deletedAt: null, isActive: true },
    select: { id: true, code: true, name: true, numberPrefix: true },
  });

  if (!type) throw badRequest('Choose an application type that is currently available.');

  const created = await prisma.$transaction(async (tx) => {
    const { applicationNumber, sequence } = await allocateApplicationNumber(tx, type.numberPrefix);

    const app = await tx.application.create({
      data: {
        applicationNumber,
        applicationTypeId: type.id,
        ltpUserId: user.id,
        status: 'DRAFT',
        purpose: 'NEW',
        applicant: { create: input.applicant ? (input.applicant as never) : {} },
        // Both child records are created empty so every step of the wizard has
        // a row to write into. They are legitimately partial until submission
        // — see the phase-2 migration for why the NOT NULLs were given
        // defaults rather than the wizard being made to fill them out of order.
        property: { create: {} },
        building: { create: {} },
        draft: {
          create: {
            currentStep: input.applicant ? 1 : 0,
            completedSteps: input.applicant ? ['applicant'] : [],
          },
        },
      },
      include: DETAIL_INCLUDE,
    });

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.APPLICATION_CREATED,
      title: 'Application created',
      description: `${type.name} — ${applicationNumber}`,
      actor: user,
      metadata: { applicationNumber, applicationType: type.code, sequence },
    });

    await audit(tx, {
      actor: user,
      action: 'APPLICATION_CREATED',
      entityType: 'Application',
      entityId: app.id,
      applicationId: app.id,
      after: { applicationNumber, applicationTypeId: type.id, status: 'DRAFT' },
      ...meta,
    });

    await emit(tx, {
      eventCode: EVENTS.APPLICATION_CREATED,
      applicationId: app.id,
      payload: { applicationNumber, applicationTypeCode: type.code, ltpUserId: user.id },
    });

    return app;
  }, { timeout: 30000 });

  return shapeDetail(created);
}

// ═══════════════════════════════════════════════════════════════════════════
// Save a step
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Saves one step of the wizard.
 *
 * Two modes:
 *
 *   partial: true   — "Save draft". The values have NOT passed their schema,
 *                     so they go to `application_drafts.scratch` and nowhere
 *                     near the real tables. A half-filled step survives a
 *                     reload without a half-valid row reaching the register.
 *
 *   partial: false  — "Next". The values are parsed against the step's schema;
 *                     a failure is a 400 with field-level detail and nothing
 *                     is written. On success the real rows are updated, the
 *                     step is marked complete, and its scratch entry is
 *                     discarded because the persisted row now supersedes it.
 *
 * The schema is looked up from STEP_SCHEMAS by the step key. The client
 * chooses WHICH step it is saving; it never gets a say in HOW that step is
 * validated.
 */
export async function saveStep(user: AuthUser, id: string, input: SaveStepInput, meta: Meta) {
  const app = await requireEditableApplication(user, id);

  const step = stepByKey(input.step);
  if (!step) throw badRequest('That is not a step of this form.');

  const targetIndex = stepIndex(step.key);

  // ── Steps that capture nothing: Review and Submit ──────────────────────
  if (!step.capturesData) {
    await prisma.applicationDraft.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, currentStep: targetIndex },
      update: { currentStep: targetIndex },
    });
    return getWizardState(user, app.id);
  }

  if (!isDataStepKey(step.key)) throw badRequest('That step cannot be saved.');
  const stepKey: DataStepKey = step.key;

  // ── Save draft: unvalidated, scratch only ──────────────────────────────
  if (input.partial) {
    const scratch = asRecord(app.draft?.scratch);
    await prisma.applicationDraft.upsert({
      where: { applicationId: app.id },
      create: {
        applicationId: app.id,
        currentStep: targetIndex,
        scratch: { [stepKey]: input.data } as never,
      },
      update: {
        currentStep: targetIndex,
        scratch: { ...scratch, [stepKey]: input.data } as never,
      },
    });
    return getWizardState(user, app.id);
  }

  // ── Next: validated, written through to the real tables ────────────────
  // Throws ZodError, which the route wrapper turns into a 400 carrying the
  // path and message of every offending field.
  const parsed = STEP_SCHEMAS[stepKey].parse(input.data) as Record<string, unknown>;

  const before = STEP_MAPPERS[stepKey].read(app);
  const completed = Array.isArray(app.draft?.completedSteps) ? (app.draft.completedSteps as string[]) : [];
  const firstCompletion = !completed.includes(stepKey);

  await prisma.$transaction(async (tx) => {
    if (stepKey === 'ltp') {
      await applyLtpStep(tx, app, parsed as LtpStepWrite);
    } else {
      await applyStepWrite(tx, app, STEP_MAPPERS[stepKey].write(parsed as never, app));
    }

    // `updatedAt` is @updatedAt, so it only moves when a column does. The
    // child tables were what changed above; touching the parent is what keeps
    // "Last updated" on the list truthful.
    await tx.application.update({ where: { id: app.id }, data: { updatedAt: new Date() } });

    const scratch = asRecord(app.draft?.scratch);
    delete scratch[stepKey];

    await tx.applicationDraft.upsert({
      where: { applicationId: app.id },
      create: {
        applicationId: app.id,
        currentStep: Math.min(targetIndex + 1, WIZARD_STEPS.length - 1),
        completedSteps: [stepKey],
        scratch: scratch as never,
      },
      update: {
        currentStep: Math.min(targetIndex + 1, WIZARD_STEPS.length - 1),
        completedSteps: unique([...completed, stepKey]),
        scratch: scratch as never,
      },
    });

    await audit(tx, {
      actor: user,
      action: 'APPLICATION_UPDATED',
      entityType: 'Application',
      entityId: app.id,
      applicationId: app.id,
      before: { step: stepKey, ...before },
      after: { step: stepKey, ...redactForAudit(stepKey, parsed) },
      remarks: `${step.label} saved`,
      ...meta,
    });

    // The timeline records the FIRST completion of each step, and every change
    // made after filing. Re-saving the same draft step five times is not five
    // things that happened to the application — the audit log holds that
    // detail; this is the story someone reads.
    if (firstCompletion || app.status !== 'DRAFT') {
      await recordEvent(tx, {
        applicationId: app.id,
        type: EVENT_TYPES.APPLICATION_UPDATED,
        title: 'Application updated',
        description: `${step.label} ${firstCompletion ? 'completed' : 'revised'}.`,
        actor: user,
        metadata: { step: stepKey, firstCompletion },
      });
    }
  });

  return getWizardState(user, app.id);
}

/** Applies a step's write payload to whichever child rows it touches. */
async function applyStepWrite(tx: Tx, app: DetailApplication, write: StepWrite) {
  if (write.applicant) {
    await tx.applicant.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, ...write.applicant },
      update: write.applicant,
    });
  }

  if (write.property) {
    await tx.propertyDetail.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, ...write.property },
      update: write.property,
    });
  }

  if (write.building) {
    await tx.buildingDetail.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, ...write.building },
      update: write.building,
    });
  }

  if (write.application) {
    await tx.application.update({ where: { id: app.id }, data: write.application });
  }
}

/**
 * The LTP declaration.
 *
 * The licence number, class, validity and firm are read from the FILING LTP's
 * own user record, server-side. They are not in the step schema and are not
 * accepted from the request — otherwise anyone could file under any licence
 * number they cared to type.
 *
 * The result is frozen into `ltpDeclaration`: a licence may lapse or change
 * class after filing, and the record must show what was true at the time.
 */
type LtpStepWrite = { declarationAccepted: true; remarks: string; professionalRegistrationId: string; structuralEngineerRegistrationId: string };

async function applyLtpStep(tx: Tx, app: DetailApplication, data: LtpStepWrite) {
  const ltp = await tx.user.findUnique({
    where: { id: app.ltpUserId },
    select: {
      name: true,
      email: true,
      phone: true,
      firmName: true,
      ltpLicenceNo: true,
      ltpLicenceClass: true,
      ltpValidUpto: true,
    },
  });

  if (!ltp) throw badRequest('The licensed technical person on this file could not be read.');

  if (!ltp.ltpLicenceNo) {
    throw businessRule(
      'Your licence number is not on your profile, so this declaration cannot be recorded. ' +
        'Ask an administrator to add it before filing.',
      [{ path: 'declarationAccepted', message: 'Licence number missing from your profile' }]
    );
  }

  // The professional register (Phase 12). Each named entry must be approved
  // and in force today; the file records WHICH entry (by id) and prints its
  // particulars into the fields the application has always carried.
  const own = data.professionalRegistrationId
    ? await requireAvailable(tx, data.professionalRegistrationId, 'FILE_HOLDER', { userId: app.ltpUserId })
    : null;
  const structural = data.structuralEngineerRegistrationId
    ? await requireAvailable(tx, data.structuralEngineerRegistrationId, 'STRUCTURAL')
    : null;
  await tx.applicant.upsert({
    where: { applicationId: app.id },
    create: {
      applicationId: app.id,
      ltpRegistrationId: own?.id ?? null,
      professionalRegistrationRef: own?.registrationNumber ?? '',
      structuralEngineerRegistrationId: structural?.id ?? null,
      structuralEngineerName: structural?.name ?? '',
      structuralEngineerPhone: structural?.mobile ?? '',
      structuralEngineerRegNo: structural?.registrationNumber ?? '',
    },
    update: {
      ltpRegistrationId: own?.id ?? null,
      ...(own ? { professionalRegistrationRef: own.registrationNumber ?? '' } : {}),
      structuralEngineerRegistrationId: structural?.id ?? null,
      ...(structural
        ? { structuralEngineerName: structural.name, structuralEngineerPhone: structural.mobile, structuralEngineerRegNo: structural.registrationNumber ?? '' }
        : app.applicant?.structuralEngineerRegistrationId
          ? { structuralEngineerName: '', structuralEngineerPhone: '', structuralEngineerRegNo: '' }
          : {}),
      ...(!own && app.applicant?.ltpRegistrationId ? { professionalRegistrationRef: '' } : {}),
    },
  });

  await tx.application.update({
    where: { id: app.id },
    data: {
      ltpDeclaredAt: new Date(),
      ltpDeclaration: {
        acceptedAt: new Date().toISOString(),
        name: ltp.name,
        email: ltp.email,
        phone: ltp.phone,
        firmName: ltp.firmName,
        licenceNo: ltp.ltpLicenceNo,
        licenceClass: ltp.ltpLicenceClass,
        validUpto: ltp.ltpValidUpto?.toISOString() ?? null,
        remarks: data.remarks,
        professionalRegistration: own ? { id: own.id, number: own.registrationNumber, type: own.professionalType, validTo: own.validTo?.toISOString() ?? null } : null,
        structuralEngineer: structural ? { id: structural.id, number: structural.registrationNumber, name: structural.name } : null,
      } as never,
    },
  });
}

/**
 * The applicant step carries identity fragments. The audit trail keeps them —
 * a government register must be able to show what was entered and when — but
 * the two that are already deliberately partial in the schema stay partial
 * here too, rather than being reassembled anywhere.
 */
function redactForAudit(step: DataStepKey, data: Record<string, unknown>) {
  if (step !== 'applicant') return data;
  return { ...data, aadhaarLast4: data.aadhaarLast4 ? '••••' : '' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Submit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Files the application.
 *
 * Completeness is RE-DERIVED, not trusted. Every required step is read back
 * out of the persisted rows and pushed through the same schema the form used.
 * `draft.completedSteps` is UI progress and is not consulted — a client that
 * marked every step complete without filling any in gets a 422 listing exactly
 * what is missing, field by field.
 *
 * Status becomes SUBMITTED. Phase 2 has no drawings, no documents and no fees,
 * so filing the particulars IS filing. When those phases land they add GUARDS
 * to this transition — "an active drawing version that passed scrutiny must
 * exist", "no mandatory document outstanding", "the demand is paid" — rather
 * than new statuses; that is how docs/03-workflow.md models preconditions, and
 * where the intervening LTP-side statuses in ApplicationStatus come in.
 *
 * Routing to a department stage belongs to the workflow engine in Phase 7.
 * Nothing here invents it.
 */
export async function submitApplication(user: AuthUser, id: string, meta: Meta) {
  const app = await requireEditableApplication(user, id);

  const problems = validateForSubmission(app);
  if (problems.length) {
    throw businessRule(
      'This application is not complete yet. Fix the items below and file it again.',
      problems
    );
  }

  const submittedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // Re-assert the status INSIDE the transaction. Two tabs pressing Submit
    // together would otherwise both pass the check above and both write. This
    // updateMany touches zero rows for the loser, which is detected below.
    const claimed = await tx.application.updateMany({
      where: { id: app.id, status: 'DRAFT', deletedAt: null },
      data: { status: 'SUBMITTED', submittedAt, updatedAt: submittedAt },
    });

    if (claimed.count === 0) {
      throw businessRule('This application has already been filed.');
    }

    // The wizard is finished; its interface state has served its purpose.
    await tx.applicationDraft.deleteMany({ where: { applicationId: app.id } });

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.APPLICATION_SUBMITTED,
      title: 'Application submitted',
      description: `Filed by ${user.name}. Awaiting departmental review.`,
      actor: user,
      metadata: { applicationNumber: app.applicationNumber, fromStatus: 'DRAFT', toStatus: 'SUBMITTED' },
      occurredAt: submittedAt,
    });

    await audit(tx, {
      actor: user,
      action: 'APPLICATION_SUBMITTED',
      entityType: 'Application',
      entityId: app.id,
      applicationId: app.id,
      before: { status: 'DRAFT' },
      after: { status: 'SUBMITTED', submittedAt },
      ...meta,
    });

    // APPLICATION_SUBMITTED, not APPLICATION_FORWARDED. Forwarding is a
    // desk-to-desk move made by an officer; this is the applicant handing the
    // file in, and an applicant who is told their own filing was "forwarded"
    // reasonably asks who forwarded it and to whom. The audience is identical,
    // so the change costs nothing and the wording stops being wrong.
    await emit(tx, {
      eventCode: EVENTS.APPLICATION_SUBMITTED,
      applicationId: app.id,
      payload: {
        applicationNumber: app.applicationNumber,
        status: 'SUBMITTED',
        ltpUserId: app.ltpUserId,
        zoneId: app.zoneId,
        submittedAt: submittedAt.toISOString(),
      },
    });

    return tx.application.findFirstOrThrow({ where: { id: app.id }, include: DETAIL_INCLUDE });
  }, { timeout: 30000 });

  return shapeDetail(updated);
}

/**
 * Runs every required step's schema over the persisted data.
 *
 * Returns one ErrorDetail per offending field, pathed `step.field`, so the
 * review screen can point at the step AND the field rather than saying
 * "something is missing".
 */
export function validateForSubmission(app: DetailApplication): ErrorDetail[] {
  const problems: ErrorDetail[] = [];

  for (const key of REQUIRED_STEP_KEYS) {
    if (!isDataStepKey(key)) continue;

    const value = STEP_MAPPERS[key].read(app);
    const result = STEP_SCHEMAS[key].safeParse(value);
    if (result.success) continue;

    const label = stepByKey(key)?.label ?? key;
    for (const issue of result.error.issues) {
      problems.push({
        path: `${key}.${issue.path.join('.')}`,
        message: `${label}: ${issue.message}`,
      });
    }
  }

  // The declaration is a fact about the application row, not a form field, so
  // it is checked here rather than by a schema.
  if (!app.ltpDeclaredAt) {
    problems.push({
      path: 'ltp.declarationAccepted',
      message: 'Licensed technical person: accept the declaration before filing',
    });
  }

  return problems;
}

/** Which steps are complete right now, derived rather than remembered. */
export function completionByStep(app: DetailApplication): Record<StepKey, boolean> {
  const out = {} as Record<StepKey, boolean>;

  for (const step of WIZARD_STEPS) {
    if (!step.capturesData || !isDataStepKey(step.key)) {
      out[step.key] = true;
      continue;
    }
    out[step.key] = STEP_SCHEMAS[step.key].safeParse(STEP_MAPPERS[step.key].read(app)).success;
  }

  if (!app.ltpDeclaredAt) out.ltp = false;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Delete a draft
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Soft-deletes a draft.
 *
 * Soft, because the application number has already been issued from a gap-free
 * register and the row is what accounts for it. Only a DRAFT can be removed at
 * all — once filed, an application is withdrawn through the workflow, which is
 * a decision with a record, not a delete.
 */
export async function deleteDraft(user: AuthUser, id: string, meta: Meta) {
  const app = await requireEditableApplication(user, id);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.application.updateMany({
      where: { id: app.id, status: 'DRAFT', deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (removed.count === 0) throw businessRule('This application can no longer be deleted.');

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.APPLICATION_DELETED,
      title: 'Draft deleted',
      description: `Deleted by ${user.name}.`,
      actor: user,
      metadata: { applicationNumber: app.applicationNumber },
    });

    await audit(tx, {
      actor: user,
      action: 'APPLICATION_DELETED',
      entityType: 'Application',
      entityId: app.id,
      applicationId: app.id,
      before: { status: app.status, applicationNumber: app.applicationNumber },
      after: { deleted: true },
      ...meta,
    });
  });

  return { ok: true, applicationNumber: app.applicationNumber };
}

// ═══════════════════════════════════════════════════════════════════════════
// Read
// ═══════════════════════════════════════════════════════════════════════════

export async function getApplication(user: AuthUser, id: string) {
  return shapeDetail(await requireApplication(user, id));
}

/** The wizard's whole state: the file, the step values, and where it left off. */
export async function getWizardState(user: AuthUser, id: string) {
  const app = await requireEditableApplication(user, id);

  const steps: Record<string, unknown> = {};
  for (const step of WIZARD_STEPS) {
    if (isDataStepKey(step.key)) steps[step.key] = STEP_MAPPERS[step.key].read(app);
  }

  return {
    application: shapeDetail(app),
    steps,
    completion: completionByStep(app),
    problems: validateForSubmission(app),
    draft: {
      currentStep: app.draft?.currentStep ?? 0,
      completedSteps: app.draft?.completedSteps ?? [],
      scratch: asRecord(app.draft?.scratch),
      updatedAt: app.draft?.updatedAt ?? null,
    },
  };
}

export async function getTimeline(user: AuthUser, id: string) {
  // Access first, always — readTimeline() does no authorization of its own.
  const app = await requireApplication(user, id);
  return readTimeline(prisma, app.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// List
// ═══════════════════════════════════════════════════════════════════════════

export async function listApplications(user: AuthUser, query: ApplicationListQuery) {
  const where = buildListWhere(user, query);

  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where,
      select: LIST_SELECT,
      orderBy: orderByFor(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.application.count({ where }),
  ]);

  return {
    data: rows.map(shapeRow),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

function buildListWhere(user: AuthUser, query: ApplicationListQuery): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [
    { deletedAt: null },
    // The scope fragment is merged in, never applied after the fetch. This is
    // the line that makes the list safe.
    applicationScope(user),
  ];

  if (query.q) {
    const q = query.q;
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: 'insensitive' } },
        { applicant: { name: { contains: q, mode: 'insensitive' } } },
        { applicant: { phone: { contains: q } } },
        { property: { surveyNumbers: { contains: q, mode: 'insensitive' } } },
        { property: { localityName: { contains: q, mode: 'insensitive' } } },
        { property: { plotNo: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  // Bucket and explicit statuses are ANDed rather than merged, so
  // ?bucket=draft&status=SUBMITTED correctly returns nothing instead of
  // quietly returning one of the two.
  const bucket = query.bucket ? bucketFor(query.bucket) : undefined;
  if (query.bucket && !bucket) throw badRequest('That is not a filter this list offers.');
  if (bucket?.statuses.length) and.push({ status: { in: asStatuses(bucket.statuses) } });

  if (query.status?.length) {
    // A value that is not a member of the enum is dropped rather than handed
    // to Postgres, where it would fail the cast and surface as a 500. If that
    // leaves nothing, the filter matches nothing — which is what the user
    // asked for, however they mistyped it.
    and.push({ status: { in: asStatuses(query.status.filter(isApplicationStatus)) } });
  }

  if (query.applicationTypeId) and.push({ applicationTypeId: query.applicationTypeId });
  if (query.zoneId) and.push({ zoneId: query.zoneId });
  if (query.stage) and.push({ currentStageCode: query.stage });

  // ── The derived filters ───────────────────────────────────────────────
  //
  // Each resolves against the rows that decide it rather than against a
  // status word, so the count a filter returns and the state a row is
  // genuinely in cannot disagree. See the comment on PAYMENT_FILTERS.

  if (query.payment) and.push(paymentFilter(query.payment));
  if (query.scrutiny) and.push(scrutinyFilter(query.scrutiny));
  if (query.shortfall) and.push(shortfallFilter(query.shortfall));

  if (query.sla) {
    and.push(query.sla === 'none' ? { slaStatus: null } : { slaStatus: query.sla as SlaStatus });
  }

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    and.push({
      createdAt: {
        ...(from ? { gte: from } : {}),
        // The user means the whole of the end day, not midnight at its start.
        ...(to ? { lte: endOfDay(to) } : {}),
      },
    });
  }

  return { AND: and };
}

/** Money, from the demand ledger and the attempts against it. */
function paymentFilter(value: PaymentFilter): Prisma.ApplicationWhereInput {
  const LIVE: Prisma.ApplicationFeeWhereInput = { status: { not: 'CANCELLED' } };

  switch (value) {
    case 'none':
      // No demand has been raised, so there is nothing to pay yet.
      return { fees: { none: LIVE } };
    case 'unpaid':
      return { fees: { some: { ...LIVE, status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] } } } };
    case 'paid':
      // Every live demand settled — and at least one exists, so a file with no
      // demand at all is not reported as paid.
      return {
        AND: [
          { fees: { some: LIVE } },
          { fees: { none: { ...LIVE, status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] } } } },
        ],
      };
    case 'failed':
      return { payments: { some: { status: { in: ['FAILED', 'CANCELLED', 'TIMEOUT'] } } } };
    case 'inflight':
      return { payments: { some: { status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] } } } };
  }
}

/**
 * Scrutiny, from the results attached to the ACTIVE drawing versions.
 *
 * "Active" matters: a file that failed on V1 and passed on V2 has both results
 * on record, and reporting it as failed because a superseded version failed
 * would send the applicant back to correct a drawing they already corrected.
 */
function scrutinyFilter(value: ScrutinyFilter): Prisma.ApplicationWhereInput {
  const onActiveVersion = (
    requests: Prisma.ScrutinyRequestWhereInput
  ): Prisma.ApplicationWhereInput => ({
    drawings: { some: { versions: { some: { isActive: true, scrutinyRequests: { some: requests } } } } },
  });

  const failed = onActiveVersion({ result: { outcome: 'FAIL' } });

  switch (value) {
    case 'none':
      return { NOT: onActiveVersion({}) };
    case 'running':
      return onActiveVersion({ status: { in: ['QUEUED', 'RUNNING'] } });
    case 'failed':
      return failed;
    case 'passed':
      return { AND: [onActiveVersion({ result: { outcome: 'PASS' } }), { NOT: failed }] };
  }
}

/** Shortfalls, counted from the rows rather than from the cached counter. */
function shortfallFilter(value: ShortfallFilter): Prisma.ApplicationWhereInput {
  // Stated as plain strings in `src/lib/constants.ts` because that module is
  // isomorphic; cast here, on the server, where Prisma's enum is available.
  const OPEN: Prisma.ShortfallWhereInput = {
    status: { notIn: [...CLOSED_SHORTFALL_STATUSES] as ShortfallStatus[] },
  };

  switch (value) {
    case 'open':
      return { shortfalls: { some: OPEN } };
    case 'none':
      return { shortfalls: { none: OPEN } };
    case 'resolved':
      return { AND: [{ shortfalls: { some: { status: 'RESOLVED' } } }, { shortfalls: { none: OPEN } }] };
    case 'document':
      return { shortfalls: { some: { ...OPEN, kind: 'DOCUMENT' } } };
    case 'fee':
      return { shortfalls: { some: { ...OPEN, kind: 'FEE' } } };
  }
}

/**
 * The bridge between the isomorphic bucket definitions (plain strings, because
 * `src/lib` must not import Prisma into a client bundle) and the enum Prisma
 * wants. `isApplicationStatus` is the guard that makes the cast honest rather
 * than merely quiet.
 */
export const isApplicationStatus = (value: string): value is ApplicationStatus =>
  Object.prototype.hasOwnProperty.call(ApplicationStatus, value);

const asStatuses = (values: string[]): ApplicationStatus[] =>
  values.filter(isApplicationStatus);

function orderByFor(query: ApplicationListQuery): Prisma.ApplicationOrderByWithRelationInput[] {
  // `sort` is a Zod enum over SORTABLE_FIELDS, so it can only ever be one of
  // six known columns — a query string never reaches Prisma as a column name.
  return [{ [query.sort]: query.dir }, { id: 'desc' }];
}

/**
 * Parses a filter date.
 *
 * A bare `YYYY-MM-DD` is read as LOCAL midnight, not UTC midnight.
 * `new Date('2026-08-26')` gives UTC midnight, and pairing that with an
 * `endOfDay` computed in local time produces a window that is neither one
 * timezone nor the other: in UTC+5:30 the "26 August" filter ran from
 * 05:30 on the 26th to 18:29 on the same day, so an application created that
 * evening was invisible in a filter for the day it was created.
 *
 * The user means a local calendar day, so both ends are local.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;

  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bareDate) {
    const [, y, m, d] = bareDate;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // A full timestamp carries its own offset; take it as given.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The last instant of the same LOCAL day — the other half of the pair above. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The KPI tiles.
 *
 * ONE groupBy rather than nine counts — and, more importantly, the tiles and
 * the list they link to read the same bucket definitions, so a tile saying
 * "4" and the list showing three becomes impossible rather than merely
 * unlikely. See src/lib/application-buckets.ts.
 */
export async function getDashboardStats(user: AuthUser) {
  const where: Prisma.ApplicationWhereInput = { deletedAt: null, ...applicationScope(user) };

  const grouped = await prisma.application.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });

  const byStatus = new Map(grouped.map((row) => [row.status as string, row._count._all]));
  const total = grouped.reduce((sum, row) => sum + row._count._all, 0);

  const counts: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    counts[bucket.key] = bucket.statuses.length
      ? bucket.statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0)
      : total;
  }

  return { counts, byStatus: Object.fromEntries(byStatus), total };
}

/** The dashboard's "Recent applications" table. */
export async function getRecentApplications(user: AuthUser, limit = 8) {
  const rows = await prisma.application.findMany({
    where: { deletedAt: null, ...applicationScope(user) },
    select: LIST_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return rows.map(shapeRow);
}

/** Reference data the list filters and the wizard both need. */
export async function getApplicationMeta() {
  const [types, zones, masterData] = await Promise.all([
    prisma.applicationType.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, description: true, numberPrefix: true, requiresScrutiny: true },
      orderBy: { name: 'asc' },
    }),
    prisma.zone.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.masterData.findMany({
      where: { isActive: true },
      select: { category: true, code: true, label: true, displayOrder: true },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
    }),
  ]);

  // Grouped by category, because that is how every consumer uses it.
  const master: Record<string, Array<{ code: string; label: string }>> = {};
  for (const row of masterData) {
    (master[row.category] ??= []).push({ code: row.code, label: row.label });
  }

  return { types, zones, master };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shaping
// ═══════════════════════════════════════════════════════════════════════════

type ListRow = Prisma.ApplicationGetPayload<{ select: typeof LIST_SELECT }>;

/**
 * Adds the two derived values every list needs, computed in ONE place.
 *
 * `slaDaysRemaining` is null until Phase 9 starts SLA clocks; the column shows
 * "Not started" rather than a fabricated number, because a dashboard that
 * invents a figure teaches people to distrust all of them.
 */
function shapeRow(row: ListRow) {
  const { fees, payments, workflowInstance, ...rest } = row;
  const task = workflowInstance?.tasks[0] ?? null;

  return {
    ...rest,
    propertyLabel: propertyLabel(row.property),
    slaDaysRemaining: daysUntil(row.slaDueAt),
    feeStatus: feeStateOf(fees),
    paymentStatus: payments[0]?.status ?? null,
    assignedTo: task
      ? { name: task.assignee?.name ?? null, roleKey: task.assignedRoleKey, claimed: Boolean(task.assignee) }
      : null,
  };
}

/**
 * One word for where the money stands on an application.
 *
 * A file may carry several demands — an original and one or more shortfall
 * demands — so this reports the WORST outstanding state rather than the newest
 * one. A file whose original demand is paid and whose shortfall demand is not
 * is not a paid file, and a register that called it paid would send an officer
 * looking for money that has not arrived.
 */
function feeStateOf(fees: Array<{ status: string }>): 'NONE' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED' {
  if (!fees.length) return 'NONE';
  if (fees.some((f) => f.status === 'ISSUED' || f.status === 'DRAFT')) return 'ISSUED';
  if (fees.some((f) => f.status === 'PARTIALLY_PAID')) return 'PARTIALLY_PAID';
  if (fees.every((f) => f.status === 'WAIVED')) return 'WAIVED';
  return 'PAID';
}

function shapeDetail(app: DetailApplication) {
  const { draft, ...rest } = app;
  return {
    ...rest,
    propertyLabel: propertyLabel(app.property),
    slaDaysRemaining: daysUntil(app.slaDueAt),
    hasDraft: Boolean(draft),
  };
}

/**
 * "Plot 7, Sy. 123/A, Banjara Hills, Hyderabad" from whichever parts exist.
 *
 * Every field is optional here — not because they all are on a filed
 * application, but because this renders DRAFTS too, where any of them may
 * legitimately be null. Absent parts are dropped rather than shown as gaps.
 */
function propertyLabel(
  property: {
    plotNo?: string | null;
    surveyNumbers?: string | null;
    localityName?: string | null;
    district?: string | null;
  } | null
): string {
  if (!property) return '';
  const parts = [
    property.plotNo ? `Plot ${property.plotNo}` : '',
    property.surveyNumbers ? `Sy. ${property.surveyNumbers}` : '',
    property.localityName,
    property.district,
  ].filter((p): p is string => Boolean(p && p.trim()));

  return parts.join(', ');
}

function daysUntil(due: Date | null): number | null {
  if (!due) return null;
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
}

// ── Small helpers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];
