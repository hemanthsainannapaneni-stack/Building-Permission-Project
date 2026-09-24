import { z } from 'zod';
import {
  QUESTION_STATUSES,
  RECOMMENDATIONS,
  SIGNATURE_METHODS,
} from '@/lib/site-inspection';

/**
 * What may be written to a site inspection, request by request.
 *
 * SHAPE only. Whether an answer suits its question, whether the recommendation
 * agrees with the findings and whether the report is ready to sign depend on
 * rows these schemas cannot see, and are decided by `inspectionReadiness()`
 * inside the service — the same function the screen runs.
 */

const text = (max: number) => z.string().trim().max(max);

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date.');

// ── Scheduling ──────────────────────────────────────────────────────────────

export const scheduleInspectionSchema = z.object({
  inspectorId: z.string().uuid('Choose the inspecting officer.'),
  scheduledFor: isoDate,
  remarks: text(1000).optional().default(''),
  /** The history sequence the screen rendered — see performAction's 409. */
  expectedSequence: z.number().int().nonnegative().optional(),
});

export type ScheduleInspectionInput = z.infer<typeof scheduleInspectionSchema>;

export const rescheduleInspectionSchema = z.object({
  inspectorId: z.string().uuid('Choose the inspecting officer.').optional(),
  scheduledFor: isoDate.optional(),
  remarks: text(1000).min(1, 'Say why the inspection is being rescheduled.'),
});

export type RescheduleInspectionInput = z.infer<typeof rescheduleInspectionSchema>;

// ── The draft ───────────────────────────────────────────────────────────────

export const inspectionResponseSchema = z.object({
  itemId: z.string().uuid(),
  response: text(500).default(''),
  observation: text(2000).default(''),
  remarks: text(2000).default(''),
  status: z.enum(QUESTION_STATUSES).default('PENDING'),
});

export const saveInspectionSchema = z.object({
  inspectedAt: isoDate.nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  siteAddress: text(500).optional(),
  generalObservation: text(4000).optional(),
  // Empty string clears a recommendation the inspector has changed their
  // mind about, which is a legitimate state for a draft.
  recommendation: z.union([z.enum(RECOMMENDATIONS), z.literal('')]).optional(),
  recommendationRemarks: text(4000).optional(),
  responses: z.array(inspectionResponseSchema).max(100).optional(),
});

export type SaveInspectionInput = z.infer<typeof saveInspectionSchema>;

// ── Photographs (multipart; these are the non-file fields) ──────────────────

export const photoMetadataSchema = z.object({
  category: z.enum([
    'NORTH',
    'SOUTH',
    'EAST',
    'WEST',
    'ACCESS_ROAD',
    'BOUNDARY',
    'ENCUMBRANCE',
    'EXISTING_STRUCTURE',
    'OTHER',
  ]),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  capturedAt: isoDate,
  description: text(500).default(''),
});

export type PhotoMetadataInput = z.infer<typeof photoMetadataSchema>;

// ── Sign & submit ───────────────────────────────────────────────────────────

export const submitInspectionSchema = z
  .object({
    method: z.enum(SIGNATURE_METHODS),
    /** Aadhaar eSign — Demo: the last four digits, and the demo OTP. */
    aadhaarLast4: z.string().regex(/^\d{4}$/, 'Enter the last four digits.').optional(),
    otp: z.string().regex(/^\d{6}$/, 'Enter the six-digit OTP.').optional(),
    /** USB Token — Demo: the token PIN. */
    pin: z.string().regex(/^\d{4,8}$/, 'Enter the token PIN.').optional(),
    /** The declaration the inspector ticks. Must be true. */
    declaration: z.literal(true, {
      errorMap: () => ({ message: 'Confirm the declaration before signing.' }),
    }),
    expectedSequence: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'AADHAAR_ESIGN_DEMO') {
      if (!value.aadhaarLast4) ctx.addIssue({ code: 'custom', path: ['aadhaarLast4'], message: 'Enter the last four digits.' });
      if (!value.otp) ctx.addIssue({ code: 'custom', path: ['otp'], message: 'Enter the OTP.' });
    }
    if (value.method === 'USB_TOKEN_DEMO' && !value.pin) {
      ctx.addIssue({ code: 'custom', path: ['pin'], message: 'Enter the token PIN.' });
    }
  });

export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;
