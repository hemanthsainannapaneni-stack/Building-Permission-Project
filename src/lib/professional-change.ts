/**
 * The change of technical professional vocabulary. Isomorphic — the service,
 * the workflow effect, the seed, the screens and the tests all read these.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE OLD PROFESSIONAL IS NEVER OVERWRITTEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A file's technical professional (the LTP) is recorded twice:
 *
 *   applications.ltpUserId        who holds the file NOW — the one column the
 *                                 drawing, BIM and scrutiny services check
 *                                 before accepting an upload.
 *   application_professionals     every professional who has ever held it,
 *                                 with when they started and stopped. Rows
 *                                 are added and closed, never deleted.
 *
 * An approved change closes the outgoing row (SUPERSEDED, engagedUntil, no
 * drawing rights), opens a new ACTIVE one, and only then moves ltpUserId. The
 * filing declaration (`applications.ltpDeclaration`) is left exactly as it was
 * signed — it records who filed, not who holds the file today.
 *
 * ── The lifecycle ─────────────────────────────────────────────────────────
 *
 *   Request ────────▶ PENDING_VERIFICATION   (the desk registers the owner's letter)
 *   Verification ──▶ UNDER_REVIEW           (the documents are checked)
 *   Review ────────▶ PENDING_DECISION       (the reviewing desk recommends)
 *   Decision ──────▶ APPROVED │ REJECTED
 *
 * Every step is a workflow transition on the file (see the BBAS seed), so each
 * one is a row in the file's workflow history as well as in this request's own
 * event log and the audit chain. WHICH desk performs each step is the holder
 * of the step's capability — see PROFESSIONAL_CHANGE_STEP_CAPABILITY — and so
 * is configuration in the permission matrix, not code.
 */

export const PROFESSIONAL_CHANGE_STATUSES = [
  'PENDING_VERIFICATION',
  'UNDER_REVIEW',
  'PENDING_DECISION',
  'APPROVED',
  'REJECTED',
] as const;

export type ProfessionalChangeStatus = (typeof PROFESSIONAL_CHANGE_STATUSES)[number];

export const PROFESSIONAL_CHANGE_STATUS_LABEL: Record<ProfessionalChangeStatus, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  UNDER_REVIEW: 'Under review',
  PENDING_DECISION: 'Awaiting decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const isProfessionalChangeStatus = (v: string): v is ProfessionalChangeStatus =>
  (PROFESSIONAL_CHANGE_STATUSES as readonly string[]).includes(v);

export const OPEN_PROFESSIONAL_CHANGE_STATUSES: readonly ProfessionalChangeStatus[] = [
  'PENDING_VERIFICATION',
  'UNDER_REVIEW',
  'PENDING_DECISION',
];

export const isProfessionalChangeOpen = (status: string) =>
  (OPEN_PROFESSIONAL_CHANGE_STATUSES as readonly string[]).includes(status);

export const PROFESSIONAL_CHANGE_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type ProfessionalChangeDecision = (typeof PROFESSIONAL_CHANGE_DECISIONS)[number];

export const PROFESSIONAL_CHANGE_DECISION_LABEL: Record<ProfessionalChangeDecision, string> = {
  APPROVED: 'Approve the change',
  REJECTED: 'Reject the request',
};

// ── The steps ───────────────────────────────────────────────────────────────

export const PROFESSIONAL_CHANGE_STEPS = ['REQUEST', 'VERIFY', 'REVIEW', 'DECIDE'] as const;
export type ProfessionalChangeStep = (typeof PROFESSIONAL_CHANGE_STEPS)[number];

/** The capability each step needs. Whoever holds it is that step's desk. */
export const PROFESSIONAL_CHANGE_STEP_CAPABILITY: Record<ProfessionalChangeStep, string> = {
  REQUEST: 'PROFESSIONAL_CHANGE_REQUEST',
  VERIFY: 'PROFESSIONAL_CHANGE_VERIFY',
  REVIEW: 'PROFESSIONAL_CHANGE_REVIEW',
  DECIDE: 'PROFESSIONAL_CHANGE_DECIDE',
};

/** The step a request in this status is waiting for. Null once decided. */
export const NEXT_STEP: Record<ProfessionalChangeStatus, ProfessionalChangeStep | null> = {
  PENDING_VERIFICATION: 'VERIFY',
  UNDER_REVIEW: 'REVIEW',
  PENDING_DECISION: 'DECIDE',
  APPROVED: null,
  REJECTED: null,
};

