/**
 * Occupancy — the vocabulary, the state machine and the as-built comparison.
 * Isomorphic: the service, the workflow effect, the seed, the screens and the
 * tests all read these.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  COMPLETION → SUBMISSION → FINAL INSPECTION → AS-BUILT REVIEW
 *             → RECOMMENDATION → DECISION → OCCUPANCY CERTIFICATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   (no application)      COMPLETION_PENDING    work initiated, completion not intimated — DERIVED
 *   LTP: Submit        ─▶ SUBMITTED             completion intimated, occupancy applied for
 *   TPA: Schedule      ─▶ INSPECTION_PENDING    final inspection booked
 *   TPA: Inspect       ─▶ INSPECTION_COMPLETED  (recommendation RECOMMENDED or REJECT)
 *                      └▶ SHORTFALL             (recommendation SHORTFALL)
 *   ZDD: Recommend     ─▶ RECOMMENDED           as-built reviewed; recommends approval or rejection
 *   ZDD: Shortfall     ─▶ SHORTFALL
 *   LTP: Respond       ─▶ SUBMITTED             (next round: inspected again)
 *   ZJD: Approve       ─▶ APPROVED
 *   ZJD: Reject        ─▶ REJECTED              (terminal — a fresh application may follow)
 *   ZJD: Issue         ─▶ CERTIFICATE_ISSUED    (terminal — certificate + Outward entry)
 *
 * Every step is a workflow transition on the building permission file at
 * CLOSED_APPROVED (see the BBAS seed) — SYSTEM-kind, raised by the occupancy
 * service on the officer's or professional's behalf once it has checked the
 * step's capability, exactly as the change of professional is. None moves the
 * file: an approved building that is occupied is still an approved building.
 * WHICH desk performs each step is the holder of the step's capability — see
 * OCCUPANCY_STEP_CAPABILITY — so it is configuration, not code.
 */

export const OCCUPANCY_STATUSES = [
  'SUBMITTED',
  'INSPECTION_PENDING',
  'INSPECTION_COMPLETED',
  'SHORTFALL',
  'RECOMMENDED',
  'APPROVED',
  'CERTIFICATE_ISSUED',
  'REJECTED',
] as const;

export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];

/** The register's states: the stored ones plus the derived COMPLETION_PENDING. */
export const OCCUPANCY_REGISTER_STATES = ['COMPLETION_PENDING', ...OCCUPANCY_STATUSES] as const;
export type OccupancyRegisterState = (typeof OCCUPANCY_REGISTER_STATES)[number];

export const OCCUPANCY_STATE_LABEL: Record<OccupancyRegisterState, string> = {
  COMPLETION_PENDING: 'Completion Pending',
  SUBMITTED: 'Submitted',
  INSPECTION_PENDING: 'Inspection Pending',
  INSPECTION_COMPLETED: 'Inspection Completed',
  SHORTFALL: 'Shortfall',
  RECOMMENDED: 'Recommended',
  APPROVED: 'Approved',
  CERTIFICATE_ISSUED: 'Certificate Issued',
  REJECTED: 'Rejected',
};

export const isOccupancyStatus = (v: string): v is OccupancyStatus => (OCCUPANCY_STATUSES as readonly string[]).includes(v);
export const isOccupancyRegisterState = (v: string): v is OccupancyRegisterState =>
  (OCCUPANCY_REGISTER_STATES as readonly string[]).includes(v);

export const CLOSED_OCCUPANCY_STATUSES: readonly OccupancyStatus[] = ['CERTIFICATE_ISSUED', 'REJECTED'];
export const OPEN_OCCUPANCY_STATUSES: readonly OccupancyStatus[] = OCCUPANCY_STATUSES.filter(
  (s) => !CLOSED_OCCUPANCY_STATUSES.includes(s)
);
export const isOccupancyOpen = (s: string) => (OPEN_OCCUPANCY_STATUSES as readonly string[]).includes(s);

// ── The steps ───────────────────────────────────────────────────────────────

export const OCCUPANCY_STEPS = ['SUBMIT', 'SCHEDULE', 'INSPECT', 'RECOMMEND', 'SHORTFALL', 'RESPOND', 'DECIDE', 'ISSUE'] as const;
export type OccupancyStep = (typeof OCCUPANCY_STEPS)[number];

/** The capability each step needs. Whoever holds it is that step's desk. */
export const OCCUPANCY_STEP_CAPABILITY: Record<OccupancyStep, string> = {
  SUBMIT: 'OCCUPANCY_SUBMIT',
  RESPOND: 'OCCUPANCY_SUBMIT',
  SCHEDULE: 'OCCUPANCY_INSPECT',
  INSPECT: 'OCCUPANCY_INSPECT',
  RECOMMEND: 'OCCUPANCY_REVIEW',
  SHORTFALL: 'OCCUPANCY_REVIEW',
  DECIDE: 'OCCUPANCY_DECIDE',
  ISSUE: 'OCCUPANCY_DECIDE',
};

