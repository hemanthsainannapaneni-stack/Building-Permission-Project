import type { WorkflowDefinition } from './builder';

/**
 * BP_STANDARD — the six-desk hierarchy BBAS shipped with.
 *
 * TPA → ZAD/ZDD → ZJD → Director (DP) → Additional Commissioner → Commissioner.
 *
 * NOT the demo default any more: BBAS_STANDARD is (see bbas-standard.ts). This
 * one stays published, seeded and selectable, unchanged, because
 *
 *   · every application that has already run through it names its stages in
 *     `workflow_history`, and those rows are append-only and quoted back to
 *     applicants;
 *   · a department whose statute really does require six desks must be able to
 *     choose it from configuration rather than from a deployment.
 *
 * The content below is exactly what `09-workflow.ts` held before the BBAS work;
 * only its shape changed, from one file that both described AND seeded a
 * workflow into a description the shared builder seeds.
 *
 * ── Where the engine's authority begins ──────────────────────────────────
 *
 * The stage list includes the applicant-side stages (LTP_DRAFT → LTP_PAYMENT)
 * because they are real places a file sits and the register labels them. But
 * the ENGINE takes over at the payment gate: `startWorkflow` creates the
 * instance at LTP_PAYMENT and immediately performs CONFIRM_PAYMENT, which is
 * seeded below as an ordinary transition. Everything before that is driven by
 * the filing services, and no transition rows are seeded for it —
 * configuration that nothing executes would be a lie about how the system
 * works.
 */

