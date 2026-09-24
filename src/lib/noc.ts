/**
 * The NOC vocabulary. Isomorphic — the service, the seed, the screens and the
 * tests all read these names, and `nocMoves()` runs unchanged on both sides of
 * the wire, so a button that is offered is a move the service will accept.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  NO LEGAL THRESHOLD IS ENCODED ANYWHERE IN THIS MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Whether a file needs a Fire NOC (or any other) is decided by the reviewing
 * officer and recorded as a fact on the NOC row. Nothing here derives it from
 * height, area, occupancy or distance. The NOC type may point at application
 * checklist questions whose YES answer is worth showing beside that decision —
 * a hint, never a rule.
 *
 * ── The lifecycle ─────────────────────────────────────────────────────────
 *
 *              ┌──────────── officer: Mark Not Required ────────────┐
 *              ▼                                                    │
 *   PENDING ──officer: Mark Required──▶ REQUIRED                    │
 *      │                                   │                        │
 *      └──────── applicant: Record application ──▶ APPLIED          │
 *                applicant: Record receipt ─────▶ RECEIVED ─────────┘
 *                                                   │
 *                     officer: Verify ──────────────┼──▶ VERIFIED ──(expiry passes)──▶ EXPIRED
 *                     officer: Shortfall ───────────┼──▶ SHORTFALL ─┐
 *                     officer: Reject ──────────────┘──▶ REJECTED ──┤
 *                                                                   │
 *                     applicant: record again ◀─────────────────────┘
 *
 * PENDING means the requirement is NOT YET DETERMINED — the applicant declared
 * the NOC, or it was opened for the desk to decide. REQUIRED means the desk has
 * decided it is needed and nothing has been filed with the authority yet.
 */

export const NOC_STATUSES = [
  'NOT_REQUIRED',
  'REQUIRED',
  'PENDING',
  'APPLIED',
  'RECEIVED',
  'VERIFIED',
  'SHORTFALL',
  'REJECTED',
  'EXPIRED',
] as const;

export type NocStatus = (typeof NOC_STATUSES)[number];

export const NOC_STATUS = Object.fromEntries(NOC_STATUSES.map((s) => [s, s])) as { [K in NocStatus]: K };

export const NOC_STATUS_LABEL: Record<NocStatus, string> = {
  NOT_REQUIRED: 'Not Required',
  REQUIRED: 'Required',
  PENDING: 'Pending',
  APPLIED: 'Applied',
  RECEIVED: 'Received',
  VERIFIED: 'Verified',
  SHORTFALL: 'Shortfall',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const isNocStatus = (value: string): value is NocStatus => (NOC_STATUSES as readonly string[]).includes(value);

/**
 * Still owed by somebody — the "NOCs pending" figure. Everything the file
 * needs and has not yet got verified, including a certificate that lapsed.
 * NOT_REQUIRED and VERIFIED are settled; nothing else is.
 */
export const OUTSTANDING_NOC_STATUSES: readonly NocStatus[] = [
  'PENDING',
  'REQUIRED',
  'APPLIED',
  'RECEIVED',
  'SHORTFALL',
  'REJECTED',
  'EXPIRED',
];

/** Waiting on the desk rather than the applicant. */
export const AWAITING_VERIFICATION: readonly NocStatus[] = ['RECEIVED'];

// ── Moves ───────────────────────────────────────────────────────────────────

/** What the reviewing desk may do. */
export const OFFICER_ACTIONS = ['MARK_REQUIRED', 'MARK_NOT_REQUIRED', 'VERIFY', 'SHORTFALL', 'REJECT'] as const;
export type OfficerAction = (typeof OFFICER_ACTIONS)[number];

/** What the applicant may do. */
export const APPLICANT_ACTIONS = ['RECORD_APPLICATION', 'RECORD_RECEIPT'] as const;
export type ApplicantAction = (typeof APPLICANT_ACTIONS)[number];

export type NocAction = OfficerAction | ApplicantAction;

export const NOC_ACTION_LABEL: Record<NocAction, string> = {
  MARK_REQUIRED: 'Mark Required',
  MARK_NOT_REQUIRED: 'Mark Not Required',
  VERIFY: 'Verify',
  SHORTFALL: 'Shortfall',
  REJECT: 'Reject',
  RECORD_APPLICATION: 'Record application',
  RECORD_RECEIPT: 'Record NOC received',
};

/** Where each move lands. */
export const NOC_ACTION_RESULT: Record<NocAction, NocStatus> = {
  MARK_REQUIRED: 'REQUIRED',
  MARK_NOT_REQUIRED: 'NOT_REQUIRED',
  VERIFY: 'VERIFIED',
  SHORTFALL: 'SHORTFALL',
  REJECT: 'REJECTED',
  RECORD_APPLICATION: 'APPLIED',
  RECORD_RECEIPT: 'RECEIVED',
};

/**
 * From which statuses each move is legal.
 *
 * Two choices worth stating. A VERIFIED NOC cannot be marked not required or
 * rejected in place — undoing a verification is a heavier act than this demo
 * models, and silently discarding a verified certificate is the failure that
 * matters. And the applicant may record a receipt straight from REQUIRED or
 * PENDING: some applicants hold the certificate before the file is filed.
 */
const FROM: Record<NocAction, readonly NocStatus[]> = {
  MARK_REQUIRED: ['PENDING', 'NOT_REQUIRED'],
  MARK_NOT_REQUIRED: ['PENDING', 'REQUIRED', 'APPLIED', 'RECEIVED', 'SHORTFALL', 'REJECTED', 'EXPIRED'],
  VERIFY: ['RECEIVED'],
  SHORTFALL: ['APPLIED', 'RECEIVED'],
  REJECT: ['APPLIED', 'RECEIVED'],
  RECORD_APPLICATION: ['PENDING', 'REQUIRED', 'SHORTFALL', 'REJECTED', 'EXPIRED'],
  RECORD_RECEIPT: ['PENDING', 'REQUIRED', 'APPLIED', 'SHORTFALL', 'REJECTED', 'EXPIRED'],
};

export const canMove = (action: NocAction, from: string): boolean =>
  isNocStatus(from) && FROM[action].includes(from);

/** Moves whose remarks are the point of the move, and so may not be blank. */
export const REMARKS_REQUIRED: ReadonlySet<NocAction> = new Set(['MARK_NOT_REQUIRED', 'SHORTFALL', 'REJECT']);

export function nocMoves(status: string, side: 'officer' | 'applicant'): NocAction[] {
  const pool: readonly NocAction[] = side === 'officer' ? OFFICER_ACTIONS : APPLICANT_ACTIONS;
  return pool.filter((a) => canMove(a, status));
}

// ── Readiness ───────────────────────────────────────────────────────────────

export type VerifiableNoc = {
  referenceNumber: string;
  issuedDate: Date | string | null;
  expiryDate: Date | string | null;
  hasDocument: boolean;
  requiresExpiry: boolean;
};

const toDate = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));

