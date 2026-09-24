/**
 * Shared workflow vocabulary. Isomorphic — the seed, the engine, the API and
 * the officer's screens all read these names from here.
 *
 * ── What is NOT in this file ─────────────────────────────────────────────
 *
 * No routing. Not one line here says which stage follows which, which role may
 * act, or what an action does to an application. That lives entirely in
 * `workflow_transitions` rows, and `src/server/workflow/engine.ts` is the only
 * code that reads them.
 *
 * The distinction matters because it is the whole design: this file is the
 * ALPHABET (the codes that may appear in a row, and how each one is spelled
 * for a human), and the database holds the SENTENCES. Adding "the Additional
 * Commissioner may now report a shortfall and forward" is a row. Adding a
 * genuinely new *kind* of action — one the engine must reason about
 * differently — is the only change that touches code.
 */

// ── Action codes ─────────────────────────────────────────────────────────
//
// The catalogue of `workflow_actions.code`. Seeded by 09-workflow.ts; a stage
// acquires one by having a transition row that references it.

export const ACTIONS = {
  /** System-raised when the last demand is settled. Starts the department run. */
  CONFIRM_PAYMENT: 'CONFIRM_PAYMENT',

  FORWARD: 'FORWARD',
  RETURN_TO_PREVIOUS: 'RETURN_TO_PREVIOUS',

  RAISE_DOCUMENT_SHORTFALL: 'RAISE_DOCUMENT_SHORTFALL',
  RAISE_FEE_SHORTFALL: 'RAISE_FEE_SHORTFALL',
  RAISE_TECHNICAL_SHORTFALL: 'RAISE_TECHNICAL_SHORTFALL',
  RAISE_CLARIFICATION: 'RAISE_CLARIFICATION',

  /** Records the shortfall and advances anyway. Two rows, not one flag. */
  REPORT_SHORTFALL_AND_FORWARD: 'REPORT_SHORTFALL_AND_FORWARD',
  REPORT_FEE_SHORTFALL_AND_FORWARD: 'REPORT_FEE_SHORTFALL_AND_FORWARD',

  RESUBMIT: 'RESUBMIT',
  ACCEPT_RESOLUTION: 'ACCEPT_RESOLUTION',
  REJECT_RESOLUTION: 'REJECT_RESOLUTION',
  /**
   * Closes a shortfall that was REPORTED and travelled with the file.
   *
   * A reported shortfall never parks the application, so there is no parked
   * stage to return to and no RESUBMIT to answer it — the applicant settles it
   * by paying the demand or supplying the document, and the officer holding
   * the file at that moment records that it is settled. Without this action a
   * reported shortfall could never be closed, and since an open one blocks
   * approval absolutely, the file could never be approved either.
   */
  RESOLVE_REPORTED_SHORTFALL: 'RESOLVE_REPORTED_SHORTFALL',

  APPROVE: 'APPROVE',
  REJECT: 'REJECT',

  // ── Site inspection (BBAS_STANDARD) ─────────────────────────────────────
  //
  // Performed ONLY by the site inspection service, which writes the inspection
  // and moves the file in one transaction. They appear in the action bar as a
  // pointer to the Site Inspection tab rather than as a modal, because the
  // modal cannot collect an inspector, a date, 27 answers or a signature —
  // see `inspection` on ActionOption.
  /** Books the visit and moves the file to the inspection desk. */
  SCHEDULE_SITE_INSPECTION: 'SCHEDULE_SITE_INSPECTION',
  /** Signed report, recommendation RECOMMENDED or REJECT: on to the next desk. */
  SUBMIT_SITE_INSPECTION: 'SUBMIT_SITE_INSPECTION',
  /** Signed report, recommendation SHORTFALL: a blocking technical shortfall. */
  RAISE_INSPECTION_SHORTFALL: 'RAISE_INSPECTION_SHORTFALL',

  // ── Show cause and revocation (Phase 7) ─────────────────────────────────
  //
  // Performed ONLY by the proceedings services, which pass the notice's or
  // the proposal's particulars in `ActionInput.proceeding`. The action bar
  // renders them as a pointer to the Proceedings tab — see `proceeding` on
  // ActionOption. None of them opens a shortfall.
  /** Issues a show cause notice and sends it to the Outward register. */
  ISSUE_SHOW_CAUSE: 'ISSUE_SHOW_CAUSE',
  /** Records the desk's decision on an answered notice. */
  DECIDE_SHOW_CAUSE: 'DECIDE_SHOW_CAUSE',
  /** Proposes revoking a granted permission. */
  INITIATE_REVOCATION: 'INITIATE_REVOCATION',
  /** The revoking authority takes a proposal up for review. */
  TAKE_UP_REVOCATION: 'TAKE_UP_REVOCATION',
  /**
   * The applicant's answer. SYSTEM-kind: raised by the show cause service on
   * the applicant's behalf (they own no desk), recorded in their name.
   */
  RESPOND_SHOW_CAUSE: 'RESPOND_SHOW_CAUSE',
  /** "Review Show Cause Submission": the desk takes the answer up. */
  TAKE_UP_SHOW_CAUSE: 'TAKE_UP_SHOW_CAUSE',
  /** Revokes: the file moves to CLOSED_REVOKED / PROCEEDING_REVOKED. */
  REVOKE_PROCEEDING: 'REVOKE_PROCEEDING',
  /** Declines the proposal; the permission stands. */
  REJECT_REVOCATION: 'REJECT_REVOCATION',

  // ── Change of technical professional (Phase 8) ──────────────────────────
  //
  // SYSTEM-kind: raised by the professional change service on behalf of the
  // officer taking the step, after it has checked they hold the step's
  // capability and the file is in their jurisdiction. A request moves desk to
  // desk (TPA → Planning Officer → ZDD → ZJD) wherever the FILE happens to be,
  // and a desk transition may only be granted to a role that owns the file's
  // stage. So the engine records the step, runs its guards and effects, and
  // writes the history; the service answers "is this your step?".
  REQUEST_PROFESSIONAL_CHANGE: 'REQUEST_PROFESSIONAL_CHANGE',
  VERIFY_PROFESSIONAL_CHANGE: 'VERIFY_PROFESSIONAL_CHANGE',
  REVIEW_PROFESSIONAL_CHANGE: 'REVIEW_PROFESSIONAL_CHANGE',
  /** Makes the proposed professional the file's professional. */
  APPROVE_PROFESSIONAL_CHANGE: 'APPROVE_PROFESSIONAL_CHANGE',
  REJECT_PROFESSIONAL_CHANGE: 'REJECT_PROFESSIONAL_CHANGE',

  // ── Commencement of work (Phase 9) ──────────────────────────────────────
  //
  // SYSTEM-kind: raised by the commencement service on behalf of the file's
  // technical professional (who owns no desk at CLOSED_APPROVED), after it has
  // checked COMMENCEMENT_NOTIFY and row scope. Same stage, same status.
  NOTIFY_WORK_COMMENCEMENT: 'NOTIFY_WORK_COMMENCEMENT',

  // ── Occupancy (Phase 10) ────────────────────────────────────────────────
  //
  // SYSTEM-kind, all eight: raised by the occupancy service on behalf of the
  // professional or officer taking the step, after it has checked the step's
  // OCCUPANCY_* capability and row scope. Every one stays at CLOSED_APPROVED
  // with the file APPROVED; the occupancy application carries its own status.
  SUBMIT_OCCUPANCY: 'SUBMIT_OCCUPANCY',
  SCHEDULE_FINAL_INSPECTION: 'SCHEDULE_FINAL_INSPECTION',
  RECORD_FINAL_INSPECTION: 'RECORD_FINAL_INSPECTION',
  RECOMMEND_OCCUPANCY: 'RECOMMEND_OCCUPANCY',
  RAISE_OCCUPANCY_SHORTFALL: 'RAISE_OCCUPANCY_SHORTFALL',
  RESPOND_OCCUPANCY_SHORTFALL: 'RESPOND_OCCUPANCY_SHORTFALL',
  APPROVE_OCCUPANCY: 'APPROVE_OCCUPANCY',
  REJECT_OCCUPANCY: 'REJECT_OCCUPANCY',
  ISSUE_OCCUPANCY_CERTIFICATE: 'ISSUE_OCCUPANCY_CERTIFICATE',
} as const;

