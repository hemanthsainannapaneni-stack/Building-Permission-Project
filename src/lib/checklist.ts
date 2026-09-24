/**
 * The checklist vocabulary. Isomorphic — server and client read the same file.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORDING OF THE QUESTIONS IS NOT IN THIS FILE, AND THAT IS THE DESIGN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The nineteen questions live in `checklist_item_definitions`, as rows, seeded
 * by prisma/seed/12-checklists.ts and editable from Settings → Checklists.
 * They are marked PROVISIONAL DEMO WORDING because the BBAS manuals supplied
 * for this project describe the 19-point checklist and its subject areas but
 * do not reproduce its questions as text. Nothing in this system claims the
 * seeded sentences are the official ones, the interface says so beside every
 * question, and replacing them is a typing job rather than a deployment.
 *
 * What IS fixed here is the machinery around them: the five statuses, how an
 * answer is shaped, how progress is counted and how the risk category falls
 * out of the answers. None of that changes when the wording does.
 */

// ── Status ────────────────────────────────────────────────────────────────

/**
 * The five states a checklist question can be in.
 *
 * PENDING and NA are NOT the same and the difference is load-bearing. PENDING
 * means nobody has looked at it; NA means an officer looked and recorded that
 * it does not apply to this file — a plot outside any approved layout has no
 * layout plan to enclose, and question 8 is answered by saying so. A progress
 * bar that lumped the two together would report an office as behind on work
 * it had actually finished.
 *
 * SHORTFALL and REJECTED are likewise distinct. A shortfall is recoverable:
 * something is missing, the applicant is told, they supply it. A rejection is
 * a finding against the proposal on that point, and no amount of further paper
 * changes it.
 */
/**
 * The tuple comes first so `z.enum(CHECKLIST_STATUSES)` keeps the literal
 * union. `Object.values()` widens to `string[]`, which would hand every
 * consumer of the request schema a bare `string` and quietly undo the reason
 * these are literals at all.
 */
export const CHECKLIST_STATUSES = ['PENDING', 'VERIFIED', 'SHORTFALL', 'REJECTED', 'NA'] as const;

export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  SHORTFALL: 'SHORTFALL',
  REJECTED: 'REJECTED',
  NA: 'NA',
} as const satisfies Record<string, ChecklistStatus>;

export const isChecklistStatus = (value: string): value is ChecklistStatus =>
  (CHECKLIST_STATUSES as readonly string[]).includes(value);

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = {
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  SHORTFALL: 'Shortfall',
  REJECTED: 'Rejected',
  NA: 'Not applicable',
};

/** Badge tones. Fixed meanings, as everywhere else — see docs K.4. */
export const CHECKLIST_STATUS_TONE: Record<
  ChecklistStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  PENDING: 'neutral',
  VERIFIED: 'success',
  SHORTFALL: 'warning',
  REJECTED: 'danger',
  NA: 'info',
};

/** A question an officer has disposed of, one way or another. */
export const isSettledStatus = (status: string): boolean =>
  status === CHECKLIST_STATUS.VERIFIED ||
  status === CHECKLIST_STATUS.NA ||
  status === CHECKLIST_STATUS.REJECTED;

// ── Responses ─────────────────────────────────────────────────────────────

export const RESPONSE_TYPES = ['YES_NO', 'YES_NO_NA', 'TEXT', 'NUMBER', 'MEASUREMENT'] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** The answers a given question will accept. Empty = free text or a number. */
export function allowedResponses(responseType: string): string[] {
  if (responseType === 'YES_NO') return ['YES', 'NO'];
  if (responseType === 'YES_NO_NA') return ['YES', 'NO', 'NA'];
  return [];
}

export const RESPONSE_LABEL: Record<string, string> = {
  YES: 'Yes',
  NO: 'No',
  NA: 'Not applicable',
};

export const responseLabel = (value: string): string => RESPONSE_LABEL[value] ?? value;

