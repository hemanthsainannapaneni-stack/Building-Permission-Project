import { describe, it, expect } from 'vitest';
import {
  COMMENCEMENT_STATES,
  commencementBlocker,
  commencementDateProblem,
  commencementState,
  missingCommencementDocuments,
} from '@/lib/commencement';
import { statusMeta } from '@/lib/status';
import { ACTIONS, EFFECTS, GUARDS } from '@/lib/workflow';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { transitionsOf } from '../../prisma/seed/workflow/builder';
import { BBAS_STANDARD } from '../../prisma/seed/workflow/bbas-standard';
import { notifyCommencementSchema } from '@/lib/schemas/commencement';

/**
 * Phase 9 — commencement of work. Chiefly: work may not be notified before
 * the approval that permits it, nor before its proceeding is issued.
 */

const NOW = new Date('2026-09-24T10:00:00Z');
const ISSUED = { status: 'ISSUED', revokedAt: null, validUntil: '2029-09-01T00:00:00Z' };

describe('no work initiated before the applicable approval', () => {
  it.each(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'TPA_DOCUMENT_SHORTFALL', 'RETURNED_TO_APPLICANT', 'REJECTED', 'WITHDRAWN'])(
    'refuses a %s file',
    (status) => {
      expect(commencementBlocker({ applicationStatus: status, order: ISSUED, alreadyNotified: false, now: NOW })).toMatch(/approved/);
    }
  );

  it('refuses a file whose permission was revoked', () => {
    expect(commencementBlocker({ applicationStatus: 'PROCEEDING_REVOKED', order: ISSUED, alreadyNotified: false, now: NOW })).toMatch(/revoked/);
  });

  it('refuses an approved file until its order is issued', () => {
    for (const status of ['DRAFT', 'PREVIEW', 'GENERATED', 'APPROVED']) {
      expect(commencementBlocker({ applicationStatus: 'APPROVED', order: { ...ISSUED, status }, alreadyNotified: false, now: NOW })).toMatch(/not been issued/);
    }
    expect(commencementBlocker({ applicationStatus: 'APPROVED', order: null, alreadyNotified: false, now: NOW })).toMatch(/drawn up/);
  });

  it('refuses a revoked or lapsed order, and a second notice', () => {
    expect(commencementBlocker({ applicationStatus: 'APPROVED', order: { ...ISSUED, revokedAt: NOW }, alreadyNotified: false, now: NOW })).toMatch(/revoked/);
    expect(
      commencementBlocker({ applicationStatus: 'APPROVED', order: { ...ISSUED, validUntil: '2026-09-01' }, alreadyNotified: false, now: NOW })
    ).toMatch(/lapsed/);
    expect(commencementBlocker({ applicationStatus: 'APPROVED', order: ISSUED, alreadyNotified: true, now: NOW })).toMatch(/already/);
  });

  it('allows an approved file with an issued order', () => {
    expect(commencementBlocker({ applicationStatus: 'APPROVED', order: ISSUED, alreadyNotified: false, now: NOW })).toBeNull();
  });
});

describe('commencement date', () => {
  const order = { issuedAt: '2026-08-10T12:00:00Z', validUntil: '2029-08-10T00:00:00Z' };
  it('may not precede the order, nor follow its lapse', () => {
    expect(commencementDateProblem('2026-08-09', order)).toMatch(/before/);
    expect(commencementDateProblem('2029-08-11', order)).toMatch(/lapses/);
  });
  it('may be the issue day, or any day within validity', () => {
    expect(commencementDateProblem('2026-08-10', order)).toBeNull();
    expect(commencementDateProblem('2027-01-15', order)).toBeNull();
  });
});

describe('register state is derived, never stored', () => {
  it('reads the four states', () => {
    expect(commencementState({ orderIssued: false, commencementDate: null, now: NOW })).toBe('AWAITING_PROCEEDING');
    expect(commencementState({ orderIssued: true, commencementDate: null, now: NOW })).toBe('PROCEEDING_ISSUED');
    expect(commencementState({ orderIssued: true, commencementDate: '2026-10-05', now: NOW })).toBe('PENDING_COMMENCEMENT');
    expect(commencementState({ orderIssued: true, commencementDate: '2026-09-24', now: NOW })).toBe('WORK_INITIATED');
    expect(commencementState({ orderIssued: true, commencementDate: '2026-09-01', now: NOW })).toBe('WORK_INITIATED');
  });
  it('every state has a badge', () => {
    for (const s of COMMENCEMENT_STATES) expect(statusMeta('commencement', s).label).not.toBe(s);
  });
});

describe('workflow configuration', () => {
  const rows = transitionsOf(BBAS_STANDARD).filter((r) => r.action === ACTIONS.NOTIFY_WORK_COMMENCEMENT);

  it('exists only out of CLOSED_APPROVED, only from APPROVED, and does not move the file', () => {
    expect(rows).toHaveLength(1);
    const [t] = rows;
    expect(t!.from).toBe('CLOSED_APPROVED');
    expect(t!.to).toBe('CLOSED_APPROVED');
    expect(t!.fromStatus).toBe('APPROVED');
    expect(t!.effects?.map((e) => e.type)).toEqual([EFFECTS.KEEP_STATUS, EFFECTS.WORK_COMMENCEMENT]);
  });

  it('requires the issued proceeding and no earlier notice, and notifies', () => {
    expect(rows[0]!.guards).toEqual([GUARDS.PROCEEDING_ISSUED, GUARDS.NO_WORK_COMMENCEMENT]);
    expect(rows[0]!.notify).toBe('WORK_INITIATED');
  });
});

describe('grants', () => {
  const holders = Object.entries(RBAC_MATRIX)
    .filter(([, caps]) => caps.includes(CAPABILITIES.COMMENCEMENT_NOTIFY))
    .map(([role]) => role);

  it('only the technical professional notifies', () => {
    expect(holders).toEqual([ROLES.LTP]);
  });

  it('every desk, the LTP, the administrator and the auditor may read', () => {
    for (const role of [ROLES.LTP, ROLES.TPA, ROLES.PLANNING_OFFICER, ROLES.ZDD, ROLES.ZJD, ROLES.COMMISSIONER, ROLES.SYSTEM_ADMIN, ROLES.VIEWER]) {
      expect(RBAC_MATRIX[role]).toContain(CAPABILITIES.COMMENCEMENT_VIEW);
    }
  });
});

describe('documents and input', () => {
  it('requires the signed notice', () => {
    expect(missingCommencementDocuments([])).toEqual(['COMMENCEMENT_NOTICE']);
    expect(missingCommencementDocuments(['COMMENCEMENT_NOTICE', 'SITE_PHOTOGRAPH'])).toEqual([]);
  });

  it('requires a date and a contractor', () => {
    expect(notifyCommencementSchema.safeParse({ commencementDate: '', contractorName: 'Sri Sai Constructions' }).success).toBe(false);
    expect(notifyCommencementSchema.safeParse({ commencementDate: '2026-10-01', contractorName: '' }).success).toBe(false);
    expect(notifyCommencementSchema.safeParse({ commencementDate: '2026-10-01', contractorName: 'Sri Sai Constructions' }).success).toBe(true);
  });
});
