import type { PrismaClient } from '@prisma/client';
import { buildWorkflow, type BuildResult } from './workflow/builder';
import { BP_STANDARD } from './workflow/bp-standard';
import { BBAS_STANDARD } from './workflow/bbas-standard';

/**
 * THE WORKFLOWS, AND WHICH ONE IS THE DEFAULT.
 *
 * Everything the department does with a file is data: which desks exist, what
 * each may do, where each action sends the file, what must be true before it
 * may, and what else happens when it does. `src/server/workflow/engine.ts`
 * contains none of it. That is the deal the engine makes — it is a mechanism,
 * and this is the policy.
 *
 * Two chains are seeded, and both are published:
 *
 *   BBAS_STANDARD   TPA → Planning Officer → ZDD → ZJD          ← the default
 *   BP_STANDARD     TPA → ZAD/ZDD → ZJD → Director → AC → C     ← optional
 *
 * The action CATALOGUE below is shared. An action is a verb — "Forward",
 * "Raise document shortfall" — and a stage acquires the ability to perform one
 * by having a transition row that references it, which is why FORWARD is
 * defined once and means "send it on" at ten different desks across two
 * different chains.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Actions — shared by every workflow
// ═══════════════════════════════════════════════════════════════════════════

type ActionSeed = {
  code: string;
  label: string;
  kind: 'FORWARD' | 'RETURN' | 'REPORT_AND_FORWARD' | 'APPROVE' | 'REJECT' | 'RESUBMIT' | 'CLARIFY' | 'SYSTEM';
  intent: 'primary' | 'secondary' | 'destructive';
  capabilityKey: string;
  requiresRemarks: boolean;
  requiresAttachment?: boolean;
  confirmText?: string;
  displayOrder: number;
};

const ACTIONS: ActionSeed[] = [
  {
    code: 'CONFIRM_PAYMENT',
    label: 'Payment confirmed',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 0,
  },
  {
    code: 'FORWARD',
    label: 'Forward',
    kind: 'FORWARD',
    intent: 'primary',
    capabilityKey: 'WORKFLOW_FORWARD',
    requiresRemarks: true,
    displayOrder: 10,
  },
  {
    code: 'RAISE_DOCUMENT_SHORTFALL',
    label: 'Raise document shortfall',
    kind: 'RETURN',
    intent: 'secondary',
    capabilityKey: 'SHORTFALL_CREATE',
    requiresRemarks: true,
    confirmText: 'The application goes back to the applicant until this is answered.',
    displayOrder: 20,
  },
  {
    code: 'RAISE_FEE_SHORTFALL',
    label: 'Raise fee shortfall',
    kind: 'RETURN',
    intent: 'secondary',
    // Raising one ISSUES A DEMAND, so it needs the fee capability as well as
    // the shortfall one. `capabilityKey` holds a single key, and FEE_GENERATE
    // is the more consequential of the two — it is the one that can make
    // somebody owe money.
    capabilityKey: 'FEE_GENERATE',
    requiresRemarks: true,
    confirmText: 'A demand will be raised and the application goes back to the applicant.',
    displayOrder: 30,
  },
  {
    code: 'RAISE_TECHNICAL_SHORTFALL',
    label: 'Raise technical shortfall',
    kind: 'RETURN',
    intent: 'secondary',
    capabilityKey: 'SHORTFALL_CREATE',
    requiresRemarks: true,
    confirmText: 'The applicant must correct the drawing before the file moves on.',
    displayOrder: 40,
  },
  {
    code: 'RAISE_CLARIFICATION',
    label: 'Ask for clarification',
    kind: 'CLARIFY',
    intent: 'secondary',
    capabilityKey: 'SHORTFALL_CREATE',
    requiresRemarks: true,
    displayOrder: 50,
  },
  {
    code: 'REPORT_FEE_SHORTFALL_AND_FORWARD',
    label: 'Report fee shortfall and forward',
    kind: 'REPORT_AND_FORWARD',
    intent: 'secondary',
    capabilityKey: 'FEE_GENERATE',
    requiresRemarks: true,
    confirmText:
      'The shortfall travels with the file and must be settled before approval. The file moves on now.',
    displayOrder: 60,
  },
  {
    code: 'REPORT_SHORTFALL_AND_FORWARD',
    label: 'Report shortfall and forward',
    kind: 'REPORT_AND_FORWARD',
    intent: 'secondary',
    capabilityKey: 'SHORTFALL_CREATE',
    requiresRemarks: true,
    confirmText:
      'The shortfall travels with the file and must be settled before approval. The file moves on now.',
    displayOrder: 70,
  },
  {
    code: 'RETURN_TO_PREVIOUS',
    label: 'Return',
    kind: 'RETURN',
    intent: 'secondary',
    capabilityKey: 'WORKFLOW_RETURN',
    requiresRemarks: true,
    displayOrder: 80,
  },
  {
    code: 'RESUBMIT',
    label: 'Submit response',
    kind: 'RESUBMIT',
    intent: 'primary',
    capabilityKey: 'SHORTFALL_RESPOND',
    requiresRemarks: true,
    displayOrder: 90,
  },
  {
    code: 'ACCEPT_RESOLUTION',
    label: 'Accept response',
    kind: 'FORWARD',
    intent: 'primary',
    capabilityKey: 'SHORTFALL_RESOLVE',
    requiresRemarks: true,
    displayOrder: 100,
  },
  {
    code: 'REJECT_RESOLUTION',
    label: 'Reject response',
    kind: 'RETURN',
    intent: 'destructive',
    capabilityKey: 'SHORTFALL_RESOLVE',
    requiresRemarks: true,
    confirmText: 'The application goes back to the applicant for another attempt.',
    displayOrder: 110,
  },
  {
    code: 'RESOLVE_REPORTED_SHORTFALL',
    label: 'Close reported shortfall',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'SHORTFALL_RESOLVE',
    requiresRemarks: true,
    confirmText: 'Say what settled it — the payment, or the document supplied.',
    displayOrder: 115,
  },

  // ── Site inspection ────────────────────────────────────────────────────
  //
  // Performed by the site inspection service, never from the action modal:
  // the transitions carry a LINK_SITE_INSPECTION effect and the action bar
  // renders them as a pointer to the Site Inspection tab. They are catalogue
  // entries like any other so that the history row, the audit row and the
  // capability check are the engine's, not a second implementation.
  {
    code: 'SCHEDULE_SITE_INSPECTION',
    label: 'Schedule site inspection',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'SITE_INSPECTION_SCHEDULE',
    requiresRemarks: false,
    displayOrder: 12,
  },
  {
    code: 'SUBMIT_SITE_INSPECTION',
    label: 'Submit inspection report',
    kind: 'FORWARD',
    intent: 'primary',
    capabilityKey: 'SITE_INSPECTION_CONDUCT',
    requiresRemarks: true,
    confirmText: 'The signed report is locked and the file moves to the next desk.',
    displayOrder: 13,
  },
  {
    code: 'RAISE_INSPECTION_SHORTFALL',
    label: 'Submit inspection report — raise shortfall',
    kind: 'RETURN',
    intent: 'secondary',
    // The report is the act. The service ALSO requires SHORTFALL_CREATE,
    // because this transition opens a shortfall like any other.
    capabilityKey: 'SITE_INSPECTION_CONDUCT',
    requiresRemarks: true,
    confirmText: 'The signed report is locked and the application goes back to the applicant.',
    displayOrder: 14,
  },
  // ── Show cause and revocation (Phase 7) ───────────────────────────────
  //
  // Performed by the proceedings services, never from the action modal: the
  // notice and the proposal need particulars the modal cannot collect, so the
  // action bar renders these as a pointer to the Proceedings tab. Catalogue
  // entries like any other, so the history row, the audit row and the
  // capability check are the engine's.
  {
    code: 'ISSUE_SHOW_CAUSE',
    label: 'Issue show cause notice',
    kind: 'CLARIFY',
    intent: 'secondary',
    capabilityKey: 'SHOW_CAUSE_ISSUE',
    requiresRemarks: true,
    confirmText: 'The notice is generated and sent to the Outward register for dispatch.',
    displayOrder: 116,
  },
  {
    // The applicant's answer. SYSTEM: never offered in an action bar; raised
    // by the show cause service on the applicant's behalf and recorded in
    // their name — the applicant owns no desk to perform it from.
    code: 'RESPOND_SHOW_CAUSE',
    label: 'Show cause response submitted',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 116,
  },
  {
    code: 'TAKE_UP_SHOW_CAUSE',
    label: 'Review show cause submission',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'SHOW_CAUSE_DECIDE',
    requiresRemarks: false,
    displayOrder: 117,
  },
  {
    code: 'DECIDE_SHOW_CAUSE',
    label: 'Decide show cause',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'SHOW_CAUSE_DECIDE',
    requiresRemarks: true,
    displayOrder: 118,
  },
  {
    code: 'INITIATE_REVOCATION',
    label: 'Initiate revocation',
    kind: 'CLARIFY',
    intent: 'destructive',
    capabilityKey: 'REVOCATION_INITIATE',
    requiresRemarks: true,
    confirmText: 'A revocation proceeding is proposed for review by the revoking authority. The permission stands until it is decided.',
    displayOrder: 140,
  },
  {
    code: 'TAKE_UP_REVOCATION',
    label: 'Take up revocation for review',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'ORDER_REVOKE',
    requiresRemarks: false,
    displayOrder: 141,
  },
  {
    code: 'REVOKE_PROCEEDING',
    label: 'Revoke permission',
    kind: 'REJECT',
    intent: 'destructive',
    capabilityKey: 'ORDER_REVOKE',
    requiresRemarks: true,
    confirmText:
      'The permission is revoked and a revocation order is sent to Outward. The approval and its history remain on the record.',
    displayOrder: 142,
  },
  {
    code: 'REJECT_REVOCATION',
    label: 'Reject revocation proposal',
    kind: 'FORWARD',
    intent: 'secondary',
    capabilityKey: 'ORDER_REVOKE',
    requiresRemarks: true,
    displayOrder: 143,
  },
  // ── Change of technical professional (Phase 8) ────────────────────────
  //
  // SYSTEM-kind, all five: raised by the professional change service on
  // behalf of the officer taking the step, after it has checked the step's
  // capability (LTP_CHANGE_*) and the officer's jurisdiction. A
  // request travels TPA → Planning Officer → ZDD → ZJD wherever the file
  // itself is, and a desk transition may only be granted to a role owning the
  // file's stage — so the desk is the capability's holder, and the engine
  // records the step in the file's history with that officer's name.
  {
    code: 'REQUEST_PROFESSIONAL_CHANGE',
    label: 'Change of LTP requested',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 150,
  },
  {
    code: 'VERIFY_PROFESSIONAL_CHANGE',
    label: 'Change of LTP verified',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 151,
  },
  {
    code: 'REVIEW_PROFESSIONAL_CHANGE',
    label: 'Change of LTP reviewed',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 152,
  },
  {
    code: 'APPROVE_PROFESSIONAL_CHANGE',
    label: 'Change of LTP approved',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 153,
  },
  {
    code: 'REJECT_PROFESSIONAL_CHANGE',
    label: 'Change of LTP rejected',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 154,
  },
  // ── Commencement of work (Phase 9) ────────────────────────────────────
  //
  // SYSTEM-kind: raised by the commencement service on behalf of the file's
  // technical professional, after it has checked COMMENCEMENT_NOTIFY and row
  // scope. The professional owns no desk at CLOSED_APPROVED, so — like the
  // applicant's show cause answer — the step cannot be a desk transition.
  {
    code: 'NOTIFY_WORK_COMMENCEMENT',
    label: 'Commencement of work notified',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 160,
  },
  // ── Occupancy (Phase 10) ──────────────────────────────────────────────
  //
  // SYSTEM-kind, all nine: raised by the occupancy service for whoever holds
  // the step's OCCUPANCY_* capability. The file sits at CLOSED_APPROVED, a
  // stage no desk works, so none can be a desk transition.
  {
    code: 'SUBMIT_OCCUPANCY',
    label: 'Completion intimated — occupancy applied for',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 170,
  },
  {
    code: 'SCHEDULE_FINAL_INSPECTION',
    label: 'Final inspection scheduled',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 171,
  },
  {
    code: 'RECORD_FINAL_INSPECTION',
    label: 'Final inspection recorded',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 172,
  },
  {
    code: 'RECOMMEND_OCCUPANCY',
    label: 'Occupancy recommended',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 173,
  },
  {
    code: 'RAISE_OCCUPANCY_SHORTFALL',
    label: 'Occupancy shortfall raised',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 174,
  },
  {
    code: 'RESPOND_OCCUPANCY_SHORTFALL',
    label: 'Occupancy shortfall answered',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 175,
  },
  {
    code: 'APPROVE_OCCUPANCY',
    label: 'Occupancy approved',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 176,
  },
  {
    code: 'REJECT_OCCUPANCY',
    label: 'Occupancy rejected',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 177,
  },
  {
    code: 'ISSUE_OCCUPANCY_CERTIFICATE',
    label: 'Occupancy certificate issued',
    kind: 'SYSTEM',
    intent: 'secondary',
    capabilityKey: '',
    requiresRemarks: false,
    displayOrder: 178,
  },
  {
    code: 'APPROVE',
    label: 'Approve',
    kind: 'APPROVE',
    intent: 'primary',
    capabilityKey: 'APPLICATION_APPROVE',
    requiresRemarks: true,
    confirmText: 'This grants the building permission and issues the approval order.',
    displayOrder: 120,
  },
  {
    code: 'REJECT',
    label: 'Reject',
    kind: 'REJECT',
    intent: 'destructive',
    capabilityKey: 'APPLICATION_REJECT',
    requiresRemarks: true,
    confirmText: 'This refuses the application. It cannot be undone.',
    displayOrder: 130,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Seeding
// ═══════════════════════════════════════════════════════════════════════════

/** The workflow new applications are routed through. */
export const DEFAULT_WORKFLOW_CODE = BBAS_STANDARD.code;

