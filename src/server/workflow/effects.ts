import 'server-only';
import type { Tx } from '@/server/db/prisma';
import type { AuthUser } from '@/server/auth/context';
import { businessRule, guardFailed } from '@/server/http/errors';
import { enqueue, JOB_TYPES } from '@/server/jobs/queue';
import {
  raiseShortfall,
  reviewResolution,
  settleShortfall,
  submitResolution,
} from '@/server/shortfalls/engine';
import { EFFECTS, type EffectSpec } from '@/lib/workflow';
import { CLOSED_SHORTFALL_STATUSES } from '@/lib/constants';
import { SHORTFALL_STATUS } from '@/lib/shortfalls';
import {
  decideRevocation,
  decideShowCause,
  issueShowCause,
  respondToShowCause,
  reviewShowCause,
  proposeRevocation,
  reviewRevocation,
  type ProceedingCtx,
} from '@/server/proceedings/engine';
import {
  decideProfessionalChange,
  requestProfessionalChange,
  reviewProfessionalChange,
  verifyProfessionalChange,
  type ProfessionalChangeCtx,
} from '@/server/professional-change/engine';
import { notifyWorkCommencement } from '@/server/commencement/engine';
import {
  decideOccupancy,
  issueOccupancyCertificate,
  raiseOccupancyShortfall,
  recommendOccupancy,
  recordFinalInspection,
  respondToOccupancyShortfall,
  scheduleFinalInspection,
  submitOccupancy,
} from '@/server/occupancy/engine';

/**
 * The effect registry — what a transition DOES, beyond moving the file.
 *
 * Effects run in the order the transition lists them, inside the transition's
 * transaction, after every guard has passed. One throwing abandons the whole
 * transition: no shortfall, no demand, no history row, no moved file.
 *
 * ── Effects may change where the file goes ───────────────────────────────
 *
 * `RETURN_TO_ORIGIN` is the reason this is not a list of side-effects but a
 * pipeline with a mutable destination. A transition out of the shortfall stage
 * cannot name its destination in configuration, because the destination is
 * wherever the file was parked — which is different for every application. The
 * effect writes `ctx.toStageId`, and the engine routes to whatever the effects
 * left there.
 *
 * That single mechanism is what keeps "return to the LTP, then back to
 * whoever raised it" out of the code. There is no map of raising stage to
 * resume stage anywhere in this repository; there is one nullable column,
 * `workflow_instances.parkedStageId`, and one effect that reads it.
 */

export type EffectContext = {
  tx: Tx;
  actor: Pick<AuthUser, 'id' | 'name'> & { roleKeys?: string[] };
  now: Date;
  meta: { ip: string; userAgent: string; correlationId?: string };

  application: {
    id: string;
    applicationNumber: string;
    applicationTypeId: string;
    status: string;
    zoneId: string | null;
    ltpUserId: string;
  };

  instance: { id: string; currentStageId: string | null; parkedStageId: string | null };

  /** The stage the file is leaving. */
  fromStage: { id: string; code: string; name: string };

  /** What the actor supplied. */
  input: {
    remarks: string;
    attachments: Array<Record<string, unknown>>;
    shortfall?: {
      title?: string;
      description?: string;
      /** What the applicant must DO. Goes in the SMS. */
      requiredAction?: string;
      dueDate?: string | null;
      items?: Array<{
        description: string;
        amount?: number | null;
        documentTypeId?: string | null;
        category?: string;
        requiredAction?: string;
        requiredDocument?: string;
        remarks?: string;
        isMandatory?: boolean;
      }>;
    };
    shortfallId?: string;
    /** Per-item answers, when this transition records a response. */
    shortfallItems?: Array<{
      itemId: string;
      response: string;
      applicantRemarks?: string;
      attachments?: Array<Record<string, unknown>>;
    }>;
    /** Per-item verdicts, when this transition decides one. */
    shortfallDecisions?: Array<{ itemId: string; decision: string; remarks?: string }>;
    /**
     * The particulars of a show cause notice or revocation, supplied by the
     * proceedings services. Shape per effect step: src/server/proceedings/engine.ts.
     */
    proceeding?: Record<string, unknown>;
  };

  /** The history sequence this transition will be recorded as. */
  sequence: number;
  /** The role the actor is acting in for this transition. */
  actingRoleKey: string;

  // ── Mutable outputs, read by the engine once every effect has run ──────
  toStageId: string | null;
  toStatus: string;
  parkedStageId: string | null;
  /** Overrides the transition's own slaBehavior when an effect must. */
  slaBehaviour: string | null;
  /** What happened, recorded verbatim on the history row. */
  applied: Array<Record<string, unknown>>;
  /** Shortfalls opened by this transition, linked to the history row after. */
  raisedShortfallIds: string[];
  /** Set by CLOSE_WORKFLOW. */
  closeAs: 'COMPLETED' | 'CANCELLED' | null;
};

