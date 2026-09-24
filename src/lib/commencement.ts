/**
 * Commencement of work — the post-approval notice. Isomorphic: the service,
 * the workflow effect, the seed, the screens and the tests all read these.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  APPROVED → PROCEEDING ISSUED → WORK INITIATED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Approved            the workflow's APPROVE transition (file APPROVED)
 *   Proceeding issued   the Building Permission Order is ISSUED and not revoked
 *   Work initiated      the owner, through the file's technical professional,
 *                       notifies the date work starts on site
 *
 * The notice is the workflow transition NOTIFY_WORK_COMMENCEMENT at
 * CLOSED_APPROVED — a SYSTEM step raised on the professional's behalf, as the
 * applicant's show cause answer is. It does not move the file: an approved
 * file whose work has started is still APPROVED, so show cause and revocation
 * go on exactly as before.
 *
 * One notice per file. A notice may name a date still to come (intimation in
 * advance); until that date passes the register reads "Pending commencement".
 * That is derived from the date, never stored, so it cannot go stale.
 */

// ── Where a file stands ─────────────────────────────────────────────────────

export const COMMENCEMENT_STATES = [
  'AWAITING_PROCEEDING',
  'PROCEEDING_ISSUED',
  'PENDING_COMMENCEMENT',
  'WORK_INITIATED',
] as const;

export type CommencementState = (typeof COMMENCEMENT_STATES)[number];

export const COMMENCEMENT_STATE_LABEL: Record<CommencementState, string> = {
  AWAITING_PROCEEDING: 'Proceeding not issued',
  PROCEEDING_ISSUED: 'Proceeding issued',
  PENDING_COMMENCEMENT: 'Pending commencement',
  WORK_INITIATED: 'Work initiated',
};

export const isCommencementState = (v: string): v is CommencementState =>
  (COMMENCEMENT_STATES as readonly string[]).includes(v);

/** The day a date falls on, as midnight UTC — commencement is a calendar date. */
export const dayOf = (d: Date | string) => new Date(new Date(d).toISOString().slice(0, 10));

export function commencementState(args: {
  orderIssued: boolean;
  commencementDate: Date | string | null | undefined;
  now: Date;
}): CommencementState {
  if (args.commencementDate) {
    return dayOf(args.commencementDate).getTime() > dayOf(args.now).getTime() ? 'PENDING_COMMENCEMENT' : 'WORK_INITIATED';
  }
  return args.orderIssued ? 'PROCEEDING_ISSUED' : 'AWAITING_PROCEEDING';
}

// ── May work be notified? ───────────────────────────────────────────────────

export type CommencementFacts = {
  applicationStatus: string;
  order: { status: string; revokedAt: Date | string | null; validUntil: Date | string | null } | null;
  alreadyNotified: boolean;
  now: Date;
};

/**
 * Why a commencement notice cannot be given on this file — or null when it
 * can. The workflow asks the same questions (fromStatus APPROVED, the guards
 * `proceeding_issued` and `no_work_commencement`); asking here first lets the
 * screen say why the button is absent and keeps a refused caller from
 * uploading anything.
 */
export function commencementBlocker(f: CommencementFacts): string | null {
  if (f.applicationStatus !== 'APPROVED') {
    return f.applicationStatus === 'PROCEEDING_REVOKED'
      ? 'The permission on this file has been revoked. Work may not commence.'
      : 'Work may be notified only on an approved application.';
  }
  if (!f.order) return 'The building permission order has not been drawn up yet.';
  if (f.order.revokedAt || f.order.status === 'REVOKED') return 'The building permission order has been revoked.';
  if (f.order.status !== 'ISSUED') return 'The building permission order has not been issued yet. Work may commence only after it is.';
  if (f.order.validUntil && dayOf(f.order.validUntil).getTime() < dayOf(f.now).getTime()) {
    return 'The building permission has lapsed. It must be renewed before work commences.';
  }
  if (f.alreadyNotified) return 'Commencement of work has already been notified on this file.';
  return null;
}

/**
 * Whether a commencement date is acceptable. Not before the order was issued
 * (there was no permission to work under), and not after it lapses.
 */
export function commencementDateProblem(
  date: Date | string,
  order: { issuedAt: Date | string; validUntil: Date | string | null }
): string | null {
  const d = dayOf(date);
  if (Number.isNaN(d.getTime())) return 'Enter a valid commencement date.';
  if (d.getTime() < dayOf(order.issuedAt).getTime()) return 'Work cannot commence before the building permission order was issued.';
  if (order.validUntil && d.getTime() > dayOf(order.validUntil).getTime()) {
    return 'The commencement date falls after the permission lapses.';
  }
  return null;
}

// ── Supporting documents ────────────────────────────────────────────────────

export const COMMENCEMENT_DOCUMENTS = ['COMMENCEMENT_NOTICE', 'SITE_PHOTOGRAPH', 'CONTRACTOR_UNDERTAKING'] as const;

export type CommencementDocumentKind = (typeof COMMENCEMENT_DOCUMENTS)[number];

export const COMMENCEMENT_DOCUMENT_LABEL: Record<CommencementDocumentKind, string> = {
  COMMENCEMENT_NOTICE: 'Signed commencement notice',
  SITE_PHOTOGRAPH: 'Site photograph',
  CONTRACTOR_UNDERTAKING: 'Contractor undertaking',
};

export const isCommencementDocumentKind = (v: string): v is CommencementDocumentKind =>
  (COMMENCEMENT_DOCUMENTS as readonly string[]).includes(v);

/**
 * DEMO RULE, stated once so it can be replaced once: the notice itself must be
 * on record. No BBAS manual supplied to this project lists what else a
 * commencement intimation carries; the other kinds are kept when supplied.
 */
export const REQUIRED_COMMENCEMENT_DOCUMENTS: readonly CommencementDocumentKind[] = ['COMMENCEMENT_NOTICE'];

export type CommencementDocument = {
  kind: CommencementDocumentKind;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemo: boolean;
  addedAt: string;
  addedByName: string;
};

export const missingCommencementDocuments = (kinds: readonly string[]) =>
  REQUIRED_COMMENCEMENT_DOCUMENTS.filter((k) => !kinds.includes(k));

export type Contractor = { name: string; licenceNo: string; phone: string; address: string };
