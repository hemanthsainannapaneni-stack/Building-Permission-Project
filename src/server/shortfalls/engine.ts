import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import type { AuthUser } from '@/server/auth/context';
import { audit } from '@/server/services/audit';
import { recordEvent, EVENT_TYPES } from '@/server/services/timeline';
import { emit, EVENTS } from '@/server/events/outbox';
import { businessRule, conflict, guardFailed, notFound } from '@/server/http/errors';
import { nextSequence, formatNumber } from '@/server/services/numbering';
import { settingNumber, settingString } from '@/server/services/settings';
import { createShortfallDemand } from '@/server/services/fees';
import {
  ITEM_DECISIONS,
  KIND_META,
  SHORTFALL_ITEM_STATUS,
  SHORTFALL_STATUS,
  canTransition,
  isShortfallOpen,
  statusLabel,
  whyNotTransition,
} from '@/lib/shortfalls';

/**
 * THE SHORTFALL ENGINE.
 *
 * One implementation of everything that can happen to a shortfall, whichever
 * door it came through. A shortfall raised by a workflow transition, answered
 * from the applicant's shortfall page, and decided from an officer's inbox all
 * pass through these functions — so there is one state machine, one counter,
 * one set of notifications and one audit shape.
 *
 * ── Every move is checked against the machine ────────────────────────────
 *
 * `src/lib/shortfalls.ts` holds the legal transitions and this file refuses
 * anything else. That is what stops a double-click, a replayed request or a
 * well-meaning script from resolving a shortfall nobody answered — and it is
 * checked here rather than in a route, because the route is not the only
 * caller.
 *
 * ── What this file deliberately does NOT do ──────────────────────────────
 *
 * It never moves an application. Parking a file at the applicant's stage and
 * bringing it back is the workflow engine's job, and a shortfall that could
 * move a file would be a second router — the thing Phase 6 exists to prevent.
 * `src/server/shortfalls/actions.ts` is the seam: it decides whether a given
 * response also needs the file to move, and asks the workflow engine to do it.
 *
 * ── And it never creates itself from an endpoint ─────────────────────────
 *
 * `raiseShortfall` is called by a workflow EFFECT and by nothing else. Every
 * shortfall in the system is therefore provably attached to a recorded
 * decision by a named officer at a named stage.
 */

export type Meta = { ip: string; userAgent: string; correlationId?: string };
export type Actor = Pick<AuthUser, 'id' | 'name'> & { roleKeys?: string[] };

const DEFAULT_SHORTFALL_FORMAT = '{prefix}/{year}/{seq:5}';

