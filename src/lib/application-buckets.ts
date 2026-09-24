/**
 * The dashboard's KPI tiles, as sets of statuses.
 *
 * These exist so a tile and the list it links to CANNOT disagree. Clicking
 * "Payment pending — 4" and landing on a list of three would destroy trust in
 * every number on the screen, and that is exactly what happens when a tile
 * counts with one predicate and the list filters with another. Here both read
 * this file, and the link is just `?bucket=paymentPending`.
 *
 * The 36 statuses in ApplicationStatus are more than a person can hold in
 * their head; a bucket is the vocabulary an LTP actually uses.
 *
 * Statuses are plain strings here, not the Prisma enum: this module is
 * isomorphic and the client bundle must not import from `@prisma/client`.
 * That is the same call src/lib/constants.ts makes for TERMINAL_STATUSES.
 * The names are still checked — the seed test asserts every string below is a
 * real member of the enum, so a typo fails a test rather than silently
 * counting nothing.
 */

/** A member of the ApplicationStatus enum, as a string. */
export type StatusName = string;

export type BucketKey =
  | 'total'
  | 'draft'
  | 'scrutinyFailed'
  | 'scrutinyPassed'
  | 'documentsPending'
  | 'paymentPending'
  | 'underReview'
  | 'shortfall'
  | 'approved';

export type BucketDef = {
  key: BucketKey;
  label: string;
  /** Empty = every status. Only `total` is empty. */
  statuses: StatusName[];
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** One line, shown under the number. */
  hint: string;
};

/**
 * Every status where the file is sitting with the department, not the LTP.
 *
 * Covers BOTH chains. A status belonging to a desk that only BP_STANDARD has
 * is still listed, because files decided under that chain carry it for ever
 * and a register that stopped counting them would be wrong about the past.
 */
export const UNDER_REVIEW: StatusName[] = [
  'SUBMITTED',

  'PENDING_TPA',
  'TPA_REVIEW',

  // BBAS_STANDARD
  'SITE_INSPECTION_SCHEDULED',
  'SITE_INSPECTION_IN_PROGRESS',
  'PENDING_PLANNING_OFFICER',
  'PLANNING_OFFICER_REVIEW',
  'PENDING_ZDD',
  'ZDD_REVIEW',

  'PENDING_ZJD',
  'ZJD_REVIEW',

  // BP_STANDARD
  'PENDING_ZAD_ZDD',
  'ZAD_ZDD_REVIEW',
  'PENDING_DIRECTOR_DP',
  'DIRECTOR_REVIEW',
  'PENDING_ADDITIONAL_COMMISSIONER',
  'ADDITIONAL_COMMISSIONER_REVIEW',
  'PENDING_COMMISSIONER',
  'COMMISSIONER_REVIEW',
];

/**
 * Every status that means the department has asked for something back.
 *
 * Status-based, which is all Phase 2 can be. Phase 8 introduces the shortfall
 * records themselves, and `applications.openShortfalls > 0` then becomes the
 * more accurate predicate — a REPORTED shortfall travels with the file and
 * does NOT change its status, so it would be missed by the list below. When
 * that phase lands, this bucket gains an OR on the counter; every caller
 * already reads the bucket rather than its own predicate, so that is a change
 * to this file alone.
 */
export const SHORTFALL: StatusName[] = [
  // No desk named — the fallback a stage without its own parked status uses.
  'RETURNED_TO_APPLICANT',

  'TPA_DOCUMENT_SHORTFALL',
  'TPA_FEE_SHORTFALL',
  'TPA_TECHNICAL_SHORTFALL',

  // BBAS_STANDARD
  'PLANNING_OFFICER_SHORTFALL',
  'ZDD_SHORTFALL',

  'ZJD_SHORTFALL',
  'ZJD_FEE_SHORTFALL',

  // BP_STANDARD
  'ZAD_ZDD_SHORTFALL',
  'DIRECTOR_SHORTFALL',
  'DIRECTOR_REPORTED_SHORTFALL',
  'ADDITIONAL_COMMISSIONER_SHORTFALL',
  'COMMISSIONER_SHORTFALL',
];

export const BUCKETS: readonly BucketDef[] = [
  {
    key: 'total',
    label: 'Total applications',
    statuses: [],
    tone: 'neutral',
    hint: 'Every file you have started',
  },
  {
    key: 'draft',
    label: 'Draft',
    statuses: ['DRAFT'],
    tone: 'neutral',
    hint: 'Not yet filed',
  },
  {
    key: 'scrutinyFailed',
    label: 'Scrutiny failed',
    statuses: ['SCRUTINY_FAILED'],
    tone: 'danger',
    hint: 'Correct the drawing and re-check',
  },
  {
    key: 'scrutinyPassed',
    label: 'Scrutiny passed',
    statuses: ['SCRUTINY_PASSED'],
    tone: 'success',
    hint: 'Ready for documents',
  },
  {
    key: 'documentsPending',
    label: 'Documents Submission',
    statuses: ['DOCUMENT_UPLOAD_PENDING'],
    tone: 'warning',
    hint: 'Mandatory documents outstanding',
  },
  {
    key: 'paymentPending',
    label: 'Payment pending',
    statuses: ['FEE_GENERATED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
    tone: 'warning',
    hint: 'A demand is waiting to be paid',
  },
  {
    key: 'underReview',
    label: 'Under review',
    statuses: UNDER_REVIEW,
    tone: 'info',
    hint: 'With the department',
  },
  {
    key: 'shortfall',
    label: 'Shortfall',
    statuses: SHORTFALL,
    tone: 'warning',
    hint: 'The department has asked for something',
  },
  {
    key: 'approved',
    label: 'Approved',
    statuses: ['APPROVED'],
    tone: 'success',
    hint: 'Permission granted',
  },
] as const;

const BY_KEY = new Map(BUCKETS.map((b) => [b.key, b]));

export const bucketFor = (key: string): BucketDef | undefined => BY_KEY.get(key as BucketKey);

export const isBucketKey = (key: string): key is BucketKey => BY_KEY.has(key as BucketKey);

/**
 * Which bucket a single status belongs to, for the "Current stage" column.
 * `total` is never returned — it is not a state, it is a sum.
 */
export function bucketOfStatus(status: string): BucketDef | undefined {
  return BUCKETS.find((b) => b.key !== 'total' && b.statuses.includes(status));
}
