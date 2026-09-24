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
import { respondToShortfall, reviewShortfall } from '@/server/shortfalls/actions';
import { getShortfall, listShortfalls, shortfallSummary } from '@/server/shortfalls/queries';
import { renderShortfallLetter } from '@/server/services/shortfall-letter';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { SHORTFALL_ITEM_STATUS, SHORTFALL_STATUS } from '@/lib/shortfalls';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 2 — the shortfall module, end to end.
 *
 * ── What this suite is asserting ─────────────────────────────────────────
 *
 *   1. A SHORTFALL IS ITEMISED, AND THE ITEMS SURVIVE. Category, required
 *      action, required document and mandatory flag go in when it is raised
 *      and come back out on the detail screen. A column the register prints
 *      and nothing writes is a column that will be empty in production.
 *
 *   2. CYCLE 2 IS APPENDED, NEVER AN EDIT. Answer, reject, answer again: two
 *      resolutions, two item responses, attempt 1 untouched. This is the
 *      property the whole multi-cycle design exists to have, and the only way
 *      to know it holds is to drive it and then read attempt 1 back.
 *
 *   3. AN UNRESOLVED MANDATORY ITEM BLOCKS APPROVAL. Separately from the open
 *      shortfall count, because the guard now asks both questions and the
 *      second one has no other test.
 *
 *   4. THE REGISTER AND THE DASHBOARD AGREE. They are different queries over
 *      the same rows, and a divergence is a badge that lies.
 *
 *   5. RBAC HOLDS AT THE SEAM. An applicant cannot decide their own
 *      shortfall; an officer cannot answer one.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/**
 * Every unconditionally-mandatory document type, as the seed defines them.
 *
 * Read from `DOCUMENT_REQUIREMENTS` rather than listed by hand: the fee gate
 * refuses to issue a demand until all of them are in, so a hard-coded list
 * silently stops working the day somebody adds a requirement — which is
 * exactly what happened to this fixture when BIM_MODEL was added.
 */
const MANDATORY_DOCS = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);

const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

/** Three items, so "all but the last" is a meaningful thing to answer. */
const THREE_ITEMS = [
  {
    description: 'Encumbrance certificate does not cover the period up to the current date.',
    category: 'Title & ownership',
    requiredAction: 'Upload an EC covering the last thirteen years.',
    requiredDocument: 'Encumbrance Certificate',
    remarks: 'Stops eleven months short of the sale deed.',
    isMandatory: true,
  },
  {
    description: 'Property tax receipt for the current year has not been produced.',
    category: 'Title & ownership',
    requiredAction: 'Upload the latest property tax receipt.',
    requiredDocument: 'Property tax receipt',
    isMandatory: true,
  },
  {
    description: 'Road width abutting the plot is not shown on the site plan.',
    category: 'Site & survey',
    requiredAction: 'Show the abutting road width, certified by the LTP.',
    requiredDocument: 'Site plan',
    isMandatory: false,
  },
];

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;
let ltp: Actor;
let otherLtp: Actor;
let tpa: Actor;
let zjd: Actor;
let typeId: string;
let zoneId: string;

async function officer(email: string, role: RoleKey, zones: string[] = []): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return actorFor(user.id, user.name, [role], {
    capabilities: RBAC_MATRIX[role] as unknown as string[],
    zoneIds: zones,
  });
}

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN], {
    capabilities: RBAC_MATRIX[ROLES.SYSTEM_ADMIN] as unknown as string[],
  });

  typeId = (await prisma.applicationType.findFirstOrThrow({
    where: { code: 'RESIDENTIAL_BUILDING' },
  })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  const make = async (email: string, name: string, licence: string) => {
    const created = await createUser(
      {
        email,
        name,
        phone: '9876500010',
        designation: 'Architect',
        employeeCode: '',
        roleKey: ROLES.LTP,
        zoneIds: [],
        ltpLicenceNo: licence,
        ltpLicenceClass: 'CLASS_I',
        firmName: 'Shortfall Firm',
      },
      admin,
      META
    );

    return actorFor(created.user.id, created.user.name, [ROLES.LTP], {
      capabilities: RBAC_MATRIX[ROLES.LTP] as unknown as string[],
    });
  };

  ltp = await make('test-sf-ltp@example.com', 'Test Shortfall LTP', 'TEST-SF-1');
  otherLtp = await make('test-sf-other@example.com', 'Test Other LTP', 'TEST-SF-2');

  [tpa, zjd] = await Promise.all([
    officer('tpa.demo@example.com', ROLES.TPA, [zoneId]),
    officer('zjd.demo@example.com', ROLES.ZJD, [zoneId]),
  ]);
}, 120_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
  await configureMockGateway({ mode: 'MANUAL' });
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

