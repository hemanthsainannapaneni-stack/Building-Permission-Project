import 'server-only';
import type { Tx } from '@/server/db/prisma';
import { documentsComplete } from '@/server/services/documents';
import { GUARDS } from '@/lib/workflow';
import { CLOSED_SHORTFALL_STATUSES } from '@/lib/constants';
import { SHORTFALL_STATUS } from '@/lib/shortfalls';
import { AWAITING_DECISION_STATUSES, OPEN_SHOW_CAUSE_STATUSES } from '@/lib/show-cause';
import { OPEN_REVOCATION_STATUSES } from '@/lib/revocation';
import { OPEN_PROFESSIONAL_CHANGE_STATUSES } from '@/lib/professional-change';

/**
 * The guard registry.
 *
 * A guard is a PURE QUESTION about the application, asked before anything is
 * written. Every one of them is evaluated inside the transition's transaction
 * and a single failure abandons it whole — so a refused action leaves no
 * shortfall, no task, no history row and no half-moved file.
 *
 * ── Two properties worth stating ─────────────────────────────────────────
 *
 * A guard NEVER writes. Not a status, not a counter, not a log line. That is
 * what makes it safe to evaluate the same guards again when the UI asks which
 * actions are available — the officer's action bar runs exactly the checks the
 * POST will run, which is why a button that is offered cannot then be refused.
 *
 * A guard's failure MESSAGE is written for the officer, and names the thing to
 * do about it. "3 mandatory documents are still missing" tells someone what
 * happens next; "guard documents_complete failed" tells them to ring support.
 */

export type GuardContext = {
  tx: Tx;
  application: {
    id: string;
    status: string;
    applicationTypeId: string;
    zoneId: string | null;
    openShortfalls: number;
  };
  /** What the actor supplied with the action. */
  input: { remarks: string; attachments: unknown[] };
};

export type GuardResult = { passed: boolean; message: string };

export type Guard = (ctx: GuardContext) => Promise<GuardResult> | GuardResult;

const ok: GuardResult = { passed: true, message: '' };
const no = (message: string): GuardResult => ({ passed: false, message });

/** The file's current occupancy application is in `status`. */
const occupancyIn =
  (status: string, message: string): Guard =>
  async ({ tx, application }) => {
    const count = await tx.occupancyApplication.count({ where: { applicationId: application.id, isCurrent: true, status } });
    return count > 0 ? ok : no(message);
  };

