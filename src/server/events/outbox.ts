import 'server-only';
import { prisma, type Db } from '@/server/db/prisma';

/**
 * The transactional outbox.
 *
 * Events are written INSIDE the business transaction:
 *
 *   BEGIN
 *     update application status
 *     insert workflow_history
 *     insert audit_log
 *     insert outbox_event ('SHORTFALL_RAISED', payload)
 *   COMMIT
 *          │
 *          └──▶ worker ──▶ dispatcher ──▶ SMS · email · in-app
 *
 * This is what makes the notification promise real. If notification were sent
 * inline, an SMS outage would either roll back the officer's decision or
 * silently drop the message. Here the notification is a durable consequence of
 * a committed fact: it will be delivered, or it will be visibly failed with a
 * retry count an administrator can see.
 */

/**
 * The event vocabulary.
 *
 * ── Some of these have no producer yet, and that is deliberate ──────────
 *
 * INSPECTION_DUE, WORK_INITIATED and OCCUPANCY_SUBMITTED belong to modules
 * that have not been built. They are declared here, given recipient rules and
 * given templates, because the alternative is that whoever builds Site
 * Inspection also invents an event name, a recipient rule and three templates
 * at the same time — and invents them differently from whoever builds
 * Occupancy. The vocabulary is the cheap half of the contract and the half
 * that is worth fixing first.
 *
 * `scripts/verify-demo.ts` asserts that every event here HAS a template, and
 * separately reports which have never been emitted, so an event that stays
 * unproduced is visible rather than forgotten.
 */
export const EVENTS = {
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  /** The file leaves the applicant's hands. Distinct from CREATED, which is a draft. */
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  DRAWING_UPLOADED: 'DRAWING_UPLOADED',
  SCRUTINY_PASSED: 'SCRUTINY_PASSED',
  SCRUTINY_FAILED: 'SCRUTINY_FAILED',
  DOCUMENTS_PENDING: 'DOCUMENTS_PENDING',
  DOCUMENTS_COMPLETED: 'DOCUMENTS_COMPLETED',
  FEE_GENERATED: 'FEE_GENERATED',
  PAYMENT_SUCCESSFUL: 'PAYMENT_SUCCESSFUL',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  APPLICATION_FORWARDED: 'APPLICATION_FORWARDED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  /** A named officer now holds this file. TASK_ASSIGNED is the queue; this is the person. */
  APPLICATION_ASSIGNED: 'APPLICATION_ASSIGNED',
  /** A file has arrived at a reviewing desk and is waiting to be looked at. */
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  /** A file has reached the desk that can approve it. */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  SHORTFALL_RAISED: 'SHORTFALL_RAISED',
  SHORTFALL_RESPONDED: 'SHORTFALL_RESPONDED',
  SHORTFALL_RESOLVED: 'SHORTFALL_RESOLVED',
  SHORTFALL_REJECTED: 'SHORTFALL_REJECTED',
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_RETURNED: 'APPLICATION_RETURNED',
  /** Notification only. Passing an SLA has no legal effect — see docs R.1.1. */
  SLA_DUE_SOON: 'SLA_DUE_SOON',
  SLA_OVERDUE: 'SLA_OVERDUE',
  ORDER_ISSUED: 'ORDER_ISSUED',

  // ── Declared, not yet produced ────────────────────────────────────────
  //
  // No code emits these. They belong to Site Inspection, Commencement and
  // Occupancy, which are later phases. Declaring the name, the recipients and
  // the templates now is what stops three different modules inventing three
  // different spellings of the same message later.
  /** A site inspection is scheduled and falling due. */
  INSPECTION_DUE: 'INSPECTION_DUE',
  /**
   * The applicant has declared that work on site has started. Produced since
   * Phase 9 by the NOTIFY_WORK_COMMENCEMENT transition's `notify`.
   */
  WORK_INITIATED: 'WORK_INITIATED',
  /**
   * An occupancy certificate application has been filed. Produced since
   * Phase 10 by the SUBMIT_OCCUPANCY transition's `notify`.
   */
  OCCUPANCY_SUBMITTED: 'OCCUPANCY_SUBMITTED',

  // Developer registration (Phase 11). No applicationId: these carry a
  // developer_registrations row, addressed by payload alone — see
  // src/server/services/developer-registrations.ts.
  DEVELOPER_REGISTRATION_SUBMITTED: 'DEVELOPER_REGISTRATION_SUBMITTED',
  DEVELOPER_REGISTRATION_SHORTFALL_RAISED: 'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
  DEVELOPER_REGISTRATION_RESPONSE_RECEIVED: 'DEVELOPER_REGISTRATION_RESPONSE_RECEIVED',
  DEVELOPER_REGISTRATION_REVIEW_REQUIRED: 'DEVELOPER_REGISTRATION_REVIEW_REQUIRED',
  DEVELOPER_REGISTRATION_APPROVED: 'DEVELOPER_REGISTRATION_APPROVED',
  DEVELOPER_REGISTRATION_REJECTED: 'DEVELOPER_REGISTRATION_REJECTED',
  DEVELOPER_REGISTRATION_RENEWAL_DUE: 'DEVELOPER_REGISTRATION_RENEWAL_DUE',

  USER_CREATED: 'USER_CREATED',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

export type EventCode = (typeof EVENTS)[keyof typeof EVENTS];

export type EmitInput = {
  eventCode: EventCode | string;
  applicationId?: string | null;
  payload: Record<string, unknown>;
};

/**
 * Takes the transaction client on purpose. Emitting outside the business
 * transaction reintroduces exactly the divergence this pattern exists to
 * prevent.
 */
export async function emit(db: Db, input: EmitInput) {
  return db.outboxEvent.create({
    data: {
      eventCode: input.eventCode,
      applicationId: input.applicationId ?? null,
      payload: input.payload as never,
    },
  });
}

/**
 * Claims a batch of unprocessed events for the dispatcher.
 *
 * `FOR UPDATE SKIP LOCKED` lets several worker processes drain the outbox
 * concurrently without any of them handling the same row.
 */
export async function claimPending(batchSize = 25) {
  return prisma.outboxEvent.findMany({
    where: { processed: false },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: {
      id: true,
      eventCode: true,
      applicationId: true,
      payload: true,
      attempts: true,
    },
  });
}

export async function markProcessed(id: string) {
  await prisma.outboxEvent.update({
    where: { id },
    data: { processed: true, processedAt: new Date() },
  });
}

export async function markFailed(id: string, error: string) {
  await prisma.outboxEvent.update({
    where: { id },
    data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
  });
}
