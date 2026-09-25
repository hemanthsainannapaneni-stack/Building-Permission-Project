import { z } from 'zod';
import { DEVELOPER_DECISIONS, DEVELOPER_TYPES, VERIFICATION_OUTCOMES } from '@/lib/developer-registration';

/**
 * What may be sent to the developer registration endpoints. SHAPE only —
 * whose step it is and whether the registration is at that step are decided
 * by the service. A draft may be saved incomplete, so the particulars here are
 * lenient; `particularsProblems` holds the rules submission enforces.
 * Multipart bodies arrive as strings.
 */

const text = (max: number) => z.string().trim().max(max);
const flag = z
  .union([z.boolean(), z.enum(['true', 'false', ''])])
  .optional()
  .transform((v) => v === true || v === 'true');
const expected = z.string().optional();
const count = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 500) {
      ctx.addIssue({ code: 'custom', message: 'Enter a whole number.' });
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

export const developerDraftSchema = z.object({
  developerType: z.enum(DEVELOPER_TYPES, { errorMap: () => ({ message: 'Choose the developer type.' }) }),
  developerName: text(200).min(2, 'Enter the developer’s name.'),
  organization: text(200).optional().default(''),
  authorizedPerson: text(200).optional().default(''),
  authorizedDesignation: text(120).optional().default(''),
  address: text(1000).optional().default(''),
  district: text(120).optional().default(''),
  pincode: text(6).optional().default(''),
  mobile: text(10).optional().default(''),
  email: text(200).optional().default(''),
  pan: text(10).optional().default('').transform((v) => v.toUpperCase()),
  gstin: text(15).optional().default('').transform((v) => v.toUpperCase()),
  incorporationNo: text(60).optional().default(''),
  incorporationDate: optionalDay,
  reraNo: text(60).optional().default(''),
  experienceYears: count,
  projectsCompleted: count,
  registrationInfo: text(4000).optional().default(''),
  /** Demo mode only: comma-separated document kinds to add as labelled placeholders. */
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedStatus: expected,
});
export type DeveloperDraftInput = z.infer<typeof developerDraftSchema>;

export const developerSubmitSchema = z.object({
  remarks: text(2000).optional().default(''),
  expectedStatus: expected,
});
export type DeveloperSubmitInput = z.infer<typeof developerSubmitSchema>;

export const developerTakeUpSchema = developerSubmitSchema;

export const developerShortfallSchema = z.object({
  items: z.array(text(500).min(3)).min(1, 'List at least one item.'),
  remarks: text(4000).min(5, 'Record your remarks.'),
  expectedStatus: expected,
});
export type DeveloperShortfallInput = z.infer<typeof developerShortfallSchema>;

export const developerRespondSchema = z.object({
  remarks: text(4000).min(10, 'Say what the developer has supplied or corrected.'),
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedStatus: expected,
});
export type DeveloperRespondInput = z.infer<typeof developerRespondSchema>;

export const developerVerifySchema = z.object({
  outcome: z.enum(VERIFICATION_OUTCOMES),
  remarks: text(4000).min(5, 'Record what was verified.'),
  expectedStatus: expected,
});
export type DeveloperVerifyInput = z.infer<typeof developerVerifySchema>;

export const developerDecideSchema = z.object({
  decision: z.enum(DEVELOPER_DECISIONS),
  remarks: text(4000).min(5, 'Record the reasons for the decision.'),
  expectedStatus: expected,
});
export type DeveloperDecideInput = z.infer<typeof developerDecideSchema>;

export const developerRenewSchema = z.object({
  remarks: text(2000).optional().default(''),
});
export type DeveloperRenewInput = z.infer<typeof developerRenewSchema>;