export const BP_STANDARD: WorkflowDefinition = {
  code: 'BP_STANDARD',
  version: 1,
  name: 'Extended hierarchy (six desks)',
  description:
    'TPA → ZAD/ZDD → ZJD → Director → Additional Commissioner → Commissioner. ' +
    'Retained as an optional configuration; BBAS_STANDARD is the default.',

  // SLA days are illustrative seed data, editable at runtime.
  stages: [
    {
      code: 'LTP_DRAFT',
      name: 'Filing',
      type: 'LTP_ACTION',
      sequence: 10,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DRAFT',
      description: 'The applicant is filling in the application. Driven by the filing wizard.',
    },
    {
      code: 'LTP_DRAWING',
      name: 'Drawing and scrutiny',
      type: 'LTP_ACTION',
      sequence: 20,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DRAWING_UPLOADED',
      workingStatus: 'SCRUTINY_IN_PROGRESS',
      description: 'The drawing is uploaded and checked. Driven by the scrutiny service.',
    },
    {
      code: 'LTP_DOCUMENTS',
      name: 'Documents',
      type: 'LTP_ACTION',
      sequence: 30,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'DOCUMENT_UPLOAD_PENDING',
      description: 'The checklist is being completed. Driven by the document service.',
    },
    {
      code: 'LTP_PAYMENT',
      name: 'Payment',
      type: 'LTP_ACTION',
      sequence: 40,
      ownerRoleKeys: ['LTP'],
      entryStatus: 'FEE_GENERATED',
      workingStatus: 'PAYMENT_PENDING',
      isEntry: true,
      description: 'The fee is payable. A confirmed payment carries the file to the department.',
    },

    {
      code: 'TPA_REVIEW',
      name: 'Town Planning Assistant',
      type: 'REVIEW',
      sequence: 50,
      ownerRoleKeys: ['TPA'],
      entryStatus: 'PENDING_TPA',
      workingStatus: 'TPA_REVIEW',
      slaDays: 5,
      description: 'First departmental desk. Technical scrutiny, document verification, shortfalls.',
    },
    {
      code: 'ZAD_ZDD_REVIEW',
      name: 'Zonal Assistant / Deputy Director',
      type: 'REVIEW',
      sequence: 60,
      // Two roles, one desk. A task addressed to either is visible to both,
      // because the QUEUE is scoped by the stage's owners rather than by the
      // task's own role — see taskScope() in src/server/auth/scope.ts.
      ownerRoleKeys: ['ZAD', 'ZDD'],
      entryStatus: 'PENDING_ZAD_ZDD',
      workingStatus: 'ZAD_ZDD_REVIEW',
      slaDays: 5,
      description: 'Zonal review.',
    },
    {
      code: 'ZJD_REVIEW',
      name: 'Zonal Joint Director',
      type: 'REVIEW',
      sequence: 70,
      ownerRoleKeys: ['ZJD'],
      entryStatus: 'PENDING_ZJD',
      workingStatus: 'ZJD_REVIEW',
      slaDays: 7,
      description: 'Zonal review. May report a fee shortfall and still forward.',
    },
    {
      code: 'DIRECTOR_DP_REVIEW',
      name: 'Director (Development Plan)',
      type: 'REVIEW',
      sequence: 80,
      ownerRoleKeys: ['DIRECTOR_DP'],
      entryStatus: 'PENDING_DIRECTOR_DP',
      workingStatus: 'DIRECTOR_REVIEW',
      slaDays: 7,
      description: 'City-wide review. May report a shortfall and still forward.',
    },
    {
      code: 'ADDL_COMMISSIONER_REVIEW',
      name: 'Additional Commissioner',
      type: 'REVIEW',
      sequence: 90,
      ownerRoleKeys: ['ADDL_COMMISSIONER'],
      entryStatus: 'PENDING_ADDITIONAL_COMMISSIONER',
      workingStatus: 'ADDITIONAL_COMMISSIONER_REVIEW',
      slaDays: 5,
      description: 'Penultimate review.',
    },
    {
      code: 'COMMISSIONER_REVIEW',
      name: 'Commissioner',
      type: 'APPROVAL',
      sequence: 100,
      ownerRoleKeys: ['COMMISSIONER'],
      entryStatus: 'PENDING_COMMISSIONER',
      workingStatus: 'COMMISSIONER_REVIEW',
      slaDays: 5,
      description: 'Final authority. The only desk in this chain that may approve or reject.',
    },

    {
      code: 'LTP_SHORTFALL_ACTION',
      name: 'With the applicant',
      type: 'LTP_ACTION',
      sequence: 110,
      ownerRoleKeys: ['LTP'],
      // Set by whichever transition parked the file — TPA_DOCUMENT_SHORTFALL,
      // ZJD_FEE_SHORTFALL, and so on. The value here is only the fallback.
      entryStatus: 'RETURNED_TO_APPLICANT',
      allowReassign: false,
      description: 'A blocking shortfall has parked the file. The applicant must answer.',
    },

    {
      code: 'CLOSED_APPROVED',
      name: 'Approved',
      type: 'TERMINAL',
      sequence: 900,
      ownerRoleKeys: [],
      entryStatus: 'APPROVED',
      isTerminal: true,
      description: 'Permission granted. The approval order is issued.',
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
  ],

  pipeline: [
    'TPA_REVIEW',
    'ZAD_ZDD_REVIEW',
    'ZJD_REVIEW',
    'DIRECTOR_DP_REVIEW',
    'ADDL_COMMISSIONER_REVIEW',
    'COMMISSIONER_REVIEW',
  ],

  parkedStatus: {
    TPA_REVIEW: {
      DOCUMENT: 'TPA_DOCUMENT_SHORTFALL',
      FEE: 'TPA_FEE_SHORTFALL',
      TECHNICAL: 'TPA_TECHNICAL_SHORTFALL',
      CLARIFICATION: 'RETURNED_TO_APPLICANT',
    },
    ZAD_ZDD_REVIEW: {
      DOCUMENT: 'ZAD_ZDD_SHORTFALL',
      CLARIFICATION: 'ZAD_ZDD_SHORTFALL',
    },
    ZJD_REVIEW: {
      DOCUMENT: 'ZJD_SHORTFALL',
      FEE: 'ZJD_FEE_SHORTFALL',
    },
    DIRECTOR_DP_REVIEW: {
      DOCUMENT: 'DIRECTOR_SHORTFALL',
      FEE: 'DIRECTOR_SHORTFALL',
      TECHNICAL: 'DIRECTOR_SHORTFALL',
    },
    ADDL_COMMISSIONER_REVIEW: {
      DOCUMENT: 'ADDITIONAL_COMMISSIONER_SHORTFALL',
    },
    COMMISSIONER_REVIEW: {
      DOCUMENT: 'COMMISSIONER_SHORTFALL',
    },
  },

  transitions: (h) => [
    // ── The gate: only a confirmed payment carries a file here ───────────
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

    // ── TPA ──────────────────────────────────────────────────────────────
    h.forward('TPA_REVIEW'),
    h.park('TPA_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('TPA_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.park('TPA_REVIEW', 'TECHNICAL', 'RAISE_TECHNICAL_SHORTFALL'),
    // The first desk has no previous DESK, so its "return" is to the applicant.
    h.park('TPA_REVIEW', 'CLARIFICATION', 'RETURN_TO_PREVIOUS'),
    ...h.shortfallVerdict('TPA_REVIEW'),
    h.closeReported('TPA_REVIEW'),

    // ── ZAD / ZDD ────────────────────────────────────────────────────────
    h.forward('ZAD_ZDD_REVIEW'),
    h.park('ZAD_ZDD_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('ZAD_ZDD_REVIEW', 'CLARIFICATION', 'RAISE_CLARIFICATION'),
    h.returnBack('ZAD_ZDD_REVIEW'),
    ...h.shortfallVerdict('ZAD_ZDD_REVIEW'),
    h.closeReported('ZAD_ZDD_REVIEW'),

    // ── ZJD — the desk that may report a FEE shortfall and forward ────────
    h.forward('ZJD_REVIEW'),
    h.park('ZJD_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('ZJD_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.report('ZJD_REVIEW', 'FEE', 'REPORT_FEE_SHORTFALL_AND_FORWARD', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.returnBack('ZJD_REVIEW'),
    ...h.shortfallVerdict('ZJD_REVIEW'),
    h.closeReported('ZJD_REVIEW'),

    // ── Director — may report ANY shortfall and forward ───────────────────
    h.forward('DIRECTOR_DP_REVIEW'),
    h.park('DIRECTOR_DP_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.park('DIRECTOR_DP_REVIEW', 'TECHNICAL', 'RAISE_TECHNICAL_SHORTFALL'),
    h.park('DIRECTOR_DP_REVIEW', 'FEE', 'RAISE_FEE_SHORTFALL', [
      { type: 'GENERATE_FEE_DEMAND', demandType: 'SHORTFALL' },
    ]),
    h.report(
      'DIRECTOR_DP_REVIEW',
      'DOCUMENT',
      'REPORT_SHORTFALL_AND_FORWARD',
      [],
      'DIRECTOR_REPORTED_SHORTFALL'
    ),
    h.returnBack('DIRECTOR_DP_REVIEW'),
    ...h.shortfallVerdict('DIRECTOR_DP_REVIEW'),
    h.closeReported('DIRECTOR_DP_REVIEW'),

    // ── Additional Commissioner ──────────────────────────────────────────
    h.forward('ADDL_COMMISSIONER_REVIEW'),
    h.park('ADDL_COMMISSIONER_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.report('ADDL_COMMISSIONER_REVIEW', 'DOCUMENT', 'REPORT_SHORTFALL_AND_FORWARD'),
    h.returnBack('ADDL_COMMISSIONER_REVIEW'),
    ...h.shortfallVerdict('ADDL_COMMISSIONER_REVIEW'),
    h.closeReported('ADDL_COMMISSIONER_REVIEW'),

    // ── Commissioner ─────────────────────────────────────────────────────
    {
      from: 'COMMISSIONER_REVIEW',
      action: 'APPROVE',
      to: 'CLOSED_APPROVED',
      toStatus: 'APPROVED',
      // THE approval guard. `no_open_shortfalls` counts every open shortfall of
      // every kind and every mode, with no override anywhere in the system. A
      // reported shortfall that travelled here with the file blocks approval
      // exactly as a blocking one would.
      guards: ['no_open_shortfalls', 'fees_paid', 'has_remarks'],
      effects: [
        { type: 'GENERATE_APPROVAL_ORDER' },
        { type: 'CLOSE_WORKFLOW', status: 'COMPLETED', outcome: 'APPROVED' },
      ],
      notify: 'APPLICATION_APPROVED',
      sla: 'STOP',
    },
    {
      from: 'COMMISSIONER_REVIEW',
      action: 'REJECT',
      to: 'CLOSED_REJECTED',
      toStatus: 'REJECTED',
      guards: ['has_remarks'],
      effects: [{ type: 'CLOSE_WORKFLOW', status: 'COMPLETED', outcome: 'REJECTED' }],
      notify: 'APPLICATION_REJECTED',
      sla: 'STOP',
    },
    h.park('COMMISSIONER_REVIEW', 'DOCUMENT', 'RAISE_DOCUMENT_SHORTFALL'),
    h.returnBack('COMMISSIONER_REVIEW'),
    ...h.shortfallVerdict('COMMISSIONER_REVIEW'),
    h.closeReported('COMMISSIONER_REVIEW'),

    // ── The applicant's answer ───────────────────────────────────────────
    //
    // One row covers every parked status, because the destination is not in the
    // configuration at all: RETURN_TO_ORIGIN reads `parkedStageId`. That is why
    // there is no table here mapping each shortfall status back to a desk.
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
    { stage: 'TPA_REVIEW', roleKey: 'TPA', strategy: 'ROLE_QUEUE', priority: 0, notes: 'Shared TPA inbox.' },
    { stage: 'ZAD_ZDD_REVIEW', roleKey: 'ZAD', strategy: 'ROLE_QUEUE', priority: 0, notes: 'ZAD and ZDD share this desk.' },
    { stage: 'ZJD_REVIEW', roleKey: 'ZJD', strategy: 'ROLE_QUEUE', priority: 5, notes: '' },
    { stage: 'DIRECTOR_DP_REVIEW', roleKey: 'DIRECTOR_DP', strategy: 'ROLE_QUEUE', priority: 10, notes: 'Senior desk — sorts above zonal work.' },
    { stage: 'ADDL_COMMISSIONER_REVIEW', roleKey: 'ADDL_COMMISSIONER', strategy: 'ROLE_QUEUE', priority: 15, notes: '' },
    { stage: 'COMMISSIONER_REVIEW', roleKey: 'COMMISSIONER', strategy: 'ROLE_QUEUE', priority: 20, notes: 'Approval decisions sort to the top.' },
    { stage: 'LTP_SHORTFALL_ACTION', roleKey: 'LTP', strategy: 'ROLE_QUEUE', priority: 0, notes: 'Addressed to the applicant who filed it.' },
  ],
};
