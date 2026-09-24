import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isLtp, type AuthUser } from '@/server/auth/context';
import { badRequest, forbidden, notFound } from '@/server/http/errors';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES } from '@/lib/constants';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import {
  CHECKLIST_STATUS,
  canApplicantAnswer,
  canReviewerVerify,
  checklistProgress,
  deriveRiskCategory,
  isValidResponse,
} from '@/lib/checklist';
import type { ReviewChecklistInput, SaveChecklistInput } from '@/lib/schemas/checklists';
import { audit } from './audit';
import { recordEvent, EVENT_TYPES } from './timeline';

type Meta = { ip?: string; userAgent?: string; correlationId?: string };
type Tx = Prisma.TransactionClient;

/**
 * Sized for a whole checklist rather than a single row.
 *
 * Prisma's defaults (5 s timeout, 2 s maxWait) assume a transaction writes one
 * or two rows. A checklist save writes up to nineteen, then recomputes the
 * risk category, appends a timeline event and takes the audit chain's advisory
 * lock — and over a pooled connection to a remote database that is comfortably
 * more than five seconds. It failed exactly there the first time the demo
 * enrichment ran it at full width.
 */
const TRANSACTION_LIMITS = { timeout: 30_000, maxWait: 10_000 } as const;

/**
 * THE APPLICATION CHECKLIST — nineteen questions, three kinds of reader.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORDING IS PROVISIONAL AND THIS FILE DOES NOT DEPEND ON IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Not one sentence of any question appears in this file, or anywhere in the
 * application code. The nineteen questions are ROWS in
 * `checklist_item_definitions`, seeded as PROVISIONAL DEMO WORDING because the
 * BBAS manuals supplied for this project describe the checklist and its
 * subject areas without reproducing its questions as text. Replacing them with
 * the official text is a typing job in Settings → Checklists. Nothing here
 * changes, and no migration runs.
 *
 * ── The three readers ────────────────────────────────────────────────────
 *
 *  · The LTP ANSWERS. `saveResponses` writes `response` and nothing else.
 *  · A departmental desk VERIFIES. `reviewChecklist` writes `status`,
 *    `reviewerResponse` and `reviewerRemarks`, and CANNOT write `response`.
 *  · Everyone above reads the history, which nobody can write over.
 *
 * ── Why a later reviewer cannot erase an earlier one ─────────────────────
 *
 * Because the history is a different table with no update path. Every act
 * APPENDS to `checklist_review_entries` and then updates the summary row that
 * exists for cheap reads. A ZDD who disagrees with the TPA produces a second
 * entry; the first is still there, with the TPA's name, their desk and their
 * remark, and the screen shows both in order.
 *
 * This is the same shape as `workflow_history` and `audit_logs`, and it is
 * deliberate: the requirement is not "reviewers should be careful", it is that
 * erasure must be IMPOSSIBLE, and the only way to mean that is to give the
 * code no way to express it.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

type ScopedApplication = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  ltpUserId: string;
  riskCategory: string;
};

/**
 * Loads an application the caller may see, or 404s.
 *
 * `applicationScope(user)` is merged INTO the query, so an id belonging to
 * somebody else's file is indistinguishable from one that does not exist —
 * the same rule, and the same reasoning, as every other application service.
 */
async function requireApplication(user: AuthUser, id: string): Promise<ScopedApplication> {
  if (!isUuid(id)) throw notFound('That application could not be found.');

  const app = await prisma.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      currentStageCode: true,
      ltpUserId: true,
      riskCategory: true,
    },
  });

  if (!app) throw notFound('That application could not be found.');
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Read
// ═══════════════════════════════════════════════════════════════════════════

const DEFINITION_SELECT = {
  id: true,
  kind: true,
  itemNumber: true,
  question: true,
  description: true,
  responseType: true,
  category: true,
  helpText: true,
  isMandatory: true,
  requiresDocument: true,
  affectsRisk: true,
  displayOrder: true,
  isProvisional: true,
  source: true,
} as const;

/**
 * The whole checklist for one application.
 *
 * Built by joining the ACTIVE definitions to whatever answers exist, rather
 * than by reading answer rows. That ordering is what makes the checklist
 * configurable in practice: a question activated in Settings this morning
 * appears on every live file this afternoon, as PENDING, with no backfill —
 * and a question deactivated stops being asked without deleting the answers
 * already given to it.
 */
