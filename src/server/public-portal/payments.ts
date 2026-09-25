import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { env } from '@/server/config/env';
import { audit } from '@/server/services/audit';
import { settingNumber } from '@/server/services/settings';
import { initiatePayment, handleWebhook } from '@/server/services/payments';
import { currentProvider } from '@/server/payments';
import { buildMockGatewayRequest } from '@/server/payments/mock';
import { badRequest, conflict, notFound, serviceUnavailable } from '@/server/http/errors';
import { CAPABILITIES } from '@/lib/constants';
import { PUBLIC_APPLICANT_ROLE, publicApplicant } from './actor';
import { mobileMatches, PAYMENT_ATTEMPT_LABEL } from './status';
import { publicRegistrationStatus } from '@/lib/public-portal';

/**
 * DEMONSTRATION PAYMENTS FOR THE PUBLIC PORTAL.
 *
 * Two different things share this file, and they are kept apart on purpose.
 *
 * ── 1. An application's fee — the REAL payment machinery ────────────────
 *
 * `makePublicDemoPayment` drives the existing payment service end to end:
 * `initiatePayment` opens an attempt against the demand, and the outcome the
 * payer picks is delivered as the demo gateway's SIGNED callback to
 * `handleWebhook` — the same path the demo gateway page takes. Settlement,
 * receipt numbering, the audit rows and the workflow's reaction to a paid fee
 * are all the ordinary ones. There is no public-only settlement path.
 *
 * Nothing moves money: the gateway is the mock driver, which refuses to run
 * in production unless told to, and every attempt it records says so. The
 * portal offers this only when DEMO_MODE is on AND the mock is the live driver.
 *
 * ── 2. A registration RENEWAL fee — a demonstration state, nothing more ──
 *
 * Nirman has a fee engine and payment ledger for building-permission
 * applications. It has none for registrations, and this phase does not build
 * one. A renewal's "payment" is therefore a labelled demonstration record: an
 * event on the renewal and a hash-chained audit row carrying the receipt
 * reference, the method and the demonstration amount (a system setting). It
 * changes no status and settles nothing.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

// ═══════════════════════════════════════════════════════════════════════════
// 1. An application's fee
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_OUTCOMES = ['SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type DemoOutcome = (typeof DEMO_OUTCOMES)[number];

export type DemoPaymentInput = { applicationNumber: string; demandNumber: string; mobile: string; outcome: DemoOutcome };

export type DemoPaymentResult = {
  paymentRef: string;
  status: string;
  statusLabel: string;
  amount: number;
  receiptNumber: string | null;
  message: string;
  demo: true;
};

export const demoPaymentAvailable = (): boolean => {
  const provider = currentProvider();
  return env.demoMode && provider.name === 'mock' && provider.configured;
};

export async function makePublicDemoPayment(input: DemoPaymentInput, meta: Meta): Promise<DemoPaymentResult> {
  if (!demoPaymentAvailable()) throw serviceUnavailable('Demonstration payment is not available on this deployment.');

  const application = await prisma.application.findFirst({
    where: { deletedAt: null, applicationNumber: { equals: input.applicationNumber.trim(), mode: 'insensitive' } },
    select: { id: true, applicant: { select: { name: true, email: true, phone: true } }, fees: { where: { demandNumber: input.demandNumber }, select: { id: true } } },
  });
  // The same answer for "no such application", "no such demand" and "wrong digits".
  const demand = application?.fees[0];
  if (!application || !demand || !mobileMatches(application.applicant?.phone, input.mobile)) {
    throw notFound('That application, demand and mobile number do not match. Check them and try again.');
  }

  const payer = publicApplicant(application.applicant?.name ?? 'Payer', application.applicant?.email ?? '', [CAPABILITIES.PAYMENT_INITIATE]);
  const initiated = await initiatePayment(payer, demand.id, meta);
  const paymentRef = initiated.payment.paymentRef;
  const amount = Number(initiated.payment.amount);

  // The demo gateway says what the payer chose; the ordinary settlement path checks it.
  await handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef,
      state: input.outcome,
      amount: amount.toFixed(2),
      eventId: `mock_evt_${paymentRef}_${input.outcome}`,
      method: input.outcome === 'SUCCESS' ? 'DEMO' : undefined,
    })
  );

  const payment = await prisma.payment.findUnique({
    where: { paymentRef },
    select: { status: true, amount: true, failureReason: true, receipt: { select: { receiptNumber: true } } },
  });
  if (!payment) throw notFound('That payment could not be found.');

  const message =
    payment.status === 'SUCCESS'
      ? 'Demo payment completed. No real transaction was processed.'
      : payment.status === 'FAILED'
        ? 'The demo gateway declined this payment. No real transaction was processed.'
        : payment.status === 'CANCELLED'
          ? 'The demo payment was cancelled. No real transaction was processed.'
          : 'The demo payment is still being confirmed.';

  return {
    paymentRef,
    status: payment.status,
    statusLabel: PAYMENT_ATTEMPT_LABEL[payment.status] ?? 'In progress',
    amount: Number(payment.amount),
    receiptNumber: payment.receipt?.receiptNumber ?? null,
    message,
    demo: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. A registration renewal's fee — demonstration state
// ═══════════════════════════════════════════════════════════════════════════

export const RENEWAL_KINDS = ['DEVELOPER', 'LTP'] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];

export const DEMO_PAYMENT_METHODS = [
  { value: 'UPI', label: 'UPI (demo)' },
  { value: 'CARD', label: 'Debit / credit card (demo)' },
  { value: 'NETBANKING', label: 'Net banking (demo)' },
] as const;
const isMethod = (v: string) => DEMO_PAYMENT_METHODS.some((m) => m.value === v);

/** Amounts are demonstration settings, editable under Settings — not published fees, and never a constant in the UI. */
const FEE_SETTING: Record<RenewalKind, { key: string; fallback: number; label: string }> = {
  DEVELOPER: { key: 'developer_renewal_fee_demo', fallback: 5000, label: 'Developer registration renewal (demonstration fee)' },
  LTP: { key: 'ltp_renewal_fee_demo', fallback: 2000, label: 'LTP registration renewal (demonstration fee)' },
};

