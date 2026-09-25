import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma, type Db, type Tx } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isPublicApplicant } from '@/server/public-portal/actor';
import { can, type AuthUser } from '@/server/auth/context';
import { env } from '@/server/config/env';
import { audit } from './audit';
import { emit, EVENTS } from '@/server/events/outbox';
import { recordEvent, EVENT_TYPES } from './timeline';
import { startWorkflow } from '@/server/workflow/engine';
import { ACTIONS } from '@/lib/workflow';
import { nextSequence, formatNumber } from './numbering';
import { settingNumber, settingString } from './settings';
import { enqueue, JOB_TYPES } from '@/server/jobs/queue';
import { currentProvider, providerByName } from '@/server/payments';
import type { ProviderStatus } from '@/server/payments';
import { businessRule, forbidden, guardFailed, notFound, serviceUnavailable } from '@/server/http/errors';
import { CAPABILITIES } from '@/lib/constants';
import {
  amountsAgree,
  canTransition,
  isOpenPayment,
  isRetryable,
  whyCannotPay,
  type PaymentStatusKey,
} from '@/lib/payments';
import { isUuid } from '@/lib/utils';

/**
 * The payment engine — docs/07-subsystems.md O.
 *
 * ── The three rules this file exists to hold ───────────────────────────
 *
 * 1. THE BROWSER IS NEVER BELIEVED. Nothing a client sends settles anything.
 *    The return page's query string is used for exactly one purpose: deciding
 *    that it is worth calling `settle()`. Every path — the return, the
 *    webhook, the sweep, a finance officer pressing Reconcile — converges on
 *    `settle()`, and `settle()` takes its verdict from `provider.verify()`, a
 *    server-to-server call, and from nothing else.
 *
 * 2. DUPLICATE CALLBACKS ARE FREE. `payment_webhook_events (provider,
 *    externalId)` is unique, so a redelivery is a no-op before any money is
 *    touched. And `payments.settlementLockAt`, stamped inside the settlement
 *    transaction while the row is held FOR UPDATE, means even two DIFFERENT
 *    events for one payment credit it once.
 *
 * 3. FAILURE NEVER ADVANCES THE APPLICATION. There is no branch in
 *    `advanceOnPaymentSuccess` that can be reached from a failed payment: the
 *    function is called from one place, inside the SUCCESS arm, and it
 *    re-derives from the demands rather than trusting the payment it was
 *    called for.
 *
 * ── One settlement function, on purpose ────────────────────────────────
 *
 * `settle()` is the single place a payment becomes state, in the same way
 * `applyOutcome()` is for scrutiny. Four delivery routes, one behaviour. The
 * alternative — a webhook handler and a return handler that each credit a
 * demand — is two implementations of the most consequential transaction in the
 * system, which will drift, and the drift will be discovered in an account.
 *
 * ── And no amount is ever taken from a caller ──────────────────────────
 *
 * Not from the client, not from the webhook body, not from the return URL. The
 * amount charged is the demand's own balance, and the amount CREDITED is
 * checked against what the gateway independently reports. They disagree, and
 * the settlement refuses outright rather than crediting either figure.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

/** Where a settlement attempt came from. Recorded on the ledger row. */
export type SettlementSource = 'RETURN' | 'WEBHOOK' | 'VERIFY' | 'RECONCILE';

const DEFAULT_RECEIPT_FORMAT = '{prefix}/{year}/{seq:6}';

// ═══════════════════════════════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════════════════════════════

const DEMAND_SELECT = {
  id: true,
  demandNumber: true,
  type: true,
  status: true,
  subtotal: true,
  adjustmentTotal: true,
  totalAmount: true,
  paidAmount: true,
  dueDate: true,
  issuedAt: true,
  paidAt: true,
  applicationId: true,
  lineItems: {
    orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }],
    select: {
      id: true,
      kind: true,
      componentCode: true,
      componentName: true,
      headOfAccount: true,
      basis: true,
      variableName: true,
      variableValue: true,
      rateApplied: true,
      computedAmount: true,
      amount: true,
      calculationNote: true,
      displayOrder: true,
    },
  },
} satisfies Prisma.ApplicationFeeSelect;

const PAYMENT_SELECT = {
  id: true,
  paymentRef: true,
  provider: true,
  status: true,
  amount: true,
  attemptNo: true,
  providerOrderId: true,
  gatewayTxnId: true,
  bankRef: true,
  method: true,
  initiatedById: true,
  initiatedAt: true,
  settledAt: true,
  settlementLockAt: true,
  failureReason: true,
  expiresAt: true,
  lastVerifiedAt: true,
  verifyAttempts: true,
  applicationId: true,
  applicationFeeId: true,
  transactions: {
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      attemptNo: true,
      direction: true,
      status: true,
      gatewayTxnId: true,
      bankRef: true,
      method: true,
      amount: true,
      message: true,
      occurredAt: true,
    },
  },
  receipt: {
    select: { id: true, receiptNumber: true, amount: true, issuedAt: true, storageKey: true },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

/** Resolves a payment the caller may read, scoped through its application. */
export async function requirePayment(user: AuthUser, paymentId: string) {
  if (!isUuid(paymentId)) throw notFound('That payment could not be found.');

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, application: { deletedAt: null, ...applicationScope(user) } },
    select: {
      ...PAYMENT_SELECT,
      application: { select: { id: true, applicationNumber: true, status: true } },
      fee: { select: DEMAND_SELECT },
    },
  });

  if (!payment) throw notFound('That payment could not be found.');
  return payment;
}

async function requireDemand(user: AuthUser, demandId: string) {
  if (!isUuid(demandId)) throw notFound('That demand could not be found.');

  const demand = await prisma.applicationFee.findFirst({
    // The public portal's payer is not scoped to a jurisdiction or an LTP: whoever holds an
    // application number and the applicant's mobile may make the demonstration payment. The actor
    // is built only by `src/server/public-portal/payments.ts`, after it has checked both.
    where: { id: demandId, application: { deletedAt: null, ...(isPublicApplicant(user) ? {} : applicationScope(user)) } },
    select: {
      ...DEMAND_SELECT,
      application: {
        select: {
          id: true,
          applicationNumber: true,
          status: true,
          ltpUserId: true,
          applicant: { select: { name: true, email: true, phone: true } },
        },
      },
    },
  });

  if (!demand) throw notFound('That demand could not be found.');
  return demand;
}

// ═══════════════════════════════════════════════════════════════════════════
// Initiating
// ═══════════════════════════════════════════════════════════════════════════

export type InitiatedPayment = {
  payment: ReturnType<typeof shapePayment>;
  /** Hosted-checkout gateways. */
  redirectUrl: string | null;
  /** Form-post gateways — PayU, CCAvenue. Already signed by the driver. */
  formPost: { action: string; fields: Record<string, string> } | null;
  /** Anything the payment page needs to open an SDK checkout. No secrets. */
  payload: Record<string, unknown>;
  /** True when this call joined an attempt that was already open. */
  reused: boolean;
  gateway: { name: string; isDemo: boolean };
};

/**
 * Starts a payment against a demand.
 *
 * ── Idempotent per demand, structurally ────────────────────────────────
 *
 * Two browser tabs pressing Pay together must not produce two live payment
 * windows against one demand — that is how a demand gets paid twice. Three
 * things stop it, in order of how much they are relied on:
 *
 *   · this function looks for an open attempt and joins it;
 *   · the claim on the application row is a compare-and-set;
 *   · `payment_one_open_per_demand`, a partial unique index, makes the second
 *     INSERT impossible even if both checks above were somehow passed.
 *
 * The third is the one that is load-bearing. The first two are for producing a
 * sensible answer rather than a constraint violation.
 *
 * ── The gateway is called OUTSIDE the transaction ──────────────────────
 *
 * The row is written first, then the gateway is told. Holding a database
 * transaction open across a network call to a third party is how a slow
 * gateway becomes a lock queue and then an outage. The cost is that a failed
 * `initiate()` leaves a row at INITIATED — which is correct and wanted: that
 * row is the evidence the attempt was made, the sweep will resolve it, and a
 * payment we started but cannot account for is exactly the thing that must not
 * be silently dropped.
 */
