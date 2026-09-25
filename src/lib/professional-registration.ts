/**
 * Professional registration — the vocabulary, the state machine, the validity
 * arithmetic, document verification and the registers. Isomorphic.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGISTRATION → REVIEW → SHORTFALL / VERIFICATION → APPROVAL
 *               → AVAILABLE FOR APPLICATIONS → RENEWAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Register:  Open draft        ─▶ DRAFT
 *   Register:  Submit            ─▶ SUBMITTED    (the "Pending" register)
 *   Verify:    Take up           ─▶ IN_PROCESS
 *   Verify:    check each document (VERIFIED / REJECTED) — not a move
 *   Verify:    Shortfall         ─▶ SHORTFALL
 *   Register:  Answer            ─▶ IN_PROCESS   (round + 1)
 *   Verify:    Verify            ─▶ VERIFIED     recommending approval or rejection
 *   Decide:    Approve           ─▶ APPROVED     registration number, validity, Outward letter
 *   Decide:    Reject            ─▶ REJECTED
 *   (sweep)    validity lapses   ─▶ EXPIRED
 *   Register:  Renew             ─▶ a new row, kind RENEWAL
 *
 * An APPROVED, current, unexpired registration is what an application may
 * name: the file's LTP (types that may hold a file, with a portal account),
 * the structural engineer, and the professional a file is changed to.
 *
 * The professional TYPES are configuration (master_data PROFESSIONAL_TYPE),
 * so a department can add one without code. Which desk takes each step is
 * whoever holds the step's capability. No validity period is taken from any
 * statute: it is a demo setting, and never runs past the licence itself.
 */

import { dayOf, daysUntil, isLapsed } from './developer-registration';

export { dayOf, daysUntil, isLapsed };

export const PROFESSIONAL_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'SHORTFALL', 'VERIFIED', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type ProfessionalStatus = (typeof PROFESSIONAL_STATUSES)[number];

export const PROFESSIONAL_STATUS_LABEL: Record<ProfessionalStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending',
  IN_PROCESS: 'In Process',
  SHORTFALL: 'Shortfall',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const isProfessionalStatus = (v: string): v is ProfessionalStatus => (PROFESSIONAL_STATUSES as readonly string[]).includes(v);
export const CLOSED_PROFESSIONAL_STATUSES: readonly ProfessionalStatus[] = ['APPROVED', 'REJECTED', 'EXPIRED'];
export const isProfessionalOpen = (s: string) => !(CLOSED_PROFESSIONAL_STATUSES as readonly string[]).includes(s);

export const PROFESSIONAL_KINDS = ['NEW', 'RENEWAL'] as const;
export type ProfessionalKind = (typeof PROFESSIONAL_KINDS)[number];
export const PROFESSIONAL_KIND_LABEL: Record<ProfessionalKind, string> = { NEW: 'New registration', RENEWAL: 'Renewal' };

// ── The steps ───────────────────────────────────────────────────────────────

export const PROFESSIONAL_STEPS = ['EDIT', 'SUBMIT', 'TAKE_UP', 'CHECK_DOCUMENT', 'SHORTFALL', 'RESPOND', 'VERIFY', 'DECIDE', 'RENEW'] as const;
export type ProfessionalStep = (typeof PROFESSIONAL_STEPS)[number];

export const PROFESSIONAL_STEP_CAPABILITY: Record<ProfessionalStep, string> = {
  EDIT: 'LTP_REG_REGISTER',
  SUBMIT: 'LTP_REG_REGISTER',
  RESPOND: 'LTP_REG_REGISTER',
  RENEW: 'LTP_REG_REGISTER',
  TAKE_UP: 'LTP_REG_VERIFY',
  CHECK_DOCUMENT: 'LTP_REG_VERIFY',
  SHORTFALL: 'LTP_REG_VERIFY',
  VERIFY: 'LTP_REG_VERIFY',
  DECIDE: 'LTP_REG_DECIDE',
};

export const PROFESSIONAL_STEP_FROM: Record<Exclude<ProfessionalStep, 'RENEW'>, ProfessionalStatus> = {
  EDIT: 'DRAFT',
  SUBMIT: 'DRAFT',
  TAKE_UP: 'SUBMITTED',
  CHECK_DOCUMENT: 'IN_PROCESS',
  SHORTFALL: 'IN_PROCESS',
  RESPOND: 'SHORTFALL',
  VERIFY: 'IN_PROCESS',
  DECIDE: 'VERIFIED',
};

