import { isValidResponse } from './checklist';

/**
 * The site inspection vocabulary. Isomorphic — the service, the seed and the
 * inspection screens all read these names, and the readiness rules below run
 * unchanged on both sides of the wire.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE 27 QUESTIONS ARE NOT IN THIS FILE, AND THEY ARE NOT OFFICIAL WORDING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * They are rows in `checklist_item_definitions` with kind SITE_INSPECTION,
 * seeded by prisma/seed/12-checklists.ts from the SUBJECT AREAS the TPA manual
 * (§5.8.1) names — boundaries, road width, encroachment, HT lines, water
 * bodies, access, topography, existing structures, trees, layout conformity,
 * site and surrounding conditions. The manuals do not reproduce the questions
 * as text, so every screen that shows them carries PROVISIONAL_QUESTIONS_LABEL
 * and nothing anywhere claims they are verbatim BBAS wording.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  NOTHING HERE IS A REAL SIGNATURE OR A REAL GPS FIX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both signature methods are demonstrations, named as such in their codes, and
 * every coordinate is a demo coordinate derived from the site's district. The
 * shapes are the ones a real integration would fill — method, reference,
 * document hash, signer, time; latitude, longitude, capture time — so
 * replacing the demo providers changes where the values come from and nothing
 * about how they are stored or shown.
 */

export const PROVISIONAL_QUESTIONS_LABEL = 'PROVISIONAL DEMO SITE INSPECTION QUESTIONS';

export const PROVISIONAL_QUESTIONS_NOTE =
  'The supplied BBAS manuals describe the 27-point site inspection checklist by subject area only. ' +
  'These questions are demo wording written from those subject areas — they are not the official ' +
  'BBAS text, and an administrator can replace them in Settings → Checklists.';

// ── Inspection status ───────────────────────────────────────────────────────

export const INSPECTION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'SUBMITTED'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_STATUS = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
} as const satisfies Record<string, InspectionStatus>;

/** Still open: the inspector may write to it. */
export const OPEN_INSPECTION_STATUSES: readonly InspectionStatus[] = ['SCHEDULED', 'IN_PROGRESS'];

export const isInspectionOpen = (status: string): boolean =>
  (OPEN_INSPECTION_STATUSES as readonly string[]).includes(status);

export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
};

// ── Per-question status ─────────────────────────────────────────────────────

/**
 * What the inspector found on one point.
 *
 * SHORTFALL and OBJECTION are distinct for the same reason they are on the
 * application checklist: a shortfall is curable — the boundary stones are
 * missing, the applicant puts them in — and an objection is a finding against
 * the proposal that no amount of paper changes, like a building line that
 * falls inside a water body's buffer. The recommendation has to agree with
 * which of the two was found; see `inspectionReadiness`.
 */
export const QUESTION_STATUSES = ['PENDING', 'SATISFACTORY', 'SHORTFALL', 'OBJECTION', 'NA'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  PENDING: 'Pending',
  SATISFACTORY: 'Satisfactory',
  SHORTFALL: 'Shortfall',
  OBJECTION: 'Objection',
  NA: 'Not applicable',
};

export const QUESTION_STATUS_TONE: Record<
  QuestionStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  PENDING: 'neutral',
  SATISFACTORY: 'success',
  SHORTFALL: 'warning',
  OBJECTION: 'danger',
  NA: 'info',
};

export const isQuestionStatus = (value: string): value is QuestionStatus =>
  (QUESTION_STATUSES as readonly string[]).includes(value);

// ── Recommendation ──────────────────────────────────────────────────────────

export const RECOMMENDATIONS = ['RECOMMENDED', 'SHORTFALL', 'REJECT'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  RECOMMENDED: 'Recommended for Approval',
  SHORTFALL: 'Shortfall',
  REJECT: 'Reject',
};

export const RECOMMENDATION_TONE: Record<Recommendation, 'success' | 'warning' | 'danger'> = {
  RECOMMENDED: 'success',
  SHORTFALL: 'warning',
  REJECT: 'danger',
};

export const isRecommendation = (value: string): value is Recommendation =>
  (RECOMMENDATIONS as readonly string[]).includes(value);

/**
 * What submitting each recommendation does to the file.
 *
 * Action CODES, not destinations: where each action sends the file is a row in
 * `workflow_transitions`, and the engine alone reads it. REJECT does not
 * reject anything — the inspecting TPA holds no rejection authority, which in
 * BBAS_STANDARD belongs to the ZJD alone. The recommendation travels up the
 * chain with the file and is what the deciding desk reads.
 */
export const RECOMMENDATION_ACTION: Record<Recommendation, string> = {
  RECOMMENDED: 'SUBMIT_SITE_INSPECTION',
  REJECT: 'SUBMIT_SITE_INSPECTION',
  SHORTFALL: 'RAISE_INSPECTION_SHORTFALL',
};

