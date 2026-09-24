import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import {
  prisma,
  databaseAvailable,
  cleanupTestUsers,
  cleanupTestApplications,
  clearJobs,
  clearStorage,
  clearOrphanFiles,
  drainJobs,
  configureMockScrutiny,
  configureMockGateway,
  actorFor,
  META,
} from './setup';
import { createApplication, saveStep, submitApplication } from '@/server/services/applications';
import { uploadDrawing } from '@/server/services/drawings';
import { requestScrutiny } from '@/server/services/scrutiny';
import { uploadDocument } from '@/server/services/documents';
import { generateFee } from '@/server/services/fees';
import { initiatePayment, handleWebhook } from '@/server/services/payments';
import { buildMockGatewayRequest } from '@/server/payments/mock';
import { createUser } from '@/server/services/users';
import { performAction, getWorkflowState } from '@/server/workflow/engine';
import {
  addInspectionPhoto,
  getApplicationInspections,
  getInspection,
  listInspections,
  inspectionSummary,
  readInspectionPhoto,
  saveInspectionDraft,
  scheduleInspection,
  submitInspection,
} from '@/server/services/site-inspections';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { DEMO_ESIGN_OTP, DEMO_TOKEN_PIN, PHOTO_BEARING, offsetCoordinates } from '@/lib/site-inspection';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 5 — the site inspection subsystem, end to end.
 *
 *   Schedule → Inspect → Questions → Photos → Recommendation → Sign → Submit → Workflow
 *
 * Driven through the real services from a PAID application at the TPA desk,
 * exactly as the workflow suite does — a fixture that inserted an inspection
 * row would test the screens against a state the system cannot produce.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
/** A 1×1 PNG — real magic bytes, so it passes the upload sniff. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const MANDATORY = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);
const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;
let ltp: Actor;
let tpa: Actor;
let tpa2: Actor;
let po: Actor;
let typeId: string;
let zoneId: string;

const actor = (id: string, name: string, role: RoleKey, zones: string[] = []) =>
  actorFor(id, name, [role], { capabilities: RBAC_MATRIX[role] as unknown as string[], zoneIds: zones });

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } });
  admin = actor(adminUser.id, adminUser.name, ROLES.SYSTEM_ADMIN);

  const tpaUser = await prisma.user.findUniqueOrThrow({ where: { email: 'tpa.demo@example.com' } });
  zoneId = tpaUser.primaryZoneId ?? (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;
  tpa = actor(tpaUser.id, tpaUser.name, ROLES.TPA, [zoneId]);

  const poUser = await prisma.user.findUniqueOrThrow({ where: { email: 'po.demo@example.com' } });
  po = actor(poUser.id, poUser.name, ROLES.PLANNING_OFFICER, [zoneId]);

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;

  const createdLtp = await createUser(
    {
      email: 'test-si-ltp@example.com',
      name: 'Test Inspection LTP',
      phone: '9876500071',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-SI-1',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Inspection Firm',
    },
    admin,
    META
  );
  ltp = actor(createdLtp.user.id, createdLtp.user.name, ROLES.LTP);

  const createdTpa2 = await createUser(
    {
      email: 'test-si-tpa2@example.com',
      name: 'Test Second TPA',
      phone: '9876500072',
      designation: 'Town Planning Assistant',
      employeeCode: 'TEST-SI-TPA2',
      roleKey: ROLES.TPA,
      zoneIds: [zoneId],
    } as never,
    admin,
    META
  );
  tpa2 = actor(createdTpa2.user.id, createdTpa2.user.name, ROLES.TPA, [zoneId]);
}, 120_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
  await configureMockGateway({ mode: 'MANUAL' });
});

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id].filter(Boolean) as string[]);
  await clearJobs();
});

afterAll(async () => {
  if (dbUp) {
    await cleanupTestUsers('test-si-');
    await clearOrphanFiles();
    await clearStorage();
  }
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

/** Filed, drawn, scrutinised, documented and PAID — sitting at the TPA desk. */
async function atTpa() {
  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Lakshmi Devi', phone: '9876543210', address: '4 Temple Street, Guntur', fatherName: '', email: 'lakshmi@example.com', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Guntur', mandal: 'Guntur', village: 'Nallapadu', localityName: 'Brodipet', wardNo: '' }],
    ['location', { zoneId, streetName: '4th Lane', doorNo: '12-3', pincode: '522002', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '212/3', plotNo: '14', plotAreaSqm: 300, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    ['development', { buildingUse: 'DWELLING', occupancyType: 'A_RESIDENTIAL', buildingSubUse: '', structureType: 'RCC', numFloors: 2, numBasements: 0, numDwellingUnits: 1, buildingHeightM: 7.5 }],
    ['building', { plotAreaSqm: 300, builtUpAreaSqm: 620, floorAreaSqm: 380, coverageAreaSqm: 180, parkingAreaSqm: 40, setbackFrontM: 3, setbackRearM: 2, setbackLeftM: 1.5, setbackRightM: 1.5 }],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];
  for (const [step, data] of steps) await saveStep(ltp, app.id, { step: step as never, data, partial: false }, META);

  const submitted = await submitApplication(ltp, app.id, META);
  await uploadDrawing(ltp, { applicationId: submitted.id, category: 'SITE_PLAN', file: { name: 'site.pdf', type: 'application/pdf', bytes: PDF } }, META);
  await drainJobs();
  await requestScrutiny(ltp, submitted.id, META);
  await drainJobs();
  for (const code of MANDATORY) {
    await uploadDocument(
      ltp,
      {
        applicationId: submitted.id,
        documentTypeCode: code,
        expiresOn: NEEDS_EXPIRY.has(code) ? FUTURE : null,
        file: { name: `${code.toLowerCase()}.pdf`, type: 'application/pdf', bytes: PDF },
      },
      META
    );
  }
  await drainJobs();
  const demand = await generateFee(admin, submitted.id, META);
  const started = await initiatePayment(ltp, demand.id, META);
  await handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef: started.payment.paymentRef,
      state: 'SUCCESS',
      amount: demand.totalAmount.toFixed(2),
      eventId: `si_${started.payment.paymentRef}`,
    })
  );
  return submitted.id;
}

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
const appRow = (id: string) =>
  prisma.application.findUniqueOrThrow({ where: { id }, select: { status: true, currentStageCode: true, openShortfalls: true } });
