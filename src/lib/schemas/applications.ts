import { z } from 'zod';
import { STEP_KEYS, type StepKey } from '@/lib/application-steps';

/**
 * Application validation. Isomorphic — react-hook-form resolves against these
 * on the client and the route wrapper parses the same objects on the server.
 *
 * There is exactly ONE schema per wizard step, and it is used three times:
 * to validate the form, to validate the write, and — at submission — to prove
 * the step was actually completed. A draft can be partial; a filed application
 * cannot, and the same rules decide both.
 *
 * Messages are written for the person filling the form. "Enter the plot area
 * in square metres", not "plotAreaSqm: expected number".
 */

// ── Shared primitives ────────────────────────────────────────────────────

const trimmed = (max: number) => z.string().trim().max(max);

const optionalText = (max = 200) => trimmed(max).optional().default('');

const requiredText = (label: string, max = 200, min = 1) =>
  trimmed(max).min(min, `Enter ${label}`);

/** Ten digits, optionally +91. Matches the users schema so one rule governs both. */
const mobile = trimmed(20).refine(
  (v) => /^(\+91[- ]?)?[6-9]\d{9}$/.test(v),
  'Enter a valid 10-digit mobile number'
);

const optionalMobile = trimmed(20)
  .refine((v) => v === '' || /^(\+91[- ]?)?[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number')
  .optional()
  .default('');

const optionalEmail = trimmed(200)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'That does not look like an email address')
  .optional()
  .default('');

/**
 * A non-negative measurement. Coerced because an HTML number input yields a
 * string, and `''` must read as "not answered" rather than NaN.
 */
const measure = (label: string, max = 1_000_000) =>
  z.coerce
    .number({ invalid_type_error: `Enter ${label} as a number` })
    .min(0, `${cap(label)} cannot be negative`)
    .max(max, `${cap(label)} looks too large — check the units`)
    .default(0);

const positiveMeasure = (label: string, max = 1_000_000) =>
  z.coerce
    .number({ invalid_type_error: `Enter ${label} as a number` })
    .positive(`Enter ${label}`)
    .max(max, `${cap(label)} looks too large — check the units`);

const count = (label: string, max = 200) =>
  z.coerce
    .number({ invalid_type_error: `Enter ${label} as a whole number` })
    .int(`${cap(label)} must be a whole number`)
    .min(0, `${cap(label)} cannot be negative`)
    .max(max, `${cap(label)} looks too large`)
    .default(0);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Treats an empty, whitespace-only or absent value as "not answered".
 *
 * Needed for genuinely optional NUMBER fields. Without it `''` coerces to 0,
 * and "not answered" becomes an assertion that the value is zero.
 */
function blankToNull<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    inner.nullable()
  );
}

// ── Step 1 · Applicant details ───────────────────────────────────────────

export const applicantStepSchema = z.object({
  name: requiredText("the applicant's full name", 150, 2),
  fatherName: optionalText(150),
  email: optionalEmail,
  phone: mobile,
  /**
   * Last four digits only, and the field is named so nobody is tempted to
   * store more. A full Aadhaar number is not needed to identify an applicant
   * on a building file, and holding one creates an obligation the department
   * has not asked for.
   */
  aadhaarLast4: trimmed(4)
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'Enter the last four digits only')
    .optional()
    .default(''),
  panMasked: trimmed(10)
    .transform((v) => v.toUpperCase())
    .refine(
      (v) => v === '' || /^[A-Z]{5}\d{4}[A-Z]$/.test(v),
      'Enter a valid PAN, for example ABCDE1234F'
    )
    .optional()
    .default(''),
  address: requiredText("the applicant's address", 500, 5),
});
export type ApplicantStepInput = z.infer<typeof applicantStepSchema>;

// ── Step 2 · Owner details ───────────────────────────────────────────────

/**
 * When the owner IS the applicant the three owner fields are not required —
 * asking someone to retype their own name and address is how forms earn their
 * reputation. `superRefine` makes the requirement conditional rather than
 * splitting this into two schemas the UI would have to choose between.
 */
