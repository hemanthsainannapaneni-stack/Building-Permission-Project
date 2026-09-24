import { z } from 'zod';
import { OFFICER_ACTIONS } from '@/lib/noc';

/**
 * What may be sent to the NOC endpoints, request by request.
 *
 * SHAPE only. Whether a move is legal from the NOC's current status, whether
 * the file is at the caller's desk and whether a received NOC is complete
 * enough to verify depend on rows these schemas cannot see — `src/lib/noc.ts`
 * and the service decide those.
 */

const text = (max: number) => z.string().trim().max(max);

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date.');

/** An empty string from a cleared date input means "not given". */
const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

// ── Opening a NOC on a file ─────────────────────────────────────────────────

export const createNocSchema = z.object({
  nocTypeId: z.string().uuid('Choose the kind of NOC.'),
  /**
   * An officer opens it already decided: true → REQUIRED, false →
   * NOT_REQUIRED. An applicant's declaration is always PENDING, so the
   * service ignores this for them.
   */
  required: z.boolean().optional(),
  authority: text(200).optional().default(''),
  remarks: text(2000).optional().default(''),
});

export type CreateNocInput = z.infer<typeof createNocSchema>;

// ── The desk's decision ─────────────────────────────────────────────────────

export const officerActionSchema = z.object({
  action: z.enum(OFFICER_ACTIONS),
  remarks: text(2000).default(''),
  /** The status the screen rendered. A stale screen gets 409, not a surprise. */
  expectedStatus: z.string().optional(),
});

export type OfficerActionInput = z.infer<typeof officerActionSchema>;

// ── The applicant's record ──────────────────────────────────────────────────
//
// Sent as MULTIPART (the certificate may travel with it), so every field
// arrives as a string and is coerced here.

export const applicantUpdateSchema = z.object({
  action: z.enum(['RECORD_APPLICATION', 'RECORD_RECEIPT']),
  authority: text(200).optional(),
  applicationReference: text(120).optional(),
  appliedDate: optionalDate,
  referenceNumber: text(120).optional(),
  issuedDate: optionalDate,
  expiryDate: optionalDate,
  remarks: text(2000).optional().default(''),
  /** Demo mode only: attach a labelled placeholder instead of a file. */
  demoDocument: z
    .union([z.boolean(), z.enum(['true', 'false', ''])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  expectedStatus: z.string().optional(),
});

export type ApplicantUpdateInput = z.infer<typeof applicantUpdateSchema>;

// ── Configuration ───────────────────────────────────────────────────────────

export const updateNocTypeSchema = z.object({
  name: text(120).min(2).optional(),
  authority: text(200).optional(),
  description: text(1000).optional(),
  isActive: z.boolean().optional(),
  requiresExpiry: z.boolean().optional(),
});

export type UpdateNocTypeInput = z.infer<typeof updateNocTypeSchema>;
