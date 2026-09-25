import { z } from 'zod';

/**
 * What the public portal's endpoints accept. SHAPE only — whether a
 * registration exists, whether the digits match it and whether it is due for
 * renewal are decided by `src/server/public-portal/submissions.ts`.
 *
 * The registration bodies themselves reuse `developerDraftSchema` and
 * `professionalDraftSchema`: the public form fills the same fields the inward
 * desk does, so it is validated by the same schema.
 */

const text = (max: number) => z.string().trim().max(max);
const flag = z
  .union([z.boolean(), z.enum(['true', 'false', 'on', ''])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === 'on');

const registrationNumber = text(40).min(6, 'Enter the registration number.');
const mobileLast4 = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Enter the last four digits of the registered mobile number.');

/** The demonstration payment method chosen with a renewal; empty = pay later from the payment page. */
const payMethod = z.enum(['', 'UPI', 'CARD', 'NETBANKING']).optional().default('');

export const publicRenewalPaymentSchema = z.object({
  kind: z.enum(['DEVELOPER', 'LTP']),
  renewalNumber: text(40).min(6, 'Enter the renewal reference.'),
  mobileLast4,
  method: z.enum(['UPI', 'CARD', 'NETBANKING'], { errorMap: () => ({ message: 'Choose a payment method.' }) }),
});

export const publicFeePaymentSchema = z.object({
  applicationNumber: text(64).min(6, 'Enter the application number.'),
  demandNumber: text(64).min(3, 'Choose the demand to pay.'),
  mobile: z.string().trim().regex(/^(\d{4}|\d{10})$/, 'Enter the applicant’s mobile number (or its last four digits).'),
  outcome: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']).default('SUCCESS'),
});

export const publicDeveloperRenewalSchema = z.object({
  registrationNumber,
  mobileLast4,
  payMethod,
  remarks: text(2000).optional().default(''),
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
});

export const publicLtpRenewalSchema = z.object({
  registrationNumber,
  mobileLast4,
  licenceValidTo: text(10).min(1, 'Enter the date the licence is now valid to.'),
  payMethod,
  consentGiven: flag,
  remarks: text(2000).optional().default(''),
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
});

export const CONSENT_KINDS = ['DEVELOPER', 'LTP', 'TPA'] as const;

export const publicConsentSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  /** The consent reference: a registration number (developer, LTP) or a TPA's name. */
  partyReference: text(120).min(3, 'Enter the consent reference.'),
  /** Optional: the application the consent is asked for. When given it must exist. */
  applicationNumber: text(64).optional().default(''),
  /** `check` only validates the references; `accept` and `decline` record the demonstration answer. */
  action: z.enum(['check', 'accept', 'decline']).default('check'),
});
export type PublicConsentInput = z.infer<typeof publicConsentSchema>;