export async function getApplicationChecklist(
  user: AuthUser,
  applicationId: string,
  kind = 'APPLICATION'
) {
  const app = await requireApplication(user, applicationId);

  const [definitions, responses, history, documents] = await Promise.all([
    prisma.checklistItemDefinition.findMany({
      where: { kind, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { itemNumber: 'asc' }],
      select: DEFINITION_SELECT,
    }),
    prisma.applicationChecklistResponse.findMany({
      where: { applicationId: app.id, kind },
    }),
    prisma.checklistReviewEntry.findMany({
      where: { applicationId: app.id },
      orderBy: { recordedAt: 'asc' },
    }),
    // What the applicant can offer in support. Only documents that have
    // actually been uploaded: a requirement nobody has met yet is not a
    // document, and offering it in the picker would let an answer cite
    // something that does not exist.
    prisma.applicationDocument.findMany({
      where: { applicationId: app.id, status: { not: 'NOT_UPLOADED' } },
      orderBy: { documentType: { name: 'asc' } },
      select: {
        id: true,
        status: true,
        documentType: { select: { name: true, code: true } },
      },
    }),
  ]);

  const byItem = new Map(responses.map((r) => [r.itemId, r]));
  const historyByResponse = new Map<string, typeof history>();
  for (const entry of history) {
    const list = historyByResponse.get(entry.responseId) ?? [];
    list.push(entry);
    historyByResponse.set(entry.responseId, list);
  }

  const items = definitions.map((definition) => {
    const response = byItem.get(definition.id);
    const entries = response ? (historyByResponse.get(response.id) ?? []) : [];

    return {
      ...definition,
      responseId: response?.id ?? null,

      response: response?.response ?? '',
      applicantRemarks: response?.applicantRemarks ?? '',
      respondedByName: response?.respondedByName ?? '',
      respondedAt: response?.respondedAt ?? null,

      reviewerResponse: response?.reviewerResponse ?? '',
      reviewerRemarks: response?.reviewerRemarks ?? '',
      status: response?.status ?? CHECKLIST_STATUS.PENDING,
      reviewedByName: response?.reviewedByName ?? '',
      reviewedRoleKey: response?.reviewedRoleKey ?? '',
      reviewedStageCode: response?.reviewedStageCode ?? '',
      reviewedAt: response?.reviewedAt ?? null,
      documentId: response?.documentId ?? null,

      /**
       * Every act on this question, oldest first — the TPA's finding AND the
       * ZDD's, not the surviving one. This array is why the requirement that
       * a later reviewer must not erase an earlier one is satisfied in fact
       * and not merely in intent.
       */
      history: entries.map((e) => ({
        id: e.id,
        entryType: e.entryType,
        response: e.response,
        remarks: e.remarks,
        status: e.status,
        actorName: e.actorName,
        actorRoleKey: e.actorRoleKey,
        stageCode: e.stageCode,
        recordedAt: e.recordedAt,
      })),
    };
  });

  const progress = checklistProgress(items);

  const isOwner = app.ltpUserId === user.id;
  const holdsRespond = user.capabilities.includes(CAPABILITIES.CHECKLIST_RESPOND);
  const holdsReview = user.capabilities.includes(CAPABILITIES.CHECKLIST_REVIEW);

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      currentStageCode: app.currentStageCode,
      riskCategory: app.riskCategory,
    },
    kind,
    /** What an answer may cite in support. Uploaded documents only. */
    documents: documents.map((d) => ({
      id: d.id,
      name: d.documentType.name,
      code: d.documentType.code,
      status: d.status,
    })),
    items,
    progress,
    /** What the checklist answers say the risk is, recomputed on every read. */
    derivedRisk: deriveRiskCategory(items),

    /**
     * Whether the buttons are shown, decided HERE and never in the browser.
     * Every route re-derives the same answer before it writes — this is for
     * the interface, not for security.
     */
    canRespond: holdsRespond && (!isLtp(user) || isOwner) && canApplicantAnswer(app.status),
    respondBlockedReason: respondBlockedReason(user, app, holdsRespond, isOwner),
    canReview: holdsReview && canReviewerVerify(app.status),
    reviewBlockedReason:
      holdsReview && !canReviewerVerify(app.status)
        ? app.status === 'DRAFT'
          ? 'This application has not been filed yet.'
          : 'This application is closed. Its checklist is a record now and cannot be changed.'
        : null,
  };
}