export const ownerStepSchema = z
  .object({
    ownerSameAsApplicant: z.coerce.boolean().default(true),
    ownerName: optionalText(150),
    ownerPhone: optionalMobile,
    ownerAddress: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.ownerSameAsApplicant) return;

    if (value.ownerName.trim().length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ownerName'],
        message: "Enter the owner's full name",
      });
    }
    if (!/^(\+91[- ]?)?[6-9]\d{9}$/.test(value.ownerPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ownerPhone'],
        message: "Enter the owner's 10-digit mobile number",
      });
    }
    if (value.ownerAddress.trim().length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ownerAddress'],
        message: "Enter the owner's address",
      });
    }
  });
export type OwnerStepInput = z.infer<typeof ownerStepSchema>;

// ── Step 3 · Property details ────────────────────────────────────────────

export const propertyStepSchema = z.object({
  district: requiredText('the district', 120, 2),
  mandal: optionalText(120),
  village: optionalText(120),
  localityName: optionalText(200),
  wardNo: optionalText(30),
  lpsStatus: optionalText(30),
  planningZone: optionalText(60),
});
export type PropertyStepInput = z.infer<typeof propertyStepSchema>;

// ── Step 4 · Location ────────────────────────────────────────────────────

export const locationStepSchema = z.object({
  /**
   * The zone decides which officers will ever see this file (see
   * applicationScope in src/server/auth/scope.ts), so it is required before
   * filing rather than assigned later by a clerk.
   */
  zoneId: z.string().uuid('Choose the zone this property falls in'),
  doorNo: optionalText(60),
  streetName: requiredText('the street name', 200, 2),
  pincode: trimmed(6)
    .refine((v) => v === '' || /^[1-9]\d{5}$/.test(v), 'Enter a valid 6-digit PIN code')
    .optional()
    .default(''),
  // Optional: not every site has been surveyed to a coordinate at filing time.
  //
  // The preprocess matters. An empty number input submits `''`, and
  // `z.coerce.number('')` is 0 — which would silently plot every unsurveyed
  // site in the Gulf of Guinea. Blank means "not answered", so it becomes null.
  latitude: blankToNull(
    z.coerce
      .number()
      .min(-90, 'Latitude must be between -90 and 90')
      .max(90, 'Latitude must be between -90 and 90')
  ),
  longitude: blankToNull(
    z.coerce
      .number()
      .min(-180, 'Longitude must be between -180 and 180')
      .max(180, 'Longitude must be between -180 and 180')
  ),
  boundaryNorth: optionalText(200),
  boundarySouth: optionalText(200),
  boundaryEast: optionalText(200),
  boundaryWest: optionalText(200),
});
export type LocationStepInput = z.infer<typeof locationStepSchema>;

// ── Step 5 · Survey and plot ─────────────────────────────────────────────

export const surveyStepSchema = z.object({
  surveyNumbers: requiredText('the survey number(s)', 300, 1),
  plotNo: optionalText(60),
  layoutName: optionalText(200),
  lpNumber: optionalText(60),
  plotAreaSqm: positiveMeasure('the plot area in square metres', 10_000_000),
  roadWidthM: measure('the abutting road width in metres', 500),
  landUseZone: optionalText(60),
  tenureType: optionalText(60),
});
export type SurveyStepInput = z.infer<typeof surveyStepSchema>;

// ── Step 6 · Development ─────────────────────────────────────────────────

export const developmentStepSchema = z.object({
  buildingUse: requiredText('the building use', 60),
  buildingSubUse: optionalText(60),
  occupancyType: requiredText('the occupancy type', 60),
  structureType: optionalText(60),
  numFloors: count('the number of floors', 200),
  numBasements: count('the number of basements', 20),
  numDwellingUnits: count('the number of dwelling units', 10_000),
  buildingHeightM: measure('the building height in metres', 1_000),
});
export type DevelopmentStepInput = z.infer<typeof developmentStepSchema>;