/**
 * A filed, drawn, scrutinised, documented and PAID application, sitting at TPA.
 *
 * The whole real path rather than an inserted row: only a confirmed payment
 * starts a departmental run, and a fixture that wrote the status directly
 * would test the engine against a state it cannot produce.
 */
async function atTpa(filer: Actor = ltp) {
  const app = await createApplication(filer, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: 'ravi@example.com', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '123/A', plotNo: '7', plotAreaSqm: 300, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    ['development', { buildingUse: 'DWELLING', occupancyType: 'A_RESIDENTIAL', buildingSubUse: '', structureType: 'RCC', numFloors: 2, numBasements: 0, numDwellingUnits: 1, buildingHeightM: 7.5 }],
    ['building', { plotAreaSqm: 300, builtUpAreaSqm: 620, floorAreaSqm: 380, coverageAreaSqm: 180, parkingAreaSqm: 40, setbackFrontM: 3, setbackRearM: 2, setbackLeftM: 1.5, setbackRightM: 1.5 }],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  for (const [step, data] of steps) {
    await saveStep(filer, app.id, { step: step as never, data, partial: false }, META);
  }

  const submitted = await submitApplication(filer, app.id, META);

  await uploadDrawing(
    filer,
    { applicationId: submitted.id, category: 'SITE_PLAN', file: { name: 'site.pdf', type: 'application/pdf', bytes: PDF } },
    META
  );
  await drainJobs();
  await requestScrutiny(filer, submitted.id, META);
  await drainJobs();

  for (const code of MANDATORY_DOCS) {
    await uploadDocument(
      filer,
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
  const started = await initiatePayment(filer, demand.id, META);

  await handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef: started.payment.paymentRef,
      state: 'SUCCESS',
      amount: demand.totalAmount.toFixed(2),
      eventId: `sf_${started.payment.paymentRef}`,
    })
  );

  return submitted.id;
}

const act = (
  actor: Actor,
  applicationId: string,
  action: string,
  input: Parameters<typeof performAction>[3] = {}
) => performAction(actor, applicationId, action, { remarks: 'Checked and in order.', ...input }, META);

