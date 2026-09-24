import { describe, it, expect } from 'vitest';
import {
  AWAITING_DECISION_STATUSES,
  OPEN_SHOW_CAUSE_STATUSES,
  SHOW_CAUSE_DECISIONS,
  SHOW_CAUSE_DECISION_RESULT,
  SHOW_CAUSE_STATUSES,
  canDecide,
  canRespond,
  canTakeUp,
  responseDueLabel,
} from '@/lib/show-cause';
import { SHORTFALL_STATUS } from '@/lib/shortfalls';
import { OPEN_REVOCATION_STATUSES, PROCEEDING_REVOKED, REVOCATION_STATUSES } from '@/lib/revocation';
import {
  OUTWARD_ACTIONS,
  OUTWARD_ACTION_RESULT,
  OUTWARD_DOCUMENT_TYPES,
  SYSTEM_GENERATED_TYPES,
  canMoveOutward,
  outwardMoves,
} from '@/lib/outward';
import { APPLICATION_STATUSES, statusMeta } from '@/lib/status';
import { TERMINAL_STATUSES } from '@/lib/constants';
import { ACTIONS, EFFECTS, GUARDS } from '@/lib/workflow';
import { transitionsOf } from '../../prisma/seed/workflow/builder';
import { BBAS_STANDARD } from '../../prisma/seed/workflow/bbas-standard';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';

/**
 * Phase 7 — show cause, revocation, outward. The state machines the service
 * and the screens share, and the separations the brief insists on.
 */

describe('show cause is not a shortfall', () => {
  it('shares no status with the shortfall lifecycle', () => {
    const shortfall = new Set<string>(Object.values(SHORTFALL_STATUS));
    const overlap = SHOW_CAUSE_STATUSES.filter((s) => shortfall.has(s) && s !== 'UNDER_REVIEW' && s !== 'REJECTED');
    expect(overlap).toEqual([]);
  });

  it('uses its own workflow actions and effects, none of them a shortfall one', () => {
    expect(ACTIONS.ISSUE_SHOW_CAUSE).toBe('ISSUE_SHOW_CAUSE');
    expect(EFFECTS.SHOW_CAUSE).toBe('SHOW_CAUSE');
    expect(EFFECTS.SHOW_CAUSE).not.toContain('SHORTFALL');
    expect(GUARDS.NO_OPEN_SHOW_CAUSE).not.toContain('shortfall');
  });
});

describe('show cause lifecycle', () => {
  it('is answered only after dispatch, and only once', () => {
    expect(canRespond('ISSUED')).toBe(false);
    expect(canRespond('AWAITING_RESPONSE')).toBe(true);
    expect(canRespond('RESPONDED')).toBe(false);
  });

  it('is taken up after an answer, and decided only once taken up', () => {
    expect(canTakeUp('AWAITING_RESPONSE')).toBe(false);
    expect(canTakeUp('RESPONDED')).toBe(true);
    expect(canDecide('RESPONDED')).toBe(false);
    expect(canDecide('UNDER_REVIEW')).toBe(true);
    expect(canDecide('CLOSED')).toBe(false);
    expect([...AWAITING_DECISION_STATUSES].every((s) => OPEN_SHOW_CAUSE_STATUSES.includes(s))).toBe(true);
  });

  it('maps every decision to a distinct, closed status', () => {
    const results = SHOW_CAUSE_DECISIONS.map((d) => SHOW_CAUSE_DECISION_RESULT[d]);
    expect(new Set(results).size).toBe(SHOW_CAUSE_DECISIONS.length);
    for (const r of results) expect(OPEN_SHOW_CAUSE_STATUSES).not.toContain(r);
  });

  it('describes a passed due date in words only', () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    expect(responseDueLabel('AWAITING_RESPONSE', past)).toMatch(/past due/);
    expect(responseDueLabel('RESPONDED', past)).toBe('');
  });
});

describe('revocation', () => {
  it('has the four states of the brief and two open ones', () => {
    expect([...REVOCATION_STATUSES]).toEqual(['PROPOSED', 'UNDER_REVIEW', 'REVOKED', 'REJECTED']);
    expect([...OPEN_REVOCATION_STATUSES]).toEqual(['PROPOSED', 'UNDER_REVIEW']);
  });

  it('leaves the application in a labelled, terminal PROCEEDING_REVOKED', () => {
    expect(APPLICATION_STATUSES).toContain(PROCEEDING_REVOKED);
    expect(statusMeta('application', PROCEEDING_REVOKED).label).toBe('Proceeding revoked');
    expect(TERMINAL_STATUSES as readonly string[]).toContain(PROCEEDING_REVOKED);
  });
});

