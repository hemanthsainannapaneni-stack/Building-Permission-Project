/**
 * The Building Permission Order — its lifecycle and its vocabulary.
 *
 * ── Why the machine lives in `src/lib` ───────────────────────────────────
 *
 * The same reason the shortfall machine does: the server refuses an illegal
 * transition and the client uses the same table to decide which buttons exist.
 * Two copies of a state machine is two state machines, and the second one is
 * always the one that is wrong.
 *
 * ── The lifecycle is about EVIDENCE, not about workflow ──────────────────
 *
 * The permission is granted by the workflow's APPROVE transition. This
 * lifecycle governs the DOCUMENT that evidences it — which is a different
 * thing, and the distinction matters in exactly one direction: an order may
 * lag behind its approval (a renderer was slow, a clerk has not looked at the
 * draft yet), but it may never run ahead of one. There is no path from an
 * unapproved application to an ISSUED order, and `ensureApprovalOrder` refuses
 * to create a row at all for an application that is not APPROVED.
 */

export const ORDER_STATUS = {
  /**
   * The row exists and its snapshot has been taken. Nothing is rendered and
   * nobody outside the department can see it.
   */
  DRAFT: 'DRAFT',
  /**
   * A PDF has been rendered for internal reading, watermarked PREVIEW. This is
   * the state in which a mistake is cheap to find, which is the whole reason
   * it exists between DRAFT and GENERATED.
   */
  PREVIEW: 'PREVIEW',
  /** The final artefact is rendered and stored, awaiting the signing desk. */
  GENERATED: 'GENERATED',
  /** The signing authority has passed it. Not yet released to the applicant. */
  APPROVED: 'APPROVED',
  /**
   * Released. The applicant can download it and the public verification page
   * will confirm it. Terminal — an order is never un-issued, only revoked,
   * which is a separate act with its own record.
   */
  ISSUED: 'ISSUED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PREVIEW: 'Preview',
  GENERATED: 'Generated',
  APPROVED: 'Approved',
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
};

export const orderStatusLabel = (status: string): string =>
  ORDER_STATUS_LABELS[status] ?? status;

/**
 * Every legal move, and nothing else.
 *
 * Deliberately a chain with no shortcuts forward and one step back. PREVIEW
 * can return to DRAFT because that is what finding a mistake in the preview
 * means; GENERATED can be re-rendered back to PREVIEW for the same reason.
 * Nothing returns from ISSUED, because a document that has left the building
 * cannot be recalled by changing a column — it is REVOKED, which says so.
 */
export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  [ORDER_STATUS.DRAFT]: [ORDER_STATUS.PREVIEW, ORDER_STATUS.GENERATED],
  [ORDER_STATUS.PREVIEW]: [ORDER_STATUS.DRAFT, ORDER_STATUS.GENERATED],
  [ORDER_STATUS.GENERATED]: [ORDER_STATUS.PREVIEW, ORDER_STATUS.APPROVED],
  [ORDER_STATUS.APPROVED]: [ORDER_STATUS.ISSUED, ORDER_STATUS.GENERATED],
  [ORDER_STATUS.ISSUED]: [],
  REVOKED: [],
};

export const canTransitionOrder = (from: string, to: string): boolean =>
  (ORDER_TRANSITIONS[from] ?? []).includes(to);

/** Why a move is refused, in the words of whoever is being refused. */
export function whyNotOrder(from: string, to: string): string | null {
  if (canTransitionOrder(from, to)) return null;

  if (from === ORDER_STATUS.ISSUED) {
    return 'This order has been issued. An issued order is revoked, never edited.';
  }
  if (from === 'REVOKED') return 'This order was revoked.';

  if (to === ORDER_STATUS.ISSUED) {
    return 'An order has to be approved by the signing authority before it can be issued.';
  }
  if (to === ORDER_STATUS.APPROVED) {
    return 'The final order has to be generated before it can be approved.';
  }

  return `An order that is ${orderStatusLabel(from).toLowerCase()} cannot become ${orderStatusLabel(to).toLowerCase()}.`;
}

/** Whether the applicant — and the public verification page — may see it. */
export const isOrderPublic = (status: string): boolean => status === ORDER_STATUS.ISSUED;

/**
 * Whether the rendered PDF should carry a PREVIEW watermark.
 *
 * Everything short of ISSUED does. A draft that prints identically to the
 * released permission is precisely the artefact that ends up in somebody's
 * file and gets acted on — the same reasoning as the demo watermark, and it
 * applies independently of it.
 */
export const isProvisional = (status: string): boolean => status !== ORDER_STATUS.ISSUED;

