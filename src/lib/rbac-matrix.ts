import { CAPABILITIES as C, ROLES, type Capability, type RoleKey } from './constants';

/**
 * THE permission matrix — docs/04-rbac.md H.4, as code.
 *
 * One source of truth, read by three things: the seed that writes
 * `role_permissions`, the generated RBAC test suite, and the admin role
 * editor's "reset to default" action. A matrix that lives only in a document
 * becomes a document that lies; this one cannot drift from the database
 * without the seed test failing.
 *
 * Two grants deserve their absence explained:
 *
 *  · SYSTEM_ADMIN holds NO approval capability. An administrator configures
 *    the system; they do not decide applications. They *can* grant it to
 *    themselves through ROLE_MANAGE, but that act is audited and conspicuous,
 *    which is the intended deterrent.
 *
 *  · There is no SCRUTINY_OVERRIDE anywhere. The only route past a failed
 *    scrutiny is correct → new drawing version → re-scrutiny (D4).
 */

/** Read-only capabilities every departmental role shares. */
const OFFICER_BASE: Capability[] = [
  C.APPLICATION_VIEW,
  C.DRAWING_VIEW,
  C.DRAWING_DOWNLOAD,
  C.SCRUTINY_VIEW,
  C.DOCUMENT_VIEW,
  C.DOCUMENT_DOWNLOAD,
  C.DOCUMENT_VERIFY,
  C.FEE_VIEW,
  C.PAYMENT_VIEW,
  C.WORKFLOW_VIEW,
  C.WORKFLOW_CLAIM_TASK,
  C.WORKFLOW_FORWARD,
  C.WORKFLOW_RETURN,
  C.SHORTFALL_CREATE,
  C.SHORTFALL_VIEW,
  C.SHORTFALL_RESOLVE,
  // Every departmental desk verifies the checklist, from the TPA upward. The
  // BBAS manuals put the 19-point checklist in front of the TPA, the ZDD and
  // the JD alike, each recording their own view of the same questions — so
  // this belongs in the shared base and not on individual desks.
  C.CHECKLIST_VIEW,
  C.CHECKLIST_REVIEW,
  // Every desk above the TPA reads the inspection report — the ZDD manual has
  // the ZDD review "inspection" among the things a file carries up the chain.
  // Booking and conducting one are the TPA's alone, granted below.
  C.SITE_INSPECTION_VIEW,
  // Every desk reads the NOCs. Verifying them is granted per desk below — the
  // TPA, ZDD and ZJD, the desks the manuals put the NOCs in front of.
  C.NOC_VIEW,
  // Every desk reads the show cause and revocation registers. Issuing,
  // deciding and revoking are granted per desk below, and each is ALSO gated
  // by the workflow: the transition must exist at the file's stage for the
  // caller's role.
  C.SHOW_CAUSE_VIEW,
  C.REVOCATION_VIEW,
  // Every desk may SEE the Outward register — the notices and orders its own
  // decisions sent there. Keeping it (dispatch, delivery, acknowledgement) is
  // OUTWARD_MANAGE, granted below to the ZJD desk and the System
  // Administrator only. The BBAS manuals name no dispatch-clerk role, so none
  // is invented; when production needs one, it is a new role holding
  // OUTWARD_MANAGE and nothing in the Outward code changes.
  C.OUTWARD_VIEW,
  // Every desk reads the change of professional register. Each STEP is
  // granted to one desk below: TPA registers, Planning Officer verifies, ZDD
  // reviews, ZJD decides — the BBAS chain's own order.
  C.LTP_CHANGE_VIEW,
  // Every desk reads the Work Initiated register. None gives the notice.
  C.COMMENCEMENT_VIEW,
  // Every desk reads the occupancy register. Each step is granted to one desk
  // below: TPA inspects, ZDD reviews, ZJD decides and issues.
  C.OCCUPANCY_VIEW,
  // Every desk reads the developer register. TPA registers, Planning Officer
  // verifies, ZJD decides — granted below, the same chain as the change of
  // professional. Grants, not code: moving a step is a matrix edit.
  C.DEVELOPER_VIEW,
  // The professional register, on the same chain: TPA registers, Planning
  // Officer verifies, ZJD decides — granted below.
  C.LTP_REG_VIEW,
  C.ORDER_VIEW,
  C.AUDIT_VIEW,
  C.REPORT_VIEW,
];

