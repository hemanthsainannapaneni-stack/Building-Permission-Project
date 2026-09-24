import { z } from 'zod';
import { SHOW_CAUSE_DECISIONS } from '@/lib/show-cause';
import { REVOCATION_DECISIONS } from '@/lib/revocation';
import { OUTWARD_ACTIONS, OUTWARD_DOCUMENT_TYPES, OUTWARD_MODES } from '@/lib/outward';

/**
 * What may be sent to the show cause, revocation and outward endpoints.
 *
 * SHAPE only. Whether the move is legal from the row's current status, and
 * whether the workflow offers it to this caller at this stage, are decided by
 * the services and the engine.
 */

const text = (max: number) => z.string().trim().max(max);

const isoDate = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date.');

const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const flag = z
  .union([z.boolean(), z.enum(['true', 'false', ''])])
  .optional()
  .transform((v) => v === true || v === 'true');

// ── Show cause ──────────────────────────────────────────────────────────────
//
// Issue and respond arrive as MULTIPART (documents may travel with them), so
// every field is a string and coerced here.

export const issueShowCauseSchema = z.object({
  reason: text(4000).min(10, 'Say why the notice is being issued.'),
  violation: text(4000).min(5, 'State the violation observed.'),
  responseDueDate: isoDate,
  /** Demo mode only: attach a labelled placeholder instead of a file. */
  demoDocument: flag,
  expectedSequence: z.coerce.number().int().optional(),
});
export type IssueShowCauseInput = z.infer<typeof issueShowCauseSchema>;

export const respondShowCauseSchema = z.object({
  response: text(8000).min(10, 'Write the response.'),
  demoDocument: flag,
  expectedStatus: z.string().optional(),
});
export type RespondShowCauseInput = z.infer<typeof respondShowCauseSchema>;

export const takeUpShowCauseSchema = z.object({
  remarks: text(2000).optional().default(''),
  expectedStatus: z.string().optional(),
});
export type TakeUpShowCauseInput = z.infer<typeof takeUpShowCauseSchema>;

export const decideShowCauseSchema = z
  .object({
    decision: z.enum(SHOW_CAUSE_DECISIONS),
    remarks: text(4000).min(5, 'Record the reasons for the decision.'),
    /** Only with REVOKE_PROCEEDING: the grounds the revocation proposal states. */
    grounds: z.array(text(1000)).max(20).optional().default([]),
    expectedStatus: z.string().optional(),
  })
  .refine((v) => v.decision !== 'REVOKE_PROCEEDING' || v.grounds.some((g) => g.trim()), {
    path: ['grounds'],
    message: 'State at least one ground for the revocation proposal.',
  });
export type DecideShowCauseInput = z.infer<typeof decideShowCauseSchema>;

// ── Revocation ──────────────────────────────────────────────────────────────

export const initiateRevocationSchema = z.object({
  reason: text(4000).min(10, 'Say why the permission should be revoked.'),
  grounds: z.array(text(1000)).min(1, 'State at least one ground.').max(20),
  showCauseId: z.string().uuid().optional().nullable(),
});
export type InitiateRevocationInput = z.infer<typeof initiateRevocationSchema>;

export const takeUpRevocationSchema = z.object({
  remarks: text(2000).optional().default(''),
  expectedStatus: z.string().optional(),
});
export type TakeUpRevocationInput = z.infer<typeof takeUpRevocationSchema>;

export const decideRevocationSchema = z.object({
  decision: z.enum(REVOCATION_DECISIONS),
  remarks: text(4000).min(5, 'Record the reasons for the decision.'),
  expectedStatus: z.string().optional(),
});
export type DecideRevocationInput = z.infer<typeof decideRevocationSchema>;

// ── Outward ─────────────────────────────────────────────────────────────────

export const createOutwardSchema = z.object({
  /** Application number or id. Optional for an "Other" document. */
  application: text(60).optional().default(''),
  documentType: z.enum(OUTWARD_DOCUMENT_TYPES),
  documentReference: text(120).optional().default(''),
  subject: text(300).optional().default(''),
  recipient: text(200).optional().default(''),
  address: text(1000).optional().default(''),
  readyForDispatch: z.boolean().optional().default(false),
  remarks: text(2000).optional().default(''),
});
export type CreateOutwardInput = z.infer<typeof createOutwardSchema>;

export const outwardActionSchema = z.object({
  action: z.enum(OUTWARD_ACTIONS),
  mode: z.enum(OUTWARD_MODES).optional(),
  dispatchDate: optionalDate,
  trackingNumber: text(120).optional().default(''),
  deliveredAt: optionalDate,
  acknowledgement: text(300).optional().default(''),
  acknowledgementDate: optionalDate,
  returnReason: text(1000).optional().default(''),
  remarks: text(2000).optional().default(''),
  expectedStatus: z.string().optional(),
});
export type OutwardActionInput = z.infer<typeof outwardActionSchema>;
