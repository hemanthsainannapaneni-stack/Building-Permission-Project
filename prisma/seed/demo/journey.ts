import type { PrismaClient } from '@prisma/client';
import type { Rng } from './rng';
import type { Stop } from './plan';
import {
  ACCEPT_REMARKS,
  APPROVAL_REMARKS,
  DISTRICTS,
  FIRST_NAMES,
  FORWARD_REMARKS,
  ITEM_RESPONSE_TEXT,
  LAYOUTS,
  LOCALITIES,
  REJECTION_REMARKS,
  REJECT_REMARKS,
  RESOLUTION_TEXT,
  SECOND_CYCLE_TEXT,
  SHORTFALL_TEXT,
  STREETS,
  SURNAMES,
  type BuildingProfile,
} from './dataset';

import { createApplication, saveStep, submitApplication } from '../../../src/server/services/applications';
import { uploadDrawing } from '../../../src/server/services/drawings';
import { updateBim, uploadBimFile } from '../../../src/server/services/bim';
import { demoBimFor } from '../../../src/server/bim/demo-bim';
import { loadBimSource } from './bim';
import { requestScrutiny } from '../../../src/server/services/scrutiny';
import { getDocuments, uploadDocument } from '../../../src/server/services/documents';
import { generateFee } from '../../../src/server/services/fees';
import { handleWebhook, initiatePayment } from '../../../src/server/services/payments';
import { buildMockGatewayRequest } from '../../../src/server/payments/mock';
import { performAction } from '../../../src/server/workflow/engine';
import { claimTask } from '../../../src/server/workflow/tasks';
import { ACTIONS } from '../../../src/lib/workflow';
import type { AuthUser } from '../../../src/server/auth/context';

/**
 * ONE APPLICATION, WALKED THE WHOLE WAY.
 *
 * Nothing here writes a status, a task, a history row, a demand or a receipt.
 * Every one of those is produced by the same service the product calls, in the
 * same order a real user would call it, and the file stops where the plan says
 * it stops.
 *
 * That is a deliberate and expensive choice. Inserting seventy rows with
 * `status: 'PENDING_ZJD'` would take a second and would be a lie: the guards
 * would never have run, the shortfall counter would be whatever the seed
 * happened to write, and an "approved" application could sit there with three
 * open shortfalls — the exact combination the approval guard exists to make
 * impossible. Driving the real path means a demo file and a production file
 * are the same kind of object, and the reconciliation script can therefore
 * check the demo the same way it would check live data.
 */

export const META = {
  ip: '127.0.0.1',
  userAgent: 'lams-demo-seed',
  correlationId: 'demo-seed',
};

/** A minimal, genuinely well-formed PDF. The upload pipeline sniffs the bytes. */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.7\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1'
);

/**
 * The identity a seeded action is performed as.
 *
 * Deliberately the SERVICES' OWN `AuthUser` rather than a look-alike. A
 * structurally similar type would compile and would let the seed drift away
 * from what the product actually requires of a caller — and the whole point of
 * this seed is that it goes through the same front door a user does. The
 * import is type-only, so the `server-only` module it comes from is erased and
 * never loaded by this CLI process.
 */
export type Actor = AuthUser;

export type JourneyContext = {
  prisma: PrismaClient;
  rng: Rng;
  /** Demo LTP accounts, round-robined across the seventy files. */
  ltps: Actor[];
  /** Officers who can actually see a given zone, per role. */
  officerFor: (roleKeys: string[], zoneId: string) => Actor;
  finance: Actor;
  admin: Actor;
  applicationTypes: Array<{ id: string; code: string; numberPrefix: string; name: string }>;
  zones: Array<{ id: string; code: string; name: string }>;
  /** Runs the job queue to completion — scans, scrutiny, notifications. */
  drainJobs: () => Promise<number>;
  /** Points the mock scrutiny engine at a version ladder. */
  setScrutinyPassFrom: (version: number) => Promise<void>;
};