/** The workflow action behind each step (DECIDE has two, by outcome). */
export const OCCUPANCY_STEP_ACTION: Record<Exclude<OccupancyStep, 'DECIDE'>, string> = {
  SUBMIT: 'SUBMIT_OCCUPANCY',
  SCHEDULE: 'SCHEDULE_FINAL_INSPECTION',
  INSPECT: 'RECORD_FINAL_INSPECTION',
  RECOMMEND: 'RECOMMEND_OCCUPANCY',
  SHORTFALL: 'RAISE_OCCUPANCY_SHORTFALL',
  RESPOND: 'RESPOND_OCCUPANCY_SHORTFALL',
  ISSUE: 'ISSUE_OCCUPANCY_CERTIFICATE',
};

/** The one status each step may be taken from. SUBMIT starts from none. */
export const STEP_FROM: Record<Exclude<OccupancyStep, 'SUBMIT'>, OccupancyStatus> = {
  SCHEDULE: 'SUBMITTED',
  INSPECT: 'INSPECTION_PENDING',
  RECOMMEND: 'INSPECTION_COMPLETED',
  SHORTFALL: 'INSPECTION_COMPLETED',
  RESPOND: 'SHORTFALL',
  DECIDE: 'RECOMMENDED',
  ISSUE: 'APPROVED',
};

/** The step (or steps) waiting on a status, for the "current desk" column. */
export const NEXT_STEPS: Record<OccupancyStatus, OccupancyStep[]> = {
  SUBMITTED: ['SCHEDULE'],
  INSPECTION_PENDING: ['INSPECT'],
  INSPECTION_COMPLETED: ['RECOMMEND', 'SHORTFALL'],
  SHORTFALL: ['RESPOND'],
  RECOMMENDED: ['DECIDE'],
  APPROVED: ['ISSUE'],
  CERTIFICATE_ISSUED: [],
  REJECTED: [],
};

export const canTakeStep = (step: Exclude<OccupancyStep, 'SUBMIT'>, status: string) => STEP_FROM[step] === status;

// ── Recommendations ─────────────────────────────────────────────────────────

export const INSPECTION_RECOMMENDATIONS = ['RECOMMENDED', 'SHORTFALL', 'REJECT'] as const;
export type InspectionRecommendation = (typeof INSPECTION_RECOMMENDATIONS)[number];
export const INSPECTION_RECOMMENDATION_LABEL: Record<InspectionRecommendation, string> = {
  RECOMMENDED: 'Recommended',
  SHORTFALL: 'Shortfall',
  REJECT: 'Reject',
};

/** The reviewing desk's recommendation to the deciding desk. */
export const REVIEW_RECOMMENDATIONS = ['APPROVE', 'REJECT'] as const;
export type ReviewRecommendation = (typeof REVIEW_RECOMMENDATIONS)[number];
export const REVIEW_RECOMMENDATION_LABEL: Record<ReviewRecommendation, string> = {
  APPROVE: 'Recommended for approval',
  REJECT: 'Recommended for rejection',
};

export const OCCUPANCY_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type OccupancyDecision = (typeof OCCUPANCY_DECISIONS)[number];

/** Where the inspection sends the application. */
export const statusAfterInspection = (r: InspectionRecommendation): OccupancyStatus =>
  r === 'SHORTFALL' ? 'SHORTFALL' : 'INSPECTION_COMPLETED';

// ── May occupancy be applied for? ───────────────────────────────────────────

export type OccupancyFacts = {
  applicationStatus: string;
  order: { status: string; revokedAt: Date | string | null } | null;
  /** Commencement date, when work has been notified. */
  commencementDate: Date | string | null;
  /** Whether this workflow requires work to have been initiated (see the BBAS row's guards). */
  requiresCommencement: boolean;
  openOccupancyNumber: string | null;
  certificateIssued: boolean;
  now: Date;
};

const dayOf = (d: Date | string) => new Date(new Date(d).toISOString().slice(0, 10));

