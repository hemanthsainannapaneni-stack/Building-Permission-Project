/**
 * The BBAS plot-area chain, and the one check worth making on it.
 *
 * BBAS does not record a plot area. It records a sequence, and the sequence is
 * the point:
 *
 *     document area        what the title deed says
 *     ground area          what was measured on site
 *     gross plot area      the area taken forward for the calculation
 *       − road widening    surrendered to a master plan road alignment
 *       − green buffer     surrendered to a buffer or setback reservation
 *       − surrender / gift given up to the authority
 *     = net plot area      what the FAR and coverage are worked against
 *
 * ── Why nothing here recomputes anything ─────────────────────────────────
 *
 * `netPlotAreaSqm` is a stored column, not a derived one, and this file only
 * REPORTS a disagreement. A demand raised last March was computed from the
 * figures as they stood in March; silently recomputing the net area today
 * would restate an assessment somebody has already paid against, and the
 * restatement would be invisible. So the arithmetic is checked, the difference
 * is shown to the officer, and a human decides what to do about it.
 *
 * The same reasoning governs the document / ground pair. A plot that measures
 * less on the ground than the deed claims is one of the commonest real
 * findings in a building permission file, and it is a SHORTFALL for an officer
 * to raise — not a number for a function to average away.
 */

export type PlotAreas = {
  documentAreaSqm: number | null;
  groundAreaSqm: number | null;
  grossPlotAreaSqm: number | null;
  roadWideningDeductionSqm: number | null;
  greenBufferDeductionSqm: number | null;
  surrenderGiftAreaSqm: number | null;
  netPlotAreaSqm: number | null;
};

/** Sub-square-metre differences are rounding, not findings. */
const TOLERANCE_SQM = 0.5;

export type PlotAreaCheck = {
  /** Gross less every deduction, when the gross is known. */
  computedNetSqm: number | null;
  /** Everything taken off the gross. */
  totalDeductionSqm: number;
  /** Set when the stored net and the computed net disagree beyond tolerance. */
  netMismatch: { stored: number; computed: number; differenceSqm: number } | null;
  /** Set when the ground measurement differs from the document area. */
  groundMismatch: { document: number; ground: number; differenceSqm: number } | null;
  /** Set when the deductions exceed the gross — always an entry error. */
  overDeducted: boolean;
};

const n = (value: number | null | undefined): number => (typeof value === 'number' ? value : 0);

export function checkPlotAreas(areas: Partial<PlotAreas>): PlotAreaCheck {
  const totalDeductionSqm =
    n(areas.roadWideningDeductionSqm) +
    n(areas.greenBufferDeductionSqm) +
    n(areas.surrenderGiftAreaSqm);

  const gross = areas.grossPlotAreaSqm;
  const computedNetSqm = typeof gross === 'number' ? gross - totalDeductionSqm : null;

  let netMismatch: PlotAreaCheck['netMismatch'] = null;
  if (computedNetSqm !== null && typeof areas.netPlotAreaSqm === 'number') {
    const difference = areas.netPlotAreaSqm - computedNetSqm;
    if (Math.abs(difference) > TOLERANCE_SQM) {
      netMismatch = {
        stored: areas.netPlotAreaSqm,
        computed: computedNetSqm,
        differenceSqm: round2(difference),
      };
    }
  }

  let groundMismatch: PlotAreaCheck['groundMismatch'] = null;
  if (typeof areas.documentAreaSqm === 'number' && typeof areas.groundAreaSqm === 'number') {
    const difference = areas.groundAreaSqm - areas.documentAreaSqm;
    if (Math.abs(difference) > TOLERANCE_SQM) {
      groundMismatch = {
        document: areas.documentAreaSqm,
        ground: areas.groundAreaSqm,
        differenceSqm: round2(difference),
      };
    }
  }

  return {
    computedNetSqm: computedNetSqm === null ? null : round2(computedNetSqm),
    totalDeductionSqm: round2(totalDeductionSqm),
    netMismatch,
    groundMismatch,
    overDeducted: computedNetSqm !== null && computedNetSqm < 0,
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