describe('outward', () => {
  it('carries the seven document types and statuses of the brief', () => {
    expect(OUTWARD_DOCUMENT_TYPES).toHaveLength(7);
    // Phase 10: an occupancy certificate reaches Outward only from the
    // ISSUE_OCCUPANCY_CERTIFICATE step, never by hand.
    expect([...SYSTEM_GENERATED_TYPES].sort()).toEqual(['OCCUPANCY_CERTIFICATE', 'REVOCATION_ORDER', 'SHOW_CAUSE_NOTICE']);
  });

  it('dispatches only what is ready, and acknowledges only what was sent', () => {
    expect(canMoveOutward('DISPATCH', 'DRAFT')).toBe(false);
    expect(canMoveOutward('DISPATCH', 'READY_FOR_DISPATCH')).toBe(true);
    expect(canMoveOutward('RECORD_ACKNOWLEDGEMENT', 'READY_FOR_DISPATCH')).toBe(false);
    expect(canMoveOutward('RECORD_ACKNOWLEDGEMENT', 'DISPATCHED')).toBe(true);
    expect(canMoveOutward('RECORD_ACKNOWLEDGEMENT', 'DELIVERED')).toBe(true);
    expect(canMoveOutward('CANCEL', 'DISPATCHED')).toBe(false);
  });

  it('ends somewhere final', () => {
    expect(outwardMoves('ACKNOWLEDGED')).toEqual([]);
    expect(outwardMoves('CANCELLED')).toEqual([]);
    for (const a of OUTWARD_ACTIONS) expect(OUTWARD_ACTION_RESULT[a]).toBeTruthy();
  });
});

describe('the BBAS_STANDARD branches, as configuration', () => {
  const rows = transitionsOf(BBAS_STANDARD);
  const branch = [
    'ISSUE_SHOW_CAUSE',
    'RESPOND_SHOW_CAUSE',
    'TAKE_UP_SHOW_CAUSE',
    'DECIDE_SHOW_CAUSE',
    'INITIATE_REVOCATION',
    'TAKE_UP_REVOCATION',
    'REVOKE_PROCEEDING',
    'REJECT_REVOCATION',
  ];

  it('has a row for every step of both branches', () => {
    for (const code of branch) expect(rows.some((r) => r.action === code), code).toBe(true);
  });

  it('never moves the file for a show cause step, and keeps its status', () => {
    for (const r of rows.filter((x) => x.action.includes('SHOW_CAUSE'))) {
      expect(r.to, `${r.from}:${r.action}`).toBe(r.from);
      expect(r.effects?.some((e) => e.type === 'KEEP_STATUS'), `${r.from}:${r.action}`).toBe(true);
      expect(r.effects?.some((e) => String(e.type).includes('SHORTFALL')), `${r.from}:${r.action}`).toBe(false);
    }
  });

  it('orders the show cause steps by guards', () => {
    const guard = (action: string) => rows.find((r) => r.action === action)?.guards ?? [];
    expect(guard('RESPOND_SHOW_CAUSE')).toContain('show_cause_awaiting_response');
    expect(guard('TAKE_UP_SHOW_CAUSE')).toContain('show_cause_responded');
    expect(guard('DECIDE_SHOW_CAUSE')).toContain('show_cause_under_review');
  });

  it('revokes only from the approved stage, and only the revocation moves the file', () => {
    const revoke = rows.filter((r) => r.action === 'REVOKE_PROCEEDING');
    expect(revoke.map((r) => [r.from, r.to, r.toStatus])).toEqual([['CLOSED_APPROVED', 'CLOSED_REVOKED', 'PROCEEDING_REVOKED']]);
    for (const r of rows.filter((x) => ['INITIATE_REVOCATION', 'TAKE_UP_REVOCATION', 'REJECT_REVOCATION'].includes(x.action))) {
      expect(r.to).toBe('CLOSED_APPROVED');
    }
  });

  it('leaves the normal chain as it was: FORWARD needs nothing from either branch', () => {
    for (const r of rows.filter((x) => x.action === 'FORWARD')) {
      expect((r.guards ?? []).filter((g) => /show_cause|revocation/.test(g))).toEqual([]);
    }
  });

  it('gives the applicant response to the system, never to a desk role', () => {
    for (const r of rows.filter((x) => x.action === 'RESPOND_SHOW_CAUSE')) expect(r.allowedRoleKeys ?? []).toEqual([]);
  });
});

describe('Outward management', () => {
  it('is held by the ZJD desk and the System Administrator only — no invented dispatch role', () => {
    const holders = Object.entries(RBAC_MATRIX)
      .filter(([, caps]) => (caps as readonly string[]).includes('OUTWARD_MANAGE'))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual(['SYSTEM_ADMIN', 'ZJD']);
  });
});
