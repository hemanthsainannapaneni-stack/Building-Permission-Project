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
import { getDocuments, uploadDocument, verifyDocument } from '@/server/services/documents';
import { documentRegisterStats, listDocumentRegister } from '@/server/services/documents';
import {
  createDocumentRequirement,
  deleteDocumentRequirement,
  updateDocumentRequirement,
} from '@/server/services/document-admin';
import { documentListQuerySchema } from '@/lib/schemas/documents';
import { createUser } from '@/server/services/users';
import { ROLES } from '@/lib/constants';

/**
 * The cross-application document register, and the claim the admin screens
 * exist to make good on.
 *
 * The Documents TAB answers "what does this application still need". This
 * answers the officer's question instead — "what is waiting for me across
 * every file I am responsible for". Two different queries over the same rows,
 * and the scope rules have to hold on both.
 *
 * The last section is the one that matters most: a requirement rule is edited
 * through the admin service, and the checklist a REAL application derives
 * changes with it. No migration, no deploy, no code.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

const query = (overrides: Record<string, unknown> = {}) =>
  documentListQuerySchema.parse({ ...overrides });

let ltp: ReturnType<typeof actorFor>;
let otherLtp: ReturnType<typeof actorFor>;
let officer: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let zoneId: string;
const createdRules: string[] = [];

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  const a = await createUser(
    {
      email: 'test-reg-a@example.com',
      name: 'Test Register LTP',
      phone: '9876543220',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-REG-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Register Firm',
    },
    admin,
    META
  );
  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);

  const b = await createUser(
    {
      email: 'test-reg-b@example.com',
      name: 'Test Register Other LTP',
      phone: '9876543221',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-REG-B',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Other Register Firm',
    },
    admin,
    META
  );
  otherLtp = actorFor(b.user.id, b.user.name, [ROLES.LTP]);

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  const tpaUser = await prisma.user.findUniqueOrThrow({ where: { email: 'tpa.demo@example.com' } });
  officer = actorFor(tpaUser.id, tpaUser.name, [ROLES.TPA], { zoneIds: [zoneId] });
}, 60_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
});

afterEach(async () => {
  if (!dbUp) return;
  if (createdRules.length) {
    await prisma.documentRequirement.deleteMany({ where: { id: { in: createdRules } } });
    createdRules.length = 0;
  }
  await cleanupTestApplications([ltp?.id, otherLtp?.id].filter(Boolean) as string[]);
  await clearJobs();
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

async function documentStageApplication(
  actor = ltp,
  overrides: Partial<{ numFloors: number; numBasements: number }> = {}
) {
  const app = await createApplication(actor, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: '', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '123/A', plotNo: '7', plotAreaSqm: 300, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    [
      'development',
      {
        buildingUse: 'DWELLING',
        occupancyType: 'A_RESIDENTIAL',
        buildingSubUse: '',
        structureType: 'RCC',
        numFloors: overrides.numFloors ?? 2,
        numBasements: overrides.numBasements ?? 0,
        numDwellingUnits: 1,
        buildingHeightM: 7.5,
      },
    ],
    ['building', { plotAreaSqm: 300, builtUpAreaSqm: 400, floorAreaSqm: 380, coverageAreaSqm: 180, parkingAreaSqm: 40, setbackFrontM: 3, setbackRearM: 2, setbackLeftM: 1.5, setbackRightM: 1.5 }],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  for (const [step, data] of steps) {
    await saveStep(actor, app.id, { step: step as never, data, partial: false }, META);
  }

  const submitted = await submitApplication(actor, app.id, META);

  await uploadDrawing(
    actor,
    { applicationId: submitted.id, category: 'SITE_PLAN', file: { name: 'site.pdf', type: 'application/pdf', bytes: PDF } },
    META
  );
  await drainJobs();
  await requestScrutiny(actor, submitted.id, META);
  await drainJobs();

  return submitted;
}

async function upload(actor: ReturnType<typeof actorFor>, applicationId: string, code: string) {
  const result = await uploadDocument(
    actor,
    {
      applicationId,
      documentTypeCode: code,
      expiresOn: NEEDS_EXPIRY.has(code) ? FUTURE : null,
      file: { name: `${code.toLowerCase()}.pdf`, type: 'application/pdf', bytes: PDF },
    },
    META
  );
  await drainJobs();
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. What the register shows
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the register', () => {
  it('lists a document with its application beside it', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'SALE_DEED');

    const result = await listDocumentRegister(ltp, query());
    const row = result.data.find((r) => r.applicationId === app.id);

    expect(row).toBeDefined();
    expect(row!.applicationNumber).toBe(app.applicationNumber);
    expect(row!.code).toBe('SALE_DEED');
    expect(row!.status).toBe('UPLOADED');
    expect(row!.versionNo).toBe(1);
    expect(row!.fileName).toContain('sale_deed');
    // The applicant's name is what an officer scans for, not the id.
    expect(row!.applicantName).toBe('Ravi Kumar');
  }, 60_000);

  it('leaves out a requirement nobody has uploaded against', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'SALE_DEED');

    const result = await listDocumentRegister(ltp, query());
    const mine = result.data.filter((r) => r.applicationId === app.id);

    // The checklist has seven mandatory rows; only one has a file. A register
    // of documents is not a register of absences — that is the tab's job.
    expect(mine).toHaveLength(1);
  }, 60_000);

  it('shows one LTP nothing of another LTP’s', async () => {
    const mine = await documentStageApplication(ltp);
    await upload(ltp, mine.id, 'SALE_DEED');

    const theirs = await documentStageApplication(otherLtp);
    await upload(otherLtp, theirs.id, 'SALE_DEED');

    const asOwner = await listDocumentRegister(ltp, query());
    expect(asOwner.data.some((r) => r.applicationId === mine.id)).toBe(true);
    expect(asOwner.data.some((r) => r.applicationId === theirs.id)).toBe(false);

    // And the count is scoped too — a truthful total is the whole point of
    // merging the scope into the query rather than filtering afterwards.
    const asOther = await listDocumentRegister(otherLtp, query());
    expect(asOther.data.some((r) => r.applicationId === theirs.id)).toBe(true);
    expect(asOther.data.some((r) => r.applicationId === mine.id)).toBe(false);
  }, 90_000);

  it('shows a zonal officer the documents in their jurisdiction', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'SALE_DEED');

    const result = await listDocumentRegister(officer, query());
    expect(result.data.some((r) => r.applicationId === app.id)).toBe(true);

    // An officer with no jurisdiction sees nothing, not everything.
    const unzoned = actorFor(officer.id, officer.name, [ROLES.TPA], { zoneIds: [] });
    const empty = await listDocumentRegister(unzoned, query());
    expect(empty.data.some((r) => r.applicationId === app.id)).toBe(false);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Filtering, sorting, paging — all in the database
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('filters', () => {
  it('narrows to documents awaiting a decision', async () => {
    const app = await documentStageApplication();
    const uploaded = await upload(ltp, app.id, 'SALE_DEED');
    await upload(ltp, app.id, 'SURVEY_SKETCH');

    await verifyDocument(officer, uploaded.documentId, { decision: 'VERIFY', remarks: '' }, META);

    const pending = await listDocumentRegister(ltp, query({ bucket: 'pending' }));
    const mine = pending.data.filter((r) => r.applicationId === app.id);
    expect(mine.map((r) => r.code)).toEqual(['SURVEY_SKETCH']);
  }, 60_000);

  it('narrows to rejected', async () => {
    const app = await documentStageApplication();
    const doc = await upload(ltp, app.id, 'SALE_DEED');
    await upload(ltp, app.id, 'SURVEY_SKETCH');

    await verifyDocument(
      officer,
      doc.documentId,
      { decision: 'REJECT', remarks: 'The last page is missing.' },
      META
    );

    const rejected = await listDocumentRegister(ltp, query({ bucket: 'rejected' }));
    const mine = rejected.data.filter((r) => r.applicationId === app.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.code).toBe('SALE_DEED');
    expect(mine[0]!.verifyRemarks).toMatch(/last page/i);
  }, 60_000);

  it('finds a certificate that is about to lapse, but not one already expired', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'ENCUMBRANCE_CERTIFICATE');

    // Ten days out: still valid, but not for long.
    await prisma.documentVersion.updateMany({
      where: { document: { applicationId: app.id, documentType: { code: 'ENCUMBRANCE_CERTIFICATE' } } },
      data: { expiresOn: new Date(Date.now() + 10 * 86_400_000) },
    });

    const soon = await listDocumentRegister(ltp, query({ bucket: 'expiring' }));
    expect(soon.data.some((r) => r.applicationId === app.id)).toBe(true);

    // Already expired is a different problem, and shows on the application
    // itself as an unsatisfied requirement.
    await prisma.documentVersion.updateMany({
      where: { document: { applicationId: app.id, documentType: { code: 'ENCUMBRANCE_CERTIFICATE' } } },
      data: { expiresOn: new Date(Date.now() - 86_400_000) },
    });

    const after = await listDocumentRegister(ltp, query({ bucket: 'expiring' }));
    expect(after.data.some((r) => r.applicationId === app.id)).toBe(false);

    const all = await listDocumentRegister(ltp, query());
    const row = all.data.find((r) => r.applicationId === app.id);
    expect(row!.expired).toBe(true);
    expect(row!.satisfied).toBe(false);
  }, 60_000);

  it('searches over the application number, the applicant and the document', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'SALE_DEED');

    for (const term of [app.applicationNumber, 'Ravi', 'Sale Deed']) {
      const result = await listDocumentRegister(ltp, query({ q: term }));
      expect(result.data.some((r) => r.applicationId === app.id), term).toBe(true);
    }

    const miss = await listDocumentRegister(ltp, query({ q: 'nothing-matches-this' }));
    expect(miss.data.some((r) => r.applicationId === app.id)).toBe(false);
  }, 60_000);

  it('filters by document type', async () => {
    const app = await documentStageApplication();
    await upload(ltp, app.id, 'SALE_DEED');
    await upload(ltp, app.id, 'SURVEY_SKETCH');

    const saleDeed = await prisma.documentType.findFirstOrThrow({ where: { code: 'SALE_DEED' } });
    const result = await listDocumentRegister(ltp, query({ documentTypeId: saleDeed.id }));
    const mine = result.data.filter((r) => r.applicationId === app.id);

    expect(mine).toHaveLength(1);
    expect(mine[0]!.code).toBe('SALE_DEED');
  }, 60_000);

  it('refuses to sort by a column that is not on the allow-list', () => {
    // The value reaches `orderBy`. Accepting an arbitrary column name from a
    // query string is how a list endpoint starts leaking its table shape.
    expect(() => query({ sort: 'verifyRemarks' })).toThrow();
    expect(() => query({ sort: 'status' })).not.toThrow();
  });

  it('keeps every value of a repeated status filter', () => {
    const params = new URLSearchParams();
    params.append('status', 'UPLOADED');
    params.append('status', 'REJECTED');

    // Object.fromEntries would keep only the last — the Phase 2 bug.
    const parsed = documentListQuerySchema.parse({ status: params.getAll('status') });
    expect(parsed.status).toEqual(['UPLOADED', 'REJECTED']);
  });

  it('pages, and reports a total that matches the filter', async () => {
    const app = await documentStageApplication();
    for (const code of ['SALE_DEED', 'SURVEY_SKETCH', 'PROPERTY_TAX_RECEIPT']) {
      await upload(ltp, app.id, code);
    }

    const first = await listDocumentRegister(ltp, query({ pageSize: 2, page: 1 }));
    expect(first.data.length).toBeLessThanOrEqual(2);
    expect(first.totalPages).toBe(Math.max(1, Math.ceil(first.total / 2)));
    expect(first.total).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe.runIf(dbUp)('the header counts', () => {
  it('agree with the lists they link to', async () => {
    const app = await documentStageApplication();
    const doc = await upload(ltp, app.id, 'SALE_DEED');
    await upload(ltp, app.id, 'SURVEY_SKETCH');
    await verifyDocument(officer, doc.documentId, { decision: 'REJECT', remarks: 'Unsigned.' }, META);

    const [stats, pending, rejected] = await Promise.all([
      documentRegisterStats(ltp),
      listDocumentRegister(ltp, query({ bucket: 'pending', pageSize: 100 })),
      listDocumentRegister(ltp, query({ bucket: 'rejected', pageSize: 100 })),
    ]);

    // A tile that disagrees with the list it links to is worse than no tile.
    expect(stats.pending).toBe(pending.total);
    expect(stats.rejected).toBe(rejected.total);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The claim: a rule is configuration, not code
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('editing a rule changes what applications ask for', () => {
  it('lowers a threshold and a live application starts demanding the document', async () => {
    // Three floors: below the seeded threshold of four, so no certificate.
    const app = await documentStageApplication(ltp, { numFloors: 3 });

    const before = await getDocuments(ltp, app.id);
    expect(before.entries.filter((e) => e.isRequired).map((e) => e.code)).not.toContain(
      'STRUCTURAL_STABILITY_CERTIFICATE'
    );

    const rule = await prisma.documentRequirement.findFirstOrThrow({
      where: { documentType: { code: 'STRUCTURAL_STABILITY_CERTIFICATE' }, isActive: true },
    });
    const original = rule.condition;

    try {
      // The department lowers the threshold — through the admin service, the
      // way the screen does it. No migration. No deploy.
      await updateDocumentRequirement(
        rule.id,
        { condition: { gte: ['building.numFloors', 3] } },
        admin,
        META
      );

      const after = await getDocuments(ltp, app.id);
      const entry = after.entries.find((e) => e.code === 'STRUCTURAL_STABILITY_CERTIFICATE');

      expect(entry?.isRequired).toBe(true);
      expect(entry?.isMandatory).toBe(true);
      // And the applicant is told why, in the new terms.
      expect(entry?.whyRequired).toBe('the number of floors is at least 3');
      expect(after.missing.map((m) => m.code)).toContain('STRUCTURAL_STABILITY_CERTIFICATE');
    } finally {
      await prisma.documentRequirement.update({
        where: { id: rule.id },
        data: { condition: original as never },
      });
    }
  }, 90_000);

  it('adds a new rule and it appears on the checklist immediately', async () => {
    const app = await documentStageApplication();

    const soilTest = await prisma.documentType.findFirstOrThrow({
      where: { code: 'SOIL_TEST_REPORT' },
    });

    const before = await getDocuments(ltp, app.id);
    expect(before.entries.filter((e) => e.isRequired).map((e) => e.code)).not.toContain(
      'SOIL_TEST_REPORT'
    );

    const rule = await createDocumentRequirement(
      {
        documentTypeId: soilTest.id,
        applicationTypeId: null,
        buildingUse: '',
        landUseZone: '',
        isMandatory: true,
        // Unconditional, so it applies to this application straight away.
        condition: {},
        displayOrder: 950,
        helpText: 'Added by an administrator.',
        isActive: true,
      },
      admin,
      META
    );
    createdRules.push(rule.id);

    const after = await getDocuments(ltp, app.id);
    const entry = after.entries.find((e) => e.code === 'SOIL_TEST_REPORT');
    expect(entry?.isRequired).toBe(true);
    expect(entry?.helpText).toBe('Added by an administrator.');
  }, 90_000);

  it('deactivating a rule stops the document being demanded', async () => {
    const app = await documentStageApplication();

    const rule = await prisma.documentRequirement.findFirstOrThrow({
      where: { documentType: { code: 'SALE_DEED' }, isActive: true },
    });

    try {
      await updateDocumentRequirement(rule.id, { isActive: false }, admin, META);

      const after = await getDocuments(ltp, app.id);
      expect(after.missing.map((m) => m.code)).not.toContain('SALE_DEED');
      // Six mandatory rows left of the original seven.
      expect(after.summary.required).toBe(6);
    } finally {
      await updateDocumentRequirement(rule.id, { isActive: true }, admin, META);
    }
  }, 90_000);

  it('a rule the evaluator cannot read is refused, not stored', async () => {
    const soilTest = await prisma.documentType.findFirstOrThrow({
      where: { code: 'SOIL_TEST_REPORT' },
    });

    // The schema is the gate the API uses; the service takes an already-parsed
    // condition. This is the shape an administrator's typo arrives in.
    const { documentRequirementSchema } = await import('@/lib/schemas/document-admin');

    const parsed = documentRequirementSchema.safeParse({
      documentTypeId: soilTest.id,
      applicationTypeId: '',
      isMandatory: true,
      condition: '{ "greaterThan": ["building.numFloors", 4] }',
      displayOrder: 960,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toMatch(/not a condition operator/i);
    }
  }, 30_000);

  it('deleting a rule removes the demand but keeps what was uploaded', async () => {
    const app = await documentStageApplication();

    const soilTest = await prisma.documentType.findFirstOrThrow({
      where: { code: 'SOIL_TEST_REPORT' },
    });

    const rule = await createDocumentRequirement(
      { documentTypeId: soilTest.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 951, helpText: '', isActive: true },
      admin,
      META
    );

    await upload(ltp, app.id, 'SOIL_TEST_REPORT');
    await deleteDocumentRequirement(rule.id, admin, META);

    const after = await getDocuments(ltp, app.id);
    const entry = after.entries.find((e) => e.code === 'SOIL_TEST_REPORT');

    // No longer demanded — but the file the applicant uploaded is still there,
    // still downloadable, marked as no longer required.
    expect(entry).toBeDefined();
    expect(entry!.isRequired).toBe(false);
    expect(entry!.documentId).not.toBeNull();
    expect(after.missing.map((m) => m.code)).not.toContain('SOIL_TEST_REPORT');
  }, 90_000);
});
