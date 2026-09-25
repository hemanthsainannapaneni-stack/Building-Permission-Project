/**
 * Shared vocabulary. Isomorphic — importable from server and client alike.
 *
 * These keys are the contract between the seed, the RBAC matrix, the route
 * guards and the UI. They are typed as literal unions so a typo is a compile
 * error rather than a silent permission failure.
 */

// ── Roles ────────────────────────────────────────────────────────────────

export const ROLES = {
  LTP: 'LTP',
  TPA: 'TPA',
  /**
   * The BBAS technical endorsement desk, between the TPA and the ZDD.
   *
   * Added for the BBAS_STANDARD workflow. It has no counterpart in the legacy
   * BP_STANDARD chain, which is why it is a new role rather than a rename of
   * one: renaming ZAD would have silently changed what every historical
   * workflow_history row means.
   */
  PLANNING_OFFICER: 'PLANNING_OFFICER',
  ZAD: 'ZAD',
  ZDD: 'ZDD',
  ZJD: 'ZJD',
  DIRECTOR_DP: 'DIRECTOR_DP',
  ADDL_COMMISSIONER: 'ADDL_COMMISSIONER',
  COMMISSIONER: 'COMMISSIONER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  VIEWER: 'VIEWER',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/** Departmental review roles, in escalation order. */
export const REVIEW_ROLES: RoleKey[] = [
  ROLES.TPA,
  ROLES.PLANNING_OFFICER,
  ROLES.ZAD,
  ROLES.ZDD,
  ROLES.ZJD,
  ROLES.DIRECTOR_DP,
  ROLES.ADDL_COMMISSIONER,
  ROLES.COMMISSIONER,
];

/** Roles whose remit is city-wide rather than zonal. */
export const CITYWIDE_ROLES: RoleKey[] = [
  ROLES.DIRECTOR_DP,
  ROLES.ADDL_COMMISSIONER,
  ROLES.COMMISSIONER,
  ROLES.FINANCE_OFFICER,
  ROLES.SYSTEM_ADMIN,
  ROLES.VIEWER,
];

// ── Capabilities ─────────────────────────────────────────────────────────
//
// `SCRUTINY_OVERRIDE` is deliberately absent: the business has not
// authorised officers to override a failed scrutiny result, and the only route
// past a failure is correct → new version → re-scrutiny.
// See docs/04-rbac.md H.3.1.

export const CAPABILITIES = {
  // Applications
  APPLICATION_CREATE: 'APPLICATION_CREATE',
  APPLICATION_VIEW: 'APPLICATION_VIEW',
  APPLICATION_VIEW_ALL: 'APPLICATION_VIEW_ALL',
  APPLICATION_EDIT: 'APPLICATION_EDIT',
  APPLICATION_DELETE: 'APPLICATION_DELETE',
  APPLICATION_WITHDRAW: 'APPLICATION_WITHDRAW',

  // Drawings
  DRAWING_UPLOAD: 'DRAWING_UPLOAD',
  DRAWING_VIEW: 'DRAWING_VIEW',
  DRAWING_DOWNLOAD: 'DRAWING_DOWNLOAD',

  // Scrutiny
  SCRUTINY_REQUEST: 'SCRUTINY_REQUEST',
  SCRUTINY_VIEW: 'SCRUTINY_VIEW',

  // Documents
  DOCUMENT_UPLOAD: 'DOCUMENT_UPLOAD',
  DOCUMENT_VIEW: 'DOCUMENT_VIEW',
  DOCUMENT_DOWNLOAD: 'DOCUMENT_DOWNLOAD',
  DOCUMENT_VERIFY: 'DOCUMENT_VERIFY',

  // Fees
  FEE_VIEW: 'FEE_VIEW',
  FEE_GENERATE: 'FEE_GENERATE',
  FEE_WAIVE: 'FEE_WAIVE',
  FEE_STRUCTURE_MANAGE: 'FEE_STRUCTURE_MANAGE',

  // Payments
  PAYMENT_INITIATE: 'PAYMENT_INITIATE',
  PAYMENT_VIEW: 'PAYMENT_VIEW',
  PAYMENT_RECONCILE: 'PAYMENT_RECONCILE',
  PAYMENT_REFUND: 'PAYMENT_REFUND',

  // Workflow
  WORKFLOW_VIEW: 'WORKFLOW_VIEW',
  WORKFLOW_CLAIM_TASK: 'WORKFLOW_CLAIM_TASK',
  WORKFLOW_FORWARD: 'WORKFLOW_FORWARD',
  WORKFLOW_RETURN: 'WORKFLOW_RETURN',
  WORKFLOW_REASSIGN: 'WORKFLOW_REASSIGN',
  WORKFLOW_MANAGE: 'WORKFLOW_MANAGE',

  // Checklists
  //
  // Three grants and not one, because three different people do three
  // different things to a checklist. The LTP ANSWERS it, a departmental desk
  // VERIFIES those answers, and an auditor reads both and touches neither.
  // Folding review into SHORTFALL_CREATE — the nearest existing grant — would
  // have given the Finance Officer a verification power nobody meant them to
  // have, because they hold it for money reasons.
  CHECKLIST_VIEW: 'CHECKLIST_VIEW',
  CHECKLIST_RESPOND: 'CHECKLIST_RESPOND',
  CHECKLIST_REVIEW: 'CHECKLIST_REVIEW',

  // Site inspection
  //
  // Three grants, split the way the checklist's are: reading a report,
  // booking a visit, and going to the site and signing what was found are
  // three different acts. Every desk reads the report the TPA signed; only the
  // TPA desk books and conducts one. SITE_INSPECTION_CONDUCT is also what the
  // two submitting workflow actions carry, so the engine and the service ask
  // the same question.
  SITE_INSPECTION_VIEW: 'SITE_INSPECTION_VIEW',
  SITE_INSPECTION_SCHEDULE: 'SITE_INSPECTION_SCHEDULE',
  SITE_INSPECTION_CONDUCT: 'SITE_INSPECTION_CONDUCT',

  // NOCs
  //
  // Split the same way again. Everyone on the file reads the NOCs; the
  // APPLICANT records what they filed with the authority and what came back
  // (NOC_UPDATE); the reviewing DESK verifies, rejects, raises a shortfall or
  // rules one out (NOC_VERIFY). An applicant verifying their own certificate
  // is the thing the split exists to prevent.
  NOC_VIEW: 'NOC_VIEW',
  NOC_UPDATE: 'NOC_UPDATE',
  NOC_VERIFY: 'NOC_VERIFY',

  // Show cause, revocation, outward (Phase 7)
  //
  // Split by ACT, like the NOC grants. Issuing and deciding a show cause are
  // also gated by the workflow — the transition must exist at the file's
  // current stage for one of the caller's roles — so the grant is necessary
  // and never sufficient. SHOW_CAUSE_RESPOND is the applicant's; an officer
  // answering a notice on the applicant's behalf is what the split prevents.
  // Deciding a revocation carries the existing ORDER_REVOKE.
  SHOW_CAUSE_VIEW: 'SHOW_CAUSE_VIEW',
  SHOW_CAUSE_ISSUE: 'SHOW_CAUSE_ISSUE',
  SHOW_CAUSE_RESPOND: 'SHOW_CAUSE_RESPOND',
  SHOW_CAUSE_DECIDE: 'SHOW_CAUSE_DECIDE',
  REVOCATION_VIEW: 'REVOCATION_VIEW',
  REVOCATION_INITIATE: 'REVOCATION_INITIATE',
  OUTWARD_VIEW: 'OUTWARD_VIEW',
  OUTWARD_MANAGE: 'OUTWARD_MANAGE',

  // Change of LTP (Phase 8)
  //
  // One grant per step, like the show cause grants. Each step is a workflow
  // transition on the file; because a change request travels desk to desk
  // independently of where the FILE is, the step's desk is whoever holds its
  // capability — see src/lib/professional-change.ts. Viewing is shared.
  LTP_CHANGE_VIEW: 'LTP_CHANGE_VIEW',
  LTP_CHANGE_REQUEST: 'LTP_CHANGE_REQUEST',
  LTP_CHANGE_VERIFY: 'LTP_CHANGE_VERIFY',
  LTP_CHANGE_REVIEW: 'LTP_CHANGE_REVIEW',
  LTP_CHANGE_DECIDE: 'LTP_CHANGE_DECIDE',

  // Commencement of work (Phase 9)
  //
  // Everyone on the file reads the Work Initiated register. Giving the notice
  // is the applicant's act — the owner, through the file's technical
  // professional — never a desk's: the department records that work started,
  // it does not start it. See src/lib/commencement.ts.
  COMMENCEMENT_VIEW: 'COMMENCEMENT_VIEW',
  COMMENCEMENT_NOTIFY: 'COMMENCEMENT_NOTIFY',

  // Occupancy (Phase 10)
  //
  // One grant per desk's part, like the change of professional: the applicant
  // SUBMITS (and answers a shortfall), the TPA INSPECTS (books and records the
  // final inspection), the ZDD REVIEWS (as-built review, recommendation or
  // shortfall), the ZJD DECIDES (approves or rejects, and issues the
  // certificate). Every step is also a workflow transition. See
  // src/lib/occupancy.ts.
  OCCUPANCY_VIEW: 'OCCUPANCY_VIEW',
  OCCUPANCY_SUBMIT: 'OCCUPANCY_SUBMIT',
  OCCUPANCY_INSPECT: 'OCCUPANCY_INSPECT',
  OCCUPANCY_REVIEW: 'OCCUPANCY_REVIEW',
  OCCUPANCY_DECIDE: 'OCCUPANCY_DECIDE',

  // Developer registration (Phase 11)
  //
  // A register of its own, belonging to no file. Split by act like the
  // occupancy grants: one desk REGISTERS (keys in the developer's application
  // received at the office, submits it, records the answer to a shortfall and
  // opens a renewal), one VERIFIES (takes it up, raises a shortfall, verifies
  // the documents), one DECIDES (approves or rejects). Everyone on the desks
  // reads it. See src/lib/developer-registration.ts.
  DEVELOPER_VIEW: 'DEVELOPER_VIEW',
  DEVELOPER_REGISTER: 'DEVELOPER_REGISTER',
  DEVELOPER_VERIFY: 'DEVELOPER_VERIFY',
  DEVELOPER_DECIDE: 'DEVELOPER_DECIDE',

  // LTP register (Phase 12)
  //
  // The register of architects, engineers, structural engineers, LTPs and any
  // other configured type. Split by act exactly as the developer register is:
  // one desk registers, one verifies (including each document), one decides.
  // Applications NAME an approved LTP; that needs no grant beyond
  // editing the application. See src/lib/professional-registration.ts.
  LTP_REG_VIEW: 'LTP_REG_VIEW',
  LTP_REG_REGISTER: 'LTP_REG_REGISTER',
  LTP_REG_VERIFY: 'LTP_REG_VERIFY',
  LTP_REG_DECIDE: 'LTP_REG_DECIDE',

  // Shortfalls
  SHORTFALL_CREATE: 'SHORTFALL_CREATE',
  SHORTFALL_VIEW: 'SHORTFALL_VIEW',
  SHORTFALL_RESPOND: 'SHORTFALL_RESPOND',
  SHORTFALL_RESOLVE: 'SHORTFALL_RESOLVE',

  // Approval
  APPLICATION_APPROVE: 'APPLICATION_APPROVE',
  APPLICATION_REJECT: 'APPLICATION_REJECT',
  ORDER_VIEW: 'ORDER_VIEW',
  ORDER_REVOKE: 'ORDER_REVOKE',

  // Administration
  USER_MANAGE: 'USER_MANAGE',
  ROLE_MANAGE: 'ROLE_MANAGE',
  ORG_MANAGE: 'ORG_MANAGE',
  MASTER_DATA_MANAGE: 'MASTER_DATA_MANAGE',
  SETTINGS_MANAGE: 'SETTINGS_MANAGE',
  NOTIFICATION_TEMPLATE_MANAGE: 'NOTIFICATION_TEMPLATE_MANAGE',
  INTEGRATION_MANAGE: 'INTEGRATION_MANAGE',

  // Oversight
  AUDIT_VIEW: 'AUDIT_VIEW',
  REPORT_VIEW: 'REPORT_VIEW',
  ANALYTICS_VIEW: 'ANALYTICS_VIEW',
  NOTIFICATION_LOG_VIEW: 'NOTIFICATION_LOG_VIEW',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

// ── Workflow vocabulary ──────────────────────────────────────────────────

export const STAGE_CODES = {
  LTP_DRAFT: 'LTP_DRAFT',
  LTP_DRAWING: 'LTP_DRAWING',
  LTP_DOCUMENTS: 'LTP_DOCUMENTS',
  LTP_PAYMENT: 'LTP_PAYMENT',
  TPA_REVIEW: 'TPA_REVIEW',
  /** BBAS_STANDARD: the TPA's site visit, between scrutiny and the Planning Officer. */
  TPA_SITE_INSPECTION: 'TPA_SITE_INSPECTION',
  // BBAS_STANDARD desks. ZDD_REVIEW is a desk of its own here; the combined
  // ZAD_ZDD_REVIEW below belongs to the legacy BP_STANDARD workflow and stays
  // exactly as it is, because live history rows name it.
  PLANNING_OFFICER_REVIEW: 'PLANNING_OFFICER_REVIEW',
  ZDD_REVIEW: 'ZDD_REVIEW',
  ZAD_ZDD_REVIEW: 'ZAD_ZDD_REVIEW',
  ZJD_REVIEW: 'ZJD_REVIEW',
  DIRECTOR_DP_REVIEW: 'DIRECTOR_DP_REVIEW',
  ADDL_COMMISSIONER_REVIEW: 'ADDL_COMMISSIONER_REVIEW',
  COMMISSIONER_REVIEW: 'COMMISSIONER_REVIEW',
  LTP_SHORTFALL_ACTION: 'LTP_SHORTFALL_ACTION',
  CLOSED_APPROVED: 'CLOSED_APPROVED',
  CLOSED_REJECTED: 'CLOSED_REJECTED',
  /** A granted permission, later revoked. Status PROCEEDING_REVOKED. */
  CLOSED_REVOKED: 'CLOSED_REVOKED',
} as const;

/**
 * Shortfall statuses that count as SETTLED.
 *
 * Everything else is open, and the rule is absolute: OPEN_SHORTFALLS > 0 →
 * APPROVAL BLOCKED, of every kind and every mode, with no override. See
 * docs/03-workflow.md F.5.1.
 *
 * Stated as the CLOSED set rather than the open one so that a status added
 * later is open until somebody deliberately says otherwise — the safe
 * direction for a rule whose failure mode is approving an application that
 * should not have been. The full lifecycle lives in `src/lib/shortfalls.ts`.
 */
export const CLOSED_SHORTFALL_STATUSES = ['RESOLVED', 'CANCELLED'] as const;

/** Application statuses from which nothing further happens. */
export const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'WITHDRAWN', 'LAPSED', 'PROCEEDING_REVOKED'] as const;

// ── Uploads ──────────────────────────────────────────────────────────────

/**
 * Extension allow-list. The upload pipeline additionally sniffs magic bytes
 * and requires them to agree — extension and declared MIME are both
 * attacker-controlled, the file's first bytes are not. See docs P.3.
 */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'dwg',
  'dxf',
  'zip',
] as const;

export const AUDIT_ACTIONS = {
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  SETTING_UPDATED: 'SETTING_UPDATED',
} as const;
