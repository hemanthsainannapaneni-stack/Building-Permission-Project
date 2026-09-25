import { z } from 'zod';
import { PROFESSIONAL_DECISIONS, VERIFICATION_OUTCOMES } from '@/lib/professional-registration';

/**
 * What may be sent to the professional registration endpoints. SHAPE only —
 * whose step it is, whether the registration is at that step and whether the
 * type exists are the service's. A draft may be saved incomplete;
 * `professionalProblems` holds what submission enforces. Multipart bodies
 * arrive as strings.
 */

const text = (max: number) => z.string().trim().max(max);
const flag = z
  .union([z.boolean(), z.enum(['true', 'false', 'on', ''])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === 'on');
const expected = z.string().optional();
const count = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 80) {
      ctx.addIssue({ code: 'custom', message: 'Enter whole years.' });
      return z.NEVER;
    }
    return n;
  });
const optionalDay = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Enter a date.' });
      return z.NEVER;
    }
    return v;
  });
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid('Choose an account from the list.').nullable());

export const professionalDraftSchema = z.object({
  professionalType: text(60).min(1, 'Choose the LTP type.'),
  name: text(200).min(2, 'Enter the LTP’s name.'),
  userId: optionalUuid,
  licenceNo: text(60).optional().default(''),
  registrationBody: text(200).optional().default(''),
  qualification: text(200).optional().default(''),
  experienceYears: count,
  organization: text(200).optional().default(''),
  address: text(1000).optional().default(''),
  district: text(120).optional().default(''),
  pincode: text(6).optional().default(''),
  mobile: text(10).optional().default(''),
  email: text(200).optional().default(''),
  licenceValidFrom: optionalDay,
  licenceValidTo: optionalDay,
  consentGiven: flag,
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedStatus: expected,
});
export type ProfessionalDraftInput = z.infer<typeof professionalDraftSchema>;

export const professionalRemarksSchema = z.object({
  remarks: text(2000).optional().default(''),
  expectedStatus: expected,
});
export type ProfessionalRemarksInput = z.infer<typeof professionalRemarksSchema>;

export const professionalDocumentCheckSchema = z.object({
  index: z.number().int().min(0),
  decision: z.enum(['VERIFIED', 'REJECTED']),
  remarks: text(1000).optional().default(''),
});
export type ProfessionalDocumentCheckInput = z.infer<typeof professionalDocumentCheckSchema>;

export const professionalShortfallSchema = z.object({
  items: z.array(text(500).min(3)).min(1, 'List at least one item.'),
  remarks: text(4000).min(5, 'Record your remarks.'),
  expectedStatus: expected,
});
export type ProfessionalShortfallInput = z.infer<typeof professionalShortfallSchema>;

export const professionalRespondSchema = z.object({
  remarks: text(4000).min(10, 'Say what the LTP has supplied or corrected.'),
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedStatus: expected,
});
export type ProfessionalRespondInput = z.infer<typeof professionalRespondSchema>;

export const professionalVerifySchema = z.object({
  outcome: z.enum(VERIFICATION_OUTCOMES),
  remarks: text(4000).min(5, 'Record what was verified.'),
  expectedStatus: expected,
});
export type ProfessionalVerifyInput = z.infer<typeof professionalVerifySchema>;

export const professionalDecideSchema = z.object({
  decision: z.enum(PROFESSIONAL_DECISIONS),
  remarks: text(4000).min(5, 'Record the reasons for the decision.'),
  expectedStatus: expected,
});
export type ProfessionalDecideInput = z.infer<typeof professionalDecideSchema>;

export const professionalRenewSchema = z.object({
  remarks: text(2000).optional().default(''),
  /** The licence's renewed validity, when the body has extended it. */
  licenceValidTo: optionalDay,
});
export type ProfessionalRenewInput = z.infer<typeof professionalRenewSchema>;

// ── Professional types (Settings) ───────────────────────────────────────────

export const professionalTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Capitals, digits and underscores, starting with a letter.'),
  label: text(80).min(2, 'Name the type.'),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, 'Two to five letters.'),
  canHoldFile: z.boolean().default(false),
  structural: z.boolean().default(false),
  body: text(200).optional().default(''),
  isActive: z.boolean().default(true),
});
export type ProfessionalTypeInput = z.infer<typeof professionalTypeSchema>;
export const updateProfessionalTypeSchema = professionalTypeSchema.omit({ code: true }).partial();
export type UpdateProfessionalTypeInput = z.infer<typeof updateProfessionalTypeSchema>;
