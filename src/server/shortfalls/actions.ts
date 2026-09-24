import 'server-only';
import { prisma } from '@/server/db/prisma';
import { can, isLtp, type AuthUser } from '@/server/auth/context';
import { assertApplicationAccess } from '@/server/auth/scope';
import { conflict, forbidden, notFound } from '@/server/http/errors';
import { performAction } from '@/server/workflow/engine';
import { CAPABILITIES } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { SHORTFALL_STATUS } from '@/lib/shortfalls';
import {
  beginReview,
  cancelShortfall,
  reviewResolution,
  settleShortfall,
  submitResolution,
  type Meta,
} from './engine';

/**
 * THE SEAM between a shortfall and the file it belongs to.
 *
 * A shortfall-centric screen says "respond to SF/2026/00123". Sometimes that
 * also has to MOVE the application — a blocking shortfall parked the file at
 * the applicant's stage, and answering it must carry the file back to the desk
 * that raised it. Sometimes it must not: a reported shortfall never parked
 * anything and the file is four desks further on, where somebody is working.
 *
 * This file is the only place that decides which. It reads the situation and
 * either asks the workflow engine to run the transition — so movement stays
 * the engine's job, with its locking, its guards and its history row — or
 * calls the shortfall engine directly when nothing needs to move.
 *
 * The alternative was a shortfall endpoint that could move applications, which
 * would be a second router with none of the first one's guarantees.
 */

/**
 * Is this shortfall the one currently parking its application?
 *
 * Not simply "is it blocking": a blocking shortfall that has already been
 * answered and rejected is blocking and NOT the reason the file is parked
 * right now, if a later one is. The instance's `parkedStageId` and the file's
 * stage are what actually decide, so they are what is read.
 */
async function isParkingTheFile(shortfall: {
  id: string;
  mode: string;
  applicationId: string;
  raisedAtStageCode: string;
}): Promise<boolean> {
  if (shortfall.mode !== 'BLOCKING') return false;

  const instance = await prisma.workflowInstance.findUnique({
    where: { applicationId: shortfall.applicationId },
    select: {
      status: true,
      parkedStageId: true,
      currentStageId: true,
    },
  });

  if (!instance?.parkedStageId) return false;

  const [parked, current] = await Promise.all([
    prisma.workflowStage.findUnique({
      where: { id: instance.parkedStageId },
      select: { code: true },
    }),
    instance.currentStageId
      ? prisma.workflowStage.findUnique({
          where: { id: instance.currentStageId },
          select: { type: true },
        })
      : null,
  ]);

  // Parked at the stage that raised THIS shortfall, and sitting on the
  // applicant's side of the workflow.
  return parked?.code === shortfall.raisedAtStageCode && current?.type === 'LTP_ACTION';
}

async function load(user: AuthUser, shortfallId: string) {
  const shortfall = await prisma.shortfall.findUnique({
    where: { id: shortfallId },
    select: {
      id: true,
      applicationId: true,
      shortfallNumber: true,
      status: true,
      kind: true,
      mode: true,
      raisedById: true,
      raisedAtStageCode: true,
      raisedByRoleKey: true,
    },
  });

  if (!shortfall) throw notFound('That shortfall could not be found.');

  // Proves row scope. An out-of-scope shortfall is indistinguishable from one
  // that does not exist.
  await assertApplicationAccess(user, shortfall.applicationId);

  return shortfall;
}

// ═══════════════════════════════════════════════════════════════════════════
// Responding
// ═══════════════════════════════════════════════════════════════════════════

export type RespondResult = {
  shortfallId: string;
  shortfallNumber: string;
  status: string;
  /** Set when answering also carried the application to another stage. */
  movedTo: string | null;
  message: string;
};

/**
 * The applicant's answer, from the shortfall screen.
 *
 * When the shortfall is the one parking the file, this runs the workflow's
 * RESUBMIT — same transition, same locking, same history row as answering from
 * the Workflow tab. Otherwise it records the response and leaves the file
 * where it is.
 */
