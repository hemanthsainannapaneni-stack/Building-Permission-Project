import { describe, it, expect } from 'vitest';
import {
  NOC_STATUSES,
  OUTSTANDING_NOC_STATUSES,
  canMove,
  nocMoves,
  nocTally,
  verificationProblems,
} from '@/lib/noc';
import { statusMeta } from '@/lib/status';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { NOC_TYPES } from '../../prisma/seed/13-noc-types';

const DAY = 86_400_000;
const now = new Date('2026-09-24T10:00:00Z');

const complete = {
  referenceNumber: 'FS/NOC/2026/00001',
  issuedDate: new Date(now.getTime() - 10 * DAY),
  expiryDate: new Date(now.getTime() + 365 * DAY),
  hasDocument: true,
  requiresExpiry: true,
};

describe('NOC lifecycle rules', () => {
  it('offers the desk the four review actions on a received NOC', () => {
    expect(nocMoves('RECEIVED', 'officer').sort()).toEqual(['MARK_NOT_REQUIRED', 'REJECT', 'SHORTFALL', 'VERIFY']);
  });

  it('only verifies a RECEIVED NOC', () => {
    for (const s of NOC_STATUSES) expect(canMove('VERIFY', s)).toBe(s === 'RECEIVED');
  });

  it('never undoes a verification in place', () => {
    expect(nocMoves('VERIFIED', 'officer')).toEqual([]);
    expect(nocMoves('VERIFIED', 'applicant')).toEqual([]);
  });

  it('lets the applicant come back after a shortfall, rejection or expiry', () => {
    for (const s of ['SHORTFALL', 'REJECTED', 'EXPIRED']) {
      expect(nocMoves(s, 'applicant')).toEqual(['RECORD_APPLICATION', 'RECORD_RECEIPT']);
    }
  });

  it('gives the applicant no move on a ruled-out NOC, and the desk only Mark Required', () => {
    expect(nocMoves('NOT_REQUIRED', 'applicant')).toEqual([]);
    expect(nocMoves('NOT_REQUIRED', 'officer')).toEqual(['MARK_REQUIRED']);
  });

  it('refuses an unknown status outright', () => {
    expect(canMove('VERIFY', 'APPROVED')).toBe(false);
  });
});

describe('verification readiness', () => {
  it('passes a complete, valid certificate', () => {
    expect(verificationProblems(complete, now)).toEqual([]);
  });

  it('names every missing particular', () => {
    const problems = verificationProblems(
      { referenceNumber: ' ', issuedDate: null, expiryDate: null, hasDocument: false, requiresExpiry: true },
      now
    );
    expect(problems).toHaveLength(4);
  });

  it('refuses a lapsed certificate and an expiry before issue', () => {
    expect(verificationProblems({ ...complete, expiryDate: new Date(now.getTime() - DAY) }, now).join(' ')).toMatch(/expired/);
    expect(
      verificationProblems({ ...complete, expiryDate: new Date(complete.issuedDate.getTime() - DAY) }, now).join(' ')
    ).toMatch(/not after the date of issue/);
  });

  it('does not require an expiry for a type that carries none', () => {
    expect(verificationProblems({ ...complete, expiryDate: null, requiresExpiry: false }, now)).toEqual([]);
  });
});

describe('the NOC summary', () => {
  it('counts Required, Received, Verified and Pending the way the tab shows them', () => {
    const t = nocTally(['NOT_REQUIRED', 'PENDING', 'APPLIED', 'RECEIVED', 'VERIFIED', 'SHORTFALL'].map((status) => ({ status })));
    expect(t).toMatchObject({ total: 6, required: 5, notRequired: 1, undetermined: 1, received: 1, verified: 1, pending: 4 });
  });

  it('treats only VERIFIED and NOT_REQUIRED as settled', () => {
    expect(NOC_STATUSES.filter((s) => !OUTSTANDING_NOC_STATUSES.includes(s)).sort()).toEqual(['NOT_REQUIRED', 'VERIFIED']);
  });

  it('gives every status a label and tone', () => {
    for (const s of NOC_STATUSES) expect(statusMeta('noc', s).label).not.toBe(s);
  });
});

describe('NOC configuration and grants', () => {
  it('seeds Fire active and every future type inactive', () => {
    expect(NOC_TYPES.filter((t) => t.isActive).map((t) => t.code)).toEqual(['FIRE']);
    expect(NOC_TYPES.map((t) => t.code).sort()).toEqual(
      ['AIRPORT', 'ENVIRONMENT', 'FIRE', 'HERITAGE', 'OTHER', 'RAILWAY', 'WATER_RESOURCES'].sort()
    );
  });

  it('lets TPA, ZDD and ZJD verify, and never the applicant or the administrator', () => {
    const verifies = (r: keyof typeof RBAC_MATRIX) => RBAC_MATRIX[r].includes(CAPABILITIES.NOC_VERIFY);
    expect(verifies(ROLES.TPA)).toBe(true);
    expect(verifies(ROLES.ZDD)).toBe(true);
    expect(verifies(ROLES.ZJD)).toBe(true);
    expect(verifies(ROLES.LTP)).toBe(false);
    expect(verifies(ROLES.SYSTEM_ADMIN)).toBe(false);
    expect(verifies(ROLES.VIEWER)).toBe(false);
    expect(RBAC_MATRIX[ROLES.LTP]).toContain(CAPABILITIES.NOC_UPDATE);
  });
});
