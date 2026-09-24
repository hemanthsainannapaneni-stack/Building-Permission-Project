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
  setPaymentSetting,
  actorFor,
  META,
} from './setup';
import { createApplication, saveStep, submitApplication } from '@/server/services/applications';
import { uploadDrawing } from '@/server/services/drawings';
import { requestScrutiny } from '@/server/services/scrutiny';
import { uploadDocument } from '@/server/services/documents';
import { generateFee } from '@/server/services/fees';
import {
  cancelPayment,
  getPayments,
  handleWebhook,
  initiatePayment,
  reconcilePayments,
  settle,
  verifyPayment,
} from '@/server/services/payments';
import { ensureReceipt } from '@/server/services/receipts';
import { buildMockGatewayRequest } from '@/server/payments/mock';
import { __setPaymentProviderForTests, currentProvider } from '@/server/payments';
import type { PaymentProvider, ProviderStatus } from '@/server/payments';
import { createUser } from '@/server/services/users';
import { ROLES } from '@/lib/constants';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 5 — payments, and the three properties the money has to have.
 *
 *   · THE BROWSER IS NEVER BELIEVED. Nothing a client can send settles a
 *     payment. Every assertion about a successful payment in this file is an
 *     assertion about what `provider.verify()` said, because that is the only
 *     input the settlement has.
 *   · A DUPLICATE CREDITS ONCE. The same callback delivered five times leaves
 *     one credit, one receipt and one advanced application.
 *   · FAILURE NEVER ADVANCES. A failed, cancelled or timed-out payment leaves
 *     the application short of PENDING_TPA, and there is no transition by
 *     which it could have got there.
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
let finance: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let zoneId: string;

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  const created = await createUser(
    {
      email: 'test-pay-a@example.com',
      name: 'Test Pay LTP',
      phone: '9876543230',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-PAY-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Pay Firm',
    },
    admin,
    META
  );

  // Capabilities are asserted by the service through `can()`, so the actor
  // must carry the ones an LTP really holds rather than an empty list.
  ltp = actorFor(created.user.id, created.user.name, [ROLES.LTP], {
    capabilities: ['PAYMENT_INITIATE', 'PAYMENT_VIEW', 'FEE_VIEW', 'APPLICATION_VIEW'],
  });

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  const financeUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'finance.demo@example.com' },
  });
  finance = actorFor(financeUser.id, financeUser.name, [ROLES.FINANCE_OFFICER], {
    capabilities: ['PAYMENT_VIEW', 'PAYMENT_RECONCILE', 'FEE_VIEW'],
  });
}, 60_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
  await configureMockGateway({ mode: 'MANUAL' });
  __setPaymentProviderForTests(null);
});

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id].filter(Boolean) as string[]);
  await clearJobs();
  __setPaymentProviderForTests(null);
});

afterAll(async () => {
  if (dbUp) {
    await configureMockGateway({ mode: 'MANUAL' });
    await setPaymentSetting('payment_attempt_ttl_minutes', '30');
    await cleanupTestUsers();
    await clearOrphanFiles();
    await clearStorage();
  }
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

/** An application carrying an issued demand, ready to be paid. */
async function demandedApplication() {
  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: 'ravi@example.com', aadhaarLast4: '', panMasked: '' }],
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
        numFloors: 2,
        numBasements: 0,
        numDwellingUnits: 1,
        buildingHeightM: 7.5,
      },
    ],
    [
      'building',
      {
        plotAreaSqm: 300,
        builtUpAreaSqm: 620,
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

  const demand = await generateFee(admin, submitted.id, META);
  return { application: submitted, demand };
}

const statusOf = async (id: string) =>
  (await prisma.application.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

const demandRow = (id: string) =>
  prisma.applicationFee.findUniqueOrThrow({
    where: { id },
    select: { status: true, paidAmount: true, totalAmount: true, paidAt: true },
  });

/** Presses a button on the demo gateway, exactly as the page does. */
const gatewaySays = (
  paymentRef: string,
  state: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING',
  options: { amount?: string; eventId?: string } = {}
) =>
  handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef,
      state,
      amount: options.amount ?? '0.00',
      eventId: options.eventId ?? `mock_evt_${paymentRef}_${state}`,
    })
  );

