import { z } from 'zod';
import { AS_BUILT_PARAMETERS, INSPECTION_RECOMMENDATIONS, OCCUPANCY_DECISIONS, REVIEW_RECOMMENDATIONS } from '@/lib/occupancy';

/**
 * What may be sent to the occupancy endpoints. SHAPE only — whose step it is,
 * whether the application is at that step and whether the workflow allows it
 * are decided by the service and the engine. Multipart bodies arrive as
 * strings; the as-built figures travel as one JSON field.
 */

const text = (max: number) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Enter a date.');
const flag = z
  .union([z.boolean(), z.enum(['true', 'false', ''])])
  .optional()
  .transform((v) => v === true || v === 'true');
const expected = z.string().optional();

export const submitOccupancySchema = z.object({
  completionDate: day,
  remarks: text(4000).optional().default(''),
  demoDocuments: flag,
  /** Comma-separated kinds to add as demo placeholders. */
  demoKinds: z.string().optional().default(''),
});
export type SubmitOccupancyInput = z.infer<typeof submitOccupancySchema>;

export const scheduleOccupancySchema = z.object({
  scheduledFor: day,
  inspectorId: z.string().uuid('Choose the inspector.'),
  remarks: text(2000).optional().default(''),
  expectedStatus: expected,
});
export type ScheduleOccupancyInput = z.infer<typeof scheduleOccupancySchema>;

const figure = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});
const asBuiltShape = z.object(Object.fromEntries(AS_BUILT_PARAMETERS.map((p) => [p.key, figure])) as Record<string, typeof figure>);

export const inspectOccupancySchema = z.object({
  inspectionDate: day,
  siteCondition: text(2000).min(3, 'Describe the site condition.'),
  actualConstruction: text(4000).min(3, 'Describe the construction found.'),
  approvedConstruction: text(4000).optional().default(''),
  deviations: text(4000).optional().default(''),
  remarks: text(4000).min(3, 'Record your remarks.'),
  recommendation: z.enum(INSPECTION_RECOMMENDATIONS),
  asBuilt: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .transform((v) => {
      if (!v) return {};
      try {
        return typeof v === 'string' ? JSON.parse(v) : v;
      } catch {
        return {};
      }
    })
    .pipe(asBuiltShape.partial()),
  /** Demo mode only: fill blank figures with generated ones, labelled DEMO. */
  demoAsBuilt: flag,
  demoVariant: z.enum(['COMPLIANT', 'DEVIATION']).optional().default('COMPLIANT'),
  /** Demo mode only: a labelled placeholder for each view not uploaded. */
  demoPhotos: flag,
  expectedStatus: expected,
});
export type InspectOccupancyInput = z.infer<typeof inspectOccupancySchema>;

export const recommendOccupancySchema = z.object({
  recommendation: z.enum(REVIEW_RECOMMENDATIONS),
  remarks: text(4000).min(5, 'Record the reasons for your recommendation.'),
  expectedStatus: expected,
});
export type RecommendOccupancyInput = z.infer<typeof recommendOccupancySchema>;

export const shortfallOccupancySchema = z.object({
  items: z.array(text(500).min(3)).min(1, 'List at least one item.'),
  remarks: text(4000).min(5, 'Record your remarks.'),
  expectedStatus: expected,
});
export type ShortfallOccupancyInput = z.infer<typeof shortfallOccupancySchema>;

export const respondOccupancySchema = z.object({
  remarks: text(4000).min(10, 'Say what was put right.'),
  demoDocuments: flag,
  demoKinds: z.string().optional().default(''),
  expectedStatus: expected,
});
export type RespondOccupancyInput = z.infer<typeof respondOccupancySchema>;

export const decideOccupancySchema = z.object({
  decision: z.enum(OCCUPANCY_DECISIONS),
  remarks: text(4000).min(5, 'Record the reasons for the decision.'),
  expectedStatus: expected,
});
export type DecideOccupancyInput = z.infer<typeof decideOccupancySchema>;

export const issueOccupancySchema = z.object({
  remarks: text(2000).optional().default(''),
  expectedStatus: expected,
});
