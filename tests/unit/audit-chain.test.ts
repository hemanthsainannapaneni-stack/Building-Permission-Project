import { describe, it, expect } from 'vitest';
import { computeRowHash } from '@/server/services/audit';

/**
 * The audit hash chain.
 *
 * These are pure-function tests — no database. The chain's job is tamper
 * evidence: altering any recorded field must change the row hash, and a
 * changed row must break every hash after it.
 */

const row = {
  actorId: 'usr_1',
  actorName: 'A. Officer',
  actorRoleKey: 'TPA',
  action: 'SHORTFALL_RAISED',
  entityType: 'Shortfall',
  entityId: 'sf_1',
  applicationId: 'app_1',
  before: null,
  after: { title: 'Structural Stability Certificate required' },
  remarks: 'Required for buildings above 3 floors',
  ip: '10.0.0.1',
  userAgent: 'test',
  correlationId: 'corr_1',
  occurredAt: new Date('2026-08-25T10:00:00.000Z'),
};

describe('computeRowHash', () => {
  it('is deterministic for the same input', () => {
    expect(computeRowHash('', row)).toBe(computeRowHash('', row));
  });

  it('is insensitive to key order — canonicalisation sorts keys', () => {
    const reordered = Object.fromEntries(Object.entries(row).reverse());
    expect(computeRowHash('', reordered)).toBe(computeRowHash('', row));
  });

  it('changes when the previous hash changes, which is what chains the rows', () => {
    expect(computeRowHash('abc', row)).not.toBe(computeRowHash('def', row));
  });

  it.each([
    ['action', { action: 'SHORTFALL_RESOLVED' }],
    ['actorId', { actorId: 'usr_2' }],
    ['entityId', { entityId: 'sf_2' }],
    ['remarks', { remarks: 'something else' }],
    ['after', { after: { title: 'different' } }],
    ['occurredAt', { occurredAt: new Date('2026-08-25T10:00:01.000Z') }],
  ])('changes when %s is altered', (_field, patch) => {
    expect(computeRowHash('', { ...row, ...patch })).not.toBe(computeRowHash('', row));
  });

  it('distinguishes null from absent, so a cleared field is still evidence', () => {
    const { before: _before, ...withoutBefore } = row;
    expect(computeRowHash('', withoutBefore)).not.toBe(computeRowHash('', row));
  });

  it('produces a 64-character hex digest', () => {
    expect(computeRowHash('', row)).toMatch(/^[0-9a-f]{64}$/);
  });
});
