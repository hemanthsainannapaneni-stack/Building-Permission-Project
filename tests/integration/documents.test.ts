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
  actorFor,
  META,
} from './setup';
import { createApplication, saveStep, submitApplication } from '@/server/services/applications';
import { uploadDrawing } from '@/server/services/drawings';
import { requestScrutiny } from '@/server/services/scrutiny';
import {
  buildDocumentContext,
  documentsComplete,
  getDocuments,
  readDocumentVersion,
  requireDocumentVersion,
  uploadDocument,
  verifyDocument,
} from '@/server/services/documents';
import { generateFee } from '@/server/services/fees';
import { createUser } from '@/server/services/users';
import { invalidateSettingsCache } from '@/server/services/settings';
import { ROLES } from '@/lib/constants';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 4 — documents, and the two things the phase exists to prove.
 *
 *   · The required list is DERIVED, not stored. Change the building and the
 *     checklist changes with it, on the next read, with no migration and no
 *     administrator retyping anything.
 *   · A fee cannot be raised while a mandatory document is outstanding. That
 *     is §5, and it is the point where the checklist stops being a list and
 *     starts being a gate.
 *
 * The suite drives the real services throughout — the same functions the API
 * routes call — so the guards, the audit rows and the status reconciliation
 * are exercised rather than described.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PE_BINARY = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

/** Far enough out that a certificate is valid whenever the suite is run. */
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/**
 * Every unconditionally-mandatory document type, as the seed defines them.
 *
 * Derived rather than listed: the fee gate refuses a demand until all of them
 * are in, so a hard-coded list silently stops working the day a requirement is
 * added — which is what happened when BIM_MODEL became mandatory.
 */
const MANDATORY = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);

const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY', 'FIRE_NOC']);

let ltp: ReturnType<typeof actorFor>;
let otherLtp: ReturnType<typeof actorFor>;
let officer: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let zoneId: string;

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  const a = await createUser(
    {
      email: 'test-doc-a@example.com',
      name: 'Test Document LTP',
      phone: '9876543210',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-DOC-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Document Firm',
    },
    admin,
    META
  );
  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);

  const b = await createUser(
    {
      email: 'test-doc-b@example.com',
      name: 'Test Document Other LTP',
      phone: '9876543211',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-DOC-B',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Other Firm',
    },
    admin,
    META
  );
  otherLtp = actorFor(b.user.id, b.user.name, [ROLES.LTP]);

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  // The TPA is who actually checks a document at the counter. A zonal officer
  // is scoped to their jurisdiction, so they must hold the zone these
  // applications are filed in or every read is a 404 — which is the rule
  // working, not a broken fixture.
  const tpaUser = await prisma.user.findUniqueOrThrow({ where: { email: 'tpa.demo@example.com' } });
  officer = actorFor(tpaUser.id, tpaUser.name, [ROLES.TPA], { zoneIds: [zoneId] });
}, 60_000);

beforeEach(async () => {
  if (!dbUp) return;
  // Version 1 passes, so every fixture reaches the document stage in one hop.
  await configureMockScrutiny({ passFromVersion: 1 });
});

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id, otherLtp?.id].filter(Boolean) as string[]);
  await clearJobs();
  await setVerificationPolicy(false);
});

