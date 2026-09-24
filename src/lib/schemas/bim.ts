import { z } from 'zod';
import {
  AUTHORING_TOOLS,
  BIM_CONTENT_ITEMS,
  BIM_DISCIPLINES,
  CLASSIFICATION_SYSTEMS,
  CRS_OPTIONS,
  IFC_SCHEMAS,
  INFORMATION_STANDARDS,
  LENGTH_UNITS,
  LOD_LEVELS,
  MODEL_VIEW_DEFINITIONS,
  REVIEW_STATUSES,
  VERTICAL_DATUMS,
  codesOf,
  type Option,
} from '@/lib/bim';

/**
 * The BIM particulars.
 *
 * A PATCH is PARTIAL, as on the Others tab: the BIM tab saves one card at a
 * time, and `.optional()` throughout keeps "not sent" apart from "sent as
 * empty" all the way to the update.
 *
 * Coded fields accept a listed code or the empty string (cleared). Anything
 * else is refused here, because an unrecognised LOD or schema would reach the
 * readiness check as a value it cannot rank.
 */

const code = (list: Option[]) =>
  z.string().refine((v) => v === '' || codesOf(list).includes(v), { message: 'Choose one of the listed values.' });

const isoDate = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : new Date(v)))
  .refine((d) => d === null || Number.isFinite(d.getTime()), { message: 'That is not a date.' });

const text = z.string().trim().max(200);
const area = z.number().min(0).max(10_000_000).nullable();
const length = z.number().min(0).max(1_000).nullable();
const count = z.number().int().min(0).max(100_000).nullable();

const storey = z.object({
  name: z.string().trim().min(1).max(100),
  elevationM: z.number().min(-100).max(1_000).nullable(),
  heightM: z.number().min(0).max(100).nullable(),
  grossAreaSqm: area,
  use: z.string().trim().max(100),
});

const contentCodes = BIM_CONTENT_ITEMS.map((i) => i.code);

export const updateBimSchema = z
  .object({
    // ── Model identity ─────────────────────────────────────────────────
    modelReference: text.optional(),
    authoringSoftware: code(AUTHORING_TOOLS).optional(),
    authoringVersion: text.optional(),
    ifcSchema: code(IFC_SCHEMAS).optional(),
    modelViewDefinition: code(MODEL_VIEW_DEFINITIONS).optional(),
    levelOfDevelopment: code(LOD_LEVELS).optional(),
    classificationSystem: code(CLASSIFICATION_SYSTEMS).optional(),
    lengthUnit: code(LENGTH_UNITS).optional(),
    disciplines: z
      .array(z.string().refine((v) => codesOf(BIM_DISCIPLINES).includes(v)))
      .max(BIM_DISCIPLINES.length)
      .transform((v) => [...new Set(v)])
      .optional(),

    // ── Georeferencing ─────────────────────────────────────────────────
    crsCode: code(CRS_OPTIONS).optional(),
    verticalDatum: code(VERTICAL_DATUMS).optional(),
    siteLatitude: z.number().min(-90).max(90).nullable().optional(),
    siteLongitude: z.number().min(-180).max(180).nullable().optional(),
    originEasting: z.number().min(-10_000_000).max(10_000_000).nullable().optional(),
    originNorthing: z.number().min(-10_000_000).max(20_000_000).nullable().optional(),
    originHeightM: z.number().min(-500).max(9_000).nullable().optional(),
    trueNorthDeg: z.number().min(-360).max(360).nullable().optional(),

    // ── Model quantities ───────────────────────────────────────────────
    modelPlotAreaSqm: area.optional(),
    modelBuiltUpAreaSqm: area.optional(),
    modelCoverageAreaSqm: area.optional(),
    modelFarAreaSqm: area.optional(),
    modelBuildingHeightM: length.optional(),
    modelNumFloors: count.optional(),
    modelNumBasements: count.optional(),
    modelDwellingUnits: count.optional(),
    modelParkingSpaces: count.optional(),
    modelSetbackFrontM: length.optional(),
    modelSetbackRearM: length.optional(),
    modelSetbackLeftM: length.optional(),
    modelSetbackRightM: length.optional(),
    storeys: z.array(storey).max(200).optional(),
    contentChecklist: z
      .record(z.string(), z.boolean())
      .refine((v) => Object.keys(v).every((k) => contentCodes.includes(k)), {
        message: 'Unknown model content item.',
      })
      .optional(),

    // ── Coordination ───────────────────────────────────────────────────
    clashDetectionDone: z.boolean().optional(),
    clashTool: text.optional(),
    clashDetectionDate: isoDate.optional(),
    unresolvedHardClashes: count.optional(),
    unresolvedSoftClashes: count.optional(),
    ifcValidationDone: z.boolean().optional(),
    ifcValidationTool: text.optional(),
    drawingsFromModel: z.boolean().optional(),

    // ── Information management ─────────────────────────────────────────
    bepReference: text.optional(),
    cdePlatform: text.optional(),
    informationStandard: code(INFORMATION_STANDARDS).optional(),
    bimManagerName: text.optional(),
    bimManagerOrganisation: text.optional(),
    bimManagerEmail: z.union([z.literal(''), z.string().trim().email().max(200)]).optional(),
    bimManagerPhone: z
      .union([z.literal(''), z.string().trim().regex(/^[+0-9 ()-]{6,20}$/, 'That is not a phone number.')])
      .optional(),
    bimManagerCredential: text.optional(),

    remarks: z.string().max(2000).optional(),

    /** true records the LTP declaration against the current model; false withdraws it. */
    declare: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
  .refine(
    (v) => !(v.unresolvedHardClashes != null && v.clashDetectionDone === false),
    { message: 'Clashes cannot be reported without clash detection.', path: ['clashDetectionDone'] }
  );

export type UpdateBimInput = z.infer<typeof updateBimSchema>;

export const reviewBimSchema = z
  .object({
    reviewStatus: code(REVIEW_STATUSES).refine((v) => v !== '', { message: 'Choose a review outcome.' }),
    reviewRemarks: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.reviewStatus !== 'CORRECTIONS_REQUIRED' || v.reviewRemarks.length >= 10, {
    message: 'Say what needs correcting — the LTP reads this.',
    path: ['reviewRemarks'],
  });

export type ReviewBimInput = z.infer<typeof reviewBimSchema>;