export const RECOMMENDATION_OUTCOME: Record<Recommendation, string> = {
  RECOMMENDED: 'The report is locked and the file moves to the next desk with a recommendation to approve.',
  REJECT:
    'The report is locked and the file moves to the next desk with a recommendation to reject. ' +
    'Only the deciding authority can refuse the application.',
  SHORTFALL:
    'The report is locked, a technical shortfall listing every point marked Shortfall is raised, and ' +
    'the file goes back to the applicant. It returns to this desk when they respond.',
};

// ── Photographs ─────────────────────────────────────────────────────────────

export const PHOTO_CATEGORIES = [
  'NORTH',
  'SOUTH',
  'EAST',
  'WEST',
  'ACCESS_ROAD',
  'BOUNDARY',
  'ENCUMBRANCE',
  'EXISTING_STRUCTURE',
  'OTHER',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  NORTH: 'North',
  SOUTH: 'South',
  EAST: 'East',
  WEST: 'West',
  ACCESS_ROAD: 'Access Road',
  BOUNDARY: 'Boundary',
  ENCUMBRANCE: 'Encumbrance',
  EXISTING_STRUCTURE: 'Existing Structure',
  OTHER: 'Other',
};

export const isPhotoCategory = (value: string): value is PhotoCategory =>
  (PHOTO_CATEGORIES as readonly string[]).includes(value);

/**
 * The four views a report cannot be submitted without.
 *
 * A demonstration rule, stated rather than hidden: the manuals ask for
 * geo-tagged site photographs without saying which, and the four cardinal
 * views are the minimum from which somebody who has not visited can check a
 * boundary on the ground against the one on the drawing.
 */
export const REQUIRED_PHOTO_CATEGORIES: readonly PhotoCategory[] = ['NORTH', 'SOUTH', 'EAST', 'WEST'];

/** Which way the camera faces for each view, used to lay photographs on the map. */
export const PHOTO_BEARING: Partial<Record<PhotoCategory, number>> = {
  NORTH: 0,
  EAST: 90,
  SOUTH: 180,
  WEST: 270,
};

export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// ── Signature (DEMO) ────────────────────────────────────────────────────────

export const SIGNATURE_METHODS = ['AADHAAR_ESIGN_DEMO', 'USB_TOKEN_DEMO'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const SIGNATURE_METHOD_LABEL: Record<SignatureMethod, string> = {
  AADHAAR_ESIGN_DEMO: 'Aadhaar eSign — Demo',
  USB_TOKEN_DEMO: 'USB Token — Demo',
};

/**
 * The published demo credentials.
 *
 * Printed on the signing dialog in plain sight. They authenticate nothing —
 * they exist so the ceremony of signing (a second factor, a deliberate act)
 * can be shown without pretending to be the real thing.
 */
export const DEMO_ESIGN_OTP = '123456';
export const DEMO_TOKEN_PIN = '1234';

export const DEMO_SIGNATURE_DISCLAIMER =
  'Demonstration signature. No Aadhaar eSign service or DSC token was contacted, and this signature ' +
  'has no legal effect.';

// ── Location (DEMO) ─────────────────────────────────────────────────────────

/**
 * Approximate district centres for the districts the demo dataset uses.
 *
 * Public, city-level positions, rounded. They exist so a demo site lands in
 * the right part of the state; they are not survey data and nothing is
 * measured from them.
 */
const DISTRICT_CENTRES: Record<string, { latitude: number; longitude: number }> = {
  guntur: { latitude: 16.3067, longitude: 80.4365 },
  krishna: { latitude: 16.5062, longitude: 80.648 },
  visakhapatnam: { latitude: 17.6868, longitude: 83.2185 },
  nellore: { latitude: 14.4426, longitude: 79.9865 },
  kurnool: { latitude: 15.8281, longitude: 78.0373 },
  anantapur: { latitude: 14.6819, longitude: 77.6006 },
};

const DEFAULT_CENTRE = { latitude: 16.5062, longitude: 80.648 };

/** FNV-1a, 32-bit. Deterministic across machines, which Math.random is not. */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A DEMO site location: the district's centre, displaced by up to ~5 km in a
 * direction derived from `seed` (the application id).
 *
 * Deterministic, so the same file lands on the same spot on every screen and
 * every machine. Not a GPS reading and never described as one.
 */
export function demoSiteLocation(seed: string, district?: string | null) {
  const centre = DISTRICT_CENTRES[(district ?? '').trim().toLowerCase()] ?? DEFAULT_CENTRE;
  const h = hash32(seed);
  const dLat = (((h & 0xffff) / 0xffff) * 2 - 1) * 0.045;
  const dLng = ((((h >>> 16) & 0xffff) / 0xffff) * 2 - 1) * 0.045;
  return { latitude: round6(centre.latitude + dLat), longitude: round6(centre.longitude + dLng) };
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** The point `metres` away from (lat, lng) along `bearing` degrees. */
export function offsetCoordinates(
  latitude: number,
  longitude: number,
  bearing: number,
  metres: number
): { latitude: number; longitude: number } {
  const d = metres / EARTH_RADIUS_M;
  const b = toRad(bearing);
  const lat1 = toRad(latitude);
  const lng1 = toRad(longitude);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { latitude: round6(toDeg(lat2)), longitude: round6(toDeg(lng2)) };
}

/** Great-circle distance in metres. */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * East/north offset of `point` from `centre`, in metres. An equirectangular
 * projection — exact enough across a plot, and the map it feeds is schematic.
 */
export function localOffsetMetres(
  centre: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number }
): { east: number; north: number } {
  const north = toRad(point.latitude - centre.latitude) * EARTH_RADIUS_M;
  const east =
    toRad(point.longitude - centre.longitude) * EARTH_RADIUS_M * Math.cos(toRad(centre.latitude));
  return { east, north };
}

export const isValidLatitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

/** "16.306700° N, 80.436500° E" */
export function formatCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): string {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return '—';
  const lat = `${Math.abs(latitude).toFixed(6)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(longitude).toFixed(6)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng}`;
}

