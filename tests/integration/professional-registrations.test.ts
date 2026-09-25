import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, databaseAvailable, actorFor, cleanupTestUsers, clearStorage, META } from './setup';
import { seedRbac } from '../../prisma/seed/01-rbac';
import { seedSettings } from '../../prisma/seed/04-settings';
import { seedProfessionalTypes } from '../../prisma/seed/14-professional-types';
import { invalidateSettingsCache } from '@/server/services/settings';
import { createUser } from '@/server/services/users';
import { createApplication, saveStep } from '@/server/services/applications';
import { eligibleProfessionals } from '@/server/services/professional-changes';
import {
  availableProfessionals,
  checkProfessionalDocument,
  createProfessionalDraft,
  decideProfessionalRegistration,
  expireLapsedProfessionalRegistrations,
  getProfessionalRegistration,
  listProfessionalRegistrations,
  raiseProfessionalShortfall,
  renewProfessionalRegistration,
  respondProfessionalShortfall,
  submitProfessionalRegistration,
  takeUpProfessionalRegistration,
  verifyProfessionalRegistration,
  type ProfessionalUploads,
} from '@/server/services/professional-registrations';
import { professionalDraftSchema } from '@/lib/schemas/professional-registration';
import { latestProfessionalDocuments, type ProfessionalDocument } from '@/lib/professional-registration';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES } from '@/lib/constants';

/**
 * Phase 12 — professional registration, end to end, through the real services:
 *
 *   Registration → Review (each document checked) → Shortfall / Verification
 *   → Approval → Professional available for applications
 *
 * and then the applications side: the LTP step names the approved
 * structural engineer and the LTP's own registration; the change of
 * professional offers the newly approved LTP. With the refusals: wrong desk,
 * out of order, unverified documents, missing consent, duplicate licence,
 * another professional's registration, an unapproved one, early renewal.
 */

const dbUp = await databaseAvailable();
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const pdf = (name: string) => ({ name, type: 'application/pdf', bytes: PDF });
const MARK = 'test-prof';
const MATRIX = RBAC_MATRIX as unknown as Record<string, string[]>;
const inYears = (n: number) => new Date(Date.now() + n * 365 * 86_400_000).toISOString().slice(0, 10);

async function desk(roleKey: string, email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return actorFor(u.id, u.name, [roleKey], { capabilities: MATRIX[roleKey] });
}

async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isApiError(error)) return { status: error.status, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const ALL_DOCS: ProfessionalUploads = {
  LICENCE_CERTIFICATE: pdf('licence.pdf'),
  QUALIFICATION_CERTIFICATE: pdf('degree.pdf'),
  ID_PROOF: pdf('id.pdf'),
  ADDRESS_PROOF: pdf('address.pdf'),
  CONSENT_LETTER: pdf('consent.pdf'),
};

const draft = (over: Record<string, string> = {}) =>
  professionalDraftSchema.parse({
    professionalType: 'STRUCTURAL_ENGINEER',
    name: 'Test Structural Engineer',
    licenceNo: 'TEST-SE-001',
    registrationBody: 'State Council of Engineers',
    qualification: 'M.Tech (Structures)',
    experienceYears: '10',
    address: 'D.No 1-2-3, Test Street, Guntur',
    pincode: '522002',
    mobile: '9000019101',
    email: `${MARK}-se@example.com`,
    licenceValidTo: inYears(5),
    consentGiven: 'true',
    ...over,
  });

async function cleanup() {
  const rows = await prisma.professionalRegistration.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  await prisma.applicant.updateMany({ where: { OR: [{ ltpRegistrationId: { in: ids } }, { structuralEngineerRegistrationId: { in: ids } }] }, data: { ltpRegistrationId: null, structuralEngineerRegistrationId: null } });
  await prisma.outwardEntry.deleteMany({ where: { sourceType: 'ProfessionalRegistration', sourceId: { in: ids } } });
  await prisma.professionalRegistration.deleteMany({ where: { id: { in: ids } } });
}

/** Verify every latest document as the verifying desk. */
async function verifyAllDocuments(po: Awaited<ReturnType<typeof desk>>, id: string) {
  const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id } });
  for (const { doc, index } of latestProfessionalDocuments(row.documents as unknown as ProfessionalDocument[]).values()) {
    if (doc.status !== 'VERIFIED') await checkProfessionalDocument(po, id, { index, decision: 'VERIFIED', remarks: '' }, META);
  }
}

