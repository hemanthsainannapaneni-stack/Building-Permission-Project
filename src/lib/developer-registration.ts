/**
 * Developer registration — the vocabulary, the state machine, the validity
 * arithmetic and the registers. Isomorphic: the service, the seed, the screens
 * and the tests all read these.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGISTRATION → DOCUMENTS → REVIEW → SHORTFALL / VERIFICATION → APPROVAL
 *               → VALIDITY → RENEWAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Register:   Open draft     ─▶ DRAFT
 *   Register:   Submit         ─▶ SUBMITTED     documents complete, particulars valid
 *   Verify:     Take up        ─▶ IN_PROCESS
 *   Verify:     Shortfall      ─▶ SHORTFALL
 *   Register:   Answer         ─▶ IN_PROCESS    (round + 1)
 *   Verify:     Verify         ─▶ VERIFIED      recommending approval or rejection
 *   Decide:     Approve        ─▶ APPROVED      registration number + validity + Outward letter
 *   Decide:     Reject         ─▶ REJECTED      (terminal)
 *   (sweep)     Validity lapses ─▶ EXPIRED
 *   Register:   Renew          ─▶ a NEW row, kind RENEWAL, from DRAFT again
 *
 * A developer registration belongs to no building permission file, so it has
 * no place in the file workflow. Like the Outward register, it is a register
 * with a state machine of its own. WHICH desk takes each step is whoever holds
 * the step's capability (DEVELOPER_STEP_CAPABILITY) — a grant, not code. The
 * BBAS manuals supplied to this project do not describe developer
 * registration; no role is invented for it.
 */

export const DEVELOPER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_PROCESS',
  'SHORTFALL',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
] as const;
export type DeveloperStatus = (typeof DEVELOPER_STATUSES)[number];

export const DEVELOPER_STATUS_LABEL: Record<DeveloperStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_PROCESS: 'In Process',
  SHORTFALL: 'Shortfall',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const isDeveloperStatus = (v: string): v is DeveloperStatus => (DEVELOPER_STATUSES as readonly string[]).includes(v);

/** Statuses with a step still to take by the department or the applicant. */
export const PENDING_DEVELOPER_STATUSES: readonly DeveloperStatus[] = ['SUBMITTED', 'IN_PROCESS', 'VERIFIED'];
/** Statuses an application can no longer leave by a step (EXPIRED only by renewal, which is a new row). */
export const CLOSED_DEVELOPER_STATUSES: readonly DeveloperStatus[] = ['APPROVED', 'REJECTED', 'EXPIRED'];
export const isDeveloperOpen = (s: string) => !(CLOSED_DEVELOPER_STATUSES as readonly string[]).includes(s);

export const DEVELOPER_KINDS = ['NEW', 'RENEWAL'] as const;
export type DeveloperKind = (typeof DEVELOPER_KINDS)[number];
export const DEVELOPER_KIND_LABEL: Record<DeveloperKind, string> = { NEW: 'New registration', RENEWAL: 'Renewal' };

// ── The steps ───────────────────────────────────────────────────────────────

export const DEVELOPER_STEPS = ['EDIT', 'SUBMIT', 'TAKE_UP', 'SHORTFALL', 'RESPOND', 'VERIFY', 'DECIDE', 'RENEW'] as const;
export type DeveloperStep = (typeof DEVELOPER_STEPS)[number];

/** The capability each step needs. Whoever holds it is that step's desk. */
export const DEVELOPER_STEP_CAPABILITY: Record<DeveloperStep, string> = {
  EDIT: 'DEVELOPER_REGISTER',
  SUBMIT: 'DEVELOPER_REGISTER',
  RESPOND: 'DEVELOPER_REGISTER',
  RENEW: 'DEVELOPER_REGISTER',
  TAKE_UP: 'DEVELOPER_VERIFY',
  SHORTFALL: 'DEVELOPER_VERIFY',
  VERIFY: 'DEVELOPER_VERIFY',
  DECIDE: 'DEVELOPER_DECIDE',
};

/** The one status each step may be taken from. RENEW is asked of the registration renewed. */
export const DEVELOPER_STEP_FROM: Record<Exclude<DeveloperStep, 'RENEW'>, DeveloperStatus> = {
  EDIT: 'DRAFT',
  SUBMIT: 'DRAFT',
  TAKE_UP: 'SUBMITTED',
  SHORTFALL: 'IN_PROCESS',
  RESPOND: 'SHORTFALL',
  VERIFY: 'IN_PROCESS',
  DECIDE: 'VERIFIED',
};