export type JourneySpec = {
  stop: Stop;
  /** Days before "now" that this file was created. */
  ageDays: number;
  ltp: Actor;
  applicationType: { id: string; code: string; numberPrefix: string; name: string };
  zone: { id: string; code: string; name: string };
  profile: BuildingProfile;
};

export type JourneyResult = {
  applicationId: string;
  applicationNumber: string;
  stop: Stop;
  status: string;
  ageDays: number;
  /**
   * True for a file whose scrutiny run must be requested AFTER every other
   * application has been built.
   *
   * A file resting at SCRUTINY_IN_PROGRESS is one whose run is genuinely still
   * queued — and any later application's `drainJobs()` would execute that
   * queued job and move the file on. So the request is deferred to the very
   * end of the seed, where nothing drains after it.
   */
  deferScrutiny?: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════
// Building the particulars
// ═══════════════════════════════════════════════════════════════════════════

const personName = (rng: Rng) => `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;

/**
 * A coherent set of building numbers.
 *
 * Derived from the profile rather than drawn independently, because the fee
 * engine multiplies by built-up area and the document rules branch on floor
 * count: a 90 m² plot carrying a 4 000 m² built-up area would produce a demand
 * and a checklist that contradict each other on the same screen.
 */
function particulars(rng: Rng, profile: BuildingProfile) {
  const district = rng.pick(DISTRICTS);
  const plotAreaSqm = rng.float(profile.plotArea[0], profile.plotArea[1], 2);
  const numFloors = rng.int(profile.floors[0], profile.floors[1]);
  const numBasements = rng.int(profile.basements[0], profile.basements[1]);
  const numDwellingUnits = profile.units[1] ? rng.int(profile.units[0], profile.units[1]) : 0;

  const far = rng.float(profile.farTarget[0], profile.farTarget[1], 2);
  const builtUpAreaSqm = Math.round(plotAreaSqm * far * 100) / 100;
  const coverageAreaSqm = Math.round(plotAreaSqm * rng.float(0.4, 0.6, 2) * 100) / 100;
  const floorAreaSqm = Math.round((builtUpAreaSqm / Math.max(1, numFloors)) * 100) / 100;
  const parkingAreaSqm = Math.round(builtUpAreaSqm * rng.float(0.08, 0.2, 2) * 100) / 100;

  const applicantName = personName(rng);
  const ownerSame = rng.chance(0.75);

  return {
    applicantName,
    fatherName: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`,
    phone: `9${rng.int(100000000, 999999999)}`,
    email: `${applicantName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    address: `${rng.int(1, 120)}-${rng.int(1, 40)}, ${rng.pick(STREETS)}, ${rng.pick(LOCALITIES)}`,
    ownerSame,
    ownerName: ownerSame ? '' : personName(rng),
    ownerPhone: ownerSame ? '' : `9${rng.int(100000000, 999999999)}`,

    district: district.name,
    mandal: rng.pick(district.mandals),
    village: rng.pick(LOCALITIES),
    localityName: rng.pick(LOCALITIES),
    wardNo: String(rng.int(1, 60)),
    streetName: rng.pick(STREETS),
    doorNo: `${rng.int(1, 120)}-${rng.int(1, 40)}-${rng.int(1, 99)}`,
    pincode: String(rng.int(500001, 535999)),

    surveyNumbers: `${rng.int(10, 480)}/${rng.pick(['A', 'B', 'C', 'A1', 'B2', 'P'])}`,
    plotNo: String(rng.int(1, 220)),
    layoutName: rng.chance(0.6) ? rng.pick(LAYOUTS) : '',
    lpNumber: rng.chance(0.35) ? `LP/${rng.int(2018, 2025)}/${rng.int(100, 999)}` : '',
    plotAreaSqm,
    roadWidthM: rng.pick([9, 12, 15, 18, 24, 30]),
    landUseZone: profile.landUseZone,
    tenureType: rng.pick(['FREEHOLD', 'LEASEHOLD']),

    numFloors,
    numBasements,
    numDwellingUnits,
    buildingHeightM: Math.round((numFloors * 3.2 + 1.2) * 100) / 100,
    builtUpAreaSqm,
    floorAreaSqm,
    coverageAreaSqm,
    parkingAreaSqm,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The walk
// ═══════════════════════════════════════════════════════════════════════════

/** Where each stop sits on the applicant-side ladder, for early returns. */
const LTP_STOPS = new Set<Stop>([
  'DRAFT_EARLY',
  'DRAFT_LATE',
  'SUBMITTED',
  'DRAWING_UPLOADED',
  'SCRUTINY_QUEUED',
  'SCRUTINY_FAILED',
  'SCRUTINY_REUPLOADED',
  'SCRUTINY_PASSED',
  'DOCUMENTS_PARTIAL',
  'DOCUMENTS_COMPLETE',
  'FEE_GENERATED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
]);

export async function buildApplication(
  ctx: JourneyContext,
  spec: JourneySpec
): Promise<JourneyResult> {
  const { rng } = ctx;
  const p = particulars(rng, spec.profile);
  const ltp = spec.ltp;

  const created = await createApplication(ltp, { applicationTypeId: spec.applicationType.id }, META);
  const id = created.id;

  const done = async (): Promise<JourneyResult> => {
    const row = await ctx.prisma.application.findUniqueOrThrow({
      where: { id },
      select: { applicationNumber: true, status: true },
    });
    return {
      applicationId: id,
      applicationNumber: row.applicationNumber,
      stop: spec.stop,
      status: row.status,
      ageDays: spec.ageDays,
      deferScrutiny: spec.stop === 'SCRUTINY_QUEUED',
    };
  };

  // ── The filing wizard ──────────────────────────────────────────────────
  const steps: Array<[string, Record<string, unknown>]> = [
    [
      'applicant',
      {
        name: p.applicantName,
        phone: p.phone,
        address: p.address,
        fatherName: p.fatherName,
        email: p.email,
        aadhaarLast4: String(rng.int(1000, 9999)),
        panMasked: '',
      },
    ],
    [
      'owner',
      {
        ownerSameAsApplicant: p.ownerSame,
        ownerName: p.ownerName,
        ownerPhone: p.ownerPhone,
        ownerAddress: p.ownerSame ? '' : p.address,
      },
    ],
    [
      'property',
      {
        district: p.district,
        mandal: p.mandal,
        village: p.village,
        localityName: p.localityName,
        wardNo: p.wardNo,
      },
    ],
    [
      'location',
      {
        zoneId: spec.zone.id,
        streetName: p.streetName,
        doorNo: p.doorNo,
        pincode: p.pincode,
        boundaryNorth: 'Plot of ' + personName(rng),
        boundarySouth: `${p.streetName} (${p.roadWidthM} m)`,
        boundaryEast: 'Plot of ' + personName(rng),
        boundaryWest: 'Open land',
      },
    ],
    [
      'survey',
      {
        surveyNumbers: p.surveyNumbers,
        plotNo: p.plotNo,
        plotAreaSqm: p.plotAreaSqm,
        roadWidthM: p.roadWidthM,
        layoutName: p.layoutName,
        lpNumber: p.lpNumber,
        landUseZone: p.landUseZone,
        tenureType: p.tenureType,
      },
    ],
    [
      'development',
      {
        buildingUse: spec.profile.buildingUse,
        occupancyType: spec.profile.occupancyType,
        buildingSubUse: spec.profile.buildingSubUse,
        structureType: spec.profile.structureType,
        numFloors: p.numFloors,
        numBasements: p.numBasements,
        numDwellingUnits: p.numDwellingUnits,
        buildingHeightM: p.buildingHeightM,
      },
    ],
    [
      'building',
      {
        plotAreaSqm: p.plotAreaSqm,
        builtUpAreaSqm: p.builtUpAreaSqm,
        floorAreaSqm: p.floorAreaSqm,
        coverageAreaSqm: p.coverageAreaSqm,
        parkingAreaSqm: p.parkingAreaSqm,
        setbackFrontM: rng.float(1.5, 6, 1),
        setbackRearM: rng.float(1, 4, 1),
        setbackLeftM: rng.float(1, 3, 1),
        setbackRightM: rng.float(1, 3, 1),
      },
    ],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  // An early draft has answered the first three steps and no more — which is
  // what a half-filled wizard genuinely looks like.
  const upto = spec.stop === 'DRAFT_EARLY' ? 3 : steps.length;

  for (const [step, data] of steps.slice(0, upto)) {
    await saveStep(ltp, id, { step: step as never, data, partial: false }, META);
  }

  if (spec.stop === 'DRAFT_EARLY' || spec.stop === 'DRAFT_LATE') return done();

  await submitApplication(ltp, id, META);
  if (spec.stop === 'SUBMITTED') return done();

  // ── Drawings ───────────────────────────────────────────────────────────
  //
  // Whether this file failed scrutiny the first time is decided HERE, before
  // anything is uploaded, because the mock engine's verdict is a function of
  // the version number. A file that must end up failed uploads one version
  // against a ladder that passes from version 2.
  const failsFirst =
    spec.stop === 'SCRUTINY_FAILED' ||
    spec.stop === 'SCRUTINY_REUPLOADED' ||
    (!LTP_STOPS.has(spec.stop) && rng.chance(0.3));

  await ctx.setScrutinyPassFrom(failsFirst ? 2 : 1);

  const sheets = rng.sample(
    ['SITE_PLAN', 'FLOOR_PLAN', 'ELEVATION', 'SECTION'],
    spec.stop === 'DRAWING_UPLOADED' ? rng.int(1, 2) : rng.int(2, 3)
  );

  const drawingIds: string[] = [];
  for (const category of sheets) {
    const result = await uploadDrawing(
      ltp,
      {
        applicationId: id,
        category,
        title: `${category.replace(/_/g, ' ').toLowerCase()} — ${p.plotNo}`,
        remarks: 'Uploaded with the application.',
        file: {
          name: `${category.toLowerCase()}-${p.plotNo}.pdf`,
          type: 'application/pdf',
          bytes: PDF_BYTES,
        },
      },
      META
    );
    drawingIds.push(result.drawingId);
  }

  // ── BIM ────────────────────────────────────────────────────────────────
  //
  // The federated IFC model goes up with the drawings, through the real BIM
  // service, and the LTP states the particulars and declares it. A file that
  // will fail scrutiny carries a model whose built-up area runs over — the
  // disagreement the BIM tab's reconciliation exists to show.
  const bimSource = await loadBimSource(ctx.prisma, id);
  if (bimSource) {
    const demo = demoBimFor({ ...bimSource, status: spec.stop === 'SCRUTINY_FAILED' ? 'SCRUTINY_FAILED' : bimSource.status });
    await uploadBimFile(
      ltp,
      {
        applicationId: id,
        kind: 'IFC_MODEL',
        discipline: 'FEDERATED',
        title: `${bimSource.applicationNumber} — federated model`,
        remarks: 'Federated model, exported with the drawings.',
        file: { name: demo.fileName, type: 'application/octet-stream', bytes: Buffer.from(demo.ifcText, 'utf8') },
      },
      META
    );
    await updateBim(ltp, id, { ...demo.particulars, declare: true }, META);
  }
  await ctx.drainJobs();

  if (spec.stop === 'DRAWING_UPLOADED') return done();

  // The drawings are on file and virus-checked. The scrutiny REQUEST is made
  // by the orchestrator once every other application is finished — see
  // `deferScrutiny` above.
  if (spec.stop === 'SCRUTINY_QUEUED') return done();

  // ── Scrutiny ───────────────────────────────────────────────────────────
  await requestScrutiny(ltp, id, META);
  await ctx.drainJobs();

  if (spec.stop === 'SCRUTINY_FAILED') return done();

  if (failsFirst) {
    // The correction: a NEW version of every sheet, against a ladder that now
    // passes. Uploading into the existing drawing id is what makes it V2 of
    // the same sheet rather than a second sheet.
    await ctx.setScrutinyPassFrom(1);
    for (let i = 0; i < drawingIds.length; i += 1) {
      await uploadDrawing(
        ltp,
        {
          applicationId: id,
          drawingId: drawingIds[i],
          category: sheets[i]!,
          remarks: 'Corrected as per the scrutiny findings.',
          file: {
            name: `${sheets[i]!.toLowerCase()}-${p.plotNo}-rev1.pdf`,
            type: 'application/pdf',
            bytes: PDF_BYTES,
          },
        },
        META
      );
    }
    await ctx.drainJobs();

    if (spec.stop === 'SCRUTINY_REUPLOADED') return done();

    await requestScrutiny(ltp, id, META);
    await ctx.drainJobs();
  }

  if (spec.stop === 'SCRUTINY_PASSED') return done();

  // ── Documents ──────────────────────────────────────────────────────────
  const checklist = await getDocuments(ltp, id);
  const mandatory = checklist.entries.filter((e) => e.isRequired && e.isMandatory);
  const optional = checklist.entries.filter((e) => e.isRequired && !e.isMandatory);

  // A partial upload leaves at least one mandatory document genuinely
  // outstanding, so `documents_complete` fails for the real reason.
  const uploadCount =
    spec.stop === 'DOCUMENTS_PARTIAL'
      ? Math.max(1, mandatory.length - rng.int(1, Math.max(1, Math.min(3, mandatory.length - 1))))
      : mandatory.length;

  const expiry = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

  for (const entry of mandatory.slice(0, uploadCount)) {
    await uploadDocument(
      ltp,
      {
        applicationId: id,
        documentTypeId: entry.documentTypeId,
        expiresOn: entry.requiresExpiry ? expiry : null,
        file: {
          name: `${entry.code.toLowerCase()}.pdf`,
          type: 'application/pdf',
          bytes: PDF_BYTES,
        },
      },
      META
    );
  }

  // A few files also carry an optional document, so the checklist is not a
  // wall of identical rows.
  if (spec.stop !== 'DOCUMENTS_PARTIAL' && optional.length && rng.chance(0.4)) {
    const extra = optional[0]!;
    await uploadDocument(
      ltp,
      {
        applicationId: id,
        documentTypeId: extra.documentTypeId,
        expiresOn: extra.requiresExpiry ? expiry : null,
        file: { name: `${extra.code.toLowerCase()}.pdf`, type: 'application/pdf', bytes: PDF_BYTES },
      },
      META
    );
  }
  await ctx.drainJobs();

  if (spec.stop === 'DOCUMENTS_PARTIAL' || spec.stop === 'DOCUMENTS_COMPLETE') return done();

  // ── Fee ────────────────────────────────────────────────────────────────
  const demand = await generateFee(ctx.finance, id, META);
  if (spec.stop === 'FEE_GENERATED') return done();

  // ── Payment ────────────────────────────────────────────────────────────
  const attempt = await initiatePayment(ltp, demand.id, META);
  if (spec.stop === 'PAYMENT_PENDING') return done();

  if (spec.stop === 'PAYMENT_FAILED') {
    await settleMock(attempt.payment.paymentRef, 'FAILED', demand.totalAmount);
    await ctx.drainJobs();
    return done();
  }

  // Some files record a declined attempt before the one that succeeds. That is
  // what a real payments register looks like, and it is the only way the
  // "payment success rate" tile has anything but 100% to report.
  if (rng.chance(0.25)) {
    await settleMock(attempt.payment.paymentRef, 'FAILED', demand.totalAmount);
    await ctx.drainJobs();
    const retry = await initiatePayment(ltp, demand.id, META);
    await settleMock(retry.payment.paymentRef, 'SUCCESS', demand.totalAmount);
  } else {
    await settleMock(attempt.payment.paymentRef, 'SUCCESS', demand.totalAmount);
  }

  // Settlement starts the departmental run — that is the gate, and it is the
  // engine's own doing, not the seed's.
  await ctx.drainJobs();

  return departmental(ctx, spec, id, done);
}

/** Fires a signed mock-gateway callback, exactly as the provider would. */
async function settleMock(
  paymentRef: string,
  state: 'SUCCESS' | 'FAILED',
  amount: { toFixed: (dp: number) => string }
) {
  const value = amount.toFixed(2);

  await handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef,
      state,
      amount: value,
      eventId: `demo_${state}_${paymentRef}`,
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The departmental desks
// ═══════════════════════════════════════════════════════════════════════════

async function departmental(
  ctx: JourneyContext,
  spec: JourneySpec,
  id: string,
  done: () => Promise<JourneyResult>
): Promise<JourneyResult> {
  const { rng } = ctx;
  const zoneId = spec.zone.id;

  // BBAS_STANDARD: TPA → Planning Officer → ZDD → ZJD, and the ZJD decides.
  const tpa = ctx.officerFor(['TPA'], zoneId);
  const po = ctx.officerFor(['PLANNING_OFFICER'], zoneId);
  const zdd = ctx.officerFor(['ZDD'], zoneId);
  const zjd = ctx.officerFor(['ZJD'], zoneId);

  const act = (actor: Actor, action: string, input: Record<string, unknown> = {}) =>
    performAction(actor, id, action, { remarks: rng.pick(FORWARD_REMARKS), ...input }, META);

  /** Puts the open task in an officer's hands, so the queue shows a holder. */
  const claim = async (actor: Actor) => {
    const task = await ctx.prisma.workflowTask.findFirst({
      where: { instance: { applicationId: id }, status: 'PENDING', assignedUserId: null },
      select: { id: true },
    });
    if (task) await claimTask(actor, task.id, META);
  };

  /**
   * A shortfall the engine will accept.
   *
   * `items` is not optional decoration: `raiseShortfall` refuses a document
   * shortfall with no itemised list and a fee shortfall with no amount, on the
   * grounds that an applicant cannot answer "documents are missing". The seed
   * therefore has to say what is actually wanted, which is the point.
   */
  const shortfallInput = (kind: keyof typeof SHORTFALL_TEXT) => {
    const text = rng.pick(SHORTFALL_TEXT[kind]);

    // Every item carries its category, its own required action and the
    // document it asks for — the columns the register and the letter print.
    // A FEE item also carries the amount, without which `raiseShortfall`
    // refuses the shortfall outright.
    const items =
      kind === 'CLARIFICATION'
        ? []
        : text.items.map((item) => ({
            description: item.description,
            category: item.category,
            requiredAction: item.action,
            requiredDocument: item.document,
            remarks: item.remarks ?? '',
            isMandatory: !item.optional,
            ...(kind === 'FEE' ? { amount: rng.int(4, 60) * 500 } : {}),
          }));

    return {
      remarks: text.description,
      shortfall: {
        title: text.title,
        description: text.description,
        requiredAction: text.action,
        dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        items,
      },
    };
  };

  /**
   * The open shortfall on this file, with its item ids — so a seeded response
   * can answer it line by line the way the screen does.
   */
  const openShortfall = async () =>
    ctx.prisma.shortfall.findFirst({
      where: { applicationId: id, status: { notIn: ['RESOLVED', 'CANCELLED'] } },
      orderBy: { raisedAt: 'desc' },
      select: { id: true, items: { orderBy: { displayOrder: 'asc' }, select: { id: true } } },
    });

  /**
   * The applicant's answer, itemised.
   *
   * `skipLast` leaves the final item unanswered, which is what produces a
   * response an officer has a reason to send back — the case the second cycle
   * exists to show.
   */
  const respondItemised = async (remarks: string, options: { skipLast?: boolean } = {}) => {
    const shortfall = await openShortfall();
    const itemIds = (shortfall?.items ?? []).map((item) => item.id);
    const answered = options.skipLast ? itemIds.slice(0, Math.max(1, itemIds.length - 1)) : itemIds;

    await act(spec.ltp, ACTIONS.RESUBMIT, {
      remarks,
      shortfallItems: answered.map((itemId) => ({
        itemId,
        response: rng.pick(ITEM_RESPONSE_TEXT),
        applicantRemarks: '',
        attachments: [],
      })),
    });
  };

  /**
   * The officer sends it back, naming the item that is still wrong.
   *
   * This is what opens cycle 2: the shortfall stays open, the file returns to
   * the applicant, and both attempts remain on the record.
   */
  const rejectItemised = async (actor: Actor) => {
    const shortfall = await openShortfall();
    const itemIds = (shortfall?.items ?? []).map((item) => item.id);

    await act(actor, ACTIONS.REJECT_RESOLUTION, {
      remarks: rng.pick(REJECT_REMARKS),
      shortfallDecisions: itemIds.map((itemId, index) => ({
        itemId,
        // The last item is the one that fails. Every other line is accepted,
        // so the applicant is sent back over ONE item and not over all of them.
        decision: index === itemIds.length - 1 ? ('REJECTED' as const) : ('ACCEPTED' as const),
        remarks: index === itemIds.length - 1 ? 'Still not answered on this item.' : '',
      })),
    });
  };

  /** Accepts whatever is open, itemised, and settles the shortfall. */
  const acceptItemised = async (actor: Actor) => {
    const shortfall = await openShortfall();
    const itemIds = (shortfall?.items ?? []).map((item) => item.id);

    await act(actor, ACTIONS.ACCEPT_RESOLUTION, {
      remarks: rng.pick(ACCEPT_REMARKS),
      shortfallDecisions: itemIds.map((itemId) => ({
        itemId,
        decision: 'ACCEPTED' as const,
        remarks: '',
      })),
    });
  };

  switch (spec.stop) {
    case 'TPA_UNCLAIMED':
      return done();

    case 'TPA_CLAIMED':
      await claim(tpa);
      return done();

    case 'TPA_DOCUMENT_SHORTFALL':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      return done();

    case 'TPA_FEE_SHORTFALL':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_FEE_SHORTFALL, shortfallInput('FEE'));
      await ctx.drainJobs();
      return done();

    case 'TPA_REVIEWING':
      // Raise, answer, accept — and the officer keeps the file. This is the
      // only path to a stage's `workingStatus`, because claiming a task does
      // not change the application's status.
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT));
      await ctx.drainJobs();
      await acceptItemised(tpa);
      await ctx.drainJobs();
      return done();

    case 'TPA_SHORTFALL_RESPONDED':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT));
      await ctx.drainJobs();
      return done();

    // ── The second cycle ──────────────────────────────────────────────────
    //
    // Raise, answer all but one item, send it back naming that item, and the
    // file is with the applicant AGAIN on the same shortfall. `attemptNo` 2 is
    // appended; attempt 1 is untouched.

    case 'TPA_SHORTFALL_CYCLE_2':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT), { skipLast: true });
      await ctx.drainJobs();
      await rejectItemised(tpa);
      await ctx.drainJobs();
      return done();

    case 'TPA_SHORTFALL_CYCLE_2_RESPONDED':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT), { skipLast: true });
      await ctx.drainJobs();
      await rejectItemised(tpa);
      await ctx.drainJobs();
      await respondItemised(rng.pick(SECOND_CYCLE_TEXT));
      await ctx.drainJobs();
      return done();

    case 'TPA_SHORTFALL_CYCLE_2_RESOLVED':
      await claim(tpa);
      await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT), { skipLast: true });
      await ctx.drainJobs();
      await rejectItemised(tpa);
      await ctx.drainJobs();
      await respondItemised(rng.pick(SECOND_CYCLE_TEXT));
      await ctx.drainJobs();
      await acceptItemised(tpa);
      await ctx.drainJobs();
      return done();

    default:
      break;
  }

  // Every remaining stop is past the TPA desk. A third of them went through a
  // shortfall cycle on the way, so the history of a file sitting at ZJD is not
  // uniformly six identical "Forwarded" rows.
  if (rng.chance(0.3)) {
    await claim(tpa);
    await act(tpa, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
    await ctx.drainJobs();

    // A third of those go round twice before they are accepted, so files that
    // have moved PAST the TPA still carry a two-cycle history behind them —
    // the register's Cycle column is not a column that only ever reads 1.
    if (rng.chance(0.33)) {
      await respondItemised(rng.pick(RESOLUTION_TEXT), { skipLast: true });
      await ctx.drainJobs();
      await rejectItemised(tpa);
      await ctx.drainJobs();
      await respondItemised(rng.pick(SECOND_CYCLE_TEXT));
    } else {
      await respondItemised(rng.pick(RESOLUTION_TEXT));
    }

    await ctx.drainJobs();
    await acceptItemised(tpa);
  } else {
    await claim(tpa);
  }

  await act(tpa, ACTIONS.FORWARD);
  await ctx.drainJobs();

  // ── Planning Officer ──────────────────────────────────────────────────
  switch (spec.stop) {
    case 'PO_UNCLAIMED':
      return done();
    case 'PO_CLAIMED':
      await claim(po);
      return done();
    case 'PO_SHORTFALL':
      await claim(po);
      await act(po, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      return done();
    case 'PO_REVIEWING':
      await claim(po);
      await act(po, ACTIONS.RAISE_DOCUMENT_SHORTFALL, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      await respondItemised(rng.pick(RESOLUTION_TEXT));
      await ctx.drainJobs();
      await acceptItemised(po);
      await ctx.drainJobs();
      return done();
    default:
      break;
  }

  await claim(po);
  await act(po, ACTIONS.FORWARD);
  await ctx.drainJobs();

  // ── ZDD ───────────────────────────────────────────────────────────────
  switch (spec.stop) {
    case 'ZDD_UNCLAIMED':
      if (rng.chance(0.5)) await claim(zdd);
      return done();
    case 'ZDD_FEE_SHORTFALL':
      await claim(zdd);
      await act(zdd, ACTIONS.RAISE_FEE_SHORTFALL, shortfallInput('FEE'));
      await ctx.drainJobs();
      return done();
    case 'ZJD_WITH_REPORTED_DOC':
      // Reported, not blocking: the ZDD records the gap and sends the file on.
      // It reaches the ZJD still open and blocks approval there until closed.
      await claim(zdd);
      await act(zdd, ACTIONS.REPORT_SHORTFALL_AND_FORWARD, shortfallInput('DOCUMENT'));
      await ctx.drainJobs();
      return done();
    default:
      break;
  }

  await claim(zdd);
  await act(zdd, ACTIONS.FORWARD);
  await ctx.drainJobs();

  // ── ZJD: the apex desk ────────────────────────────────────────────────
  switch (spec.stop) {
    case 'ZJD_UNCLAIMED':
      if (rng.chance(0.4)) await claim(zjd);
      return done();
    case 'ZJD_FEE_SHORTFALL':
      await claim(zjd);
      await act(zjd, ACTIONS.RAISE_FEE_SHORTFALL, shortfallInput('FEE'));
      await ctx.drainJobs();
      return done();
    default:
      break;
  }

  await claim(zjd);

  if (spec.stop === 'REJECTED') {
    await act(zjd, ACTIONS.REJECT, { remarks: rng.pick(REJECTION_REMARKS) });
    await ctx.drainJobs();
    return done();
  }

  // APPROVE runs the `no_open_shortfalls` guard with no override. If any of
  // the cycles above left one open, this throws — which is the seed telling
  // the truth rather than papering over it.
  await act(zjd, ACTIONS.APPROVE, { remarks: rng.pick(APPROVAL_REMARKS) });
  await ctx.drainJobs();
  return done();
}
