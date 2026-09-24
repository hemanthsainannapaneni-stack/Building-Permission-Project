import type { TransitionSeed, WorkflowDefinition } from './builder';

/**
 * THE SHOW CAUSE BRANCH, as rows.
 *
 *   Review → Issue (desk) → [Outward: dispatch] → Respond (applicant)
 *          → Review Show Cause Submission (desk) → Decide (desk)
 *
 * Optional — nothing in the normal chain requires it — and not a movement of
 * the file: every row lands back on the same stage with the same status
 * (KEEP_STATUS), so a file under show cause is visibly where it was, and an
 * approved file stays APPROVED because a notice is not a suspension. The
 * branch's own position lives on the notice; the steps are ordered by the
 * guards, each of which names the one state the previous step leaves.
 */
const keep = [{ type: 'KEEP_STATUS' }];

/** Issue, review and decide at a desk that may issue notices. */
function showCauseDesk(stage: string, allowedRoleKeys?: string[]): TransitionSeed[] {
  const roles = allowedRoleKeys ? { allowedRoleKeys } : {};
  return [
    {
      from: stage,
      action: 'ISSUE_SHOW_CAUSE',
      fromStatus: null,
      to: stage,
      toStatus: '',
      ...roles,
      guards: ['no_open_show_cause', 'has_remarks'],
      effects: [...keep, { type: 'SHOW_CAUSE', step: 'ISSUE' }],
      notify: '',
      sla: 'NONE',
    },
    {
      from: stage,
      action: 'TAKE_UP_SHOW_CAUSE',
      fromStatus: null,
      to: stage,
      toStatus: '',
      ...roles,
      guards: ['show_cause_responded'],
      effects: [...keep, { type: 'SHOW_CAUSE', step: 'REVIEW' }],
      notify: '',
      sla: 'NONE',
    },
    {
      from: stage,
      action: 'DECIDE_SHOW_CAUSE',
      fromStatus: null,
      to: stage,
      toStatus: '',
      ...roles,
      guards: ['show_cause_under_review', 'has_remarks'],
      effects: [...keep, { type: 'SHOW_CAUSE', step: 'DECIDE' }],
      notify: '',
      sla: 'NONE',
    },
  ];
}

/**
 * The applicant's answer, wherever the file happens to be when it arrives —
 * a file may have been forwarded or returned since the notice was issued, and
 * the applicant must still be able to answer. Raised by the system on the
 * applicant's behalf; the guard requires the notice to have been DISPATCHED.
 */
const showCauseResponse = (stage: string): TransitionSeed => ({
  from: stage,
  action: 'RESPOND_SHOW_CAUSE',
  fromStatus: null,
  to: stage,
  toStatus: '',
  guards: ['show_cause_awaiting_response'],
  effects: [...keep, { type: 'SHOW_CAUSE', step: 'RESPOND' }],
  notify: '',
  sla: 'NONE',
});

/**
 * THE CHANGE OF TECHNICAL PROFESSIONAL BRANCH, as rows (Phase 8).
 *
 *   Request → Verification → Review → Approval │ Rejection
 *
 * Optional and not a movement of the file: every row lands on the same stage
 * with the same status, so a file whose professional is being changed is
 * visibly where it was. Available wherever the department holds a live file,
 * and after approval (construction continues under a professional).
 *
 * SYSTEM-kind (see the action catalogue): the professional change service
 * raises each step on the officer's behalf once it has checked the step's
 * capability. The guards order the steps; `has_remarks` makes every step after
 * the request carry the officer's reasons.
 */
const professionalChange = (stage: string): TransitionSeed[] => {
  const row = (action: string, guards: string[], step: string, outcome?: string): TransitionSeed => ({
    from: stage,
    action,
    fromStatus: null,
    to: stage,
    toStatus: '',
    guards,
    effects: [...keep, { type: 'PROFESSIONAL_CHANGE', step, ...(outcome ? { outcome } : {}) }],
    notify: '',
    sla: 'NONE',
  });
  return [
    row('REQUEST_PROFESSIONAL_CHANGE', ['no_open_professional_change', 'has_remarks'], 'REQUEST'),
    row('VERIFY_PROFESSIONAL_CHANGE', ['professional_change_pending_verification', 'has_remarks'], 'VERIFY'),
    row('REVIEW_PROFESSIONAL_CHANGE', ['professional_change_under_review', 'has_remarks'], 'REVIEW'),
    row('APPROVE_PROFESSIONAL_CHANGE', ['professional_change_pending_decision', 'has_remarks'], 'DECIDE', 'APPROVED'),
    row('REJECT_PROFESSIONAL_CHANGE', ['professional_change_pending_decision', 'has_remarks'], 'DECIDE', 'REJECTED'),
  ];
};