export type Effect = (ctx: EffectContext, spec: EffectSpec) => Promise<void>;

const REGISTRY: Record<string, Effect> = {
  // ── RAISE_SHORTFALL ────────────────────────────────────────────────────
  //
  // The one code path that can create a shortfall. Raising one is an effect of
  // a transition and nothing else — there is no "create shortfall" endpoint,
  // which is what makes every shortfall in the system provably attached to a
  // recorded decision by a named officer at a named stage.
  //
  // The work itself belongs to the shortfall engine: numbering, the state
  // machine, the counter, the demand, the timeline, the audit row and the
  // notification are ONE implementation, whichever door a shortfall came
  // through. What stays here is the only part that is about the WORKFLOW —
  // that a blocking shortfall parks the file at this stage.

  [EFFECTS.RAISE_SHORTFALL]: async (ctx, spec) => {
    const kind = String(spec.kind ?? 'DOCUMENT');
    const mode = String(spec.mode ?? 'BLOCKING');

    const raised = await raiseShortfall(ctx.tx, {
      application: ctx.application,
      kind,
      mode,
      stageCode: ctx.fromStage.code,
      actor: ctx.actor,
      title: ctx.input.shortfall?.title,
      description: (ctx.input.shortfall?.description ?? ctx.input.remarks).trim(),
      requiredAction: ctx.input.shortfall?.requiredAction,
      dueDate: ctx.input.shortfall?.dueDate ? new Date(ctx.input.shortfall.dueDate) : null,
      items: ctx.input.shortfall?.items ?? [],
      // A fee shortfall raises its demand in the same statement. Splitting the
      // two allowed a shortfall demanding money with no demand behind it.
      withDemand: kind === 'FEE',
      now: ctx.now,
      meta: ctx.meta,
    });

    ctx.raisedShortfallIds.push(raised.id);

    // BLOCKING parks the file. The stage it is parked AT is where it resumes,
    // and it is recorded here rather than derived later — by the time the
    // applicant answers, days have passed and the officer who raised it may
    // have been reassigned.
    if (mode === 'BLOCKING') {
      ctx.parkedStageId = ctx.fromStage.id;
    }

    ctx.applied.push({
      type: EFFECTS.RAISE_SHORTFALL,
      kind,
      mode,
      shortfallId: raised.id,
      shortfallNumber: raised.shortfallNumber,
      items: (ctx.input.shortfall?.items ?? []).length,
      ...(raised.demand
        ? { demandNumber: raised.demand.demandNumber, total: raised.demand.totalAmount }
        : {}),
    });
  },

  // ── GENERATE_FEE_DEMAND ────────────────────────────────────────────────
  //
  // Kept as a named effect because the seed and the documentation both refer
  // to it, but the demand is now raised INSIDE `raiseShortfall`. Two effects
  // meant two moments at which a fee shortfall could exist without a demand
  // behind it, and the second was reachable: any transition that listed
  // RAISE_SHORTFALL and forgot this one produced a shortfall demanding money
  // that nobody could pay.
  //
  // So it verifies rather than acts, and fails loudly if the invariant it is
  // checking has been broken by configuration.

  [EFFECTS.GENERATE_FEE_DEMAND]: async (ctx, spec) => {
    const type = String(spec.demandType ?? 'SHORTFALL');

    if (type !== 'SHORTFALL') {
      // ORIGINAL demands are raised by the fee engine at the documents gate,
      // where the schedule decides every figure. A transition asking for one
      // would be configuration reaching into a calculation it cannot see.
      throw businessRule(`The workflow can only raise SHORTFALL demands, not ${type}.`);
    }

    const shortfallId = ctx.raisedShortfallIds.at(-1);
    if (!shortfallId) {
      throw businessRule('A fee demand can only be raised alongside the shortfall that justifies it.');
    }

    const demand = await ctx.tx.applicationFee.findFirst({
      where: { raisedByShortfallId: shortfallId },
      select: { id: true, demandNumber: true, totalAmount: true },
    });

    if (!demand) {
      throw businessRule(
        'This action is configured to raise a fee demand, but the shortfall it raised was not a fee ' +
          'shortfall. An administrator must correct the workflow.'
      );
    }

    ctx.applied.push({
      type: EFFECTS.GENERATE_FEE_DEMAND,
      demandType: type,
      applicationFeeId: demand.id,
      demandNumber: demand.demandNumber,
      total: demand.totalAmount.toFixed(2),
    });
  },

  // ── RECORD_RESOLUTION ──────────────────────────────────────────────────

  [EFFECTS.RECORD_RESOLUTION]: async (ctx) => {
    const targets = await targetShortfalls(ctx, { mode: 'BLOCKING' });

    if (!targets.length) {
      throw guardFailed('There is no open shortfall on this application to respond to.');
    }

    for (const target of targets) {
      await submitResolution(ctx.tx, {
        shortfallId: target.id,
        actor: ctx.actor,
        response: ctx.input.remarks,
        attachments: ctx.input.attachments,
        // Only the lines belonging to THIS shortfall. A file answering two at
        // once must not have one letter's answers written against the other,
        // and the engine refuses an unknown item id rather than dropping it.
        items: (ctx.input.shortfallItems ?? []).filter((item) =>
          target.itemIds.includes(item.itemId)
        ),
        now: ctx.now,
        meta: ctx.meta,
      });
    }

    ctx.applied.push({
      type: EFFECTS.RECORD_RESOLUTION,
      shortfalls: targets.map((t) => t.shortfallNumber),
      attachments: ctx.input.attachments.length,
      itemsAnswered: (ctx.input.shortfallItems ?? []).length,
    });
  },

  // ── RESOLVE_SHORTFALL ──────────────────────────────────────────────────
  //
  // `mode` in the spec chooses which: BLOCKING (the default) for the parked
  // file whose answer an officer has just accepted, REPORTED for one that
  // travelled here with the file, ANY for both. An explicit `shortfallId` from
  // the actor beats all of it, which is how a file carrying several is settled
  // one at a time.

  [EFFECTS.RESOLVE_SHORTFALL]: async (ctx, spec) => {
    const targets = await targetShortfalls(ctx, { mode: String(spec.mode ?? 'BLOCKING') });

    if (!targets.length) throw guardFailed('There is no open shortfall to close.');

    for (const target of targets) {
      // A response awaiting a verdict is ACCEPTED; a shortfall with none is
      // SETTLED. The two are different acts and the record says which — the
      // difference is whether an applicant answered, and reading it from the
      // data means one effect covers the blocking and reported cases without
      // the configuration having to say which it is.
      const answered = await ctx.tx.shortfallResolution.count({
        where: { shortfallId: target.id, reviewedAt: null },
      });

      if (answered > 0) {
        await reviewResolution(ctx.tx, {
          shortfallId: target.id,
          actor: ctx.actor,
          accept: true,
          remarks: ctx.input.remarks,
          items: (ctx.input.shortfallDecisions ?? []).filter((d) =>
            target.itemIds.includes(d.itemId)
          ),
          now: ctx.now,
          meta: ctx.meta,
        });
      } else {
        await settleShortfall(ctx.tx, {
          shortfallId: target.id,
          actor: ctx.actor,
          remarks: ctx.input.remarks,
          now: ctx.now,
          meta: ctx.meta,
        });
      }
    }

    ctx.applied.push({
      type: EFFECTS.RESOLVE_SHORTFALL,
      shortfalls: targets.map((t) => t.shortfallNumber),
    });
  },

  // ── REJECT_RESOLUTION ──────────────────────────────────────────────────
  //
  // The answer was not good enough. The shortfall STAYS OPEN and the file goes
  // back to the applicant — both attempts remain on the record.

  [EFFECTS.REJECT_RESOLUTION]: async (ctx) => {
    const targets = await targetShortfalls(ctx, { mode: 'ANY', answeredOnly: true });

    if (!targets.length) throw guardFailed('There is no response awaiting a decision.');

    for (const target of targets) {
      await reviewResolution(ctx.tx, {
        shortfallId: target.id,
        actor: ctx.actor,
        accept: false,
        remarks: ctx.input.remarks,
        // The lines that were and were not accepted. On a rejection these are
        // the whole point: the applicant has to know WHICH item to fix, and a
        // letter that comes back saying only "not accepted" sends them back
        // over all six.
        items: (ctx.input.shortfallDecisions ?? []).filter((d) =>
          target.itemIds.includes(d.itemId)
        ),
        now: ctx.now,
        meta: ctx.meta,
      });
    }

    // The file goes back to the applicant, so it is parked again — at THIS
    // desk, which is the one that will judge the next attempt. Re-parking here
    // rather than in configuration is what makes a second rejection behave
    // exactly like the first.
    ctx.parkedStageId = ctx.fromStage.id;

    ctx.applied.push({
      type: EFFECTS.REJECT_RESOLUTION,
      shortfalls: targets.map((t) => t.shortfallNumber),
    });
  },

  // ── RETURN_TO_ORIGIN ───────────────────────────────────────────────────

  /**
   * Sends the file back to the desk it was parked at.
   *
   * THIS IS WHAT MAKES THE RETURN PATH CONFIGURABLE. There is no map from
   * raising stage to resuming stage anywhere in this repository — there is one
   * nullable column, `workflow_instances.parkedStageId`, written when the
   * shortfall was raised and read here.
   *
   * The STATUS is left to the transition unless the spec asks otherwise, so an
   * answered shortfall can arrive back at the officer's desk reading
   * "Shortfall responded" rather than as though nothing had happened. Passing
   * `status: "WORKING"` or `"ENTRY"` takes the parked stage's own instead.
   */
  [EFFECTS.RETURN_TO_ORIGIN]: async (ctx, spec) => {
    const parked = ctx.instance.parkedStageId;
    if (!parked) {
      throw guardFailed('This application is not parked, so there is nowhere to return it to.');
    }

    const stage = await ctx.tx.workflowStage.findUniqueOrThrow({
      where: { id: parked },
      select: { id: true, code: true, workingStatus: true, entryStatus: true },
    });

    ctx.toStageId = stage.id;

    const status = String(spec.status ?? '');
    if (status === 'WORKING') ctx.toStatus = stage.workingStatus ?? stage.entryStatus;
    else if (status === 'ENTRY') ctx.toStatus = stage.entryStatus;

    ctx.parkedStageId = null;

    ctx.applied.push({ type: EFFECTS.RETURN_TO_ORIGIN, toStageCode: stage.code, toStatus: ctx.toStatus });
  },

  // ── GENERATE_APPROVAL_ORDER ────────────────────────────────────────────

  [EFFECTS.GENERATE_APPROVAL_ORDER]: async (ctx) => {
    // Enqueued rather than rendered inline: the order carries a PDF, and a
    // approval must not fail because a renderer was slow. The row is created
    // by the job, which is idempotent on the application id.
    await enqueue(ctx.tx, {
      type: JOB_TYPES.RENDER_APPROVAL_ORDER,
      payload: { applicationId: ctx.application.id, issuedById: ctx.actor.id },
      dedupeKey: `approval-order:${ctx.application.id}`,
    });

    ctx.applied.push({ type: EFFECTS.GENERATE_APPROVAL_ORDER, queued: true });
  },

  // ── LINK_SITE_INSPECTION ───────────────────────────────────────────────
  //
  // Verifies rather than acts, like GENERATE_FEE_DEMAND. The inspection itself
  // is written by the site inspection service; what belongs to the WORKFLOW is
  // the fact that this transition is the one that moved the file for it. The
  // link is stamped here, inside the same transaction, so an inspection can
  // route a file exactly once — a second transition finds nothing unlinked
  // and fails, rather than moving the file twice on one report.
  //
  // `step` is SCHEDULE (the booking moved the file to the inspection desk) or
  // SUBMIT (the signed report moved it on). A SUBMIT that follows a
  // RAISE_SHORTFALL in the same transition records which shortfall the report
  // raised.

  [EFFECTS.LINK_SITE_INSPECTION]: async (ctx, spec) => {
    const step = String(spec.step ?? '');

    if (step === 'SCHEDULE') {
      const inspection = await ctx.tx.siteInspection.findFirst({
        where: { applicationId: ctx.application.id, status: 'SCHEDULED', scheduleLinkedAt: null },
        orderBy: { round: 'desc' },
        select: { id: true, inspectionNumber: true, inspectorName: true, scheduledFor: true, round: true },
      });

      if (!inspection) {
        throw businessRule('No site inspection has been booked for this application.');
      }

      await ctx.tx.siteInspection.update({
        where: { id: inspection.id },
        data: { scheduleLinkedAt: ctx.now },
      });

      ctx.applied.push({
        type: EFFECTS.LINK_SITE_INSPECTION,
        step,
        inspectionId: inspection.id,
        inspectionNumber: inspection.inspectionNumber,
        round: inspection.round,
        inspectorName: inspection.inspectorName,
        scheduledFor: inspection.scheduledFor.toISOString(),
      });
      return;
    }

    if (step === 'SUBMIT') {
      const inspection = await ctx.tx.siteInspection.findFirst({
        where: { applicationId: ctx.application.id, status: 'SUBMITTED', routedAt: null },
        orderBy: { round: 'desc' },
        select: {
          id: true,
          inspectionNumber: true,
          round: true,
          recommendation: true,
          signatureMethod: true,
          signedByName: true,
          documentHash: true,
        },
      });

      if (!inspection) {
        throw businessRule('There is no signed site inspection report waiting to be submitted.');
      }

      const shortfallId = ctx.raisedShortfallIds.at(-1) ?? null;

      await ctx.tx.siteInspection.update({
        where: { id: inspection.id },
        data: { routedAt: ctx.now, shortfallId },
      });

      ctx.applied.push({
        type: EFFECTS.LINK_SITE_INSPECTION,
        step,
        inspectionId: inspection.id,
        inspectionNumber: inspection.inspectionNumber,
        round: inspection.round,
        recommendation: inspection.recommendation,
        signatureMethod: inspection.signatureMethod,
        signedByName: inspection.signedByName,
        documentHash: inspection.documentHash,
        ...(shortfallId ? { shortfallId } : {}),
      });
      return;
    }

    throw businessRule(`LINK_SITE_INSPECTION is configured with an unknown step (${step}).`);
  },

  // ── SHOW_CAUSE / REVOCATION ────────────────────────────────────────────
  //
  // The one code path that writes a show cause notice or a revocation — the
  // same arrangement as RAISE_SHORTFALL. The work belongs to the proceedings
  // engine; what stays here is translating the transition into its context.
  // Neither effect touches the shortfall tables.

  [EFFECTS.SHOW_CAUSE]: async (ctx, spec) => {
    const step = String(spec.step ?? '');
    const c = proceedingCtx(ctx);
    const payload = ctx.input.proceeding as never;
    if (step === 'ISSUE') {
      const r = await issueShowCause(c, payload);
      ctx.applied.push({ type: EFFECTS.SHOW_CAUSE, step, ...r });
      return;
    }
    if (step === 'RESPOND') {
      ctx.applied.push({ type: EFFECTS.SHOW_CAUSE, step, ...(await respondToShowCause(c, payload)) });
      return;
    }
    if (step === 'REVIEW') {
      ctx.applied.push({ type: EFFECTS.SHOW_CAUSE, step, ...(await reviewShowCause(c, payload)) });
      return;
    }
    if (step === 'DECIDE') {
      const r = await decideShowCause(c, payload);
      ctx.applied.push({ type: EFFECTS.SHOW_CAUSE, step, ...r });
      return;
    }
    throw businessRule(`SHOW_CAUSE is configured with an unknown step (${step}).`);
  },

  [EFFECTS.REVOCATION]: async (ctx, spec) => {
    const step = String(spec.step ?? '');
    const c = proceedingCtx(ctx);
    const payload = ctx.input.proceeding as never;
    if (step === 'PROPOSE') {
      ctx.applied.push({ type: EFFECTS.REVOCATION, step, ...(await proposeRevocation(c, payload)) });
      return;
    }
    if (step === 'REVIEW') {
      ctx.applied.push({ type: EFFECTS.REVOCATION, step, ...(await reviewRevocation(c, payload)) });
      return;
    }
    if (step === 'DECIDE') {
      const outcome = String(spec.outcome ?? '');
      if (outcome !== 'REVOKED' && outcome !== 'REJECTED') {
        throw businessRule(`REVOCATION DECIDE is configured with an unknown outcome (${outcome}).`);
      }
      ctx.applied.push({ type: EFFECTS.REVOCATION, step, ...(await decideRevocation(c, outcome, payload)) });
      return;
    }
    throw businessRule(`REVOCATION is configured with an unknown step (${step}).`);
  },

  // ── PROFESSIONAL_CHANGE ────────────────────────────────────────────────
  //
  // The one code path that writes a change of professional request, and the
  // only one that moves `applications.ltpUserId` after filing.

  [EFFECTS.PROFESSIONAL_CHANGE]: async (ctx, spec) => {
    const step = String(spec.step ?? '');
    const c = professionalChangeCtx(ctx);
    const payload = ctx.input.proceeding as never;
    if (step === 'REQUEST') {
      ctx.applied.push({ type: EFFECTS.PROFESSIONAL_CHANGE, step, ...(await requestProfessionalChange(c, payload)) });
      return;
    }
    if (step === 'VERIFY') {
      ctx.applied.push({ type: EFFECTS.PROFESSIONAL_CHANGE, step, ...(await verifyProfessionalChange(c, payload)) });
      return;
    }
    if (step === 'REVIEW') {
      ctx.applied.push({ type: EFFECTS.PROFESSIONAL_CHANGE, step, ...(await reviewProfessionalChange(c, payload)) });
      return;
    }
    if (step === 'DECIDE') {
      const outcome = String(spec.outcome ?? '');
      if (outcome !== 'APPROVED' && outcome !== 'REJECTED') {
        throw businessRule(`PROFESSIONAL_CHANGE DECIDE is configured with an unknown outcome (${outcome}).`);
      }
      ctx.applied.push({ type: EFFECTS.PROFESSIONAL_CHANGE, step, ...(await decideProfessionalChange(c, outcome, payload)) });
      return;
    }
    throw businessRule(`PROFESSIONAL_CHANGE is configured with an unknown step (${step}).`);
  },

  // ── WORK_COMMENCEMENT ──────────────────────────────────────────────────
  //
  // The one code path that writes a commencement of work notice. The context
  // is the professional change one: same actor, same file facts.

  [EFFECTS.WORK_COMMENCEMENT]: async (ctx) => {
    const r = await notifyWorkCommencement(professionalChangeCtx(ctx), ctx.input.proceeding as never);
    ctx.applied.push({ type: EFFECTS.WORK_COMMENCEMENT, ...r });
  },

  // ── OCCUPANCY ──────────────────────────────────────────────────────────
  //
  // The one code path that writes an occupancy application, its inspection,
  // its decision and its certificate. Same context as the professional change.

  [EFFECTS.OCCUPANCY]: async (ctx, spec) => {
    const step = String(spec.step ?? '');
    const c = professionalChangeCtx(ctx);
    const payload = ctx.input.proceeding as never;
    const run: Record<string, () => Promise<Record<string, unknown>>> = {
      SUBMIT: () => submitOccupancy(c, payload),
      SCHEDULE: () => scheduleFinalInspection(c, payload),
      INSPECT: () => recordFinalInspection(c, payload),
      RECOMMEND: () => recommendOccupancy(c, payload),
      SHORTFALL: () => raiseOccupancyShortfall(c, payload),
      RESPOND: () => respondToOccupancyShortfall(c, payload),
      ISSUE: () => issueOccupancyCertificate(c, payload),
      DECIDE: () => {
        const outcome = String(spec.outcome ?? '');
        if (outcome !== 'APPROVED' && outcome !== 'REJECTED') {
          throw businessRule(`OCCUPANCY DECIDE is configured with an unknown outcome (${outcome}).`);
        }
        return decideOccupancy(c, outcome, payload);
      },
    };
    const fn = run[step];
    if (!fn) throw businessRule(`OCCUPANCY is configured with an unknown step (${step}).`);
    ctx.applied.push({ type: EFFECTS.OCCUPANCY, step, ...(await fn()) });
  },

  // ── KEEP_STATUS ────────────────────────────────────────────────────────

  [EFFECTS.KEEP_STATUS]: async (ctx) => {
    ctx.toStatus = ctx.application.status;
    ctx.applied.push({ type: EFFECTS.KEEP_STATUS, status: ctx.toStatus });
  },

  // ── CLOSE_WORKFLOW ─────────────────────────────────────────────────────

  [EFFECTS.CLOSE_WORKFLOW]: async (ctx, spec) => {
    ctx.closeAs = String(spec.status ?? 'COMPLETED') === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
    ctx.applied.push({ type: EFFECTS.CLOSE_WORKFLOW, status: ctx.closeAs, outcome: spec.status ?? '' });
  },
};

