import 'server-only';
import { prisma } from '@/server/db/prisma';
import { findPublicRecord } from '@/server/services/public-verification';
import { orderStatusLabel, ORDER_STATUS } from '@/lib/approval-orders';
import { APPLICATION_STATUSES } from '@/lib/status';
import { whyCannotPay } from '@/lib/payments';
import { currentProvider } from '@/server/payments';
import { env } from '@/server/config/env';

/**
 * WHAT THE PUBLIC PORTAL MAY SAY ABOUT AN APPLICATION AND ITS FEES.
 *
 * ── Built on the existing whitelist, not beside it ──────────────────────
 *
 * `findPublicRecord` already decides what a stranger may learn about a file
 * and enumerates nothing beyond it: exact match only, named fields only, no
 * spread. The status page starts from it — same lookup, same fields — and
 * adds the two things the portal shows that verification does not: whether
 * the fees are paid, and the words for the files verification has no word for
 * (withdrawn, lapsed, revoked).
 *
 * The rule for this whole folder is the one that file states: a public field
 * is one somebody NAMED here. Nothing spreads a row.
 *
 * ── What is never returned ──────────────────────────────────────────────
 *
 * Officer names or remarks, the workflow stage or the desk, shortfall text,
 * audit rows, documents, the applicant's address / phone / email, gateway
 * transaction ids, bank references, and the payer's details.
 */

// ── The public words for a file's state ─────────────────────────────────────

export const PORTAL_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  UNDER_PROCESS: 'UNDER_PROCESS',
  WITH_APPLICANT: 'WITH_APPLICANT',
  APPROVED: 'APPROVED',
  NOT_APPROVED: 'NOT_APPROVED',
  CLOSED: 'CLOSED',
} as const;
export type PortalStatus = (typeof PORTAL_STATUS)[keyof typeof PORTAL_STATUS];

export const PORTAL_STATUS_LABEL: Record<PortalStatus, string> = {
  NOT_SUBMITTED: 'Not yet submitted',
  UNDER_PROCESS: 'Under process',
  WITH_APPLICANT: 'Awaiting applicant response',
  APPROVED: 'Approved',
  NOT_APPROVED: 'Not approved',
  CLOSED: 'Closed',
};

/**
 * Maps an internal status (and whether the file was ever submitted) onto the
 * public vocabulary. The default is UNDER_PROCESS for the same reason
 * `publicStatus` defaults there: a status nobody has heard of must say
 * nothing it should not.
 *
 * A file never submitted is NOT_SUBMITTED whatever its status — an LTP part
 * way through the drawing or fee steps has not filed anything with the
 * authority, and "under process" would tell a citizen otherwise.
 */
export function portalStatus(status: string, submitted: boolean): PortalStatus {
  if (status === 'APPROVED') return PORTAL_STATUS.APPROVED;
  if (status === 'REJECTED') return PORTAL_STATUS.NOT_APPROVED;
  if (status === 'WITHDRAWN' || status === 'LAPSED' || status === 'PROCEEDING_REVOKED') return PORTAL_STATUS.CLOSED;
  if (!submitted) return PORTAL_STATUS.NOT_SUBMITTED;
  if (status.includes('SHORTFALL') || status === 'RETURNED_TO_APPLICANT') return PORTAL_STATUS.WITH_APPLICANT;
  return PORTAL_STATUS.UNDER_PROCESS;
}

/** The label for a closed file: it says how it closed, because "Closed" alone is not an answer. */
export const closedLabel = (status: string): string =>
  status === 'WITHDRAWN' ? 'Withdrawn' : status === 'LAPSED' ? 'Lapsed' : status === 'PROCEEDING_REVOKED' ? 'Permission revoked' : PORTAL_STATUS_LABEL.CLOSED;

// ── Payment status, in words a citizen can act on ───────────────────────────

export const PAYMENT_SUMMARY = {
  NO_DEMAND: 'NO_DEMAND',
  PAYMENT_DUE: 'PAYMENT_DUE',
  PART_PAID: 'PART_PAID',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
} as const;
export type PaymentSummary = (typeof PAYMENT_SUMMARY)[keyof typeof PAYMENT_SUMMARY];

export const PAYMENT_SUMMARY_LABEL: Record<PaymentSummary, string> = {
  NO_DEMAND: 'No fee demand raised',
  PAYMENT_DUE: 'Payment due',
  PART_PAID: 'Partly paid',
  PAID: 'Paid',
  WAIVED: 'Fee waived',
};