export const canVerify = (status: string) => status === 'PENDING_VERIFICATION';
export const canReview = (status: string) => status === 'UNDER_REVIEW';
export const canDecide = (status: string) => status === 'PENDING_DECISION';

// ── The documents ───────────────────────────────────────────────────────────

export const PROFESSIONAL_CHANGE_DOCUMENTS = [
  'OWNER_REQUEST_LETTER',
  'CURRENT_PROFESSIONAL_NOC',
  'TERMINATION_LETTER',
  'FEE_SETTLEMENT',
  'INDEMNITY',
  'RESPONSIBILITY_HANDOVER',
  'STRUCTURAL_RESPONSIBILITY_HANDOVER',
  'NEW_PROFESSIONAL_CONSENT',
] as const;

export type ProfessionalChangeDocumentKind = (typeof PROFESSIONAL_CHANGE_DOCUMENTS)[number];

export const PROFESSIONAL_CHANGE_DOCUMENT_LABEL: Record<ProfessionalChangeDocumentKind, string> = {
  OWNER_REQUEST_LETTER: 'Owner request letter',
  CURRENT_PROFESSIONAL_NOC: 'Current professional NOC',
  TERMINATION_LETTER: 'Termination letter',
  FEE_SETTLEMENT: 'Fee settlement',
  INDEMNITY: 'Indemnity',
  RESPONSIBILITY_HANDOVER: 'Responsibility handover',
  STRUCTURAL_RESPONSIBILITY_HANDOVER: 'Structural responsibility handover',
  NEW_PROFESSIONAL_CONSENT: 'New professional consent',
};

export const isProfessionalChangeDocumentKind = (v: string): v is ProfessionalChangeDocumentKind =>
  (PROFESSIONAL_CHANGE_DOCUMENTS as readonly string[]).includes(v);

/**
 * DEMO RULES, stated once so they can be replaced once.
 *
 * No BBAS manual supplied to this project lists which of these documents are
 * mandatory. These are the minimum the flow itself needs to make sense — the
 * owner asked, and the incoming professional agreed — plus, before the request
 * can be verified, SOME release from the outgoing professional: their NOC or,
 * where they will not give one, the owner's termination letter. Everything else
 * is recorded when supplied and shown as "not provided" when not.
 */
export const REQUIRED_AT_REQUEST: readonly ProfessionalChangeDocumentKind[] = [
  'OWNER_REQUEST_LETTER',
  'NEW_PROFESSIONAL_CONSENT',
];

export const RELEASE_DOCUMENTS: readonly ProfessionalChangeDocumentKind[] = [
  'CURRENT_PROFESSIONAL_NOC',
  'TERMINATION_LETTER',
];

export type ProfessionalChangeDocument = {
  kind: ProfessionalChangeDocumentKind;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
  addedAt: string;
  addedByName: string;
};

export const missingAtRequest = (kinds: readonly string[]) => REQUIRED_AT_REQUEST.filter((k) => !kinds.includes(k));

export const hasRelease = (kinds: readonly string[]) => RELEASE_DOCUMENTS.some((k) => kinds.includes(k));

// ── The professional, as compared on the detail screen ─────────────────────

/** Frozen at the moment of the request — a licence may change afterwards. */
export type ProfessionalSnapshot = {
  userId: string;
  name: string;
  email: string;
  phone: string;
  licenceNo: string;
  licenceClass: string;
  validUpto: string | null;
  firmName: string;
};

export const COMPARISON_FIELDS: ReadonlyArray<{ key: keyof ProfessionalSnapshot; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'licenceNo', label: 'Licence number' },
  { key: 'licenceClass', label: 'Licence class' },
  { key: 'validUpto', label: 'Licence valid up to' },
  { key: 'firmName', label: 'Firm' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
];

/** Whether the licence was in force on the given day. No expiry recorded reads as valid. */
export function licenceValidOn(validUpto: string | Date | null | undefined, on: Date): boolean {
  if (!validUpto) return true;
  const d = typeof validUpto === 'string' ? new Date(validUpto) : validUpto;
  return d.getTime() >= new Date(on.toISOString().slice(0, 10)).getTime();
}

export const ENGAGEMENT_STATUSES = ['ACTIVE', 'SUPERSEDED'] as const;
export const ENGAGEMENT_SOURCES = ['ORIGINAL_FILING', 'CHANGE_REQUEST'] as const;