const REGISTRY: Record<string, Guard> = {
  // ── Drawing and scrutiny ───────────────────────────────────────────────

  [GUARDS.DRAWING_UPLOADED]: async ({ tx, application }) => {
    const count = await tx.drawingVersion.count({
      where: { isActive: true, drawing: { applicationId: application.id } },
    });
    return count > 0 ? ok : no('No drawing has been uploaded yet.');
  },

  [GUARDS.SCRUTINY_PASSED]: async ({ tx, application }) => {
    // The LATEST result on an ACTIVE version. Asking merely whether a PASS
    // exists anywhere would let a passed version be superseded by a failing
    // one and still satisfy the gate.
    const latest = await tx.scrutinyResult.findFirst({
      where: {
        request: {
          drawingVersion: { isActive: true, drawing: { applicationId: application.id } },
        },
      },
      orderBy: { evaluatedAt: 'desc' },
      select: { outcome: true },
    });

    if (!latest) return no('The drawing has not been scrutinised yet.');
    return latest.outcome === 'PASS'
      ? ok
      : no('The current drawing did not pass scrutiny. A corrected version must be uploaded.');
  },

  // ── Documents ──────────────────────────────────────────────────────────

  [GUARDS.DOCUMENTS_COMPLETE]: async ({ tx, application }) => {
    // The same function the checklist screen and the fee engine call, so what
    // an applicant sees and what blocks them cannot disagree.
    const { complete, missing } = await documentsComplete(application.id, tx);
    if (complete) return ok;

    const names = missing.slice(0, 3).map((m) => m.name).join(', ');
    const more = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
    return no(
      `${missing.length} mandatory ${missing.length === 1 ? 'document is' : 'documents are'} still missing: ${names}${more}.`
    );
  },

  // ── Money ──────────────────────────────────────────────────────────────

  [GUARDS.FEE_DEMAND_ISSUED]: async ({ tx, application }) => {
    const count = await tx.applicationFee.count({
      where: {
        applicationId: application.id,
        type: 'ORIGINAL',
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
      },
    });
    return count > 0 ? ok : no('No fee demand has been raised for this application.');
  },

  /**
   * Every demand settled.
   *
   * Expressed as "nothing is outstanding" rather than "the original is paid",
   * because a shortfall demand raised at ZJD is exactly as payable as the
   * original and an approval must not be able to step over it.
   */
  [GUARDS.FEES_PAID]: async ({ tx, application }) => {
    const outstanding = await tx.applicationFee.findMany({
      where: {
        applicationId: application.id,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      },
      select: { demandNumber: true, totalAmount: true, paidAmount: true },
    });

    if (!outstanding.length) return ok;

    const due = outstanding.reduce((sum, d) => sum + (Number(d.totalAmount) - Number(d.paidAmount)), 0);
    return no(
      `${outstanding.length} ${outstanding.length === 1 ? 'demand is' : 'demands are'} unpaid — ` +
        `${due.toFixed(2)} outstanding.`
    );
  },

  // ── Shortfalls ─────────────────────────────────────────────────────────

  [GUARDS.NO_OPEN_BLOCKING_SHORTFALLS]: async ({ tx, application }) => {
    const count = await tx.shortfall.count({
      where: {
        applicationId: application.id,
        mode: 'BLOCKING',
        status: { notIn: [...CLOSED_SHORTFALL_STATUSES] },
      },
    });
    return count === 0
      ? ok
      : no(`${count} blocking ${count === 1 ? 'shortfall is' : 'shortfalls are'} still open.`);
  },

  /**
   * THE approval guard. Absolute, and with no override anywhere in the system.
   *
   * Counts every open shortfall regardless of kind and regardless of mode — a
   * shortfall that was merely REPORTED and forwarded travels with the file and
   * still blocks approval, which is the entire difference between reporting
   * one and approving past it. See docs/03-workflow.md F.5.1.
   *
   * The live COUNT is deliberate: `applications.openShortfalls` is a cache,
   * and a cache must never be the thing that authorises an approval.
   *
   * ── It asks a SECOND question about closed shortfalls ──────────────────
   *
   * A shortfall closes as a whole, and closing it settles every line. But an
   * item carries `isMandatory` and `isResolved` of its own, and a mandatory
   * line left unresolved under a closed letter is precisely the state this
   * guard exists to catch — whether it got there through a data repair, an
   * item decision that went one way while the letter went the other, or a
   * future path nobody has written yet. Checking the letter alone would trust
   * the letter's status to imply something about its contents, and the
   * contents are what the approval is actually about.
   */
  [GUARDS.NO_OPEN_SHORTFALLS]: async ({ tx, application }) => {
    const [open, strayItems] = await Promise.all([
      tx.shortfall.findMany({
        where: { applicationId: application.id, status: { notIn: [...CLOSED_SHORTFALL_STATUSES] } },
        select: { shortfallNumber: true, kind: true, mode: true },
      }),
      tx.shortfallItem.findMany({
        where: {
          isMandatory: true,
          isResolved: false,
          shortfall: {
            applicationId: application.id,
            // Open letters are already covered by the count above; naming the
            // same item twice would tell somebody there are two problems.
            status: { in: [...CLOSED_SHORTFALL_STATUSES] },
          },
        },
        select: { description: true, shortfall: { select: { shortfallNumber: true } } },
      }),
    ]);

    if (!open.length && !strayItems.length) return ok;

    if (open.length) {
      const reported = open.filter((s) => s.mode === 'REPORTED').length;
      const detail = reported
        ? ` (${reported} of them reported and carried forward, which does not settle them)`
        : '';

      return no(
        `${open.length} ${open.length === 1 ? 'shortfall is' : 'shortfalls are'} still open${detail}. ` +
          'These must be resolved before the application can be approved.'
      );
    }

    const first = strayItems[0]!;
    const rest = strayItems.length - 1;

    return no(
      `${strayItems.length} mandatory shortfall ${strayItems.length === 1 ? 'item is' : 'items are'} ` +
        `still unresolved — ${first.shortfall.shortfallNumber}: "${first.description}"` +
        `${rest ? ` and ${rest} more` : ''}. ` +
        'Every mandatory item must be settled before the application can be approved.'
    );
  },

  /**
   * There is something for the officer to accept or reject.
   *
   * Without this, ACCEPT_RESOLUTION could resume a parked file that the
   * applicant has not answered — the officer would be accepting nothing, and
   * the shortfall would close with no response recorded against it.
   */
  [GUARDS.SHORTFALL_AWAITING_REVIEW]: async ({ tx, application }) => {
    const count = await tx.shortfall.count({
      where: {
        applicationId: application.id,
        status: {
          in: [SHORTFALL_STATUS.RESOLUTION_SUBMITTED, SHORTFALL_STATUS.UNDER_REVIEW],
        },
        resolutions: { some: { reviewedAt: null } },
      },
    });
    return count > 0 ? ok : no('The applicant has not responded to the shortfall yet.');
  },

  /**
   * There is a reported shortfall on this file to close.
   *
   * Distinct from `shortfall_awaiting_review`, which asks about a PARKED file
   * the applicant has answered. This one asks about a shortfall that travelled
   * here with the file — nobody parked anything, and the officer holding it
   * now is the one who can settle it.
   */
  [GUARDS.REPORTED_SHORTFALL_OPEN]: async ({ tx, application }) => {
    const count = await tx.shortfall.count({
      where: {
        applicationId: application.id,
        mode: 'REPORTED',
        status: { notIn: [...CLOSED_SHORTFALL_STATUSES] },
      },
    });
    return count > 0 ? ok : no('There is no reported shortfall on this application to close.');
  },

  // ── Site inspection ────────────────────────────────────────────────────
  //
  // Both ask about an inspection that exists and has NOT yet moved the file.
  // The site inspection service writes the inspection and performs the
  // transition in one transaction, so from its side these always pass; from
  // anywhere else — a hand-made POST to the generic action endpoint — they
  // are what refuses to move a file for an inspection nobody booked or signed.

  [GUARDS.SITE_INSPECTION_SCHEDULED]: async ({ tx, application }) => {
    const count = await tx.siteInspection.count({
      where: { applicationId: application.id, status: 'SCHEDULED', scheduleLinkedAt: null },
    });
    return count > 0
      ? ok
      : no('Schedule the site inspection from the Site Inspection tab — choose the inspector and the date.');
  },

  [GUARDS.SITE_INSPECTION_SIGNED]: async ({ tx, application }) => {
    const count = await tx.siteInspection.count({
      where: { applicationId: application.id, status: 'SUBMITTED', routedAt: null },
    });
    return count > 0
      ? ok
      : no('Complete, sign and submit the site inspection report from the Site Inspection tab.');
  },

  // ── NOCs ───────────────────────────────────────────────────────────────
  //
  // Available to any transition that lists it, and listed by NONE of the
  // seeded workflows. Making a verified NOC a precondition of approval is a
  // policy decision for the department; when it is taken, it is one entry in
  // a transition's `guards` array — no code. PENDING counts as outstanding:
  // a NOC nobody has ruled out may still be needed.

  [GUARDS.NOCS_VERIFIED]: async ({ tx, application }) => {
    const outstanding = await tx.applicationNoc.findMany({
      where: { applicationId: application.id, status: { notIn: ['VERIFIED', 'NOT_REQUIRED'] } },
      select: { nocType: { select: { name: true } } },
    });
    if (!outstanding.length) return ok;
    const names = [...new Set(outstanding.map((n) => n.nocType.name))].join(', ');
    return no(`Verify the outstanding NOCs from the NOCs tab first: ${names}.`);
  },

  // ── Show cause and revocation ──────────────────────────────────────────
  //
  // Nothing here is a legal rule. `no_open_show_cause` is procedural: a notice
  // the department issued and has not yet decided is a question still open,
  // and listing this guard on APPROVE says "answer your own question first".
  // It says nothing about what the answer should be.

  [GUARDS.NO_OPEN_SHOW_CAUSE]: async ({ tx, application }) => {
    const open = await tx.showCauseNotice.findFirst({
      where: { applicationId: application.id, status: { in: [...OPEN_SHOW_CAUSE_STATUSES] } },
      select: { noticeNumber: true },
    });
    return open ? no(`Show cause notice ${open.noticeNumber} is still open. Decide it from the Proceedings tab first.`) : ok;
  },

  [GUARDS.SHOW_CAUSE_AWAITING_DECISION]: async ({ tx, application }) => {
    const count = await tx.showCauseNotice.count({
      where: { applicationId: application.id, status: { in: [...AWAITING_DECISION_STATUSES] } },
    });
    return count > 0 ? ok : no('No show cause notice on this file has been answered yet.');
  },

  [GUARDS.SHOW_CAUSE_AWAITING_RESPONSE]: async ({ tx, application }) => {
    const count = await tx.showCauseNotice.count({ where: { applicationId: application.id, status: 'AWAITING_RESPONSE' } });
    return count > 0 ? ok : no('No dispatched show cause notice on this file is awaiting a response.');
  },

  [GUARDS.SHOW_CAUSE_RESPONDED]: async ({ tx, application }) => {
    const count = await tx.showCauseNotice.count({ where: { applicationId: application.id, status: 'RESPONDED' } });
    return count > 0 ? ok : no('No show cause response on this file is waiting to be taken up.');
  },

  [GUARDS.SHOW_CAUSE_UNDER_REVIEW]: async ({ tx, application }) => {
    const count = await tx.showCauseNotice.count({ where: { applicationId: application.id, status: 'UNDER_REVIEW' } });
    return count > 0 ? ok : no('Take the show cause response up for review before deciding it.');
  },

  [GUARDS.NO_OPEN_REVOCATION]: async ({ tx, application }) => {
    const open = await tx.revocationProceeding.findFirst({
      where: { applicationId: application.id, status: { in: [...OPEN_REVOCATION_STATUSES] } },
      select: { revocationNumber: true },
    });
    return open ? no(`Revocation proceeding ${open.revocationNumber} is already open on this file.`) : ok;
  },

  [GUARDS.REVOCATION_PROPOSED]: async ({ tx, application }) => {
    const count = await tx.revocationProceeding.count({ where: { applicationId: application.id, status: 'PROPOSED' } });
    return count > 0 ? ok : no('No revocation has been proposed on this file.');
  },

  [GUARDS.REVOCATION_UNDER_REVIEW]: async ({ tx, application }) => {
    const count = await tx.revocationProceeding.count({ where: { applicationId: application.id, status: 'UNDER_REVIEW' } });
    return count > 0 ? ok : no('No revocation on this file is under review.');
  },

  // ── Change of technical professional ───────────────────────────────────
  //
  // Step order only. Whether the documents are enough to verify is decided by
  // the effect, which can say which one is missing.

  [GUARDS.NO_OPEN_PROFESSIONAL_CHANGE]: async ({ tx, application }) => {
    const open = await tx.professionalChangeRequest.findFirst({
      where: { applicationId: application.id, status: { in: [...OPEN_PROFESSIONAL_CHANGE_STATUSES] } },
      select: { requestNumber: true },
    });
    return open ? no(`Change of LTP request ${open.requestNumber} is still open on this file.`) : ok;
  },

  [GUARDS.PROFESSIONAL_CHANGE_PENDING_VERIFICATION]: async ({ tx, application }) => {
    const count = await tx.professionalChangeRequest.count({ where: { applicationId: application.id, status: 'PENDING_VERIFICATION' } });
    return count > 0 ? ok : no('No change of LTP request on this file is awaiting verification.');
  },

  [GUARDS.PROFESSIONAL_CHANGE_UNDER_REVIEW]: async ({ tx, application }) => {
    const count = await tx.professionalChangeRequest.count({ where: { applicationId: application.id, status: 'UNDER_REVIEW' } });
    return count > 0 ? ok : no('No verified change of LTP request on this file is awaiting review.');
  },

  [GUARDS.PROFESSIONAL_CHANGE_PENDING_DECISION]: async ({ tx, application }) => {
    const count = await tx.professionalChangeRequest.count({ where: { applicationId: application.id, status: 'PENDING_DECISION' } });
    return count > 0 ? ok : no('No reviewed change of LTP request on this file is awaiting a decision.');
  },

  // ── Commencement of work ───────────────────────────────────────────────
  //
  // Approval is the transition's fromStatus; these add what approval alone
  // does not prove — that the proceeding has actually left the office.

  [GUARDS.PROCEEDING_ISSUED]: async ({ tx, application }) => {
    const order = await tx.approvalOrder.findUnique({
      where: { applicationId: application.id },
      select: { orderNumber: true, status: true, revokedAt: true },
    });
    if (!order) return no('The building permission order has not been drawn up yet.');
    if (order.revokedAt || order.status === 'REVOKED') return no(`${order.orderNumber} has been revoked.`);
    return order.status === 'ISSUED'
      ? ok
      : no(`${order.orderNumber} has not been issued yet. Work may commence only after it is.`);
  },

  [GUARDS.NO_WORK_COMMENCEMENT]: async ({ tx, application }) => {
    const row = await tx.workCommencement.findUnique({
      where: { applicationId: application.id },
      select: { commencementNumber: true },
    });
    return row ? no(`Commencement of work has already been notified on this file (${row.commencementNumber}).`) : ok;
  },

  // ── Occupancy ──────────────────────────────────────────────────────────
  //
  // `work_initiated` and `no_open_occupancy` gate the application; the rest
  // order the steps by the current occupancy application's status. Whether
  // the documents, figures and dates are enough is the effect's to say.

  [GUARDS.WORK_INITIATED]: async ({ tx, application }) => {
    const wc = await tx.workCommencement.findUnique({
      where: { applicationId: application.id },
      select: { commencementDate: true },
    });
    if (!wc) return no('Commencement of work has not been notified on this file.');
    const today = new Date(new Date().toISOString().slice(0, 10));
    return wc.commencementDate.getTime() <= today.getTime() ? ok : no('Work on this file has not commenced yet.');
  },

  [GUARDS.NO_OPEN_OCCUPANCY]: async ({ tx, application }) => {
    const row = await tx.occupancyApplication.findFirst({
      where: { applicationId: application.id, status: { not: 'REJECTED' } },
      select: { occupancyNumber: true, status: true },
    });
    if (!row) return ok;
    return row.status === 'CERTIFICATE_ISSUED'
      ? no(`An occupancy certificate has already been issued on this file (${row.occupancyNumber}).`)
      : no(`${row.occupancyNumber} is still open on this file.`);
  },

  [GUARDS.OCCUPANCY_SUBMITTED]: occupancyIn('SUBMITTED', 'No occupancy application on this file is awaiting a final inspection booking.'),
  [GUARDS.OCCUPANCY_INSPECTION_PENDING]: occupancyIn('INSPECTION_PENDING', 'No final inspection is booked on this file.'),
  [GUARDS.OCCUPANCY_INSPECTION_COMPLETED]: occupancyIn('INSPECTION_COMPLETED', 'No inspected occupancy application on this file awaits review.'),
  [GUARDS.OCCUPANCY_SHORTFALL]: occupancyIn('SHORTFALL', 'No occupancy shortfall on this file awaits an answer.'),
  [GUARDS.OCCUPANCY_RECOMMENDED]: occupancyIn('RECOMMENDED', 'No reviewed occupancy application on this file awaits a decision.'),
  [GUARDS.OCCUPANCY_APPROVED]: occupancyIn('APPROVED', 'No approved occupancy application on this file awaits its certificate.'),

  // ── The action itself ──────────────────────────────────────────────────

  [GUARDS.HAS_REMARKS]: ({ input }) =>
    input.remarks.trim().length > 0 ? ok : no('Remarks are required for this action.'),

  [GUARDS.HAS_ATTACHMENT]: ({ input }) =>
    input.attachments.length > 0 ? ok : no('At least one attachment is required for this action.'),

  /**
   * Informational, and deliberately always true.
   *
   * It exists so a transition CAN be annotated with the SLA question without
   * that annotation ever blocking anybody: passing a due date has no legal
   * effect in this system, and a guard that quietly acquired one would be a
   * significant change of policy made by editing a configuration row.
   * See docs/07-subsystems.md R.1.1.
   */
  [GUARDS.SLA_NOT_OVERDUE]: () => ok,
};