export type ActionCode = (typeof ACTIONS)[keyof typeof ACTIONS];

/**
 * The actions that raise a shortfall, and what shape it takes.
 *
 * Read by the UI to decide whether the action modal needs the shortfall
 * fields, and by nothing else — the engine learns the same thing from the
 * transition's `effects`, which is authoritative.
 */
export const SHORTFALL_ACTIONS: Record<string, { kind: string; mode: string }> = {
  [ACTIONS.RAISE_DOCUMENT_SHORTFALL]: { kind: 'DOCUMENT', mode: 'BLOCKING' },
  [ACTIONS.RAISE_FEE_SHORTFALL]: { kind: 'FEE', mode: 'BLOCKING' },
  [ACTIONS.RAISE_TECHNICAL_SHORTFALL]: { kind: 'TECHNICAL', mode: 'BLOCKING' },
  [ACTIONS.RAISE_CLARIFICATION]: { kind: 'CLARIFICATION', mode: 'BLOCKING' },
  [ACTIONS.REPORT_SHORTFALL_AND_FORWARD]: { kind: 'DOCUMENT', mode: 'REPORTED' },
  [ACTIONS.REPORT_FEE_SHORTFALL_AND_FORWARD]: { kind: 'FEE', mode: 'REPORTED' },
  [ACTIONS.RAISE_INSPECTION_SHORTFALL]: { kind: 'TECHNICAL', mode: 'BLOCKING' },
};