describe.skipIf(!dbUp)('LTP registration', () => {
  let tpa: Awaited<ReturnType<typeof desk>>;
  let po: Awaited<ReturnType<typeof desk>>;
  let zjd: Awaited<ReturnType<typeof desk>>;
  let viewer: Awaited<ReturnType<typeof desk>>;
  let ltpA: ReturnType<typeof actorFor>;
  let ltpB: ReturnType<typeof actorFor>;
  let se: { id: string; applicationNumber: string };

  beforeAll(async () => {
    await seedRbac(prisma);
    await seedSettings(prisma);
    await seedProfessionalTypes(prisma);
    await prisma.systemSetting.update({ where: { key: 'professional_registration_validity_years' }, data: { value: '3' } });
    await prisma.systemSetting.update({ where: { key: 'professional_renewal_window_days' }, data: { value: '60' } });
    invalidateSettingsCache();
    await cleanup();
    await cleanupTestUsers(`${MARK}-`);
    tpa = await desk(ROLES.TPA, 'tpa.demo@example.com');
    po = await desk(ROLES.PLANNING_OFFICER, 'po.demo@example.com');
    zjd = await desk(ROLES.ZJD, 'zjd.demo@example.com');
    viewer = await desk(ROLES.VIEWER, 'viewer.demo@example.com');
    const admin = actorFor((await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } })).id, 'Admin', ['SYSTEM_ADMIN'], { capabilities: MATRIX.SYSTEM_ADMIN });
    const mk = async (tag: string, licence: string) => {
      const r = await createUser(
        { email: `${MARK}-${tag}@example.com`, name: `Test LTP ${tag}`, phone: '9876500191', designation: 'Architect', employeeCode: '', roleKey: ROLES.LTP, zoneIds: [], ltpLicenceNo: licence, ltpLicenceClass: 'CLASS_I', firmName: `Firm ${tag}` } as never,
        admin as never,
        META
      );
      return actorFor(r.user.id, r.user.name, [ROLES.LTP], { capabilities: MATRIX.LTP });
    };
    ltpA = await mk('a', 'TEST-LTP-A');
    ltpB = await mk('b', 'TEST-LTP-B');
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await cleanupTestUsers(`${MARK}-`);
    await clearStorage();
  });

  it('registers: a draft with its own reference, filed outside any application', async () => {
    const { CONSENT_LETTER: _c, ...partial } = ALL_DOCS;
    se = await createProfessionalDraft(tpa, { ...draft({ consentGiven: 'false' }), uploads: partial }, META);
    expect(se.applicationNumber).toMatch(/^PRA\/\d{4}\/\d{6}$/);
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } });
    const files = await prisma.fileObject.findMany({ where: { id: { in: (row.documents as unknown as ProfessionalDocument[]).map((d) => d.fileObjectId!) } } });
    expect(files).toHaveLength(4);
    for (const f of files) expect(f.storageKey.startsWith(`professional-registrations/${se.id}/professionals/`)).toBe(true);
  });

  it('refuses submission without consent and the signed consent document, and the wrong desk', async () => {
    expect((await refusal(() => createProfessionalDraft(ltpA, draft(), META))).status).toBe(403);
    const r = await refusal(() => submitProfessionalRegistration(tpa, se.id, { remarks: '' }, META));
    expect(r.status).toBe(422);
    const view = await getProfessionalRegistration(tpa, se.id);
    expect(view.submitBlocker).toMatch(/consent/i);
  });

  it('submits once consent is given and the consent document attached — into the Pending register', async () => {
    const { updateProfessionalDraft } = await import('@/server/services/professional-registrations');
    await updateProfessionalDraft(tpa, se.id, { ...draft(), uploads: { CONSENT_LETTER: pdf('consent.pdf') }, expectedStatus: 'DRAFT' }, META);
    await submitProfessionalRegistration(tpa, se.id, { remarks: 'Received.' }, META);
    const pending = await listProfessionalRegistrations(viewer, { register: 'PENDING', pageSize: 100 });
    expect(pending.rows.some((r) => r.id === se.id)).toBe(true);
  });

  it('reviews: take-up, then each document verified or rejected by the verifying desk', async () => {
    expect((await refusal(() => takeUpProfessionalRegistration(tpa, se.id, { remarks: '' }, META))).status).toBe(403);
    await takeUpProfessionalRegistration(po, se.id, { remarks: '' }, META);
    expect((await listProfessionalRegistrations(viewer, { register: 'IN_PROCESS', pageSize: 100 })).rows.some((r) => r.id === se.id)).toBe(true);

    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } });
    const latest = latestProfessionalDocuments(row.documents as unknown as ProfessionalDocument[]);
    const q = latest.get('QUALIFICATION_CERTIFICATE')!;
    expect((await refusal(() => checkProfessionalDocument(po, se.id, { index: q.index, decision: 'REJECTED', remarks: '' }, META))).status).toBe(400);
    await checkProfessionalDocument(po, se.id, { index: q.index, decision: 'REJECTED', remarks: 'Copy illegible.' }, META);
    for (const k of ['LICENCE_CERTIFICATE', 'ID_PROOF', 'ADDRESS_PROOF', 'CONSENT_LETTER'] as const) {
      await checkProfessionalDocument(po, se.id, { index: latest.get(k)!.index, decision: 'VERIFIED', remarks: '' }, META);
    }
    // A recommendation to approve needs every required document verified.
    const r = await refusal(() => verifyProfessionalRegistration(po, se.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'All good.' }, META));
    expect(r.message).toMatch(/qualification/i);
  });

  it('shortfall: raised, answered with a fresh document (round 2), which is then verified', async () => {
    await raiseProfessionalShortfall(po, se.id, { items: ['Degree certificate illegible'], remarks: 'Furnish a legible copy.' }, META);
    expect((await listProfessionalRegistrations(viewer, { register: 'SHORTFALL', pageSize: 100 })).rows.some((r) => r.id === se.id)).toBe(true);
    await respondProfessionalShortfall(tpa, se.id, { remarks: 'Legible attested copy furnished.', demoDocuments: false, demoKinds: '', uploads: { QUALIFICATION_CERTIFICATE: pdf('degree-2.pdf') } }, META);
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } });
    expect(row).toMatchObject({ status: 'IN_PROCESS', round: 2 });
    const docs = row.documents as unknown as ProfessionalDocument[];
    expect(docs.filter((d) => d.kind === 'QUALIFICATION_CERTIFICATE').map((d) => d.status)).toEqual(['REJECTED', 'UPLOADED']);
    // Only the latest of a kind may be checked.
    const old = docs.findIndex((d) => d.kind === 'QUALIFICATION_CERTIFICATE');
    expect((await refusal(() => checkProfessionalDocument(po, se.id, { index: old, decision: 'VERIFIED', remarks: '' }, META))).status).toBe(409);
    await verifyAllDocuments(po, se.id);
    await verifyProfessionalRegistration(po, se.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'Licence confirmed with the Council.' }, META);
    expect((await listProfessionalRegistrations(viewer, { register: 'VERIFIED', pageSize: 100 })).rows.some((r) => r.id === se.id)).toBe(true);
  });

  it('approves: a type-prefixed number, validity from the settings, a letter in Outward — and the LTP becomes available', async () => {
    expect((await refusal(() => decideProfessionalRegistration(po, se.id, { decision: 'APPROVED', remarks: 'not mine' }, META))).status).toBe(403);
    expect((await availableProfessionals({ purpose: 'STRUCTURAL' })).some((p) => p.registrationId === se.id)).toBe(false);
    await decideProfessionalRegistration(zjd, se.id, { decision: 'APPROVED', remarks: 'Registered.' }, META);
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } });
    expect(row.registrationNumber).toMatch(/^STR\/\d{4}\/\d{6}$/);
    expect(row.validFrom!.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(row.cappedByLicence).toBe(false);
    const outward = await prisma.outwardEntry.findUniqueOrThrow({ where: { id: row.outwardEntryId! } });
    expect(outward).toMatchObject({ documentType: 'REGISTRATION_LETTER', documentReference: row.registrationNumber, applicationId: null });
    expect((await availableProfessionals({ purpose: 'STRUCTURAL' })).some((p) => p.registrationId === se.id)).toBe(true);
    // Not a file-holding type: never offered as a file's LTP.
    expect((await availableProfessionals({ purpose: 'FILE_HOLDER' })).some((p) => p.registrationId === se.id)).toBe(false);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'ProfessionalRegistration', entityId: se.id }, orderBy: { seq: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'PROFESSIONAL_REGISTRATION_DRAFTED',
        'PROFESSIONAL_REGISTRATION_SUBMITTED',
        'PROFESSIONAL_REGISTRATION_TAKEN_UP',
        'PROFESSIONAL_DOCUMENT_REJECTED',
        'PROFESSIONAL_DOCUMENT_VERIFIED',
        'PROFESSIONAL_REGISTRATION_SHORTFALL_RAISED',
        'PROFESSIONAL_REGISTRATION_SHORTFALL_ANSWERED',
        'PROFESSIONAL_REGISTRATION_VERIFIED',
        'PROFESSIONAL_REGISTRATION_APPROVED',
      ])
    );
  });

  it('never runs a registration past the licence', async () => {
    const short = await createProfessionalDraft(
      tpa,
      { ...draft({ name: 'Test Short Licence', licenceNo: 'TEST-SE-002', email: `${MARK}-short@example.com`, licenceValidTo: inYears(1) }), uploads: ALL_DOCS },
      META
    );
    await submitProfessionalRegistration(tpa, short.id, { remarks: '' }, META);
    await takeUpProfessionalRegistration(po, short.id, { remarks: '' }, META);
    await verifyAllDocuments(po, short.id);
    await verifyProfessionalRegistration(po, short.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'Verified.' }, META);
    await decideProfessionalRegistration(zjd, short.id, { decision: 'APPROVED', remarks: 'Registered.' }, META);
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: short.id } });
    expect(row.cappedByLicence).toBe(true);
    expect(row.validTo!.toISOString().slice(0, 10)).toBe(inYears(1));
  });

  it('refuses a second live registration of the same licence', async () => {
    const dup = await createProfessionalDraft(tpa, { ...draft({ email: `${MARK}-dup@example.com` }), uploads: ALL_DOCS }, META);
    const r = await refusal(() => submitProfessionalRegistration(tpa, dup.id, { remarks: '' }, META));
    expect(r.status).toBe(409);
    expect(r.message).toMatch(/already on STR\//);
  });

  let ltpReg: string;
  it('registers an LTP LINKED to their portal account — the account is not copied', async () => {
    const d = await createProfessionalDraft(
      tpa,
      { ...draft({ professionalType: 'LTP', name: 'Test LTP a', licenceNo: 'TEST-LTP-A', userId: ltpA.id, email: `${MARK}-a@example.com`, registrationBody: 'The Authority' }), uploads: ALL_DOCS },
      META
    );
    // The linked account's licence must match.
    const wrong = await createProfessionalDraft(
      tpa,
      { ...draft({ professionalType: 'LTP', name: 'Wrong', licenceNo: 'NOT-A', userId: ltpB.id, email: `${MARK}-wrong@example.com` }), uploads: ALL_DOCS },
      META
    );
    expect((await refusal(() => submitProfessionalRegistration(tpa, wrong.id, { remarks: '' }, META))).message).toMatch(/holds licence TEST-LTP-B/);

    await submitProfessionalRegistration(tpa, d.id, { remarks: '' }, META);
    await takeUpProfessionalRegistration(po, d.id, { remarks: '' }, META);
    await verifyAllDocuments(po, d.id);
    await verifyProfessionalRegistration(po, d.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'Verified.' }, META);
    await decideProfessionalRegistration(zjd, d.id, { decision: 'APPROVED', remarks: 'Registered.' }, META);
    ltpReg = d.id;
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.registrationNumber).toMatch(/^LTP\/\d{4}\/\d{6}$/);
    expect(await prisma.user.count({ where: { email: `${MARK}-a@example.com` } })).toBe(1);
    expect((await availableProfessionals({ purpose: 'FILE_HOLDER', userId: ltpA.id })).map((p) => p.registrationId)).toEqual([d.id]);
  });

  it('application integration: the LTP step names the LTP’s registration and the structural engineer', async () => {
    const type = await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } });
    const app = await createApplication(ltpA as never, { applicationTypeId: type.id }, META);
    const appId = (app as { id: string }).id;

    // Another professional's registration, and an unapproved one, are refused.
    const pending = await prisma.professionalRegistration.findFirstOrThrow({ where: { email: `${MARK}-dup@example.com` } });
    expect(
      (await refusal(() => saveStep(ltpA as never, appId, { step: 'ltp', data: { declarationAccepted: true, remarks: '', professionalRegistrationId: se.id, structuralEngineerRegistrationId: '' }, partial: false } as never, META))).message
    ).toMatch(/approved and in force/);
    expect(
      (await refusal(() => saveStep(ltpA as never, appId, { step: 'ltp', data: { declarationAccepted: true, remarks: '', professionalRegistrationId: '', structuralEngineerRegistrationId: pending.id }, partial: false } as never, META))).message
    ).toMatch(/structural engineer/);

    await saveStep(ltpA as never, appId, { step: 'ltp', data: { declarationAccepted: true, remarks: '', professionalRegistrationId: ltpReg, structuralEngineerRegistrationId: se.id }, partial: false } as never, META);
    const applicant = await prisma.applicant.findUniqueOrThrow({ where: { applicationId: appId } });
    const seRow = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } });
    const own = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: ltpReg } });
    expect(applicant).toMatchObject({
      ltpRegistrationId: ltpReg,
      professionalRegistrationRef: own.registrationNumber,
      structuralEngineerRegistrationId: se.id,
      structuralEngineerName: 'Test Structural Engineer',
      structuralEngineerRegNo: seRow.registrationNumber,
    });
    const detail = await getProfessionalRegistration(viewer, se.id);
    expect(detail.filesNamed).toBe(1);
  });

  it('application integration: change of LTP offers only approved, in-force, linked LTPs', async () => {
    const before = await eligibleProfessionals(ltpB.id);
    expect(before.some((p) => p.id === ltpA.id)).toBe(true);
    expect(before.find((p) => p.id === ltpA.id)?.registrationNumber).toMatch(/^LTP\//);
    // B holds a licence but no registration: not offered.
    expect((await eligibleProfessionals(ltpA.id)).some((p) => p.id === ltpB.id)).toBe(false);
  });

  it('expires a lapsed registration, withdraws it from applications, and renews it', async () => {
    await prisma.professionalRegistration.update({ where: { id: se.id }, data: { validTo: new Date(Date.now() - 86_400_000), renewalDueDate: new Date(Date.now() - 61 * 86_400_000) } });
    expect((await expireLapsedProfessionalRegistrations()).expired).toBeGreaterThanOrEqual(1);
    expect((await expireLapsedProfessionalRegistrations()).expired).toBe(0);
    expect((await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: se.id } })).status).toBe('EXPIRED');
    expect((await availableProfessionals({ purpose: 'STRUCTURAL' })).some((p) => p.registrationId === se.id)).toBe(false);
    for (const register of ['EXPIRED', 'RENEWAL'] as const) {
      expect((await listProfessionalRegistrations(viewer, { register, pageSize: 100 })).rows.some((r) => r.id === se.id)).toBe(true);
    }
    const renewal = await renewProfessionalRegistration(tpa, se.id, { remarks: '', licenceValidTo: null }, META);
    const r = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: renewal.id } });
    expect(r).toMatchObject({ kind: 'RENEWAL', consentGiven: false, isCurrent: false });
    expect((r.documents as unknown as ProfessionalDocument[]).every((d) => d.carriedForward && d.status === 'UPLOADED')).toBe(true);
    expect((await refusal(() => renewProfessionalRegistration(tpa, se.id, { remarks: '', licenceValidTo: null }, META))).message).toMatch(/already under way/);
  });

  it('rejects on the verifying desk’s recommendation, even with documents unverified', async () => {
    const r = await createProfessionalDraft(tpa, { ...draft({ name: 'Test Rejected', licenceNo: 'TEST-SE-009', email: `${MARK}-rej@example.com` }), uploads: ALL_DOCS }, META);
    await submitProfessionalRegistration(tpa, r.id, { remarks: '' }, META);
    await takeUpProfessionalRegistration(po, r.id, { remarks: '' }, META);
    await verifyProfessionalRegistration(po, r.id, { outcome: 'RECOMMEND_REJECTION', remarks: 'Licence suspended per the Council.' }, META);
    expect((await refusal(() => decideProfessionalRegistration(zjd, r.id, { decision: 'APPROVED', remarks: 'Approve anyway.' }, META))).status).toBe(422);
    await decideProfessionalRegistration(zjd, r.id, { decision: 'REJECTED', remarks: 'Rejected.' }, META);
    const row = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'REJECTED', registrationNumber: null });
    expect((await listProfessionalRegistrations(viewer, { register: 'REJECTED', pageSize: 100 })).rows.some((x) => x.id === r.id)).toBe(true);
  });

  it('keeps the register from the LTP', async () => {
    expect((await refusal(() => listProfessionalRegistrations(ltpA as never, {}))).status).toBe(403);
  });
});
