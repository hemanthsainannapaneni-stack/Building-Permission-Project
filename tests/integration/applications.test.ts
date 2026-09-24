import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  prisma,
  databaseAvailable,
  cleanupTestUsers,
  cleanupTestApplications,
  actorFor,
  META,
} from './setup';
import {
  createApplication,
  saveStep,
  submitApplication,
  deleteDraft,
  getApplication,
  getWizardState,
  getTimeline,
  listApplications,
  getDashboardStats,
} from '@/server/services/applications';
import { createUser } from '@/server/services/users';
import { ROLES } from '@/lib/constants';
import type { ApplicationListQuery } from '@/lib/schemas/applications';

/**
 * Phase 2 — LTP application management, against the real database.
 *
 * The suite is organised around the properties that must hold rather than
 * around the functions that implement them. The two that matter most:
 *
 *   · An LTP can reach their own applications and NOTHING else. Every read
 *     path is tested from a second LTP's point of view, because a scope bug
 *     that only leaks through one of six endpoints is still a leak.
 *
 *   · An application number is unique and gap-free under concurrency. That is
 *     asserted by actually running concurrent creates, not by reading the SQL.
 */

const dbUp = await databaseAvailable();

let ltp: ReturnType<typeof actorFor>;
let otherLtp: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let layoutTypeId: string;
let zoneId: string;
let zoneBId: string;

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  // Two LTPs, so "only their own" is testable rather than assumed.
  const a = await createUser(
    {
      email: 'test-ltp-a@example.com',
      name: 'Test LTP A',
      phone: '9876543210',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-LIC-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Test Firm A',
    },
    admin,
    META
  );

  const b = await createUser(
    {
      email: 'test-ltp-b@example.com',
      name: 'Test LTP B',
      phone: '9876543211',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-LIC-B',
      ltpLicenceClass: 'CLASS_II',
      firmName: 'Test Firm B',
    },
    admin,
    META
  );

  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);
  otherLtp = actorFor(b.user.id, b.user.name, [ROLES.LTP]);

  const [residential, layout] = await Promise.all([
    prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } }),
    prisma.applicationType.findFirstOrThrow({ where: { code: 'LAYOUT_APPROVAL' } }),
  ]);
  typeId = residential.id;
  layoutTypeId = layout.id;

  const zones = await prisma.zone.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  zoneId = zones[0]!.id;
  zoneBId = zones[1]!.id;
}, 60_000);

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id, otherLtp?.id].filter(Boolean) as string[]);
});