// ── Step 7 · Building ────────────────────────────────────────────────────

/**
 * Areas are cross-checked against each other, not merely bounded. Coverage
 * exceeding the plot is a data-entry error the applicant can fix now; letting
 * it reach an officer wastes a review cycle on something arithmetic can catch.
 *
 * These are ARITHMETIC checks only. Whether the achieved FAR or coverage is
 * PERMISSIBLE is a byelaw question, and no byelaw schedule has been supplied —
 * per architectural Rule 6 nothing is invented here. That judgement belongs to
 * scrutiny in Phase 3.
 */
export const buildingStepSchema = z
  .object({
    plotAreaSqm: measure('the plot area', 10_000_000),
    builtUpAreaSqm: positiveMeasure('the built-up area in square metres', 10_000_000),
    floorAreaSqm: measure('the total floor area', 10_000_000),
    coverageAreaSqm: measure('the ground coverage area', 10_000_000),
    parkingAreaSqm: measure('the parking area', 10_000_000),
    setbackFrontM: measure('the front setback', 500),
    setbackRearM: measure('the rear setback', 500),
    setbackLeftM: measure('the left setback', 500),
    setbackRightM: measure('the right setback', 500),
  })
  .superRefine((value, ctx) => {
    if (value.plotAreaSqm > 0 && value.coverageAreaSqm > value.plotAreaSqm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverageAreaSqm'],
        message: 'Ground coverage cannot exceed the plot area',
      });
    }
    if (value.floorAreaSqm > 0 && value.builtUpAreaSqm > 0 && value.floorAreaSqm > value.builtUpAreaSqm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['floorAreaSqm'],
        message: 'Floor area cannot exceed the built-up area',
      });
    }
  });
export type BuildingStepInput = z.infer<typeof buildingStepSchema>;

// ── Step 8 · Licensed technical person ───────────────────────────────────

/**
 * The licence particulars are NOT taken from this form — they are read from
 * the signed-in LTP's own record on the server. Accepting them from the client
 * would let anyone file under any licence number they cared to type.
 *
 * All this step captures is the declaration itself.
 */
export const ltpStepSchema = z.object({
  declarationAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the declaration before filing' }),
  }),
  remarks: optionalText(1000),
  /**
   * The professional register entries named on the file (Phase 12): the
   * filing LTP's own approved registration, and the structural engineer.
   * Ids only — the particulars are read from the register on the server, and
   * each must be approved and in force when the step is saved.
   */
  professionalRegistrationId: z.string().uuid().or(z.literal('')).optional().default(''),
  structuralEngineerRegistrationId: z.string().uuid().or(z.literal('')).optional().default(''),
  /**
   * The developer register entry chosen (Phase 11), where the project has a
   * developer distinct from the owner. Id only — the particulars are read
   * from the register on the server, and it must be approved and in force
   * when the step is saved.
   */
  developerRegistrationId: z.string().uuid().or(z.literal('')).optional().default(''),
});
export type LtpStepInput = z.infer<typeof ltpStepSchema>;

// ── The step registry ────────────────────────────────────────────────────

/**
 * Maps a step key to its schema. The route handler looks the schema up HERE
 * rather than trusting a schema name from the request — the client chooses
 * which step it is saving, never how that step is validated.
 */
export const STEP_SCHEMAS = {
  applicant: applicantStepSchema,
  owner: ownerStepSchema,
  property: propertyStepSchema,
  location: locationStepSchema,
  survey: surveyStepSchema,
  development: developmentStepSchema,
  building: buildingStepSchema,
  ltp: ltpStepSchema,
} as const;

export type DataStepKey = keyof typeof STEP_SCHEMAS;

export const isDataStepKey = (key: string): key is DataStepKey => key in STEP_SCHEMAS;

// ── Create / save / submit payloads ──────────────────────────────────────