export async function renewalFee(kind: RenewalKind) {
  const def = FEE_SETTING[kind];
  return { amount: await settingNumber(def.key, def.fallback), label: def.label, note: 'A demonstration amount taken from system settings. It is not an official fee, and no money is collected.' };
}

const ENTITY: Record<RenewalKind, 'DeveloperRegistration' | 'ProfessionalRegistration'> = { DEVELOPER: 'DeveloperRegistration', LTP: 'ProfessionalRegistration' };
const ACTION: Record<RenewalKind, string> = { DEVELOPER: 'DEVELOPER_RENEWAL_DEMO_FEE_PAID', LTP: 'LTP_RENEWAL_DEMO_FEE_PAID' };

type RenewalRow = { id: string; applicationNumber: string; registrationNumber: string | null; name: string; status: string; kind: string; submittedAt: Date | null; mobile: string; lineageId: string };

/** The renewal a reference names: a renewal's own application number, or a registration number (its latest renewal). */
async function findRenewal(kind: RenewalKind, reference: string): Promise<{ renewal: RenewalRow | null; registration: RenewalRow | null }> {
  const ref = reference.trim();
  if (ref.length < 6 || ref.length > 40) return { renewal: null, registration: null };
  const eq = { equals: ref, mode: 'insensitive' as const };

  const rows: RenewalRow[] =
    kind === 'DEVELOPER'
      ? (
          await prisma.developerRegistration.findMany({
            where: { status: { not: 'DRAFT' }, OR: [{ applicationNumber: eq }, { registrationNumber: eq }] },
            orderBy: { createdAt: 'desc' },
            select: { id: true, applicationNumber: true, registrationNumber: true, developerName: true, status: true, kind: true, submittedAt: true, mobile: true, lineageId: true },
            take: 20,
          })
        ).map((r) => ({ ...r, name: r.developerName }))
      : await prisma.professionalRegistration.findMany({
          where: { status: { not: 'DRAFT' }, OR: [{ applicationNumber: eq }, { registrationNumber: eq }] },
          orderBy: { createdAt: 'desc' },
          select: { id: true, applicationNumber: true, registrationNumber: true, name: true, status: true, kind: true, submittedAt: true, mobile: true, lineageId: true },
          take: 20,
        });

  const byNumber = rows.find((r) => r.applicationNumber.toLowerCase() === ref.toLowerCase());
  if (byNumber) {
    // An application number names one row. If it is a renewal, that is the renewal; if it is the
    // original registration, the renewal (if any) is the newest in its lineage.
    if (byNumber.kind === 'RENEWAL') return { renewal: byNumber, registration: byNumber };
  }
  const lineage = byNumber?.lineageId ?? rows[0]?.lineageId;
  if (!lineage) return { renewal: null, registration: null };
  const same = rows.filter((r) => r.lineageId === lineage);
  const renewal = same.find((r) => r.kind === 'RENEWAL') ?? null;
  return { renewal, registration: same.find((r) => r.kind !== 'RENEWAL') ?? same[0] ?? null };
}