export async function initiatePayment(
  user: AuthUser,
  demandId: string,
  meta: Meta
): Promise<InitiatedPayment> {
  const demand = await requireDemand(user, demandId);
  const app = demand.application;

  const balance = Number(demand.totalAmount) - Number(demand.paidAmount);

  const blocked = whyCannotPay({
    applicationStatus: app.status,
    demandStatus: demand.status,
    demandType: demand.type,
    balance,
  });
  if (blocked) throw guardFailed(blocked);

  const provider = currentProvider();
  if (!provider.configured) {
    throw serviceUnavailable(
      `Online payment is not available: the ${provider.name} gateway is not configured.`
    );
  }

  // ── Join an attempt that is already open ──────────────────────────────
  const open = await prisma.payment.findFirst({
    where: { applicationFeeId: demand.id, status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] } },
    select: PAYMENT_SELECT,
  });

  if (open) {
    const stored = await storedInitiateResult(open.id);
    return {
      payment: shapePayment(open),
      redirectUrl: stored.redirectUrl,
      formPost: stored.formPost,
      payload: stored.payload,
      reused: true,
      gateway: { name: provider.name, isDemo: provider.isDemo },
    };
  }

  const ttlMinutes = await settingNumber('payment_attempt_ttl_minutes', 30);
  const now = new Date();

  // ── Write the attempt ─────────────────────────────────────────────────
  const created = await prisma.$transaction(async (tx) => {
    // Re-read the demand inside the transaction. Between the checks above and
    // here, the demand could have been cancelled or settled by a webhook.
    const fresh = await tx.applicationFee.findUnique({
      where: { id: demand.id },
      select: { status: true, totalAmount: true, paidAmount: true },
    });

    if (!fresh) throw notFound('That demand could not be found.');

    const due = Number(fresh.totalAmount) - Number(fresh.paidAmount);
    const stillBlocked = whyCannotPay({
      applicationStatus: app.status,
      demandStatus: fresh.status,
      demandType: demand.type,
      balance: due,
    });
    if (stillBlocked) throw guardFailed(stillBlocked);

    const attemptNo = (await tx.payment.count({ where: { applicationFeeId: demand.id } })) + 1;
    const paymentRef = await allocatePaymentRef(tx, now);

    const payment = await tx.payment.create({
      data: {
        applicationFeeId: demand.id,
        applicationId: app.id,
        paymentRef,
        provider: provider.name,
        amount: due,
        status: 'INITIATED',
        attemptNo,
        initiatedById: user.id,
        initiatedAt: now,
        expiresAt: ttlMinutes > 0 ? new Date(now.getTime() + ttlMinutes * 60_000) : null,
      },
      select: PAYMENT_SELECT,
    });

    // The application enters the payment stage. Compare-and-set, so two
    // simultaneous initiations cannot both claim it — and deliberately NOT
    // conditional on the payment, because the status describes where the
    // application is, not what one attempt is doing.
    await tx.application.updateMany({
      where: { id: app.id, status: { in: ['FEE_GENERATED', 'PAYMENT_FAILED'] } },
      data: { status: 'PAYMENT_PENDING', updatedAt: now },
    });

    await audit(tx, {
      actor: user,
      action: 'PAYMENT_INITIATED',
      entityType: 'Payment',
      entityId: payment.id,
      applicationId: app.id,
      after: {
        paymentRef,
        provider: provider.name,
        isDemo: provider.isDemo,
        amount: due.toFixed(2),
        attemptNo,
        demandNumber: demand.demandNumber,
      },
      ...meta,
    });

    return payment;
  });

  // ── Tell the gateway ──────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof provider.initiate>>;

  try {
    result = await provider.initiate({
      paymentRef: created.paymentRef,
      amount: created.amount.toFixed(2),
      currency: 'INR',
      description: `${env.appName} — ${demand.demandNumber}`,
      applicationNumber: app.applicationNumber,
      demandNumber: demand.demandNumber,
      payer: {
        name: app.applicant?.name ?? user.name,
        email: app.applicant?.email || user.email,
        phone: app.applicant?.phone ?? '',
      },
      returnUrl: `${env.appUrl}/payments/${created.id}/return`,
      webhookUrl: `${env.appUrl}/api/payments/webhook/${provider.name}`,
    });
  } catch (err) {
    // The gateway refused to open a session. The row stays at INITIATED with
    // the reason on its ledger, so the sweep can close it out and the LTP is
    // not left looking at a payment that never existed anywhere.
    const message = err instanceof Error ? err.message : String(err);

    await recordTransaction(prisma, created, {
      direction: 'INITIATE',
      status: 'INITIATED',
      message: `Gateway refused to start the payment: ${message}`.slice(0, 500),
      payload: { error: message },
    });

    throw serviceUnavailable(
      'The payment gateway could not be reached. Nothing has been charged — try again in a moment.'
    );
  }

  // PENDING: the gateway knows about it and is waiting for the payer.
  const payment = await prisma.payment.update({
    where: { id: created.id },
    data: {
      status: 'PENDING',
      providerOrderId: result.providerOrderId ?? '',
    },
    select: PAYMENT_SELECT,
  });

  await recordTransaction(prisma, payment, {
    direction: 'INITIATE',
    status: 'PENDING',
    message: 'Payment session opened with the gateway.',
    // The initiate result is stored on the ledger rather than on the payment
    // row: it is what the gateway said at one moment, which is precisely what
    // an append-only ledger is for — and it is what a rejoining tab reads
    // back, so a second Pay press never creates a second gateway session.
    payload: {
      providerOrderId: result.providerOrderId ?? '',
      redirectUrl: result.redirectUrl ?? '',
      formPost: result.formPost ?? null,
      payload: result.payload ?? {},
    },
  });

  return {
    payment: shapePayment(payment),
    redirectUrl: result.redirectUrl ?? null,
    formPost: result.formPost ?? null,
    payload: result.payload ?? {},
    reused: false,
    gateway: { name: provider.name, isDemo: provider.isDemo },
  };
}

/**
 * Reads back what the gateway said when this attempt was opened.
 *
 * From the append-only ledger, so rejoining an open attempt hands the payer
 * the SAME gateway session rather than opening a second one — which for a
 * gateway that bills per order is not merely untidy.
 */
async function storedInitiateResult(paymentId: string) {
  const row = await prisma.paymentTransaction.findFirst({
    where: { paymentId, direction: 'INITIATE', status: 'PENDING' },
    orderBy: { occurredAt: 'desc' },
    select: { rawPayload: true },
  });

  const raw = (row?.rawPayload ?? {}) as Record<string, unknown>;

  return {
    redirectUrl: typeof raw.redirectUrl === 'string' && raw.redirectUrl ? raw.redirectUrl : null,
    formPost: (raw.formPost as InitiatedPayment['formPost']) ?? null,
    payload: (raw.payload as Record<string, unknown>) ?? {},
  };
}

/**
 * `PAY-2026-00000042`.
 *
 * Not the configurable `{prefix}/{year}/{seq:6}` format the demand and receipt
 * numbers use, and deliberately: this string is sent to a third party, and
 * gateways restrict what a merchant reference may contain — PayU's `txnid` and
 * CCAvenue's `order_id` both reject a slash. A reference that a department
 * could reformat into something a gateway rejects would fail at the worst
 * possible moment, so its shape is fixed here rather than configured.
 *
 * Gap-free from the same allocator as every other number in the system, and
 * allocated inside the caller's transaction.
 */