// ── Readiness ───────────────────────────────────────────────────────────────

export type ReadinessIssue = { path: string; message: string };

export type ReadinessInput = {
  /** The day the inspection was booked — the earliest date a visit can carry. */
  scheduledOn: Date | string;
  inspectedAt: Date | string | null;
  latitude: number | null;
  longitude: number | null;
  recommendation: string;
  recommendationRemarks: string;
  responses: Array<{
    itemNumber: number;
    responseType: string;
    isMandatory: boolean;
    response: string;
    observation: string;
    status: string;
  }>;
  photos: Array<{ category: string }>;
  now?: Date;
};

export const MIN_RECOMMENDATION_REMARKS = 10;

const dayOf = (value: Date | string) => {
  const d = typeof value === 'string' ? new Date(value) : value;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Everything that must be true before a report can be signed.
 *
 * Returns EVERY problem rather than the first, so the inspector fixes the
 * report in one pass instead of discovering a new objection each time they
 * press Sign. The service runs this exact function inside the signing
 * transaction; the screen runs it to decide what to highlight. A report the
 * screen calls ready cannot then be refused for a reason the screen did not
 * know about.
 */
export function inspectionReadiness(input: ReadinessInput): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const now = input.now ?? new Date();

  // ── When ───────────────────────────────────────────────────────────────
  if (!input.inspectedAt) {
    issues.push({ path: 'inspectedAt', message: 'Record the date the site was inspected.' });
  } else {
    const inspected = new Date(input.inspectedAt);
    if (Number.isNaN(inspected.getTime())) {
      issues.push({ path: 'inspectedAt', message: 'The inspection date is not a valid date.' });
    } else {
      if (inspected.getTime() > now.getTime() + 5 * 60_000) {
        issues.push({ path: 'inspectedAt', message: 'The inspection date cannot be in the future.' });
      }
      if (dayOf(inspected) < dayOf(input.scheduledOn)) {
        issues.push({
          path: 'inspectedAt',
          message: 'The inspection date is earlier than the day the inspection was scheduled.',
        });
      }
    }
  }

  // ── Where ──────────────────────────────────────────────────────────────
  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
    issues.push({ path: 'location', message: 'Record the inspection location (latitude and longitude).' });
  }

  // ── The 27 questions ───────────────────────────────────────────────────
  let shortfalls = 0;
  let objections = 0;

  for (const r of input.responses) {
    const path = `responses.${r.itemNumber}`;
    const answered = r.response.trim().length > 0;

    if (answered && !isValidResponse(r.responseType, r.response)) {
      issues.push({ path, message: `Question ${r.itemNumber}: that answer does not fit the question.` });
    }

    if (r.isMandatory && !answered) {
      issues.push({ path, message: `Question ${r.itemNumber} has not been answered.` });
    }

    if (!isQuestionStatus(r.status) || r.status === 'PENDING') {
      if (r.isMandatory || answered) {
        issues.push({ path, message: `Question ${r.itemNumber} has no status — mark what was found.` });
      }
    }

    if ((r.status === 'SHORTFALL' || r.status === 'OBJECTION') && !r.observation.trim()) {
      issues.push({
        path,
        message: `Question ${r.itemNumber} is marked ${QUESTION_STATUS_LABEL[r.status]} — record what was observed.`,
      });
    }

    if (r.status === 'SHORTFALL') shortfalls += 1;
    if (r.status === 'OBJECTION') objections += 1;
  }

  // ── Photographs ────────────────────────────────────────────────────────
  const taken = new Set(input.photos.map((p) => p.category));
  const missing = REQUIRED_PHOTO_CATEGORIES.filter((c) => !taken.has(c));
  if (missing.length) {
    issues.push({
      path: 'photos',
      message: `Geo-tagged photographs are still needed for: ${missing.map((c) => PHOTO_CATEGORY_LABEL[c]).join(', ')}.`,
    });
  }

  // ── The recommendation, and whether it agrees with the findings ───────
  if (!isRecommendation(input.recommendation)) {
    issues.push({ path: 'recommendation', message: 'Choose a recommendation.' });
  } else {
    if (input.recommendation === 'RECOMMENDED' && shortfalls + objections > 0) {
      issues.push({
        path: 'recommendation',
        message:
          `${shortfalls + objections} ${shortfalls + objections === 1 ? 'question records' : 'questions record'} ` +
          'a shortfall or objection. A site with deviations cannot be recommended for approval.',
      });
    }
    if (input.recommendation === 'SHORTFALL') {
      if (shortfalls === 0) {
        issues.push({
          path: 'recommendation',
          message: 'A shortfall recommendation needs at least one question marked Shortfall — those become the shortfall items.',
        });
      }
      if (objections > 0) {
        issues.push({
          path: 'recommendation',
          message: 'An objection cannot be cured by a shortfall. Recommend rejection, or re-assess the question marked Objection.',
        });
      }
    }
    if (input.recommendation === 'REJECT' && shortfalls + objections === 0) {
      issues.push({
        path: 'recommendation',
        message: 'A rejection recommendation needs at least one question marked Shortfall or Objection to rest on.',
      });
    }
  }

  if (input.recommendationRemarks.trim().length < MIN_RECOMMENDATION_REMARKS) {
    issues.push({
      path: 'recommendationRemarks',
      message: 'Remarks are required with the recommendation — say, in a sentence, what it rests on.',
    });
  }

  return issues;
}