/** Where a professional may be changed: every stage a live or approved file can sit at. */
export const PROFESSIONAL_CHANGE_STAGES = [
  'TPA_REVIEW',
  'TPA_SITE_INSPECTION',
  'PLANNING_OFFICER_REVIEW',
  'ZDD_REVIEW',
  'ZJD_REVIEW',
  'LTP_SHORTFALL_ACTION',
  'CLOSED_APPROVED',
] as const;

/**
 * THE OCCUPANCY BRANCH, as rows (Phase 10).
 *
 *   Completion intimation + occupancy submission (LTP) → schedule and record
 *   the final inspection (TPA) → as-built review: recommend or shortfall (ZDD)
 *   → shortfall answered (LTP, back to inspection) → approve │ reject (ZJD)
 *   → issue the occupancy certificate (ZJD)
 *
 * Only out of CLOSED_APPROVED with the file APPROVED, so no occupancy can be
 * applied for before the permission. SUBMIT_OCCUPANCY also requires the order
 * to be ISSUED (`proceeding_issued`) and work to have been initiated
 * (`work_initiated`) — "where required" is exactly whether that guard is on
 * this row, so a department that does not require a commencement notice
 * removes the guard here and changes no code. The other guards order the
 * steps. SYSTEM-kind, and none moves the file (KEEP_STATUS).
 */
const occupancyRow = (action: string, guards: string[], step: string, extra: Record<string, unknown> = {}, notify = ''): TransitionSeed => ({
  from: 'CLOSED_APPROVED',
  action,
  fromStatus: 'APPROVED',
  to: 'CLOSED_APPROVED',
  toStatus: '',
  guards,
  effects: [...keep, { type: 'OCCUPANCY', step, ...extra }],
  notify,
  sla: 'NONE',
});

const occupancy: TransitionSeed[] = [
  occupancyRow('SUBMIT_OCCUPANCY', ['proceeding_issued', 'work_initiated', 'no_open_occupancy'], 'SUBMIT', {}, 'OCCUPANCY_SUBMITTED'),
  occupancyRow('SCHEDULE_FINAL_INSPECTION', ['occupancy_submitted'], 'SCHEDULE'),
  occupancyRow('RECORD_FINAL_INSPECTION', ['occupancy_inspection_pending', 'has_remarks'], 'INSPECT'),
  occupancyRow('RECOMMEND_OCCUPANCY', ['occupancy_inspection_completed', 'has_remarks'], 'RECOMMEND'),
  occupancyRow('RAISE_OCCUPANCY_SHORTFALL', ['occupancy_inspection_completed', 'has_remarks'], 'SHORTFALL'),
  occupancyRow('RESPOND_OCCUPANCY_SHORTFALL', ['occupancy_shortfall', 'has_remarks'], 'RESPOND'),
  occupancyRow('APPROVE_OCCUPANCY', ['occupancy_recommended', 'has_remarks'], 'DECIDE', { outcome: 'APPROVED' }),
  occupancyRow('REJECT_OCCUPANCY', ['occupancy_recommended', 'has_remarks'], 'DECIDE', { outcome: 'REJECTED' }),
  occupancyRow('ISSUE_OCCUPANCY_CERTIFICATE', ['occupancy_approved'], 'ISSUE'),
];

