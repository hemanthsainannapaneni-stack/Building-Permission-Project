/**
 * The Outward register — every document that leaves the office, and what
 * became of it. Isomorphic.
 *
 * Clerical, not a decision: nothing here moves an application. A show cause
 * notice and a revocation order are sent here automatically, in the same
 * transaction that creates them; anything else (a BPO, a letter) is entered by
 * hand.
 *
 *   DRAFT ─Mark ready─▶ READY_FOR_DISPATCH ─Dispatch─▶ DISPATCHED
 *                                                         │
 *                         Record delivery ────────────────┼─▶ DELIVERED
 *                         Record acknowledgement ─────────┼─▶ ACKNOWLEDGED  (from DELIVERED too)
 *                         Record return ──────────────────┘─▶ RETURNED ─Mark ready─▶ READY_FOR_DISPATCH
 *
 *   DRAFT / READY_FOR_DISPATCH ─Cancel─▶ CANCELLED
 */

export const OUTWARD_DOCUMENT_TYPES = [
  'BPO',
  'SHORTFALL_LETTER',
  'SHOW_CAUSE_NOTICE',
  'REVOCATION_ORDER',
  'REGISTRATION_LETTER',
  'OCCUPANCY_CERTIFICATE',
  'OTHER',
] as const;
export type OutwardDocumentType = (typeof OUTWARD_DOCUMENT_TYPES)[number];

export const OUTWARD_DOCUMENT_LABEL: Record<OutwardDocumentType, string> = {
  BPO: 'BPO',
  SHORTFALL_LETTER: 'Shortfall Letter',
  SHOW_CAUSE_NOTICE: 'Show Cause Notice',
  REVOCATION_ORDER: 'Revocation Order',
  REGISTRATION_LETTER: 'Registration Letter',
  OCCUPANCY_CERTIFICATE: 'Occupancy Certificate',
  OTHER: 'Other',
};

/** Created only by the module that generates them — never by hand. */
export const SYSTEM_GENERATED_TYPES: readonly OutwardDocumentType[] = ['SHOW_CAUSE_NOTICE', 'REVOCATION_ORDER', 'OCCUPANCY_CERTIFICATE'];

export const isOutwardDocumentType = (v: string): v is OutwardDocumentType =>
  (OUTWARD_DOCUMENT_TYPES as readonly string[]).includes(v);

export const OUTWARD_STATUSES = [
  'DRAFT',
  'READY_FOR_DISPATCH',
  'DISPATCHED',
  'DELIVERED',
  'ACKNOWLEDGED',
  'RETURNED',
  'CANCELLED',
] as const;
export type OutwardStatus = (typeof OUTWARD_STATUSES)[number];

export const OUTWARD_STATUS_LABEL: Record<OutwardStatus, string> = {
  DRAFT: 'Draft',
  READY_FOR_DISPATCH: 'Ready for Dispatch',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  ACKNOWLEDGED: 'Acknowledged',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};

export const isOutwardStatus = (v: string): v is OutwardStatus => (OUTWARD_STATUSES as readonly string[]).includes(v);

export const OUTWARD_MODES = ['BY_HAND', 'REGISTERED_POST', 'SPEED_POST', 'COURIER', 'EMAIL', 'PORTAL'] as const;
export type OutwardMode = (typeof OUTWARD_MODES)[number];

export const OUTWARD_MODE_LABEL: Record<OutwardMode, string> = {
  BY_HAND: 'By hand',
  REGISTERED_POST: 'Registered post',
  SPEED_POST: 'Speed post',
  COURIER: 'Courier',
  EMAIL: 'Email',
  PORTAL: 'Portal',
};

// ── Moves ───────────────────────────────────────────────────────────────────

export const OUTWARD_ACTIONS = [
  'MARK_READY',
  'DISPATCH',
  'RECORD_DELIVERY',
  'RECORD_ACKNOWLEDGEMENT',
  'RECORD_RETURN',
  'CANCEL',
] as const;
export type OutwardAction = (typeof OUTWARD_ACTIONS)[number];

export const OUTWARD_ACTION_LABEL: Record<OutwardAction, string> = {
  MARK_READY: 'Mark ready for dispatch',
  DISPATCH: 'Dispatch',
  RECORD_DELIVERY: 'Record delivery',
  RECORD_ACKNOWLEDGEMENT: 'Record acknowledgement',
  RECORD_RETURN: 'Record return',
  CANCEL: 'Cancel',
};

export const OUTWARD_ACTION_RESULT: Record<OutwardAction, OutwardStatus> = {
  MARK_READY: 'READY_FOR_DISPATCH',
  DISPATCH: 'DISPATCHED',
  RECORD_DELIVERY: 'DELIVERED',
  RECORD_ACKNOWLEDGEMENT: 'ACKNOWLEDGED',
  RECORD_RETURN: 'RETURNED',
  CANCEL: 'CANCELLED',
};

const FROM: Record<OutwardAction, readonly OutwardStatus[]> = {
  MARK_READY: ['DRAFT', 'RETURNED'],
  DISPATCH: ['READY_FOR_DISPATCH'],
  RECORD_DELIVERY: ['DISPATCHED'],
  // A hand delivery is often acknowledged on the spot, with no separate
  // delivery record.
  RECORD_ACKNOWLEDGEMENT: ['DISPATCHED', 'DELIVERED'],
  RECORD_RETURN: ['DISPATCHED'],
  CANCEL: ['DRAFT', 'READY_FOR_DISPATCH'],
};

export const canMoveOutward = (action: OutwardAction, from: string): boolean =>
  isOutwardStatus(from) && FROM[action].includes(from);

export const outwardMoves = (status: string): OutwardAction[] => OUTWARD_ACTIONS.filter((a) => canMoveOutward(a, status));

/** The "Delivery Status" column: where the paper is, in one word. */
export function deliveryStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
    case 'READY_FOR_DISPATCH':
      return 'Not sent';
    case 'DISPATCHED':
      return 'In transit';
    case 'DELIVERED':
      return 'Delivered';
    case 'ACKNOWLEDGED':
      return 'Delivered — acknowledged';
    case 'RETURNED':
      return 'Returned undelivered';
    case 'CANCELLED':
      return 'Not sent — cancelled';
    default:
      return '—';
  }
}