/** Counts for the header: "22 satisfactory · 3 shortfall · 2 not applicable". */
export function questionTally(responses: Array<{ status: string; response: string }>) {
  const tally = { total: responses.length, answered: 0, satisfactory: 0, shortfall: 0, objection: 0, na: 0, pending: 0 };
  for (const r of responses) {
    if (r.response.trim()) tally.answered += 1;
    if (r.status === 'SATISFACTORY') tally.satisfactory += 1;
    else if (r.status === 'SHORTFALL') tally.shortfall += 1;
    else if (r.status === 'OBJECTION') tally.objection += 1;
    else if (r.status === 'NA') tally.na += 1;
    else tally.pending += 1;
  }
  return tally;
}

// ── The signed document ─────────────────────────────────────────────────────

export type CanonicalReportInput = {
  inspectionNumber: string;
  applicationNumber: string;
  round: number;
  inspectorName: string;
  scheduledFor: Date | string;
  inspectedAt: Date | string | null;
  latitude: number | null;
  longitude: number | null;
  generalObservation: string;
  recommendation: string;
  recommendationRemarks: string;
  responses: Array<{
    itemNumber: number;
    question: string;
    response: string;
    observation: string;
    remarks: string;
    status: string;
  }>;
  photos: Array<{
    id: string;
    category: string;
    latitude: number;
    longitude: number;
    capturedAt: Date | string;
    description: string;
  }>;
};

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

/**
 * The exact byte sequence a signature is over.
 *
 * Key order is fixed by construction and arrays are sorted by a stable key, so
 * the same report always serialises to the same string — which is what lets
 * `documentHash` be recomputed later and compared. Anything that is part of
 * the finding is in here; anything that is bookkeeping (row ids of responses,
 * updatedAt) is not, so tidying a row cannot "break" a signature.
 */
export function canonicalReport(input: CanonicalReportInput): string {
  return JSON.stringify({
    inspectionNumber: input.inspectionNumber,
    applicationNumber: input.applicationNumber,
    round: input.round,
    inspector: input.inspectorName,
    scheduledFor: iso(input.scheduledFor),
    inspectedAt: iso(input.inspectedAt),
    location: { latitude: input.latitude, longitude: input.longitude },
    generalObservation: input.generalObservation.trim(),
    recommendation: input.recommendation,
    recommendationRemarks: input.recommendationRemarks.trim(),
    responses: [...input.responses]
      .sort((a, b) => a.itemNumber - b.itemNumber)
      .map((r) => [r.itemNumber, r.question, r.response, r.observation.trim(), r.remarks.trim(), r.status]),
    photos: [...input.photos]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.category, p.latitude, p.longitude, iso(p.capturedAt), p.description.trim()]),
  });
}