const openTask = (id: string) =>
  prisma.workflowTask.findFirst({
    where: { instance: { applicationId: id }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    select: { id: true, assignedUserId: true, assignedRoleKey: true, stage: { select: { code: true } } },
  });
const errorOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return isApiError(err) ? { status: err.status, message: err.message, details: err.details } : { status: 0, message: String(err), details: [] };
  }
};

/** Answers every question SATISFACTORY except the numbers given. */
async function answerAll(
  inspectionId: string,
  marks: Record<number, { status: string; observation?: string }> = {}
) {
  const detail = await getInspection(tpa, inspectionId);
  const responses = detail.responses.map((r) => {
    const mark = marks[r.itemNumber];
    const response =
      r.responseType === 'YES_NO' || r.responseType === 'YES_NO_NA'
        ? 'YES'
        : r.responseType === 'NUMBER' || r.responseType === 'MEASUREMENT'
          ? '9'
          : 'As seen on site';
    return {
      itemId: r.itemId,
      response,
      observation: mark?.observation ?? '',
      remarks: '',
      status: (mark?.status ?? 'SATISFACTORY') as never,
    };
  });
  return saveInspectionDraft(
    tpa,
    inspectionId,
    { inspectedAt: new Date().toISOString(), generalObservation: 'Vacant plot, level ground.', responses },
    META
  );
}