export async function seedWorkflow(prisma: PrismaClient) {
  // ── Actions first: the definitions reference them by code ──────────────
  for (const action of ACTIONS) {
    await prisma.workflowAction.upsert({
      where: { code: action.code },
      create: {
        code: action.code,
        label: action.label,
        kind: action.kind,
        intent: action.intent,
        capabilityKey: action.capabilityKey,
        requiresRemarks: action.requiresRemarks,
        requiresAttachment: action.requiresAttachment ?? false,
        confirmText: action.confirmText ?? '',
        displayOrder: action.displayOrder,
      },
      update: {
        label: action.label,
        kind: action.kind,
        intent: action.intent,
        capabilityKey: action.capabilityKey,
        requiresRemarks: action.requiresRemarks,
        requiresAttachment: action.requiresAttachment ?? false,
        confirmText: action.confirmText ?? '',
        displayOrder: action.displayOrder,
        isActive: true,
      },
    });
  }

  // ── Both chains ────────────────────────────────────────────────────────
  const built: BuildResult[] = [];
  built.push(await buildWorkflow(prisma, BBAS_STANDARD));
  built.push(await buildWorkflow(prisma, BP_STANDARD));

  // ── Point new applications at the default ──────────────────────────────
  //
  // Only the TYPE is repointed, which decides where a file that has not yet
  // started a run will go. Applications already running keep the workflow their
  // instance was pinned to at `startWorkflow` — that pin is what stops a
  // configuration edit from corrupting a file in flight, and re-routing an
  // active one is a deliberate, audited operation (scripts/align-bbas-workflow.ts),
  // never a side effect of seeding.
  const bbas = await prisma.workflow.findFirstOrThrow({
    where: { code: DEFAULT_WORKFLOW_CODE, version: BBAS_STANDARD.version },
    select: { id: true, isPublished: true },
  });

  let repointed = 0;
  if (bbas.isPublished) {
    const { count } = await prisma.applicationType.updateMany({
      where: { workflowId: { not: bbas.id }, deletedAt: null },
      data: { workflowId: bbas.id },
    });
    repointed = count;
  }

  return {
    workflows: built.map((b) => ({
      code: b.code,
      stages: b.stages,
      transitions: b.transitions,
      retired: b.retired,
      slaRules: b.slaRules,
      assignments: b.assignments,
      published: b.published,
      issues: b.issues,
    })),
    actions: ACTIONS.length,
    defaultWorkflow: DEFAULT_WORKFLOW_CODE,
    applicationTypesRepointed: repointed,
    // The aggregate shape the seed runner prints.
    stages: built.reduce((n, b) => n + b.stages, 0),
    transitions: built.reduce((n, b) => n + b.transitions, 0),
    retired: built.reduce((n, b) => n + b.retired, 0),
    slaRules: built.reduce((n, b) => n + b.slaRules, 0),
    assignments: built.reduce((n, b) => n + b.assignments, 0),
    published: built.every((b) => b.published),
    issues: built.flatMap((b) => b.issues),
  };
}