export async function respondToShortfall(
  user: AuthUser,
  shortfallId: string,
  input: {
    response: string;
    attachments?: Array<Record<string, unknown>>;
    items?: Array<{
      itemId: string;
      response: string;
      applicantRemarks?: string;
      attachments?: Array<Record<string, unknown>>;
    }>;
  },
  meta: Meta
): Promise<RespondResult> {
  const shortfall = await load(user, shortfallId);

  if (!can(user, CAPABILITIES.SHORTFALL_RESPOND)) {
    throw forbidden('Answering a shortfall is the applicant’s to do.');
  }

  if (await isParkingTheFile(shortfall)) {
    const result = await performAction(
      user,
      shortfall.applicationId,
      ACTIONS.RESUBMIT,
      {
        remarks: input.response,
        attachments: input.attachments,
        // Narrows the transition to THIS shortfall, so a file carrying two
        // does not answer both with one response.
        shortfallId: shortfall.id,
        shortfallItems: input.items,
      },
      meta
    );

    return {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      status: SHORTFALL_STATUS.RESOLUTION_SUBMITTED,
      movedTo: result.toStageCode,
      message: result.message,
    };
  }

  const result = await prisma.$transaction((tx) =>
    submitResolution(tx, {
      shortfallId: shortfall.id,
      actor: user,
      response: input.response,
      attachments: input.attachments,
      items: input.items,
      meta,
    })
  );

  return {
    shortfallId: shortfall.id,
    shortfallNumber: shortfall.shortfallNumber,
    status: result.status,
    movedTo: null,
    message:
      'Your response has been recorded and the officer holding the file has been told. ' +
      'The application stays where it is.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reviewing
// ═══════════════════════════════════════════════════════════════════════════

export type ReviewResult = {
  shortfallId: string;
  shortfallNumber: string;
  status: string;
  movedTo: string | null;
  message: string;
};

/**
 * The officer's verdict, from the shortfall screen.
 *
 * Accepting the answer to a shortfall that is parking the file has to resume
 * the workflow, so it goes through ACCEPT_RESOLUTION; rejecting it has to send
 * the file back, so it goes through REJECT_RESOLUTION. A reported shortfall
 * moves nothing either way.
 */
export async function reviewShortfall(
  user: AuthUser,
  shortfallId: string,
  input: {
    accept: boolean;
    remarks: string;
    items?: Array<{ itemId: string; decision: string; remarks?: string }>;
  },
  meta: Meta
): Promise<ReviewResult> {
  const shortfall = await load(user, shortfallId);

  if (!can(user, CAPABILITIES.SHORTFALL_RESOLVE)) {
    throw forbidden('Your role does not permit deciding a shortfall.');
  }

  if (isLtp(user)) {
    throw forbidden('An applicant cannot decide their own shortfall.');
  }

  if (await isParkingTheFile(shortfall)) {
    // The file is with the applicant. Nothing to decide until they answer, and
    // the workflow's own guard would say so — this says it first, and names
    // the shortfall.
    throw conflict(
      `${shortfall.shortfallNumber} is still with the applicant. There is nothing to decide yet.`
    );
  }

  // Blocking shortfalls that have been answered come back to the raising desk,
  // where the file now sits — so the workflow transition is available and is
  // what must run, because accepting resumes the review and rejecting parks it
  // again.
  const parkedBack = await prisma.workflowInstance.findUnique({
    where: { applicationId: shortfall.applicationId },
    select: { currentStageId: true },
  });

  const atRaisingDesk = parkedBack?.currentStageId
    ? (
        await prisma.workflowStage.findUnique({
          where: { id: parkedBack.currentStageId },
          select: { code: true },
        })
      )?.code === shortfall.raisedAtStageCode
    : false;

  if (shortfall.mode === 'BLOCKING' && atRaisingDesk) {
    const result = await performAction(
      user,
      shortfall.applicationId,
      input.accept ? ACTIONS.ACCEPT_RESOLUTION : ACTIONS.REJECT_RESOLUTION,
      { remarks: input.remarks, shortfallId: shortfall.id, shortfallDecisions: input.items },
      meta
    );

    return {
      shortfallId: shortfall.id,
      shortfallNumber: shortfall.shortfallNumber,
      status: input.accept ? SHORTFALL_STATUS.RESOLVED : SHORTFALL_STATUS.RESOLUTION_REJECTED,
      movedTo: result.toStageCode,
      message: result.message,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const answered = await tx.shortfallResolution.count({
      where: { shortfallId: shortfall.id, reviewedAt: null },
    });

    // Nothing to review means the officer is CONFIRMING a reported shortfall
    // has been settled — the applicant paid the demand or supplied the
    // document without a formal response. Rejecting in that situation is
    // meaningless, so it is refused rather than quietly ignored.
    if (answered === 0) {
      if (!input.accept) {
        throw conflict(
          `${shortfall.shortfallNumber} has no response to reject. Withdraw it if it should not have been raised.`
        );
      }

      return settleShortfall(tx, {
        shortfallId: shortfall.id,
        actor: user,
        remarks: input.remarks,
        meta,
      });
    }

    return reviewResolution(tx, {
      shortfallId: shortfall.id,
      actor: user,
      accept: input.accept,
      remarks: input.remarks,
      items: input.items,
      meta,
    });
  });

  return {
    shortfallId: shortfall.id,
    shortfallNumber: shortfall.shortfallNumber,
    status: result.status,
    movedTo: null,
    message: input.accept
      ? `${shortfall.shortfallNumber} settled.`
      : `${shortfall.shortfallNumber} sent back to the applicant.`,
  };
}

/** Marks an answered shortfall as being looked at. */
export async function takeUpShortfall(user: AuthUser, shortfallId: string) {
  const shortfall = await load(user, shortfallId);

  if (!can(user, CAPABILITIES.SHORTFALL_RESOLVE)) {
    throw forbidden('Your role does not permit deciding a shortfall.');
  }

  await prisma.$transaction((tx) => beginReview(tx, shortfall.id, user));
  return { shortfallId: shortfall.id, status: SHORTFALL_STATUS.UNDER_REVIEW };
}

/**
 * Withdraws a shortfall raised in error.
 *
 * Only the officer who raised it, or a supervisor who can reassign work.
 * A shortfall is a decision by a named officer, and letting any officer
 * withdraw another's would make the record of who asked for what unreliable.
 */
export async function withdrawShortfall(
  user: AuthUser,
  shortfallId: string,
  input: { reason: string },
  meta: Meta
) {
  const shortfall = await load(user, shortfallId);

  const isRaiser = shortfall.raisedById === user.id;
  if (!isRaiser && !can(user, CAPABILITIES.WORKFLOW_REASSIGN)) {
    throw forbidden(
      'Only the officer who raised a shortfall, or a supervisor, can withdraw it.'
    );
  }

  const result = await prisma.$transaction((tx) =>
    cancelShortfall(tx, { shortfallId: shortfall.id, actor: user, reason: input.reason, meta })
  );

  return {
    shortfallId: shortfall.id,
    shortfallNumber: shortfall.shortfallNumber,
    status: result.status,
    movedTo: null,
    message: `${shortfall.shortfallNumber} withdrawn.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Attachments
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stores a file an applicant is attaching to a response.
 *
 * ── Why this is not the document upload ──────────────────────────────────
 *
 * A DOCUMENT shortfall naming a document type is answered through the document
 * checklist: the file becomes a real `ApplicationDocument`, it counts towards
 * completeness, and an officer verifies it like any other. That path already
 * exists and this does not duplicate it.
 *
 * This is for everything else — the photograph of a corrected boundary, the
 * bank challan, the letter from the structural engineer. It goes through the
 * same upload pipeline (size, extension, magic-byte sniff, checksum, antivirus
 * queue) and is referenced by the resolution rather than by the checklist,
 * because it is evidence for one decision and not part of the statutory
 * document set.
 */
export async function attachToShortfall(
  user: AuthUser,
  shortfallId: string,
  file: { name: string; type: string; bytes: Buffer }
) {
  const shortfall = await load(user, shortfallId);

  if (!can(user, CAPABILITIES.SHORTFALL_RESPOND, CAPABILITIES.SHORTFALL_RESOLVE)) {
    throw forbidden('Your role does not permit attaching files to a shortfall.');
  }

  const { storeUpload } = await import('@/server/services/files');
  const { ALLOWED_UPLOAD_EXTENSIONS } = await import('@/lib/constants');

  const stored = await storeUpload({
    applicationId: shortfall.applicationId,
    kind: 'documents',
    file,
    uploadedById: user.id,
    allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS,
  });

  return {
    fileObjectId: stored.id,
    name: stored.originalName,
    sizeBytes: stored.sizeBytes,
    mimeType: stored.mimeType,
    // PENDING until the scanner clears it. The download route refuses anything
    // not yet cleared, so the officer sees the row and not the bytes until the
    // job has run.
    scanStatus: stored.scanStatus,
  };
}