/** The step (or steps) waiting on a status, for the "current desk" column. */
export const DEVELOPER_NEXT_STEPS: Record<DeveloperStatus, DeveloperStep[]> = {
  DRAFT: ['SUBMIT'],
  SUBMITTED: ['TAKE_UP'],
  IN_PROCESS: ['VERIFY', 'SHORTFALL'],
  SHORTFALL: ['RESPOND'],
  VERIFIED: ['DECIDE'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export const canTakeDeveloperStep = (step: Exclude<DeveloperStep, 'RENEW'>, status: string) => DEVELOPER_STEP_FROM[step] === status;

/** Where each step sends the application. */
export const DEVELOPER_STEP_TO: Record<Exclude<DeveloperStep, 'EDIT' | 'DECIDE' | 'RENEW'>, DeveloperStatus> = {
  SUBMIT: 'SUBMITTED',
  TAKE_UP: 'IN_PROCESS',
  SHORTFALL: 'SHORTFALL',
  RESPOND: 'IN_PROCESS',
  VERIFY: 'VERIFIED',
};

export const VERIFICATION_OUTCOMES = ['RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
export const VERIFICATION_OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  RECOMMEND_APPROVAL: 'Verified — recommended for approval',
  RECOMMEND_REJECTION: 'Verified — recommended for rejection',
};

export const DEVELOPER_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type DeveloperDecision = (typeof DEVELOPER_DECISIONS)[number];

// ── Identifiers ─────────────────────────────────────────────────────────────

/**
 * Both follow the platform's `{prefix}/{year}/{seq:6}` pattern on counters of
 * their own, so neither touches application numbering (`application:BP:<year>`).
 */
export const DEVELOPER_APPLICATION_PREFIX = 'DRA';
export const DEVELOPER_REGISTRATION_PREFIX = 'DEV';

// ── The developer ───────────────────────────────────────────────────────────

/**
 * DEMO LIST — the forms of business a developer commonly takes in India. No
 * manual supplied to this project lists the types the authority registers.
 */
export const DEVELOPER_TYPES = [
  'INDIVIDUAL',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'COOPERATIVE_SOCIETY',
] as const;
export type DeveloperType = (typeof DEVELOPER_TYPES)[number];

export const DEVELOPER_TYPE_LABEL: Record<DeveloperType, string> = {
  INDIVIDUAL: 'Individual',
  PROPRIETORSHIP: 'Proprietorship firm',
  PARTNERSHIP: 'Partnership firm',
  LLP: 'Limited liability partnership',
  PRIVATE_LIMITED: 'Private limited company',
  PUBLIC_LIMITED: 'Public limited company',
  COOPERATIVE_SOCIETY: 'Co-operative society',
};

export const isDeveloperType = (v: string): v is DeveloperType => (DEVELOPER_TYPES as readonly string[]).includes(v);

/** What the incorporation number is called for each type — shown as the field's label. */
export const INCORPORATION_LABEL: Record<DeveloperType, string> = {
  INDIVIDUAL: 'Registration / licence number (if any)',
  PROPRIETORSHIP: 'Shops & establishment / Udyam number',
  PARTNERSHIP: 'Firm registration number',
  LLP: 'LLPIN',
  PRIVATE_LIMITED: 'CIN',
  PUBLIC_LIMITED: 'CIN',
  COOPERATIVE_SOCIETY: 'Society registration number',
};

/** An individual registers in their own name; every other type has an organisation. */
export const requiresOrganization = (t: string) => t !== 'INDIVIDUAL';

/**
 * The fourth character of a PAN names the holder's status (P individual, F
 * firm, C company, …). Used to catch a PAN that cannot belong to the type
 * chosen. `null` = no expectation.
 */
const PAN_HOLDER: Record<DeveloperType, readonly string[] | null> = {
  INDIVIDUAL: ['P'],
  PROPRIETORSHIP: ['P'],
  PARTNERSHIP: ['F'],
  LLP: ['F'],
  PRIVATE_LIMITED: ['C'],
  PUBLIC_LIMITED: ['C'],
  COOPERATIVE_SOCIETY: ['A', 'T'],
};

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DeveloperParticulars = {
  developerType: string;
  developerName: string;
  organization: string;
  authorizedPerson: string;
  address: string;
  pincode: string;
  mobile: string;
  email: string;
  pan: string;
  gstin: string;
};

/**
 * Everything wrong with the particulars, as { field: message }. Empty = valid.
 * A draft may be saved with problems; submission may not.
 */
export function particularsProblems(p: DeveloperParticulars): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isDeveloperType(p.developerType)) out.developerType = 'Choose the developer type.';
  if (p.developerName.trim().length < 3) out.developerName = 'Enter the developer’s name.';
  if (requiresOrganization(p.developerType) && p.organization.trim().length < 3) out.organization = 'Enter the organisation’s registered name.';
  if (p.authorizedPerson.trim().length < 3) out.authorizedPerson = 'Name the person authorised to act for the developer.';
  if (p.address.trim().length < 10) out.address = 'Enter the full address.';
  if (p.pincode && !PINCODE_PATTERN.test(p.pincode)) out.pincode = 'A PIN code is six digits.';
  if (!MOBILE_PATTERN.test(p.mobile)) out.mobile = 'Enter a ten-digit mobile number.';
  if (!EMAIL_PATTERN.test(p.email)) out.email = 'Enter a valid email address.';
  const pan = p.pan.toUpperCase();
  if (!PAN_PATTERN.test(pan)) out.pan = 'A PAN is five letters, four digits and a letter (ABCDE1234F).';
  else if (isDeveloperType(p.developerType)) {
    const allowed = PAN_HOLDER[p.developerType];
    if (allowed && !allowed.includes(pan[3]!)) out.pan = `This PAN is not one a ${DEVELOPER_TYPE_LABEL[p.developerType].toLowerCase()} holds (fourth letter ${pan[3]}).`;
  }
  if (p.gstin) {
    const g = p.gstin.toUpperCase();
    if (!GSTIN_PATTERN.test(g)) out.gstin = 'A GSTIN is fifteen characters (22ABCDE1234F1Z5).';
    else if (PAN_PATTERN.test(pan) && g.slice(2, 12) !== pan) out.gstin = 'The GSTIN must carry the same PAN (characters 3 to 12).';
  }
  return out;
}