async function photographAllSides(inspectionId: string, withFile = false) {
  const detail = await getInspection(tpa, inspectionId);
  for (const category of ['NORTH', 'SOUTH', 'EAST', 'WEST'] as const) {
    const p = offsetCoordinates(detail.latitude!, detail.longitude!, PHOTO_BEARING[category]!, 12);
    await addInspectionPhoto(
      tpa,
      inspectionId,
      {
        category,
        latitude: p.latitude,
        longitude: p.longitude,
        capturedAt: new Date().toISOString(),
        description: `${category} boundary`,
        file: withFile && category === 'NORTH' ? { name: 'north.png', type: 'image/png', bytes: PNG } : null,
      },
      META
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('site inspection — the whole journey', () => {
  it('schedule → inspect → questions → photos → recommend → sign → submit → workflow', async () => {
    const appId = await atTpa();
    expect((await appRow(appId)).currentStageCode).toBe('TPA_REVIEW');

    // The TPA holds the file.
    const task0 = await openTask(appId);
    await prisma.workflowTask.update({ where: { id: task0!.id }, data: { assignedUserId: tpa.id, status: 'IN_PROGRESS' } });

    // ── Schedule ─────────────────────────────────────────────────────────
    const tab0 = await getApplicationInspections(tpa, appId);
    expect(tab0.canSchedule).toBe(true);
    expect(tab0.candidates.map((c) => c.id)).toEqual(expect.arrayContaining([tpa.id, tpa2.id]));

    const booked = await scheduleInspection(tpa, appId, { inspectorId: tpa.id, scheduledFor: tomorrow(), remarks: 'Owner will be on site.' }, META);
    expect(booked.inspectionNumber).toMatch(/^SI\/\d{4}\/\d{6}$/);
    expect(booked.workflow.toStageCode).toBe('TPA_SITE_INSPECTION');

    const afterBooking = await appRow(appId);
    expect(afterBooking).toMatchObject({ currentStageCode: 'TPA_SITE_INSPECTION', status: 'SITE_INSPECTION_SCHEDULED' });
    expect((await openTask(appId))?.assignedUserId).toBe(tpa.id);
    expect(await prisma.outboxEvent.count({ where: { applicationId: appId, eventCode: 'INSPECTION_DUE' } })).toBe(1);

    // A second booking while one is open is refused.
    expect((await errorOf(() => scheduleInspection(tpa, appId, { inspectorId: tpa.id, scheduledFor: tomorrow(), remarks: '' }, META)))?.status).toBe(409);

    // The action bar knows these belong to the Site Inspection tab.
    const state = await getWorkflowState(tpa, appId);
    expect(state.actions.find((a) => a.code === ACTIONS.SUBMIT_SITE_INSPECTION)?.inspection).toEqual({ step: 'SUBMIT' });

    // ── The 27 questions were snapshotted ────────────────────────────────
    let detail = await getInspection(tpa, booked.id);
    expect(detail.responses).toHaveLength(27);
    expect(detail.responses.every((r) => r.isProvisional)).toBe(true);
    expect(detail.provisional.label).toBe('PROVISIONAL DEMO SITE INSPECTION QUESTIONS');
    expect(detail.locationSource).toBe('DEMO');
    expect(detail.permissions.canEdit).toBe(true);

    // ── Only the named inspector writes ──────────────────────────────────
    expect((await errorOf(() => saveInspectionDraft(tpa2, booked.id, { generalObservation: 'x' }, META)))?.status).toBe(403);
    expect((await errorOf(() => saveInspectionDraft(po, booked.id, { generalObservation: 'x' }, META)))?.status).toBe(403);

    // ── Inspect + questions (Save Draft) ─────────────────────────────────
    await answerAll(booked.id);
    expect((await appRow(appId)).status).toBe('SITE_INSPECTION_IN_PROGRESS');
    detail = await getInspection(tpa, booked.id);
    expect(detail.status).toBe('IN_PROGRESS');
    expect(detail.tally.answered).toBe(27);

    // An answer that does not fit its question is refused.
    const yesNo = detail.responses.find((r) => r.responseType.startsWith('YES_NO'))!;
    expect(
      (await errorOf(() =>
        saveInspectionDraft(tpa, booked.id, { responses: [{ itemId: yesNo.itemId, response: 'MAYBE', observation: '', remarks: '', status: 'SATISFACTORY' }] }, META)
      ))?.status
    ).toBe(400);

    // ── Not ready yet: no photographs, no recommendation ─────────────────
    const early = await errorOf(() => submitInspection(tpa, booked.id, { method: 'AADHAAR_ESIGN_DEMO', aadhaarLast4: '1234', otp: DEMO_ESIGN_OTP, declaration: true }, META));
    expect(early?.status).toBe(409);
    const paths = (early?.details ?? []).map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['photos', 'recommendation', 'recommendationRemarks']));

    // ── Photos (one real PNG, three demo placeholders) ───────────────────
    await photographAllSides(booked.id, true);
    detail = await getInspection(tpa, booked.id);
    expect(detail.photos).toHaveLength(4);
    const real = detail.photos.find((p) => p.fileObjectId)!;
    expect(real.mimeType).toBe('image/png');
    const placeholder = detail.photos.find((p) => !p.fileObjectId)!;
    const svg = await readInspectionPhoto(po, placeholder.id);
    expect(svg.mimeType).toBe('image/svg+xml');
    expect(svg.bytes.toString('utf8')).toContain('DEMO PHOTOGRAPH');

    // ── Recommendation must agree with the findings ──────────────────────
    await saveInspectionDraft(tpa, booked.id, { recommendation: 'REJECT', recommendationRemarks: 'Nothing wrong but rejecting.' }, META);
    const disagree = await errorOf(() => submitInspection(tpa, booked.id, { method: 'USB_TOKEN_DEMO', pin: DEMO_TOKEN_PIN, declaration: true }, META));
    expect(disagree?.status).toBe(409);

    await saveInspectionDraft(
      tpa,
      booked.id,
      { recommendation: 'RECOMMENDED', recommendationRemarks: 'Site conforms to the approved layout; boundaries and road width verified.' },
      META
    );

    // ── Wrong demo credentials are refused before anything is written ────
    expect((await errorOf(() => submitInspection(tpa, booked.id, { method: 'USB_TOKEN_DEMO', pin: '9999', declaration: true }, META)))?.status).toBe(400);
    // Another TPA cannot sign it.
    expect((await errorOf(() => submitInspection(tpa2, booked.id, { method: 'USB_TOKEN_DEMO', pin: DEMO_TOKEN_PIN, declaration: true }, META)))?.status).toBe(403);

    // ── Sign & Submit ────────────────────────────────────────────────────
    const taskBefore = await openTask(appId);
    const signed = await submitInspection(tpa, booked.id, { method: 'AADHAAR_ESIGN_DEMO', aadhaarLast4: '4321', otp: DEMO_ESIGN_OTP, declaration: true }, META);
    expect(signed.recommendation).toBe('RECOMMENDED');
    expect(signed.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.workflow.actionCode).toBe(ACTIONS.SUBMIT_SITE_INSPECTION);
    expect(signed.workflow.toStageCode).toBe('PLANNING_OFFICER_REVIEW');

    // ── Workflow: moved, old task closed, next task opened ───────────────
    expect((await appRow(appId)).currentStageCode).toBe('PLANNING_OFFICER_REVIEW');
    const closed = await prisma.workflowTask.findUniqueOrThrow({ where: { id: taskBefore!.id }, select: { status: true, actionTaken: true } });
    expect(closed).toEqual({ status: 'COMPLETED', actionTaken: ACTIONS.SUBMIT_SITE_INSPECTION });
    const next = await openTask(appId);
    expect(next?.stage.code).toBe('PLANNING_OFFICER_REVIEW');
    expect(next?.id).not.toBe(taskBefore!.id);

    // ── Locked, signed, linked, audited ──────────────────────────────────
    const final = await getInspection(po, booked.id);
    expect(final.status).toBe('SUBMITTED');
    expect(final.lockedAt).not.toBeNull();
    expect(final.signatureMethod).toBe('AADHAAR_ESIGN_DEMO');
    expect(final.signatureMetadata).toMatchObject({ provider: 'DEMO', maskedAadhaar: 'XXXX-XXXX-4321' });
    expect(final.signatureValid).toBe(true);
    expect(final.scheduleSequence).not.toBeNull();
    expect(final.submitSequence).toBe(signed.workflow.sequence);
    expect(final.routedAt).not.toBeNull();
    expect(final.permissions.canEdit).toBe(false);

    const lockedWrite = await errorOf(() => saveInspectionDraft(tpa, booked.id, { generalObservation: 'edit after signing' }, META));
    expect(lockedWrite?.status).toBe(409);
    const lockedPhoto = await errorOf(() =>
      addInspectionPhoto(tpa, booked.id, { category: 'OTHER', latitude: 16.3, longitude: 80.4, capturedAt: new Date().toISOString(), description: '' }, META)
    );
    expect(lockedPhoto?.status).toBe(409);

    const actions = (
      await prisma.auditLog.findMany({ where: { applicationId: appId, action: { startsWith: 'SITE_INSPECTION' } }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'SITE_INSPECTION_SCHEDULED',
        'SITE_INSPECTION_STARTED',
        'SITE_INSPECTION_DRAFT_SAVED',
        'SITE_INSPECTION_PHOTO_ADDED',
        'SITE_INSPECTION_SIGNED_AND_SUBMITTED',
      ])
    );
    expect(await prisma.auditLog.count({ where: { applicationId: appId, action: 'WORKFLOW_SUBMIT_SITE_INSPECTION' } })).toBe(1);

    // The report is still what was signed when re-read.
    const tab = await getApplicationInspections(po, appId);
    expect(tab.rounds).toHaveLength(1);
    expect(tab.rounds[0]!.photoCount).toBe(4);
    expect(tab.canSchedule).toBe(false);

    // ── The register finds it ────────────────────────────────────────────
    const register = await listInspections(po, { q: booked.inspectionNumber });
    expect(register.rows.map((r) => r.id)).toContain(booked.id);
    expect(register.rows[0]!.application.currentStageCode).toBe('PLANNING_OFFICER_REVIEW');
    const byRec = await listInspections(po, { recommendation: 'RECOMMENDED', applicationId: appId });
    expect(byRec.total).toBe(1);
    expect((await inspectionSummary(po)).submitted).toBeGreaterThanOrEqual(1);

    // The generic action endpoint cannot move the file for a report twice.
    expect((await errorOf(() => performAction(po, appId, ACTIONS.SUBMIT_SITE_INSPECTION, { remarks: 'x' }, META)))).not.toBeNull();
  }, 240_000);

  it('a SHORTFALL recommendation raises an itemised shortfall and parks the file', async () => {
    const appId = await atTpa();
    const task0 = await openTask(appId);
    await prisma.workflowTask.update({ where: { id: task0!.id }, data: { assignedUserId: tpa.id, status: 'IN_PROGRESS' } });

    // Booked by one TPA for another: the task follows the inspector.
    const booked = await scheduleInspection(tpa, appId, { inspectorId: tpa2.id, scheduledFor: tomorrow(), remarks: '' }, META);
    expect((await openTask(appId))?.assignedUserId).toBe(tpa2.id);
    expect((await getInspection(tpa, booked.id)).permissions.canEdit).toBe(false);

    // tpa2 conducts it. Reuse the helpers by swapping the actor.
    const saved = tpa;
    tpa = tpa2;
    try {
      await answerAll(booked.id, {
        3: { status: 'SHORTFALL', observation: 'Boundary stones missing on the east side.' },
        7: { status: 'SHORTFALL', observation: 'Road width measured 7.2 m against 9 m declared.' },
      });
      await photographAllSides(booked.id);
      await saveInspectionDraft(tpa, booked.id, { recommendation: 'SHORTFALL', recommendationRemarks: 'Two curable deviations found on site.' }, META);
      const signed = await submitInspection(tpa, booked.id, { method: 'USB_TOKEN_DEMO', pin: DEMO_TOKEN_PIN, declaration: true }, META);

      expect(signed.workflow.actionCode).toBe(ACTIONS.RAISE_INSPECTION_SHORTFALL);
      expect(signed.workflow.shortfallNumbers).toHaveLength(1);
      const app = await appRow(appId);
      expect(app.currentStageCode).toBe('LTP_SHORTFALL_ACTION');
      expect(app.openShortfalls).toBe(1);

      const inspection = await getInspection(tpa, booked.id);
      expect(inspection.shortfall?.shortfallNumber).toBe(signed.workflow.shortfallNumbers[0]);
      const items = await prisma.shortfallItem.findMany({ where: { shortfallId: inspection.shortfallId! }, select: { description: true } });
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.description).join(' ')).toContain('Road width measured 7.2 m');
    } finally {
      tpa = saved;
    }
  }, 240_000);

  it('refuses to book from a desk that is not the TPA’s, and refuses the applicant', async () => {
    const appId = await atTpa();
    expect((await errorOf(() => scheduleInspection(ltp, appId, { inspectorId: tpa.id, scheduledFor: tomorrow(), remarks: '' }, META)))?.status).toBe(403);
    expect((await errorOf(() => scheduleInspection(po, appId, { inspectorId: tpa.id, scheduledFor: tomorrow(), remarks: '' }, META)))?.status).toBe(403);
    // A date in the past.
    expect(
      (await errorOf(() => scheduleInspection(tpa, appId, { inspectorId: tpa.id, scheduledFor: new Date(Date.now() - 3 * 86_400_000).toISOString(), remarks: '' }, META)))?.status
    ).toBe(400);
    // The applicant cannot read the register at all.
    expect((await errorOf(() => listInspections(ltp, {})))?.status).toBe(403);
  }, 240_000);
});
