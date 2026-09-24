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
import { uploadDocument } from '@/server/services/documents';
import { cancelDemand, generateFee, getFees, previewFee } from '@/server/services/fees';
import { createUser } from '@/server/services/users';
import { ROLES } from '@/lib/constants';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 5 — fees, and the two properties a demand has to have.
 *
 *   · It computes to the rupee. The worked example in docs/07-subsystems.md
 *     N.6 is reproduced by the seeded schedule, so that document, the seed and
 *     the calculator can all be checked against one another.
 *   · Once issued, it is FROZEN. Editing the schedule afterwards changes what
 *     the next applicant is charged and cannot change what this one owes —
 *     otherwise a demand stops being a statement of a debt and becomes a
 *     recalculation that happens to be running today.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
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

const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

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
      email: 'test-fee-a@example.com',
      name: 'Test Fee LTP',
      phone: '9876543212',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-FEE-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Fee Firm',
    },
    admin,
    META
  );
  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);

  const b = await createUser(
    {
      email: 'test-fee-b@example.com',
      name: 'Test Fee Other LTP',
      phone: '9876543213',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-FEE-B',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Other Fee Firm',
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

type Particulars = Partial<{ plotAreaSqm: number; builtUpAreaSqm: number; numFloors: number }>;

/** An application with every document in, ready for a demand. */
async function billableApplication(particulars: Particulars = {}) {
  const plotAreaSqm = particulars.plotAreaSqm ?? 300;
  const builtUpAreaSqm = particulars.builtUpAreaSqm ?? 620;
  const numFloors = particulars.numFloors ?? 2;

  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: '', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '123/A', plotNo: '7', plotAreaSqm, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    [
      'development',
      {
        buildingUse: 'DWELLING',
        occupancyType: 'A_RESIDENTIAL',
        buildingSubUse: '',
        structureType: 'RCC',
        numFloors,
        numBasements: 0,
        numDwellingUnits: 1,
        // Kept under 15 m so the fire and structural certificates stay out of
        // the way: this suite is about arithmetic, not the checklist.
        buildingHeightM: 7.5,
      },
    ],
    [
      'building',
      {
        plotAreaSqm,
        builtUpAreaSqm,
        floorAreaSqm: 380,
        // Scaled to the plot: the wizard refuses ground coverage larger than
        // the plot it sits on, which the small-plot cases below would trip.
        coverageAreaSqm: Math.round(plotAreaSqm * 0.6),
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
    { applicationId: submitted.id, category: 'SITE_PLAN', file: { name: 'site.pdf', type: 'application/pdf', bytes: PDF } },
    META
  );
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

  return submitted;
}

const structureRow = () =>
  prisma.feeStructure.findFirstOrThrow({ where: { code: 'BP_STANDARD_FEES', version: 1 } });

// ═══════════════════════════════════════════════════════════════════════════
// 1. N.6 — the worked example, to the rupee
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the N.6 worked example', () => {
  it('computes to 33,495.00 on a 300 m² plot with 620 m² built up', async () => {
    const app = await billableApplication({ plotAreaSqm: 300, builtUpAreaSqm: 620 });
    const preview = await previewFee(ltp, app.id);

    expect(preview.calculation.total.toFixed(2)).toBe('33495.00');
  }, 90_000);

  it('reaches it by the six lines the document sets out, each on its own basis', async () => {
    const app = await billableApplication({ plotAreaSqm: 300, builtUpAreaSqm: 620 });
    const { calculation } = await previewFee(ltp, app.id);

    const amounts = Object.fromEntries(
      calculation.lines.map((l) => [l.code, l.amount.toFixed(2)])
    );

    expect(amounts).toEqual({
      // FLAT
      APPLICATION_FEE: '1000.00',
      // PER_UNIT_AREA — 620 × 5
      SCRUTINY_FEE: '3100.00',
      // SLAB — 100@20 + 200@30 + 320@45, cumulative bands
      DEVELOPMENT_CHARGE: '22400.00',
      // PERCENTAGE of one component — 10% of 22,400
      BETTERMENT_CHARGE: '2240.00',
      // PERCENTAGE of two — 1% of (3,100 + 22,400)
      LABOUR_CESS: '255.00',
      // FORMULA with a floor — 300 × 15, min 2,000
      OPEN_SPACE_CONTRIBUTION: '4500.00',
    });

    expect(calculation.subtotal.toFixed(2)).toBe('33495.00');
    // Neither seeded adjustment fires on an ordinary application, which is
    // deliberate: a demonstration that silently discounted every demand would
    // be worse than no demonstration.
    expect(calculation.adjustments).toHaveLength(0);
    expect(calculation.adjustmentTotal.toFixed(2)).toBe('0.00');
  }, 90_000);

  it('explains every line in words, so the number can be argued with', async () => {
    const app = await billableApplication();
    const { calculation } = await previewFee(ltp, app.id);

    for (const line of calculation.lines) {
      expect(line.note.length).toBeGreaterThan(0);
    }

    expect(calculation.lines.find((l) => l.code === 'SCRUTINY_FEE')!.note).toMatch(
      /620|5/
    );
    expect(calculation.lines.find((l) => l.code === 'OPEN_SPACE_CONTRIBUTION')!.note).toMatch(
      /plotAreaSqm \* 15|formula/i
    );
  }, 90_000);

  it('clamps the open-space contribution up to its minimum on a small plot', async () => {
    // 100 × 15 = 1,500, below the 2,000 floor.
    const app = await billableApplication({ plotAreaSqm: 100, builtUpAreaSqm: 620 });
    const { calculation } = await previewFee(ltp, app.id);

    const line = calculation.lines.find((l) => l.code === 'OPEN_SPACE_CONTRIBUTION')!;
    expect(line.computedAmount.toFixed(2)).toBe('1500.00');
    expect(line.amount.toFixed(2)).toBe('2000.00');
  }, 90_000);

  it('applies the small-plot rebate, and only to a small plot', async () => {
    const small = await billableApplication({ plotAreaSqm: 100, builtUpAreaSqm: 620 });
    const { calculation } = await previewFee(ltp, small.id);

    const rebate = calculation.adjustments.find((a) => a.code === 'SMALL_PLOT_REBATE');
    expect(rebate).toBeDefined();
    // A rebate is a negative line, so the total is the sum and nothing has to
    // remember to subtract.
    expect(Number(rebate!.amount.toFixed(2))).toBeLessThan(0);
    expect(calculation.total.toFixed(2)).toBe(
      calculation.subtotal.plus(calculation.adjustmentTotal).toFixed(2)
    );
  }, 90_000);

  it('applies the high-rise surcharge from five floors up', async () => {
    const four = await previewFee(ltp, (await billableApplication({ numFloors: 4 })).id);
    expect(four.calculation.adjustments.find((a) => a.code === 'HIGH_RISE_SURCHARGE')).toBeUndefined();

    const five = await previewFee(ltp, (await billableApplication({ numFloors: 5 })).id);
    const surcharge = five.calculation.adjustments.find((a) => a.code === 'HIGH_RISE_SURCHARGE');
    expect(surcharge).toBeDefined();
    expect(Number(surcharge!.amount.toFixed(2))).toBeGreaterThan(0);
  }, 120_000);

  it('says out loud that the schedule is a placeholder', async () => {
    const app = await billableApplication();
    const { calculation } = await previewFee(ltp, app.id);

    // Nobody may mistake a demonstration rate for a charge the corporation is
    // entitled to levy.
    expect(calculation.structure.isPlaceholder).toBe(true);
  }, 90_000);

  it('persists nothing', async () => {
    const app = await billableApplication();
    await previewFee(ltp, app.id);
    await previewFee(ltp, app.id);

    expect(await prisma.applicationFee.count({ where: { applicationId: app.id } })).toBe(0);
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. An issued demand is frozen — the other exit criterion
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('an issued demand is unchanged by a later edit to the schedule', () => {
  it('keeps its total, its lines and its version after the rates are changed', async () => {
    const app = await billableApplication({ plotAreaSqm: 300, builtUpAreaSqm: 620 });
    const issued = await generateFee(officer, app.id, META);

    expect(issued.totalAmount.toFixed(2)).toBe('33495.00');
    expect(issued.feeStructureVersion).toBe(1);

    const structure = await structureRow();
    const before = await prisma.feeComponent.findFirstOrThrow({
      where: { feeStructureId: structure.id, code: 'APPLICATION_FEE' },
    });

    // The department triples the application fee. (In production this would be
    // a new VERSION; doing it the wrong way round here is the point — even an
    // in-place edit must not reach a demand already raised.)
    await prisma.feeComponent.update({ where: { id: before.id }, data: { rate: 3000 } });

    try {
      const reread = await prisma.applicationFee.findUniqueOrThrow({
        where: { id: issued.id },
        include: { lineItems: true },
      });

      expect(reread.totalAmount.toFixed(2)).toBe('33495.00');
      expect(reread.feeStructureVersion).toBe(1);
      expect(
        reread.lineItems.find((l) => l.componentCode === 'APPLICATION_FEE')!.amount.toFixed(2)
      ).toBe('1000.00');

      // And what the applicant is shown comes from those frozen rows, not from
      // a recalculation that happens to be running today.
      const shown = await getFees(ltp, app.id);
      expect(shown.demands[0]!.totalAmount.toFixed(2)).toBe('33495.00');
    } finally {
      await prisma.feeComponent.update({ where: { id: before.id }, data: { rate: before.rate } });
    }
  }, 120_000);

  it('records the inputs next to the outputs, so the number stays explainable', async () => {
    const app = await billableApplication({ plotAreaSqm: 300, builtUpAreaSqm: 620 });
    const issued = await generateFee(officer, app.id, META);

    const inputs = issued.calculationInputs as Record<string, unknown>;
    expect(inputs.plotAreaSqm).toBe(300);
    expect(inputs.builtUpAreaSqm).toBe(620);

    // The audit row carries them too — a demand is only explainable if what
    // went in is recorded beside what came out.
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ApplicationFee', entityId: issued.id, action: 'FEE_GENERATED' },
    });
    expect(audit).not.toBeNull();
    const after = audit!.after as Record<string, unknown>;
    expect(after.total).toBe('33495.00');
    expect(after.feeStructureVersion).toBe(1);
  }, 120_000);

  it('freezes the component names, so a renamed component does not rewrite history', async () => {
    const app = await billableApplication();
    const issued = await generateFee(officer, app.id, META);

    const structure = await structureRow();
    const component = await prisma.feeComponent.findFirstOrThrow({
      where: { feeStructureId: structure.id, code: 'SCRUTINY_FEE' },
    });

    await prisma.feeComponent.update({
      where: { id: component.id },
      data: { name: 'Renamed after the demand was raised' },
    });

    try {
      const line = await prisma.feeLineItem.findFirstOrThrow({
        where: { applicationFeeId: issued.id, componentCode: 'SCRUTINY_FEE' },
      });
      expect(line.componentName).toBe('Scrutiny fee');
    } finally {
      await prisma.feeComponent.update({
        where: { id: component.id },
        data: { name: component.name },
      });
    }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Issuing, numbering and the one-live-demand rule
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('issuing a demand', () => {
  it('issues it at once, numbered and dated', async () => {
    const app = await billableApplication();
    const demand = await generateFee(officer, app.id, META);

    expect(demand.status).toBe('ISSUED');
    expect(demand.type).toBe('ORIGINAL');
    expect(demand.demandNumber).toMatch(/^DM\/\d{4}\/\d{6}$/);
    expect(demand.issuedAt).not.toBeNull();
    expect(demand.generatedById).toBe(officer.id);
  }, 90_000);

  it('moves the application to FEE_GENERATED and says so on the timeline', async () => {
    const app = await billableApplication();
    const demand = await generateFee(officer, app.id, META);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('FEE_GENERATED');

    const event = await prisma.applicationEvent.findFirst({
      where: { applicationId: app.id, type: 'FEE_GENERATED' },
    });
    expect(event?.description).toContain(demand.demandNumber);
  }, 90_000);

  it('refuses a second demand while the first is live', async () => {
    const app = await billableApplication();
    await generateFee(officer, app.id, META);

    await expect(generateFee(officer, app.id, META)).rejects.toThrow(/already been raised/i);
    expect(await prisma.applicationFee.count({ where: { applicationId: app.id } })).toBe(1);
  }, 90_000);

  it('is refused by the DATABASE too, not only by the status guard', async () => {
    const app = await billableApplication();
    const first = await generateFee(officer, app.id, META);

    // Bypass every service guard: the partial unique index is the last line.
    await expect(
      prisma.applicationFee.create({
        data: {
          applicationId: app.id,
          demandNumber: `DM/9999/${String(Date.now()).slice(-6)}`,
          type: 'ORIGINAL',
          status: 'ISSUED',
          feeStructureId: first.feeStructureId,
          feeStructureVersion: 1,
          feeStructureCode: 'BP_STANDARD_FEES',
          roundingRule: 'NEAREST_1',
          subtotal: 1,
          adjustmentTotal: 0,
          totalAmount: 1,
        },
      })
    ).rejects.toThrow();
  }, 90_000);

  it('gives concurrent generations one demand, not two', async () => {
    const app = await billableApplication();

    const results = await Promise.allSettled([
      generateFee(officer, app.id, META),
      generateFee(officer, app.id, META),
      generateFee(officer, app.id, META),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.applicationFee.count({ where: { applicationId: app.id } })).toBe(1);
  }, 90_000);

  it('numbers demands uniquely', async () => {
    const apps = await Promise.all([billableApplication(), billableApplication()]);
    const demands = await Promise.all(apps.map((a) => generateFee(officer, a.id, META)));

    const numbers = demands.map((d) => d.demandNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  }, 150_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Cancellation — the only way to correct a demand
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('cancelling a demand', () => {
  it('needs a reason', async () => {
    const app = await billableApplication();
    const demand = await generateFee(officer, app.id, META);

    await expect(cancelDemand(officer, demand.id, '   ', META)).rejects.toThrow(/say why/i);
  }, 90_000);

  it('returns the application to the document stage so a corrected demand can be raised', async () => {
    const app = await billableApplication();
    const first = await generateFee(officer, app.id, META);

    await cancelDemand(officer, first.id, 'Raised against the wrong built-up area.', META);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe('DOCUMENTS_COMPLETED');

    const second = await generateFee(officer, app.id, META);
    expect(second.id).not.toBe(first.id);
    expect(second.demandNumber).not.toBe(first.demandNumber);

    // The cancelled one is still there, with its reason. A demand is never
    // edited and never deleted.
    const cancelled = await prisma.applicationFee.findUniqueOrThrow({ where: { id: first.id } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toMatch(/built-up area/i);
  }, 120_000);

  it('refuses to cancel a demand that has been paid against', async () => {
    const app = await billableApplication();
    const demand = await generateFee(officer, app.id, META);

    // Phase 6 owns payments; this only needs the money to be visible.
    await prisma.applicationFee.update({
      where: { id: demand.id },
      data: { paidAmount: 500, status: 'PARTIALLY_PAID' },
    });

    await expect(cancelDemand(officer, demand.id, 'Changed my mind', META)).rejects.toThrow(
      /refund is required/i
    );
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Who may see a demand
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('scope', () => {
  it('shows an LTP their own demand', async () => {
    const app = await billableApplication();
    await generateFee(officer, app.id, META);

    const fees = await getFees(ltp, app.id);
    expect(fees.demands).toHaveLength(1);
    expect(fees.demands[0]!.charges.length).toBeGreaterThan(0);
  }, 90_000);

  it('will not show one LTP another LTP’s demand', async () => {
    const app = await billableApplication();
    await generateFee(officer, app.id, META);

    await expect(getFees(otherLtp, app.id)).rejects.toThrow(/could not be found/i);
  }, 90_000);

  it('offers no preview beside an issued demand', async () => {
    const app = await billableApplication();
    await generateFee(officer, app.id, META);

    const fees = await getFees(ltp, app.id);
    // A recalculated figure sitting next to an issued demand that says
    // something different is how trust in the number is lost.
    expect(fees.preview).toBeNull();
  }, 90_000);
});