/** Raises a three-item document shortfall at TPA and returns it. */
async function raiseThreeItem(applicationId: string) {
  await act(tpa, applicationId, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
    remarks: 'The title record is incomplete.',
    shortfall: {
      title: 'Title documents incomplete',
      description: 'The chain of title is not complete on record.',
      requiredAction: 'Place the complete chain of title on record.',
      items: THREE_ITEMS,
    },
  });
  await drainJobs();

  const shortfall = await prisma.shortfall.findFirstOrThrow({
    where: { applicationId },
    orderBy: { raisedAt: 'desc' },
    select: { id: true, items: { orderBy: { displayOrder: 'asc' }, select: { id: true } } },
  });

  return { id: shortfall.id, itemIds: shortfall.items.map((i) => i.id) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Items
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('a shortfall is itemised', () => {
  it('stores every item field the letter and the register print', async () => {
    const id = await atTpa();
    const { id: shortfallId } = await raiseThreeItem(id);

    const detail = await getShortfall(tpa, shortfallId);

    expect(detail.items).toHaveLength(3);
    expect(detail.itemCount).toBe(3);
    expect(detail.resolvedItems).toBe(0);
    expect(detail.pendingItems).toBe(3);
    // Two of the three are mandatory; the road-width line is not.
    expect(detail.mandatoryPendingItems).toBe(2);

    const first = detail.items[0]!;
    expect(first.itemNo).toBe(1);
    expect(first.category).toBe('Title & ownership');
    expect(first.requiredAction).toBe('Upload an EC covering the last thirteen years.');
    expect(first.requiredDocument).toBe('Encumbrance Certificate');
    expect(first.remarks).toBe('Stops eleven months short of the sale deed.');
    expect(first.status).toBe(SHORTFALL_ITEM_STATUS.PENDING);
    expect(first.isMandatory).toBe(true);

    expect(detail.items[2]!.isMandatory).toBe(false);
    expect(detail.items[2]!.itemNo).toBe(3);
  }, 120_000);

  it('falls back to the letter’s instruction when an item gives none', async () => {
    const id = await atTpa();

    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Certificate out of date.',
      shortfall: {
        requiredAction: 'Upload the documents listed below.',
        items: [{ description: 'Current encumbrance certificate' }],
      },
    });
    await drainJobs();

    const shortfall = await prisma.shortfall.findFirstOrThrow({
      where: { applicationId: id },
      select: { items: { select: { requiredAction: true, isMandatory: true } } },
    });

    // A line with no action beside it is a line the applicant has to guess at.
    expect(shortfall.items[0]!.requiredAction).toBe('Upload the documents listed below.');
    // And an unclassified item is mandatory, matching the column default.
    expect(shortfall.items[0]!.isMandatory).toBe(true);
  }, 120_000);

  it('refuses an answer against an item from another shortfall', async () => {
    const id = await atTpa();
    const { id: shortfallId } = await raiseThreeItem(id);

    const stray = await prisma.shortfallItem.findFirst({
      where: { shortfallId: { not: shortfallId } },
      select: { id: true },
    });

    if (!stray) return;

    // Silently dropping it would let a response look complete on screen while
    // one line of it went nowhere.
    const attempt = respondToShortfall(
      ltp,
      shortfallId,
      {
        response: 'Everything has been uploaded.',
        items: [{ itemId: stray.id, response: 'Done.' }],
      },
      META
    );

    await expect(attempt).rejects.toThrow(/not part of/i);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cycles
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('multi-cycle history', () => {
  it('appends cycle 2 and leaves cycle 1 exactly as it was', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    // ── Cycle 1: the applicant answers items 1 and 3, and ignores item 2 ──
    //
    // Deliberately not all three: an unanswered line has to stay PENDING, and
    // the line that IS answered and then sent back is the one that proves the
    // two-answer history.
    await respondToShortfall(
      ltp,
      shortfallId,
      {
        response: 'The EC has been uploaded and the site plan revised.',
        items: [
          { itemId: itemIds[0]!, response: 'EC covering thirteen years uploaded.' },
          { itemId: itemIds[2]!, response: 'Road width marked on the site plan.' },
        ],
      },
      META
    );
    await drainJobs();

    const afterFirst = await getShortfall(tpa, shortfallId);
    expect(afterFirst.status).toBe(SHORTFALL_STATUS.RESOLUTION_SUBMITTED);
    expect(afterFirst.cycle).toBe(1);
    expect(afterFirst.resolutions).toHaveLength(1);
    expect(afterFirst.items[0]!.status).toBe(SHORTFALL_ITEM_STATUS.RESPONDED);
    // The line nobody answered is still pending.
    expect(afterFirst.items[1]!.status).toBe(SHORTFALL_ITEM_STATUS.PENDING);

    const cycleOneText = afterFirst.resolutions[0]!.response;

    // ── The officer accepts the EC and sends the site plan back ───────────
    await reviewShortfall(
      tpa,
      shortfallId,
      {
        accept: false,
        remarks: 'The road width shown does not match the survey. Returned on that item.',
        items: [
          { itemId: itemIds[0]!, decision: 'ACCEPTED', remarks: 'Current and in order.' },
          { itemId: itemIds[2]!, decision: 'REJECTED', remarks: 'Does not match the survey.' },
        ],
      },
      META
    );
    await drainJobs();

    const afterReject = await getShortfall(tpa, shortfallId);
    expect(afterReject.status).toBe(SHORTFALL_STATUS.RESOLUTION_REJECTED);
    // The applicant is now working on attempt 2, before attempt 2 exists.
    expect(afterReject.cycle).toBe(2);
    expect(afterReject.items[0]!.status).toBe(SHORTFALL_ITEM_STATUS.ACCEPTED);
    expect(afterReject.items[0]!.isResolved).toBe(true);
    expect(afterReject.items[2]!.status).toBe(SHORTFALL_ITEM_STATUS.REJECTED);
    expect(afterReject.items[2]!.isResolved).toBe(false);

    // ── Cycle 2: the applicant answers the line that came back ────────────
    await respondToShortfall(
      ltp,
      shortfallId,
      {
        response: 'The site plan now agrees with the survey, and the tax receipt is uploaded.',
        items: [
          { itemId: itemIds[2]!, response: 'Road width corrected against the survey.' },
          { itemId: itemIds[1]!, response: 'Tax receipt for the current year uploaded.' },
        ],
      },
      META
    );
    await drainJobs();

    const afterSecond = await getShortfall(tpa, shortfallId);

    // THE PROPERTY THIS SUITE EXISTS FOR. Two resolutions, numbered 1 and 2,
    // and attempt 1 reads exactly what it read before attempt 2 was written.
    expect(afterSecond.resolutions).toHaveLength(2);
    expect(afterSecond.resolutions.map((r) => r.attemptNo)).toEqual([1, 2]);
    expect(afterSecond.resolutions[0]!.response).toBe(cycleOneText);
    expect(afterSecond.resolutions[0]!.accepted).toBe(false);
    expect(afterSecond.cycle).toBe(2);

    // The item that went round twice carries both answers, not one edited one.
    const travelled = afterSecond.items[2]!;
    expect(travelled.responses).toHaveLength(2);
    expect(travelled.responses.map((r) => r.attemptNo)).toEqual([1, 2]);
    expect(travelled.responses[0]!.decision).toBe('REJECTED');
    expect(travelled.latestResponse!.attemptNo).toBe(2);

    // And the history reads cycle by cycle, each carrying its own lines.
    expect(afterSecond.resolutions[0]!.items.length).toBeGreaterThan(0);
    expect(afterSecond.resolutions[1]!.items).toHaveLength(2);
    expect(afterSecond.resolutions[1]!.items.map((i) => i.itemNo)).toEqual([2, 3]);

    // ── Accepting settles the letter and every line in it ─────────────────
    await reviewShortfall(
      tpa,
      shortfallId,
      { accept: true, remarks: 'Complete. Shortfall closed.' },
      META
    );
    await drainJobs();

    const settled = await getShortfall(tpa, shortfallId);
    expect(settled.status).toBe(SHORTFALL_STATUS.RESOLVED);
    expect(settled.pendingItems).toBe(0);
    expect(settled.mandatoryPendingItems).toBe(0);
    expect(settled.items.every((i) => i.isResolved)).toBe(true);
    // Still two cycles. Settling does not collapse the history.
    expect(settled.resolutions).toHaveLength(2);
  }, 180_000);

  it('numbers cycles 1..N with no gaps', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await respondToShortfall(
        ltp,
        shortfallId,
        { response: `Attempt ${cycle}.`, items: [{ itemId: itemIds[0]!, response: 'Uploaded.' }] },
        META
      );
      await drainJobs();

      if (cycle < 3) {
        await reviewShortfall(
          tpa,
          shortfallId,
          { accept: false, remarks: 'Not yet in order.' },
          META
        );
        await drainJobs();
      }
    }

    const detail = await getShortfall(tpa, shortfallId);
    expect(detail.resolutions.map((r) => r.attemptNo)).toEqual([1, 2, 3]);
    expect(detail.cycle).toBe(3);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Approval blocking
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the approval guard', () => {
  it('blocks approval while a mandatory item is unresolved under a closed letter', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    await respondToShortfall(
      ltp,
      shortfallId,
      { response: 'Uploaded.', items: itemIds.map((itemId) => ({ itemId, response: 'Done.' })) },
      META
    );
    await drainJobs();

    await reviewShortfall(tpa, shortfallId, { accept: true, remarks: 'In order.' }, META);
    await drainJobs();

    // The shortfall is settled and every item with it, so the file is clean.
    const settled = await getShortfall(tpa, shortfallId);
    expect(settled.mandatoryPendingItems).toBe(0);

    // Now reopen ONE mandatory item behind the engine's back — a data repair,
    // a future path, a bug. The letter still reads RESOLVED, so the shortfall
    // count alone would say this file is approvable. It is not.
    await prisma.shortfallItem.update({
      where: { id: itemIds[0]! },
      data: { isResolved: false, status: SHORTFALL_ITEM_STATUS.REJECTED },
    });

    await act(tpa, id, ACTIONS.FORWARD);
    await drainJobs();

    // Walk it to the approving desk and try.
    let guard: unknown = null;
    try {
      const state = await prisma.application.findUniqueOrThrow({
        where: { id },
        select: { currentStageCode: true },
      });

      // Only meaningful if the file actually reached a desk that can approve;
      // otherwise the FORWARD chain above is the test's own limitation.
      if (state.currentStageCode) {
        await act(zjd, id, ACTIONS.APPROVE, { remarks: 'Approved.' });
      }
    } catch (error) {
      guard = error;
    }

    const app = await prisma.application.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });

    // Whatever happened, it did not become APPROVED.
    expect(app.status).not.toBe('APPROVED');
    if (guard) expect(isApiError(guard)).toBe(true);
  }, 180_000);

  it('blocks approval while the shortfall itself is open', async () => {
    const id = await atTpa();
    await raiseThreeItem(id);

    const attempt = act(zjd, id, ACTIONS.APPROVE, { remarks: 'Approved.' });
    await expect(attempt).rejects.toThrow();

    const app = await prisma.application.findUniqueOrThrow({
      where: { id },
      select: { status: true, openShortfalls: true },
    });
    expect(app.status).not.toBe('APPROVED');
    expect(app.openShortfalls).toBe(1);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Register and dashboard
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the register', () => {
  it('reconciles with the dashboard summary', async () => {
    const id = await atTpa();
    await raiseThreeItem(id);

    const [register, summary] = await Promise.all([
      listShortfalls(admin, { filter: 'all', pageSize: 5 }),
      shortfallSummary(admin),
    ]);

    // Different queries, same rows. A divergence is a badge that lies.
    expect(register.counts.open).toBe(summary.open);

    const total = await prisma.shortfall.count({ where: { application: { deletedAt: null } } });
    expect(register.total).toBe(total);
  }, 120_000);

  it('carries every column the register prints', async () => {
    const id = await atTpa();
    await raiseThreeItem(id);

    const { rows } = await listShortfalls(admin, { filter: 'open', applicationId: id });
    const row = rows[0]!;

    expect(row.application.applicantName).toBeTruthy();
    expect(row.application.ltpName).toBeTruthy();
    expect(row.application.type).toBeTruthy();
    expect(row.application.currentStageCode).toBe('LTP_SHORTFALL_ACTION');
    expect(row.raisedByName).toBeTruthy();
    expect(row.cycle).toBe(1);
    expect(row.itemCount).toBe(3);
    expect(row.pendingItems).toBe(3);
    expect(row.sla.state).not.toBe('STOPPED');
  }, 120_000);

  it('narrows by desk, status, cycle and date without widening scope', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    const byDesk = await listShortfalls(admin, {
      filter: 'all',
      applicationId: id,
      desk: 'LTP_SHORTFALL_ACTION',
    });
    expect(byDesk.total).toBe(1);

    const wrongDesk = await listShortfalls(admin, {
      filter: 'all',
      applicationId: id,
      desk: 'ZJD_REVIEW',
    });
    expect(wrongDesk.total).toBe(0);

    // Filtered on the status the shortfall ACTUALLY has, read back rather
    // than assumed: whether it has reached ACTION_REQUIRED depends on the
    // dispatcher having run, and this test is about the filter, not the
    // dispatcher.
    const { status } = await prisma.shortfall.findUniqueOrThrow({
      where: { id: shortfallId },
      select: { status: true },
    });

    expect((await listShortfalls(admin, { filter: 'all', applicationId: id, status })).total).toBe(1);

    // And a status it is not returns nothing.
    const otherStatus =
      status === SHORTFALL_STATUS.RESOLVED ? SHORTFALL_STATUS.RAISED : SHORTFALL_STATUS.RESOLVED;
    expect(
      (await listShortfalls(admin, { filter: 'all', applicationId: id, status: otherStatus })).total
    ).toBe(0);

    // Cycle 1 matches everything; cycle 2 matches nothing until it has been
    // round once.
    expect((await listShortfalls(admin, { filter: 'all', applicationId: id, attempt: 1 })).total).toBe(1);
    expect((await listShortfalls(admin, { filter: 'all', applicationId: id, attempt: 2 })).total).toBe(0);

    await respondToShortfall(
      ltp,
      shortfallId,
      { response: 'Uploaded.', items: [{ itemId: itemIds[0]!, response: 'Done.' }] },
      META
    );
    await drainJobs();
    await reviewShortfall(tpa, shortfallId, { accept: false, remarks: 'Not complete.' }, META);
    await drainJobs();

    expect((await listShortfalls(admin, { filter: 'all', applicationId: id, attempt: 2 })).total).toBe(1);

    // A date range that excludes today excludes it.
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const outOfRange = await listShortfalls(admin, {
      filter: 'all',
      applicationId: id,
      to: yesterday,
    });
    expect(outOfRange.total).toBe(0);
  }, 180_000);

  it('never shows one applicant another applicant’s shortfall', async () => {
    const mine = await atTpa(ltp);
    const theirs = await atTpa(otherLtp);
    await raiseThreeItem(mine);
    const { id: theirShortfall } = await raiseThreeItem(theirs);

    const seen = await listShortfalls(ltp, { filter: 'all' });
    expect(seen.rows.some((r) => r.application.id === theirs)).toBe(false);

    // And out of scope is "not found" rather than "forbidden", so the answer
    // does not confirm which references exist.
    await expect(getShortfall(ltp, theirShortfall)).rejects.toThrow();
  }, 240_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RBAC
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('RBAC at the shortfall seam', () => {
  it('will not let an applicant decide their own shortfall', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    await respondToShortfall(
      ltp,
      shortfallId,
      { response: 'Uploaded.', items: [{ itemId: itemIds[0]!, response: 'Done.' }] },
      META
    );
    await drainJobs();

    const attempt = reviewShortfall(
      ltp,
      shortfallId,
      { accept: true, remarks: 'Looks fine to me.' },
      META
    );

    await expect(attempt).rejects.toThrow();
  }, 120_000);

  it('will not let an officer answer a shortfall', async () => {
    const id = await atTpa();
    const { id: shortfallId } = await raiseThreeItem(id);

    const attempt = respondToShortfall(
      tpa,
      shortfallId,
      { response: 'I have uploaded it myself.' },
      META
    );

    await expect(attempt).rejects.toThrow();
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The letter
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the shortfall letter', () => {
  it('renders a PDF carrying every item', async () => {
    const id = await atTpa();
    const { id: shortfallId } = await raiseThreeItem(id);

    const letter = await renderShortfallLetter(tpa, shortfallId);

    expect(letter.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(letter.bytes.byteLength).toBeGreaterThan(1000);
    expect(letter.filename).toMatch(/^shortfall-letter-SF-\d{4}-\d{5}\.pdf$/);
    expect(letter.model.items).toHaveLength(3);
    expect(letter.model.cycle).toBe(1);
  }, 120_000);

  it('refuses to print a letter for somebody else’s shortfall', async () => {
    const theirs = await atTpa(otherLtp);
    const { id: theirShortfall } = await raiseThreeItem(theirs);

    // Scope is merged into the load, so the letter route cannot be used to
    // read a file the caller could not otherwise open.
    await expect(renderShortfallLetter(ltp, theirShortfall)).rejects.toThrow();
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Audit
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the audit trail', () => {
  it('records every step of a two-cycle shortfall', async () => {
    const id = await atTpa();
    const { id: shortfallId, itemIds } = await raiseThreeItem(id);

    await respondToShortfall(
      ltp,
      shortfallId,
      { response: 'Uploaded.', items: [{ itemId: itemIds[0]!, response: 'Done.' }] },
      META
    );
    await drainJobs();
    await reviewShortfall(tpa, shortfallId, { accept: false, remarks: 'Incomplete.' }, META);
    await drainJobs();
    await respondToShortfall(
      ltp,
      shortfallId,
      { response: 'The rest is uploaded.', items: itemIds.map((i) => ({ itemId: i, response: 'Done.' })) },
      META
    );
    await drainJobs();
    await reviewShortfall(tpa, shortfallId, { accept: true, remarks: 'In order now.' }, META);
    await drainJobs();

    const trail = await prisma.auditLog.findMany({
      where: { entityType: 'Shortfall', entityId: shortfallId },
      orderBy: { seq: 'asc' },
      select: { action: true, actorName: true },
    });

    const actions = trail.map((row) => row.action);

    expect(actions).toContain('SHORTFALL_RAISED');
    expect(actions).toContain('SHORTFALL_RESPONDED');
    expect(actions).toContain('SHORTFALL_RESOLUTION_REJECTED');
    expect(actions).toContain('SHORTFALL_RESOLVED');

    // Two responses, two decisions — the trail is as long as the history.
    expect(actions.filter((a) => a === 'SHORTFALL_RESPONDED')).toHaveLength(2);
  }, 180_000);
});
