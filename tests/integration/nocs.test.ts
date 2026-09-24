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
import { performAction } from '@/server/workflow/engine';
import {
  applicantUpdate,
  createNoc,
  expireLapsedNocs,
  getApplicationNocs,
  getNoc,
  listNocs,
  nocSummary,
  officerAction,
  readNocDocument,
} from '@/server/services/nocs';
import { nocDashboardSummary } from '@/server/services/analytics';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';
import { seedNocTypes } from '../../prisma/seed/13-noc-types';

/**
 * Phase 6 — the NOC module, end to end.
 *
 *   open (desk) → applied → received → shortfall → received again → verified
 *   → the file moves on → the old desk can no longer act → the certificate lapses
 *
 * Driven through the real services from a PAID application at the TPA desk,
 * as the site inspection suite does.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const FUTURE = day(365);
const MANDATORY = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);
const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;
let ltp: Actor;
let tpa: Actor;
let po: Actor;
let typeId: string;
let zoneId: string;
let fireId: string;

const actor = (id: string, name: string, role: RoleKey, zones: string[] = []) =>
  actorFor(id, name, [role], { capabilities: RBAC_MATRIX[role] as unknown as string[], zoneIds: zones });

async function errorOf(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
}

beforeAll(async () => {
  if (!dbUp) return;
  await seedNocTypes(prisma);
  fireId = (await prisma.nocType.findUniqueOrThrow({ where: { code: 'FIRE' } })).id;

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
      email: 'test-noc-ltp@example.com',
      name: 'Test NOC LTP',
      phone: '9876500081',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-NOC-1',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'NOC Firm',
    },
    admin,
    META
  );
  ltp = actor(createdLtp.user.id, createdLtp.user.name, ROLES.LTP);
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
    await cleanupTestUsers('test-noc-');
    await clearOrphanFiles();
    await clearStorage();
  }
  await prisma.$disconnect();
});

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
      eventId: `noc_${started.payment.paymentRef}`,
    })
  );
  return submitted.id;
}

const receipt = (overrides: Record<string, unknown> = {}) => ({
  action: 'RECORD_RECEIPT' as const,
  referenceNumber: 'FS/NOC/2026/00042',
  appliedDate: null,
  issuedDate: day(-5),
  expiryDate: day(3 * 365),
  remarks: '',
  demoDocument: false,
  ...overrides,
});

describe.skipIf(!dbUp)('NOC lifecycle', () => {
  it('runs a Fire NOC from requirement to verification, at the desk the workflow puts it', async () => {
    const appId = await atTpa();
    const app = await prisma.application.findUniqueOrThrow({ where: { id: appId }, select: { currentStageCode: true } });
    expect(app.currentStageCode).toBe('TPA_REVIEW');

    // ── The tab, before anything is opened ────────────────────────────
    const tab = await getApplicationNocs(tpa, appId);
    expect(tab.permissions.isDesk).toBe(true);
    expect(tab.available.map((t) => t.code)).toContain('FIRE');
    expect((await getApplicationNocs(ltp, appId)).permissions).toMatchObject({ isDesk: false, isApplicant: true });

    // The Planning Officer reads NOCs but verifies none.
    expect((await errorOf(() => createNoc(po, appId, { nocTypeId: fireId, required: true, authority: '', remarks: '' }, META)))?.status).toBe(403);

    // ── The TPA opens it REQUIRED ─────────────────────────────────────
    const opened = await createNoc(tpa, appId, { nocTypeId: fireId, required: true, authority: '', remarks: 'Needed.' }, META);
    expect(opened).toMatchObject({ status: 'REQUIRED' });
    expect(opened.nocNumber).toMatch(/^NOC\/\d{4}\/\d{6}$/);
    expect((await errorOf(() => createNoc(tpa, appId, { nocTypeId: fireId, required: true, authority: '', remarks: '' }, META)))?.status).toBe(409);

    // Nothing to verify yet; and the applicant never verifies.
    expect((await errorOf(() => officerAction(tpa, opened.id, { action: 'VERIFY', remarks: '' }, META)))?.status).toBe(409);
    expect((await errorOf(() => officerAction(ltp, opened.id, { action: 'VERIFY', remarks: '' }, META)))?.status).toBe(403);

    // ── The applicant applies, then records the certificate ───────────
    const applied = await applicantUpdate(
      ltp,
      opened.id,
      { action: 'RECORD_APPLICATION', applicationReference: 'FS/APP/2026/00017', appliedDate: day(-20), issuedDate: null, expiryDate: null, remarks: '', demoDocument: false },
      META
    );
    expect(applied.status).toBe('APPLIED');

    const noFile = await errorOf(() => applicantUpdate(ltp, opened.id, receipt(), META));
    expect(noFile?.status).toBe(400);
    expect(noFile?.details.map((d) => d.path)).toContain('file');

    const lapsed = await errorOf(() =>
      applicantUpdate(ltp, opened.id, { ...receipt({ expiryDate: day(-1) }), file: { name: 'noc.pdf', type: 'application/pdf', bytes: PDF } }, META)
    );
    expect(lapsed?.details.map((d) => d.path)).toContain('expiryDate');

    const received = await applicantUpdate(
      ltp,
      opened.id,
      { ...receipt(), file: { name: 'fire-noc.pdf', type: 'application/pdf', bytes: PDF } },
      META
    );
    expect(received.status).toBe('RECEIVED');
    // The certificate is withheld until the scan job clears it.
    expect((await errorOf(() => readNocDocument(tpa, opened.id)))?.status).toBe(409);
    await drainJobs();
    const stored = await readNocDocument(tpa, opened.id);
    expect(stored.mimeType).toBe('application/pdf');

    // ── A stale screen is refused; a shortfall needs a reason ─────────
    expect((await errorOf(() => officerAction(tpa, opened.id, { action: 'VERIFY', remarks: '', expectedStatus: 'APPLIED' }, META)))?.code).toBe('STALE_WRITE');
    expect((await errorOf(() => officerAction(tpa, opened.id, { action: 'SHORTFALL', remarks: '  ' }, META)))?.status).toBe(400);

    const short = await officerAction(tpa, opened.id, { action: 'SHORTFALL', remarks: 'Survey number on the NOC does not match.' }, META);
    expect(short.status).toBe('SHORTFALL');

    // The applicant corrects it; the stored certificate carries over.
    const again = await applicantUpdate(ltp, opened.id, receipt({ referenceNumber: 'FS/NOC/2026/00043' }), META);
    expect(again.status).toBe('RECEIVED');

    // ── Verified ──────────────────────────────────────────────────────
    const verified = await officerAction(tpa, opened.id, { action: 'VERIFY', remarks: 'In order.', expectedStatus: 'RECEIVED' }, META);
    expect(verified.status).toBe('VERIFIED');

    const detail = await getNoc(ltp, opened.id);
    expect(detail).toMatchObject({
      status: 'VERIFIED',
      isRequired: true,
      referenceNumber: 'FS/NOC/2026/00043',
      verifiedByName: tpa.name,
      verifiedByRoleKey: 'TPA',
      reviewedStageCode: 'TPA_REVIEW',
      hasDocument: true,
    });
    expect(detail.events.map((e) => e.action).reverse()).toEqual([
      'CREATED',
      'RECORD_APPLICATION',
      'RECORD_RECEIPT',
      'SHORTFALL',
      'RECORD_RECEIPT',
      'VERIFY',
    ]);
    expect(detail.permissions.applicantMoves).toEqual([]);

    const auditRows = await prisma.auditLog.count({ where: { entityType: 'ApplicationNoc', entityId: opened.id } });
    expect(auditRows).toBe(6);

    // ── Register, summary and dashboard agree ─────────────────────────
    const register = await listNocs(admin, { applicationId: appId });
    expect(register.rows).toHaveLength(1);
    expect(register.rows[0]).toMatchObject({ status: 'VERIFIED', application: { currentDesk: 'TPA' } });
    const [summary, dash] = await Promise.all([nocSummary(admin), nocDashboardSummary(admin)]);
    expect(dash.pending).toBe(summary.pending);
  });

  it('follows the file: once it leaves the TPA desk, the TPA can no longer decide its NOCs', async () => {
    const appId = await atTpa();
    const noc = await createNoc(tpa, appId, { nocTypeId: fireId, required: true, authority: '', remarks: '' }, META);

    await performAction(tpa, appId, ACTIONS.FORWARD, { remarks: 'Forwarded.' }, META);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: appId }, select: { currentStageCode: true } });
    expect(app.currentStageCode).toBe('PLANNING_OFFICER_REVIEW');

    const refused = await errorOf(() => officerAction(tpa, noc.id, { action: 'MARK_NOT_REQUIRED', remarks: 'Not needed.' }, META));
    expect(refused?.status).toBe(403);
    expect(refused?.message).toMatch(/desk the file is at/);
    expect((await getApplicationNocs(tpa, appId)).permissions.isDesk).toBe(false);
    // The Planning Officer owns the desk but holds no NOC_VERIFY.
    expect((await getApplicationNocs(po, appId)).permissions.isDesk).toBe(false);

    // The applicant is not bound to a desk.
    expect((await getNoc(ltp, noc.id)).permissions.applicantMoves).toEqual(['RECORD_APPLICATION', 'RECORD_RECEIPT']);
  });

  it('opens an applicant declaration PENDING, lets the desk rule it out, and expires a lapsed certificate', async () => {
    const appId = await atTpa();
    const declared = await createNoc(ltp, appId, { nocTypeId: fireId, required: true, authority: '', remarks: 'We hold one.' }, META);
    expect(declared.status).toBe('PENDING');
    expect((await getNoc(tpa, declared.id)).isRequired).toBeNull();

    const needsReason = await errorOf(() => officerAction(tpa, declared.id, { action: 'MARK_NOT_REQUIRED', remarks: '' }, META));
    expect(needsReason?.status).toBe(400);
    const ruledOut = await officerAction(tpa, declared.id, { action: 'MARK_NOT_REQUIRED', remarks: 'Two-storey residence.' }, META);
    expect(ruledOut.status).toBe('NOT_REQUIRED');
    expect((await getNoc(ltp, declared.id)).permissions.applicantMoves).toEqual([]);

    // Back to required, received with a demo certificate, then lapsed.
    await officerAction(tpa, declared.id, { action: 'MARK_REQUIRED', remarks: '' }, META);
    await applicantUpdate(ltp, declared.id, receipt({ demoDocument: true }), META);
    const placeholder = await readNocDocument(tpa, declared.id);
    expect(placeholder.mimeType).toBe('image/svg+xml');
    expect(placeholder.bytes.toString('utf8')).toContain('NOT A REAL CERTIFICATE');

    await prisma.applicationNoc.update({ where: { id: declared.id }, data: { expiryDate: new Date(Date.now() - DAY) } });
    expect(await expireLapsedNocs({ force: true })).toBeGreaterThanOrEqual(1);
    const expired = await getNoc(tpa, declared.id);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.events[0]).toMatchObject({ action: 'EXPIRE', toStatus: 'EXPIRED', actorName: 'System' });
    expect(expired.permissions.applicantMoves).toEqual([]); // the TPA's view
    expect((await getNoc(ltp, declared.id)).permissions.applicantMoves).toContain('RECORD_RECEIPT');
  });

  it('keeps NOCs out of reach of anyone who cannot see the file', async () => {
    const appId = await atTpa();
    const noc = await createNoc(tpa, appId, { nocTypeId: fireId, required: true, authority: '', remarks: '' }, META);
    const stranger = actor('00000000-0000-4000-8000-000000000001', 'Other LTP', ROLES.LTP);
    expect((await errorOf(() => getNoc(stranger, noc.id)))?.status).toBe(404);
    expect((await listNocs(stranger, { applicationId: appId })).total).toBe(0);
  });
});
