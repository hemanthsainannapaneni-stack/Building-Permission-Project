/**
 * The show cause vocabulary. Isomorphic — the service, the workflow effects,
 * the seed, the screens and the tests all read these names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SHOW CAUSE IS NOT A SHORTFALL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A shortfall asks the applicant for something the file LACKS — a document, a
 * fee, a corrected drawing — and parks the file until it arrives. A show cause
 * notice asks the applicant to EXPLAIN something the department believes is
 * wrong, and records what they said and what the department then decided.
 *
 * They share nothing: not a table, not a number series (SCN/… vs SF/…), not a
 * status, not a workflow action and not an effect. A show cause never opens a
 * shortfall row and never counts towards `openShortfalls`.
 *
 * ── Nothing here invents a legal consequence ─────────────────────────────
 *
 * The response due date is printed on the notice and shown on the register.
 * Passing it does nothing. A decision records what the reviewing officer
 * decided; the only decision with a further effect is REVOKE_PROCEEDING, and
 * that effect is to OPEN a revocation proceeding — which is then reviewed and
 * decided by the authority the workflow configuration names.
 *
 * ── The lifecycle ─────────────────────────────────────────────────────────
 *
 *   desk: Issue ─▶ ISSUED ─(outward dispatched)─▶ AWAITING_RESPONSE
 *                                                      │
 *                          applicant: Respond ─────────┘─▶ RESPONDED
 *                                                              │
 *                          desk: Review Show Cause Submission ─┴▶ UNDER_REVIEW
 *                                                                      │
 *                          desk: Decide ───────────────────────────────┘
 *                               ├─▶ CLOSED                 (Closed / Satisfactory)
 *                               ├─▶ FURTHER_ACTION         (Further action required)
 *                               ├─▶ REJECTED               (Response rejected)
 *                               └─▶ REFERRED_FOR_REVOCATION (Revoke proceeding)
 */

export const SHOW_CAUSE_STATUSES = [
  'ISSUED',
  'AWAITING_RESPONSE',
  'RESPONDED',
  'UNDER_REVIEW',
  'CLOSED',
  'FURTHER_ACTION',
  'REJECTED',
  'REFERRED_FOR_REVOCATION',
] as const;

export type ShowCauseStatus = (typeof SHOW_CAUSE_STATUSES)[number];

export const SHOW_CAUSE_STATUS_LABEL: Record<ShowCauseStatus, string> = {
  ISSUED: 'Issued — awaiting dispatch',
  AWAITING_RESPONSE: 'Awaiting response',
  RESPONDED: 'Response received',
  UNDER_REVIEW: 'Response under review',
  CLOSED: 'Closed / Satisfactory',
  FURTHER_ACTION: 'Further action required',
  REJECTED: 'Rejected',
  REFERRED_FOR_REVOCATION: 'Revoke proceeding',
};

export const isShowCauseStatus = (v: string): v is ShowCauseStatus =>
  (SHOW_CAUSE_STATUSES as readonly string[]).includes(v);

/** Not yet decided. An open notice blocks APPROVE (guard `no_open_show_cause`). */
export const OPEN_SHOW_CAUSE_STATUSES: readonly ShowCauseStatus[] = [
  'ISSUED',
  'AWAITING_RESPONSE',
  'RESPONDED',
  'UNDER_REVIEW',
];

/** Answered and waiting on the desk. */
export const AWAITING_DECISION_STATUSES: readonly ShowCauseStatus[] = ['RESPONDED', 'UNDER_REVIEW'];

export const isShowCauseOpen = (status: string) => (OPEN_SHOW_CAUSE_STATUSES as readonly string[]).includes(status);

// ── Decisions ───────────────────────────────────────────────────────────────

export const SHOW_CAUSE_DECISIONS = [
  'CLOSED_SATISFACTORY',
  'FURTHER_ACTION_REQUIRED',
  'REJECTED',
  'REVOKE_PROCEEDING',
] as const;

export type ShowCauseDecision = (typeof SHOW_CAUSE_DECISIONS)[number];

export const SHOW_CAUSE_DECISION_LABEL: Record<ShowCauseDecision, string> = {
  CLOSED_SATISFACTORY: 'Closed / Satisfactory',
  FURTHER_ACTION_REQUIRED: 'Further action required',
  REJECTED: 'Rejected',
  REVOKE_PROCEEDING: 'Revoke proceeding',
};

/** What each decision records — and nothing more. See the note at the top. */
export const SHOW_CAUSE_DECISION_MEANING: Record<ShowCauseDecision, string> = {
  CLOSED_SATISFACTORY: 'The explanation is accepted. The notice is closed and nothing further follows from it.',
  FURTHER_ACTION_REQUIRED:
    'The notice is closed with a note that the matter is not finished. Any further step is taken separately, by the ordinary workflow.',
  REJECTED: 'The explanation is not accepted. This records that finding only; it does not itself decide the application.',
  REVOKE_PROCEEDING:
    'A revocation proceeding is opened against the permission, for review and decision by the revoking authority.',
};

export const SHOW_CAUSE_DECISION_RESULT: Record<ShowCauseDecision, ShowCauseStatus> = {
  CLOSED_SATISFACTORY: 'CLOSED',
  FURTHER_ACTION_REQUIRED: 'FURTHER_ACTION',
  REJECTED: 'REJECTED',
  REVOKE_PROCEEDING: 'REFERRED_FOR_REVOCATION',
};

export const isShowCauseDecision = (v: string): v is ShowCauseDecision =>
  (SHOW_CAUSE_DECISIONS as readonly string[]).includes(v);

// ── The steps, as predicates ───────────────────────────────────────────────
//
// Every step of the branch is a WORKFLOW transition — Issue, Respond (raised
// on the applicant's behalf), Review Show Cause Submission, Decide — gated by
// guards in the transition rows. Dispatch is the Outward register's. These
// predicates state the same rules, for the screens to decide what to draw.

export const canRespond = (status: string) => status === 'AWAITING_RESPONSE';
export const canTakeUp = (status: string) => status === 'RESPONDED';
/** Response → Review Show Cause Submission → Decision: only a notice taken up is decided. */
export const canDecide = (status: string) => status === 'UNDER_REVIEW';

/** Days until (positive) or since (negative) the response was due. */
export function responseDueIn(due: Date | string, now = new Date()): number {
  const d = typeof due === 'string' ? new Date(due) : due;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/** Shown beside the due date. Words only — overdue has no effect (see the top). */
export function responseDueLabel(status: string, due: Date | string, now = new Date()): string {
  if (!['ISSUED', 'AWAITING_RESPONSE'].includes(status)) return '';
  const n = responseDueIn(due, now);
  if (n > 1) return `${n} days left`;
  if (n === 1) return 'Due tomorrow';
  if (n === 0) return 'Due today';
  return `${Math.abs(n)} day${n === -1 ? '' : 's'} past due`;
}

/** The standard response window, in days, pre-filled on the issue form. */
export const DEFAULT_RESPONSE_DAYS = 15;

export const DEMO_NOTICE_NOTE =
  'DEMO DOCUMENT — generated by the Nirman demonstration. Not a notice issued under any law.';