function respondBlockedReason(
  user: AuthUser,
  app: ScopedApplication,
  holdsRespond: boolean,
  isOwner: boolean
): string | null {
  if (!holdsRespond) return null;
  if (isLtp(user) && !isOwner) return 'You may only answer on applications you filed.';
  if (!canApplicantAnswer(app.status)) {
    return 'This application is with the department. You can answer again if it is returned to you.';
  }
  return null;
}

export type ApplicationChecklist = Awaited<ReturnType<typeof getApplicationChecklist>>;

// ═══════════════════════════════════════════════════════════════════════════
// The applicant answers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Records the LTP's answers.
 *
 * Writes `response` and `applicantRemarks`. It does NOT write `status`, which
 * stays with the reviewer — an answer is not a verification, and the one thing
 * this separation exists to prevent is an applicant marking their own file
 * VERIFIED.
 *
 * Re-answering a question that has already been reviewed sends it back to
 * PENDING. That is deliberate: the finding was made against the previous
 * answer, and leaving a VERIFIED beside a changed answer would attribute to
 * the officer a judgement they never made. The officer's original finding is
 * still in the history, with the answer it was made against.
 */
export async function saveChecklistResponses(
  user: AuthUser,
  applicationId: string,
  input: SaveChecklistInput,
  meta: Meta = {},
  kind = 'APPLICATION'
) {
  const app = await requireApplication(user, applicationId);

  if (isLtp(user) && app.ltpUserId !== user.id) {
    throw forbidden('You may only answer on applications you filed.');
  }

  if (!canApplicantAnswer(app.status)) {
    throw forbidden(
      'This application is with the department. You can answer again if it is returned to you.'
    );
  }

  const definitions = await prisma.checklistItemDefinition.findMany({
    where: { id: { in: input.answers.map((a) => a.itemId) }, kind, isActive: true },
    select: DEFINITION_SELECT,
  });

  const byId = new Map(definitions.map((d) => [d.id, d]));

  // Validate EVERYTHING before writing ANYTHING. A partial save would leave
  // the applicant unable to tell which of nineteen answers went in.
  for (const answer of input.answers) {
    const definition = byId.get(answer.itemId);
    if (!definition) throw badRequest('That checklist question is not on this checklist.');

    // An empty response is a deliberate clearing, and allowed: an LTP who
    // answered the wrong question must be able to take it back.
    if (answer.response && !isValidResponse(definition.responseType, answer.response)) {
      throw badRequest(`Question ${definition.itemNumber} does not take that answer.`, [
        { path: answer.itemId, message: expectedFor(definition.responseType) },
      ]);
    }
  }

  const now = new Date();

  // Every existing row in ONE read, before the transaction opens. The
  // alternative — a findUnique per item inside it — is nineteen sequential
  // round trips holding a write transaction open for the whole of them, on a
  // screen that posts the whole checklist on every save.
  const existingRows = await prisma.applicationChecklistResponse.findMany({
    where: { applicationId: app.id, itemId: { in: input.answers.map((a) => a.itemId) } },
  });
  const existingByItem = new Map(existingRows.map((r) => [r.itemId, r]));

  await prisma.$transaction(
    async (tx) => {
      const entries: EntryRow[] = [];
      // New rows are collected and written in ONE statement rather than
      // nineteen. That needs their ids up front, so they are generated here
      // instead of by the database default — `createMany` on Postgres returns
      // a count and not the rows, and the history entries need something to
      // point at. A v4 UUID made here is the same value the column would have
      // held; nothing downstream can tell which side produced it.
      const creates: Prisma.ApplicationChecklistResponseCreateManyInput[] = [];

      for (const answer of input.answers) {
        const definition = byId.get(answer.itemId);
        if (!definition) continue;

        const existing = existingByItem.get(answer.itemId);

        // Unchanged answers are skipped rather than re-recorded. The screen
        // posts the whole checklist on save, and without this every save would
        // append nineteen history entries and bury the one thing that changed.
        if (
          existing &&
          existing.response === answer.response &&
          existing.applicantRemarks === (answer.applicantRemarks ?? existing.applicantRemarks)
        ) {
          continue;
        }

        const data = {
          response: answer.response,
          applicantRemarks: answer.applicantRemarks ?? existing?.applicantRemarks ?? '',
          respondedById: user.id,
          respondedByName: user.name,
          respondedAt: now,
          ...(answer.documentId !== undefined ? { documentId: answer.documentId } : {}),
          // A changed answer un-verifies the question — see the note above.
          ...(existing &&
          existing.status !== CHECKLIST_STATUS.PENDING &&
          existing.response !== answer.response
            ? { status: CHECKLIST_STATUS.PENDING }
            : {}),
        };

        let responseId: string;

        if (existing) {
          // An amendment is one row with its own values, so it stays an
          // individual update — and on the common save there are one or two
          // of these, not nineteen.
          await tx.applicationChecklistResponse.update({ where: { id: existing.id }, data });
          responseId = existing.id;
        } else {
          responseId = randomUUID();
          creates.push({
            id: responseId,
            applicationId: app.id,
            itemId: answer.itemId,
            itemNumber: definition.itemNumber,
            kind,
            status: CHECKLIST_STATUS.PENDING,
            ...data,
          });
        }

        entries.push(
          entryFor({
            responseId,
            applicationId: app.id,
            itemNumber: definition.itemNumber,
            entryType: 'APPLICANT_RESPONSE',
            response: answer.response,
            remarks: answer.applicantRemarks ?? '',
            status: '',
            actor: user,
            actorRoleKey: actingRoleFor(user, CAPABILITIES.CHECKLIST_RESPOND),
            stageCode: app.currentStageCode ?? '',
          })
        );
      }

      if (creates.length) {
        await tx.applicationChecklistResponse.createMany({ data: creates });
      }

      // Nothing actually changed — every answer posted matched what was
      // already on file. The screen submits the whole checklist on save, so
      // this is the common case when somebody edits one question, and an
      // event for it would put a line on the applicant's timeline saying
      // something happened when nothing did.
      if (!entries.length) return;

      await appendEntries(tx, entries);

      const risk = await refreshRiskCategory(tx, app.id, kind);

      await recordEvent(tx, {
        applicationId: app.id,
        type: EVENT_TYPES.CHECKLIST_ANSWERED,
        title: 'Checklist answered',
        // The count is what CHANGED, not what was posted. "19 questions
        // answered" on a save that altered one would be a line the timeline
        // then repeats for ever.
        description: `${entries.length} ${kind === 'APPLICATION' ? 'application' : 'site inspection'} checklist question${entries.length === 1 ? ' was' : 's were'} answered or amended.`,
        actor: user,
        metadata: { kind, count: entries.length, riskCategory: risk },
      });

      await audit(tx, {
        actor: user,
        action: 'CHECKLIST_RESPONSES_SAVED',
        entityType: 'Application',
        entityId: app.id,
        applicationId: app.id,
        after: { kind, answers: entries.length },
        remarks: `${app.applicationNumber} — checklist answered`,
        ...meta,
      });
    },
    // A nineteen-question save is a bigger unit of work than most transactions
    // in this codebase — up to nineteen upserts, a batched history insert, the
    // risk recomputation, a timeline event and an audit row that takes an
    // advisory lock. Prisma's 5 s default is sized for a single-row write and
    // is genuinely too tight for this one over a pooled connection.
    TRANSACTION_LIMITS
  );

  return getApplicationChecklist(user, app.id, kind);
}