type DemandFacts = { status: string; totalAmount: number; paidAmount: number };

/**
 * One word for all of an application's demands. Cancelled and draft demands
 * are not the citizen's business — a draft has not been issued and a cancelled
 * one has been replaced — so they are ignored, not counted as unpaid.
 */
export function paymentSummary(demands: readonly DemandFacts[]): PaymentSummary {
  const live = demands.filter((d) => d.status !== 'DRAFT' && d.status !== 'CANCELLED');
  if (!live.length) return PAYMENT_SUMMARY.NO_DEMAND;
  if (live.every((d) => d.status === 'WAIVED')) return PAYMENT_SUMMARY.WAIVED;
  const payable = live.filter((d) => d.status !== 'WAIVED');
  const outstanding = payable.some((d) => d.totalAmount - d.paidAmount > 0.005);
  if (!outstanding) return PAYMENT_SUMMARY.PAID;
  return payable.some((d) => d.paidAmount > 0.005) ? PAYMENT_SUMMARY.PART_PAID : PAYMENT_SUMMARY.PAYMENT_DUE;
}

export const DEMAND_STATUS_LABEL: Record<string, string> = {
  ISSUED: 'Payment due',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  WAIVED: 'Waived',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_ATTEMPT_LABEL: Record<string, string> = {
  INITIATED: 'Started',
  PENDING: 'Awaiting payment',
  PROCESSING: 'At the payment gateway',
  SUCCESS: 'Successful',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  TIMEOUT: 'Timed out',
  REFUNDED: 'Refunded',
};

// ── Who is asking, and how much that unlocks ───────────────────────────────

/** "Ramesh Kumar" → "R***** K****". The initials survive so a person can recognise their own file. */
export const maskName = (name: string | null | undefined): string =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0] ?? ''}${'*'.repeat(Math.min(5, Math.max(0, w.length - 1)))}`)
    .join(' ') || '—';

/**
 * Does the mobile the caller typed belong to this applicant? Four digits or
 * the whole number. This is a demonstration control, not authentication — it
 * exists so that the applicant's own name is not handed to anyone who has only
 * seen an application number on a notice board.
 */
export function mobileMatches(stored: string | null | undefined, typed: string | null | undefined): boolean {
  const have = (stored ?? '').replace(/\D/g, '');
  const given = (typed ?? '').replace(/\D/g, '');
  if (have.length < 4 || (given.length !== 4 && given.length !== 10)) return false;
  return have.slice(-given.length) === given;
}

// ── Where a file is, in words ───────────────────────────────────────────────

/**
 * The desk a status sits at, in the title the department uses for it. This is
 * what the BBAS public status shows ("pending at TPA"), and no more: it names a
 * desk, never a person, and never the workflow's own stage codes.
 */
const DESK_OF: Array<[RegExp, string, string]> = [
  [/^(SUBMITTED|PENDING_TPA|TPA_|SITE_INSPECTION)/, 'Town Planning Assistant', 'Scrutiny and site inspection'],
  [/^(PENDING_PLANNING_OFFICER|PLANNING_OFFICER_)/, 'Planning Officer', 'Technical endorsement'],
  [/^(PENDING_ZAD_ZDD|ZAD_ZDD_|PENDING_ZDD|ZDD_)/, 'Zonal Deputy Director', 'Review'],
  [/^(PENDING_ZJD|ZJD_)/, 'Zonal Joint Director', 'Approval'],
  [/^(PENDING_DIRECTOR|DIRECTOR_)/, 'Director', 'Review'],
  [/^(PENDING_ADDITIONAL_COMMISSIONER|ADDITIONAL_COMMISSIONER_)/, 'Additional Commissioner', 'Review'],
  [/^(PENDING_COMMISSIONER|COMMISSIONER_)/, 'Commissioner', 'Approval'],
];

export type PublicStage = { stage: string; desk: string };

export function stageOf(status: string, submitted: boolean): PublicStage {
  if (status === 'APPROVED') return { stage: 'Completed — permission granted', desk: 'Authority' };
  if (status === 'REJECTED') return { stage: 'Closed — not approved', desk: 'Authority' };
  if (status === 'WITHDRAWN') return { stage: 'Closed — withdrawn by the applicant', desk: 'Applicant' };
  if (status === 'LAPSED') return { stage: 'Closed — lapsed', desk: 'Authority' };
  if (status === 'PROCEEDING_REVOKED') return { stage: 'Closed — permission revoked', desk: 'Authority' };
  if (!submitted) return { stage: 'Being prepared', desk: 'Applicant’s LTP' };
  for (const [re, desk, stage] of DESK_OF) {
    if (re.test(status)) {
      if (status.includes('SHORTFALL')) return { stage: `Awaiting the applicant’s response (raised at ${desk})`, desk: 'Applicant' };
      return { stage, desk };
    }
  }
  if (status === 'RETURNED_TO_APPLICANT') return { stage: 'Awaiting the applicant’s response', desk: 'Applicant' };
  return { stage: 'Under process', desk: 'Authority' };
}

// ── Application status ──────────────────────────────────────────────────────

export type PublicTimelineEntry = { at: string; label: string };

export type PublicApplicationStatus = {
  applicationNumber: string;
  permissionType: string;
  /** Masked unless the caller supplied the applicant's mobile — see `mobileVerified`. */
  applicantName: string;
  mobileVerified: boolean;
  submittedOn: string | null;
  lastUpdated: string;
  status: PortalStatus;
  statusLabel: string;
  stage: string;
  desk: string;
  shortfall: { open: boolean; raised: number; label: string };
  paymentStatus: PaymentSummary;
  paymentStatusLabel: string;
  approvalStatus: 'APPROVED' | 'NOT_APPROVED' | 'PENDING' | 'CLOSED';
  approvalStatusLabel: string;
  approvedOn: string | null;
  proceedingNumber: string | null;
  bpoStatus: string;
  bpoValidUntil: string | null;
  timeline: PublicTimelineEntry[];
};

const asDemandFacts = (rows: { status: string; totalAmount: number; paidAmount: number }[]): DemandFacts[] =>
  rows.map((d) => ({ status: d.status, totalAmount: Number(d.totalAmount), paidAmount: Number(d.paidAmount) }));

export async function getPublicApplicationStatus(reference: string, opts: { mobile?: string } = {}): Promise<PublicApplicationStatus | null> {
  const base = await findPublicRecord(reference);
  if (!base) return null;

  const extra = await prisma.application.findUnique({
    where: { applicationNumber: base.applicationNumber },
    select: {
      status: true,
      createdAt: true,
      submittedAt: true,
      approvedAt: true,
      rejectedAt: true,
      closedAt: true,
      updatedAt: true,
      openShortfalls: true,
      applicant: { select: { name: true, phone: true } },
      fees: { select: { status: true, totalAmount: true, paidAmount: true } },
      payments: { where: { status: 'SUCCESS' }, orderBy: { settledAt: 'asc' }, select: { settledAt: true } },
      shortfalls: { orderBy: { raisedAt: 'asc' }, select: { raisedAt: true, respondedAt: true } },
      approvalOrder: { select: { status: true, issuedAt: true, revokedAt: true } },
    },
  });
  if (!extra) return null;

  const submitted = extra.submittedAt != null;
  const status = portalStatus(extra.status, submitted);
  const payment = paymentSummary(asDemandFacts(extra.fees));
  const verified = mobileMatches(extra.applicant?.phone, opts.mobile);
  const where = stageOf(extra.status, submitted);

  const approvalStatus = status === PORTAL_STATUS.APPROVED ? 'APPROVED' : status === PORTAL_STATUS.NOT_APPROVED ? 'NOT_APPROVED' : status === PORTAL_STATUS.CLOSED ? 'CLOSED' : 'PENDING';
  const approvalStatusLabel = { APPROVED: 'Approved', NOT_APPROVED: 'Not approved', CLOSED: closedLabel(extra.status), PENDING: 'Decision pending' }[approvalStatus];

  // `findPublicRecord` returns an order only once it is ISSUED, so a number here
  // is always one the applicant already holds.
  const issued = base.proceedingNumber != null && base.orderStatus === ORDER_STATUS.ISSUED;
  const bpoStatus = base.isRevoked ? 'Revoked' : issued ? orderStatusLabel(ORDER_STATUS.ISSUED) : 'Not yet issued';

  // The timeline is built from dates the tables already hold — when something
  // happened, never who did it or what they wrote.
  const timeline: PublicTimelineEntry[] = [{ at: extra.createdAt.toISOString(), label: 'Application started' }];
  const push = (d: Date | null | undefined, label: string) => d && timeline.push({ at: d.toISOString(), label });
  push(extra.submittedAt, 'Application submitted');
  extra.payments.forEach((p) => push(p.settledAt, 'Fee payment received'));
  extra.shortfalls.forEach((s) => {
    push(s.raisedAt, 'Shortfall raised — applicant’s response requested');
    push(s.respondedAt, 'Applicant answered the shortfall');
  });
  push(extra.approvedAt, 'Application approved');
  if (extra.approvalOrder?.status === ORDER_STATUS.ISSUED) push(extra.approvalOrder.issuedAt, 'Building permission order issued');
  push(extra.rejectedAt, 'Application not approved');
  push(extra.approvalOrder?.revokedAt, 'Permission revoked');
  if (extra.closedAt && !extra.rejectedAt && extra.status !== 'APPROVED') push(extra.closedAt, closedLabel(extra.status));
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    applicationNumber: base.applicationNumber,
    permissionType: base.permissionType,
    applicantName: verified ? (extra.applicant?.name ?? '—') : maskName(extra.applicant?.name),
    mobileVerified: verified,
    submittedOn: base.submittedOn,
    lastUpdated: extra.updatedAt.toISOString(),
    status,
    statusLabel: status === PORTAL_STATUS.CLOSED ? closedLabel(extra.status) : PORTAL_STATUS_LABEL[status],
    stage: where.stage,
    desk: where.desk,
    shortfall: {
      open: status === PORTAL_STATUS.WITH_APPLICANT,
      raised: extra.shortfalls.length,
      label: status === PORTAL_STATUS.WITH_APPLICANT ? 'Open — awaiting the applicant’s response' : extra.shortfalls.length ? 'None open' : 'None raised',
    },
    paymentStatus: payment,
    paymentStatusLabel: PAYMENT_SUMMARY_LABEL[payment],
    approvalStatus,
    approvalStatusLabel,
    approvedOn: base.approvedOn,
    proceedingNumber: base.proceedingNumber,
    bpoStatus,
    bpoValidUntil: base.validUntil,
    timeline,
  };
}

// ── Fees and payments ───────────────────────────────────────────────────────

export type PublicDemand = {
  demandNumber: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  issuedOn: string | null;
  dueOn: string | null;
  paidOn: string | null;
  /** Null when a payment can be made against this demand now; otherwise the reason it cannot. */
  payBlocker: string | null;
};

export type PublicPaymentAttempt = {
  paymentRef: string;
  demandNumber: string;
  attemptNo: number;
  status: string;
  statusLabel: string;
  amount: number;
  method: string;
  startedOn: string;
  settledOn: string | null;
  receiptNumber: string | null;
  /** The mock gateway moves no money; every attempt through it says so. */
  isDemo: boolean;
};

export type PublicFeeRecord = {
  applicationNumber: string;
  permissionType: string;
  /** Masked unless the applicant's mobile was supplied. */
  applicantName: string;
  mobileVerified: boolean;
  /** The demonstration payment is available: DEMO_MODE is on and the gateway is the mock one. */
  demoPaymentAvailable: boolean;
  paymentStatus: PaymentSummary;
  paymentStatusLabel: string;
  totalDemanded: number;
  totalPaid: number;
  balance: number;
  demands: PublicDemand[];
  payments: PublicPaymentAttempt[];
  /** True when at least one issued demand still has a balance. */
  hasBalance: boolean;
  /** The reference typed matched a payment or demand rather than the application. */
  matchedOn: 'APPLICATION' | 'PROCEEDING' | 'PAYMENT' | 'DEMAND';
};

const DEMAND_KIND: Record<string, string> = { ORIGINAL: 'Original demand', SHORTFALL: 'Shortfall demand', REVISION: 'Revised demand' };
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * The fee record for an application, found by ANY reference the payer might
 * hold: the application number, the proceeding number, a demand number or a
 * payment reference. Exact match on each — a payment reference is the one
 * identifier a citizen is handed at the end of paying, so it has to find the
 * application it paid for.
 */
export async function getPublicFeeRecord(reference: string, opts: { mobile?: string } = {}): Promise<PublicFeeRecord | null> {
  const query = reference.trim();
  if (query.length < 6 || query.length > 64) return null;

  const eq = { equals: query, mode: 'insensitive' as const };
  const application = await prisma.application.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { applicationNumber: eq },
        { approvalOrder: { orderNumber: eq } },
        { payments: { some: { paymentRef: eq } } },
        { fees: { some: { demandNumber: eq } } },
      ],
    },
    select: {
      applicationNumber: true,
      status: true,
      applicationType: { select: { name: true } },
      applicant: { select: { name: true, phone: true } },
      approvalOrder: { select: { orderNumber: true, status: true } },
      fees: {
        where: { status: { notIn: ['DRAFT'] } },
        orderBy: { createdAt: 'asc' },
        select: { demandNumber: true, type: true, status: true, totalAmount: true, paidAmount: true, issuedAt: true, dueDate: true, paidAt: true },
      },
      payments: {
        orderBy: { initiatedAt: 'desc' },
        select: {
          paymentRef: true,
          attemptNo: true,
          status: true,
          amount: true,
          method: true,
          initiatedAt: true,
          settledAt: true,
          provider: true,
          fee: { select: { demandNumber: true, status: true } },
          receipt: { select: { receiptNumber: true } },
        },
      },
    },
  });
  if (!application) return null;

  const lower = query.toLowerCase();
  const matchedOn: PublicFeeRecord['matchedOn'] =
    application.applicationNumber.toLowerCase() === lower
      ? 'APPLICATION'
      : application.approvalOrder?.orderNumber.toLowerCase() === lower
        ? 'PROCEEDING'
        : application.payments.some((p) => p.paymentRef.toLowerCase() === lower)
          ? 'PAYMENT'
          : 'DEMAND';

  const demands: PublicDemand[] = application.fees.map((f) => ({
    demandNumber: f.demandNumber,
    kindLabel: DEMAND_KIND[f.type] ?? 'Demand',
    status: f.status,
    statusLabel: DEMAND_STATUS_LABEL[f.status] ?? 'Issued',
    totalAmount: Number(f.totalAmount),
    paidAmount: Number(f.paidAmount),
    balance: f.status === 'CANCELLED' || f.status === 'WAIVED' ? 0 : Math.max(0, Number(f.totalAmount) - Number(f.paidAmount)),
    issuedOn: iso(f.issuedAt),
    dueOn: iso(f.dueDate),
    paidOn: iso(f.paidAt),
    payBlocker: whyCannotPay({
      applicationStatus: application.status,
      demandStatus: f.status,
      demandType: f.type,
      balance: Math.max(0, Number(f.totalAmount) - Number(f.paidAmount)),
    }),
  }));

  // A payment against a draft demand cannot exist, but a cancelled demand can carry old attempts;
  // they stay in the history, marked by the demand they belong to.
  const payments: PublicPaymentAttempt[] = application.payments.map((p) => ({
    paymentRef: p.paymentRef,
    demandNumber: p.fee.demandNumber,
    attemptNo: p.attemptNo,
    status: p.status,
    statusLabel: PAYMENT_ATTEMPT_LABEL[p.status] ?? 'In progress',
    amount: Number(p.amount),
    method: p.method,
    startedOn: p.initiatedAt.toISOString(),
    settledOn: iso(p.settledAt),
    receiptNumber: p.receipt?.receiptNumber ?? null,
    isDemo: p.provider === 'mock',
  }));

  const summary = paymentSummary(asDemandFacts(application.fees));
  const live = demands.filter((d) => d.status !== 'CANCELLED' && d.status !== 'WAIVED');

  const provider = currentProvider();
  return {
    applicationNumber: application.applicationNumber,
    permissionType: application.applicationType.name,
    applicantName: mobileMatches(application.applicant?.phone, opts.mobile) ? (application.applicant?.name ?? '—') : maskName(application.applicant?.name),
    mobileVerified: mobileMatches(application.applicant?.phone, opts.mobile),
    demoPaymentAvailable: env.demoMode && provider.name === 'mock' && provider.configured,
    paymentStatus: summary,
    paymentStatusLabel: PAYMENT_SUMMARY_LABEL[summary],
    totalDemanded: live.reduce((n, d) => n + d.totalAmount, 0),
    totalPaid: live.reduce((n, d) => n + d.paidAmount, 0),
    balance: live.reduce((n, d) => n + d.balance, 0),
    demands,
    payments,
    hasBalance: live.some((d) => d.balance > 0.005),
    matchedOn,
  };
}

/** Every status the portal knows how to classify — exported so a test can prove none is left out. */
export const KNOWN_APPLICATION_STATUSES = APPLICATION_STATUSES;
