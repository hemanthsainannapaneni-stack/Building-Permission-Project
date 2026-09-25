import { describe, it, expect } from 'vitest';
import {
  NEXT_STEP,
  OPEN_PROFESSIONAL_CHANGE_STATUSES,
  PROFESSIONAL_CHANGE_DOCUMENTS,
  PROFESSIONAL_CHANGE_DOCUMENT_LABEL,
  PROFESSIONAL_CHANGE_STATUSES,
  PROFESSIONAL_CHANGE_STEP_CAPABILITY,
  canDecide,
  canReview,
  canVerify,
  hasRelease,
  licenceValidOn,
  missingAtRequest,
} from '@/lib/professional-change';
import { statusMeta } from '@/lib/status';
import { ACTIONS, EFFECTS, GUARDS } from '@/lib/workflow';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { transitionsOf } from '../../prisma/seed/workflow/builder';
import { BBAS_STANDARD, PROFESSIONAL_CHANGE_STAGES } from '../../prisma/seed/workflow/bbas-standard';
import { requestProfessionalChangeSchema, decideProfessionalChangeSchema } from '@/lib/schemas/professional-change';

/**
 * Phase 8 — change of technical professional. The state machine the service
 * and the screens share, the grants that decide each step's desk, and the
 * workflow rows that record it.
 */

describe('change of LTP lifecycle', () => {
  it('runs Request → Verification → Review → Approval │ Rejection', () => {
    expect(PROFESSIONAL_CHANGE_STATUSES).toEqual(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'PENDING_DECISION', 'APPROVED', 'REJECTED']);
    expect(NEXT_STEP.PENDING_VERIFICATION).toBe('VERIFY');
    expect(NEXT_STEP.UNDER_REVIEW).toBe('REVIEW');
    expect(NEXT_STEP.PENDING_DECISION).toBe('DECIDE');
    expect(NEXT_STEP.APPROVED).toBeNull();
    expect(NEXT_STEP.REJECTED).toBeNull();
  });

  it('allows each step only from the state before it', () => {
    expect(PROFESSIONAL_CHANGE_STATUSES.filter(canVerify)).toEqual(['PENDING_VERIFICATION']);
    expect(PROFESSIONAL_CHANGE_STATUSES.filter(canReview)).toEqual(['UNDER_REVIEW']);
    expect(PROFESSIONAL_CHANGE_STATUSES.filter(canDecide)).toEqual(['PENDING_DECISION']);
  });

  it('treats only the undecided states as open', () => {
    expect([...OPEN_PROFESSIONAL_CHANGE_STATUSES]).toEqual(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'PENDING_DECISION']);
  });

  it('labels every status', () => {
    for (const s of PROFESSIONAL_CHANGE_STATUSES) expect(statusMeta('professionalChange', s).label).not.toBe(s);
  });
});

describe('documents', () => {
  it('carries the eight documents of the brief, each labelled', () => {
    expect(PROFESSIONAL_CHANGE_DOCUMENTS).toHaveLength(8);
    for (const k of PROFESSIONAL_CHANGE_DOCUMENTS) expect(PROFESSIONAL_CHANGE_DOCUMENT_LABEL[k]).toBeTruthy();
  });

  it('needs the owner’s letter and the incoming consent to register', () => {
    expect(missingAtRequest([])).toEqual(['OWNER_REQUEST_LETTER', 'NEW_PROFESSIONAL_CONSENT']);
    expect(missingAtRequest(['OWNER_REQUEST_LETTER', 'NEW_PROFESSIONAL_CONSENT'])).toEqual([]);
  });

  it('needs a release from the outgoing LTP — NOC or termination — to verify', () => {
    expect(hasRelease(['OWNER_REQUEST_LETTER'])).toBe(false);
    expect(hasRelease(['CURRENT_PROFESSIONAL_NOC'])).toBe(true);
    expect(hasRelease(['TERMINATION_LETTER'])).toBe(true);
  });
});

describe('licence validity', () => {
  const on = new Date('2026-09-24T10:00:00Z');
  it('reads a missing expiry as in force, and an expired one as not', () => {
    expect(licenceValidOn(null, on)).toBe(true);
    expect(licenceValidOn('2028-03-31T00:00:00Z', on)).toBe(true);
    expect(licenceValidOn('2026-09-24T00:00:00Z', on)).toBe(true);
    expect(licenceValidOn('2026-09-23T00:00:00Z', on)).toBe(false);
  });
});

describe('each step is one desk’s, by grant', () => {
  const holders = (cap: string) =>
    Object.entries(RBAC_MATRIX)
      .filter(([, caps]) => (caps as readonly string[]).includes(cap))
      .map(([role]) => role)
      .sort();

  it('TPA registers, Planning Officer verifies, ZDD reviews, ZJD decides', () => {
    expect(holders(PROFESSIONAL_CHANGE_STEP_CAPABILITY.REQUEST)).toEqual([ROLES.TPA]);
    expect(holders(PROFESSIONAL_CHANGE_STEP_CAPABILITY.VERIFY)).toEqual([ROLES.PLANNING_OFFICER]);
    expect(holders(PROFESSIONAL_CHANGE_STEP_CAPABILITY.REVIEW)).toEqual([ROLES.ZDD]);
    expect(holders(PROFESSIONAL_CHANGE_STEP_CAPABILITY.DECIDE)).toEqual([ROLES.ZJD]);
  });

  it('names real capabilities', () => {
    for (const cap of Object.values(PROFESSIONAL_CHANGE_STEP_CAPABILITY)) {
      expect(Object.values(CAPABILITIES)).toContain(cap);
    }
  });

  it('never lets the applicant or the administrator take a step', () => {
    for (const role of [ROLES.LTP, ROLES.SYSTEM_ADMIN, ROLES.VIEWER]) {
      for (const cap of Object.values(PROFESSIONAL_CHANGE_STEP_CAPABILITY)) {
        expect((RBAC_MATRIX[role] as readonly string[]).includes(cap), `${role} ${cap}`).toBe(false);
      }
    }
  });

  it('lets the applicant see requests on the files it holds', () => {
    expect(RBAC_MATRIX[ROLES.LTP]).toContain(CAPABILITIES.LTP_CHANGE_VIEW);
  });
});