export const SHORTFALL_SELECT = {
  id: true,
  applicationId: true,
  shortfallNumber: true,
  kind: true,
  mode: true,
  status: true,
  raisedAtStageCode: true,
  raisedById: true,
  raisedByRoleKey: true,
  raisedAt: true,
  historyId: true,
  title: true,
  description: true,
  requiredAction: true,
  dueDate: true,
  notifiedAt: true,
  respondedAt: true,
  closedAt: true,
  closedById: true,
  closureRemarks: true,
  items: {
    orderBy: { displayOrder: 'asc' },
    select: {
      id: true,
      documentTypeId: true,
      description: true,
      amount: true,
      isResolved: true,
      resolvedAt: true,
      displayOrder: true,
      category: true,
      requiredAction: true,
      requiredDocument: true,
      remarks: true,
      status: true,
      isMandatory: true,
      documentType: { select: { code: true, name: true } },
      responses: {
        orderBy: { attemptNo: 'asc' },
        select: {
          id: true,
          attemptNo: true,
          resolutionId: true,
          response: true,
          applicantRemarks: true,
          attachments: true,
          respondedAt: true,
          decision: true,
          reviewedAt: true,
          reviewRemarks: true,
          respondedBy: { select: { name: true } },
          reviewedBy: { select: { name: true } },
        },
      },
    },
  },
  resolutions: {
    orderBy: { attemptNo: 'asc' },
    select: {
      id: true,
      attemptNo: true,
      respondedById: true,
      respondedAt: true,
      response: true,
      attachments: true,
      reviewedById: true,
      reviewedAt: true,
      accepted: true,
      reviewRemarks: true,
      respondedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  },
  feeDemands: {
    select: {
      id: true,
      demandNumber: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
      dueDate: true,
    },
  },
} satisfies Prisma.ShortfallSelect;

export type ShortfallRow = Prisma.ShortfallGetPayload<{ select: typeof SHORTFALL_SELECT }>;

// ═══════════════════════════════════════════════════════════════════════════
// The state machine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Moves one shortfall, refusing anything the machine does not allow.
 *
 * The refusal carries the reason in the words of whoever is being refused —
 * "Your response is already with the department" rather than "invalid
 * transition" — because the commonest cause of one is a person pressing a
 * button twice, and they deserve to know which of the two took.
 */
async function move(
  tx: Tx,
  shortfall: { id: string; status: string; shortfallNumber: string },
  to: string,
  // The UNCHECKED variant, which takes foreign keys as plain columns.
  // `updateMany` cannot do a nested `connect`, and the checked type would
  // typecheck one and then fail at runtime — the worst of both.
  data: Prisma.ShortfallUncheckedUpdateManyInput = {}
) {
  if (!canTransition(shortfall.status, to)) {
    const reason = whyNotTransition(shortfall.status, to) ?? 'That is not possible right now.';
    throw conflict(`${shortfall.shortfallNumber}: ${reason}`);
  }

  // The status is in the WHERE as well as the SET: two requests racing to move
  // the same shortfall serialise, and the loser updates nothing and is told.
  const moved = await tx.shortfall.updateMany({
    where: { id: shortfall.id, status: shortfall.status as never },
    data: { ...data, status: to as never },
  });

  if (moved.count === 0) {
    throw conflict(
      `${shortfall.shortfallNumber} has moved on since this screen was loaded. Reload to see where it stands.`
    );
  }
}

/** Keeps `applications.openShortfalls` in step. A cache, never the guard. */
async function adjustCounter(tx: Tx, applicationId: string, delta: number) {
  if (delta === 0) return;
  await tx.application.update({
    where: { id: applicationId },
    data: { openShortfalls: { increment: delta } },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Raising
// ═══════════════════════════════════════════════════════════════════════════

export type RaiseInput = {
  application: {
    id: string;
    applicationNumber: string;
    applicationTypeId: string;
    ltpUserId: string;
  };
  kind: string;
  mode: string;
  stageCode: string;
  actor: Actor;
  title?: string;
  description: string;
  requiredAction?: string;
  dueDate?: Date | null;
  items: Array<{
    description: string;
    amount?: number | null;
    documentTypeId?: string | null;
    category?: string;
    requiredAction?: string;
    requiredDocument?: string;
    remarks?: string;
    isMandatory?: boolean;
  }>;
  /** Raise the additional demand alongside it. FEE shortfalls only. */
  withDemand?: boolean;
  now: Date;
  meta: Meta;
};

export type RaiseResult = {
  id: string;
  shortfallNumber: string;
  kind: string;
  mode: string;
  demand: { id: string; demandNumber: string; totalAmount: string } | null;
};

/**
 * Opens a shortfall. Called by the workflow's RAISE_SHORTFALL effect.
 *
 * It starts at RAISED, not at "open" — nobody has been told yet, and the
 * difference between "recorded" and "communicated" is the one this lifecycle
 * exists to make visible. The dispatcher advances it.
 */
export async function raiseShortfall(tx: Tx, input: RaiseInput): Promise<RaiseResult> {
  const description = input.description.trim();
  if (!description) {
    throw businessRule('A shortfall must say what is wrong. Enter the details and try again.');
  }

  const items = input.items.filter((i) => (i.description ?? '').trim().length > 0);

  if (input.kind === 'FEE' && !items.some((i) => Number(i.amount ?? 0) > 0)) {
    throw businessRule(
      'A fee shortfall must list at least one amount. The applicant is being asked to pay something specific.'
    );
  }

  if (input.kind !== 'CLARIFICATION' && input.kind !== 'OTHER' && !items.length) {
    throw businessRule(
      `A ${KIND_META[input.kind]?.noun ?? 'shortfall'} must list what is required, item by item. ` +
        'An applicant cannot answer "documents are missing".'
    );
  }

  const [format, responseDays] = await Promise.all([
    settingString('shortfall_number_format', DEFAULT_SHORTFALL_FORMAT),
    settingNumber('shortfall_response_days', 0),
  ]);

  const year = input.now.getFullYear();
  const seq = await nextSequence(tx, `shortfall:SF:${year}`);
  const shortfallNumber = formatNumber(format || DEFAULT_SHORTFALL_FORMAT, {
    prefix: 'SF',
    year,
    seq,
  });

  const dueDate =
    input.dueDate ??
    (responseDays > 0 ? new Date(input.now.getTime() + responseDays * 86_400_000) : null);

  const shortfall = await tx.shortfall.create({
    data: {
      applicationId: input.application.id,
      shortfallNumber,
      kind: input.kind as never,
      mode: input.mode as never,
      status: SHORTFALL_STATUS.RAISED as never,
      raisedAtStageCode: input.stageCode,
      raisedById: input.actor.id,
      raisedByRoleKey: input.actor.roleKeys?.[0] ?? '',
      raisedAt: input.now,
      title: (input.title ?? '').trim() || defaultTitle(input.kind),
      description,
      requiredAction: (input.requiredAction ?? '').trim() || (KIND_META[input.kind]?.asks ?? ''),
      dueDate,
      items: {
        create: items.map((item, index) => ({
          documentTypeId: item.documentTypeId ?? null,
          description: item.description.trim(),
          amount: item.amount != null && Number(item.amount) > 0 ? Number(item.amount) : null,
          displayOrder: index,
          category: (item.category ?? '').trim(),
          // Falls back to the letter's instruction rather than to nothing: a
          // line with no action beside it is a line the applicant has to guess
          // at, and the covering instruction is at least true of every line.
          requiredAction:
            (item.requiredAction ?? '').trim() ||
            (input.requiredAction ?? '').trim() ||
            (KIND_META[input.kind]?.asks ?? ''),
          requiredDocument: (item.requiredDocument ?? '').trim(),
          remarks: (item.remarks ?? '').trim(),
          status: SHORTFALL_ITEM_STATUS.PENDING,
          isMandatory: item.isMandatory !== false,
        })),
      },
    },
    select: { id: true, shortfallNumber: true, kind: true, mode: true, title: true },
  });

  await adjustCounter(tx, input.application.id, 1);

  // ── The money, when there is any ────────────────────────────────────────
  let demand: RaiseResult['demand'] = null;

  if (input.withDemand && input.kind === 'FEE') {
    const raised = await createShortfallDemand(tx, {
      application: input.application,
      shortfall,
      items: items
        .filter((i) => Number(i.amount ?? 0) > 0)
        .map((i) => ({ description: i.description.trim(), amount: Number(i.amount) })),
      actor: input.actor,
      now: input.now,
      meta: input.meta,
    });

    demand = {
      id: raised.id,
      demandNumber: raised.demandNumber,
      totalAmount: String(raised.totalAmount),
    };
  }

  await recordEvent(tx, {
    applicationId: input.application.id,
    type: EVENT_TYPES.SHORTFALL_RAISED,
    title:
      input.mode === 'BLOCKING'
        ? `${KIND_META[input.kind]?.noun ?? 'A shortfall'} was raised — the application is with you`
        : `${KIND_META[input.kind]?.noun ?? 'A shortfall'} was recorded and the application moved on`,
    description: description,
    actor: input.actor,
    metadata: {
      shortfallId: shortfall.id,
      shortfallNumber,
      kind: input.kind,
      mode: input.mode,
      requiredAction: shortfall.title,
      items: items.length,
      demandNumber: demand?.demandNumber ?? '',
    },
    occurredAt: input.now,
  });

  await audit(tx, {
    actor: input.actor,
    action: 'SHORTFALL_RAISED',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: input.application.id,
    after: {
      shortfallNumber,
      kind: input.kind,
      mode: input.mode,
      status: SHORTFALL_STATUS.RAISED,
      stageCode: input.stageCode,
      dueDate,
      items: items.map((i) => ({
        description: i.description,
        amount: i.amount ?? null,
        category: i.category ?? '',
        isMandatory: i.isMandatory !== false,
      })),
      demandNumber: demand?.demandNumber ?? null,
    },
    remarks: description,
    ...input.meta,
  });

  // The event the dispatcher acts on. It carries the shortfall id because the
  // dispatcher advances RAISED → NOTIFIED once somebody has actually been told.
  await emit(tx, {
    eventCode: EVENTS.SHORTFALL_RAISED,
    applicationId: input.application.id,
    payload: {
      shortfallId: shortfall.id,
      shortfallNumber,
      applicationNumber: input.application.applicationNumber,
      ltpUserId: input.application.ltpUserId,
      kind: input.kind,
      mode: input.mode,
      title: shortfall.title,
      shortfallReason: description,
      requiredAction: (input.requiredAction ?? '').trim() || (KIND_META[input.kind]?.asks ?? ''),
      dueDate: dueDate?.toISOString() ?? '',
      amount: demand?.totalAmount ?? '',
      demandNumber: demand?.demandNumber ?? '',
      officerName: input.actor.name,
    },
  });

  return {
    id: shortfall.id,
    shortfallNumber,
    kind: shortfall.kind,
    mode: shortfall.mode,
    demand,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Notification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RAISED → NOTIFIED → ACTION_REQUIRED. Called by the dispatcher once a message
 * has actually gone out on at least one channel.
 *
 * Both steps happen here, one after the other, and that is deliberate rather
 * than lazy: the two states are worth keeping apart because a shortfall
 * *stuck* at either one says something different and specific. RAISED means
 * the dispatcher never ran. NOTIFIED means it ran, sent, and then failed
 * before it could hand the file to the applicant. Neither is visible if the
 * lifecycle goes straight from "raised" to "open".
 *
 * Idempotent: a redelivered event finds the shortfall past RAISED and does
 * nothing, so a retried dispatch never rewrites `notifiedAt`.
 */
export async function markNotified(shortfallId: string, at: Date = new Date()): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const shortfall = await tx.shortfall.findUnique({
      where: { id: shortfallId },
      select: { id: true, status: true, shortfallNumber: true, applicationId: true },
    });

    if (!shortfall || shortfall.status !== SHORTFALL_STATUS.RAISED) return false;

    await move(tx, shortfall, SHORTFALL_STATUS.NOTIFIED, { notifiedAt: at });

    await move(
      tx,
      { ...shortfall, status: SHORTFALL_STATUS.NOTIFIED },
      SHORTFALL_STATUS.ACTION_REQUIRED
    );

    await audit(tx, {
      action: 'SHORTFALL_NOTIFIED',
      entityType: 'Shortfall',
      entityId: shortfall.id,
      applicationId: shortfall.applicationId,
      before: { status: SHORTFALL_STATUS.RAISED },
      after: { status: SHORTFALL_STATUS.ACTION_REQUIRED, notifiedAt: at },
      remarks: 'The applicant has been told; the shortfall is now theirs to answer.',
    });

    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Responding
// ═══════════════════════════════════════════════════════════════════════════

/** One line of the applicant's answer, against the item it answers. */
export type ItemResponseInput = {
  itemId: string;
  response: string;
  applicantRemarks?: string;
  attachments?: Array<Record<string, unknown>>;
};

export type RespondInput = {
  shortfallId: string;
  actor: Actor;
  response: string;
  attachments?: Array<Record<string, unknown>>;
  /**
   * Per-item answers. Optional, and that is deliberate: a CLARIFICATION
   * shortfall has no items to answer line by line, and an applicant who writes
   * one covering paragraph against a six-item letter has still responded. The
   * covering `response` is always required; these refine it.
   */
  items?: ItemResponseInput[];
  now?: Date;
  meta: Meta;
};

/**
 * The applicant's answer. Appended as a numbered attempt, never as an edit.
 *
 * A rejected answer followed by a better one leaves both on the record,
 * because "I sent that weeks ago" is a real conversation and the answer to it
 * has to be visible to both sides.
 */
export async function submitResolution(tx: Tx, input: RespondInput) {
  const now = input.now ?? new Date();
  const response = input.response.trim();

  if (!response) {
    throw businessRule('Say what you have done about it. This goes to the officer who asked.');
  }

  const shortfall = await tx.shortfall.findUnique({
    where: { id: input.shortfallId },
    select: {
      id: true,
      status: true,
      shortfallNumber: true,
      applicationId: true,
      kind: true,
      raisedById: true,
      raisedByRoleKey: true,
      raisedAtStageCode: true,
      application: { select: { applicationNumber: true, ltpUserId: true } },
      resolutions: { select: { attemptNo: true } },
      items: { select: { id: true, description: true, status: true, isResolved: true } },
    },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');

  const attemptNo = Math.max(0, ...shortfall.resolutions.map((r) => r.attemptNo)) + 1;

  // Answers are matched to items by id, and an id that is not on this
  // shortfall is refused rather than ignored. Silently dropping it would let a
  // response look complete on screen while one line of it went nowhere.
  const answers = (input.items ?? []).filter((a) => (a.response ?? '').trim().length > 0);
  const known = new Set(shortfall.items.map((i) => i.id));
  const stray = answers.find((a) => !known.has(a.itemId));
  if (stray) {
    throw businessRule(
      `One of the answers is against an item that is not part of ${shortfall.shortfallNumber}. Reload the shortfall and try again.`
    );
  }

  await move(tx, shortfall, SHORTFALL_STATUS.RESOLUTION_SUBMITTED, { respondedAt: now });

  const resolution = await tx.shortfallResolution.create({
    data: {
      shortfallId: shortfall.id,
      attemptNo,
      respondedById: input.actor.id,
      respondedAt: now,
      response,
      attachments: (input.attachments ?? []) as never,
    },
    select: { id: true, attemptNo: true },
  });

  // ── The lines, where the applicant answered line by line ────────────────
  //
  // Appended at this cycle's number, never edited into the previous one. An
  // item answered in cycle 1 and again in cycle 2 ends up with two rows, which
  // is what makes the second answer legible AS a second answer.
  for (const answer of answers) {
    await tx.shortfallItemResponse.create({
      data: {
        itemId: answer.itemId,
        attemptNo,
        resolutionId: resolution.id,
        respondedById: input.actor.id,
        respondedAt: now,
        response: answer.response.trim(),
        applicantRemarks: (answer.applicantRemarks ?? '').trim(),
        attachments: (answer.attachments ?? []) as never,
      },
    });
  }

  if (answers.length) {
    // An item that is already settled stays settled — a later response against
    // an accepted line is recorded, but it does not reopen the officer's
    // decision.
    await tx.shortfallItem.updateMany({
      where: {
        id: { in: answers.map((a) => a.itemId) },
        isResolved: false,
        status: { in: [SHORTFALL_ITEM_STATUS.PENDING, SHORTFALL_ITEM_STATUS.REJECTED] },
      },
      data: { status: SHORTFALL_ITEM_STATUS.RESPONDED },
    });
  }

  await recordEvent(tx, {
    applicationId: shortfall.applicationId,
    type: EVENT_TYPES.SHORTFALL_RESPONDED,
    title:
      attemptNo === 1
        ? 'A response to the shortfall was submitted'
        : `A further response to the shortfall was submitted (attempt ${attemptNo})`,
    description: response,
    actor: input.actor,
    metadata: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      attemptNo,
      attachments: (input.attachments ?? []).length,
      itemsAnswered: answers.length,
    },
    occurredAt: now,
  });

  await audit(tx, {
    actor: input.actor,
    action: 'SHORTFALL_RESPONDED',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: shortfall.applicationId,
    before: { status: shortfall.status },
    after: {
      status: SHORTFALL_STATUS.RESOLUTION_SUBMITTED,
      attemptNo,
      resolutionId: resolution.id,
      itemsAnswered: answers.map((a) => a.itemId),
    },
    remarks: response,
    ...input.meta,
  });

  await emit(tx, {
    eventCode: EVENTS.SHORTFALL_RESPONDED,
    applicationId: shortfall.applicationId,
    payload: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      applicationNumber: shortfall.application.applicationNumber,
      attemptNo,
      // The officer who asked is the one who needs to know it has been answered.
      raisedById: shortfall.raisedById,
      raisedByRoleKey: shortfall.raisedByRoleKey,
      stageCode: shortfall.raisedAtStageCode,
      remarks: response,
    },
  });

  return {
    shortfallId: shortfall.id,
    attemptNo,
    itemsAnswered: answers.length,
    status: SHORTFALL_STATUS.RESOLUTION_SUBMITTED,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reviewing
// ═══════════════════════════════════════════════════════════════════════════

/** The officer's verdict on one line. */
export type ItemDecisionInput = {
  itemId: string;
  decision: string;
  remarks?: string;
};

export type ReviewInput = {
  shortfallId: string;
  actor: Actor;
  accept: boolean;
  remarks: string;
  /**
   * Per-item verdicts. Optional — an officer who accepts the whole letter has
   * accepted every line in it, and forcing them to tick six boxes to say so
   * would be ceremony. When they ARE supplied they refine the covering
   * decision; they never contradict it, because `accept: true` still settles
   * the shortfall and a settled shortfall has no outstanding lines.
   */
  items?: ItemDecisionInput[];
  now?: Date;
  meta: Meta;
};

/**
 * The officer's verdict.
 *
 * ── A fee shortfall is not settled by a promise ──────────────────────────
 *
 * Accepting one checks the demand it raised is actually PAID, in the ledger,
 * not that the applicant says so. §5 requires the payment to be verified, and
 * an officer accepting an unpaid fee shortfall in good faith — because the
 * applicant sent a screenshot — is precisely the mistake worth making
 * impossible rather than discouraging.
 */
export async function reviewResolution(tx: Tx, input: ReviewInput) {
  const now = input.now ?? new Date();
  const remarks = input.remarks.trim();

  if (!remarks) {
    throw businessRule('Say why, in a sentence. Your decision goes on the record either way.');
  }

  const shortfall = await tx.shortfall.findUnique({
    where: { id: input.shortfallId },
    select: {
      id: true,
      status: true,
      kind: true,
      mode: true,
      shortfallNumber: true,
      applicationId: true,
      application: { select: { applicationNumber: true, ltpUserId: true } },
      resolutions: { select: { id: true, attemptNo: true, reviewedAt: true } },
      items: { select: { id: true, isResolved: true, status: true } },
      feeDemands: {
        select: { demandNumber: true, status: true, totalAmount: true, paidAmount: true },
      },
    },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');

  if (input.accept) assertFeeSettled(shortfall);

  const decisions = (input.items ?? []).filter((d) => d.decision);
  const knownItems = new Set(shortfall.items.map((i) => i.id));
  const strayDecision = decisions.find((d) => !knownItems.has(d.itemId));
  if (strayDecision) {
    throw businessRule(
      `One of the decisions is against an item that is not part of ${shortfall.shortfallNumber}. Reload the shortfall and try again.`
    );
  }

  const badDecision = decisions.find(
    (d) => d.decision !== ITEM_DECISIONS.ACCEPTED && d.decision !== ITEM_DECISIONS.REJECTED
  );
  if (badDecision) {
    throw businessRule(`"${badDecision.decision}" is not a decision. Accept the item or reject it.`);
  }

  const to = input.accept ? SHORTFALL_STATUS.RESOLVED : SHORTFALL_STATUS.RESOLUTION_REJECTED;

  await move(tx, shortfall, to, {
    ...(input.accept
      ? { closedAt: now, closedById: input.actor.id, closureRemarks: remarks }
      : { respondedAt: null }),
  });

  // Every attempt that has not been judged is judged now. There is normally
  // exactly one; more would mean two responses arrived before anybody looked.
  const pending = shortfall.resolutions.filter((r) => !r.reviewedAt).map((r) => r.id);
  if (pending.length) {
    await tx.shortfallResolution.updateMany({
      where: { id: { in: pending } },
      data: {
        reviewedById: input.actor.id,
        reviewedAt: now,
        accepted: input.accept,
        reviewRemarks: remarks,
      },
    });
  }

  await applyItemDecisions(tx, {
    shortfallId: shortfall.id,
    decisions,
    actor: input.actor,
    fallbackRemarks: remarks,
    now,
  });

  if (input.accept) {
    // Accepting the letter settles every line in it, including any the officer
    // did not tick individually. The shortfall is the unit of decision; the
    // item verdicts recorded above say HOW it was reached.
    await tx.shortfallItem.updateMany({
      where: { shortfallId: shortfall.id },
      data: { isResolved: true, resolvedAt: now, status: SHORTFALL_ITEM_STATUS.ACCEPTED },
    });
    await adjustCounter(tx, shortfall.applicationId, -1);
  }

  await recordEvent(tx, {
    applicationId: shortfall.applicationId,
    type: input.accept ? EVENT_TYPES.SHORTFALL_RESOLVED : EVENT_TYPES.SHORTFALL_RESPONDED,
    title: input.accept
      ? 'The shortfall response was accepted'
      : 'The shortfall response was not accepted',
    description: remarks,
    actor: input.actor,
    metadata: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      accepted: input.accept,
    },
    occurredAt: now,
  });

  await audit(tx, {
    actor: input.actor,
    action: input.accept ? 'SHORTFALL_RESOLVED' : 'SHORTFALL_RESOLUTION_REJECTED',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: shortfall.applicationId,
    before: { status: shortfall.status },
    after: {
      status: to,
      accepted: input.accept,
      itemDecisions: decisions.map((d) => ({ itemId: d.itemId, decision: d.decision })),
    },
    remarks,
    ...input.meta,
  });

  await emit(tx, {
    eventCode: input.accept ? EVENTS.SHORTFALL_RESOLVED : EVENTS.SHORTFALL_REJECTED,
    applicationId: shortfall.applicationId,
    payload: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      applicationNumber: shortfall.application.applicationNumber,
      ltpUserId: shortfall.application.ltpUserId,
      officerName: input.actor.name,
      remarks,
    },
  });

  return { shortfallId: shortfall.id, status: to };
}

/**
 * Settles a shortfall directly, with no response attempt to review.
 *
 * This is how a REPORTED shortfall closes. It never parked the file, so there
 * is nothing for the applicant to "resubmit" — they pay the demand or supply
 * the document, and whichever officer is holding the file records that the
 * matter is settled.
 *
 * It refuses a BLOCKING shortfall that nobody has answered, and that refusal
 * is the point: a blocking shortfall exists precisely to make the applicant
 * respond, and an officer who wants one gone without a response wants to
 * WITHDRAW it — which `cancelShortfall` does, and says so on the record.
 */
export async function settleShortfall(
  tx: Tx,
  input: { shortfallId: string; actor: Actor; remarks: string; now?: Date; meta: Meta }
) {
  const now = input.now ?? new Date();
  const remarks = input.remarks.trim();

  if (!remarks) {
    throw businessRule('Say what settled it — the payment received, or the document supplied.');
  }

  const shortfall = await tx.shortfall.findUnique({
    where: { id: input.shortfallId },
    select: {
      id: true,
      status: true,
      kind: true,
      mode: true,
      shortfallNumber: true,
      applicationId: true,
      application: { select: { applicationNumber: true, ltpUserId: true } },
      resolutions: { select: { id: true, reviewedAt: true } },
      feeDemands: {
        select: { demandNumber: true, status: true, totalAmount: true, paidAmount: true },
      },
    },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');

  if (shortfall.mode === 'BLOCKING' && !shortfall.resolutions.length) {
    throw guardFailed(
      `${shortfall.shortfallNumber} is blocking and has not been answered. ` +
        'Withdraw it if it was raised in error — settling it would record a response that never came.'
    );
  }

  assertFeeSettled(shortfall);

  await move(tx, shortfall, SHORTFALL_STATUS.RESOLVED, {
    closedAt: now,
    closedById: input.actor.id,
    closureRemarks: remarks,
  });

  const pending = shortfall.resolutions.filter((r) => !r.reviewedAt).map((r) => r.id);
  if (pending.length) {
    await tx.shortfallResolution.updateMany({
      where: { id: { in: pending } },
      data: { reviewedById: input.actor.id, reviewedAt: now, accepted: true, reviewRemarks: remarks },
    });
  }

  await tx.shortfallItem.updateMany({
    where: { shortfallId: shortfall.id },
    data: { isResolved: true, resolvedAt: now, status: SHORTFALL_ITEM_STATUS.ACCEPTED },
  });

  await adjustCounter(tx, shortfall.applicationId, -1);

  await recordEvent(tx, {
    applicationId: shortfall.applicationId,
    type: EVENT_TYPES.SHORTFALL_RESOLVED,
    title: 'A shortfall was settled',
    description: remarks,
    actor: input.actor,
    metadata: { shortfallId: shortfall.id, shortfallNumber: shortfall.shortfallNumber },
    occurredAt: now,
  });

  await audit(tx, {
    actor: input.actor,
    action: 'SHORTFALL_RESOLVED',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: shortfall.applicationId,
    before: { status: shortfall.status },
    after: { status: SHORTFALL_STATUS.RESOLVED, settledWithoutResponse: !shortfall.resolutions.length },
    remarks,
    ...input.meta,
  });

  await emit(tx, {
    eventCode: EVENTS.SHORTFALL_RESOLVED,
    applicationId: shortfall.applicationId,
    payload: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      applicationNumber: shortfall.application.applicationNumber,
      ltpUserId: shortfall.application.ltpUserId,
      officerName: input.actor.name,
      remarks,
    },
  });

  return { shortfallId: shortfall.id, status: SHORTFALL_STATUS.RESOLVED };
}

/**
 * Records the officer's verdict on individual lines.
 *
 * Writes the decision onto the LATEST unreviewed response for each item, so
 * the verdict sits beside the answer it judged rather than floating on the
 * item. An item with no response yet — a line the applicant ignored — still
 * takes the status, because "you did not answer this one" is a decision worth
 * recording even though there is nothing to attach it to.
 *
 * An ACCEPTED line sets `isResolved`, which is the column the approval guard
 * reads. A REJECTED one clears it, so a line sent back cannot leave a file
 * approvable on the strength of a verdict that went the other way.
 */
async function applyItemDecisions(
  tx: Tx,
  input: {
    shortfallId: string;
    decisions: Array<{ itemId: string; decision: string; remarks?: string }>;
    actor: Actor;
    fallbackRemarks: string;
    now: Date;
  }
) {
  if (!input.decisions.length) return;

  for (const decision of input.decisions) {
    const accepted = decision.decision === ITEM_DECISIONS.ACCEPTED;
    const reviewRemarks = (decision.remarks ?? '').trim() || input.fallbackRemarks;

    const latest = await tx.shortfallItemResponse.findFirst({
      where: { itemId: decision.itemId, reviewedAt: null },
      orderBy: { attemptNo: 'desc' },
      select: { id: true },
    });

    if (latest) {
      await tx.shortfallItemResponse.update({
        where: { id: latest.id },
        data: {
          reviewedById: input.actor.id,
          reviewedAt: input.now,
          decision: decision.decision,
          reviewRemarks,
        },
      });
    }

    await tx.shortfallItem.update({
      where: { id: decision.itemId },
      data: {
        status: accepted ? SHORTFALL_ITEM_STATUS.ACCEPTED : SHORTFALL_ITEM_STATUS.REJECTED,
        isResolved: accepted,
        resolvedAt: accepted ? input.now : null,
        remarks: reviewRemarks,
      },
    });
  }
}

/**
 * A FEE shortfall may only be accepted once the money is in.
 *
 * Reads the ledger, not the applicant's word and not the officer's. A demand
 * that was cancelled or waived is not outstanding — somebody with the
 * authority to do that has already decided — so only ISSUED and PARTIALLY_PAID
 * block.
 */
function assertFeeSettled(shortfall: {
  kind: string;
  shortfallNumber: string;
  feeDemands: Array<{ demandNumber: string; status: string; totalAmount: unknown; paidAmount: unknown }>;
}) {
  if (shortfall.kind !== 'FEE') return;

  const unpaid = shortfall.feeDemands.filter((d) =>
    ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'].includes(d.status)
  );

  if (!unpaid.length) return;

  const numbers = unpaid.map((d) => d.demandNumber).join(', ');
  throw guardFailed(
    `${shortfall.shortfallNumber} cannot be settled: ${numbers} ${unpaid.length === 1 ? 'has' : 'have'} not been paid. ` +
      'The payment has to be confirmed against the demand before the shortfall can be closed.',
    [{ path: 'fee', message: `${numbers} outstanding` }]
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cancelling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Withdraws a shortfall that should not have been raised.
 *
 * Distinct from resolving one: nothing was supplied and nothing was checked,
 * and the record says so. It is the only way out of a shortfall raised in
 * error, because a shortfall is never deleted.
 */
export async function cancelShortfall(
  tx: Tx,
  input: { shortfallId: string; actor: Actor; reason: string; now?: Date; meta: Meta }
) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();

  if (!reason) throw businessRule('Say why this shortfall is being withdrawn.');

  const shortfall = await tx.shortfall.findUnique({
    where: { id: input.shortfallId },
    select: {
      id: true,
      status: true,
      shortfallNumber: true,
      applicationId: true,
      application: { select: { applicationNumber: true, ltpUserId: true } },
    },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');
  const wasOpen = isShortfallOpen(shortfall.status);

  await move(tx, shortfall, SHORTFALL_STATUS.CANCELLED, {
    closedAt: now,
    closedById: input.actor.id,
    closureRemarks: reason,
  });

  if (wasOpen) await adjustCounter(tx, shortfall.applicationId, -1);

  await recordEvent(tx, {
    applicationId: shortfall.applicationId,
    type: EVENT_TYPES.SHORTFALL_RESOLVED,
    title: 'A shortfall was withdrawn',
    description: reason,
    actor: input.actor,
    metadata: { shortfallId: shortfall.id, shortfallNumber: shortfall.shortfallNumber },
    occurredAt: now,
  });

  await audit(tx, {
    actor: input.actor,
    action: 'SHORTFALL_CANCELLED',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: shortfall.applicationId,
    before: { status: shortfall.status },
    after: { status: SHORTFALL_STATUS.CANCELLED },
    remarks: reason,
    ...input.meta,
  });

  await emit(tx, {
    eventCode: EVENTS.SHORTFALL_RESOLVED,
    applicationId: shortfall.applicationId,
    payload: {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      applicationNumber: shortfall.application.applicationNumber,
      ltpUserId: shortfall.application.ltpUserId,
      officerName: input.actor.name,
      remarks: reason,
      withdrawn: true,
    },
  });

  return { shortfallId: shortfall.id, status: SHORTFALL_STATUS.CANCELLED };
}

/** Marks an answered shortfall as being looked at. Optional, and reversible. */
export async function beginReview(tx: Tx, shortfallId: string, actor: Actor) {
  const shortfall = await tx.shortfall.findUnique({
    where: { id: shortfallId },
    select: { id: true, status: true, shortfallNumber: true, applicationId: true },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');
  if (shortfall.status === SHORTFALL_STATUS.UNDER_REVIEW) return;

  await move(tx, shortfall, SHORTFALL_STATUS.UNDER_REVIEW);

  await audit(tx, {
    actor,
    action: 'SHORTFALL_UNDER_REVIEW',
    entityType: 'Shortfall',
    entityId: shortfall.id,
    applicationId: shortfall.applicationId,
    before: { status: shortfall.status },
    after: { status: SHORTFALL_STATUS.UNDER_REVIEW },
  });
}

function defaultTitle(kind: string): string {
  switch (kind) {
    case 'FEE':
      return 'Additional fee payable';
    case 'TECHNICAL':
      return 'Drawing correction required';
    case 'CLARIFICATION':
      return 'Clarification required';
    case 'OTHER':
      return 'Further information required';
    default:
      return 'Documents required';
  }
}

export { statusLabel };