/**
 * Whether an answer is acceptable for a question of this type.
 *
 * A NUMBER or MEASUREMENT question takes any string the applicant typed and
 * checks it parses — the unit is in the question, not the value, because the
 * manuals state thresholds in metres and square metres and a value carrying
 * its own unit would let two answers to the same question be incomparable.
 */
export function isValidResponse(responseType: string, value: string): boolean {
  if (!value) return false;
  const allowed = allowedResponses(responseType);
  if (allowed.length) return allowed.includes(value);
  if (responseType === 'NUMBER' || responseType === 'MEASUREMENT') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0;
  }
  return value.trim().length > 0;
}

// ── Progress ──────────────────────────────────────────────────────────────

export type ChecklistProgress = {
  /** Every ACTIVE question on the checklist. 19 for the application one. */
  total: number;
  verified: number;
  pending: number;
  shortfall: number;
  rejected: number;
  na: number;
  /** Questions the applicant has answered, whatever a reviewer made of them. */
  answered: number;
  /** Mandatory questions still unanswered — what blocks filing. */
  unanswered: number;
  /** Questions an officer has disposed of, as a whole-number percentage. */
  reviewedPercent: number;
  /** Nothing is pending and nothing is in shortfall. */
  complete: boolean;
};

type ProgressInput = {
  status: string;
  response: string;
  isMandatory: boolean;
};

/**
 * The counts the header states.
 *
 * Stated as counts and never as a bare percentage: "14 of 19 verified, 3
 * pending, 2 shortfall" is actionable and "74%" is not, and the person reading
 * it is deciding whether to forward a file.
 */
export function checklistProgress(items: ProgressInput[]): ChecklistProgress {
  const progress: ChecklistProgress = {
    total: items.length,
    verified: 0,
    pending: 0,
    shortfall: 0,
    rejected: 0,
    na: 0,
    answered: 0,
    unanswered: 0,
    reviewedPercent: 0,
    complete: false,
  };

  for (const item of items) {
    if (item.status === CHECKLIST_STATUS.VERIFIED) progress.verified += 1;
    else if (item.status === CHECKLIST_STATUS.SHORTFALL) progress.shortfall += 1;
    else if (item.status === CHECKLIST_STATUS.REJECTED) progress.rejected += 1;
    else if (item.status === CHECKLIST_STATUS.NA) progress.na += 1;
    else progress.pending += 1;

    if (item.response) progress.answered += 1;
    else if (item.isMandatory) progress.unanswered += 1;
  }

  const settled = progress.verified + progress.na + progress.rejected;
  progress.reviewedPercent = progress.total ? Math.round((settled / progress.total) * 100) : 0;
  progress.complete = progress.total > 0 && progress.pending === 0 && progress.shortfall === 0;

  return progress;
}

// ── Risk ──────────────────────────────────────────────────────────────────

export const RISK_CATEGORIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_TONE: Record<RiskCategory, 'success' | 'warning' | 'danger'> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

/**
 * The application's risk category, from the answers that carry `affectsRisk`.
 *
 * DERIVED, never typed in. The definition rows say which questions bear on
 * risk, the answers say what the position is, and this function turns the two
 * into a category — so marking one more question risk-bearing in Settings
 * changes how every file is categorised, with no code change and no migration.
 * That is the whole reason the flag is a column on the definition.
 *
 * The rule is deliberately crude, because it is DEMO SCORING and not a
 * statutory classification:
 *
 *   HIGH    one rejection, or two shortfalls, or three flags
 *   MEDIUM  any shortfall, or any flag
 *   LOW     none of the above
 *
 * The manuals name the thresholds the questions turn on — 10 m, 15 m, 18 m,
 * 20,000 sq m, the monument and railway buffers — but they do not say how a
 * category is computed from them, and this function does not pretend
 * otherwise.
 */