afterAll(async () => {
  if (dbUp) await cleanupTestUsers();
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const STEP_DATA = {
  applicant: {
    name: 'Ravi Kumar',
    fatherName: 'Suresh Kumar',
    email: 'ravi@example.com',
    phone: '9876543210',
    aadhaarLast4: '1234',
    panMasked: 'ABCDE1234F',
    address: '12 Main Road, Banjara Hills, Hyderabad',
  },
  owner: { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' },
  property: {
    district: 'Hyderabad',
    mandal: 'Shaikpet',
    village: 'Banjara Hills',
    localityName: 'Road No 12',
    wardNo: '8',
  },
  location: {
    doorNo: '8-2-120',
    streetName: 'Road No 12',
    pincode: '500034',
    boundaryNorth: 'Plot 6',
    boundarySouth: 'Plot 8',
    boundaryEast: 'Road No 12',
    boundaryWest: 'Open land',
  },
  survey: {
    surveyNumbers: '123/A, 123/B',
    plotNo: '7',
    layoutName: 'Jubilee Enclave',
    lpNumber: 'LP/2019/44',
    plotAreaSqm: 300,
    roadWidthM: 9,
    landUseZone: 'RESIDENTIAL',
    tenureType: 'FREEHOLD',
  },
  development: {
    buildingUse: 'DWELLING',
    buildingSubUse: '',
    occupancyType: 'A_RESIDENTIAL',
    structureType: 'RCC',
    numFloors: 2,
    numBasements: 0,
    numDwellingUnits: 1,
    buildingHeightM: 7.5,
  },
  building: {
    plotAreaSqm: 300,
    builtUpAreaSqm: 400,
    floorAreaSqm: 380,
    coverageAreaSqm: 180,
    parkingAreaSqm: 40,
    setbackFrontM: 3,
    setbackRearM: 2,
    setbackLeftM: 1.5,
    setbackRightM: 1.5,
  },
  ltp: { declarationAccepted: true, remarks: 'Filed under Class-I licence.' },
} as const;

/** Every step, in order, so an application reaches a fileable state. */
async function completeAllSteps(
  actor: ReturnType<typeof actorFor>,
  id: string,
  zone: string = zoneId
) {
  for (const step of [
    'applicant',
    'owner',
    'property',
    'location',
    'survey',
    'development',
    'building',
    'ltp',
  ] as const) {
    const data =
      step === 'location' ? { ...STEP_DATA.location, zoneId: zone } : STEP_DATA[step];
    await saveStep(actor, id, { step, data, partial: false }, META);
  }
}

const listQuery = (overrides: Partial<ApplicationListQuery> = {}): ApplicationListQuery => ({
  q: undefined,
  status: undefined,
  applicationTypeId: undefined,
  zoneId: undefined,
  bucket: undefined,
  from: undefined,
  to: undefined,
  sort: 'updatedAt',
  dir: 'desc',
  page: 1,
  pageSize: 50,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Creation
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('createApplication', () => {
  it('creates a draft owned by the signed-in LTP', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    expect(app.status).toBe('DRAFT');
    expect(app.ltpUserId).toBe(ltp.id);
    expect(app.submittedAt).toBeNull();
  });

  it('issues an application number in the configured format', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // {prefix}/{year}/{seq:6}
    expect(app.applicationNumber).toMatch(/^BP\/\d{4}\/\d{6}$/);
    expect(app.applicationNumber).toContain(`/${new Date().getFullYear()}/`);
  });

  it('takes the prefix from the application type, so series do not collide', async () => {
    const building = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const layout = await createApplication(ltp, { applicationTypeId: layoutTypeId }, META);

    expect(building.applicationNumber.startsWith('BP/')).toBe(true);
    expect(layout.applicationNumber.startsWith('LP/')).toBe(true);
  });

  it('creates the child rows the wizard writes into', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, property: true, building: true, draft: true },
    });

    expect(row.applicant).not.toBeNull();
    expect(row.property).not.toBeNull();
    expect(row.building).not.toBeNull();
    expect(row.draft).not.toBeNull();
    expect(row.draft!.currentStep).toBe(0);
    expect(row.draft!.completedSteps).toEqual([]);
  });

  it('accepts the first step with the creation request', async () => {
    const app = await createApplication(
      ltp,
      { applicationTypeId: typeId, applicant: STEP_DATA.applicant },
      META
    );

    expect(app.applicant?.name).toBe('Ravi Kumar');

    const draft = await prisma.applicationDraft.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(draft.completedSteps).toContain('applicant');
    expect(draft.currentStep).toBe(1);
  });

  it('records a timeline event and an audit row', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const events = await prisma.applicationEvent.findMany({ where: { applicationId: app.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('APPLICATION_CREATED');
    expect(events[0]!.sequence).toBe(1);
    expect(events[0]!.actorId).toBe(ltp.id);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'Application', entityId: app.id, action: 'APPLICATION_CREATED' },
    });
    expect(audits).toHaveLength(1);
  });

  it('emits an outbox event inside the same transaction', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const outbox = await prisma.outboxEvent.findMany({ where: { applicationId: app.id } });
    expect(outbox.some((e) => e.eventCode === 'APPLICATION_CREATED')).toBe(true);
  });

  it('refuses an application type that does not exist', async () => {
    await expect(
      createApplication(ltp, { applicationTypeId: '00000000-0000-0000-0000-000000000000' }, META)
    ).rejects.toThrow(/application type/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Application number uniqueness
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('application number allocation', () => {
  it('never issues the same number twice under concurrency', async () => {
    // The read-modify-write this replaced would hand several of these the same
    // value. Twenty in parallel is enough to surface that reliably.
    const apps = await Promise.all(
      Array.from({ length: 20 }, () =>
        createApplication(ltp, { applicationTypeId: typeId }, META)
      )
    );

    const numbers = apps.map((a) => a.applicationNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  }, 60_000);

  it('allocates gap-free, so the register accounts for every number', async () => {
    const apps = await Promise.all(
      Array.from({ length: 10 }, () =>
        createApplication(ltp, { applicationTypeId: typeId }, META)
      )
    );

    const sequences = apps
      .map((a) => Number(a.applicationNumber.split('/')[2]))
      .sort((x, y) => x - y);

    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe(sequences[i - 1]! + 1);
    }
  }, 60_000);

  it('keeps each application type on its own counter', async () => {
    const [building, layout] = await Promise.all([
      createApplication(ltp, { applicationTypeId: typeId }, META),
      createApplication(ltp, { applicationTypeId: layoutTypeId }, META),
    ]);

    const year = new Date().getFullYear();
    const scopes = await prisma.numberSequence.findMany({
      where: { scope: { in: [`application:BP:${year}`, `application:LP:${year}`] } },
    });

    expect(scopes).toHaveLength(2);
    expect(building.applicationNumber).not.toBe(layout.applicationNumber);
  });

  it('is backed by a unique index, so a duplicate cannot be inserted at all', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(
      prisma.application.create({
        data: {
          applicationNumber: app.applicationNumber,
          applicationTypeId: typeId,
          ltpUserId: ltp.id,
        },
      })
    ).rejects.toThrow();
  });

  // ── The identifier split ─────────────────────────────────────────────
  //
  // Two identifiers, deliberately. The PRIMARY KEY is an opaque UUID and is
  // what every URL, foreign key and API path uses. The APPLICATION NUMBER is
  // the human reference printed on correspondence — sequential, and therefore
  // guessable, which is exactly why it must never be an access key.

  it('keys the row on an opaque UUID, not the application number', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    expect(app.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(app.id).not.toBe(app.applicationNumber);
    expect(app.id).not.toContain(app.applicationNumber);
    expect(app.applicationNumber).not.toContain(app.id);
  });

  it('cannot be fetched by application number, only by id', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // The number is sequential, so if it were an access key an attacker could
    // walk the register by counting. Every read path takes the UUID.
    await expect(getApplication(ltp, app.applicationNumber)).rejects.toThrow(
      /could not be found/i
    );
  });

  it("does not expose another LTP's application through its number", async () => {
    const mine = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // Guessing BP/2026/000042 must not be a way in, by id or by search.
    await expect(getApplication(otherLtp, mine.applicationNumber)).rejects.toThrow(
      /could not be found/i
    );
    const searched = await listApplications(otherLtp, listQuery({ q: mine.applicationNumber }));
    expect(searched.total).toBe(0);
  });

  it('renders the number from the configured format, not a hard-coded one', async () => {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'application_number_format' },
    });

    // The format is administrator-configurable, which is why the generator
    // reads it rather than concatenating a fixed string.
    expect(setting).not.toBeNull();
    expect(setting!.value).toBe('{prefix}/{year}/{seq:6}');

    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const [prefix, year, seq] = app.applicationNumber.split('/');
    expect(prefix).toBe('BP');
    expect(year).toBe(String(new Date().getFullYear()));
    expect(seq).toMatch(/^\d{6}$/);
  });

  it('advances each type on its own counter, so the series never interleave', async () => {
    // BP/2026/000001 and LP/2026/000001 must be able to coexist — that is the
    // point of scoping the counter per prefix.
    //
    // Asserted by watching each counter move INDEPENDENTLY rather than by
    // resetting them to zero: the sequences are shared state, and a test that
    // rewinds them makes every other test in the file order-dependent.
    const year = new Date().getFullYear();
    const counterFor = async (prefix: string) =>
      (
        await prisma.numberSequence.findUnique({
          where: { scope: `application:${prefix}:${year}` },
        })
      )?.current ?? 0;

    const [bpBefore, lpBefore] = await Promise.all([counterFor('BP'), counterFor('LP')]);

    const building = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const layout = await createApplication(ltp, { applicationTypeId: layoutTypeId }, META);

    // Each advanced by exactly one, and neither disturbed the other.
    expect(await counterFor('BP')).toBe(bpBefore + 1);
    expect(await counterFor('LP')).toBe(lpBefore + 1);

    const pad = (n: number) => String(n).padStart(6, '0');
    expect(building.applicationNumber).toBe(`BP/${year}/${pad(bpBefore + 1)}`);
    expect(layout.applicationNumber).toBe(`LP/${year}/${pad(lpBefore + 1)}`);
  });

  it('keeps the two counters in separate scopes', async () => {
    const year = new Date().getFullYear();
    await createApplication(ltp, { applicationTypeId: typeId }, META);
    await createApplication(ltp, { applicationTypeId: layoutTypeId }, META);

    const scopes = await prisma.numberSequence.findMany({
      where: { scope: { in: [`application:BP:${year}`, `application:LP:${year}`] } },
      select: { scope: true },
    });

    // Two rows, not one — which is what allows the same sequence number to
    // appear under both prefixes.
    expect(scopes).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Draft save
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('saveStep — draft save', () => {
  it('keeps unvalidated values in scratch and out of the real tables', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // Deliberately invalid: no address, and a phone number that is too short.
    await saveStep(
      ltp,
      app.id,
      { step: 'applicant', data: { name: 'Half Typed', phone: '98765' }, partial: true },
      META
    );

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, draft: true },
    });

    // Nothing partial reached the register — and "not answered" is recorded
    // as NULL, never as a stand-in value.
    expect(row.applicant!.name).toBeNull();
    expect(row.applicant!.phone).toBeNull();
    // …but nothing the user typed was lost either.
    const scratch = row.draft!.scratch as Record<string, { name?: string; phone?: string }>;
    expect(scratch.applicant?.name).toBe('Half Typed');
    expect(scratch.applicant?.phone).toBe('98765');
    expect(row.draft!.completedSteps).not.toContain('applicant');
  });

  it('writes no audit row for a partial save', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(
      ltp,
      app.id,
      { step: 'applicant', data: { name: 'Half Typed' }, partial: true },
      META
    );

    const audits = await prisma.auditLog.findMany({
      where: { entityId: app.id, action: 'APPLICATION_UPDATED' },
    });
    expect(audits).toHaveLength(0);
  });

  it('discards scratch once the step validates, so the row supersedes it', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(
      ltp,
      app.id,
      { step: 'applicant', data: { name: 'Half Typed' }, partial: true },
      META
    );
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    const draft = await prisma.applicationDraft.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(draft.scratch).not.toHaveProperty('applicant');
    expect(draft.completedSteps).toContain('applicant');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Draft resume
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('getWizardState — draft resume', () => {
  it('returns the step the user left off at', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'owner', data: STEP_DATA.owner, partial: false }, META);

    const state = await getWizardState(ltp, app.id);

    expect(state.draft.currentStep).toBe(2);
    expect(state.draft.completedSteps).toEqual(['applicant', 'owner']);
  });

  it('rehydrates every step from the persisted rows', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    const state = await getWizardState(ltp, app.id);

    expect(state.steps.applicant).toMatchObject({ name: 'Ravi Kumar', phone: '9876543210' });
    expect(state.steps.survey).toMatchObject({ surveyNumbers: '123/A, 123/B', plotAreaSqm: 300 });
    expect(state.steps.location).toMatchObject({ zoneId, streetName: 'Road No 12' });
  }, 30_000);

  it('surfaces unvalidated scratch alongside the persisted values', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(
      ltp,
      app.id,
      { step: 'property', data: { district: 'Rangareddy', mandal: 'Half' }, partial: true },
      META
    );

    const state = await getWizardState(ltp, app.id);
    expect(state.draft.scratch.property).toMatchObject({ district: 'Rangareddy' });
  });

  it('derives completion from the data, not from what the client claimed', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    // Empty the row behind the wizard's back. `completedSteps` still says the
    // step was done; `completion` must not agree, because it re-validates.
    await prisma.applicant.update({
      where: { applicationId: app.id },
      data: { name: '', address: '', phone: '' },
    });

    const state = await getWizardState(ltp, app.id);
    expect(state.draft.completedSteps).toContain('applicant');
    expect(state.completion.applicant).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Update
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('saveStep — validated update', () => {
  it('writes the step to its real table', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    const applicant = await prisma.applicant.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(applicant.name).toBe('Ravi Kumar');
    expect(applicant.address).toContain('Banjara Hills');
  });

  it('rejects invalid data and writes nothing', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(
      saveStep(
        ltp,
        app.id,
        { step: 'applicant', data: { name: 'X', phone: 'not-a-number', address: '' }, partial: false },
        META
      )
    ).rejects.toThrow();

    const applicant = await prisma.applicant.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(applicant.name).toBeNull();
  });

  it('stores the zone on the application, where authorization reads it', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(
      ltp,
      app.id,
      { step: 'location', data: { ...STEP_DATA.location, zoneId }, partial: false },
      META
    );

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.zoneId).toBe(zoneId);
  });

  it('derives FAR and coverage rather than accepting them', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'survey', data: STEP_DATA.survey, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'building', data: STEP_DATA.building, partial: false }, META);

    const building = await prisma.buildingDetail.findUniqueOrThrow({
      where: { applicationId: app.id },
    });

    // 380 / 300 = 1.2667 ; 180 / 300 = 60%
    expect(building.achievedFar).toBeCloseTo(1.2667, 3);
    expect(building.achievedCoverage).toBeCloseTo(60, 2);
    // Mirrored from the survey step, never re-typed.
    expect(building.plotAreaSqm).toBe(300);
  });

  it('refuses a coverage larger than the plot', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(
      saveStep(
        ltp,
        app.id,
        {
          step: 'building',
          data: { ...STEP_DATA.building, plotAreaSqm: 300, coverageAreaSqm: 400 },
          partial: false,
        },
        META
      )
    ).rejects.toThrow();
  });

  it('takes the licence particulars from the server, not the request', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(
      ltp,
      app.id,
      {
        step: 'ltp',
        // A forged licence number in the payload must be ignored entirely.
        data: { declarationAccepted: true, remarks: 'ok', licenceNo: 'FORGED-999' },
        partial: false,
      },
      META
    );

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    const declaration = row.ltpDeclaration as Record<string, unknown>;

    expect(row.ltpDeclaredAt).not.toBeNull();
    expect(declaration.licenceNo).toBe('TEST-LIC-A');
    expect(declaration.licenceNo).not.toBe('FORGED-999');
    expect(declaration.licenceClass).toBe('CLASS_I');
  });

  it('clears the owner columns when the owner is the applicant', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(
      ltp,
      app.id,
      {
        step: 'owner',
        data: {
          ownerSameAsApplicant: false,
          ownerName: 'Someone Else',
          ownerPhone: '9876500000',
          ownerAddress: '9 Other Street, Hyderabad',
        },
        partial: false,
      },
      META
    );
    await saveStep(ltp, app.id, { step: 'owner', data: STEP_DATA.owner, partial: false }, META);

    const applicant = await prisma.applicant.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(applicant.ownerSameAsApplicant).toBe(true);
    expect(applicant.ownerName).toBe('');
  });

  it('records an audit row with before and after', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: app.id, action: 'APPLICATION_UPDATED' },
    });

    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(ltp.id);
    expect((audit!.after as Record<string, unknown>).step).toBe('applicant');
  });

  it('adds a timeline event on first completion, and not on a re-save', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    const updates = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'APPLICATION_UPDATED' },
    });
    expect(updates).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Submission
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('submitApplication', () => {
  it('files a complete application', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    const filed = await submitApplication(ltp, app.id, META);

    expect(filed.status).toBe('SUBMITTED');
    expect(filed.submittedAt).not.toBeNull();
  }, 30_000);

  it('refuses an incomplete application and names every missing field', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    await expect(submitApplication(ltp, app.id, META)).rejects.toMatchObject({
      status: 422,
      code: 'BUSINESS_RULE',
    });

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('DRAFT');
  });

  it('does not trust completedSteps — completeness is re-derived', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // Claim every step is done without filling any of them in.
    await prisma.applicationDraft.update({
      where: { applicationId: app.id },
      data: {
        completedSteps: [
          'applicant',
          'owner',
          'property',
          'location',
          'survey',
          'development',
          'building',
          'ltp',
        ],
        currentStep: 9,
      },
    });

    await expect(submitApplication(ltp, app.id, META)).rejects.toThrow(/not complete/i);
  });

  it('requires the LTP declaration', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    // Withdraw the declaration behind the wizard's back.
    await prisma.application.update({
      where: { id: app.id },
      data: { ltpDeclaredAt: null },
    });

    const error = await submitApplication(ltp, app.id, META).catch((e) => e);

    expect(error.status).toBe(422);
    // The summary is generic; the detail names the field, which is what the
    // review screen points at.
    expect(error.details).toContainEqual(
      expect.objectContaining({ path: 'ltp.declarationAccepted' })
    );
    expect(error.details.some((d: { message: string }) => /declaration/i.test(d.message))).toBe(
      true
    );

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('DRAFT');
  }, 30_000);

  it('removes the wizard state once filed', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    const draft = await prisma.applicationDraft.findUnique({ where: { applicationId: app.id } });
    expect(draft).toBeNull();
  }, 30_000);

  it('records the submission on the timeline and in the audit trail', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'APPLICATION_SUBMITTED' },
    });
    expect(events).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: app.id, action: 'APPLICATION_SUBMITTED' },
    });
    expect(audit).not.toBeNull();
  }, 30_000);

  it('cannot be filed twice', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    await expect(submitApplication(ltp, app.id, META)).rejects.toThrow(/no longer be edited|already/i);
  }, 30_000);

  it('locks the application against further edits', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    await expect(
      saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META)
    ).rejects.toThrow(/no longer be edited/i);
  }, 30_000);

  it('survives two concurrent submissions without filing twice', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    const results = await Promise.allSettled([
      submitApplication(ltp, app.id, META),
      submitApplication(ltp, app.id, META),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'APPLICATION_SUBMITTED' },
    });
    expect(events).toHaveLength(1);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6b. Draft lifecycle — DRAFT ≠ SUBMITTED
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The rule this suite exists to hold down.
 *
 *   DRAFT     — incomplete is legal. The LTP fills the form over days, leaves,
 *               comes back. Nothing is required except that the row exists.
 *   SUBMITTED — every mandatory field is present and valid, checked against
 *               the persisted rows, with field-level reasons when it is not.
 *
 * And the modelling rule underneath it: a field the LTP has not answered is
 * NULL. It is never a stand-in value invented to satisfy a NOT NULL — a plot
 * of 0 m² is a false claim, not an unmeasured plot, and nothing downstream
 * could tell the two apart afterwards.
 */