export const createApplicationSchema = z.object({
  applicationTypeId: z.string().uuid('Choose an application type'),
  /**
   * Optional head start: the wizard's first step can be submitted with the
   * creation request so a new file is never an empty shell.
   */
  applicant: applicantStepSchema.optional(),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

/**
 * One step's worth of data.
 *
 * `data` stays `unknown` here on purpose. It is parsed a second time against
 * the schema this `step` maps to, inside the service, once the caller's right
 * to write to this application has been established. Validating the payload
 * before the authorization check would let an unauthorised caller probe the
 * shape of the form.
 */
export const saveStepSchema = z.object({
  step: z.enum(STEP_KEYS as unknown as [StepKey, ...StepKey[]]),
  data: z.unknown(),
  /**
   * A save that has not passed its schema. Kept in `application_drafts.scratch`
   * so a half-filled step survives a reload, and never written to the real
   * tables.
   */
  partial: z.boolean().optional().default(false),
});
export type SaveStepInput = z.infer<typeof saveStepSchema>;

export const submitApplicationSchema = z.object({
  /**
   * Re-confirmed at the point of filing. The declaration accepted at step 8
   * is what is recorded; this is the "yes, file it" on the confirmation
   * screen, and its absence is a validation error rather than a silent no-op.
   */
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that the particulars are correct before filing' }),
  }),
});
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;

// ── List query ───────────────────────────────────────────────────────────

/**
 * Sortable columns, as an allow-list.
 *
 * This is a security boundary, not a convenience: `orderBy` is interpolated
 * into a Prisma query, and accepting an arbitrary column name from a query
 * string is how a list endpoint starts leaking the shape of its table.
 */
export const SORTABLE_FIELDS = [
  'updatedAt',
  'createdAt',
  'applicationNumber',
  'status',
  'submittedAt',
  'slaDueAt',
] as const;
export type SortField = (typeof SORTABLE_FIELDS)[number];

/**
 * The derived filters.
 *
 * Each of these asks a question the `status` column cannot answer on its own,
 * and each is resolved against the ROWS that decide it rather than against a
 * cached summary: the payment filter reads the demand ledger and the payment
 * attempts, the scrutiny filter reads the results attached to the ACTIVE
 * drawing versions, the shortfall filter counts shortfall rows. That is what
 * makes "Payment failed — 3" and the three rows it returns the same claim.
 */
export const PAYMENT_FILTERS = ['none', 'unpaid', 'paid', 'failed', 'inflight'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const SCRUTINY_FILTERS = ['none', 'running', 'passed', 'failed'] as const;
export type ScrutinyFilter = (typeof SCRUTINY_FILTERS)[number];

export const SHORTFALL_FILTERS = ['open', 'none', 'resolved', 'document', 'fee'] as const;
export type ShortfallFilter = (typeof SHORTFALL_FILTERS)[number];

export const SLA_FILTERS = ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'PAUSED', 'none'] as const;
export type SlaFilter = (typeof SLA_FILTERS)[number];

export const applicationListQuerySchema = z.object({
  /** Free text over application number, applicant name and survey number. */
  q: trimmed(120).optional(),
  /** Repeatable: ?status=DRAFT&status=SUBMITTED. */
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(toArray),
  applicationTypeId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  /** A named bucket from the dashboard KPI tiles. See STATUS_BUCKETS. */
  bucket: z.string().max(40).optional(),
  /** `applications.currentStageCode` — which desk the file is at. */
  stage: z.string().max(60).optional(),
  payment: z.enum(PAYMENT_FILTERS).optional(),
  scrutiny: z.enum(SCRUTINY_FILTERS).optional(),
  shortfall: z.enum(SHORTFALL_FILTERS).optional(),
  sla: z.enum(SLA_FILTERS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(SORTABLE_FIELDS).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : value.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * Parses a URLSearchParams into the list query, preserving repeated keys.
 *
 * `Object.fromEntries` keeps only the LAST value of a repeated key, which
 * would silently drop every status filter but one.
 */
export function parseListQuery(searchParams: URLSearchParams): ApplicationListQuery {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0]!;
  }
  return applicationListQuerySchema.parse(raw);
}
