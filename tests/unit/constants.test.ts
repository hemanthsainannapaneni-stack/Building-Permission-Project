import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CLOSED_SHORTFALL_STATUSES, ROLES, STAGE_CODES } from '@/lib/constants';
import { SHORTFALL_STATUS, isShortfallOpen } from '@/lib/shortfalls';

/**
 * Guards on the ratified decisions.
 *
 * These are cheap tests that would look pointless in most codebases. They are
 * here because each one asserts the ABSENCE of something a future change might
 * reasonably reintroduce, and absence is exactly what the department decided.
 */

describe('ratified decisions', () => {
  it('has no scrutiny-override capability (D4)', () => {
    // The business has not authorised officers to override a failed scrutiny
    // result. The only route past a failure is:
    //   SCRUTINY_FAILED → LTP correction → new version → re-scrutiny
    // See docs/04-rbac.md H.3.1.
    const keys = Object.keys(CAPABILITIES);
    expect(keys).not.toContain('SCRUTINY_OVERRIDE');
    expect(keys.filter((k) => k.includes('OVERRIDE'))).toEqual([]);
  });

  it('has no approval-bypass capability of any kind (D3)', () => {
    // OPEN_SHORTFALLS > 0 → APPROVAL BLOCKED, with no override implemented.
    const suspicious = Object.keys(CAPABILITIES).filter((k) =>
      /BYPASS|OVERRIDE|FORCE|SKIP/.test(k)
    );
    expect(suspicious).toEqual([]);
  });

  it('counts every non-closed shortfall status as open (D3)', () => {
    // The guard must not distinguish blocking from reported, nor kind from
    // kind. A shortfall is open until someone resolves it — and stating the
    // rule as the CLOSED set is what makes a status added later open by
    // default rather than silently approvable.
    expect([...CLOSED_SHORTFALL_STATUSES].sort()).toEqual(['CANCELLED', 'RESOLVED']);

    for (const status of Object.values(SHORTFALL_STATUS)) {
      const closed = (CLOSED_SHORTFALL_STATUSES as readonly string[]).includes(status);
      expect(isShortfallOpen(status), status).toBe(!closed);
    }

    // The one that matters most: a shortfall nobody has been told about yet
    // still blocks approval.
    expect(isShortfallOpen(SHORTFALL_STATUS.RAISED)).toBe(true);
  });

  it('grants approval to the Commissioner alone', () => {
    expect(CAPABILITIES.APPLICATION_APPROVE).toBe('APPLICATION_APPROVE');
    // System admin configures the system but cannot approve — the separation
    // that makes the audit trail meaningful.
    expect(ROLES.SYSTEM_ADMIN).not.toBe(ROLES.COMMISSIONER);
  });
});

describe('vocabulary', () => {
  it('keys and values match, so a typo is a compile error not a silent denial', () => {
    for (const [key, value] of Object.entries(CAPABILITIES)) expect(value).toBe(key);
    for (const [key, value] of Object.entries(ROLES)) expect(value).toBe(key);
    for (const [key, value] of Object.entries(STAGE_CODES)) expect(value).toBe(key);
  });

  it('defines all twelve roles', () => {
    // Eleven until PLANNING_OFFICER was added for the BBAS_STANDARD workflow.
    expect(Object.keys(ROLES)).toHaveLength(12);
    expect(ROLES.PLANNING_OFFICER).toBeDefined();
  });

  it('defines the stages the workflow seeds expect', () => {
    // Thirteen for BP_STANDARD, plus the three desks BBAS_STANDARD adds —
    // the Planning Officer, the ZDD's own desk, and the TPA's site inspection —
    // plus CLOSED_REVOKED, where a revoked permission ends (Phase 7).
    expect(Object.keys(STAGE_CODES)).toHaveLength(17);
    expect(STAGE_CODES.CLOSED_REVOKED).toBeDefined();
    expect(STAGE_CODES.TPA_SITE_INSPECTION).toBeDefined();
    expect(STAGE_CODES.LTP_SHORTFALL_ACTION).toBeDefined();
    expect(STAGE_CODES.CLOSED_APPROVED).toBeDefined();
    expect(STAGE_CODES.PLANNING_OFFICER_REVIEW).toBeDefined();
    expect(STAGE_CODES.ZDD_REVIEW).toBeDefined();
  });
});