export type RenewalPaymentView = {
  kind: RenewalKind;
  registrationNumber: string | null;
  holderName: string;
  /** Null when no renewal has been filed for the registration. */
  renewal: null | { applicationNumber: string; status: string; statusLabel: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'; submittedOn: string | null };
  fee: { amount: number; label: string; note: string };
  payment: { state: 'NO_RENEWAL' | 'DUE' | 'PAID'; label: string; method: string; receipt: string; paidOn: string | null; demo: true };
  /** A payment can be made now; otherwise why not. */
  payBlocker: string | null;
};

const OPEN_FOR_PAYMENT = ['SUBMITTED', 'IN_PROCESS', 'SHORTFALL', 'VERIFIED'];

async function paidRecord(kind: RenewalKind, id: string) {
  const row = await prisma.auditLog.findFirst({ where: { entityType: ENTITY[kind], entityId: id, action: ACTION[kind] }, orderBy: { seq: 'desc' }, select: { after: true, occurredAt: true } });
  if (!row) return null;
  const after = (row.after ?? {}) as { method?: string; receipt?: string };
  return { method: after.method ?? '', receipt: after.receipt ?? '', paidOn: row.occurredAt.toISOString() };
}

export async function getRenewalPaymentView(kind: RenewalKind, reference: string): Promise<RenewalPaymentView | null> {
  const { renewal, registration } = await findRenewal(kind, reference);
  const subject = renewal ?? registration;
  if (!subject) return null;

  const fee = await renewalFee(kind);
  const holder = registration ?? subject;
  const base = { kind, registrationNumber: holder.registrationNumber, holderName: holder.name, fee };
  if (!renewal) {
    return { ...base, renewal: null, payment: { state: 'NO_RENEWAL', label: 'No renewal filed', method: '', receipt: '', paidOn: null, demo: true }, payBlocker: 'No renewal has been filed for this registration yet. File one first.' };
  }

  const paid = await paidRecord(kind, renewal.id);
  const meta = publicRegistrationStatus(renewal.status);
  const payBlocker = paid ? 'The demonstration fee has been paid.' : OPEN_FOR_PAYMENT.includes(renewal.status) ? null : 'This renewal is closed, so nothing further is payable on it.';
  return {
    ...base,
    renewal: { applicationNumber: renewal.applicationNumber, status: renewal.status, statusLabel: meta.label, tone: meta.tone, submittedOn: renewal.submittedAt?.toISOString() ?? null },
    payment: paid ? { state: 'PAID', label: 'Demo fee paid', method: paid.method, receipt: paid.receipt, paidOn: paid.paidOn, demo: true } : { state: 'DUE', label: 'Demo fee due', method: '', receipt: '', paidOn: null, demo: true },
    payBlocker,
  };
}

export type RenewalPaymentInput = { kind: RenewalKind; renewalNumber: string; mobileLast4: string; method: string };

/** Records the demonstration fee against a renewal. Idempotent: a paid renewal is refused, not paid twice. */
export async function payRenewalDemoFee(input: RenewalPaymentInput, meta: Meta): Promise<{ receipt: string; method: string; amount: number; renewalNumber: string; demo: true }> {
  if (!env.demoMode) throw serviceUnavailable('Demonstration payment is not available on this deployment.');
  if (!isMethod(input.method)) throw badRequest('Choose a payment method.', [{ path: 'method', message: 'Choose a payment method.' }]);

  const { renewal } = await findRenewal(input.kind, input.renewalNumber);
  const mismatch = notFound('That renewal and mobile digits do not match. Check them and try again.');
  if (!renewal || !mobileMatches(renewal.mobile, input.mobileLast4)) throw mismatch;
  if (!OPEN_FOR_PAYMENT.includes(renewal.status)) throw conflict('This renewal is closed, so nothing further is payable on it.');
  if (await paidRecord(input.kind, renewal.id)) throw conflict('The demonstration fee for this renewal has already been paid.');

  const fee = await renewalFee(input.kind);
  const receipt = `DEMO-RCPT-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  const actorName = `${renewal.name} (public portal)`;
  const remarks = `Demonstration renewal fee ₹${fee.amount} recorded via ${input.method.toLowerCase()} — receipt ${receipt}. Demo only: no real transaction was processed.`;

  await prisma.$transaction(async (tx) => {
    const data = { action: 'DEMO_FEE_PAID', fromStatus: renewal.status, toStatus: renewal.status, actorId: 'public-portal', actorName, actorRoleKey: PUBLIC_APPLICANT_ROLE, remarks };
    if (input.kind === 'DEVELOPER') await tx.developerRegistrationEvent.create({ data: { registrationId: renewal.id, ...data } });
    else await tx.professionalRegistrationEvent.create({ data: { registrationId: renewal.id, ...data } });
    await audit(tx, {
      actor: { id: 'public-portal', name: actorName, roleKeys: [PUBLIC_APPLICANT_ROLE] },
      action: ACTION[input.kind],
      entityType: ENTITY[input.kind],
      entityId: renewal.id,
      after: { renewalNumber: renewal.applicationNumber, registrationNumber: renewal.registrationNumber, amount: fee.amount, method: input.method, receipt, demo: true },
      remarks,
      ...meta,
    });
  });

  return { receipt, method: input.method, amount: fee.amount, renewalNumber: renewal.applicationNumber, demo: true };
}