describe.runIf(dbUp)('draft lifecycle', () => {
  // ── 1. Empty draft ───────────────────────────────────────────────────
  it('creates an empty draft with every mandatory field unanswered', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, property: true, building: true, draft: true },
    });

    expect(row.status).toBe('DRAFT');

    // NULL, not '' or 0. "Not answered" is recorded as absence.
    expect(row.applicant!.name).toBeNull();
    expect(row.applicant!.phone).toBeNull();
    expect(row.property!.district).toBeNull();
    expect(row.property!.surveyNumbers).toBeNull();
    expect(row.property!.plotAreaSqm).toBeNull();
    expect(row.building!.plotAreaSqm).toBeNull();
    expect(row.building!.builtUpAreaSqm).toBeNull();

    // Genuinely optional fields keep their defaults — those ARE answers.
    expect(row.property!.mandal).toBe('');
    expect(row.building!.numBasements).toBe(0);
  });

  it('an empty draft is saved, listed and resumable', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const list = await listApplications(ltp, listQuery());
    expect(list.data.map((r) => r.id)).toContain(app.id);

    const state = await getWizardState(ltp, app.id);
    expect(state.draft.currentStep).toBe(0);
    expect(state.draft.completedSteps).toEqual([]);
  });

  it('an empty draft cannot be submitted, and says why for every step', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const error = await submitApplication(ltp, app.id, META).catch((e) => e);

    expect(error.status).toBe(422);

    // One reason per offending step, each pathed so the review screen can
    // point at the step AND the field.
    const steps = new Set(error.details.map((d: { path: string }) => d.path.split('.')[0]));
    for (const step of ['applicant', 'property', 'location', 'survey', 'development', 'building', 'ltp']) {
      expect(steps, `expected a reason for "${step}"`).toContain(step);
    }
  });

  // ── 2. Partially completed draft ─────────────────────────────────────
  it('saves a partially completed draft without inventing the rest', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'property', data: STEP_DATA.property, partial: false }, META);

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, property: true, building: true },
    });

    // What was answered is stored…
    expect(row.applicant!.name).toBe('Ravi Kumar');
    expect(row.property!.district).toBe('Hyderabad');
    // …and what was not stays absent, rather than becoming a placeholder.
    expect(row.property!.surveyNumbers).toBeNull();
    expect(row.property!.plotAreaSqm).toBeNull();
    expect(row.building!.builtUpAreaSqm).toBeNull();
    expect(row.status).toBe('DRAFT');
  });

  it('accepts an unvalidated half-filled step without touching the register', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // A phone number mid-typing. This must not be rejected — the whole point
    // of Save draft is that it always works.
    await saveStep(
      ltp,
      app.id,
      { step: 'applicant', data: { name: 'Ravi', phone: '98765' }, partial: true },
      META
    );

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, draft: true },
    });

    expect(row.applicant!.name).toBeNull();
    expect(row.applicant!.phone).toBeNull();
    expect((row.draft!.scratch as Record<string, unknown>).applicant).toMatchObject({
      name: 'Ravi',
      phone: '98765',
    });
  });

  it('a partially completed draft still cannot be submitted', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'owner', data: STEP_DATA.owner, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'property', data: STEP_DATA.property, partial: false }, META);

    const error = await submitApplication(ltp, app.id, META).catch((e) => e);
    expect(error.status).toBe(422);

    const steps = new Set(error.details.map((d: { path: string }) => d.path.split('.')[0]));
    // The finished steps are not complained about…
    expect(steps).not.toContain('applicant');
    expect(steps).not.toContain('property');
    // …the unfinished ones are.
    expect(steps).toContain('survey');
    expect(steps).toContain('ltp');
  });

  // ── 3. Resume ────────────────────────────────────────────────────────
  it('resumes exactly where the LTP left off, days later', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'owner', data: STEP_DATA.owner, partial: false }, META);
    await saveStep(
      ltp,
      app.id,
      { step: 'property', data: { district: 'Rangar' }, partial: true },
      META
    );

    // A brand-new request, as if from a different browser on another day.
    const resumed = await getWizardState(ltp, app.id);

    expect(resumed.draft.currentStep).toBe(2);
    expect(resumed.draft.completedSteps).toEqual(['applicant', 'owner']);
    // Validated work comes back from the real tables…
    expect(resumed.steps.applicant).toMatchObject({ name: 'Ravi Kumar' });
    // …and the half-typed step comes back from scratch.
    expect(resumed.draft.scratch.property).toMatchObject({ district: 'Rangar' });
  });

  it('resumes an untouched draft at step zero rather than erroring', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const resumed = await getWizardState(ltp, app.id);

    expect(resumed.draft.currentStep).toBe(0);
    expect(resumed.completion.applicant).toBe(false);
    expect(resumed.problems.length).toBeGreaterThan(0);
  });

  it('reports an unanswered area as absent, not as zero, when resuming', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const resumed = await getWizardState(ltp, app.id);

    // '' renders an empty input; 0 would show a number nobody typed.
    expect(resumed.steps.survey).toMatchObject({ plotAreaSqm: '' });
    expect(resumed.steps.building).toMatchObject({ builtUpAreaSqm: '' });
  });

  // ── 4. Invalid submission ────────────────────────────────────────────
  it('refuses submission when one mandatory field is missing, naming it', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    // Remove exactly one mandatory value behind the wizard's back.
    await prisma.propertyDetail.update({
      where: { applicationId: app.id },
      data: { plotAreaSqm: null },
    });

    const error = await submitApplication(ltp, app.id, META).catch((e) => e);

    expect(error.status).toBe(422);
    expect(error.details).toContainEqual(
      expect.objectContaining({ path: 'survey.plotAreaSqm' })
    );
    expect(error.details.some((d: { message: string }) => /plot area/i.test(d.message))).toBe(true);

    // And nothing moved.
    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('DRAFT');
    expect(row.submittedAt).toBeNull();
  }, 30_000);

  it('refuses a zero plot area as firmly as a missing one', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    await prisma.propertyDetail.update({
      where: { applicationId: app.id },
      data: { plotAreaSqm: 0 },
    });

    const error = await submitApplication(ltp, app.id, META).catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.details).toContainEqual(expect.objectContaining({ path: 'survey.plotAreaSqm' }));
  }, 30_000);

  it('rejects an invalid step outright rather than storing it', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(
      saveStep(
        ltp,
        app.id,
        { step: 'survey', data: { ...STEP_DATA.survey, plotAreaSqm: -5 }, partial: false },
        META
      )
    ).rejects.toThrow();

    const property = await prisma.propertyDetail.findUniqueOrThrow({
      where: { applicationId: app.id },
    });
    expect(property.plotAreaSqm).toBeNull();
  });

  // ── 5. Valid submission ──────────────────────────────────────────────
  it('files a complete application and locks it', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    const before = await getWizardState(ltp, app.id);
    expect(before.problems).toEqual([]);
    expect(Object.values(before.completion).every(Boolean)).toBe(true);

    const filed = await submitApplication(ltp, app.id, META);

    expect(filed.status).toBe('SUBMITTED');
    expect(filed.submittedAt).not.toBeNull();

    // Every mandatory value is present on the filed record — no nulls survived.
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { applicant: true, property: true, building: true },
    });
    expect(row.applicant!.name).toBe('Ravi Kumar');
    expect(row.applicant!.phone).toBe('9876543210');
    expect(row.property!.district).toBe('Hyderabad');
    expect(row.property!.surveyNumbers).toBe('123/A, 123/B');
    expect(row.property!.plotAreaSqm).toBe(300);
    expect(row.building!.builtUpAreaSqm).toBe(400);
    expect(row.ltpDeclaredAt).not.toBeNull();

    // And the draft endpoints are closed to it.
    await expect(
      saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META)
    ).rejects.toThrow(/no longer be edited/i);
    await expect(
      saveStep(ltp, app.id, { step: 'applicant', data: { name: 'x' }, partial: true }, META)
    ).rejects.toThrow(/no longer be edited/i);
  }, 30_000);

  it('a submitted application is gone from the wizard entirely', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    await expect(getWizardState(ltp, app.id)).rejects.toThrow(/no longer be edited/i);
    // But it is still readable — an LTP must be able to see what they filed.
    const readable = await getApplication(ltp, app.id);
    expect(readable.status).toBe('SUBMITTED');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Access control
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('access control', () => {
  it("does not let an LTP read another LTP's application", async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(getApplication(otherLtp, app.id)).rejects.toThrow(/could not be found/i);
  });

  it('reports a forbidden application exactly as a missing one', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    // Same message and status for both, so the endpoint cannot be used to
    // discover which application ids are real.
    const forbidden = await getApplication(otherLtp, app.id).catch((e) => e);
    const missing = await getApplication(
      otherLtp,
      '00000000-0000-0000-0000-000000000000'
    ).catch((e) => e);

    expect(forbidden.status).toBe(missing.status);
    expect(forbidden.message).toBe(missing.message);
  });

  it("does not let an LTP edit another LTP's application", async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(
      saveStep(otherLtp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META)
    ).rejects.toThrow(/could not be found/i);
  });

  it("does not let an LTP submit another LTP's application", async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);

    await expect(submitApplication(otherLtp, app.id, META)).rejects.toThrow(/could not be found/i);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('DRAFT');
  }, 30_000);

  it("does not let an LTP delete another LTP's draft", async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(deleteDraft(otherLtp, app.id, META)).rejects.toThrow(/could not be found/i);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.deletedAt).toBeNull();
  });

  it("does not let an LTP read another LTP's timeline", async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await expect(getTimeline(otherLtp, app.id)).rejects.toThrow(/could not be found/i);
  });

  it("keeps another LTP's applications out of the list entirely", async () => {
    const mine = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await createApplication(otherLtp, { applicationTypeId: typeId }, META);

    const theirs = await listApplications(otherLtp, listQuery());
    expect(theirs.data.some((row) => row.id === mine.id)).toBe(false);

    // Searching for it by number does not find it either — scope is merged
    // into the query, not applied to the result.
    const searched = await listApplications(otherLtp, listQuery({ q: mine.applicationNumber }));
    expect(searched.total).toBe(0);
  });

  it("keeps another LTP's applications out of the dashboard counts", async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    const theirs = await getDashboardStats(otherLtp);
    expect(theirs.counts.total).toBe(0);
  });

  it('lets a system administrator see every application', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const seen = await getApplication(admin, app.id);
    expect(seen.id).toBe(app.id);
  });

  it('treats a malformed id as not found rather than erroring', async () => {
    await expect(getApplication(ltp, 'not-a-uuid')).rejects.toThrow(/could not be found/i);
  });

  it('hides a soft-deleted draft from every read path', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await deleteDraft(ltp, app.id, META);

    await expect(getApplication(ltp, app.id)).rejects.toThrow(/could not be found/i);

    const list = await listApplications(ltp, listQuery());
    expect(list.data.some((row) => row.id === app.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. List filtering
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('listApplications', () => {
  it('returns the caller’s own applications', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    const result = await listApplications(ltp, listQuery());
    expect(result.total).toBe(2);
    expect(result.data.every((row) => row.ltp?.id === ltp.id)).toBe(true);
  });

  it('filters by status', async () => {
    const draft = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const filed = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, filed.id);
    await submitApplication(ltp, filed.id, META);

    const drafts = await listApplications(ltp, listQuery({ status: ['DRAFT'] }));
    expect(drafts.data.map((r) => r.id)).toEqual([draft.id]);

    const submitted = await listApplications(ltp, listQuery({ status: ['SUBMITTED'] }));
    expect(submitted.data.map((r) => r.id)).toEqual([filed.id]);
  }, 30_000);

  it('filters by KPI bucket, matching what the dashboard counted', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);
    const filed = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, filed.id);
    await submitApplication(ltp, filed.id, META);

    const stats = await getDashboardStats(ltp);
    const underReview = await listApplications(ltp, listQuery({ bucket: 'underReview' }));

    // The tile and the list it links to must agree — that is the whole point
    // of both reading the bucket definitions.
    expect(underReview.total).toBe(stats.counts.underReview);
    expect(underReview.total).toBe(1);

    const drafts = await listApplications(ltp, listQuery({ bucket: 'draft' }));
    expect(drafts.total).toBe(stats.counts.draft);
  }, 30_000);

  it('rejects a bucket it does not offer', async () => {
    await expect(listApplications(ltp, listQuery({ bucket: 'nonsense' }))).rejects.toThrow(
      /not a filter/i
    );
  });

  it('filters by application type', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);
    const layout = await createApplication(ltp, { applicationTypeId: layoutTypeId }, META);

    const result = await listApplications(ltp, listQuery({ applicationTypeId: layoutTypeId }));
    expect(result.data.map((r) => r.id)).toEqual([layout.id]);
  });

  it('filters by zone', async () => {
    const inZoneA = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const inZoneB = await createApplication(ltp, { applicationTypeId: typeId }, META);

    await saveStep(
      ltp,
      inZoneA.id,
      { step: 'location', data: { ...STEP_DATA.location, zoneId }, partial: false },
      META
    );
    await saveStep(
      ltp,
      inZoneB.id,
      { step: 'location', data: { ...STEP_DATA.location, zoneId: zoneBId }, partial: false },
      META
    );

    const result = await listApplications(ltp, listQuery({ zoneId: zoneBId }));
    expect(result.data.map((r) => r.id)).toEqual([inZoneB.id]);
  });

  it('searches by application number, applicant name and survey number', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'survey', data: STEP_DATA.survey, partial: false }, META);
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    expect((await listApplications(ltp, listQuery({ q: app.applicationNumber }))).total).toBe(1);
    expect((await listApplications(ltp, listQuery({ q: 'ravi' }))).total).toBe(1);
    expect((await listApplications(ltp, listQuery({ q: '123/A' }))).total).toBe(1);
    expect((await listApplications(ltp, listQuery({ q: 'nothing-matches-this' }))).total).toBe(0);
  });

  it('searches case-insensitively', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'applicant', data: STEP_DATA.applicant, partial: false }, META);

    expect((await listApplications(ltp, listQuery({ q: 'RAVI KUMAR' }))).total).toBe(1);
  });

  it('filters by creation date, inclusive of the end day', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    // LOCAL calendar days, deliberately — `toISOString().slice(0, 10)` is the
    // UTC day, which is a different day for most of the world for part of
    // every day, and this assertion would then pass or fail by the hour.
    const localDay = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const today = localDay(new Date());
    const included = await listApplications(ltp, listQuery({ from: today, to: today }));
    expect(included.total).toBe(1);

    const tomorrow = localDay(new Date(Date.now() + 86_400_000));
    const excluded = await listApplications(ltp, listQuery({ from: tomorrow }));
    expect(excluded.total).toBe(0);
  });

  it('treats a date filter as a local day, whatever the UTC offset', async () => {
    // Regression: `from`/`to` were parsed as UTC midnight while the end of the
    // window was computed in local time, so the two ends disagreed and an
    // application could be missing from a filter for its own creation date.
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const created = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    const day = `${created.createdAt.getFullYear()}-${String(created.createdAt.getMonth() + 1).padStart(2, '0')}-${String(created.createdAt.getDate()).padStart(2, '0')}`;

    const result = await listApplications(ltp, listQuery({ from: day, to: day }));
    expect(result.data.map((r) => r.id)).toContain(app.id);
  });

  it('ANDs a bucket with an explicit status rather than merging them', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    // A draft cannot also be under review, so this must return nothing.
    const result = await listApplications(
      ltp,
      listQuery({ bucket: 'underReview', status: ['DRAFT'] })
    );
    expect(result.total).toBe(0);
  });

  it('ignores a status that is not a member of the enum', async () => {
    await createApplication(ltp, { applicationTypeId: typeId }, META);

    // Must match nothing rather than failing the Postgres cast with a 500.
    const result = await listApplications(ltp, listQuery({ status: ['NOT_A_STATUS'] }));
    expect(result.total).toBe(0);
  });

  it('paginates and reports a total across pages', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createApplication(ltp, { applicationTypeId: typeId }, META);
    }

    const page1 = await listApplications(ltp, listQuery({ page: 1, pageSize: 2 }));
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page3 = await listApplications(ltp, listQuery({ page: 3, pageSize: 2 }));
    expect(page3.data).toHaveLength(1);

    // No row appears on two pages.
    const page2 = await listApplications(ltp, listQuery({ page: 2, pageSize: 2 }));
    const ids = [...page1.data, ...page2.data, ...page3.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
  }, 30_000);

  it('sorts by an allow-listed column in both directions', async () => {
    const first = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const second = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const asc = await listApplications(ltp, listQuery({ sort: 'applicationNumber', dir: 'asc' }));
    const desc = await listApplications(ltp, listQuery({ sort: 'applicationNumber', dir: 'desc' }));

    expect(asc.data[0]!.id).toBe(first.id);
    expect(desc.data[0]!.id).toBe(second.id);
  });

  it('builds a property label from the parts that are present', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await saveStep(ltp, app.id, { step: 'property', data: STEP_DATA.property, partial: false }, META);
    await saveStep(ltp, app.id, { step: 'survey', data: STEP_DATA.survey, partial: false }, META);

    const result = await listApplications(ltp, listQuery());
    expect(result.data[0]!.propertyLabel).toBe('Plot 7, Sy. 123/A, 123/B, Road No 12, Hyderabad');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Timeline
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('timeline', () => {
  it('records created, updated and submitted in order', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    const events = await getTimeline(ltp, app.id);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe('APPLICATION_CREATED');
    expect(types).toContain('APPLICATION_UPDATED');
    expect(types[types.length - 1]).toBe('APPLICATION_SUBMITTED');

    // Gap-free, ascending.
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  }, 30_000);

  it('cannot be rewritten — the table is append-only', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const event = await prisma.applicationEvent.findFirstOrThrow({
      where: { applicationId: app.id },
    });

    await expect(
      prisma.applicationEvent.update({
        where: { id: event.id },
        data: { title: 'Something else entirely' },
      })
    ).rejects.toThrow(/append-only/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Delete
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('deleteDraft', () => {
  it('soft-deletes, keeping the number accounted for in the register', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await deleteDraft(ltp, app.id, META);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.deletedAt).not.toBeNull();
    // The row survives, so the issued number is still explicable.
    expect(row.applicationNumber).toBe(app.applicationNumber);
  });

  it('refuses to delete an application that has been filed', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await completeAllSteps(ltp, app.id);
    await submitApplication(ltp, app.id, META);

    await expect(deleteDraft(ltp, app.id, META)).rejects.toThrow(/no longer be edited/i);
  }, 30_000);
});