describe('the BBAS_STANDARD branch, as configuration', () => {
  const rows = transitionsOf(BBAS_STANDARD);
  const steps = [
    ACTIONS.REQUEST_PROFESSIONAL_CHANGE,
    ACTIONS.VERIFY_PROFESSIONAL_CHANGE,
    ACTIONS.REVIEW_PROFESSIONAL_CHANGE,
    ACTIONS.APPROVE_PROFESSIONAL_CHANGE,
    ACTIONS.REJECT_PROFESSIONAL_CHANGE,
  ];
  const branch = rows.filter((r) => (steps as string[]).includes(r.action));

  it('has every step at every stage a live or approved file sits at', () => {
    for (const stage of PROFESSIONAL_CHANGE_STAGES) {
      for (const action of steps) {
        expect(branch.some((r) => r.from === stage && r.action === action), `${stage}:${action}`).toBe(true);
      }
    }
    expect(branch).toHaveLength(PROFESSIONAL_CHANGE_STAGES.length * steps.length);
  });

  it('is not offered on a rejected or revoked file', () => {
    expect(branch.some((r) => r.from === 'CLOSED_REJECTED' || r.from === 'CLOSED_REVOKED')).toBe(false);
  });

  it('never moves the file and keeps its status', () => {
    for (const r of branch) {
      expect(r.to, `${r.from}:${r.action}`).toBe(r.from);
      expect(r.effects?.some((e) => e.type === 'KEEP_STATUS')).toBe(true);
      expect(r.effects?.some((e) => e.type === EFFECTS.PROFESSIONAL_CHANGE)).toBe(true);
    }
  });

  it('orders the steps by guards, and every step carries remarks', () => {
    const guards = (action: string) => branch.find((r) => r.action === action)?.guards ?? [];
    expect(guards(ACTIONS.REQUEST_PROFESSIONAL_CHANGE)).toContain(GUARDS.NO_OPEN_PROFESSIONAL_CHANGE);
    expect(guards(ACTIONS.VERIFY_PROFESSIONAL_CHANGE)).toContain(GUARDS.PROFESSIONAL_CHANGE_PENDING_VERIFICATION);
    expect(guards(ACTIONS.REVIEW_PROFESSIONAL_CHANGE)).toContain(GUARDS.PROFESSIONAL_CHANGE_UNDER_REVIEW);
    expect(guards(ACTIONS.APPROVE_PROFESSIONAL_CHANGE)).toContain(GUARDS.PROFESSIONAL_CHANGE_PENDING_DECISION);
    expect(guards(ACTIONS.REJECT_PROFESSIONAL_CHANGE)).toContain(GUARDS.PROFESSIONAL_CHANGE_PENDING_DECISION);
    for (const r of branch) expect(r.guards).toContain(GUARDS.HAS_REMARKS);
  });

  it('decides with the right outcome', () => {
    const outcome = (action: string) => branch.find((r) => r.action === action)?.effects?.find((e) => e.type === EFFECTS.PROFESSIONAL_CHANGE)?.outcome;
    expect(outcome(ACTIONS.APPROVE_PROFESSIONAL_CHANGE)).toBe('APPROVED');
    expect(outcome(ACTIONS.REJECT_PROFESSIONAL_CHANGE)).toBe('REJECTED');
  });

  it('names no desk role on the rows — the service checks the step’s grant', () => {
    for (const r of branch) expect(r.allowedRoleKeys ?? []).toEqual([]);
  });

  it('leaves the normal chain as it was', () => {
    for (const r of rows.filter((x) => ['FORWARD', 'APPROVE', 'REJECT'].includes(x.action))) {
      expect((r.guards ?? []).filter((g) => g.includes('professional_change'))).toEqual([]);
    }
  });
});

describe('input shapes', () => {
  it('requires a proposed LTP, a date and a reason', () => {
    expect(requestProfessionalChangeSchema.safeParse({ proposedProfessionalId: '', requestDate: '', reason: '' }).success).toBe(false);
    const ok = requestProfessionalChangeSchema.safeParse({
      proposedProfessionalId: '6f1c2f0a-6a8f-4b7e-9d8e-2f6c1a0b3c4d',
      requestDate: '2026-09-20',
      reason: 'The owner has engaged a new architect for construction.',
      demoDocuments: 'true',
      demoKinds: 'OWNER_REQUEST_LETTER,NEW_PROFESSIONAL_CONSENT',
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.demoDocuments).toBe(true);
  });

  it('accepts only approve or reject as a decision', () => {
    expect(decideProfessionalChangeSchema.safeParse({ decision: 'REVOKED', remarks: 'No reason.' }).success).toBe(false);
    expect(decideProfessionalChangeSchema.safeParse({ decision: 'APPROVED', remarks: 'In order.' }).success).toBe(true);
  });
});