/** Everything a reader may see. No write capability appears here. */
const READ_ONLY: Capability[] = [
  C.APPLICATION_VIEW,
  C.APPLICATION_VIEW_ALL,
  C.DRAWING_VIEW,
  C.DRAWING_DOWNLOAD,
  C.SCRUTINY_VIEW,
  C.DOCUMENT_VIEW,
  C.DOCUMENT_DOWNLOAD,
  C.FEE_VIEW,
  C.PAYMENT_VIEW,
  C.WORKFLOW_VIEW,
  C.SHORTFALL_VIEW,
  C.CHECKLIST_VIEW,
  C.SITE_INSPECTION_VIEW,
  C.NOC_VIEW,
  C.SHOW_CAUSE_VIEW,
  C.REVOCATION_VIEW,
  C.OUTWARD_VIEW,
  C.LTP_CHANGE_VIEW,
  C.COMMENCEMENT_VIEW,
  C.OCCUPANCY_VIEW,
  C.DEVELOPER_VIEW,
  C.LTP_REG_VIEW,
  C.ORDER_VIEW,
  C.AUDIT_VIEW,
  C.REPORT_VIEW,
  C.ANALYTICS_VIEW,
];

export const RBAC_MATRIX: Record<RoleKey, Capability[]> = {
  // ── Licensed Technical Person: files and answers ──────────────────────
  [ROLES.LTP]: [
    C.APPLICATION_CREATE,
    C.APPLICATION_VIEW,
    C.APPLICATION_EDIT,
    C.APPLICATION_DELETE,
    C.APPLICATION_WITHDRAW,
    C.DRAWING_UPLOAD,
    C.DRAWING_VIEW,
    C.DRAWING_DOWNLOAD,
    C.SCRUTINY_REQUEST,
    C.SCRUTINY_VIEW,
    C.DOCUMENT_UPLOAD,
    C.DOCUMENT_VIEW,
    C.DOCUMENT_DOWNLOAD,
    C.FEE_VIEW,
    C.PAYMENT_INITIATE,
    C.PAYMENT_VIEW,
    C.WORKFLOW_VIEW,
    C.SHORTFALL_VIEW,
    C.SHORTFALL_RESPOND,
    // Answers the 19-point checklist and fills in the Others block. The LTP
    // never holds CHECKLIST_REVIEW: an applicant verifying their own answers
    // is the one thing this separation exists to prevent.
    C.CHECKLIST_VIEW,
    C.CHECKLIST_RESPOND,
    // Records the NOC applied for and the certificate received. Never
    // NOC_VERIFY, for the reason CHECKLIST_REVIEW is withheld above.
    C.NOC_VIEW,
    C.NOC_UPDATE,
    // Reads and answers a show cause notice on their own file, and sees any
    // revocation proceeding against it. Never decides either.
    C.SHOW_CAUSE_VIEW,
    C.SHOW_CAUSE_RESPOND,
    C.REVOCATION_VIEW,
    // Sees change of professional requests on files it holds. Never takes a
    // step: the owner asks and the department decides.
    C.LTP_CHANGE_VIEW,
    // Notifies the commencement of work on an approved file whose order is
    // issued — on the owner's behalf, as it files and answers on their behalf.
    C.COMMENCEMENT_VIEW,
    C.COMMENCEMENT_NOTIFY,
    // Intimates completion and applies for occupancy on the owner's behalf,
    // and answers an occupancy shortfall. Never inspects or decides.
    C.OCCUPANCY_VIEW,
    C.OCCUPANCY_SUBMIT,
    C.ORDER_VIEW,
    C.AUDIT_VIEW,
  ],

  // ── Town Planning Assistant: first departmental desk ──────────────────
  [ROLES.TPA]: [
    ...OFFICER_BASE,
    // Re-runs scrutiny on a corrected drawing, and raises fee shortfalls,
    // which issues a demand.
    C.SCRUTINY_REQUEST,
    C.FEE_GENERATE,
    // The site visit is the TPA's (TPA manual §5.8): book it, go, answer the
    // 27 questions, photograph the site, recommend and sign.
    C.SITE_INSPECTION_SCHEDULE,
    C.SITE_INSPECTION_CONDUCT,
    // Verifies NOCs while the file is at the TPA desk. The service also asks
    // that the file be AT a desk this role owns — holding the grant is not
    // enough on its own.
    C.NOC_VERIFY,
    // Registers the owner's request to change the technical professional —
    // the first desk, where the owner's letter arrives.
    C.LTP_CHANGE_REQUEST,
    // Books and records the final inspection, as it does the pre-approval
    // site inspection.
    C.OCCUPANCY_INSPECT,
    // Keys in a developer's registration application received at the office,
    // submits it, records the answer to a shortfall and opens a renewal — the
    // inward desk, as for the owner's change of professional letter.
    C.DEVELOPER_REGISTER,
    // Keys in a professional's registration application, as for developers.
    C.LTP_REG_REGISTER,
  ],

  // ── Zonal Assistant / Deputy Director ─────────────────────────────────
  // Identical grants: the requirement treats them as one review step.
  // Whether they are alternates by zone or two desks is Q4.
  // ── Planning Officer: technical endorsement, BBAS_STANDARD ────────────
  //
  // The same remit as a zonal reviewer and no more. It may not reassign other
  // officers' work and it may not decide an application — endorsement is what
  // this desk does, and the decision belongs upward.
  //
  // Verifies the documents on a change of professional request — the same
  // technical checking this desk does on the file itself.
  //
  // Verifies a developer's registration documents on the same footing.
  [ROLES.PLANNING_OFFICER]: [...OFFICER_BASE, C.ANALYTICS_VIEW, C.LTP_CHANGE_VERIFY, C.DEVELOPER_VERIFY, C.LTP_REG_VERIFY],

  // NOC_VERIFY for ZAD as well as ZDD: the legacy chain's ZAD_ZDD_REVIEW desk
  // is shared, and the two are granted identically by design.
  [ROLES.ZAD]: [...OFFICER_BASE, C.WORKFLOW_REASSIGN, C.ANALYTICS_VIEW, C.NOC_VERIFY],
  // FEE_GENERATE because the BBAS chain gives ZDD_REVIEW a RAISE_FEE_SHORTFALL
  // transition, and that action carries FEE_GENERATE. Without it the desk owns
  // a transition it cannot perform — the same disagreement between the matrix
  // and the workflow that left the ZJD unable to approve. `rbac-seed` now
  // checks for the whole class.
  //
  // SHOW_CAUSE_ISSUE / _DECIDE: the BBAS chain seeds show cause transitions at
  // ZDD_REVIEW, and the transition's capability must be held by its desk.
  [ROLES.ZDD]: [
    ...OFFICER_BASE,
    C.WORKFLOW_REASSIGN,
    C.ANALYTICS_VIEW,
    C.FEE_GENERATE,
    C.NOC_VERIFY,
    C.SHOW_CAUSE_ISSUE,
    C.SHOW_CAUSE_DECIDE,
    // Reviews a verified change of professional request and sends it up.
    C.LTP_CHANGE_REVIEW,
    // Reviews the as-built building against the approved plan and recommends,
    // or raises an occupancy shortfall.
    C.OCCUPANCY_REVIEW,
  ],

  // ── Zonal Joint Director: the apex desk of BBAS_STANDARD ─────────────
  //
  // THE ZJD DECIDES. In the BBAS chain the only APPROVE and REJECT
  // transitions leave ZJD_REVIEW, which the ZJD owns — the manuals put no
  // authority above it, and the workflow says so.
  //
  // Those two capabilities were missing here after the BBAS realignment,
  // while COMMISSIONER (the apex of the older BP_STANDARD chain) kept them.
  // The result was a chain nobody could finish: the ZJD owned the desk and
  // lacked the capability, the Commissioner held the capability and did not
  // own the desk, and every application filed after the realignment was
  // unapprovable. It is fixed here rather than by widening the desk's owner
  // roles, because the desk is right and it was the matrix that lagged.
  //
  // ORDER_REVOKE is deliberately NOT granted: revoking a permission already
  // issued is a heavier act than granting one, it is the Commissioner's in
  // both chains, and nothing in the manuals moved it.
  [ROLES.ZJD]: [
    ...OFFICER_BASE,
    C.WORKFLOW_REASSIGN,
    C.ANALYTICS_VIEW,
    C.FEE_GENERATE,
    C.APPLICATION_APPROVE,
    C.APPLICATION_REJECT,
    C.NOC_VERIFY,
    // Issues and decides show cause notices, before and after approval, and
    // PROPOSES revocation of a permission it granted. Deciding a revocation is
    // ORDER_REVOKE, which stays with the Commissioner (see above).
    C.SHOW_CAUSE_ISSUE,
    C.SHOW_CAUSE_DECIDE,
    C.REVOCATION_INITIATE,
    // Keeps the zone's Outward register: dispatches the notices and orders
    // the show cause and revocation branches generate.
    C.OUTWARD_MANAGE,
    // Approves or rejects a change of technical professional — the apex desk
    // of the chain decides who holds the file, as it decides the file.
    C.LTP_CHANGE_DECIDE,
    // Approves or rejects occupancy and issues the certificate — the desk that
    // granted the permission certifies the building built under it.
    C.OCCUPANCY_DECIDE,
    // Approves or rejects a developer's registration — the apex desk, as for
    // every other registration-like decision in this chain.
    C.DEVELOPER_DECIDE,
    // Approves or rejects a professional's registration.
    C.LTP_REG_DECIDE,
  ],

  // ── Director (Development Plan): city-wide remit ──────────────────────
  [ROLES.DIRECTOR_DP]: [
    ...OFFICER_BASE,
    C.APPLICATION_VIEW_ALL,
    C.WORKFLOW_REASSIGN,
    C.ANALYTICS_VIEW,
    C.FEE_GENERATE,
  ],

  [ROLES.ADDL_COMMISSIONER]: [
    ...OFFICER_BASE,
    C.APPLICATION_VIEW_ALL,
    C.WORKFLOW_REASSIGN,
    C.ANALYTICS_VIEW,
    C.FEE_GENERATE,
  ],

  // ── Commissioner: the only role that may decide an application ────────
  [ROLES.COMMISSIONER]: [
    ...OFFICER_BASE,
    C.APPLICATION_VIEW_ALL,
    C.WORKFLOW_REASSIGN,
    C.ANALYTICS_VIEW,
    C.FEE_GENERATE,
    C.FEE_WAIVE,
    C.APPLICATION_APPROVE,
    C.APPLICATION_REJECT,
    C.ORDER_REVOKE,
  ],

  // ── Finance: money only, no workflow action ───────────────────────────
  [ROLES.FINANCE_OFFICER]: [
    C.APPLICATION_VIEW,
    C.APPLICATION_VIEW_ALL,
    // Reads the checklist, verifies nothing on it. Finance holds
    // SHORTFALL-adjacent grants for money reasons and must not acquire a
    // planning judgement along with them.
    C.CHECKLIST_VIEW,
    C.DOCUMENT_VIEW,
    C.DOCUMENT_DOWNLOAD,
    C.FEE_VIEW,
    C.FEE_GENERATE,
    C.FEE_STRUCTURE_MANAGE,
    C.PAYMENT_VIEW,
    C.PAYMENT_RECONCILE,
    C.PAYMENT_REFUND,
    C.WORKFLOW_VIEW,
    C.SHORTFALL_VIEW,
    C.ORDER_VIEW,
    C.AUDIT_VIEW,
    C.REPORT_VIEW,
    C.ANALYTICS_VIEW,
  ],

  // ── System administrator: configures, never decides ───────────────────
  [ROLES.SYSTEM_ADMIN]: [
    C.APPLICATION_VIEW,
    C.APPLICATION_VIEW_ALL,
    C.APPLICATION_EDIT,
    C.APPLICATION_DELETE,
    C.APPLICATION_WITHDRAW,
    C.DRAWING_VIEW,
    C.DRAWING_DOWNLOAD,
    C.SCRUTINY_REQUEST,
    C.SCRUTINY_VIEW,
    C.DOCUMENT_VIEW,
    C.DOCUMENT_DOWNLOAD,
    C.FEE_VIEW,
    C.FEE_GENERATE,
    C.FEE_STRUCTURE_MANAGE,
    C.PAYMENT_VIEW,
    C.PAYMENT_RECONCILE,
    C.WORKFLOW_VIEW,
    C.WORKFLOW_REASSIGN,
    C.WORKFLOW_MANAGE,
    C.SHORTFALL_VIEW,
    // Configures the questions through MASTER_DATA_MANAGE; does not answer or
    // verify them on anybody's file. Same principle as the absent approval
    // grant above.
    C.CHECKLIST_VIEW,
    // Reads inspection reports; never books or signs one.
    C.SITE_INSPECTION_VIEW,
    // Configures the NOC types; never verifies a NOC.
    C.NOC_VIEW,
    // Reads the proceedings registers and decides nothing on them. Keeps the
    // Outward register — clerical, not a decision about any application.
    C.SHOW_CAUSE_VIEW,
    C.REVOCATION_VIEW,
    C.OUTWARD_VIEW,
    C.OUTWARD_MANAGE,
    C.LTP_CHANGE_VIEW,
    C.COMMENCEMENT_VIEW,
    C.OCCUPANCY_VIEW,
    // Reads the developer register and configures its validity settings;
    // never registers, verifies or decides.
    C.DEVELOPER_VIEW,
    C.LTP_REG_VIEW,
    C.ORDER_VIEW,
    C.USER_MANAGE,
    C.ROLE_MANAGE,
    C.ORG_MANAGE,
    C.MASTER_DATA_MANAGE,
    C.SETTINGS_MANAGE,
    C.NOTIFICATION_TEMPLATE_MANAGE,
    C.INTEGRATION_MANAGE,
    C.AUDIT_VIEW,
    C.REPORT_VIEW,
    C.ANALYTICS_VIEW,
    C.NOTIFICATION_LOG_VIEW,
  ],

  // ── Auditor: reads everything, writes nothing ─────────────────────────
  // Writes are additionally rejected at the route wrapper, so a
  // misconfiguration here still cannot make this account dangerous.
  [ROLES.VIEWER]: READ_ONLY,
};

