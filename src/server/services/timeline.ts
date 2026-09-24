import 'server-only';
import type { Tx } from '@/server/db/prisma';
import type { AuthUser } from '@/server/auth/context';

/**
 * The application timeline.
 *
 * Deliberately NOT the audit log. The two answer different questions and are
 * read by different people:
 *
 *   audit_logs          "who changed what field, and can we prove it wasn't
 *                        tampered with?"        → auditor, hash-chained,
 *                                                 before/after on every entity
 *
 *   application_events  "what has happened to my application?"
 *                                               → applicant and officer,
 *                                                 written in their language
 *
 * Collapsing them would mean either showing an LTP a stream of column diffs,
 * or weakening the audit trail into a summary. Both rows are written in the
 * same transaction as the change, so they cannot disagree.
 *
 * Phase 7 appends workflow events here through this same function — which is
 * why `type` is an open string and the event catalogue below is a plain
 * constant rather than a database enum.
 */

export const EVENT_TYPES = {
  // ── Phase 2 ──
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  APPLICATION_UPDATED: 'APPLICATION_UPDATED',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_DELETED: 'APPLICATION_DELETED',

  // ── Phase 3 ──
  DRAWING_UPLOADED: 'DRAWING_UPLOADED',
  SCRUTINY_STARTED: 'SCRUTINY_STARTED',
  SCRUTINY_PASSED: 'SCRUTINY_PASSED',
  SCRUTINY_FAILED: 'SCRUTINY_FAILED',

  // ── Phase 4 ──
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_REPLACED: 'DOCUMENT_REPLACED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  DOCUMENTS_COMPLETED: 'DOCUMENTS_COMPLETED',
  DOCUMENTS_INCOMPLETE: 'DOCUMENTS_INCOMPLETE',
  FEE_GENERATED: 'FEE_GENERATED',
  FEE_CANCELLED: 'FEE_CANCELLED',

  CHECKLIST_ANSWERED: 'CHECKLIST_ANSWERED',
  CHECKLIST_REVIEWED: 'CHECKLIST_REVIEWED',
  OTHERS_UPDATED: 'OTHERS_UPDATED',

  // ── BIM ──
  BIM_MODEL_UPLOADED: 'BIM_MODEL_UPLOADED',
  BIM_UPDATED: 'BIM_UPDATED',
  BIM_DECLARED: 'BIM_DECLARED',
  BIM_REVIEWED: 'BIM_REVIEWED',

  // ── Reserved for later phases. Listed so the renderer already knows how to
  //    draw them, and so the vocabulary is agreed before it is used. ──
  PAYMENT_SUCCESSFUL: 'PAYMENT_SUCCESSFUL',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  STAGE_FORWARDED: 'STAGE_FORWARDED',
  STAGE_RETURNED: 'STAGE_RETURNED',
  SHORTFALL_RAISED: 'SHORTFALL_RAISED',
  SHORTFALL_RESPONDED: 'SHORTFALL_RESPONDED',
  SHORTFALL_RESOLVED: 'SHORTFALL_RESOLVED',
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_WITHDRAWN: 'APPLICATION_WITHDRAWN',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export type RecordEventInput = {
  applicationId: string;
  type: EventType | string;
  /** One line, past tense, no jargon. "Application submitted", not "status→SUBMITTED". */
  title: string;
  description?: string;
  actor?: Pick<AuthUser, 'id' | 'name'> & { roleKeys?: string[] };
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

/**
 * Appends one event. Takes the transaction client, for the same reason
 * `audit()` does: an event describing a change that rolled back is a lie, and
 * a change with no event is a gap in the story.
 *
 * The sequence is derived inside the transaction and protected by the
 * `(applicationId, sequence)` unique index. Two concurrent writers cannot both
 * take sequence 7 — the second fails its insert and its whole transaction
 * rolls back, which is the correct outcome: it also means whatever change it
 * was describing did not happen either.
 */
export async function recordEvent(tx: Tx, input: RecordEventInput) {
  const last = await tx.applicationEvent.findFirst({
    where: { applicationId: input.applicationId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  return tx.applicationEvent.create({
    data: {
      applicationId: input.applicationId,
      sequence: (last?.sequence ?? 0) + 1,
      type: input.type,
      title: input.title,
      description: input.description ?? '',
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? 'System',
      actorRoleKey: input.actor?.roleKeys?.[0] ?? 'SYSTEM',
      metadata: (input.metadata ?? {}) as never,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  });
}

export type TimelineEntry = {
  id: string;
  sequence: number;
  type: string;
  title: string;
  description: string;
  actorName: string;
  actorRoleKey: string;
  metadata: unknown;
  occurredAt: Date;
};

/**
 * Reads the timeline, oldest first.
 *
 * Takes an applicationId that the CALLER has already proven access to. This
 * function performs no authorization of its own and must never be reached
 * from a route without assertApplicationAccess() having run first — see
 * getTimeline() in services/applications.ts, which is the only public entry.
 */
export async function readTimeline(tx: Tx, applicationId: string, limit = 200) {
  return tx.applicationEvent.findMany({
    where: { applicationId },
    orderBy: { sequence: 'asc' },
    take: limit,
    select: {
      id: true,
      sequence: true,
      type: true,
      title: true,
      description: true,
      actorName: true,
      actorRoleKey: true,
      metadata: true,
      occurredAt: true,
    },
  });
}
