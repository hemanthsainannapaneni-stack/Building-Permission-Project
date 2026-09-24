import { z } from 'zod';
import { PROFESSIONAL_CHANGE_DECISIONS } from '@/lib/professional-change';

/**
 * What may be sent to the change of professional endpoints.
 *
 * SHAPE only. Whether the step is this caller's, whether the request is at
 * that step, and whether the workflow allows it at the file's stage are
 * decided by the service and the engine.
 */

const text = (max: number) => z.string().trim().max(max);

const isoDate = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date.');

const flag = z
  .union([z.boolean(), z.enum(['true', 'false', ''])])
  .optional()
  .transform((v) => v === true || v === 'true');

/** Arrives as MULTIPART — every field a string. Documents travel as files. */
export const requestProfessionalChangeSchema = z.object({
  proposedProfessionalId: z.string().uuid('Choose the proposed professional.'),
  requestDate: isoDate,
  reason: text(4000).min(10, 'Say why the owner wants to change the professional.'),
  /** Demo mode only: labelled placeholders for the kinds in `demoKinds` not uploaded. */
  demoDocuments: flag,
  /** Comma-separated document kinds. Empty with demoDocuments: every kind not uploaded. */
  demoKinds: z.string().optional().default(''),
  expectedSequence: z.coerce.number().int().optional(),
});
export type RequestProfessionalChangeInput = z.infer<typeof requestProfessionalChangeSchema>;

export const addProfessionalChangeDocumentsSchema = z.object({
  demoDocuments: flag,
  /** Demo mode only: which kinds to add placeholders for, comma-separated. */
  demoKinds: z.string().optional().default(''),
  expectedStatus: z.string().optional(),
});
export type AddProfessionalChangeDocumentsInput = z.infer<typeof addProfessionalChangeDocumentsSchema>;

export const professionalChangeStepSchema = z.object({
  remarks: text(4000).min(5, 'Record your remarks.'),
  expectedStatus: z.string().optional(),
});
export type ProfessionalChangeStepInput = z.infer<typeof professionalChangeStepSchema>;

export const decideProfessionalChangeSchema = professionalChangeStepSchema.extend({
  decision: z.enum(PROFESSIONAL_CHANGE_DECISIONS),
});
export type DecideProfessionalChangeInput = z.infer<typeof decideProfessionalChangeSchema>;