/**
 * Guards that answer "does this action APPLY here?" rather than "is the file
 * ready for it?".
 *
 * The distinction decides what an officer sees. A failing readiness guard is
 * worth showing — "Approve · 3 shortfalls are still open" tells somebody what
 * to do next, and hiding it would leave them wondering whether the system can
 * approve at all. A failing applicability guard is not: a permanently disabled
 * "Close reported shortfall" on every file that has never had one is furniture,
 * and furniture is what teaches people to stop reading the action bar.
 *
 * Declared here, next to the guards themselves, so adding a guard means
 * deciding which kind it is rather than discovering the answer in the UI.
 */
const APPLICABILITY_GUARDS = new Set<string>([
  GUARDS.SHORTFALL_AWAITING_REVIEW,
  GUARDS.REPORTED_SHORTFALL_OPEN,
  GUARDS.SHOW_CAUSE_AWAITING_DECISION,
  GUARDS.SHOW_CAUSE_AWAITING_RESPONSE,
  GUARDS.SHOW_CAUSE_RESPONDED,
  GUARDS.SHOW_CAUSE_UNDER_REVIEW,
  GUARDS.REVOCATION_PROPOSED,
  GUARDS.REVOCATION_UNDER_REVIEW,
  GUARDS.PROFESSIONAL_CHANGE_PENDING_VERIFICATION,
  GUARDS.PROFESSIONAL_CHANGE_UNDER_REVIEW,
  GUARDS.PROFESSIONAL_CHANGE_PENDING_DECISION,
]);

export const isApplicabilityGuard = (name: string): boolean => APPLICABILITY_GUARDS.has(name);

export const isKnownGuard = (name: string): boolean => name in REGISTRY;

export const guardNames = (): string[] => Object.keys(REGISTRY).sort();

/**
 * Evaluates one guard by name.
 *
 * An unknown name FAILS rather than passing. A transition referring to a guard
 * the engine does not implement is a configuration error, and the safe reading
 * of "I do not know whether this is allowed" is "no".
 */
export async function evaluateGuard(name: string, ctx: GuardContext): Promise<GuardResult> {
  const guard = REGISTRY[name];
  if (!guard) {
    return no(`This action is configured with an unknown condition (${name}) and cannot be performed.`);
  }
  return guard(ctx);
}

export type GuardEvaluation = { name: string; passed: boolean; message: string };

/** Evaluates every guard on a transition, in order, and reports all of them. */
export async function evaluateGuards(names: string[], ctx: GuardContext): Promise<GuardEvaluation[]> {
  const results: GuardEvaluation[] = [];
  for (const name of names) {
    const { passed, message } = await evaluateGuard(name, ctx);
    results.push({ name, passed, message });
  }
  return results;
}