/** Human-readable role metadata, used by the seed and the admin UI. */
export const ROLE_META: Record<RoleKey, { name: string; description: string; rank: number }> = {
  [ROLES.LTP]: {
    name: 'Licensed Technical Person',
    description: 'Files applications, uploads drawings and documents, pays fees, answers shortfalls.',
    rank: 10,
  },
  [ROLES.TPA]: {
    name: 'Town Planning Assistant',
    description: 'First departmental review. Technical scrutiny, document verification, shortfalls.',
    rank: 20,
  },
  [ROLES.ZAD]: {
    name: 'Zonal Assistant Director',
    description: 'Zonal review.',
    rank: 30,
  },
  [ROLES.PLANNING_OFFICER]: {
    name: 'Planning Officer',
    description: 'Technical endorsement between the TPA and the Zonal Deputy Director.',
    rank: 25,
  },
  [ROLES.ZDD]: {
    name: 'Zonal Deputy Director',
    description: 'Zonal review.',
    rank: 30,
  },
  [ROLES.ZJD]: {
    name: 'Zonal Joint Director',
    description: 'Zonal review. May report a fee shortfall and still forward.',
    rank: 40,
  },
  [ROLES.DIRECTOR_DP]: {
    name: 'Director (Development Plan)',
    description: 'City-wide review. May report a shortfall and still forward.',
    rank: 50,
  },
  [ROLES.ADDL_COMMISSIONER]: {
    name: 'Additional Commissioner',
    description: 'Penultimate review before the Commissioner.',
    rank: 60,
  },
  [ROLES.COMMISSIONER]: {
    name: 'Commissioner',
    description: 'Final approval authority. The only role that may approve or reject.',
    rank: 70,
  },
  [ROLES.FINANCE_OFFICER]: {
    name: 'Finance Officer',
    description: 'Fee structures, payment reconciliation and refunds.',
    rank: 45,
  },
  [ROLES.SYSTEM_ADMIN]: {
    name: 'System Administrator',
    description: 'Users, roles, workflow configuration and settings. Holds no approval authority.',
    rank: 90,
  },
  [ROLES.VIEWER]: {
    name: 'Viewer / Auditor',
    description: 'Read-only across the register. Every write is refused at the route boundary.',
    rank: 5,
  },
};

