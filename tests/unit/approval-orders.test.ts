import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONDITIONS,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  canTransitionOrder,
  deriveCoveragePercent,
  deriveFsi,
  deriveNetPlotArea,
  isOrderPublic,
  isProvisional,
  orderStatusLabel,
  whyNotOrder,
} from '@/lib/approval-orders';
import {
  PUBLIC_STATUS,
  publicStatus,
  publicStatusLabel,
} from '@/server/services/public-verification';

/**
 * The permission order's vocabulary and the public status mapping.
 *
 * Both are pure, both are isomorphic, and both have a failure mode that is
 * cheap to test here and expensive to discover anywhere else: a lifecycle the
 * client and server disagree about, and a status mapping that leaks an
 * internal desk name to a stranger.
 */

describe('the order lifecycle', () => {
  it('is terminal at ISSUED — an issued order is revoked, never edited', () => {
    expect(ORDER_TRANSITIONS[ORDER_STATUS.ISSUED]).toEqual([]);
    expect(ORDER_TRANSITIONS.REVOKED).toEqual([]);
  });

  it('allows the full forward path one step at a time', () => {
    expect(canTransitionOrder(ORDER_STATUS.DRAFT, ORDER_STATUS.PREVIEW)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.PREVIEW, ORDER_STATUS.GENERATED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.GENERATED, ORDER_STATUS.APPROVED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.APPROVED, ORDER_STATUS.ISSUED)).toBe(true);
  });

  it('refuses every shortcut to ISSUED', () => {
    // The property that matters most here: nothing reaches ISSUED without
    // passing through APPROVED, which is a person's decision.
    for (const from of [ORDER_STATUS.DRAFT, ORDER_STATUS.PREVIEW, ORDER_STATUS.GENERATED]) {
      expect(canTransitionOrder(from, ORDER_STATUS.ISSUED), `${from} → ISSUED`).toBe(false);
    }
  });

  it('lets a mistake be corrected before issue, and not after', () => {
    expect(canTransitionOrder(ORDER_STATUS.PREVIEW, ORDER_STATUS.DRAFT)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.GENERATED, ORDER_STATUS.PREVIEW)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.APPROVED, ORDER_STATUS.GENERATED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.ISSUED, ORDER_STATUS.APPROVED)).toBe(false);
    expect(canTransitionOrder(ORDER_STATUS.ISSUED, ORDER_STATUS.DRAFT)).toBe(false);
  });

  it('explains a refusal in words the person refused can act on', () => {
    expect(whyNotOrder(ORDER_STATUS.ISSUED, ORDER_STATUS.DRAFT)).toContain('revoked, never edited');
    expect(whyNotOrder(ORDER_STATUS.DRAFT, ORDER_STATUS.ISSUED)).toContain('approved');
    expect(whyNotOrder(ORDER_STATUS.DRAFT, ORDER_STATUS.PREVIEW)).toBeNull();
  });

  it('treats everything short of ISSUED as provisional and non-public', () => {
    for (const state of [ORDER_STATUS.DRAFT, ORDER_STATUS.PREVIEW, ORDER_STATUS.GENERATED, ORDER_STATUS.APPROVED]) {
      expect(isProvisional(state), state).toBe(true);
      expect(isOrderPublic(state), state).toBe(false);
    }
    expect(isProvisional(ORDER_STATUS.ISSUED)).toBe(false);
    expect(isOrderPublic(ORDER_STATUS.ISSUED)).toBe(true);
  });

  it('labels every state it defines', () => {
    for (const state of Object.values(ORDER_STATUS)) {
      expect(orderStatusLabel(state)).not.toBe(state);
    }
  });

  it('ships conditions to print', () => {
    expect(DEFAULT_CONDITIONS.length).toBeGreaterThan(4);
    // Every condition is a sentence somebody can act on, not a fragment.
    for (const condition of DEFAULT_CONDITIONS) {
      expect(condition.length).toBeGreaterThan(40);
      expect(condition.endsWith('.')).toBe(true);
    }
  });
});

