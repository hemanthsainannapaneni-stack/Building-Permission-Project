import { z } from 'zod';

/**
 * What may be sent to the commencement endpoint. SHAPE only — whether the
 * file is approved, the order issued and the date within the permission is
 * decided by the service and, finally, by the workflow engine.
 */

const text = (max: number) => z.string().trim().max(max);

const flag = z
  .union([z.boolean(), z.enum(['true', 'false', ''])])
  .optional()
  .transform((v) => v === true || v === 'true');

/** Arrives as MULTIPART — every field a string. Documents travel as files. */
export const notifyCommencementSchema = z.object({
  commencementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the commencement date.'),
  contractorName: text(200).min(2, 'Name the contractor carrying out the work.'),
  contractorLicenceNo: text(100).optional().default(''),
  contractorPhone: text(30).optional().default(''),
  contractorAddress: text(500).optional().default(''),
  remarks: text(4000).optional().default(''),
  /** Demo mode only: labelled placeholders for the kinds in `demoKinds` not uploaded. */
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedSequence: z.coerce.number().int().optional(),
});
export type NotifyCommencementInput = z.infer<typeof notifyCommencementSchema>;