/** Where each role lands after signing in. */
export const ROLE_LANDING: Record<RoleKey, string> = {
  [ROLES.LTP]: '/dashboard',
  [ROLES.TPA]: '/dashboard',
  [ROLES.ZAD]: '/dashboard',
  [ROLES.PLANNING_OFFICER]: '/dashboard',
  [ROLES.ZDD]: '/dashboard',
  [ROLES.ZJD]: '/dashboard',
  [ROLES.DIRECTOR_DP]: '/dashboard',
  [ROLES.ADDL_COMMISSIONER]: '/dashboard',
  [ROLES.COMMISSIONER]: '/dashboard',
  [ROLES.FINANCE_OFFICER]: '/dashboard',
  [ROLES.SYSTEM_ADMIN]: '/admin',
  [ROLES.VIEWER]: '/dashboard',
};

/** Which dashboard a role sees at /dashboard. */
export type DashboardKind = 'ltp' | 'officer' | 'executive' | 'finance' | 'admin' | 'viewer';

/**
 * `viewer` is separated from `officer` deliberately.
 *
 * An auditor holds no stage and therefore has no task queue, so the officer
 * dashboard would greet them with four tiles reading zero and a "nothing at
 * your desk" panel — which is accurate and useless. They get the oversight
 * figures instead, with none of the action links they could not use anyway.
 */
export function dashboardFor(roleKeys: RoleKey[]): DashboardKind {
  if (roleKeys.includes(ROLES.SYSTEM_ADMIN)) return 'admin';
  if (roleKeys.includes(ROLES.LTP)) return 'ltp';
  if (roleKeys.includes(ROLES.FINANCE_OFFICER)) return 'finance';
  if (
    roleKeys.includes(ROLES.COMMISSIONER) ||
    roleKeys.includes(ROLES.ADDL_COMMISSIONER) ||
    roleKeys.includes(ROLES.DIRECTOR_DP)
  ) {
    return 'executive';
  }
  if (roleKeys.includes(ROLES.VIEWER)) return 'viewer';
  return 'officer';
}