afterAll(async () => {
  if (dbUp) {
    await cleanupTestUsers();
    await clearOrphanFiles();
    await clearStorage();
  }
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

type BuildingOverrides = Partial<{
  numFloors: number;
  numBasements: number;
  buildingHeightM: number;
  occupancyType: string;
  ownerSameAsApplicant: boolean;
  lpNumber: string;
  builtUpAreaSqm: number;
  plotAreaSqm: number;
}>;

/** An application filed, drawn and through scrutiny — ready for documents. */
async function documentStageApplication(overrides: BuildingOverrides = {}) {
  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

  const ownerSame = overrides.ownerSameAsApplicant ?? true;
  const plotAreaSqm = overrides.plotAreaSqm ?? 300;

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: '', aadhaarLast4: '', panMasked: '' }],
    [
      'owner',
      ownerSame
        ? { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }
        : { ownerSameAsApplicant: false, ownerName: 'Lakshmi Devi', ownerPhone: '9876500000', ownerAddress: '8 Church Street, Hyderabad' },
    ],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    [
      'survey',
      {
        surveyNumbers: '123/A',
        plotNo: '7',
        plotAreaSqm,
        roadWidthM: 9,
        layoutName: overrides.lpNumber ? 'Green Meadows' : '',
        lpNumber: overrides.lpNumber ?? '',
        landUseZone: '',
        tenureType: '',
      },
    ],
    [
      'development',
      {
        buildingUse: 'DWELLING',
        occupancyType: overrides.occupancyType ?? 'A_RESIDENTIAL',
        buildingSubUse: '',
        structureType: 'RCC',
        numFloors: overrides.numFloors ?? 2,
        numBasements: overrides.numBasements ?? 0,
        numDwellingUnits: 1,
        buildingHeightM: overrides.buildingHeightM ?? 7.5,
      },
    ],
    [
      'building',
      {
        plotAreaSqm,
        builtUpAreaSqm: overrides.builtUpAreaSqm ?? 400,
        floorAreaSqm: 380,
        coverageAreaSqm: 180,
        parkingAreaSqm: 40,
        setbackFrontM: 3,
        setbackRearM: 2,
        setbackLeftM: 1.5,
        setbackRightM: 1.5,
      },
    ],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  for (const [step, data] of steps) {
    await saveStep(ltp, app.id, { step: step as never, data, partial: false }, META);
  }

  const submitted = await submitApplication(ltp, app.id, META);

  await uploadDrawing(
    ltp,
    {
      applicationId: submitted.id,
      category: 'SITE_PLAN',
      file: { name: 'site-plan.pdf', type: 'application/pdf', bytes: PDF },
    },
    META
  );
  await drainJobs();

  await requestScrutiny(ltp, submitted.id, META);
  await drainJobs();

  return submitted;
}

async function uploadDoc(
  applicationId: string,
  documentTypeCode: string,
  options: { actor?: ReturnType<typeof actorFor>; file?: { name: string; type: string; bytes: Buffer }; expiresOn?: string | null; remarks?: string } = {}
) {
  const result = await uploadDocument(
    options.actor ?? ltp,
    {
      applicationId,
      documentTypeCode,
      remarks: options.remarks,
      expiresOn:
        options.expiresOn !== undefined
          ? options.expiresOn
          : NEEDS_EXPIRY.has(documentTypeCode)
            ? FUTURE
            : null,
      file: options.file ?? { name: `${documentTypeCode.toLowerCase()}.pdf`, type: 'application/pdf', bytes: PDF },
    },
    META
  );

  // An upload is not servable until the scan job has cleared it, and the
  // download path refuses an unscanned file. Running the queue here is what
  // the worker does a second later in production.
  await drainJobs();
  return result;
}

/** Uploads every mandatory document the base fixture asks for. */
async function completeDocuments(applicationId: string) {
  for (const code of MANDATORY) await uploadDoc(applicationId, code);
}

const statusOf = async (id: string) =>
  (await prisma.application.findUniqueOrThrow({ where: { id } })).status;

const codesOn = async (applicationId: string, actor = ltp) => {
  const checklist = await getDocuments(actor, applicationId);
  return checklist.entries.filter((e) => e.isRequired).map((e) => e.code);
};

