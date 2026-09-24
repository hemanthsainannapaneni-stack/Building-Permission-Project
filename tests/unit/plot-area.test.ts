import { describe, it, expect } from 'vitest';
import { checkPlotAreas } from '@/lib/plot-area';

/**
 * The BBAS plot-area chain.
 *
 * What these assert above everything else is that the function REPORTS and
 * never CORRECTS. A demand raised last March was computed from the figures as
 * they stood then; a helper that silently recomputed the net area today would
 * restate an assessment somebody has already paid against, and the restatement
 * would be invisible. So a disagreement comes back as a finding for a human,
 * and the stored value is returned untouched.
 */

describe('the chain', () => {
  it('takes every deduction off the gross', () => {
    const check = checkPlotAreas({
      grossPlotAreaSqm: 1000,
      roadWideningDeductionSqm: 60,
      greenBufferDeductionSqm: 25,
      surrenderGiftAreaSqm: 15,
      netPlotAreaSqm: 900,
    });

    expect(check.totalDeductionSqm).toBe(100);
    expect(check.computedNetSqm).toBe(900);
    expect(check.netMismatch).toBeNull();
  });

  it('treats a missing deduction as zero rather than as unknown', () => {
    // A blank road-widening box means nothing was taken off, which is the
    // ordinary case on a plot that abuts no widening alignment.
    const check = checkPlotAreas({ grossPlotAreaSqm: 500, netPlotAreaSqm: 500 });
    expect(check.totalDeductionSqm).toBe(0);
    expect(check.computedNetSqm).toBe(500);
    expect(check.netMismatch).toBeNull();
  });

  it('cannot compute a net area without a gross one', () => {
    const check = checkPlotAreas({ roadWideningDeductionSqm: 40, netPlotAreaSqm: 460 });
    expect(check.computedNetSqm).toBeNull();
    expect(check.netMismatch).toBeNull();
  });
});

describe('disagreements', () => {
  it('reports a net area that does not follow from the deductions', () => {
    const check = checkPlotAreas({
      grossPlotAreaSqm: 1000,
      roadWideningDeductionSqm: 100,
      netPlotAreaSqm: 950,
    });

    expect(check.netMismatch).toEqual({ stored: 950, computed: 900, differenceSqm: 50 });
    // And the stored figure comes back exactly as stored.
    expect(check.netMismatch?.stored).toBe(950);
  });

  it('ignores a rounding-sized difference', () => {
    const check = checkPlotAreas({
      grossPlotAreaSqm: 1000,
      roadWideningDeductionSqm: 100,
      netPlotAreaSqm: 900.2,
    });
    expect(check.netMismatch).toBeNull();
  });

  /**
   * A plot that measures less on the ground than the deed claims is one of the
   * commonest real findings in a building permission file. It is a SHORTFALL
   * for an officer to raise — never a number for a function to average away.
   */
  it('reports a ground measurement that differs from the document', () => {
    const check = checkPlotAreas({ documentAreaSqm: 1000, groundAreaSqm: 962 });
    expect(check.groundMismatch).toEqual({ document: 1000, ground: 962, differenceSqm: -38 });
  });

  it('says nothing about the ground when it has not been measured', () => {
    expect(checkPlotAreas({ documentAreaSqm: 1000 }).groundMismatch).toBeNull();
    expect(checkPlotAreas({ groundAreaSqm: 1000 }).groundMismatch).toBeNull();
  });

  it('flags deductions that exceed the gross', () => {
    const check = checkPlotAreas({
      grossPlotAreaSqm: 300,
      roadWideningDeductionSqm: 200,
      greenBufferDeductionSqm: 150,
    });

    expect(check.overDeducted).toBe(true);
    expect(check.computedNetSqm).toBe(-50);
  });

  it('does not flag an exactly exhausted plot', () => {
    // Fully surrendered is a real, if unusual, position: net zero, not an error.
    const check = checkPlotAreas({ grossPlotAreaSqm: 300, surrenderGiftAreaSqm: 300 });
    expect(check.overDeducted).toBe(false);
    expect(check.computedNetSqm).toBe(0);
  });
});