describe('derived building figures', () => {
  it('computes FSI from floor area over plot area', () => {
    expect(deriveFsi({ plotAreaSqm: 300, floorAreaSqm: 450 })).toBe(1.5);
  });

  it('prefers a figure the scrutiny engine actually assessed', () => {
    // A stored `achievedFar` came from the engine that read the drawing. Our
    // arithmetic over the declared areas is the fallback, not the authority.
    expect(deriveFsi({ plotAreaSqm: 300, floorAreaSqm: 450, achievedFar: 1.42 })).toBe(1.42);
  });

  it('falls back to built-up area when floor area is not recorded', () => {
    expect(deriveFsi({ plotAreaSqm: 200, floorAreaSqm: 0, builtUpAreaSqm: 300 })).toBe(1.5);
  });

  it('returns null rather than zero when the plot is unmeasured', () => {
    // Zero is a claim about the building. Null is the absence of a measurement,
    // and the order prints "Not assessed" rather than "FSI 0.00".
    expect(deriveFsi({ plotAreaSqm: null, floorAreaSqm: 450 })).toBeNull();
    expect(deriveFsi({ plotAreaSqm: 0, floorAreaSqm: 450 })).toBeNull();
    expect(deriveCoveragePercent({ plotAreaSqm: null, coverageAreaSqm: 100 })).toBeNull();
  });

  it('computes coverage as a percentage', () => {
    expect(deriveCoveragePercent({ plotAreaSqm: 400, coverageAreaSqm: 180 })).toBe(45);
  });
});

describe('net plot area', () => {
  it('equals the gross when nobody recorded a deduction', () => {
    // The honest answer when the question has not been asked. It deliberately
    // does not invent a road-widening deduction.
    const result = deriveNetPlotArea(300, {});
    expect(result.net).toBe(300);
    expect(result.deducted).toBe(0);
    expect(result.isAssumed).toBe(true);
  });

  it('uses a stated net area where one exists', () => {
    const result = deriveNetPlotArea(300, { netPlotAreaSqm: 265 });
    expect(result.net).toBe(265);
    expect(result.deducted).toBe(35);
    expect(result.isAssumed).toBe(false);
  });

  it('ignores a stated net area larger than the gross', () => {
    // A deduction cannot add land. A figure that claims it is nonsense, and
    // trusting it would overstate the permissible floor area.
    const result = deriveNetPlotArea(300, { netPlotAreaSqm: 400 });
    expect(result.net).toBe(300);
    expect(result.isAssumed).toBe(true);
  });

  it('returns null for an unmeasured plot', () => {
    expect(deriveNetPlotArea(null, {}).net).toBeNull();
    expect(deriveNetPlotArea(undefined, { netPlotAreaSqm: 100 }).net).toBeNull();
  });
});

describe('the public status mapping', () => {
  it('reports the two decided outcomes plainly', () => {
    expect(publicStatus('APPROVED')).toBe(PUBLIC_STATUS.APPROVED);
    expect(publicStatus('REJECTED')).toBe(PUBLIC_STATUS.REJECTED);
    expect(publicStatus('DRAFT')).toBe(PUBLIC_STATUS.NOT_SUBMITTED);
  });

  it('collapses every desk-specific shortfall status to one public state', () => {
    // THE property this mapping exists for. None of these may reach a stranger
    // in their internal spelling, because each one names a desk.
    for (const status of [
      'TPA_DOCUMENT_SHORTFALL',
      'TPA_FEE_SHORTFALL',
      'ZDD_SHORTFALL',
      'ZJD_FEE_SHORTFALL',
      'PLANNING_OFFICER_SHORTFALL',
      'DIRECTOR_REPORTED_SHORTFALL',
      'RETURNED_TO_APPLICANT',
    ]) {
      expect(publicStatus(status), status).toBe(PUBLIC_STATUS.WITH_APPLICANT);
    }
  });

  it('collapses every departmental desk to "under process"', () => {
    for (const status of ['PENDING_TPA', 'TPA_REVIEW', 'ZJD_REVIEW', 'PENDING_ZDD', 'SUBMITTED']) {
      expect(publicStatus(status), status).toBe(PUBLIC_STATUS.UNDER_PROCESS);
    }
  });

  it('maps a status it has never heard of to "under process"', () => {
    // The safe direction, and the reason the default is not the raw value:
    // falling through would publish the internal name of whatever state
    // somebody added last week.
    expect(publicStatus('SOME_NEW_DESK_REVIEW')).toBe(PUBLIC_STATUS.UNDER_PROCESS);
    expect(publicStatus('')).toBe(PUBLIC_STATUS.UNDER_PROCESS);
  });

  it('never returns a label containing a desk name', () => {
    for (const state of Object.values(PUBLIC_STATUS)) {
      const label = publicStatusLabel(state);
      expect(label).toBeTruthy();
      expect(/TPA|ZDD|ZJD|COMMISSIONER|DIRECTOR|OFFICER/i.test(label), label).toBe(false);
    }
  });
});
