import { z } from 'zod';

/**
 * The Others block.
 *
 * ── Why almost everything is optional ────────────────────────────────────
 *
 * A PATCH here is a PARTIAL update — the Others tab saves one card at a time,
 * so a request that carries only the solar fields must leave the mortgage
 * particulars exactly as they were. `.optional()` throughout is what makes the
 * difference between "not sent" and "sent as empty" survive the parse, and the
 * service writes only the keys that actually arrived.
 *
 * ── On dates ─────────────────────────────────────────────────────────────
 *
 * Dates arrive as ISO strings and are coerced, with `null` allowed so a date
 * entered by mistake can be cleared. `z.coerce.date()` on a nonsense string
 * yields an Invalid Date rather than throwing, which would reach Postgres and
 * fail as a 500 — hence the explicit finite check.
 */

const isoDate = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : new Date(v)))
  .refine((d) => d === null || Number.isFinite(d.getTime()), { message: 'That is not a date.' });

const area = z.number().min(0).max(10_000_000).nullable();
const text = z.string().max(500);
const remarks = z.string().max(2000);

export const updateOthersSchema = z
  .object({
    // ── Mortgage ────────────────────────────────────────────────────────
    mortgageApplicable: z.boolean().optional(),
    mortgageNumber: text.optional(),
    mortgageDate: isoDate.optional(),
    mortgageSubRegistrar: text.optional(),
    mortgagePortion: text.optional(),
    mortgageAreaSqm: area.optional(),
    mortgageDocumentId: z.string().uuid().nullable().optional(),

    // ── Car insurance ───────────────────────────────────────────────────
    insuranceApplicable: z.boolean().optional(),
    insurancePolicyNumber: text.optional(),
    insuranceDate: isoDate.optional(),
    insuranceValidUpto: isoDate.optional(),
    insuranceDocumentId: z.string().uuid().nullable().optional(),

    // ── Solar ───────────────────────────────────────────────────────────
    solarRequired: z.boolean().optional(),
    solarProposed: z.boolean().optional(),
    solarInstalled: z.boolean().optional(),
    solarCapacityKw: z.number().min(0).max(100_000).nullable().optional(),
    solarRemarks: remarks.optional(),

    // ── Rainwater harvesting ────────────────────────────────────────────
    rwhRequired: z.boolean().optional(),
    rwhProposed: z.boolean().optional(),
    rwhProvided: z.boolean().optional(),
    rwhRemarks: remarks.optional(),

    // ── Greening and trees ──────────────────────────────────────────────
    greeningRequired: z.boolean().optional(),
    greeningProposed: z.boolean().optional(),
    greeningProvided: z.boolean().optional(),
    treeCount: z.number().int().min(0).max(100_000).nullable().optional(),
    greeningRemarks: remarks.optional(),

    specialRemarks: remarks.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
  .refine(
    // Installed but not proposed is an entry error, not a state of the world:
    // nothing gets installed on a permission that never proposed it, and
    // letting the pair through would put a file into a state the Others screen
    // cannot explain to the officer reading it.
    (v) => !(v.solarInstalled === true && v.solarProposed === false),
    {
      message: 'Solar cannot be installed on a proposal that does not include it.',
      path: ['solarProposed'],
    }
  )
  .refine((v) => !(v.rwhProvided === true && v.rwhProposed === false), {
    message: 'Rainwater harvesting cannot be provided on a proposal that does not include it.',
    path: ['rwhProposed'],
  })
  .refine((v) => !(v.greeningProvided === true && v.greeningProposed === false), {
    message: 'Greening cannot be provided on a proposal that does not include it.',
    path: ['greeningProposed'],
  });

export type UpdateOthersInput = z.infer<typeof updateOthersSchema>;