// ── Guards ───────────────────────────────────────────────────────────────
//
// Every name a `workflow_transitions.guards` array may contain. The engine
// refuses to evaluate a transition naming a guard it does not implement — a
// typo in configuration must fail loudly, never silently permit.

export const GUARDS = {
  DRAWING_UPLOADED: 'drawing_uploaded',
  SCRUTINY_PASSED: 'scrutiny_passed',
  DOCUMENTS_COMPLETE: 'documents_complete',
  FEE_DEMAND_ISSUED: 'fee_demand_issued',
  FEES_PAID: 'fees_paid',
  NO_OPEN_BLOCKING_SHORTFALLS: 'no_open_blocking_shortfalls',
  NO_OPEN_SHORTFALLS: 'no_open_shortfalls',
  HAS_REMARKS: 'has_remarks',
  HAS_ATTACHMENT: 'has_attachment',
  SHORTFALL_AWAITING_REVIEW: 'shortfall_awaiting_review',
  REPORTED_SHORTFALL_OPEN: 'reported_shortfall_open',
  SLA_NOT_OVERDUE: 'sla_not_overdue',
  /** A booked inspection exists that no transition has moved the file for yet. */
  SITE_INSPECTION_SCHEDULED: 'site_inspection_scheduled',
  /** A signed inspection report exists that has not yet routed the file. */
  SITE_INSPECTION_SIGNED: 'site_inspection_signed',
  /**
   * Every NOC the desk has not ruled out is VERIFIED. Registered, and attached
   * to no transition by default — see the note in guards.ts.
   */
  NOCS_VERIFIED: 'nocs_verified',
  /** No show cause notice on the file is still undecided. */
  NO_OPEN_SHOW_CAUSE: 'no_open_show_cause',
  /**
   * A notice on the file has been answered and awaits the desk's decision.
   * Superseded by the three step guards below; kept registered because a
   * retired transition row may still name it.
   */
  SHOW_CAUSE_AWAITING_DECISION: 'show_cause_awaiting_decision',
  /** A notice on the file has been dispatched and not yet answered. */
  SHOW_CAUSE_AWAITING_RESPONSE: 'show_cause_awaiting_response',
  /** A notice on the file has been answered and nobody has taken it up. */
  SHOW_CAUSE_RESPONDED: 'show_cause_responded',
  /** An answered notice is under review and awaits the decision. */
  SHOW_CAUSE_UNDER_REVIEW: 'show_cause_under_review',
  /** No revocation proceeding on the file is still undecided. */
  NO_OPEN_REVOCATION: 'no_open_revocation',
  /** A revocation has been proposed and nobody has taken it up. */
  REVOCATION_PROPOSED: 'revocation_proposed',
  /** A revocation is under review and awaits a decision. */
  REVOCATION_UNDER_REVIEW: 'revocation_under_review',
  /** No change of professional request on the file is still undecided. */
  NO_OPEN_PROFESSIONAL_CHANGE: 'no_open_professional_change',
  /** A request is registered and awaits verification. */
  PROFESSIONAL_CHANGE_PENDING_VERIFICATION: 'professional_change_pending_verification',
  /** A verified request awaits review. */
  PROFESSIONAL_CHANGE_UNDER_REVIEW: 'professional_change_under_review',
  /** A reviewed request awaits the decision. */
  PROFESSIONAL_CHANGE_PENDING_DECISION: 'professional_change_pending_decision',
  /** The file's building permission order is ISSUED and not revoked. */
  PROCEEDING_ISSUED: 'proceeding_issued',
  /** No commencement of work has been notified on the file yet. */
  NO_WORK_COMMENCEMENT: 'no_work_commencement',
  /** Commencement has been notified and its date has arrived. */
  WORK_INITIATED: 'work_initiated',
  /** No occupancy application on the file is open, and none was granted. */
  NO_OPEN_OCCUPANCY: 'no_open_occupancy',
  /** The file's current occupancy application is in the named status. */
  OCCUPANCY_SUBMITTED: 'occupancy_submitted',
  OCCUPANCY_INSPECTION_PENDING: 'occupancy_inspection_pending',
  OCCUPANCY_INSPECTION_COMPLETED: 'occupancy_inspection_completed',
  OCCUPANCY_SHORTFALL: 'occupancy_shortfall',
  OCCUPANCY_RECOMMENDED: 'occupancy_recommended',
  OCCUPANCY_APPROVED: 'occupancy_approved',
} as const;