async function allocatePaymentRef(tx: Tx, now: Date): Promise<string> {
  const year = now.getFullYear();
  const seq = await nextSequence(tx, `payment:PAY:${year}`);
  return `PAY-${year}-${String(seq).padStart(8, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Settlement — the single path
// ═══════════════════════════════════════════════════════════════════════════

export type SettlementOutcome = {
  paymentId: string;
  paymentRef: string;
  status: PaymentStatusKey;
  /** True when this call is what settled it, rather than finding it settled. */
  changed: boolean;
  message: string;
  receiptNumber: string | null;
  applicationStatus: string;
};

/**
 * Settles one payment. THE only function that may.
 *
 * ── Order of operations, and why it is this order ──────────────────────
 *
 *   1. read the payment, cheaply, and stop if it is already decided
 *   2. ask the gateway — OUTSIDE any transaction
 *   3. open a transaction, lock the row FOR UPDATE, re-read
 *   4. stop again if it was decided while we were asking
 *   5. apply
 *
 * Step 2 is outside the transaction because it is a network call to a third
 * party, and a transaction held open across one blocks every other writer
 * touching these rows. Step 4 exists precisely BECAUSE step 2 is outside: two
 * settlements can be in flight at once — a webhook and the return page,
 * routinely — and the second must find the row already locked and do nothing.
 *
 * `settlementLockAt` is what makes step 4 work. It is stamped for every
 * DECIDED outcome, not only success, so a failed attempt cannot be revived by
 * a late callback either.
 *
 * No `user` argument. Settlement is a system act: the same code runs for a
 * webhook nobody is watching, for a sweep at three in the morning, and for a
 * payer who came back to the return page. Making it depend on who asked would
 * be making the money depend on who asked.
 */
export async function settle(paymentId: string, source: SettlementSource): Promise<SettlementOutcome> {
  const before = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      paymentRef: true,
      provider: true,
      status: true,
      settlementLockAt: true,
      providerOrderId: true,
      applicationId: true,
      application: { select: { status: true } },
      receipt: { select: { receiptNumber: true } },
    },
  });

  if (!before) throw notFound('That payment could not be found.');

  // Already decided. No gateway call, no lock, no work.
  if (before.settlementLockAt) {
    return {
      paymentId: before.id,
      paymentRef: before.paymentRef,
      status: before.status as PaymentStatusKey,
      changed: false,
      message: 'This payment has already been settled.',
      receiptNumber: before.receipt?.receiptNumber ?? null,
      applicationStatus: before.application.status,
    };
  }

  const provider = providerByName(before.provider);
  if (!provider) {
    throw serviceUnavailable(`No driver is available for the "${before.provider}" gateway.`);
  }

  // ── The one authoritative question ────────────────────────────────────
  const status = await provider.verify(before.paymentRef, {
    providerOrderId: before.providerOrderId,
  });

  return applyVerification(before.id, source, status, provider.isDemo);
}

/**
 * Applies a verified gateway verdict.
 *
 * Split from `settle()` so the whole of the money-moving part runs inside one
 * transaction with the row locked, and so a test can drive it with a
 * synthesised `ProviderStatus` without a driver.
 */
async function applyVerification(
  paymentId: string,
  source: SettlementSource,
  status: ProviderStatus,
  isDemo: boolean
): Promise<SettlementOutcome> {
  return prisma.$transaction(async (tx) => {
    // ── The lock ──────────────────────────────────────────────────────
    //
    // On SQLite, write transactions are serialized automatically.
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        ...PAYMENT_SELECT,
        application: { select: { id: true, applicationNumber: true, status: true, ltpUserId: true } },
        fee: { select: DEMAND_SELECT },
      },
    });

    // Decided while we were asking the gateway. Nothing to do — and this is
    // the normal case, not an error: a webhook and a return page racing is
    // ordinary traffic.
    if (payment.settlementLockAt) {
      return {
        paymentId,
        paymentRef: payment.paymentRef,
        status: payment.status as PaymentStatusKey,
        changed: false,
        message: 'This payment had already been settled.',
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        applicationStatus: payment.application.status,
      };
    }

    const now = new Date();

    await tx.payment.update({
      where: { id: paymentId },
      data: { lastVerifiedAt: now, verifyAttempts: { increment: 1 } },
    });

    // ── PENDING: the gateway has not finished ─────────────────────────
    if (status.state === 'PENDING') {
      return pendingOrTimeout(tx, payment, source, status, now);
    }

    // ── The state machine ─────────────────────────────────────────────
    //
    // A verdict the machine does not allow from here is recorded and refused,
    // never applied. The case this exists for: a late SUCCESS on an attempt
    // that already failed or timed out. That is money the department may hold
    // and cannot account for, and it is a finance problem — not something to
    // resolve by quietly overwriting a settled row.
    if (!canTransition(payment.status, status.state)) {
      await recordTransaction(tx, payment, {
        direction: source,
        status: status.state,
        message: `Refused: the gateway reported ${status.state} for a payment already ${payment.status}.`,
        gatewayTxnId: status.gatewayTxnId,
        payload: status.raw,
      });

      await audit(tx, {
        action: 'PAYMENT_LATE_VERDICT',
        entityType: 'Payment',
        entityId: payment.id,
        applicationId: payment.applicationId,
        before: { status: payment.status },
        after: { gatewayState: status.state, gatewayTxnId: status.gatewayTxnId ?? '' },
        remarks: 'A settled payment received a later, different verdict. Finance must reconcile it.',
      });

      console.error(
        `[payments] LATE VERDICT ${payment.paymentRef}: gateway says ${status.state}, row is ${payment.status}`
      );

      return {
        paymentId,
        paymentRef: payment.paymentRef,
        status: payment.status as PaymentStatusKey,
        changed: false,
        message: 'This payment was already settled. The department has been notified of the discrepancy.',
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        applicationStatus: payment.application.status,
      };
    }

    if (status.state === 'SUCCESS') {
      return settleSuccess(tx, payment, source, status, now, isDemo);
    }

    return settleFailure(tx, payment, source, status, now);
  },
  // Prisma's default is five seconds, and this transaction outgrew it in
  // Phase 6. A successful settlement now credits the demand, issues a receipt
  // with its frozen snapshot, AND starts the departmental workflow — which
  // evaluates the `fees_paid` guard, resolves the assignment rule, opens the
  // first task, starts an SLA clock against the holiday calendar and writes
  // the history, timeline, audit and outbox rows.
  //
  // Timing out here would be the worst failure this file has: the gateway has
  // confirmed the money, and the whole transaction rolls back. The reconcile
  // sweep would eventually repair it, but "eventually" is measured in minutes
  // with an applicant watching a page. A longer worst-case hold on one payment
  // row is the cheaper end of that trade.
    { timeout: 20_000 }
  );
}

type LockedPayment = PaymentRow & {
  application: { id: string; applicationNumber: string; status: string; ltpUserId: string };
  fee: Prisma.ApplicationFeeGetPayload<{ select: typeof DEMAND_SELECT }>;
};

/**
 * The gateway has not finished.
 *
 * Nothing is credited and nothing is failed. The attempt moves to PROCESSING
 * the first time we hear that the payer is at the gateway, and becomes TIMEOUT
 * once it is past its window — at which point the LTP may start a fresh
 * attempt, while the sweep KEEPS ASKING about this one for the give-up period.
 * Those two facts are deliberately separate: a timed-out window is a UI
 * decision, and a gateway that answers an hour late has still taken money.
 */
async function pendingOrTimeout(
  tx: Tx,
  payment: LockedPayment,
  source: SettlementSource,
  status: ProviderStatus,
  now: Date
): Promise<SettlementOutcome> {
  const expired = payment.expiresAt !== null && payment.expiresAt <= now;

  if (expired && canTransition(payment.status, 'TIMEOUT')) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'TIMEOUT',
        // Decided, so no further callback may revive it. The sweep still
        // verifies it — verification of a decided attempt records a late
        // verdict rather than changing the money.
        settlementLockAt: now,
        settledAt: now,
        failureReason: 'The payment gateway did not complete this payment in time.',
      },
    });

    await recordTransaction(tx, payment, {
      direction: 'TIMEOUT',
      status: 'TIMEOUT',
      message: status.message ?? 'The gateway did not complete the payment in time.',
      payload: status.raw,
    });

    await failApplication(tx, payment, now);

    await recordEvent(tx, {
      applicationId: payment.applicationId,
      type: EVENT_TYPES.PAYMENT_FAILED,
      title: 'Payment timed out',
      description: `${payment.paymentRef} — the gateway did not complete the payment in time. Nothing has been charged.`,
      metadata: { paymentId: payment.id, paymentRef: payment.paymentRef, outcome: 'TIMEOUT' },
    });

    await audit(tx, {
      action: 'PAYMENT_TIMED_OUT',
      entityType: 'Payment',
      entityId: payment.id,
      applicationId: payment.applicationId,
      before: { status: payment.status },
      after: { status: 'TIMEOUT', source },
    });

    return {
      paymentId: payment.id,
      paymentRef: payment.paymentRef,
      status: 'TIMEOUT',
      changed: true,
      message: 'The payment timed out. Nothing has been charged — you can try again.',
      receiptNumber: null,
      applicationStatus: 'PAYMENT_FAILED',
    };
  }

  // Still in its window. Move INITIATED/PENDING to PROCESSING the first time
  // we are asked from the browser's side, which is what the payer's screen
  // reads to know somebody is at the gateway.
  const next: PaymentStatusKey =
    source === 'RETURN' && canTransition(payment.status, 'PROCESSING')
      ? 'PROCESSING'
      : (payment.status as PaymentStatusKey);

  if (next !== payment.status) {
    await tx.payment.update({ where: { id: payment.id }, data: { status: next } });
  }

  await recordTransaction(tx, payment, {
    direction: source,
    status: next,
    message: status.message ?? 'The gateway has not completed this payment yet.',
    gatewayTxnId: status.gatewayTxnId,
    payload: status.raw,
  });

  return {
    paymentId: payment.id,
    paymentRef: payment.paymentRef,
    status: next,
    changed: next !== payment.status,
    message: 'This payment has not completed yet.',
    receiptNumber: null,
    applicationStatus: payment.application.status,
  };
}

/**
 * The gateway says the money was taken.
 *
 * ── The amount check is a refusal, not a warning ───────────────────────
 *
 * The gateway's figure and the demand's figure must agree to the paisa. When
 * they do not, this settlement REFUSES: no credit, no receipt, no advance, the
 * attempt marked failed with an explicit reason, and finance alerted. It never
 * credits the smaller of the two and never credits the larger.
 *
 * That is the only defensible behaviour. Crediting what the gateway says would
 * let a payer who can influence the gateway's amount pay less than they owe;
 * crediting what the demand says would book money the department did not
 * receive. Both corrupt an account, and an account is what this table is.
 */
async function settleSuccess(
  tx: Tx,
  payment: LockedPayment,
  source: SettlementSource,
  status: ProviderStatus,
  now: Date,
  isDemo: boolean
): Promise<SettlementOutcome> {
  const expected = Number(payment.amount);
  const reported = status.amount === null || status.amount === undefined ? null : Number(status.amount);

  if (reported === null || !Number.isFinite(reported) || !amountsAgree(expected, reported)) {
    return refuseAmount(tx, payment, source, status, now, expected, reported);
  }

  // ── The payment ───────────────────────────────────────────────────────
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SUCCESS',
      settlementLockAt: now,
      settledAt: now,
      gatewayTxnId: status.gatewayTxnId ?? null,
      bankRef: (status.bankRef ?? '').slice(0, 120),
      method: (status.method ?? '').slice(0, 40),
      failureReason: '',
    },
  });

  await recordTransaction(tx, payment, {
    direction: source,
    status: 'SUCCESS',
    message: status.message ?? 'Confirmed with the gateway.',
    gatewayTxnId: status.gatewayTxnId,
    bankRef: status.bankRef,
    method: status.method,
    amount: payment.amount,
    payload: status.raw,
  });

  // ── The demand ────────────────────────────────────────────────────────
  //
  // `increment`, not a computed total: the read-modify-write would race a
  // concurrent shortfall payment against the same demand. The
  // `paid_not_over_total` CHECK is the backstop — an over-credit fails the
  // transaction rather than corrupting the demand.
  const credited = await tx.applicationFee.update({
    where: { id: payment.applicationFeeId },
    data: { paidAmount: { increment: payment.amount } },
    select: { totalAmount: true, paidAmount: true },
  });

  const fullyPaid = Number(credited.paidAmount) >= Number(credited.totalAmount);

  await tx.applicationFee.update({
    where: { id: payment.applicationFeeId },
    data: {
      status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
      ...(fullyPaid ? { paidAt: now } : {}),
    },
  });

  // ── The receipt ───────────────────────────────────────────────────────
  //
  // The settled values are passed in rather than re-read: `payment` is the row
  // as it was when the lock was taken, and the transaction id, bank reference
  // and method were written moments ago. Snapshotting the stale row would
  // print a receipt with no transaction id on it — which is the one field §7
  // exists to guarantee.
  const receipt = await issueReceipt(tx, payment, now, isDemo, {
    gatewayTxnId: status.gatewayTxnId ?? '',
    bankRef: status.bankRef ?? '',
    method: status.method ?? '',
  });

  // ── The application ───────────────────────────────────────────────────
  await tx.application.updateMany({
    where: { id: payment.applicationId, status: { in: ['FEE_GENERATED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'] } },
    data: { status: 'PAYMENT_SUCCESSFUL', updatedAt: now },
  });

  await recordEvent(tx, {
    applicationId: payment.applicationId,
    type: EVENT_TYPES.PAYMENT_SUCCESSFUL,
    title: 'Payment received',
    description: `${payment.fee.demandNumber} — ${payment.amount.toFixed(2)} paid. Receipt ${receipt.receiptNumber}.`,
    metadata: {
      paymentId: payment.id,
      paymentRef: payment.paymentRef,
      receiptNumber: receipt.receiptNumber,
      gatewayTxnId: status.gatewayTxnId ?? '',
      method: status.method ?? '',
      isDemo,
    },
    occurredAt: now,
  });

  await audit(tx, {
    action: 'PAYMENT_SETTLED',
    entityType: 'Payment',
    entityId: payment.id,
    applicationId: payment.applicationId,
    before: { status: payment.status, paidAmount: payment.fee.paidAmount.toFixed(2) },
    after: {
      status: 'SUCCESS',
      source,
      amount: payment.amount.toFixed(2),
      gatewayTxnId: status.gatewayTxnId ?? '',
      bankRef: status.bankRef ?? '',
      method: status.method ?? '',
      receiptNumber: receipt.receiptNumber,
      demandStatus: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
      paidAmount: credited.paidAmount.toFixed(2),
      isDemo,
    },
  });

  await emit(tx, {
    eventCode: EVENTS.PAYMENT_SUCCESSFUL,
    applicationId: payment.applicationId,
    payload: {
      applicationNumber: payment.application.applicationNumber,
      demandNumber: payment.fee.demandNumber,
      amount: payment.amount.toFixed(2),
      receiptNumber: receipt.receiptNumber,
      ltpUserId: payment.application.ltpUserId,
    },
  });

  // ── The gate ──────────────────────────────────────────────────────────
  const applicationStatus = await advanceOnPaymentSuccess(tx, payment, now);

  // Warms the printable receipt. The download route renders on demand too, so
  // a worker that is behind delays nothing.
  await enqueue(tx, {
    type: JOB_TYPES.RENDER_RECEIPT,
    payload: { paymentReceiptId: receipt.id },
    dedupeKey: `receipt:${receipt.id}`,
  });

  return {
    paymentId: payment.id,
    paymentRef: payment.paymentRef,
    status: 'SUCCESS',
    changed: true,
    message: 'Payment received.',
    receiptNumber: receipt.receiptNumber,
    applicationStatus,
  };
}

/**
 * The gateway's amount does not match the demand.
 *
 * Recorded everywhere it can be seen: on the ledger, in the audit trail under
 * its own action name, on the timeline in the applicant's language, and on
 * stderr — because this is the one outcome in the payment path that needs a
 * person, and a person will not find it by browsing.
 */
async function refuseAmount(
  tx: Tx,
  payment: LockedPayment,
  source: SettlementSource,
  status: ProviderStatus,
  now: Date,
  expected: number,
  reported: number | null
): Promise<SettlementOutcome> {
  const detail =
    reported === null
      ? 'the gateway reported no amount'
      : `the gateway reported ${reported.toFixed(2)} against a demand of ${expected.toFixed(2)}`;

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      // Locked: never auto-settled again, by any route. Putting this right is
      // a human act with an audit trail, not a retry.
      settlementLockAt: now,
      settledAt: now,
      gatewayTxnId: status.gatewayTxnId ?? null,
      failureReason: `Amount mismatch — ${detail}. Referred to the finance office.`,
    },
  });

  await recordTransaction(tx, payment, {
    direction: source,
    status: 'FAILED',
    message: `PAYMENT_AMOUNT_MISMATCH — ${detail}. Nothing was credited.`,
    gatewayTxnId: status.gatewayTxnId,
    amount: reported === null ? null : reported.toFixed(2),
    payload: status.raw,
  });

  await failApplication(tx, payment, now);

  await recordEvent(tx, {
    applicationId: payment.applicationId,
    type: EVENT_TYPES.PAYMENT_FAILED,
    title: 'Payment could not be confirmed',
    description:
      `${payment.paymentRef} — the amount confirmed by the payment gateway does not match the demand, ` +
      'so nothing has been credited. The finance office has been notified and will contact you.',
    metadata: {
      paymentId: payment.id,
      paymentRef: payment.paymentRef,
      outcome: 'AMOUNT_MISMATCH',
      expected: expected.toFixed(2),
      reported: reported === null ? null : reported.toFixed(2),
    },
    occurredAt: now,
  });

  await audit(tx, {
    action: 'PAYMENT_AMOUNT_MISMATCH',
    entityType: 'Payment',
    entityId: payment.id,
    applicationId: payment.applicationId,
    before: { expected: expected.toFixed(2) },
    after: {
      reported: reported === null ? null : reported.toFixed(2),
      gatewayTxnId: status.gatewayTxnId ?? '',
      source,
      credited: false,
    },
    remarks: 'Settlement refused. No amount was credited to the demand.',
  });

  await emit(tx, {
    eventCode: EVENTS.PAYMENT_FAILED,
    applicationId: payment.applicationId,
    payload: {
      applicationNumber: payment.application.applicationNumber,
      demandNumber: payment.fee.demandNumber,
      reason: 'AMOUNT_MISMATCH',
      expected: expected.toFixed(2),
      reported: reported === null ? null : reported.toFixed(2),
      ltpUserId: payment.application.ltpUserId,
    },
  });

  console.error(
    `[payments] PAYMENT_AMOUNT_MISMATCH ${payment.paymentRef}: expected ${expected.toFixed(2)}, ${detail}`
  );

  return {
    paymentId: payment.id,
    paymentRef: payment.paymentRef,
    status: 'FAILED',
    changed: true,
    message:
      'This payment could not be confirmed: the amount reported by the gateway does not match the demand. ' +
      'Nothing has been credited and the finance office has been notified.',
    receiptNumber: null,
    applicationStatus: 'PAYMENT_FAILED',
  };
}

/** FAILED or CANCELLED. Nothing is credited and the application does not move on. */
async function settleFailure(
  tx: Tx,
  payment: LockedPayment,
  source: SettlementSource,
  status: ProviderStatus,
  now: Date
): Promise<SettlementOutcome> {
  const state = status.state === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  const reason =
    status.message ??
    (state === 'CANCELLED'
      ? 'The payment was cancelled at the gateway.'
      : 'The gateway did not complete this payment.');

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: state,
      settlementLockAt: now,
      settledAt: now,
      gatewayTxnId: status.gatewayTxnId ?? null,
      failureReason: reason.slice(0, 500),
    },
  });

  await recordTransaction(tx, payment, {
    direction: source,
    status: state,
    message: reason,
    gatewayTxnId: status.gatewayTxnId,
    payload: status.raw,
  });

  await failApplication(tx, payment, now);

  await recordEvent(tx, {
    applicationId: payment.applicationId,
    type: EVENT_TYPES.PAYMENT_FAILED,
    title: state === 'CANCELLED' ? 'Payment cancelled' : 'Payment failed',
    description: `${payment.paymentRef} — ${reason} Nothing has been charged; you can try again.`,
    metadata: { paymentId: payment.id, paymentRef: payment.paymentRef, outcome: state },
    occurredAt: now,
  });

  await audit(tx, {
    action: 'PAYMENT_FAILED',
    entityType: 'Payment',
    entityId: payment.id,
    applicationId: payment.applicationId,
    before: { status: payment.status },
    after: { status: state, source, reason, gatewayTxnId: status.gatewayTxnId ?? '' },
  });

  await emit(tx, {
    eventCode: EVENTS.PAYMENT_FAILED,
    applicationId: payment.applicationId,
    payload: {
      applicationNumber: payment.application.applicationNumber,
      demandNumber: payment.fee.demandNumber,
      reason: state,
      ltpUserId: payment.application.ltpUserId,
    },
  });

  return {
    paymentId: payment.id,
    paymentRef: payment.paymentRef,
    status: state,
    changed: true,
    message: reason,
    receiptNumber: null,
    applicationStatus: 'PAYMENT_FAILED',
  };
}

/**
 * Marks the application as having a failed payment.
 *
 * Conditional on the CURRENT status, which is what makes rule 3 structural:
 * the only statuses it will move are the two the application can be at while a
 * payment is in flight. An application that has already succeeded and moved to
 * PENDING_TPA cannot be dragged back by a late failure, because it is not in
 * the WHERE clause — not because an `if` remembered to check.
 */
async function failApplication(tx: Tx, payment: LockedPayment, now: Date): Promise<void> {
  await tx.application.updateMany({
    where: { id: payment.applicationId, status: { in: ['FEE_GENERATED', 'PAYMENT_PENDING'] } },
    data: { status: 'PAYMENT_FAILED', updatedAt: now },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The workflow gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PAYMENT_SUCCESSFUL → submitted to the department → PENDING_TPA.
 *
 * §8, and the only function in the codebase that writes PENDING_TPA from the
 * LTP side. Three properties are worth stating, because each was a choice:
 *
 * ── It re-derives, it does not trust ───────────────────────────────────
 *
 * The guard is "no live demand has an outstanding balance", counted here,
 * inside the settlement transaction, from `application_fees`. It is NOT "the
 * payment we just settled was successful". An application with two live
 * demands — an original and a shortfall — must not advance because one of them
 * was paid, and a guard phrased in terms of the payment in hand would let it.
 *
 * ── The move itself belongs to the workflow engine ─────────────────────
 *
 * This function decides WHETHER the file may go to the department; it does not
 * decide where "the department" is. `startWorkflow` creates the workflow
 * instance and performs the seeded CONFIRM_PAYMENT transition, which is what
 * writes the status, opens the first officer's task, starts the SLA clock and
 * records the first history row. Naming TPA here instead would put a stage
 * name in the payment service, and moving the first desk would then be a code
 * change in a file about money.
 *
 * Starting the run INSIDE this transaction is what makes §8 structural: the
 * money and the movement commit together, or neither does.
 *
 * ── Idempotent ─────────────────────────────────────────────────────────
 *
 * `startWorkflow` returns null when an instance already exists, and the
 * `one_active_instance` index would refuse a second one regardless. A
 * duplicate settlement therefore reports the status the file is actually at
 * rather than moving it again — which also covers the ordinary case of a
 * SHORTFALL demand being paid weeks later, while the file sits at a desk.
 *
 * ── There is no failure branch ─────────────────────────────────────────
 *
 * This function is called from exactly one place: the SUCCESS arm of
 * `settleSuccess`. There is no path from a failed, cancelled or timed-out
 * payment into it. §8 is enforced by the absence of a call, which is stronger
 * than a condition inside one.
 *
 * Returns the status the application ended at, so the caller can report it
 * without a second read.
 */
async function advanceOnPaymentSuccess(tx: Tx, payment: LockedPayment, now: Date): Promise<string> {
  const outstanding = await tx.applicationFee.count({
    where: {
      applicationId: payment.applicationId,
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
    },
  });

  // Paid, but something else is still payable. The application rests at
  // PAYMENT_SUCCESSFUL — a real state, not a transient one — and advances when
  // the last demand is settled.
  if (outstanding > 0) return 'PAYMENT_SUCCESSFUL';

  const started = await startWorkflow(tx, {
    applicationId: payment.applicationId,
    actionCode: ACTIONS.CONFIRM_PAYMENT,
    actor: { id: payment.initiatedById ?? payment.application.ltpUserId, name: 'System' },
    meta: { ip: '', userAgent: 'payment-settlement', correlationId: payment.paymentRef },
    // The settlement's own instant, so the receipt, the credited demand and
    // the file's arrival at the department all carry the same timestamp.
    now,
  });

  if (started) return started.status;

  // The run was already going: this was a shortfall demand, or a duplicate
  // callback. Report what the application actually is rather than what a
  // first settlement would have made it — a settlement must never assert a
  // status it did not write.
  const current = await tx.application.findUniqueOrThrow({
    where: { id: payment.applicationId },
    select: { status: true },
  });

  return current.status;
}

// ═══════════════════════════════════════════════════════════════════════════
// Receipts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Issues the receipt, inside the settlement transaction.
 *
 * A receipt exists if and only if money was credited — they commit together or
 * neither does. The snapshot freezes the payer, the demand and every line item
 * as they stood at this instant: a later fee revision, a corrected applicant
 * name or an edited schedule must never alter a receipt already given to a
 * citizen, and the renderer therefore reads this JSON rather than re-querying.
 */
async function issueReceipt(
  tx: Tx,
  payment: LockedPayment,
  now: Date,
  isDemo: boolean,
  settled: { gatewayTxnId: string; bankRef: string; method: string }
) {
  const format = await settingString('payment_receipt_number_format', DEFAULT_RECEIPT_FORMAT);
  const year = now.getFullYear();
  const prefix = 'RC';
  const seq = await nextSequence(tx, `receipt:${prefix}:${year}`);
  const receiptNumber = formatNumber(format || DEFAULT_RECEIPT_FORMAT, { prefix, year, seq });

  const applicant = await tx.applicant.findUnique({
    where: { applicationId: payment.applicationId },
    select: { name: true, email: true, phone: true, address: true },
  });

  return tx.paymentReceipt.create({
    data: {
      paymentId: payment.id,
      receiptNumber,
      amount: payment.amount,
      issuedAt: now,
      snapshot: {
        receiptNumber,
        issuedAt: now.toISOString(),
        isDemo,
        provider: payment.provider,
        application: {
          id: payment.applicationId,
          applicationNumber: payment.application.applicationNumber,
        },
        applicant: {
          name: applicant?.name ?? '',
          phone: applicant?.phone ?? '',
          email: applicant?.email ?? '',
          address: applicant?.address ?? '',
        },
        payment: {
          paymentRef: payment.paymentRef,
          attemptNo: payment.attemptNo,
          amount: payment.amount.toFixed(2),
          method: settled.method,
          gatewayTxnId: settled.gatewayTxnId,
          bankRef: settled.bankRef,
          settledAt: now.toISOString(),
          status: 'SUCCESS',
        },
        demand: {
          demandNumber: payment.fee.demandNumber,
          type: payment.fee.type,
          subtotal: payment.fee.subtotal.toFixed(2),
          adjustmentTotal: payment.fee.adjustmentTotal.toFixed(2),
          totalAmount: payment.fee.totalAmount.toFixed(2),
          issuedAt: payment.fee.issuedAt?.toISOString() ?? null,
        },
        lines: payment.fee.lineItems.map((line) => ({
          kind: line.kind,
          code: line.componentCode,
          name: line.componentName,
          headOfAccount: line.headOfAccount,
          basis: line.basis,
          amount: line.amount.toFixed(2),
          note: line.calculationNote,
        })),
      } as never,
    },
    select: { id: true, receiptNumber: true, amount: true, issuedAt: true },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry points
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The return page asking "did it work?".
 *
 * The query string the gateway put on the URL is not read here and is not a
 * parameter. This function takes an id the caller already proved access to,
 * and then does the only thing that can answer the question: asks the gateway.
 */
export async function verifyPayment(user: AuthUser, paymentId: string, meta: Meta) {
  const payment = await requirePayment(user, paymentId);

  const outcome = await settle(payment.id, 'RETURN');

  // Audited as a READ-triggered verification: who came back to the return
  // page, and when. `settle()` audits what it did to the money.
  await audit(prisma, {
    actor: user,
    action: 'PAYMENT_VERIFY_REQUESTED',
    entityType: 'Payment',
    entityId: payment.id,
    applicationId: payment.applicationId,
    after: { source: 'RETURN', resultingStatus: outcome.status, changed: outcome.changed },
    ...meta,
  });

  return outcome;
}

/**
 * A callback from a gateway.
 *
 * ── The order here is the whole of rule 2 ──────────────────────────────
 *
 *   1. the driver verifies the signature — an unsigned callback never gets
 *      past this line
 *   2. the event is INSERTED, and its `(provider, externalId)` unique key is
 *      what makes a redelivery a no-op: the insert fails, and this function
 *      returns 200 having touched no money
 *   3. only then is `settle()` called, and it takes its verdict from
 *      `provider.verify()` — not from the payload that just arrived
 *
 * Step 2 before step 3 matters. Recording first means a callback that arrives
 * while the settlement of the previous one is still running is refused by the
 * database rather than by a race in this function.
 *
 * Returns a plain shape rather than throwing on a duplicate: a gateway that
 * receives an error retries, and retrying a duplicate for ever is a
 * self-inflicted denial of service.
 */
export async function handleWebhook(providerName: string, req: Request) {
  const provider = providerByName(providerName);
  if (!provider) throw notFound(`No driver is available for the "${providerName}" gateway.`);

  // Throws on a bad signature. Deliberately BEFORE anything is written: an
  // unverified payload is not evidence of anything and does not belong in the
  // table that records what the gateway said.
  const event = await provider.parseWebhook(req);

  const existingEvent = await prisma.paymentWebhookEvent.findUnique({
    where: { provider_externalId: { provider: providerName, externalId: event.externalId } },
  });

  if (existingEvent) {
    return { received: true, duplicate: true, settled: false, status: null as string | null };
  }

  const recorded = await prisma.paymentWebhookEvent.create({
    data: {
      provider: providerName,
      externalId: event.externalId,
      eventType: event.eventType.slice(0, 120),
      paymentRef: event.paymentRef.slice(0, 120),
      signatureOk: true,
      payload: event.payload as never,
    },
    select: { id: true },
  });

  const payment = event.paymentRef
    ? await prisma.payment.findUnique({
        where: { paymentRef: event.paymentRef },
        select: { id: true },
      })
    : null;

  if (!payment) {
    // An event we cannot place. Kept, flagged, and NOT an error to the sender:
    // it is ours to investigate, and making the gateway retry it for ever
    // would not help. The row is the investigation.
    await prisma.paymentWebhookEvent.update({
      where: { id: recorded.id },
      data: {
        processed: true,
        processedAt: new Date(),
        error: `No payment matches reference "${event.paymentRef}".`,
      },
    });

    console.error(`[payments] unmatched ${providerName} callback for ref "${event.paymentRef}"`);
    return { received: true, duplicate: false, settled: false, status: null as string | null };
  }

  await prisma.paymentWebhookEvent.update({
    where: { id: recorded.id },
    data: { paymentId: payment.id },
  });

  let outcome: SettlementOutcome | null = null;
  let error = '';

  try {
    outcome = await settle(payment.id, 'WEBHOOK');
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  await prisma.paymentWebhookEvent.update({
    where: { id: recorded.id },
    data: { processed: !error, processedAt: new Date(), error: error.slice(0, 1000) },
  });

  // A settlement that failed is re-attempted by the sweep. The gateway is told
  // the callback was received either way, because it was.
  if (error) console.error(`[payments] settlement failed for ${event.paymentRef}: ${error}`);

  return {
    received: true,
    duplicate: false,
    settled: Boolean(outcome?.changed),
    status: outcome?.status ?? null,
  };
}

/**
 * The payer abandoning an attempt.
 *
 * Does NOT mark the payment cancelled on the strength of the click — §5.1
 * applies to giving up as much as to succeeding. A payer may press Cancel on
 * our page having already completed the payment at the gateway, and marking
 * that attempt cancelled would lose the money. So the gateway is asked, and
 * only an attempt the gateway agrees is unpaid is closed.
 */
export async function cancelPayment(user: AuthUser, paymentId: string, meta: Meta) {
  const payment = await requirePayment(user, paymentId);

  if (!isOpenPayment(payment.status)) {
    throw businessRule(`That payment is already ${payment.status.toLowerCase()}.`);
  }

  // Ask first. If the gateway says it was paid, this settles it as a success
  // and the "cancellation" correctly becomes a receipt.
  const verified = await settle(payment.id, 'VERIFY');
  if (verified.changed || verified.status === 'SUCCESS') return verified;

  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: {
        ...PAYMENT_SELECT,
        application: { select: { id: true, applicationNumber: true, status: true, ltpUserId: true } },
        fee: { select: DEMAND_SELECT },
      },
    });

    if (fresh.settlementLockAt) {
      return {
        paymentId: fresh.id,
        paymentRef: fresh.paymentRef,
        status: fresh.status as PaymentStatusKey,
        changed: false,
        message: 'That payment had already been settled.',
        receiptNumber: fresh.receipt?.receiptNumber ?? null,
        applicationStatus: fresh.application.status,
      } satisfies SettlementOutcome;
    }

    await tx.payment.update({
      where: { id: fresh.id },
      data: {
        status: 'CANCELLED',
        settlementLockAt: now,
        settledAt: now,
        failureReason: 'Cancelled by the applicant before the payment completed.',
      },
    });

    await recordTransaction(tx, fresh, {
      direction: 'CANCEL',
      status: 'CANCELLED',
      message: 'Cancelled by the applicant. The gateway confirmed nothing had been paid.',
    });

    await failApplication(tx, fresh, now);

    await recordEvent(tx, {
      applicationId: fresh.applicationId,
      type: EVENT_TYPES.PAYMENT_FAILED,
      title: 'Payment cancelled',
      description: `${fresh.paymentRef} — cancelled before completion. Nothing has been charged.`,
      actor: user,
      metadata: { paymentId: fresh.id, paymentRef: fresh.paymentRef, outcome: 'CANCELLED' },
      occurredAt: now,
    });

    await audit(tx, {
      actor: user,
      action: 'PAYMENT_CANCELLED',
      entityType: 'Payment',
      entityId: fresh.id,
      applicationId: fresh.applicationId,
      before: { status: fresh.status },
      after: { status: 'CANCELLED', confirmedUnpaidByGateway: true },
      ...meta,
    });

    return {
      paymentId: fresh.id,
      paymentRef: fresh.paymentRef,
      status: 'CANCELLED' as PaymentStatusKey,
      changed: true,
      message: 'The payment was cancelled. Nothing has been charged.',
      receiptNumber: null,
      applicationStatus: 'PAYMENT_FAILED',
    } satisfies SettlementOutcome;
  });

  return outcome;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

export type ReconcileReport = {
  examined: number;
  settled: number;
  timedOut: number;
  stillOpen: number;
  errors: number;
};

/**
 * The sweep. Every unsettled payment old enough to be worth asking about.
 *
 * This is what makes "the payer closed the browser" a non-event, and it is the
 * reason the return page is a convenience rather than a load-bearing part of
 * the design. Nothing in this system depends on a browser coming back.
 *
 * Two windows, from settings and deliberately different:
 *
 *   payment_reconcile_after_minutes   leave a fresh attempt alone; the payer
 *                                     is probably still at the gateway
 *   payment_reconcile_give_up_hours   keep asking for this long — a net
 *                                     banking payment can settle hours later
 *
 * One failure does not stop the sweep: each payment is settled in its own
 * transaction and its own try block, because the payment that throws is the
 * one most in need of the sweep running again tomorrow.
 */
export async function reconcilePayments(limit = 100): Promise<ReconcileReport> {
  const [afterMinutes, giveUpHours] = await Promise.all([
    settingNumber('payment_reconcile_after_minutes', 10),
    settingNumber('payment_reconcile_give_up_hours', 24),
  ]);

  const now = Date.now();
  const olderThan = new Date(now - afterMinutes * 60_000);
  const giveUpBefore = new Date(now - giveUpHours * 3_600_000);

  const candidates = await prisma.payment.findMany({
    where: {
      settlementLockAt: null,
      status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] },
      initiatedAt: { lte: olderThan, gte: giveUpBefore },
    },
    orderBy: { initiatedAt: 'asc' },
    take: limit,
    select: { id: true, paymentRef: true },
  });

  const report: ReconcileReport = {
    examined: candidates.length,
    settled: 0,
    timedOut: 0,
    stillOpen: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const outcome = await settle(candidate.id, 'RECONCILE');
      if (outcome.status === 'SUCCESS' && outcome.changed) report.settled += 1;
      else if (outcome.status === 'TIMEOUT') report.timedOut += 1;
      else if (isOpenPayment(outcome.status)) report.stillOpen += 1;
      else report.settled += 1;
    } catch (err) {
      report.errors += 1;
      console.error(`[payments] reconcile failed for ${candidate.paymentRef}:`, err);
    }
  }

  return report;
}

/** Finance pressing Reconcile. Same sweep, audited against the person who ran it. */
export async function reconcileNow(user: AuthUser, meta: Meta): Promise<ReconcileReport> {
  if (!can(user, CAPABILITIES.PAYMENT_RECONCILE)) {
    throw forbidden('Your role does not permit payments to be reconciled.');
  }

  const report = await reconcilePayments();

  await audit(prisma, {
    actor: user,
    action: 'PAYMENT_RECONCILE_RUN',
    entityType: 'Payment',
    entityId: 'sweep',
    after: report,
    ...meta,
  });

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading
// ═══════════════════════════════════════════════════════════════════════════

const shapePayment = (payment: PaymentRow) => ({
  id: payment.id,
  paymentRef: payment.paymentRef,
  provider: payment.provider,
  status: payment.status,
  amount: payment.amount,
  attemptNo: payment.attemptNo,
  providerOrderId: payment.providerOrderId,
  gatewayTxnId: payment.gatewayTxnId,
  bankRef: payment.bankRef,
  method: payment.method,
  initiatedAt: payment.initiatedAt,
  settledAt: payment.settledAt,
  failureReason: payment.failureReason,
  expiresAt: payment.expiresAt,
  lastVerifiedAt: payment.lastVerifiedAt,
  verifyAttempts: payment.verifyAttempts,
  applicationFeeId: payment.applicationFeeId,
  isOpen: isOpenPayment(payment.status),
  canRetry: isRetryable(payment.status),
  transactions: payment.transactions,
  receipt: payment.receipt,
});

const shapeDemand = (
  demand: Prisma.ApplicationFeeGetPayload<{ select: typeof DEMAND_SELECT }>,
  applicationStatus: string
) => {
  const balance = Number(demand.totalAmount) - Number(demand.paidAmount);

  return {
    id: demand.id,
    demandNumber: demand.demandNumber,
    type: demand.type,
    status: demand.status,
    subtotal: demand.subtotal,
    adjustmentTotal: demand.adjustmentTotal,
    totalAmount: demand.totalAmount,
    paidAmount: demand.paidAmount,
    balance,
    dueDate: demand.dueDate,
    issuedAt: demand.issuedAt,
    paidAt: demand.paidAt,
    charges: demand.lineItems.filter((l) => l.kind === 'COMPONENT'),
    adjustments: demand.lineItems.filter((l) => l.kind !== 'COMPONENT'),
    blockedReason: whyCannotPay({
      applicationStatus,
      demandStatus: demand.status,
      demandType: demand.type,
      balance,
    }),
  };
};

/**
 * Everything the Payments tab renders.
 *
 * Deliberately includes the demand breakdown as well as the attempts: the
 * question an applicant has on this screen is "what am I paying for", and
 * sending them to another tab to find out is how a payment page gets abandoned.
 * The lines come from the demand's own frozen rows — never recalculated, for
 * the same reason the Fees tab does not recalculate them.
 */
export async function getPayments(user: AuthUser, applicationId: string) {
  if (!isUuid(applicationId)) throw notFound('That application could not be found.');

  const app = await prisma.application.findFirst({
    where: { id: applicationId, deletedAt: null, ...applicationScope(user) },
    select: { id: true, applicationNumber: true, status: true },
  });

  if (!app) throw notFound('That application could not be found.');

  const [demands, payments] = await Promise.all([
    prisma.applicationFee.findMany({
      where: { applicationId: app.id, status: { not: 'CANCELLED' } },
      select: DEMAND_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payment.findMany({
      where: { applicationId: app.id },
      select: PAYMENT_SELECT,
      orderBy: { initiatedAt: 'desc' },
    }),
  ]);

  const provider = currentProvider();

  const totalDemanded = demands.reduce((sum, d) => sum + Number(d.totalAmount), 0);
  const totalPaid = demands.reduce((sum, d) => sum + Number(d.paidAmount), 0);

  const mayInitiate = can(user, CAPABILITIES.PAYMENT_INITIATE);
  const payable = demands
    .map((d) => shapeDemand(d, app.status))
    .filter((d) => d.blockedReason === null);

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
    },
    demands: demands.map((d) => shapeDemand(d, app.status)),
    payments: payments.map(shapePayment),
    summary: {
      totalDemanded,
      totalPaid,
      balance: totalDemanded - totalPaid,
    },
    gateway: {
      name: provider.name,
      isDemo: provider.isDemo,
      configured: provider.configured,
    },
    canInitiate: mayInitiate && provider.configured && payable.length > 0,
    // The reason names the FIRST demand that cannot be paid, so the message is
    // about something specific rather than "payment is unavailable".
    blockedReason: !mayInitiate
      ? 'Your role does not permit a payment to be made.'
      : !provider.configured
        ? `Online payment is not available: the ${provider.name} gateway is not configured.`
        : payable.length > 0
          ? null
          : (demands.map((d) => shapeDemand(d, app.status)).find((d) => d.blockedReason)?.blockedReason ??
            'There is nothing to pay.'),
  };
}

/**
 * The payments register — every payment the caller may see, newest first.
 *
 * Finance's screen. Scoped through the application exactly as everything else
 * is, so an LTP opening it sees their own payments and a zonal officer sees
 * their zone's, with no separate authorization path to keep in step.
 */
export async function listPayments(
  user: AuthUser,
  filters: { status?: string; search?: string; page?: number; pageSize?: number } = {}
) {
  assertCanSeePayments(user);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const search = (filters.search ?? '').trim();

  const where: Prisma.PaymentWhereInput = {
    application: { deletedAt: null, ...applicationScope(user) },
    ...(filters.status ? { status: filters.status as PaymentStatusKey } : {}),
    ...(search
      ? {
          OR: [
            { paymentRef: { contains: search } },
            { gatewayTxnId: { contains: search } },
            { application: { applicationNumber: { contains: search } } },
            { fee: { demandNumber: { contains: search } } },
            { receipt: { receiptNumber: { contains: search } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { initiatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        paymentRef: true,
        provider: true,
        status: true,
        amount: true,
        method: true,
        gatewayTxnId: true,
        initiatedAt: true,
        settledAt: true,
        failureReason: true,
        application: { select: { id: true, applicationNumber: true, status: true } },
        fee: { select: { id: true, demandNumber: true } },
        receipt: { select: { receiptNumber: true, issuedAt: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Plumbing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Appends one row to the gateway ledger.
 *
 * `payment_transactions` is append-only in the database — a trigger refuses
 * UPDATE and DELETE — so this is the complete, unalterable story of an attempt:
 * what was sent, what came back, and when. It is what an officer reads when an
 * applicant says "I paid".
 *
 * Secrets are stripped before persistence by the drivers, which is where the
 * knowledge of what is secret lives.
 */
async function recordTransaction(
  db: Db,
  payment: { id: string; attemptNo: number },
  input: {
    direction: string;
    status: PaymentStatusKey | string;
    message?: string;
    gatewayTxnId?: string;
    bankRef?: string;
    method?: string;
    amount?: Prisma.Decimal | string | number | null;
    payload?: unknown;
  }
) {
  return db.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      attemptNo: payment.attemptNo,
      direction: input.direction,
      status: input.status as PaymentStatusKey,
      gatewayTxnId: input.gatewayTxnId ?? null,
      bankRef: (input.bankRef ?? '').slice(0, 120),
      method: (input.method ?? '').slice(0, 40),
      amount: input.amount === null || input.amount === undefined ? null : Number(input.amount),
      message: (input.message ?? '').slice(0, 1000),
      rawPayload: (input.payload ?? {}) as never,
    },
  });
}

/** Guard used by the routes that must not run for a role without PAYMENT_VIEW. */
export function assertCanSeePayments(user: AuthUser) {
  if (!can(user, CAPABILITIES.PAYMENT_VIEW)) {
    throw forbidden('Your role does not permit payments to be viewed.');
  }
}