/**
 * Why a received NOC cannot be verified yet — empty when it can. The service
 * refuses a VERIFY with any problem outstanding; the screen lists the same
 * problems beside a disabled button.
 */
export function verificationProblems(noc: VerifiableNoc, now = new Date()): string[] {
  const problems: string[] = [];
  if (!noc.referenceNumber.trim()) problems.push('The NOC number issued by the authority is not recorded.');
  const issued = toDate(noc.issuedDate);
  if (!issued) problems.push('The date of issue is not recorded.');
  else if (issued.getTime() > now.getTime() + 60_000) problems.push('The date of issue is in the future.');
  const expiry = toDate(noc.expiryDate);
  if (noc.requiresExpiry && !expiry) problems.push('The validity (expiry) date is not recorded.');
  if (expiry && issued && expiry.getTime() <= issued.getTime()) problems.push('The expiry date is not after the date of issue.');
  if (expiry && expiry.getTime() <= now.getTime()) problems.push('The certificate has already expired.');
  if (!noc.hasDocument) problems.push('No copy of the certificate is attached.');
  return problems;
}

/** The applicant-side summary the NOCs tab opens with. */
export type NocTally = {
  total: number;
  required: number;
  notRequired: number;
  undetermined: number;
  received: number;
  verified: number;
  pending: number;
};

export function nocTally(rows: ReadonlyArray<{ status: string }>): NocTally {
  const count = (...s: NocStatus[]) => rows.filter((r) => (s as string[]).includes(r.status)).length;
  return {
    total: rows.length,
    // Every NOC the desk has not ruled out — undetermined ones included, since
    // they may yet be needed.
    required: rows.length - count('NOT_REQUIRED'),
    notRequired: count('NOT_REQUIRED'),
    undetermined: count('PENDING'),
    received: count('RECEIVED'),
    verified: count('VERIFIED'),
    pending: count(...OUTSTANDING_NOC_STATUSES),
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

/** The seeded catalogue. Only FIRE is active; the rest are switched on by data. */
export const NOC_TYPE_CODES = [
  'FIRE',
  'AIRPORT',
  'RAILWAY',
  'ENVIRONMENT',
  'WATER_RESOURCES',
  'HERITAGE',
  'OTHER',
] as const;

export type NocTypeCode = (typeof NOC_TYPE_CODES)[number];

export const DEMO_DOCUMENT_NOTE =
  'DEMO PLACEHOLDER — no certificate file was uploaded. Shown so the verification flow can be demonstrated.';