export const BBAS_STANDARD: WorkflowDefinition = {
  code: 'BBAS_STANDARD',
  version: 1,
  name: 'BBAS standard building permission',
  description: 'TPA → Planning Officer → ZDD → ZJD. The default demonstration workflow.',

  // SLA days are illustrative seed data, editable at runtime from Settings.
  stages: [
    // ── Applicant side ───────────────────────────────────────────────────
    //
    // Listed because they are real places a file sits and the register labels
    // them, but the engine takes over only at LTP_PAYMENT: `startWorkflow`
    // creates the instance there and immediately performs CONFIRM_PAYMENT.
    // Everything before that is driven by the filing services.
    {
      code: 'LTP_DRAFT',
      name: 'Filing',
      type: 'LTP_ACTION',
      sequence: 10,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DRAFT',
      description: 'The LTP is preparing the application. Driven by the filing wizard.',
    },
    {
      code: 'LTP_DRAWING',
      name: 'Drawing and scrutiny',
      type: 'LTP_ACTION',
      sequence: 20,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DRAWING_UPLOADED',
      workingStatus: 'SCRUTINY_IN_PROGRESS',
      description: 'The drawing or BIM model is uploaded and checked. Driven by the scrutiny service.',
    },
    {
      code: 'LTP_DOCUMENTS',
      name: 'Documents',
      type: 'LTP_ACTION',
      sequence: 30,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DOCUMENT_UPLOAD_PENDING',
      description: 'The document checklist is being completed. Driven by the document service.',
    },
    {
      code: 'LTP_PAYMENT',
      name: 'Payment',
      type: 'LTP_ACTION',
      sequence: 40,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'FEE_GENERATED',
      workingStatus: 'PAYMENT_PENDING',
      // Where every departmental run begins, so the first row in a file's
      // history is the payment that carried it to the department.
      isEntry: true,
      description: 'The fee is payable. A confirmed payment carries the file to the department.',
    },

    // ── Departmental side ────────────────────────────────────────────────
    {
      code: 'TPA_REVIEW',
      name: 'Town Planning Assistant',
      type: 'REVIEW',
      sequence: 50,
      ownerRoleKeys: ['TPA'],
      entryStatus: 'PENDING_TPA',
      workingStatus: 'TPA_REVIEW',
      slaDays: 7,
      // Each desk's clock is reported to the desk ABOVE it. Notification only:
      // nothing is reassigned and nothing is decided (docs R.1.1).
      escalateToRoleKey: 'PLANNING_OFFICER',
      description:
        'Technical scrutiny: checklist, documents, site inspection, drawing and BIM, NOCs, fees.',
    },
    {
      // TPA manual §5.8. The TPA books the visit from TPA_REVIEW, goes to the
      // site, answers the 27 questions, photographs it, recommends and signs.
      // A desk of its own rather than a flag on TPA_REVIEW, so the register,
      // the task queue and the SLA can all see a file that is waiting on a
      // visit — which is a different wait from one waiting on scrutiny.
      //
      // Owned by the TPA role; the task is handed to the named inspector when
      // the visit is booked (see scheduleInspection).
      code: 'TPA_SITE_INSPECTION',
      name: 'Site inspection',
      type: 'REVIEW',
      sequence: 55,
      ownerRoleKeys: ['TPA'],
      entryStatus: 'SITE_INSPECTION_SCHEDULED',
      workingStatus: 'SITE_INSPECTION_IN_PROGRESS',
      slaDays: 5,
      escalateToRoleKey: 'PLANNING_OFFICER',
      description:
        'The site visit: 27 questions, geo-tagged photographs, a recommendation and a signature.',
    },
    {
      code: 'PLANNING_OFFICER_REVIEW',
      name: 'Planning Officer',
      type: 'REVIEW',
      sequence: 60,
      ownerRoleKeys: ['PLANNING_OFFICER'],
      entryStatus: 'PENDING_PLANNING_OFFICER',
      workingStatus: 'PLANNING_OFFICER_REVIEW',
      slaDays: 5,
      escalateToRoleKey: 'ZDD',
      description: "Endorses the TPA's recommendation, or returns the file to the TPA.",
    },
    {
      code: 'ZDD_REVIEW',
      name: 'Zonal Deputy Director',
      type: 'REVIEW',
      sequence: 70,
      // One role, one desk. In BP_STANDARD this desk is shared with the ZAD;
      // here it is the ZDD's own, which is what the ZDD manual describes.
      ownerRoleKeys: ['ZDD'],
      entryStatus: 'PENDING_ZDD',
      workingStatus: 'ZDD_REVIEW',
      slaDays: 7,
      escalateToRoleKey: 'ZJD',
      description:
        'Senior zonal review: title, earlier recommendations, inspection, fees. May report a shortfall and still forward.',
    },
    {
      code: 'ZJD_REVIEW',
      name: 'Zonal Joint Director',
      type: 'APPROVAL',
      sequence: 80,
      ownerRoleKeys: ['ZJD'],
      entryStatus: 'PENDING_ZJD',
      workingStatus: 'ZJD_REVIEW',
      slaDays: 7,
      // The apex desk has nobody above it in this chain, so its clock is
      // reported to the Commissioner — outside the chain, and able to ask.
      escalateToRoleKey: 'COMMISSIONER',
      description:
        'The apex authority in this workflow. The only desk here that may approve or reject.',
    },

    {
      code: 'LTP_SHORTFALL_ACTION',
      name: 'With the applicant',
      type: 'LTP_ACTION',
      sequence: 110,
      ownerRoleKeys: ['LTP'],
      // Set by whichever transition parked the file. This is only the fallback.
      entryStatus: 'RETURNED_TO_APPLICANT',
      allowReassign: false,
      description: 'A blocking shortfall has parked the file. The applicant must answer.',
    },

    {
      code: 'CLOSED_APPROVED',
      name: 'Approved',
      type: 'TERMINAL',
      sequence: 900,
      // Terminal, so no task ever arrives here. The owners are who may take a
      // POST-APPROVAL proceeding on the file — show cause and revocation —
      // and every transition below names its own subset of them.
      ownerRoleKeys: ['ZJD', 'COMMISSIONER'],
      entryStatus: 'APPROVED',
      isTerminal: true,
      description: 'Permission granted. The building permit order is issued. Show cause and revocation may follow.',
    },
    {
      code: 'CLOSED_REJECTED',
      name: 'Rejected',
      type: 'TERMINAL',
      sequence: 910,
      ownerRoleKeys: [],
      entryStatus: 'REJECTED',
      isTerminal: true,
      description: 'Permission refused.',
    },
    {
      code: 'CLOSED_REVOKED',
      name: 'Proceeding revoked',
      type: 'TERMINAL',
      sequence: 920,
      ownerRoleKeys: [],
      entryStatus: 'PROCEEDING_REVOKED',
      isTerminal: true,
      description:
        'A granted permission revoked by a decided revocation proceeding. The approval before it stays on the record.',
    },
  ],

  pipeline: ['TPA_REVIEW', 'PLANNING_OFFICER_REVIEW', 'ZDD_REVIEW', 'ZJD_REVIEW'],

  parkedStatus: {
    TPA_SITE_INSPECTION: {
      TECHNICAL: 'TPA_TECHNICAL_SHORTFALL',
    },
    TPA_REVIEW: {
      DOCUMENT: 'TPA_DOCUMENT_SHORTFALL',
      FEE: 'TPA_FEE_SHORTFALL',
      TECHNICAL: 'TPA_TECHNICAL_SHORTFALL',
      CLARIFICATION: 'RETURNED_TO_APPLICANT',
    },
    PLANNING_OFFICER_REVIEW: {
      DOCUMENT: 'PLANNING_OFFICER_SHORTFALL',
      TECHNICAL: 'PLANNING_OFFICER_SHORTFALL',
      CLARIFICATION: 'PLANNING_OFFICER_SHORTFALL',
    },
    ZDD_REVIEW: {
      DOCUMENT: 'ZDD_SHORTFALL',
      FEE: 'ZDD_SHORTFALL',
      TECHNICAL: 'ZDD_SHORTFALL',
      CLARIFICATION: 'ZDD_SHORTFALL',
    },
    ZJD_REVIEW: {
      DOCUMENT: 'ZJD_SHORTFALL',
      FEE: 'ZJD_FEE_SHORTFALL',
      TECHNICAL: 'ZJD_SHORTFALL',
    },
  },

  transitions: (h) => [
    // ── The gate: only a confirmed payment carries a file to a desk ──────
    {
      from: 'LTP_PAYMENT',
      action: 'CONFIRM_PAYMENT',
      fromStatus: null,
      to: 'TPA_REVIEW',
      toStatus: 'PENDING_TPA',
      guards: ['fees_paid'],
      notify: 'APPLICATION_FORWARDED',
      sla: 'START',
    },

    // ── TPA: scrutiny, inspection, shortfalls ────────────────────────────
    h.forward('TPA_REVIEW'),
    h.park('TPA_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('TPA_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.park('TPA_REVIEW', 'TECHNICAL', 'RAISE_TECHNICAL_SHORTFALL'),
    // The first desk has no previous DESK, so its "return" is to the applicant.
    // Modelled as a clarification rather than as a special case, so the file is
    // parked, the applicant is told what is wanted, and the same RESUBMIT path
    // brings it back.
    h.park('TPA_REVIEW', 'CLARIFICATION', 'RETURN_TO_PREVIOUS'),
    ...h.shortfallVerdict('TPA_REVIEW'),
    h.closeReported('TPA_REVIEW'),

    // ── Site inspection (TPA manual §5.8) ────────────────────────────────
    //
    // Every row here is performed by the site inspection service, in the same
    // transaction as the inspection write it links. The guards are what stop
    // a bare POST to the action endpoint moving a file for an inspection that
    // was never booked or signed.
    //
    // NOT a gate on FORWARD: a TPA can still forward a file from TPA_REVIEW
    // without a visit, as before this module existed. Whether the manual makes
    // the visit mandatory for every file is not stated in the supplied text,
    // and a guard that silently made it so would strand every file already in
    // flight at that desk.
    {
      from: 'TPA_REVIEW',
      action: 'SCHEDULE_SITE_INSPECTION',
      fromStatus: null,
      to: 'TPA_SITE_INSPECTION',
      toStatus: 'SITE_INSPECTION_SCHEDULED',
      guards: ['site_inspection_scheduled'],
      effects: [{ type: 'LINK_SITE_INSPECTION', step: 'SCHEDULE' }],
      // INSPECTION_DUE is emitted by the service, which knows the inspector
      // and the date; the engine's TASK_ASSIGNED covers the queue.
      notify: '',
      sla: 'START',
    },
    {
      // A re-inspection, after the applicant has answered a shortfall the
      // first report raised and the TPA has accepted the answer. Same desk:
      // the inspector keeps the file and the clock they already have.
      from: 'TPA_SITE_INSPECTION',
      action: 'SCHEDULE_SITE_INSPECTION',
      fromStatus: null,
      to: 'TPA_SITE_INSPECTION',
      toStatus: 'SITE_INSPECTION_SCHEDULED',
      guards: ['site_inspection_scheduled'],
      effects: [{ type: 'LINK_SITE_INSPECTION', step: 'SCHEDULE' }],
      notify: '',
      sla: 'NONE',
    },
    {
      // Recommended for Approval, or Reject. The TPA decides neither: the
      // recommendation travels with the file to the Planning Officer.
      from: 'TPA_SITE_INSPECTION',
      action: 'SUBMIT_SITE_INSPECTION',
      fromStatus: null,
      to: 'PLANNING_OFFICER_REVIEW',
      toStatus: h.entryStatus('PLANNING_OFFICER_REVIEW'),
      guards: ['site_inspection_signed', 'has_remarks'],
      effects: [{ type: 'LINK_SITE_INSPECTION', step: 'SUBMIT' }],
      notify: 'APPLICATION_FORWARDED',
      sla: 'START',
    },
    (() => {
      // Shortfall: park the file with the applicant. RAISE_SHORTFALL runs
      // FIRST so the link can record which shortfall the report raised, and
      // the file resumes at this desk when the applicant answers.
      const parked = h.park('TPA_SITE_INSPECTION', 'TECHNICAL', 'RAISE_INSPECTION_SHORTFALL', [
        { type: 'LINK_SITE_INSPECTION', step: 'SUBMIT' },
      ]);
      return { ...parked, guards: ['site_inspection_signed', ...(parked.guards ?? [])] };
    })(),
    ...h.shortfallVerdict('TPA_SITE_INSPECTION'),

    // ── Planning Officer: endorse, return, or raise ──────────────────────
    h.forward('PLANNING_OFFICER_REVIEW'),
    h.park('PLANNING_OFFICER_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('PLANNING_OFFICER_REVIEW', 'TECHNICAL', 'RAISE_TECHNICAL_SHORTFALL'),
    h.park('PLANNING_OFFICER_REVIEW', 'CLARIFICATION', 'RAISE_CLARIFICATION'),
    h.returnBack('PLANNING_OFFICER_REVIEW'),
    ...h.shortfallVerdict('PLANNING_OFFICER_REVIEW'),
    h.closeReported('PLANNING_OFFICER_REVIEW'),

    // ── ZDD: senior zonal review ─────────────────────────────────────────
    h.forward('ZDD_REVIEW'),
    h.park('ZDD_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('ZDD_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.park('ZDD_REVIEW', 'CLARIFICATION', 'RAISE_CLARIFICATION'),
    // The ZDD manual has this desk forward files that still carry an item for
    // the applicant to settle. A REPORTED shortfall travels with the file and
    // still blocks approval absolutely.
    h.report('ZDD_REVIEW', 'DOCUMENT', 'REPORT_SHORTFALL_AND_FORWARD'),
    h.returnBack('ZDD_REVIEW'),
    ...h.shortfallVerdict('ZDD_REVIEW'),
    h.closeReported('ZDD_REVIEW'),

    // ── ZJD: the apex desk ───────────────────────────────────────────────
    {
      from: 'ZJD_REVIEW',
      action: 'APPROVE',
      to: 'CLOSED_APPROVED',
      toStatus: 'APPROVED',
      // THE approval guard. `no_open_shortfalls` counts every open shortfall of
      // every kind and every mode, with no override anywhere in the system. A
      // reported shortfall that travelled here blocks approval exactly as a
      // blocking one would — brief §BH.3.
      // `no_open_show_cause`: a notice the desk has not yet decided is a
      // question the department asked and has not answered. Procedural only —
      // it says nothing about what the answer should be.
      guards: ['no_open_shortfalls', 'no_open_show_cause', 'fees_paid', 'has_remarks'],
      effects: [
        { type: 'GENERATE_APPROVAL_ORDER' },
        { type: 'CLOSE_WORKFLOW', status: 'COMPLETED', outcome: 'APPROVED' },
      ],
      notify: 'APPLICATION_APPROVED',
      sla: 'STOP',
    },
    {
      from: 'ZJD_REVIEW',
      action: 'REJECT',
      to: 'CLOSED_REJECTED',
      toStatus: 'REJECTED',
      // As for APPROVE: an undecided notice is decided first (it may be
      // decided "Rejected" and the file then rejected). Otherwise the notice
      // would be stranded on a closed file with no desk to decide it.
      guards: ['no_open_show_cause', 'has_remarks'],
      effects: [{ type: 'CLOSE_WORKFLOW', status: 'COMPLETED', outcome: 'REJECTED' }],
      notify: 'APPLICATION_REJECTED',
      sla: 'STOP',
    },
    h.park('ZJD_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('ZJD_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.returnBack('ZJD_REVIEW'),
    ...h.shortfallVerdict('ZJD_REVIEW'),
    h.closeReported('ZJD_REVIEW'),

    // ── Show cause (Phase 7) — an optional branch; see showCauseDesk ─────
    ...showCauseDesk('ZDD_REVIEW'),
    ...showCauseDesk('ZJD_REVIEW'),
    // Post-proceeding: the desk that granted the permission.
    ...showCauseDesk('CLOSED_APPROVED', ['ZJD']),
    ...[
      'TPA_REVIEW',
      'TPA_SITE_INSPECTION',
      'PLANNING_OFFICER_REVIEW',
      'ZDD_REVIEW',
      'ZJD_REVIEW',
      'LTP_SHORTFALL_ACTION',
      'CLOSED_APPROVED',
    ].map(showCauseResponse),

    // ── Revocation (Phase 7) ─────────────────────────────────────────────
    //
    // Proposed by the desk that granted the permission, decided by the
    // Commissioner. Until REVOKE_PROCEEDING the file stays APPROVED — a
    // proposal to revoke is not a revocation.
    {
      from: 'CLOSED_APPROVED',
      action: 'INITIATE_REVOCATION',
      fromStatus: 'APPROVED',
      to: 'CLOSED_APPROVED',
      toStatus: 'APPROVED',
      allowedRoleKeys: ['ZJD'],
      guards: ['no_open_revocation', 'has_remarks'],
      effects: [{ type: 'REVOCATION', step: 'PROPOSE' }],
      notify: '',
      sla: 'NONE',
    },
    {
      from: 'CLOSED_APPROVED',
      action: 'TAKE_UP_REVOCATION',
      fromStatus: 'APPROVED',
      to: 'CLOSED_APPROVED',
      toStatus: 'APPROVED',
      allowedRoleKeys: ['COMMISSIONER'],
      guards: ['revocation_proposed'],
      effects: [{ type: 'REVOCATION', step: 'REVIEW' }],
      notify: '',
      sla: 'NONE',
    },
    {
      from: 'CLOSED_APPROVED',
      action: 'REVOKE_PROCEEDING',
      fromStatus: 'APPROVED',
      to: 'CLOSED_REVOKED',
      toStatus: 'PROCEEDING_REVOKED',
      allowedRoleKeys: ['COMMISSIONER'],
      guards: ['revocation_under_review', 'has_remarks'],
      effects: [
        { type: 'REVOCATION', step: 'DECIDE', outcome: 'REVOKED' },
        { type: 'CLOSE_WORKFLOW', status: 'COMPLETED', outcome: 'PROCEEDING_REVOKED' },
      ],
      notify: '',
      sla: 'NONE',
    },
    {
      from: 'CLOSED_APPROVED',
      action: 'REJECT_REVOCATION',
      fromStatus: 'APPROVED',
      to: 'CLOSED_APPROVED',
      toStatus: 'APPROVED',
      allowedRoleKeys: ['COMMISSIONER'],
      guards: ['revocation_under_review', 'has_remarks'],
      effects: [{ type: 'REVOCATION', step: 'DECIDE', outcome: 'REJECTED' }],
      notify: '',
      sla: 'NONE',
    },

    // ── Change of technical professional (Phase 8) — see professionalChange ─
    ...PROFESSIONAL_CHANGE_STAGES.flatMap(professionalChange),

    // ── Commencement of work (Phase 9) ───────────────────────────────────
    //
    //   Approved → Proceeding issued → Work initiated
    //
    // Only out of CLOSED_APPROVED with the file APPROVED: there is no row at
    // any earlier stage, so no file can be marked started before it is
    // granted, and none at CLOSED_REVOKED. `proceeding_issued` requires the
    // building permission order itself to be ISSUED and unrevoked — approval
    // alone is not enough. Not a movement of the file (KEEP_STATUS), so show
    // cause and revocation carry on as before. SYSTEM-kind: the commencement
    // service raises it for the file's technical professional. The engine
    // emits WORK_INITIATED to the professional and the applicant.
    {
      from: 'CLOSED_APPROVED',
      action: 'NOTIFY_WORK_COMMENCEMENT',
      fromStatus: 'APPROVED',
      to: 'CLOSED_APPROVED',
      toStatus: '',
      guards: ['proceeding_issued', 'no_work_commencement'],
      effects: [...keep, { type: 'WORK_COMMENCEMENT' }],
      notify: 'WORK_INITIATED',
      sla: 'NONE',
    },

    // ── Occupancy (Phase 10) — see occupancy ─────────────────────────────
    ...occupancy,

    // ── The applicant's answer ───────────────────────────────────────────
    //
    // One row covers every parked status, because the destination is not in the
    // configuration at all: RETURN_TO_ORIGIN reads `parkedStageId`.
    {
      from: 'LTP_SHORTFALL_ACTION',
      action: 'RESUBMIT',
      fromStatus: null,
      to: null,
      toStatus: 'SHORTFALL_RESPONDED',
      allowedRoleKeys: ['LTP'],
      guards: ['has_remarks'],
      effects: [{ type: 'RECORD_RESOLUTION' }, { type: 'RETURN_TO_ORIGIN' }],
      notify: '',
      // The desk's clock picks up where it left off, with the days it had left.
      sla: 'RESUME',
    },
  ],

  assignments: [
    {
      stage: 'TPA_REVIEW',
      roleKey: 'TPA',
      strategy: 'ROLE_QUEUE',
      priority: 0,
      notes: 'Shared TPA inbox. An officer claims a file from it.',
    },
    {
      stage: 'TPA_SITE_INSPECTION',
      roleKey: 'TPA',
      strategy: 'ROLE_QUEUE',
      priority: 0,
      notes: 'Addressed to the TPA desk; the scheduling service hands it to the named inspector.',
    },
    {
      stage: 'PLANNING_OFFICER_REVIEW',
      roleKey: 'PLANNING_OFFICER',
      strategy: 'ROLE_QUEUE',
      priority: 5,
      notes: 'Shared Planning Officer inbox.',
    },
    {
      stage: 'ZDD_REVIEW',
      roleKey: 'ZDD',
      strategy: 'ROLE_QUEUE',
      priority: 10,
      notes: 'Senior zonal desk — sorts above Planning Officer work.',
    },
    {
      stage: 'ZJD_REVIEW',
      roleKey: 'ZJD',
      strategy: 'ROLE_QUEUE',
      priority: 20,
      notes: 'Approval decisions sort to the top.',
    },
    {
      stage: 'LTP_SHORTFALL_ACTION',
      roleKey: 'LTP',
      strategy: 'ROLE_QUEUE',
      priority: 0,
      notes: 'Addressed to the applicant who filed it.',
    },
  ],
};