/** Flips the `documents_complete_requires_verification` policy (Q9). */
async function setVerificationPolicy(required: boolean) {
  await prisma.systemSetting.update({
    where: { key: 'documents_complete_requires_verification' },
    data: { value: String(required) },
  });
  invalidateSettingsCache();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The derived checklist — the Phase 4 exit criterion
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the required list is derived from the application', () => {
  it('changing numFloors from 3 to 5 changes the required-document list', async () => {
    const app = await documentStageApplication({ numFloors: 3 });

    const atThree = await codesOn(app.id);
    expect(atThree).not.toContain('STRUCTURAL_STABILITY_CERTIFICATE');

    // The building grows. Nothing else changes — no rule is edited, no
    // administrator is involved, no migration runs.
    await prisma.buildingDetail.update({
      where: { applicationId: app.id },
      data: { numFloors: 5 },
    });

    const atFive = await codesOn(app.id);
    expect(atFive).toContain('STRUCTURAL_STABILITY_CERTIFICATE');

    // And ONLY that changed: a derived list must not quietly reshuffle
    // everything else when one particular moves.
    expect(atFive.filter((c) => c !== 'STRUCTURAL_STABILITY_CERTIFICATE')).toEqual(atThree);
  }, 60_000);

  it('says WHY a conditional document is being asked for', async () => {
    const app = await documentStageApplication({ numFloors: 5 });

    const checklist = await getDocuments(ltp, app.id);
    const entry = checklist.entries.find((e) => e.code === 'STRUCTURAL_STABILITY_CERTIFICATE');

    // An unexplained extra row is a telephone call to the office — and a
    // sentence that does not parse ("the building has is at least 4") is
    // worse than none, so the whole rendered sentence is asserted.
    expect(entry?.whyRequired).toBe(
      'the number of floors is at least 4 or the building height in metres is more than 15'
    );
  }, 60_000);

  it('demands a no-objection certificate exactly when the owner is not the applicant', async () => {
    const own = await documentStageApplication({ ownerSameAsApplicant: true });
    expect(await codesOn(own.id)).not.toContain('OWNER_NOC');

    const notOwn = await documentStageApplication({ ownerSameAsApplicant: false });
    expect(await codesOn(notOwn.id)).toContain('OWNER_NOC');
  }, 90_000);

  it('demands a soil test once there is a basement', async () => {
    const app = await documentStageApplication({ numBasements: 1 });
    expect(await codesOn(app.id)).toContain('SOIL_TEST_REPORT');
  }, 60_000);

  it('demands a fire NOC on an assembly occupancy, whatever its height', async () => {
    const app = await documentStageApplication({ occupancyType: 'D_ASSEMBLY' });
    expect(await codesOn(app.id)).toContain('FIRE_NOC');
  }, 60_000);

  it('demands the approved layout copy only when a layout number was given', async () => {
    const without = await documentStageApplication();
    expect(await codesOn(without.id)).not.toContain('LAYOUT_APPROVAL_COPY');

    const with_ = await documentStageApplication({ lpNumber: 'LP/2021/44' });
    expect(await codesOn(with_.id)).toContain('LAYOUT_APPROVAL_COPY');
  }, 90_000);

  it('builds the condition context from the application, not from defaults', async () => {
    const app = await documentStageApplication({ numFloors: 4, numBasements: 2, lpNumber: 'LP/2021/44' });

    const row = await prisma.application.findFirstOrThrow({
      where: { id: app.id },
      include: { applicant: true, property: true, building: true, applicationType: true, zone: true },
    });

    const context = buildDocumentContext(row as never) as {
      building: { numFloors: number; numBasements: number };
      property: { lpNumber: string };
      applicant: { ownerSameAsApplicant: boolean };
    };

    expect(context.building.numFloors).toBe(4);
    expect(context.building.numBasements).toBe(2);
    expect(context.property.lpNumber).toBe('LP/2021/44');
    expect(context.applicant.ownerSameAsApplicant).toBe(true);
  }, 60_000);

  it('keeps a document that is no longer required, marked as such', async () => {
    const app = await documentStageApplication({ numFloors: 5 });
    await uploadDoc(app.id, 'STRUCTURAL_STABILITY_CERTIFICATE');

    // The building shrinks after the certificate was uploaded.
    await prisma.buildingDetail.update({
      where: { applicationId: app.id },
      data: { numFloors: 2 },
    });

    const checklist = await getDocuments(ltp, app.id);
    const entry = checklist.entries.find((e) => e.code === 'STRUCTURAL_STABILITY_CERTIFICATE');

    // Still visible, still downloadable, no longer demanded. Silently hiding
    // an uploaded file is how a system loses a document.
    expect(entry).toBeDefined();
    expect(entry!.isRequired).toBe(false);
    expect(entry!.documentId).not.toBeNull();
    expect(checklist.missing.map((m) => m.code)).not.toContain('STRUCTURAL_STABILITY_CERTIFICATE');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Upload, versioning and the gates
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('uploading a document', () => {
  it('stores the file and creates version 1', async () => {
    const app = await documentStageApplication();
    const result = await uploadDoc(app.id, 'SALE_DEED');

    expect(result.version.versionNo).toBe(1);
    expect(result.version.isActive).toBe(true);
    expect(result.version.status).toBe('UPLOADED');

    const stored = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: result.version.id },
      include: { file: true },
    });
    expect(stored.file.checksumSha256).toHaveLength(64);
    expect(stored.file.sizeBytes).toBe(PDF.length);
  }, 60_000);

  it('supersedes rather than overwrites, and the database enforces it', async () => {
    const app = await documentStageApplication();
    const v1 = await uploadDoc(app.id, 'SALE_DEED');
    const v2 = await uploadDoc(app.id, 'SALE_DEED', { remarks: 'Clearer scan' });

    expect(v2.version.versionNo).toBe(2);

    const versions = await prisma.documentVersion.findMany({
      where: { applicationDocumentId: v1.documentId },
      orderBy: { versionNo: 'asc' },
    });

    expect(versions).toHaveLength(2);
    expect(versions[0]!.isActive).toBe(false);
    expect(versions[0]!.status).toBe('SUPERSEDED');
    expect(versions[1]!.isActive).toBe(true);

    // V1's bytes are still there. A superseded version is history, not litter.
    const download = await readDocumentVersion(ltp, versions[0]!.id, META);
    expect(download.bytes.length).toBe(PDF.length);

    // And the partial unique index refuses a second active version even if
    // code forgot to supersede.
    await expect(
      prisma.documentVersion.update({
        where: { id: versions[0]!.id },
        data: { isActive: true },
      })
    ).rejects.toThrow();
  }, 60_000);

  it('keeps one document row per type, however many versions it has', async () => {
    const app = await documentStageApplication();
    await uploadDoc(app.id, 'SALE_DEED');
    await uploadDoc(app.id, 'SALE_DEED');
    await uploadDoc(app.id, 'SALE_DEED');

    const documents = await prisma.applicationDocument.findMany({
      where: { applicationId: app.id, documentType: { code: 'SALE_DEED' } },
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]!.currentVersionNo).toBe(3);
  }, 60_000);

  it('validates the BYTES, not the extension', async () => {
    const app = await documentStageApplication();

    await expect(
      uploadDoc(app.id, 'SALE_DEED', {
        file: { name: 'deed.pdf', type: 'application/pdf', bytes: PE_BINARY },
      })
    ).rejects.toThrow(/could not be recognised/i);
  }, 60_000);

  it('refuses a file type the document type does not accept', async () => {
    const app = await documentStageApplication();

    // The catalogue confines a photo ID to pdf and images; a DWG is a drawing
    // and belongs on the other tab.
    await expect(
      uploadDoc(app.id, 'APPLICANT_PHOTO_ID', {
        file: { name: 'id.dwg', type: 'image/vnd.dwg', bytes: PDF },
      })
    ).rejects.toThrow(/\.pdf/i);
  }, 60_000);

  it('accepts a photograph of a document, because that is what people have', async () => {
    const app = await documentStageApplication();
    const result = await uploadDoc(app.id, 'APPLICANT_PHOTO_ID', {
      file: { name: 'aadhaar.png', type: 'image/png', bytes: PNG },
    });
    expect(result.version.versionNo).toBe(1);
  }, 60_000);

  it('insists on an expiry date for a document that expires', async () => {
    const app = await documentStageApplication();

    await expect(
      uploadDoc(app.id, 'ENCUMBRANCE_CERTIFICATE', { expiresOn: null })
    ).rejects.toThrow(/valid until|expir/i);
  }, 60_000);

  it('does not count an expired certificate as satisfying its requirement', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);
    expect((await documentsComplete(app.id)).complete).toBe(true);

    // The EC lapses where it always lapses — in the past, quietly.
    await prisma.documentVersion.updateMany({
      where: { document: { applicationId: app.id, documentType: { code: 'ENCUMBRANCE_CERTIFICATE' } } },
      data: { expiresOn: new Date(Date.now() - 86_400_000) },
    });

    const after = await documentsComplete(app.id);
    expect(after.complete).toBe(false);
    expect(after.missing.map((m) => m.code)).toContain('ENCUMBRANCE_CERTIFICATE');
  }, 60_000);

  it('accepts a document nobody asked for, without counting it', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);

    // POWER_OF_ATTORNEY is on the list but optional.
    await uploadDoc(app.id, 'POWER_OF_ATTORNEY');

    const checklist = await getDocuments(ltp, app.id);
    const entry = checklist.entries.find((e) => e.code === 'POWER_OF_ATTORNEY');
    expect(entry?.documentId).not.toBeNull();
    expect(entry?.isMandatory).toBe(false);
    expect(checklist.summary.complete).toBe(true);
  }, 60_000);
});