const expectedFor = (responseType: string): string =>
  responseType === 'YES_NO'
    ? 'Answer Yes or No.'
    : responseType === 'YES_NO_NA'
      ? 'Answer Yes, No, or Not applicable.'
      : responseType === 'NUMBER' || responseType === 'MEASUREMENT'
        ? 'Enter a number that is not negative.'
        : 'Enter an answer.';

// ═══════════════════════════════════════════════════════════════════════════
// The desk verifies
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Records a desk's verification of one or more questions.
 *
 * The applicant's `response` is READ and never written. There is no code path
 * from this function to that column — which is what makes "a reviewer cannot
 * change what the applicant said" a property of the system rather than a rule
 * somebody has to remember.
 *
 * A desk reviewing a question a previous desk already reviewed is normal and
 * expected: the BBAS chain puts the same checklist in front of the TPA, the
 * ZDD and the JD in turn. The later finding becomes the current one; the
 * earlier is untouched in the history, with the desk it was made at.
 */
export async function reviewChecklist(
  user: AuthUser,
  applicationId: string,
  input: ReviewChecklistInput,
  meta: Meta = {},
  kind = 'APPLICATION'
) {
  const app = await requireApplication(user, applicationId);

  if (!canReviewerVerify(app.status)) {
    throw forbidden(
      app.status === 'DRAFT'
        ? 'This application has not been filed yet.'
        : 'This application is closed. Its checklist is a record now and cannot be changed.'
    );
  }

  const definitions = await prisma.checklistItemDefinition.findMany({
    where: { id: { in: input.items.map((i) => i.itemId) }, kind, isActive: true },
    select: DEFINITION_SELECT,
  });

  const byId = new Map(definitions.map((d) => [d.id, d]));
  for (const item of input.items) {
    if (!byId.has(item.itemId))
      throw badRequest('That checklist question is not on this checklist.');
  }

  const now = new Date();
  const roleKey = actingRoleFor(user, CAPABILITIES.CHECKLIST_REVIEW);

  // As above: one read, outside the transaction, rather than one per item
  // inside it.
  const existingRows = await prisma.applicationChecklistResponse.findMany({
    where: { applicationId: app.id, itemId: { in: input.items.map((i) => i.itemId) } },
  });
  const existingByItem = new Map(existingRows.map((r) => [r.itemId, r]));

  await prisma.$transaction(async (tx) => {
    const entries: EntryRow[] = [];
    // As on the applicant's side: one insert for every row this desk is the
    // first to touch, with ids generated here so the history entries have
    // something to point at.
    const creates: Prisma.ApplicationChecklistResponseCreateManyInput[] = [];

    for (const item of input.items) {
      const definition = byId.get(item.itemId);
      if (!definition) continue;

      const existing = existingByItem.get(item.itemId);

      if (
        existing &&
        existing.status === item.status &&
        existing.reviewerResponse === (item.reviewerResponse ?? existing.reviewerResponse) &&
        existing.reviewerRemarks === (item.reviewerRemarks ?? existing.reviewerRemarks)
      ) {
        continue;
      }

      const data = {
        status: item.status,
        reviewerResponse: item.reviewerResponse ?? '',
        reviewerRemarks: item.reviewerRemarks ?? '',
        reviewedById: user.id,
        reviewedByName: user.name,
        reviewedRoleKey: roleKey,
        reviewedStageCode: app.currentStageCode ?? '',
        reviewedAt: now,
      };

      // A desk can reach a question the applicant never answered — on a file
      // that arrived incomplete, marking question 8 NA or SHORTFALL is exactly
      // the right move. The row is created with an empty `response`, which is
      // the honest record of "unanswered, and here is what the desk made of
      // that".
      let responseId: string;

      if (existing) {
        await tx.applicationChecklistResponse.update({ where: { id: existing.id }, data });
        responseId = existing.id;
      } else {
        responseId = randomUUID();
        creates.push({
          id: responseId,
          applicationId: app.id,
          itemId: item.itemId,
          itemNumber: definition.itemNumber,
          kind,
          ...data,
        });
      }

      entries.push(
        entryFor({
          responseId,
          applicationId: app.id,
          itemNumber: definition.itemNumber,
          entryType: 'REVIEW',
          response: item.reviewerResponse ?? '',
          remarks: item.reviewerRemarks ?? '',
          status: item.status,
          actor: user,
          actorRoleKey: roleKey,
          stageCode: app.currentStageCode ?? '',
        })
      );
    }

    if (creates.length) {
      await tx.applicationChecklistResponse.createMany({ data: creates });
    }

    // As above: a verification that changed nothing is not an act, and must
    // not appear on the file as one.
    if (!entries.length) return;

    await appendEntries(tx, entries);

    const risk = await refreshRiskCategory(tx, app.id, kind);

    const adverse = entries.filter(
      (e) => e.status === CHECKLIST_STATUS.SHORTFALL || e.status === CHECKLIST_STATUS.REJECTED
    ).length;

    await recordEvent(tx, {
      applicationId: app.id,
      type: EVENT_TYPES.CHECKLIST_REVIEWED,
      title: 'Checklist verified',
      description: adverse
        ? `${entries.length} question(s) verified — ${adverse} raised a finding.`
        : `${entries.length} question(s) verified.`,
      actor: user,
      metadata: {
        kind,
        count: entries.length,
        adverse,
        riskCategory: risk,
        stageCode: app.currentStageCode,
      },
    });

    await audit(tx, {
      actor: user,
      action: 'CHECKLIST_REVIEWED',
      entityType: 'Application',
      entityId: app.id,
      applicationId: app.id,
      after: { kind, items: entries.length, adverse },
      remarks: `${app.applicationNumber} — checklist verified at ${app.currentStageCode ?? 'no stage'}`,
      ...meta,
    });
  }, TRANSACTION_LIMITS);

  return getApplicationChecklist(user, app.id, kind);
}