export type GuardName = (typeof GUARDS)[keyof typeof GUARDS];

// ── Effects ──────────────────────────────────────────────────────────────

export const EFFECTS = {
  RAISE_SHORTFALL: 'RAISE_SHORTFALL',
  RECORD_RESOLUTION: 'RECORD_RESOLUTION',
  RESOLVE_SHORTFALL: 'RESOLVE_SHORTFALL',
  REJECT_RESOLUTION: 'REJECT_RESOLUTION',
  GENERATE_FEE_DEMAND: 'GENERATE_FEE_DEMAND',
  RETURN_TO_ORIGIN: 'RETURN_TO_ORIGIN',
  GENERATE_APPROVAL_ORDER: 'GENERATE_APPROVAL_ORDER',
  CLOSE_WORKFLOW: 'CLOSE_WORKFLOW',
  /** Ties a scheduled or signed inspection to the transition that moved the file. */
  LINK_SITE_INSPECTION: 'LINK_SITE_INSPECTION',
  /**
   * Leaves the application's status exactly as it is. For a branch step that
   * is not a movement of the file — a show cause issued at a desk must not
   * rewrite a SHORTFALL_RESPONDED the desk still has to deal with. A
   * transition carrying it may leave `toStatus` empty.
   */
  KEEP_STATUS: 'KEEP_STATUS',
  /** Writes a show cause step: ISSUE, RESPOND, REVIEW or DECIDE. */
  SHOW_CAUSE: 'SHOW_CAUSE',
  /** Writes a revocation proceeding: step PROPOSE, REVIEW or DECIDE (+ outcome). */
  REVOCATION: 'REVOCATION',
  /** Writes a change of professional step: REQUEST, VERIFY, REVIEW or DECIDE (+ outcome). */
  PROFESSIONAL_CHANGE: 'PROFESSIONAL_CHANGE',
  /** Records the commencement of work notice. */
  WORK_COMMENCEMENT: 'WORK_COMMENCEMENT',
  /** Writes an occupancy step: SUBMIT, SCHEDULE, INSPECT, RECOMMEND, SHORTFALL, RESPOND, DECIDE (+ outcome), ISSUE. */
  OCCUPANCY: 'OCCUPANCY',
} as const;

export type EffectType = (typeof EFFECTS)[keyof typeof EFFECTS];

/** One entry of a transition's ordered `effects` array. */
export type EffectSpec = { type: EffectType | string } & Record<string, unknown>;

// ── SLA clock control ────────────────────────────────────────────────────

export const SLA_BEHAVIOURS = ['START', 'PAUSE', 'RESUME', 'STOP', 'NONE'] as const;
export type SlaBehaviour = (typeof SLA_BEHAVIOURS)[number];

// ── Display ──────────────────────────────────────────────────────────────

/**
 * Short stage labels for columns and badges.
 *
 * Unknown codes fall back to a title-cased version of the code itself, so a
 * stage added by an administrator renders as something readable rather than
 * as a blank cell.
 */
export const STAGE_LABELS: Record<string, string> = {
  LTP_DRAFT: 'Filing',
  LTP_DRAWING: 'Drawing',
  LTP_DOCUMENTS: 'Documents',
  LTP_PAYMENT: 'Payment',
  TPA_REVIEW: 'TPA',
  TPA_SITE_INSPECTION: 'Site inspection',
  PLANNING_OFFICER_REVIEW: 'Planning Officer',
  ZDD_REVIEW: 'ZDD',
  ZAD_ZDD_REVIEW: 'ZAD/ZDD',
  ZJD_REVIEW: 'ZJD',
  DIRECTOR_DP_REVIEW: 'Director',
  ADDL_COMMISSIONER_REVIEW: 'Addl Commissioner',
  COMMISSIONER_REVIEW: 'Commissioner',
  LTP_SHORTFALL_ACTION: 'With applicant',
  CLOSED_APPROVED: 'Approved',
  CLOSED_REJECTED: 'Rejected',
  CLOSED_REVOKED: 'Proceeding revoked',
};