/**
 * The conditions printed on every permission.
 *
 * ── These are PLACEHOLDER wording ────────────────────────────────────────
 *
 * They read like the standard conditions a building permission carries, and
 * they are not drawn from any published rule — the BBAS manuals available to
 * this project do not contain the condition text. They are seeded so the
 * document has the shape of a real permission, they are stored ON the order
 * rather than read live, and an administrator can replace them. Nothing in the
 * system enforces any of them.
 */
export const DEFAULT_CONDITIONS: readonly string[] = [
  'The construction shall conform strictly to the plans and particulars approved with this permission. Any deviation requires fresh sanction before it is carried out.',
  'This permission does not confer, and shall not be construed as conferring, any title to the land or any right over it.',
  'The owner shall commence work only after giving written notice of commencement, and shall notify completion in the same manner.',
  'The setbacks, height, coverage and floor area shall be maintained as sanctioned. No portion of the setback area shall be covered or enclosed.',
  'Parking provision shall be maintained as sanctioned and shall not be converted to any other use.',
  'Rainwater harvesting structures shall be provided and maintained in working order for the life of the building.',
  'The permission is liable to be revoked if it is found to have been obtained by misrepresentation, or if any condition above is contravened.',
  'This permission is valid for the period stated. Work not completed within that period requires renewal before it continues.',
];

/** How long a permission runs for, unless an administrator says otherwise. */
export const DEFAULT_VALIDITY_YEARS = 3;

// ── Derived building figures ─────────────────────────────────────────────

/**
 * FSI and coverage, computed from the areas on the file.
 *
 * Computed rather than read because `achievedFar` and `achievedCoverage` are
 * columns a scrutiny engine populates and the demo engine does not, so on most
 * files they are 0 — and printing "FSI 0.00" on a permission for a two-storey
 * house is worse than printing nothing. Where the stored figure IS present it
 * wins, because it came from the engine that actually assessed the drawing.
 *
 * Returns null rather than 0 when the divisor is missing: an unmeasured plot
 * has no FSI, and 0 is a claim about the building rather than an absence.
 */
export function deriveFsi(building: {
  plotAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  builtUpAreaSqm?: number | null;
  achievedFar?: number | null;
}): number | null {
  if (building.achievedFar && building.achievedFar > 0) {
    return round2(building.achievedFar);
  }

  const plot = Number(building.plotAreaSqm ?? 0);
  // Floor area is the FSI numerator where it is recorded; built-up area is the
  // fallback, and on most files they are the same number.
  const floor = Number(building.floorAreaSqm ?? 0) || Number(building.builtUpAreaSqm ?? 0);

  if (plot <= 0 || floor <= 0) return null;
  return round2(floor / plot);
}

/** Coverage as a percentage of the plot. Null when the plot is unmeasured. */
export function deriveCoveragePercent(building: {
  plotAreaSqm?: number | null;
  coverageAreaSqm?: number | null;
  achievedCoverage?: number | null;
}): number | null {
  if (building.achievedCoverage && building.achievedCoverage > 0) {
    return round2(building.achievedCoverage);
  }

  const plot = Number(building.plotAreaSqm ?? 0);
  const covered = Number(building.coverageAreaSqm ?? 0);

  if (plot <= 0 || covered <= 0) return null;
  return round2((covered / plot) * 100);
}

/**
 * Net plot area — the plot less any area surrendered or affected.
 *
 * ── It is read, never guessed ────────────────────────────────────────────
 *
 * Road widening, layout surrender and affected extent are real deductions with
 * legal consequences, and this system has nowhere to record them yet: there is
 * no `roadWideningAreaSqm` column and no step in the wizard that asks. So the
 * net area is read from `metadata.netPlotAreaSqm` when somebody has put it
 * there, and otherwise EQUALS the gross — which is true whenever nothing was
 * surrendered, and is the honest answer when nobody has been asked.
 *
 * It deliberately does not invent a deduction. A permission that understates
 * the net area understates the permissible floor area, and a demonstration
 * that made one up would be teaching the wrong number.
 */
export function deriveNetPlotArea(
  plotAreaSqm: number | null | undefined,
  metadata: unknown
): { net: number | null; deducted: number; isAssumed: boolean } {
  const gross = plotAreaSqm == null ? null : Number(plotAreaSqm);
  if (gross == null || !Number.isFinite(gross)) {
    return { net: null, deducted: 0, isAssumed: false };
  }

  const meta = (metadata ?? {}) as Record<string, unknown>;
  const stated = Number(meta.netPlotAreaSqm ?? NaN);

  if (Number.isFinite(stated) && stated > 0 && stated <= gross) {
    return { net: round2(stated), deducted: round2(gross - stated), isAssumed: false };
  }

  return { net: round2(gross), deducted: 0, isAssumed: true };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