/**
 * Which shortfalls this action is about.
 *
 * An explicit `shortfallId` from the actor always wins — that is how a file
 * carrying three of them is settled one at a time from the shortfall page.
 * Without one, the transition's own `mode` decides, which is what makes
 * ACCEPT_RESOLUTION (blocking) and RESOLVE_REPORTED_SHORTFALL (reported) two
 * configurations of one effect rather than two effects.
 */
async function targetShortfalls(
  ctx: EffectContext,
  options: { mode: string; answeredOnly?: boolean }
): Promise<Array<{ id: string; shortfallNumber: string; itemIds: string[] }>> {
  const rows = await ctx.tx.shortfall.findMany({
    where: {
      applicationId: ctx.application.id,
      status: options.answeredOnly
        ? { in: [SHORTFALL_STATUS.RESOLUTION_SUBMITTED, SHORTFALL_STATUS.UNDER_REVIEW] }
        : { notIn: [...CLOSED_SHORTFALL_STATUSES] },
      ...(ctx.input.shortfallId
        ? { id: ctx.input.shortfallId }
        : options.mode === 'ANY'
          ? {}
          : { mode: options.mode as never }),
    },
    orderBy: { raisedAt: 'asc' },
    // The item ids travel with the target so per-item answers and verdicts can
    // be routed to the shortfall they belong to. A file carrying two open
    // letters must not have one's lines written against the other.
    select: { id: true, shortfallNumber: true, items: { select: { id: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    shortfallNumber: row.shortfallNumber,
    itemIds: row.items.map((item) => item.id),
  }));
}

/**
 * The context the proceedings engine is given. The role recorded is the one
 * the actor ACTED IN — a role they hold that the stage (or the transition)
 * admits — not merely their first, for a multi-role officer.
 */
function proceedingCtx(ctx: EffectContext): ProceedingCtx {
  return {
    tx: ctx.tx,
    actor: ctx.actor,
    roleKey: ctx.actingRoleKey || ctx.actor.roleKeys?.[0] || 'SYSTEM',
    now: ctx.now,
    meta: ctx.meta,
    application: {
      id: ctx.application.id,
      applicationNumber: ctx.application.applicationNumber,
      status: ctx.application.status,
    },
    stageCode: ctx.fromStage.code,
    sequence: ctx.sequence,
    remarks: ctx.input.remarks,
  };
}

function professionalChangeCtx(ctx: EffectContext): ProfessionalChangeCtx {
  return {
    tx: ctx.tx,
    actor: ctx.actor,
    roleKey: ctx.actingRoleKey || ctx.actor.roleKeys?.[0] || 'SYSTEM',
    now: ctx.now,
    meta: ctx.meta,
    application: {
      id: ctx.application.id,
      applicationNumber: ctx.application.applicationNumber,
      status: ctx.application.status,
      ltpUserId: ctx.application.ltpUserId,
    },
    stageCode: ctx.fromStage.code,
    sequence: ctx.sequence,
    remarks: ctx.input.remarks,
  };
}

export const isKnownEffect = (type: string): boolean => type in REGISTRY;

export const effectNames = (): string[] => Object.keys(REGISTRY).sort();

/**
 * Runs a transition's effects in order.
 *
 * An unknown effect type THROWS. The alternative — skipping it — would let a
 * transition configured to raise a shortfall quietly move the file without
 * raising one, and nothing downstream would notice.
 */
export async function applyEffects(ctx: EffectContext, specs: EffectSpec[]): Promise<void> {
  for (const spec of specs) {
    const effect = REGISTRY[String(spec.type)];
    if (!effect) {
      throw businessRule(
        `This action is configured with an unknown effect (${spec.type}) and cannot be performed. ` +
          'An administrator must correct the workflow.'
      );
    }
    await effect(ctx, spec);
  }
}