export const PROFESSIONAL_NEXT_STEPS: Record<ProfessionalStatus, ProfessionalStep[]> = {
  DRAFT: ['SUBMIT'],
  SUBMITTED: ['TAKE_UP'],
  IN_PROCESS: ['VERIFY', 'SHORTFALL'],
  SHORTFALL: ['RESPOND'],
  VERIFIED: ['DECIDE'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export const VERIFICATION_OUTCOMES = ['RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
export const VERIFICATION_OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  RECOMMEND_APPROVAL: 'Verified — recommended for approval',
  RECOMMEND_REJECTION: 'Verified — recommended for rejection',
};

export const PROFESSIONAL_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type ProfessionalDecision = (typeof PROFESSIONAL_DECISIONS)[number];

// ── Identifiers ─────────────────────────────────────────────────────────────

/** The application reference. Registration numbers take their prefix from the type. */
export const PROFESSIONAL_APPLICATION_PREFIX = 'PRA';
export const DEFAULT_REGISTRATION_PREFIX = 'PRF';

// ── Professional types (configuration) ──────────────────────────────────────

export const PROFESSIONAL_TYPE_CATEGORY = 'PROFESSIONAL_TYPE';

/** What master_data.metadata carries for a professional type. */
export type ProfessionalTypeMeta = {
  /** Registration number prefix — ARC/2026/000001. */
  prefix?: string;
  /** May hold a building permission file (be its LTP), given a portal account. */
  canHoldFile?: boolean;
  /** May be named as the structural engineer on a file. */
  structural?: boolean;
  /** The usual registration body, offered as the form's default. */
  body?: string;
};

export type ProfessionalTypeOption = { code: string; label: string; isActive: boolean } & Required<ProfessionalTypeMeta>;

export const typeOption = (row: { code: string; label: string; isActive: boolean; metadata: unknown }): ProfessionalTypeOption => {
  const m = (row.metadata ?? {}) as ProfessionalTypeMeta;
  return {
    code: row.code,
    label: row.label,
    isActive: row.isActive,
    prefix: (m.prefix || DEFAULT_REGISTRATION_PREFIX).toUpperCase(),
    canHoldFile: Boolean(m.canHoldFile),
    structural: Boolean(m.structural),
    body: m.body ?? '',
  };
};

/**
 * The types seeded with the module. DEMO configuration: the prefixes and the
 * usual registration bodies are illustrative; an administrator edits them, or
 * adds a type, on Settings → Professional Types.
 */
export const DEFAULT_PROFESSIONAL_TYPES: Array<{ code: string; label: string; order: number; metadata: Required<ProfessionalTypeMeta> }> = [
  { code: 'ARCHITECT', label: 'Architect', order: 1, metadata: { prefix: 'ARC', canHoldFile: true, structural: false, body: 'Council of Architecture' } },
  { code: 'ENGINEER', label: 'Engineer', order: 2, metadata: { prefix: 'ENG', canHoldFile: true, structural: false, body: 'State Council of Engineers' } },
  { code: 'STRUCTURAL_ENGINEER', label: 'Structural Engineer', order: 3, metadata: { prefix: 'STR', canHoldFile: false, structural: true, body: 'State Council of Engineers' } },
  { code: 'LTP', label: 'Licensed Technical Person', order: 4, metadata: { prefix: 'LTP', canHoldFile: true, structural: false, body: 'The Authority (LTP licence)' } },
  { code: 'TOWN_PLANNER', label: 'Town Planner', order: 5, metadata: { prefix: 'TPL', canHoldFile: false, structural: false, body: 'Institute of Town Planners' } },
];

// ── Particulars ─────────────────────────────────────────────────────────────

export const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** DEMO WORDING of the consent the professional signs. Stored with the registration when given. */
export const CONSENT_TEXT =
  'I consent to my particulars being entered in the authority’s register of LTPs and shown to applicants choosing an ' +
  'LTP, and to their verification with the registration body named. I will inform the authority of any change, ' +
  'suspension or cancellation of my licence.';

export type ProfessionalParticulars = {
  professionalType: string;
  name: string;
  licenceNo: string;
  registrationBody: string;
  qualification: string;
  address: string;
  pincode: string;
  mobile: string;
  email: string;
  licenceValidTo: Date | string | null;
  consentGiven: boolean;
};

/** Everything wrong with the particulars, as { field: message }. A draft may be saved with problems; submission may not. */
export function professionalProblems(p: ProfessionalParticulars, types: readonly { code: string; isActive: boolean }[], now: Date): Record<string, string> {
  const out: Record<string, string> = {};
  const type = types.find((t) => t.code === p.professionalType);
  if (!type) out.professionalType = 'Choose the LTP type.';
  else if (!type.isActive) out.professionalType = 'This LTP type is no longer registered.';
  if (p.name.trim().length < 3) out.name = 'Enter the LTP’s full name.';
  if (p.licenceNo.trim().length < 3) out.licenceNo = 'Enter the licence number issued by the registration body.';
  if (p.registrationBody.trim().length < 3) out.registrationBody = 'Name the body that issued the licence.';
  if (p.qualification.trim().length < 2) out.qualification = 'Enter the qualification.';
  if (p.address.trim().length < 10) out.address = 'Enter the full address.';
  if (p.pincode && !PINCODE_PATTERN.test(p.pincode)) out.pincode = 'A PIN code is six digits.';
  if (!MOBILE_PATTERN.test(p.mobile)) out.mobile = 'Enter a ten-digit mobile number.';
  if (!EMAIL_PATTERN.test(p.email)) out.email = 'Enter a valid email address.';
  if (!p.licenceValidTo) out.licenceValidTo = 'Enter the date the licence is valid to.';
  else if (isLapsed(p.licenceValidTo, now)) out.licenceValidTo = 'The licence has lapsed. It must be renewed with the registration body first.';
  if (!p.consentGiven) out.consentGiven = 'The LTP’s consent is required.';
  return out;
}

// ── Documents and their verification ────────────────────────────────────────

export const PROFESSIONAL_DOCUMENTS = [
  'LICENCE_CERTIFICATE',
  'QUALIFICATION_CERTIFICATE',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'PHOTOGRAPH',
  'EXPERIENCE_CERTIFICATE',
  'CONSENT_LETTER',
  'OTHER',
] as const;
export type ProfessionalDocumentKind = (typeof PROFESSIONAL_DOCUMENTS)[number];

export const PROFESSIONAL_DOCUMENT_LABEL: Record<ProfessionalDocumentKind, string> = {
  LICENCE_CERTIFICATE: 'Licence / registration certificate',
  QUALIFICATION_CERTIFICATE: 'Degree / qualification certificate',
  ID_PROOF: 'Proof of identity',
  ADDRESS_PROOF: 'Proof of address',
  PHOTOGRAPH: 'Photograph',
  EXPERIENCE_CERTIFICATE: 'Experience certificate',
  CONSENT_LETTER: 'Signed consent',
  OTHER: 'Other supporting document',
};

export const isProfessionalDocumentKind = (v: string): v is ProfessionalDocumentKind => (PROFESSIONAL_DOCUMENTS as readonly string[]).includes(v);

/**
 * DEMO RULE, stated once so it can be replaced once: the licence, the
 * qualification, identity and address proofs and the signed consent are
 * required to submit. No manual supplied to this project lists them.
 */
export const REQUIRED_PROFESSIONAL_DOCUMENTS: readonly ProfessionalDocumentKind[] = [
  'LICENCE_CERTIFICATE',
  'QUALIFICATION_CERTIFICATE',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'CONSENT_LETTER',
];

/** The same words the application documents use — see DOCUMENT_STATUS in src/lib/status.ts. */
export const DOCUMENT_CHECK_STATUSES = ['UPLOADED', 'VERIFIED', 'REJECTED'] as const;
export type DocumentCheckStatus = (typeof DOCUMENT_CHECK_STATUSES)[number];

export type ProfessionalDocument = {
  kind: ProfessionalDocumentKind;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
  addedAt: string;
  addedByName: string;
  round: number;
  carriedForward?: boolean;
  status: DocumentCheckStatus;
  verifyRemarks: string;
  verifiedByName: string;
  verifiedAt: string | null;
};

export function latestProfessionalDocuments(docs: readonly ProfessionalDocument[]) {
  const out = new Map<ProfessionalDocumentKind, { doc: ProfessionalDocument; index: number }>();
  docs.forEach((doc, index) => out.set(doc.kind, { doc, index }));
  return out;
}

export const missingProfessionalDocuments = (kinds: readonly string[]) => REQUIRED_PROFESSIONAL_DOCUMENTS.filter((k) => !kinds.includes(k));

/** Required documents whose latest version is not yet VERIFIED — what stands between a file and "Verified". */
export function unverifiedRequired(docs: readonly ProfessionalDocument[]) {
  const latest = latestProfessionalDocuments(docs);
  return REQUIRED_PROFESSIONAL_DOCUMENTS.filter((k) => latest.get(k)?.doc.status !== 'VERIFIED');
}

// ── Validity ────────────────────────────────────────────────────────────────

/** DEMO VALUES in system settings (group "professionals"). Not statutory. */
export const PROFESSIONAL_VALIDITY_SETTING = 'professional_registration_validity_years';
export const PROFESSIONAL_RENEWAL_WINDOW_SETTING = 'professional_renewal_window_days';
export const DEFAULT_PROFESSIONAL_VALIDITY_YEARS = 3;
export const DEFAULT_PROFESSIONAL_RENEWAL_WINDOW_DAYS = 60;

const DAY = 86_400_000;
function addYears(d: Date, n: number) {
  const out = new Date(d);
  out.setUTCFullYear(out.getUTCFullYear() + n);
  if (out.getUTCDate() !== d.getUTCDate()) out.setUTCDate(0);
  return out;
}

export type ProfessionalValidity = {
  issueDate: Date;
  validFrom: Date;
  validTo: Date;
  renewalDueDate: Date;
  validityYears: number;
  cappedByLicence: boolean;
};

/**
 * The validity a registration is issued with: from the day of issue (or the
 * day after a still-valid predecessor ends) for the configured years — but
 * never past the licence's own validity. A registration cannot outlive the
 * licence it registers.
 */
export function computeProfessionalValidity(
  now: Date,
  years: number,
  windowDays: number,
  licenceValidTo: Date | string | null,
  predecessorValidTo?: Date | string | null
): ProfessionalValidity {
  const issueDate = dayOf(now);
  const continuing = predecessorValidTo && dayOf(predecessorValidTo).getTime() >= issueDate.getTime();
  const validFrom = continuing ? new Date(dayOf(predecessorValidTo!).getTime() + DAY) : issueDate;
  let validTo = new Date(addYears(validFrom, years).getTime() - DAY);
  let cappedByLicence = false;
  if (licenceValidTo && dayOf(licenceValidTo).getTime() < validTo.getTime()) {
    validTo = dayOf(licenceValidTo);
    cappedByLicence = true;
  }
  const due = new Date(validTo.getTime() - Math.max(0, windowDays) * DAY);
  const renewalDueDate = due.getTime() < validFrom.getTime() ? validFrom : due;
  return { issueDate, validFrom, validTo, renewalDueDate, validityYears: years, cappedByLicence };
}

export function professionalRenewalBlocker(r: {
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

/** Whether an application may name this registration today. */
export const isAvailableForApplications = (r: { status: string; isCurrent: boolean; validTo: Date | string | null }, now: Date) =>
  r.status === 'APPROVED' && r.isCurrent && Boolean(r.validTo) && !isLapsed(r.validTo, now);

// ── The registers ───────────────────────────────────────────────────────────

export const PROFESSIONAL_REGISTERS = ['ALL', 'PENDING', 'IN_PROCESS', 'SHORTFALL', 'VERIFIED', 'REJECTED', 'EXPIRED', 'RENEWAL'] as const;
export type ProfessionalRegister = (typeof PROFESSIONAL_REGISTERS)[number];

export const PROFESSIONAL_REGISTER_LABEL: Record<ProfessionalRegister, string> = {
  ALL: 'All LTPs',
  PENDING: 'Pending',
  IN_PROCESS: 'In Process',
  SHORTFALL: 'Shortfall',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  RENEWAL: 'Renewal',
};

export const PROFESSIONAL_REGISTER_HINT: Record<ProfessionalRegister, string> = {
  ALL: 'Every LTP, as their latest registration stands',
  PENDING: 'Submitted, not yet taken up',
  IN_PROCESS: 'Under scrutiny',
  SHORTFALL: 'Waiting on the LTP',
  VERIFIED: 'Verified, awaiting decision',
  REJECTED: 'Applications refused',
  EXPIRED: 'Validity lapsed, not renewed',
  RENEWAL: 'Renewal due, expired, or a renewal under way',
};

export const isProfessionalRegister = (v: string): v is ProfessionalRegister => (PROFESSIONAL_REGISTERS as readonly string[]).includes(v);