// ═══════════════════════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which role a verification should be recorded under.
 *
 * NOT `roleKeys[0]`, which is what this used to be and was wrong in a way the
 * demo data made obvious: the all-access demo accounts hold every role, LTP
 * among them, and the history came out reading "LTP verified question 2" — a
 * thing an LTP cannot do and the separation of capabilities exists to prevent.
 *
 * A reviewer may legitimately hold several roles. What the file needs recorded
 * is the one they were ACTING IN, and the only honest answer available here is
 * the first of their roles that actually carries the capability this act
 * required. An LTP-only role can therefore never appear against a
 * verification, whatever else the account holds.
 *
 * Falls back to the first role held, which is reachable only if the route
 * guard let through somebody with no reviewing role at all.
 */
function actingRoleFor(user: AuthUser, capability: string): string {
  const matrix = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
  const acting = user.roleKeys.find((key) => (matrix[key] ?? []).includes(capability));
  return acting ?? user.roleKeys[0] ?? '';
}

type EntryRow = {
  responseId: string;
  applicationId: string;
  itemNumber: number;
  entryType: string;
  response: string;
  remarks: string;
  status: string;
  actorId: string;
  actorName: string;
  actorRoleKey: string;
  stageCode: string;
};

/** Flattens one act into the row shape, with the actor resolved. */
function entryFor(input: {
  responseId: string;
  applicationId: string;
  itemNumber: number;
  entryType: 'APPLICANT_RESPONSE' | 'REVIEW';
  response: string;
  remarks: string;
  status: string;
  actor: AuthUser;
  actorRoleKey: string;
  stageCode: string;
}): EntryRow {
  return {
    responseId: input.responseId,
    applicationId: input.applicationId,
    itemNumber: input.itemNumber,
    entryType: input.entryType,
    response: input.response,
    remarks: input.remarks,
    status: input.status,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorRoleKey: input.actorRoleKey,
    stageCode: input.stageCode,
  };
}

