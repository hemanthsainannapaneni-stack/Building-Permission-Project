/**
 * WHERE THE SEVENTY APPLICATIONS STOP.
 *
 * Each entry names a resting state and how many files should be sitting in it.
 * The journey builder walks the real services and the real workflow engine
 * until it reaches the named stop — it never writes a status directly — so a
 * state that the system cannot actually produce cannot appear in this list
 * without the seed failing loudly.
 *
 * That is the difference between a demo and a fiction. `PAYMENT_SUCCESSFUL`
 * here means a demand was calculated, a payment was initiated, a gateway
 * callback settled it, a receipt was issued and the engine started the
 * departmental run — not a row with the word written in it.
 *
 * ── Statuses ─────────────────────────────────────────────────────────────
 *
 * The stop names below are the seed's own vocabulary, not statuses. The
 * canonical `ApplicationStatus` each one lands on is in `landsOn`, and the
 * reconciliation script asserts that every seeded application really is on the
 * status its plan claimed. Where the brief asked for a status this system does
 * not have — SENT_TO_TPA, WITH_TPA, DRAWING_CORRECTION_REQUIRED — the
 * canonical equivalent is used instead: PENDING_TPA covers the first two, and
 * a correction cycle is SCRUTINY_FAILED followed by a new drawing version.
 */

export type Stop =
  // ── Applicant side ────────────────────────────────────────────────────
  | 'DRAFT_EARLY'
  | 'DRAFT_LATE'
  | 'SUBMITTED'
  | 'DRAWING_UPLOADED'
  | 'SCRUTINY_QUEUED'
  | 'SCRUTINY_FAILED'
  | 'SCRUTINY_REUPLOADED'
  | 'SCRUTINY_PASSED'
  | 'DOCUMENTS_PARTIAL'
  | 'DOCUMENTS_COMPLETE'
  | 'FEE_GENERATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  // ── Departmental side ─────────────────────────────────────────────────
  | 'TPA_UNCLAIMED'
  | 'TPA_CLAIMED'
  | 'TPA_REVIEWING'
  | 'TPA_DOCUMENT_SHORTFALL'
  | 'TPA_FEE_SHORTFALL'
  | 'TPA_SHORTFALL_RESPONDED'
  | 'TPA_SHORTFALL_CYCLE_2'
  | 'TPA_SHORTFALL_CYCLE_2_RESPONDED'
  | 'TPA_SHORTFALL_CYCLE_2_RESOLVED'
  | 'PO_UNCLAIMED'
  | 'PO_CLAIMED'
  | 'PO_REVIEWING'
  | 'PO_SHORTFALL'
  | 'ZDD_UNCLAIMED'
  | 'ZDD_FEE_SHORTFALL'
  | 'ZJD_UNCLAIMED'
  | 'ZJD_WITH_REPORTED_DOC'
  | 'ZJD_FEE_SHORTFALL'
  | 'APPROVED'
  | 'REJECTED';

export type PlanEntry = {
  stop: Stop;
  count: number;
  /** The canonical ApplicationStatus this stop must land on. Asserted. */
  landsOn: string;
  /** The workflow stage code, or null for files the engine has not started. */
  stageCode: string | null;
  /** How old, in days, the oldest and newest file in this group should be. */
  ageDays: [number, number];
  note: string;
};

/**
 * Seventy files. The shape is a real office's: a wide base of applicant-side
 * work, a busy first review desk, and progressively fewer files at each
 * senior desk — with a handful closed at each end.
 */