/**
 * The desk that inherits a legacy desk's work in BBAS_STANDARD.
 *
 * Two chains exist, and a record written under one is never rewritten to match
 * the other: a shortfall raised at the Commissioner's desk in 2025 says
 * `COMMISSIONER_REVIEW` for ever, because that is where it was raised and that
 * record is quoted back to applicants.
 *
 * But a register of OPEN work has to show it to somebody. An open shortfall
 * whose file now waits at the ZJD is the ZJD's business, so the desk panel
 * attributes it there — this map is how, and it is the same map
 * `scripts/align-bbas-workflow.ts` moved the files themselves by. A code with
 * no entry maps to itself.
 *
 * Display only. Nothing routes through it, and no stored value is changed by
 * it.
 */
const BBAS_SUCCESSOR_DESK: Record<string, string> = {
  ZAD_ZDD_REVIEW: 'ZDD_REVIEW',
  DIRECTOR_DP_REVIEW: 'ZJD_REVIEW',
  ADDL_COMMISSIONER_REVIEW: 'ZJD_REVIEW',
  COMMISSIONER_REVIEW: 'ZJD_REVIEW',
};

/**
 * Where a historical stage code's open work belongs today.
 *
 * `knownCodes` is the set of desks the register is actually showing. A legacy
 * code that IS one of them — TPA_REVIEW exists in both chains — is left alone;
 * only a code with nowhere to go is forwarded to its successor.
 */
export function deskForStageCode(code: string, knownCodes: ReadonlySet<string>): string {
  if (knownCodes.has(code)) return code;
  return BBAS_SUCCESSOR_DESK[code] ?? code;
}

/** The officer inbox's filters. Each is a saved question, not a free search. */
export const TASK_FILTERS = {
  ALL: 'all',
  NEW: 'new',
  PENDING: 'pending',
  DUE_SOON: 'due-soon',
  OVERDUE: 'overdue',
  SHORTFALL: 'shortfall',
} as const;

export type TaskFilter = (typeof TASK_FILTERS)[keyof typeof TASK_FILTERS];

export const TASK_FILTER_META: Array<{ key: TaskFilter; label: string; description: string }> = [
  { key: TASK_FILTERS.ALL, label: 'All', description: 'Every file at your desk.' },
  { key: TASK_FILTERS.NEW, label: 'New', description: 'Arrived and not yet opened by anyone.' },
  { key: TASK_FILTERS.PENDING, label: 'In progress', description: 'Claimed and being worked.' },
  { key: TASK_FILTERS.DUE_SOON, label: 'Due soon', description: 'Approaching the service standard.' },
  { key: TASK_FILTERS.OVERDUE, label: 'Overdue', description: 'Past the service standard.' },
  {
    key: TASK_FILTERS.SHORTFALL,
    label: 'Shortfall',
    description: 'Carrying an open shortfall, raised here or travelling with the file.',
  },
];

export const isTaskFilter = (value: string): value is TaskFilter =>
  TASK_FILTER_META.some((f) => f.key === value);

/**
 * Priority as a word. Stamped on the task by the assignment rule that routed
 * it; 0 is the ordinary case and is deliberately called "Normal" rather than
 * left blank, so a column of priorities never has holes in it.
 */
export function priorityLabel(priority: number): { label: string; tone: 'neutral' | 'warning' | 'danger' } {
  if (priority >= 20) return { label: 'Urgent', tone: 'danger' };
  if (priority >= 10) return { label: 'High', tone: 'warning' };
  return { label: 'Normal', tone: 'neutral' };
}

/** Whole days between two instants, floored — "3 days pending", never "3.4". */
export function daysBetween(from: Date | string, to: Date | string = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * How an SLA reads on a row: "2 days left", "Due today", "3 days over".
 *
 * OVERDUE is worded as elapsed time rather than as a breach, because passing
 * the date has no legal effect in this system (docs/07-subsystems.md R.1.1).
 * The row says what is true; it does not accuse anybody.
 */
export function slaLabel(dueAt: Date | string | null | undefined, now: Date = new Date()): string {
  if (!dueAt) return '—';
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);

  if (diffDays > 1) return `${diffDays} days left`;
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays === 0) return 'Due today';
  const over = Math.abs(diffDays);
  return over === 1 ? '1 day over' : `${over} days over`;
}

export function stageName(code: string | null | undefined): string {
  if (!code) return '—';
  return (
    STAGE_LABELS[code] ??
    code
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