describe.runIf(dbUp)('upload gates', () => {
  it('refuses a document before the drawing has passed scrutiny', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(uploadDoc(app.id, 'SALE_DEED')).rejects.toThrow(/particulars first/i);
  }, 60_000);

  it('refuses once the fee has been generated', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);
    await generateFee(officer, app.id, META);

    expect(await statusOf(app.id)).toBe('FEE_GENERATED');
    await expect(uploadDoc(app.id, 'LINK_DOCUMENTS')).rejects.toThrow(/no longer be changed/i);
  }, 60_000);

  it('refuses an LTP uploading to an application that is not theirs', async () => {
    const app = await documentStageApplication();

    await expect(uploadDoc(app.id, 'SALE_DEED', { actor: otherLtp })).rejects.toThrow(
      /could not be found|only upload documents to applications you filed/i
    );
  }, 60_000);

  it('will not serve another LTP a document version by id', async () => {
    const app = await documentStageApplication();
    const { version } = await uploadDoc(app.id, 'SALE_DEED');

    // The same 404 a genuinely missing id gets, so the endpoint cannot be used
    // to discover that a document exists.
    await expect(requireDocumentVersion(otherLtp, version.id)).rejects.toThrow(/could not be found/i);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Completeness, and the status that follows it
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('documents_complete', () => {
  it('names exactly what is outstanding while anything is', async () => {
    const app = await documentStageApplication();

    const empty = await documentsComplete(app.id);
    expect(empty.complete).toBe(false);
    expect(empty.required).toBe(MANDATORY.length);
    expect(empty.missing.map((m) => m.code).sort()).toEqual([...MANDATORY].sort());
    expect(empty.missing[0]!.reason).toMatch(/not uploaded/i);
  }, 60_000);

  it('moves the application to DOCUMENTS_COMPLETED on the last one, not before', async () => {
    const app = await documentStageApplication();

    for (const code of MANDATORY.slice(0, -1)) {
      await uploadDoc(app.id, code);
      expect(await statusOf(app.id)).toBe('DOCUMENT_UPLOAD_PENDING');
    }

    await uploadDoc(app.id, MANDATORY[MANDATORY.length - 1]!);
    expect(await statusOf(app.id)).toBe('DOCUMENTS_COMPLETED');
  }, 90_000);

  it('records the completion on the timeline', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);

    const event = await prisma.applicationEvent.findFirst({
      where: { applicationId: app.id, type: 'DOCUMENTS_COMPLETED' },
    });
    expect(event).not.toBeNull();
    expect(event!.description).toMatch(/7 required documents/i);
  }, 60_000);

  it('re-derives from the rules rather than trusting the status', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);
    expect(await statusOf(app.id)).toBe('DOCUMENTS_COMPLETED');

    // A status is a cache. Corrupt it and the gate must still be right.
    await prisma.application.update({
      where: { id: app.id },
      data: { status: 'DOCUMENTS_COMPLETED' },
    });
    await prisma.documentVersion.deleteMany({
      where: { document: { applicationId: app.id, documentType: { code: 'SALE_DEED' } } },
    });
    await prisma.applicationDocument.deleteMany({
      where: { applicationId: app.id, documentType: { code: 'SALE_DEED' } },
    });

    const recomputed = await documentsComplete(app.id);
    expect(recomputed.complete).toBe(false);
    expect(recomputed.missing.map((m) => m.code)).toEqual(['SALE_DEED']);
  }, 60_000);

  it('honours the verification policy when it is switched on', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);
    expect((await documentsComplete(app.id)).complete).toBe(true);

    // Q9: a department that wants documents checked before the fee is raised
    // sets this, and uploaded-but-unverified stops counting.
    await setVerificationPolicy(true);

    const strict = await documentsComplete(app.id);
    expect(strict.complete).toBe(false);
    expect(strict.missing).toHaveLength(MANDATORY.length);
    expect(strict.missing[0]!.reason).toMatch(/waiting to be verified/i);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Officer verification
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('verification', () => {
  it('marks the document and its active version verified', async () => {
    const app = await documentStageApplication();
    const { documentId } = await uploadDoc(app.id, 'SALE_DEED');

    const result = await verifyDocument(officer, documentId, { decision: 'VERIFY', remarks: 'Legible' }, META);
    expect(result.status).toBe('VERIFIED');

    const version = await prisma.documentVersion.findFirstOrThrow({
      where: { applicationDocumentId: documentId, isActive: true },
    });
    expect(version.status).toBe('VERIFIED');
  }, 60_000);

  it('refuses to reject without saying why', async () => {
    const app = await documentStageApplication();
    const { documentId } = await uploadDoc(app.id, 'SALE_DEED');

    await expect(
      verifyDocument(officer, documentId, { decision: 'REJECT', remarks: '  ' }, META)
    ).rejects.toThrow(/say what is wrong/i);
  }, 60_000);

  it('takes a complete application back to pending when a document is rejected', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);
    expect(await statusOf(app.id)).toBe('DOCUMENTS_COMPLETED');

    const saleDeed = await prisma.applicationDocument.findFirstOrThrow({
      where: { applicationId: app.id, documentType: { code: 'SALE_DEED' } },
    });

    await verifyDocument(
      officer,
      saleDeed.id,
      { decision: 'REJECT', remarks: 'The last page is missing.' },
      META
    );

    expect(await statusOf(app.id)).toBe('DOCUMENT_UPLOAD_PENDING');

    const event = await prisma.applicationEvent.findFirst({
      where: { applicationId: app.id, type: 'DOCUMENTS_INCOMPLETE' },
    });
    expect(event?.description).toMatch(/sale deed/i);
  }, 60_000);

  it('clears the rejection when a corrected copy is uploaded, keeping the history', async () => {
    const app = await documentStageApplication();
    const { documentId } = await uploadDoc(app.id, 'SALE_DEED');

    await verifyDocument(officer, documentId, { decision: 'REJECT', remarks: 'Unsigned.' }, META);
    await uploadDoc(app.id, 'SALE_DEED');

    const after = await prisma.applicationDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(after.status).toBe('UPLOADED');
    expect(after.verifiedById).toBeNull();
    expect(after.verifyRemarks).toBe('');

    // V1 keeps its own verdict — that is what makes the history readable.
    const versions = await prisma.documentVersion.findMany({
      where: { applicationDocumentId: documentId },
      orderBy: { versionNo: 'asc' },
    });
    expect(versions[0]!.status).toBe('REJECTED');
    expect(versions[1]!.status).toBe('UPLOADED');
  }, 60_000);

  it('refuses to judge a document nothing has been uploaded against', async () => {
    const app = await documentStageApplication();
    const { documentId } = await uploadDoc(app.id, 'SALE_DEED');
    await prisma.documentVersion.deleteMany({ where: { applicationDocumentId: documentId } });

    await expect(
      verifyDocument(officer, documentId, { decision: 'VERIFY', remarks: '' }, META)
    ).rejects.toThrow(/nothing has been uploaded/i);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. §5 — the fee gate. The other Phase 4 exit criterion.
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a fee cannot be raised while a mandatory document is missing', () => {
  it('refuses, and names every outstanding document', async () => {
    const app = await documentStageApplication();

    // Everything but the survey sketch.
    for (const code of MANDATORY.filter((c) => c !== 'SURVEY_SKETCH')) {
      await uploadDoc(app.id, code);
    }

    await expect(generateFee(officer, app.id, META)).rejects.toThrow(
      /until every required document is in/i
    );

    // Nothing was written. A refused demand must leave no trace of a demand.
    expect(await prisma.applicationFee.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await statusOf(app.id)).toBe('DOCUMENT_UPLOAD_PENDING');
  }, 90_000);

  it('refuses when the missing document is one a conditional rule added', async () => {
    const app = await documentStageApplication({ numFloors: 5 });
    await completeDocuments(app.id);

    // Complete for an ordinary building — but this one is five floors, so the
    // structural certificate is demanded too.
    await expect(generateFee(officer, app.id, META)).rejects.toThrow(/required document/i);

    await uploadDoc(app.id, 'STRUCTURAL_STABILITY_CERTIFICATE');
    const demand = await generateFee(officer, app.id, META);
    expect(demand.demandNumber).toMatch(/^DM\/\d{4}\/\d{6}$/);
  }, 90_000);

  it('lets the demand through once the last document is in', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);

    const demand = await generateFee(officer, app.id, META);

    expect(demand.status).toBe('ISSUED');
    expect(await statusOf(app.id)).toBe('FEE_GENERATED');
  }, 90_000);

  it('re-checks inside the transaction, so a rejection mid-flight still blocks', async () => {
    const app = await documentStageApplication();
    await completeDocuments(app.id);

    // Reject a document without going through the service, so the application
    // status still says DOCUMENTS_COMPLETED — exactly the race the second
    // check inside the transaction exists for.
    await prisma.applicationDocument.updateMany({
      where: { applicationId: app.id, documentType: { code: 'PROPERTY_TAX_RECEIPT' } },
      data: { status: 'REJECTED' },
    });

    await expect(generateFee(officer, app.id, META)).rejects.toThrow(/required document/i);
    expect(await statusOf(app.id)).toBe('DOCUMENTS_COMPLETED');
  }, 90_000);

  it('raises the demand when the application type asks for no documents at all', async () => {
    const app = await documentStageApplication();

    // Deactivate every requirement, which is what an application type with no
    // supporting documents looks like to the resolver.
    await prisma.documentRequirement.updateMany({ data: { isActive: false } });
    try {
      const complete = await documentsComplete(app.id);
      expect(complete.required).toBe(0);
      expect(complete.complete).toBe(true);

      const demand = await generateFee(officer, app.id, META);
      expect(demand.status).toBe('ISSUED');
    } finally {
      await prisma.documentRequirement.updateMany({ data: { isActive: true } });
    }
  }, 90_000);
});