export function deriveRiskCategory(
  items: Array<{ affectsRisk: boolean; response: string; status: string }>
): RiskCategory {
  const risky = items.filter((i) => i.affectsRisk);
  if (!risky.length) return 'LOW';

  // A REJECTION and a SHORTFALL are weighed differently, and the difference
  // is the whole reason this function is not a single count.
  //
  // A shortfall is RECOVERABLE — a certificate has expired, an enclosure is
  // missing — and it is the most ordinary finding an officer makes. Treating
  // one as decisive made three files in four HIGH on the demonstration
  // register, which is worse than no category at all: a grade that almost
  // everything shares tells a reader nothing and is quickly ignored.
  //
  // A rejection is a finding AGAINST the proposal on a matter that bears on
  // risk. One is enough.
  const rejected = risky.filter((i) => i.status === CHECKLIST_STATUS.REJECTED).length;
  const shortfalls = risky.filter((i) => i.status === CHECKLIST_STATUS.SHORTFALL).length;

  // "YES" on a risk-bearing question is the answer that RAISES risk: every one
  // of them asks whether a threshold is exceeded or a constraint is present.
  const flags = risky.filter((i) => i.response === 'YES').length;

  if (rejected > 0 || shortfalls >= 2 || flags >= 3) return 'HIGH';
  if (shortfalls > 0 || flags > 0) return 'MEDIUM';
  return 'LOW';
}

// ── Who may do what ───────────────────────────────────────────────────────

/**
 * The statuses in which the APPLICANT may still answer checklist questions.
 *
 * Two groups, and they are here for different reasons.
 *
 *  · The applicant-side statuses, DRAFT through PAYMENT_SUCCESSFUL. The file
 *    has not reached a desk and the LTP is still assembling it. Note that this
 *    is WIDER than `isEditableStatus`, which is DRAFT alone: that predicate
 *    governs rewriting the particulars of a filed application, which must not
 *    change under an officer reading it. Answering a checklist question is not
 *    that — it is the LTP completing what they were asked for, the earlier
 *    answer is kept in `checklist_review_entries`, and a file that could not
 *    be completed after filing would have to be withdrawn and filed again.
 *
 *  · The parked statuses, where a desk has returned the file. The applicant
 *    owns it again and answering is precisely what they have been asked to do.
 *
 * Every entry is checked against `APPLICATION_STATUSES` by
 * tests/unit/checklist.test.ts, so a typo here is a failing test rather than a
 * silently unanswerable file.
 */
export const APPLICANT_ANSWERABLE_STATUSES: readonly string[] = [
  'DRAFT',
  'SUBMITTED',
  'DRAWING_UPLOADED',
  'SCRUTINY_IN_PROGRESS',
  'SCRUTINY_FAILED',
  'SCRUTINY_PASSED',
  'DOCUMENT_UPLOAD_PENDING',
  'DOCUMENTS_COMPLETED',
  'FEE_GENERATED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PAYMENT_SUCCESSFUL',

  'RETURNED_TO_APPLICANT',
  'SHORTFALL_RESPONDED',
  'TPA_DOCUMENT_SHORTFALL',
  'TPA_FEE_SHORTFALL',
  'TPA_TECHNICAL_SHORTFALL',
  'PLANNING_OFFICER_SHORTFALL',
  'ZDD_SHORTFALL',
  'ZAD_ZDD_SHORTFALL',
  'ZJD_SHORTFALL',
  'ZJD_FEE_SHORTFALL',
  'DIRECTOR_SHORTFALL',
  'DIRECTOR_REPORTED_SHORTFALL',
  'ADDITIONAL_COMMISSIONER_SHORTFALL',
  'COMMISSIONER_SHORTFALL',
];

export const canApplicantAnswer = (status: string): boolean =>
  APPLICANT_ANSWERABLE_STATUSES.includes(status);

/**
 * The statuses in which a REVIEWER may record a verification.
 *
 * Stated as the closed set rather than the open one, for the same reason
 * `CLOSED_SHORTFALL_STATUSES` is: a status added later should be reviewable
 * until somebody deliberately says otherwise, and the failure mode of getting
 * this wrong in the other direction is a desk that cannot do its work.
 */
export const canReviewerVerify = (status: string): boolean =>
  !['DRAFT', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'LAPSED'].includes(status);