// ── Documents ───────────────────────────────────────────────────────────────

export const DEVELOPER_DOCUMENTS = [
  'PAN_CARD',
  'INCORPORATION_PROOF',
  'AUTHORIZATION_LETTER',
  'ADDRESS_PROOF',
  'GST_CERTIFICATE',
  'EXPERIENCE_CERTIFICATE',
  'RERA_CERTIFICATE',
  'OTHER',
] as const;
export type DeveloperDocumentKind = (typeof DEVELOPER_DOCUMENTS)[number];

export const DEVELOPER_DOCUMENT_LABEL: Record<DeveloperDocumentKind, string> = {
  PAN_CARD: 'PAN card',
  INCORPORATION_PROOF: 'Proof of constitution (incorporation certificate / deed)',
  AUTHORIZATION_LETTER: 'Authorisation of the signatory (board resolution / letter)',
  ADDRESS_PROOF: 'Proof of address',
  GST_CERTIFICATE: 'GST registration certificate',
  EXPERIENCE_CERTIFICATE: 'Experience / completed projects',
  RERA_CERTIFICATE: 'RERA registration certificate',
  OTHER: 'Other supporting document',
};

export const isDeveloperDocumentKind = (v: string): v is DeveloperDocumentKind => (DEVELOPER_DOCUMENTS as readonly string[]).includes(v);

/**
 * DEMO RULE, stated once so it can be replaced once: PAN, proof of
 * constitution, authorisation and address proof are required to submit; the
 * GST certificate is required when a GSTIN is given. No BBAS manual supplied
 * to this project lists a developer's documents. An individual has no
 * constitution to prove and signs for themselves.
 */
export function requiredDeveloperDocuments(developerType: string, gstin: string): DeveloperDocumentKind[] {
  const out: DeveloperDocumentKind[] = ['PAN_CARD', 'ADDRESS_PROOF'];
  if (requiresOrganization(developerType)) out.push('INCORPORATION_PROOF', 'AUTHORIZATION_LETTER');
  if (gstin.trim()) out.push('GST_CERTIFICATE');
  return out;
}

export const missingDeveloperDocuments = (required: readonly DeveloperDocumentKind[], kinds: readonly string[]) =>
  required.filter((k) => !kinds.includes(k));

export type DeveloperDocument = {
  kind: DeveloperDocumentKind;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
  addedAt: string;
  addedByName: string;
  /** 1 with the application, 2+ with a shortfall answer. */
  round: number;
  /** Brought forward from the registration being renewed. */
  carriedForward?: boolean;
};

/** The latest document of each kind — what the application currently rests on. */
export function latestDocuments(docs: readonly DeveloperDocument[]) {
  const out = new Map<DeveloperDocumentKind, { doc: DeveloperDocument; index: number }>();
  docs.forEach((doc, index) => out.set(doc.kind, { doc, index }));
  return out;
}

// ── Validity ────────────────────────────────────────────────────────────────

/**
 * DEMO VALUES, held as system settings (group "developers") so an
 * administrator can change them without code. No validity period for a
 * developer registration is taken from any published rule.
 */