/** Why occupancy cannot be applied for on this file — or null when it can. */
export function occupancyBlocker(f: OccupancyFacts): string | null {
  if (f.applicationStatus !== 'APPROVED') return 'Occupancy may be applied for only on an approved building permission.';
  if (!f.order || f.order.status !== 'ISSUED' || f.order.revokedAt) {
    return 'The building permission order has not been issued. Occupancy cannot be applied for without it.';
  }
  if (f.requiresCommencement) {
    if (!f.commencementDate) return 'Commencement of work has not been notified on this file.';
    if (dayOf(f.commencementDate).getTime() > dayOf(f.now).getTime()) return 'Work on this file has not commenced yet.';
  }
  if (f.certificateIssued) return 'An occupancy certificate has already been issued on this file.';
  if (f.openOccupancyNumber) return `${f.openOccupancyNumber} is still open on this file.`;
  return null;
}

/** Completion cannot precede commencement, nor lie in the future. */
export function completionDateProblem(date: string, commencementDate: Date | string | null, now: Date): string | null {
  const d = dayOf(date);
  if (Number.isNaN(d.getTime())) return 'Enter a valid completion date.';
  if (d.getTime() > dayOf(now).getTime()) return 'The completion date cannot be in the future.';
  if (commencementDate && d.getTime() < dayOf(commencementDate).getTime()) return 'Completion cannot precede the commencement of work.';
  return null;
}

// ── Documents ───────────────────────────────────────────────────────────────

export const OCCUPANCY_DOCUMENTS = [
  'COMPLETION_LETTER',
  'AS_BUILT_DRAWING',
  'STRUCTURAL_STABILITY_CERTIFICATE',
  'FIRE_CLEARANCE',
  'SITE_PHOTOGRAPHS',
  'OTHER',
] as const;
export type OccupancyDocumentKind = (typeof OCCUPANCY_DOCUMENTS)[number];

export const OCCUPANCY_DOCUMENT_LABEL: Record<OccupancyDocumentKind, string> = {
  COMPLETION_LETTER: 'Completion letter',
  AS_BUILT_DRAWING: 'As-built drawing',
  STRUCTURAL_STABILITY_CERTIFICATE: 'Structural stability certificate',
  FIRE_CLEARANCE: 'Fire clearance',
  SITE_PHOTOGRAPHS: 'Site photographs',
  OTHER: 'Other supporting document',
};

export const isOccupancyDocumentKind = (v: string): v is OccupancyDocumentKind =>
  (OCCUPANCY_DOCUMENTS as readonly string[]).includes(v);

/**
 * DEMO RULE, stated once so it can be replaced once: the completion letter
 * and the as-built drawing are required to apply. No BBAS manual supplied to
 * this project lists the occupancy documents; the others are kept when given.
 */
export const REQUIRED_OCCUPANCY_DOCUMENTS: readonly OccupancyDocumentKind[] = ['COMPLETION_LETTER', 'AS_BUILT_DRAWING'];

export const missingOccupancyDocuments = (kinds: readonly string[]) => REQUIRED_OCCUPANCY_DOCUMENTS.filter((k) => !kinds.includes(k));

export type OccupancyDocument = {
  kind: OccupancyDocumentKind;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
  addedAt: string;
  addedByName: string;
  /** The round it arrived in — 1 with the application, 2+ with a shortfall answer. */
  round: number;
};

// ── Final inspection photographs ────────────────────────────────────────────

export const OCCUPANCY_PHOTO_VIEWS = ['FRONT_ELEVATION', 'REAR_ELEVATION', 'SIDE_SETBACK', 'PARKING', 'INTERIOR', 'TERRACE'] as const;
export type OccupancyPhotoView = (typeof OCCUPANCY_PHOTO_VIEWS)[number];
export const OCCUPANCY_PHOTO_LABEL: Record<OccupancyPhotoView, string> = {
  FRONT_ELEVATION: 'Front elevation',
  REAR_ELEVATION: 'Rear elevation',
  SIDE_SETBACK: 'Side setback',
  PARKING: 'Parking',
  INTERIOR: 'Interior',
  TERRACE: 'Terrace',
};