// ═══════════════════════════════════════════════════════════════════════════
// 1. Success — and the transition it is the only thing allowed to cause
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a successful payment', () => {
  it('credits the demand, issues a receipt and moves the application to PENDING_TPA', async () => {
    const { application, demand } = await demandedApplication();
    expect(await statusOf(application.id)).toBe('FEE_GENERATED');

    const started = await initiatePayment(ltp, demand.id, META);
    expect(started.payment.status).toBe('PENDING');
    expect(started.redirectUrl).toContain(`/payments/gateway/${started.payment.paymentRef}`);
    expect(await statusOf(application.id)).toBe('PAYMENT_PENDING');

    const result = await gatewaySays(started.payment.paymentRef, 'SUCCESS', {
      amount: demand.totalAmount.toFixed(2),
    });

    expect(result).toMatchObject({ received: true, duplicate: false, settled: true, status: 'SUCCESS' });

    const paid = await demandRow(demand.id);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAmount.toFixed(2)).toBe(demand.totalAmount.toFixed(2));
    expect(paid.paidAt).not.toBeNull();

    // §8: PAYMENT_SUCCESS is what carried it to the department.
    expect(await statusOf(application.id)).toBe('PENDING_TPA');

    const receipt = await prisma.paymentReceipt.findFirstOrThrow({
      where: { payment: { applicationId: application.id } },
      select: { receiptNumber: true, amount: true, snapshot: true },
    });
    expect(receipt.receiptNumber).toMatch(/^RC\//);
    expect(receipt.amount.toFixed(2)).toBe(demand.totalAmount.toFixed(2));
  }, 120_000);

  it('records the submission on the timeline as caused by the payment', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: application.id },
      orderBy: { sequence: 'asc' },
      select: { type: true, metadata: true },
    });

    // Two acts, both on the applicant's timeline: filing the form, and the
    // file going to the department.
    expect(events.filter((e) => e.type === 'APPLICATION_SUBMITTED')).toHaveLength(1);
    expect(events.some((e) => e.type === 'PAYMENT_SUCCESSFUL')).toBe(true);

    // Since Phase 6 the handoff is written by the workflow engine rather than
    // by this service — the payment decides WHETHER the file may go to the
    // department, and the workflow decides where "the department" is. The
    // property §8 asks for is unchanged and is asserted here: the movement is
    // on the timeline, and the action that caused it was the confirmed
    // payment, not an officer.
    const handoff = events.find((e) => e.type === 'STAGE_FORWARDED');
    expect(handoff).toBeTruthy();

    const metadata = handoff!.metadata as Record<string, unknown>;
    expect(metadata.actionCode).toBe('CONFIRM_PAYMENT');
    expect(metadata.fromStageCode).toBe('LTP_PAYMENT');
    expect(metadata.toStageCode).toBe('TPA_REVIEW');
    expect(metadata.toStatus).toBe('PENDING_TPA');
  }, 120_000);

  it('writes an unalterable gateway ledger for the attempt', async () => {
    const { demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const ledger = await prisma.paymentTransaction.findMany({
      where: { payment: { paymentRef: started.payment.paymentRef } },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, direction: true, status: true },
    });

    expect(ledger.map((t) => t.direction)).toEqual(['INITIATE', 'WEBHOOK']);

    // The append-only trigger, not a convention.
    await expect(
      prisma.paymentTransaction.update({
        where: { id: ledger[0]!.id },
        data: { message: 'edited' },
      })
    ).rejects.toThrow(/append-only/i);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Failure — and the transition it must never cause
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a failed payment', () => {
  it('credits nothing and leaves the application at PAYMENT_FAILED', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    const result = await gatewaySays(started.payment.paymentRef, 'FAILED');
    expect(result.status).toBe('FAILED');

    const unpaid = await demandRow(demand.id);
    expect(unpaid.status).toBe('ISSUED');
    expect(unpaid.paidAmount.toFixed(2)).toBe('0.00');

    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');

    expect(
      await prisma.paymentReceipt.count({ where: { payment: { applicationId: application.id } } })
    ).toBe(0);
  }, 120_000);

  it('cannot be talked into PENDING_TPA by a later callback claiming success', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    await gatewaySays(started.payment.paymentRef, 'FAILED');
    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');

    // A different event id, so the duplicate key does not absorb it: this is a
    // genuinely new callback disagreeing with a settled attempt.
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', {
      amount: demand.totalAmount.toFixed(2),
      eventId: `mock_evt_${started.payment.paymentRef}_LATE`,
    });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { paymentRef: started.payment.paymentRef },
      select: { status: true },
    });

    expect(payment.status).toBe('FAILED');
    expect((await demandRow(demand.id)).paidAmount.toFixed(2)).toBe('0.00');
    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Retry
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('retrying after a failure', () => {
  it('is a new attempt, and the failed one is kept', async () => {
    const { application, demand } = await demandedApplication();

    const first = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(first.payment.paymentRef, 'FAILED');

    const second = await initiatePayment(ltp, demand.id, META);
    expect(second.payment.paymentRef).not.toBe(first.payment.paymentRef);
    expect(second.payment.attemptNo).toBe(2);
    expect(second.reused).toBe(false);

    await gatewaySays(second.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const attempts = await prisma.payment.findMany({
      where: { applicationFeeId: demand.id },
      orderBy: { attemptNo: 'asc' },
      select: { attemptNo: true, status: true },
    });

    // The failure is not edited away. A retry is a new row, always.
    expect(attempts).toEqual([
      { attemptNo: 1, status: 'FAILED' },
      { attemptNo: 2, status: 'SUCCESS' },
    ]);

    expect((await demandRow(demand.id)).status).toBe('PAID');
    expect(await statusOf(application.id)).toBe('PENDING_TPA');
  }, 120_000);

  it('refuses to open a second attempt while one is still open', async () => {
    const { demand } = await demandedApplication();

    const first = await initiatePayment(ltp, demand.id, META);
    const second = await initiatePayment(ltp, demand.id, META);

    // Not a new payment: the second press joins the attempt that exists. The
    // partial unique index makes the alternative impossible anyway.
    expect(second.reused).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.redirectUrl).toBe(first.redirectUrl);

    expect(await prisma.payment.count({ where: { applicationFeeId: demand.id } })).toBe(1);
  }, 120_000);

  it('has the database refuse a second open attempt even if the service did not', async () => {
    const { application, demand } = await demandedApplication();
    const first = await initiatePayment(ltp, demand.id, META);

    // Bypassing the service entirely — the constraint is the last line, and
    // this is what proves it is really there.
    await expect(
      prisma.payment.create({
        data: {
          applicationFeeId: demand.id,
          applicationId: application.id,
          paymentRef: `${first.payment.paymentRef}-DUP`,
          provider: 'mock',
          amount: demand.totalAmount,
          status: 'PENDING',
          initiatedById: ltp.id,
        },
      })
    ).rejects.toThrow();
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Cancelled
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('cancellation', () => {
  it('closes the attempt and charges nothing when the gateway agrees', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    const outcome = await cancelPayment(ltp, started.payment.id, META);

    expect(outcome.status).toBe('CANCELLED');
    expect((await demandRow(demand.id)).paidAmount.toFixed(2)).toBe('0.00');
    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');
  }, 120_000);

  it('produces a receipt instead when the payer had already paid at the gateway', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    // The payer completed at the gateway and then pressed Cancel on our page.
    // Believing the click would lose the money.
    await configureMockGateway({ mode: 'AUTO_SUCCESS' });

    const outcome = await cancelPayment(ltp, started.payment.id, META);

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.receiptNumber).toBeTruthy();
    expect((await demandRow(demand.id)).status).toBe('PAID');
    expect(await statusOf(application.id)).toBe('PENDING_TPA');
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Duplicate callbacks
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('duplicate callbacks', () => {
  it('credits once however many times the same event is delivered', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    const amount = demand.totalAmount.toFixed(2);

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount }));
    }

    expect(results[0]).toMatchObject({ duplicate: false, settled: true });
    // The four that follow never reach the money: the unique key stops them.
    expect(results.slice(1).every((r) => r.duplicate)).toBe(true);

    const paid = await demandRow(demand.id);
    expect(paid.paidAmount.toFixed(2)).toBe(amount);

    expect(
      await prisma.paymentReceipt.count({ where: { payment: { applicationId: application.id } } })
    ).toBe(1);
    expect(await statusOf(application.id)).toBe('PENDING_TPA');

    expect(
      await prisma.paymentWebhookEvent.count({
        where: { paymentRef: started.payment.paymentRef },
      })
    ).toBe(1);
  }, 120_000);

  it('credits once when two DIFFERENT events both say the payment succeeded', async () => {
    const { demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    const amount = demand.totalAmount.toFixed(2);

    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount, eventId: 'evt-one' });
    // Not caught by the unique key. `settlementLockAt` is what stops this one.
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount, eventId: 'evt-two' });

    expect((await demandRow(demand.id)).paidAmount.toFixed(2)).toBe(amount);
    expect(
      await prisma.paymentReceipt.count({ where: { payment: { paymentRef: started.payment.paymentRef } } })
    ).toBe(1);
  }, 120_000);

  it('refuses a callback whose signature does not verify', async () => {
    const { demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    const forged = new Request('http://localhost/api/payments/webhook/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lams-mock-signature': 'not-a-signature' },
      body: JSON.stringify({
        eventId: 'forged',
        paymentRef: started.payment.paymentRef,
        state: 'SUCCESS',
        amount: demand.totalAmount.toFixed(2),
      }),
    });

    await expect(handleWebhook('mock', forged)).rejects.toThrow(/signature is not valid/i);

    expect((await demandRow(demand.id)).paidAmount.toFixed(2)).toBe('0.00');
    // Nothing unverified is recorded: an unsigned payload is evidence of
    // nothing and does not belong in the table of what the gateway said.
    expect(
      await prisma.paymentWebhookEvent.count({ where: { paymentRef: started.payment.paymentRef } })
    ).toBe(0);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Incorrect amount
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('an amount that does not match the demand', () => {
  it('credits nothing at all — neither figure', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    // Money is a Float column, not a Prisma Decimal: plain arithmetic.
    const short = (demand.totalAmount - 100).toFixed(2);
    const result = await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: short });

    expect(result.status).toBe('FAILED');

    const unpaid = await demandRow(demand.id);
    expect(unpaid.paidAmount.toFixed(2)).toBe('0.00');
    expect(unpaid.status).toBe('ISSUED');

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { paymentRef: started.payment.paymentRef },
      select: { status: true, failureReason: true, settlementLockAt: true },
    });
    expect(payment.status).toBe('FAILED');
    expect(payment.failureReason).toMatch(/mismatch/i);
    // Locked, so no retry of the sweep can settle it behind a human's back.
    expect(payment.settlementLockAt).not.toBeNull();

    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');
  }, 120_000);

  it('names the mismatch in the audit trail under its own action', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    await gatewaySays(started.payment.paymentRef, 'SUCCESS', {
      amount: (demand.totalAmount + 1).toFixed(2),
    });

    const row = await prisma.auditLog.findFirst({
      where: { applicationId: application.id, action: 'PAYMENT_AMOUNT_MISMATCH' },
      orderBy: { seq: 'desc' },
      select: { after: true },
    });

    expect(row).not.toBeNull();
    expect((row!.after as Record<string, unknown>).credited).toBe(false);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. An invalid transaction
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a callback we cannot place', () => {
  it('is recorded, flagged and acknowledged, and credits nothing', async () => {
    const result = await gatewaySays('PAY-1999-99999999', 'SUCCESS', { amount: '100.00' });

    expect(result).toMatchObject({ received: true, duplicate: false, settled: false, status: null });

    const event = await prisma.paymentWebhookEvent.findFirstOrThrow({
      where: { paymentRef: 'PAY-1999-99999999' },
      select: { processed: true, error: true, paymentId: true, signatureOk: true },
    });

    expect(event.signatureOk).toBe(true);
    expect(event.processed).toBe(true);
    expect(event.paymentId).toBeNull();
    expect(event.error).toMatch(/No payment matches/i);

    await prisma.paymentWebhookEvent.deleteMany({ where: { paymentRef: 'PAY-1999-99999999' } });
  }, 60_000);

  it('refuses to settle a payment id that is not the caller’s', async () => {
    const { demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    const stranger = actorFor('00000000-0000-0000-0000-0000000000aa', 'Stranger', [ROLES.LTP], {
      capabilities: ['PAYMENT_VIEW', 'PAYMENT_INITIATE'],
    });

    await expect(verifyPayment(stranger, started.payment.id, META)).rejects.toThrow(/could not be found/i);
  }, 120_000);

  it('refuses to pay a demand that has been paid already', async () => {
    const { demand } = await demandedApplication();
    const first = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(first.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    await expect(initiatePayment(ltp, demand.id, META)).rejects.toThrow(/paid in full/i);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Receipts
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the receipt', () => {
  it('carries everything §7 asks for, frozen at settlement', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const receipt = await prisma.paymentReceipt.findFirstOrThrow({
      where: { payment: { applicationId: application.id } },
      select: { id: true, receiptNumber: true, snapshot: true },
    });

    const snapshot = receipt.snapshot as Record<string, never>;
    const payment = snapshot.payment as unknown as Record<string, string>;

    expect((snapshot.application as unknown as Record<string, string>).applicationNumber)
      .toBe(application.applicationNumber);
    expect((snapshot.applicant as unknown as Record<string, string>).name).toBe('Ravi Kumar');
    expect(payment.gatewayTxnId).toBeTruthy();
    expect(payment.settledAt).toBeTruthy();
    expect(payment.amount).toBe(demand.totalAmount.toFixed(2));
    expect(payment.status).toBe('SUCCESS');
    expect((snapshot.demand as unknown as Record<string, string>).demandNumber).toBe(demand.demandNumber);
    expect((snapshot.lines as unknown as unknown[]).length).toBeGreaterThan(0);
    expect(snapshot.isDemo).toBe(true);
  }, 120_000);

  it('renders a printable document that says it is a demonstration', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const row = await prisma.paymentReceipt.findFirstOrThrow({
      where: { payment: { applicationId: application.id } },
      select: { id: true },
    });

    const rendered = await ensureReceipt(row.id);
    expect(rendered.storageKey).toBeTruthy();

    const { storage } = await import('@/server/storage');
    const html = (await storage.get(rendered.storageKey)).toString('utf8');

    expect(html).toContain(application.applicationNumber);
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain(demand.demandNumber);
    // A demonstration receipt must be impossible to mistake for a real one.
    expect(html).toContain('DEMO PAYMENT');
  }, 120_000);

  it('cannot have its money edited, or be deleted', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const receipt = await prisma.paymentReceipt.findFirstOrThrow({
      where: { payment: { applicationId: application.id } },
      select: { id: true },
    });

    await expect(
      prisma.paymentReceipt.update({ where: { id: receipt.id }, data: { amount: 1 } })
    ).rejects.toThrow(/only storageKey may be updated/i);

    await expect(
      prisma.paymentReceipt.delete({ where: { id: receipt.id } })
    ).rejects.toThrow(/cannot be deleted/i);

    // The one field that may move, because the artefact is regenerable.
    await expect(
      prisma.paymentReceipt.update({ where: { id: receipt.id }, data: { storageKey: 'moved' } })
    ).resolves.toBeTruthy();
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Never trusting the browser
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the browser is never believed', () => {
  it('does not settle on a return the gateway has not confirmed', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    // The payer is back on the return page. The gateway says nothing has
    // happened, so nothing has happened — whatever the URL claimed.
    const outcome = await verifyPayment(ltp, started.payment.id, META);

    expect(outcome.status).toBe('PROCESSING');
    expect(outcome.changed).toBe(true);
    expect((await demandRow(demand.id)).paidAmount.toFixed(2)).toBe('0.00');
    expect(await statusOf(application.id)).toBe('PAYMENT_PENDING');
  }, 120_000);

  it('settles from the gateway alone when the return page asks again', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    await configureMockGateway({ mode: 'AUTO_SUCCESS' });
    const outcome = await verifyPayment(ltp, started.payment.id, META);

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.receiptNumber).toBeTruthy();
    expect(await statusOf(application.id)).toBe('PENDING_TPA');
  }, 120_000);

  it('cannot be forced to SUCCESS by writing the row directly', async () => {
    const { demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    // The CHECK constraint: SUCCESS without having been through the
    // settlement lock is not a state this table can hold.
    await expect(
      prisma.payment.update({
        where: { id: started.payment.id },
        data: { status: 'SUCCESS', settledAt: new Date() },
      })
    ).rejects.toThrow();
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Timeout and reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the payer who closed the browser', () => {
  it('is caught by the sweep and settled without a browser ever returning', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);

    // The payment happened at the gateway; no webhook arrived and nobody came
    // back to the return page.
    await configureMockGateway({ mode: 'AUTO_SUCCESS' });
    await setPaymentSetting('payment_reconcile_after_minutes', '0');

    const report = await reconcilePayments();
    expect(report.settled).toBeGreaterThanOrEqual(1);

    expect((await demandRow(demand.id)).status).toBe('PAID');
    expect(await statusOf(application.id)).toBe('PENDING_TPA');

    void started;
    await setPaymentSetting('payment_reconcile_after_minutes', '10');
  }, 120_000);

  it('times out an attempt past its window, and the LTP can start a new one', async () => {
    const { application, demand } = await demandedApplication();

    await setPaymentSetting('payment_attempt_ttl_minutes', '0');
    const started = await initiatePayment(ltp, demand.id, META);

    // TTL of zero means the attempt is already past its window; the gateway
    // still says nothing.
    await prisma.payment.update({
      where: { id: started.payment.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const outcome = await settle(started.payment.id, 'RECONCILE');
    expect(outcome.status).toBe('TIMEOUT');
    expect(await statusOf(application.id)).toBe('PAYMENT_FAILED');

    await setPaymentSetting('payment_attempt_ttl_minutes', '30');

    const retry = await initiatePayment(ltp, demand.id, META);
    expect(retry.payment.attemptNo).toBe(2);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Independence from the mock
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the application is not coupled to one gateway', () => {
  it('reaches identical state through a driver that shares nothing with the mock', async () => {
    const { application, demand } = await demandedApplication();

    // A driver written for this test only: different name, different shape,
    // no shared code with MockPaymentProvider. If any service, route or guard
    // knew which gateway was live, this would fail.
    const stub: PaymentProvider = {
      name: 'stub-gateway',
      configured: true,
      isDemo: false,
      async initiate() {
        return { providerOrderId: 'stub-1', formPost: { action: 'https://stub.test/pay', fields: { a: '1' } } };
      },
      async verify(): Promise<ProviderStatus> {
        return {
          state: 'SUCCESS',
          gatewayTxnId: 'stub-txn-1',
          bankRef: 'STUBREF',
          method: 'NETBANKING',
          amount: demand.totalAmount.toFixed(2),
          message: 'Stub gateway.',
        };
      },
      async parseWebhook() {
        throw new Error('not used');
      },
    };

    __setPaymentProviderForTests(stub);
    expect(currentProvider().name).toBe('stub-gateway');

    const started = await initiatePayment(ltp, demand.id, META);
    expect(started.formPost?.action).toBe('https://stub.test/pay');
    expect(started.redirectUrl).toBeNull();

    const outcome = await settle(started.payment.id, 'VERIFY');

    expect(outcome.status).toBe('SUCCESS');
    expect((await demandRow(demand.id)).status).toBe('PAID');
    expect(await statusOf(application.id)).toBe('PENDING_TPA');

    const receipt = await prisma.paymentReceipt.findFirstOrThrow({
      where: { payment: { applicationId: application.id } },
      select: { snapshot: true },
    });
    // The receipt records the real driver, and is not watermarked as a demo.
    expect((receipt.snapshot as Record<string, never>).provider).toBe('stub-gateway');
    expect((receipt.snapshot as Record<string, never>).isDemo).toBe(false);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. What the screens are given
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the payments payload', () => {
  it('carries the demand breakdown, the attempts and the gate', async () => {
    const { application, demand } = await demandedApplication();

    const before = await getPayments(ltp, application.id);
    expect(before.canInitiate).toBe(true);
    expect(before.blockedReason).toBeNull();
    expect(before.demands).toHaveLength(1);
    expect(before.demands[0]!.charges.length).toBeGreaterThan(0);
    expect(before.summary.balance.toFixed(2)).toBe(demand.totalAmount.toFixed(2));

    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const after = await getPayments(ltp, application.id);
    expect(after.canInitiate).toBe(false);
    expect(after.blockedReason).toMatch(/paid in full/i);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]!.receipt?.receiptNumber).toBeTruthy();
    expect(after.summary.balance.toFixed(2)).toBe('0.00');
  }, 120_000);

  it('lets finance see a payment it did not make', async () => {
    const { application, demand } = await demandedApplication();
    const started = await initiatePayment(ltp, demand.id, META);
    await gatewaySays(started.payment.paymentRef, 'SUCCESS', { amount: demand.totalAmount.toFixed(2) });

    const seen = await getPayments(finance, application.id);
    expect(seen.payments).toHaveLength(1);
    expect(seen.canInitiate).toBe(false);
  }, 120_000);
});