export const DEVELOPER_VALIDITY_SETTING = 'developer_registration_validity_years';
export const DEVELOPER_RENEWAL_WINDOW_SETTING = 'developer_renewal_window_days';
export const DEFAULT_DEVELOPER_VALIDITY_YEARS = 3;
export const DEFAULT_DEVELOPER_RENEWAL_WINDOW_DAYS = 90;

const DAY = 86_400_000;
/** Midnight UTC of the calendar day `d` falls on. Dates here are days, not instants. */
export const dayOf = (d: Date | string) => new Date(new Date(d).toISOString().slice(0, 10));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
function addYears(d: Date, n: number) {
  const out = new Date(d);
  out.setUTCFullYear(out.getUTCFullYear() + n);
  // 29 Feb + 1 year rolls into March; hold it to the last day of February.
  if (out.getUTCDate() !== d.getUTCDate()) out.setUTCDate(0);
  return out;
}

export type Validity = { issueDate: Date; validFrom: Date; validTo: Date; renewalDueDate: Date; validityYears: number };

/**
 * The validity a registration is issued with. A first registration runs from
 * the day of issue. A renewal approved while its predecessor is still valid
 * runs on from the day after the predecessor ends, so no day is lost or
 * doubled; one approved after the predecessor lapsed runs from the day of issue.
 */
export function computeValidity(
  now: Date,
  years: number,
  windowDays: number,
  predecessorValidTo?: Date | string | null
): Validity {
  const issueDate = dayOf(now);
  const continuing = predecessorValidTo && dayOf(predecessorValidTo).getTime() >= issueDate.getTime();
  const validFrom = continuing ? addDays(dayOf(predecessorValidTo!), 1) : issueDate;
  const validTo = addDays(addYears(validFrom, years), -1);
  const renewalDueDate = addDays(validTo, -Math.max(0, windowDays));
  return { issueDate, validFrom, validTo, renewalDueDate, validityYears: years };
}

export const isLapsed = (validTo: Date | string | null | undefined, now: Date) =>
  Boolean(validTo) && dayOf(validTo!).getTime() < dayOf(now).getTime();

export const daysUntil = (d: Date | string, now: Date) => Math.round((dayOf(d).getTime() - dayOf(now).getTime()) / DAY);

/** Why this registration cannot be renewed now — or null when it can. */
export function renewalBlocker(r: {
  status: string;
  isCurrent: boolean;
  renewalDueDate: Date | string | null;
  openRenewalNumber: string | null;
  now: Date;
}): string | null {
  if (!r.isCurrent) return 'A later registration has replaced this one. Renew that instead.';
  if (r.status !== 'APPROVED' && r.status !== 'EXPIRED') return 'Only an approved or expired registration can be renewed.';
  if (r.openRenewalNumber) return `Renewal ${r.openRenewalNumber} is already under way.`;
  if (r.status === 'APPROVED' && r.renewalDueDate && dayOf(r.now).getTime() < dayOf(r.renewalDueDate).getTime()) {
    return `Renewal opens on ${dayOf(r.renewalDueDate).toISOString().slice(0, 10)}.`;
  }
  return null;
}

// ── The registers ───────────────────────────────────────────────────────────

export const DEVELOPER_REGISTERS = ['ALL', 'PENDING', 'SHORTFALL', 'APPROVED', 'REJECTED', 'EXPIRED', 'RENEWAL'] as const;
export type DeveloperRegister = (typeof DEVELOPER_REGISTERS)[number];

export const DEVELOPER_REGISTER_LABEL: Record<DeveloperRegister, string> = {
  ALL: 'All Developers',
  PENDING: 'Pending',
  SHORTFALL: 'Shortfall',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  RENEWAL: 'Renewal',
};

export const DEVELOPER_REGISTER_HINT: Record<DeveloperRegister, string> = {
  ALL: 'Every developer, as their latest registration stands',
  PENDING: 'Submitted, in process or verified — awaiting a desk',
  SHORTFALL: 'Waiting on the developer',
  APPROVED: 'Registered and valid',
  REJECTED: 'Applications refused',
  EXPIRED: 'Validity lapsed, not renewed',
  RENEWAL: 'Renewal due, expired, or a renewal under way',
};

export const isDeveloperRegister = (v: string): v is DeveloperRegister => (DEVELOPER_REGISTERS as readonly string[]).includes(v);

// ── Application integration ─────────────────────────────────────────────────

/**
 * Whether a building-permission application may name this developer today —
 * approved, current (not superseded by a later registration) and not lapsed.
 * The same test occupancy and professional registration use for "available".
 */
export const isDeveloperAvailable = (r: { status: string; isCurrent: boolean; validTo: Date | string | null }, now: Date) =>
  r.status === 'APPROVED' && r.isCurrent && Boolean(r.validTo) && !isLapsed(r.validTo, now);