export type OccupancyPhoto = {
  view: OccupancyPhotoView;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  isDemo: boolean;
  capturedAt: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// Approved vs as-built
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The eight parameters compared. `limit` says which way a difference is a
 * deviation: MAX — built more than sanctioned (area, FSI, height, floors);
 * MIN — provided less than sanctioned (setbacks, parking).
 *
 * The TOLERANCE is a DEMO RULE (no manual supplied states one): 2 % either
 * way before a difference is called a deviation. Floors are exact.
 */
export const AS_BUILT_PARAMETERS = [
  { key: 'plotAreaSqm', label: 'Plot area', unit: 'sq m', limit: 'EXACT' },
  { key: 'builtUpAreaSqm', label: 'Built-up area', unit: 'sq m', limit: 'MAX' },
  { key: 'coveragePercent', label: 'Coverage', unit: '%', limit: 'MAX' },
  { key: 'fsi', label: 'FSI', unit: '', limit: 'MAX' },
  { key: 'heightM', label: 'Height', unit: 'm', limit: 'MAX' },
  { key: 'floors', label: 'Floors', unit: '', limit: 'MAX' },
  { key: 'setbackMinM', label: 'Setbacks (least of four)', unit: 'm', limit: 'MIN' },
  { key: 'parkingAreaSqm', label: 'Parking', unit: 'sq m', limit: 'MIN' },
] as const;

export type AsBuiltKey = (typeof AS_BUILT_PARAMETERS)[number]['key'];
export type AsBuiltFigures = Partial<Record<AsBuiltKey, number | null>>;

export const AS_BUILT_TOLERANCE = 0.02;

export type ComparisonRow = {
  key: AsBuiltKey;
  label: string;
  unit: string;
  approved: number | null;
  asBuilt: number | null;
  difference: number | null;
  /** Percent of the approved figure. */
  differencePercent: number | null;
  verdict: 'WITHIN' | 'DEVIATION' | 'NOT_RECORDED';
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function compareAsBuilt(approved: AsBuiltFigures, asBuilt: AsBuiltFigures): ComparisonRow[] {
  return AS_BUILT_PARAMETERS.map((p) => {
    const a = approved[p.key] ?? null;
    const b = asBuilt[p.key] ?? null;
    if (a == null || b == null) {
      return { key: p.key, label: p.label, unit: p.unit, approved: a, asBuilt: b, difference: null, differencePercent: null, verdict: 'NOT_RECORDED' };
    }
    const diff = round2(b - a);
    const pct = a !== 0 ? round2((diff / a) * 100) : null;
    const tol = p.key === 'floors' ? 0 : Math.abs(a) * AS_BUILT_TOLERANCE;
    const deviates =
      p.limit === 'MAX' ? diff > tol : p.limit === 'MIN' ? diff < -tol : Math.abs(diff) > tol;
    return { key: p.key, label: p.label, unit: p.unit, approved: a, asBuilt: b, difference: diff, differencePercent: pct, verdict: deviates ? 'DEVIATION' : 'WITHIN' };
  });
}

export const deviationsOf = (rows: ComparisonRow[]) => rows.filter((r) => r.verdict === 'DEVIATION');

/**
 * DEMO as-built figures: the approved ones, nudged. `COMPLIANT` stays inside
 * the tolerance; `DEVIATION` exceeds built-up area and coverage and eats a
 * setback — the pattern an inspector most often finds. Deterministic in the
 * seed so a demo file reads the same every time. Never a measurement.
 */
export function demoAsBuilt(approved: AsBuiltFigures, seed: string, variant: 'COMPLIANT' | 'DEVIATION'): AsBuiltFigures {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const jitter = (k: number) => (((h >> k) & 0xff) / 255 - 0.5) * 0.02; // ±1 %
  const nudge = (v: number | null | undefined, k: number, extra = 0) => (v == null ? null : round2(v * (1 + jitter(k) + extra)));
  const dev = variant === 'DEVIATION';
  return {
    plotAreaSqm: approved.plotAreaSqm ?? null,
    builtUpAreaSqm: nudge(approved.builtUpAreaSqm, 1, dev ? 0.08 : 0),
    coveragePercent: nudge(approved.coveragePercent, 3, dev ? 0.07 : 0),
    fsi: nudge(approved.fsi, 5, dev ? 0.06 : 0),
    heightM: nudge(approved.heightM, 7),
    floors: approved.floors ?? null,
    setbackMinM: nudge(approved.setbackMinM, 9, dev ? -0.15 : 0.005),
    parkingAreaSqm: nudge(approved.parkingAreaSqm, 11, 0.005),
  };
}

// ── The certificate ─────────────────────────────────────────────────────────

/**
 * PLACEHOLDER WORDING, like the BPO's conditions: shaped like the conditions
 * an occupancy certificate carries, drawn from no published rule, stored on
 * the certificate when issued, and enforced by nothing in this system.
 */
export const DEFAULT_OCCUPANCY_CONDITIONS: readonly string[] = [
  'The building shall be used only for the purpose for which the permission was granted. Any change of use requires fresh permission.',
  'The parking area shall be kept free and used only for parking, and shall not be enclosed or converted.',
  'The setbacks shall be kept open to the sky and free of any structure.',
  'Rainwater harvesting and fire safety provisions shall be maintained in working order for the life of the building.',
  'No addition or alteration shall be made to the building without the prior permission of the authority.',
  'This certificate is liable to be withdrawn if it was obtained by misrepresentation or if any condition above is contravened.',
];