/**
 * The append. The ONLY way anything reaches `checklist_review_entries`.
 *
 * There is no update and no delete anywhere in this module, and that is the
 * whole mechanism behind "later reviewers may not erase previous responses" —
 * the requirement is not that reviewers should be careful, it is that erasure
 * must be impossible, and the only way to mean that is to give the code no way
 * to express it.
 *
 * `createMany` rather than an insert per item: nineteen sequential inserts
 * inside a write transaction is nineteen round trips holding it open, and the
 * rows have nothing to say to each other.
 */
async function appendEntries(tx: Tx, entries: EntryRow[]) {
  if (!entries.length) return;
  await tx.checklistReviewEntry.createMany({ data: entries });
}

/**
 * Recomputes the application's risk category from its checklist answers.
 *
 * Runs inside the same transaction as the write that changed an answer, so the
 * category on the application row and the answers it was derived from can
 * never disagree. The derivation itself is in src/lib/checklist.ts, where the
 * screen can call it too — a register showing one risk and a detail page
 * showing another is exactly the kind of drift a shared function prevents.
 */
async function refreshRiskCategory(tx: Tx, applicationId: string, kind: string): Promise<string> {
  const rows = await tx.applicationChecklistResponse.findMany({
    where: { applicationId, kind },
    select: {
      response: true,
      status: true,
      item: { select: { affectsRisk: true, isActive: true } },
    },
  });

  const risk = deriveRiskCategory(
    rows
      .filter((r) => r.item.isActive)
      .map((r) => ({ affectsRisk: r.item.affectsRisk, response: r.response, status: r.status }))
  );

  await tx.application.update({ where: { id: applicationId }, data: { riskCategory: risk } });
  return risk;
}