export const PLAN: PlanEntry[] = [
  // ── Applicant side: 35 ────────────────────────────────────────────────
  {
    stop: 'DRAFT_EARLY',
    count: 2,
    landsOn: 'DRAFT',
    stageCode: null,
    ageDays: [1, 6],
    note: 'Started this week, a few steps in.',
  },
  {
    stop: 'DRAFT_LATE',
    count: 2,
    landsOn: 'DRAFT',
    stageCode: null,
    ageDays: [3, 20],
    note: 'Every step answered, not yet filed.',
  },
  {
    stop: 'SUBMITTED',
    count: 3,
    landsOn: 'SUBMITTED',
    stageCode: null,
    ageDays: [4, 28],
    note: 'Filed. No drawing uploaded yet.',
  },
  {
    stop: 'DRAWING_UPLOADED',
    count: 3,
    landsOn: 'DRAWING_UPLOADED',
    stageCode: null,
    ageDays: [6, 35],
    note: 'Drawing on file, scrutiny not requested.',
  },
  {
    stop: 'SCRUTINY_QUEUED',
    count: 2,
    landsOn: 'SCRUTINY_IN_PROGRESS',
    stageCode: null,
    ageDays: [1, 3],
    note: 'Scrutiny requested and queued with the engine.',
  },
  {
    stop: 'SCRUTINY_FAILED',
    count: 2,
    landsOn: 'SCRUTINY_FAILED',
    stageCode: null,
    ageDays: [8, 45],
    note: 'Failed with findings. Awaiting a corrected drawing.',
  },
  {
    stop: 'SCRUTINY_REUPLOADED',
    count: 2,
    landsOn: 'DRAWING_UPLOADED',
    stageCode: null,
    ageDays: [10, 50],
    note: 'Failed once, corrected version uploaded, awaiting re-scrutiny.',
  },
  {
    stop: 'SCRUTINY_PASSED',
    count: 3,
    landsOn: 'SCRUTINY_PASSED',
    stageCode: null,
    ageDays: [9, 40],
    note: 'Passed. Document upload not started.',
  },
  {
    stop: 'DOCUMENTS_PARTIAL',
    count: 3,
    landsOn: 'DOCUMENT_UPLOAD_PENDING',
    stageCode: null,
    ageDays: [12, 55],
    note: 'Some mandatory documents still outstanding.',
  },
  {
    stop: 'DOCUMENTS_COMPLETE',
    count: 2,
    landsOn: 'DOCUMENTS_COMPLETED',
    stageCode: null,
    ageDays: [14, 60],
    note: 'Checklist satisfied. No demand raised yet.',
  },
  {
    stop: 'FEE_GENERATED',
    count: 3,
    landsOn: 'FEE_GENERATED',
    stageCode: null,
    ageDays: [15, 65],
    note: 'Demand issued and unpaid.',
  },
  {
    stop: 'PAYMENT_PENDING',
    count: 2,
    landsOn: 'PAYMENT_PENDING',
    stageCode: null,
    ageDays: [2, 12],
    note: 'Payment handed to the gateway and not yet settled.',
  },
  {
    stop: 'PAYMENT_FAILED',
    count: 2,
    landsOn: 'PAYMENT_FAILED',
    stageCode: null,
    ageDays: [3, 30],
    note: 'The gateway declined the attempt. The demand is still payable.',
  },

  // ── Departmental side: 35 ─────────────────────────────────────────────
  {
    stop: 'TPA_UNCLAIMED',
    count: 3,
    landsOn: 'PENDING_TPA',
    stageCode: 'TPA_REVIEW',
    ageDays: [20, 75],
    note: 'In the shared TPA inbox, nobody holding it.',
  },
  {
    stop: 'TPA_CLAIMED',
    count: 1,
    landsOn: 'PENDING_TPA',
    stageCode: 'TPA_REVIEW',
    ageDays: [22, 80],
    note: 'Claimed by a TPA and being worked.',
  },
  {
    // The only route to a stage's WORKING status: a shortfall was raised,
    // answered and accepted, and the officer still holds the file. Claiming
    // alone does not change the application's status, and seeding one that
    // says otherwise would show a state the engine cannot produce.
    stop: 'TPA_REVIEWING',
    count: 1,
    landsOn: 'TPA_REVIEW',
    stageCode: 'TPA_REVIEW',
    ageDays: [24, 82],
    note: 'A shortfall was raised, answered and accepted. Under active review.',
  },
  {
    stop: 'TPA_DOCUMENT_SHORTFALL',
    count: 1,
    landsOn: 'TPA_DOCUMENT_SHORTFALL',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [25, 70],
    note: 'Parked with the applicant on a blocking document shortfall.',
  },
  {
    stop: 'TPA_FEE_SHORTFALL',
    count: 1,
    landsOn: 'TPA_FEE_SHORTFALL',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [26, 72],
    note: 'Parked on a fee shortfall, with a supplementary demand raised.',
  },
  {
    stop: 'TPA_SHORTFALL_RESPONDED',
    count: 1,
    landsOn: 'SHORTFALL_RESPONDED',
    stageCode: 'TPA_REVIEW',
    ageDays: [28, 78],
    note: 'The applicant has answered; the TPA has not yet accepted it.',
  },
  {
    // CYCLE 2, PARKED. The applicant answered, the TPA sent it back naming the
    // item that was still wrong, and it is with the applicant again. This is
    // the state the multi-cycle history exists to record, and a demonstration
    // that never reaches it never shows that the first answer is kept.
    stop: 'TPA_SHORTFALL_CYCLE_2',
    count: 2,
    landsOn: 'RETURNED_TO_APPLICANT',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [34, 88],
    note: 'Answered once, sent back, and now on its second cycle with the applicant.',
  },
  {
    stop: 'TPA_SHORTFALL_CYCLE_2_RESPONDED',
    count: 1,
    landsOn: 'SHORTFALL_RESPONDED',
    stageCode: 'TPA_REVIEW',
    ageDays: [36, 90],
    note: 'Second response submitted and waiting on the TPA.',
  },
  {
    stop: 'TPA_SHORTFALL_CYCLE_2_RESOLVED',
    count: 2,
    landsOn: 'TPA_REVIEW',
    stageCode: 'TPA_REVIEW',
    ageDays: [38, 92],
    note: 'Two cycles, the second accepted. Both attempts remain on the record.',
  },
  // BBAS_STANDARD desks: TPA → Planning Officer → ZDD → ZJD, and the ZJD
  // decides. Every application type routes through this chain.
  {
    stop: 'PO_UNCLAIMED',
    count: 4,
    landsOn: 'PENDING_PLANNING_OFFICER',
    stageCode: 'PLANNING_OFFICER_REVIEW',
    ageDays: [30, 95],
    note: 'Forwarded by the TPA, waiting at the Planning Officer’s desk.',
  },
  {
    stop: 'PO_CLAIMED',
    count: 1,
    landsOn: 'PENDING_PLANNING_OFFICER',
    stageCode: 'PLANNING_OFFICER_REVIEW',
    ageDays: [33, 90],
    note: 'Held by a Planning Officer.',
  },
  {
    stop: 'PO_REVIEWING',
    count: 1,
    landsOn: 'PLANNING_OFFICER_REVIEW',
    stageCode: 'PLANNING_OFFICER_REVIEW',
    ageDays: [36, 92],
    note: 'A Planning Officer shortfall was raised, answered and accepted. Under active review.',
  },
  {
    stop: 'PO_SHORTFALL',
    count: 1,
    landsOn: 'PLANNING_OFFICER_SHORTFALL',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [35, 88],
    note: 'Returned to the applicant from the Planning Officer’s desk.',
  },
  {
    stop: 'ZDD_UNCLAIMED',
    count: 5,
    landsOn: 'PENDING_ZDD',
    stageCode: 'ZDD_REVIEW',
    ageDays: [40, 110],
    note: 'With the Zonal Deputy Director.',
  },
  {
    stop: 'ZDD_FEE_SHORTFALL',
    count: 1,
    landsOn: 'ZDD_SHORTFALL',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [42, 100],
    note: 'Parked on a fee shortfall raised by the ZDD.',
  },
  {
    stop: 'ZJD_UNCLAIMED',
    count: 4,
    landsOn: 'PENDING_ZJD',
    stageCode: 'ZJD_REVIEW',
    ageDays: [50, 140],
    note: 'Awaiting the Zonal Joint Director’s decision.',
  },
  {
    stop: 'ZJD_WITH_REPORTED_DOC',
    count: 1,
    landsOn: 'PENDING_ZJD',
    stageCode: 'ZJD_REVIEW',
    ageDays: [55, 135],
    note: 'Carrying a REPORTED document shortfall raised by the ZDD — it travelled with the file.',
  },
  {
    stop: 'ZJD_FEE_SHORTFALL',
    count: 1,
    landsOn: 'ZJD_FEE_SHORTFALL',
    stageCode: 'LTP_SHORTFALL_ACTION',
    ageDays: [60, 150],
    note: 'Parked on a fee shortfall raised by the ZJD.',
  },
  {
    stop: 'APPROVED',
    count: 5,
    landsOn: 'APPROVED',
    stageCode: 'CLOSED_APPROVED',
    ageDays: [80, 200],
    note: 'Sanctioned, with an approval order on file.',
  },
  {
    stop: 'REJECTED',
    count: 2,
    landsOn: 'REJECTED',
    stageCode: 'CLOSED_REJECTED',
    ageDays: [90, 190],
    note: 'Refused by the ZJD, with reasons recorded.',
  },
];

export const PLANNED_TOTAL = PLAN.reduce((sum, entry) => sum + entry.count, 0);

/** Flattens the plan into one entry per application, in a stable order. */
export function planItems(): Array<{ stop: Stop; index: number; entry: PlanEntry }> {
  const items: Array<{ stop: Stop; index: number; entry: PlanEntry }> = [];
  let index = 0;
  for (const entry of PLAN) {
    for (let i = 0; i < entry.count; i += 1) {
      items.push({ stop: entry.stop, index, entry });
      index += 1;
    }
  }
  return items;
}
