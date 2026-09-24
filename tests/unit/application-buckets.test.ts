import { describe, it, expect } from 'vitest';
import { APPLICATION_STATUSES } from '@/lib/status';
import { BUCKETS, bucketFor, bucketOfStatus, isBucketKey } from '@/lib/application-buckets';
import {
  WIZARD_STEPS,
  REQUIRED_STEP_KEYS,
  STEP_KEYS,
  stepByKey,
  stepIndex,
  isEditableStatus,
} from '@/lib/application-steps';
import { STEP_SCHEMAS, SORTABLE_FIELDS, parseListQuery } from '@/lib/schemas/applications';

/**
 * The isomorphic definitions, checked against the things they must agree with.
 *
 * `src/lib/application-buckets.ts` holds status names as plain STRINGS,
 * because a module imported into the client bundle must not import
 * `@prisma/client`. The safety that gives up is recovered here: this test
 * fails if any of those strings is not a real status. Without it a typo would
 * produce a KPI tile that silently counts zero for ever — the worst kind of
 * dashboard bug, because it looks like an answer.
 *
 * The reference list was the native `ApplicationStatus` enum until the SQLite
 * migration replaced those enums with String columns. It is now
 * `APPLICATION_STATUSES` in src/lib/status.ts, which every status must appear
 * in anyway to have a label.
 */

const ALL_STATUSES = [...APPLICATION_STATUSES];

describe('application buckets', () => {
  it('names only real ApplicationStatus members', () => {
    for (const bucket of BUCKETS) {
      for (const status of bucket.statuses) {
        expect(ALL_STATUSES, `bucket "${bucket.key}" references "${status}"`).toContain(status);
      }
    }
  });

  it('assigns each status to at most one bucket', () => {
    const seen = new Map<string, string>();

    for (const bucket of BUCKETS) {
      if (bucket.key === 'total') continue;
      for (const status of bucket.statuses) {
        expect(
          seen.has(status),
          `"${status}" is in both "${seen.get(status)}" and "${bucket.key}"`
        ).toBe(false);
        seen.set(status, bucket.key);
      }
    }
  });

  it('treats only `total` as the everything bucket', () => {
    const empty = BUCKETS.filter((b) => b.statuses.length === 0);
    expect(empty.map((b) => b.key)).toEqual(['total']);
  });

  it('offers the nine tiles the dashboard shows', () => {
    expect(BUCKETS.map((b) => b.key)).toEqual([
      'total',
      'draft',
      'scrutinyFailed',
      'scrutinyPassed',
      'documentsPending',
      'paymentPending',
      'underReview',
      'shortfall',
      'approved',
    ]);
  });

  it('resolves a status back to its bucket', () => {
    expect(bucketOfStatus('DRAFT')?.key).toBe('draft');
    expect(bucketOfStatus('PENDING_TPA')?.key).toBe('underReview');
    expect(bucketOfStatus('TPA_FEE_SHORTFALL')?.key).toBe('shortfall');
    expect(bucketOfStatus('NOT_A_STATUS')).toBeUndefined();
  });

  it('recognises its own keys and nothing else', () => {
    expect(isBucketKey('draft')).toBe(true);
    expect(isBucketKey('nonsense')).toBe(false);
    expect(bucketFor('nonsense')).toBeUndefined();
  });

  it('covers every terminal status a file can end in, or deliberately omits it', () => {
    // APPROVED is a tile. REJECTED, WITHDRAWN and LAPSED deliberately are not —
    // an LTP's dashboard is about work in hand. This asserts the omission is a
    // decision, so adding a status later forces a look at this list.
    expect(bucketOfStatus('APPROVED')?.key).toBe('approved');
    for (const status of ['REJECTED', 'WITHDRAWN', 'LAPSED']) {
      expect(bucketOfStatus(status)).toBeUndefined();
    }
  });
});

describe('wizard steps', () => {
  it('lists the ten steps in the order the form presents them', () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      'applicant',
      'owner',
      'property',
      'location',
      'survey',
      'development',
      'building',
      'ltp',
      'review',
      'submit',
    ]);
  });

  it('keeps STEP_KEYS and WIZARD_STEPS in step', () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([...STEP_KEYS]);
  });

  it('gives every data-capturing step a schema, and the other two none', () => {
    for (const step of WIZARD_STEPS) {
      const hasSchema = step.key in STEP_SCHEMAS;
      expect(hasSchema, `step "${step.key}"`).toBe(step.capturesData);
    }
  });

  it('requires exactly the data-capturing steps before filing', () => {
    expect(REQUIRED_STEP_KEYS).toEqual([
      'applicant',
      'owner',
      'property',
      'location',
      'survey',
      'development',
      'building',
      'ltp',
    ]);
  });

  it('resolves steps by key and index', () => {
    expect(stepIndex('applicant')).toBe(0);
    expect(stepIndex('submit')).toBe(9);
    expect(stepByKey('survey')?.label).toBe('Survey and plot');
    expect(stepByKey('nonsense')).toBeUndefined();
  });

  it('treats only DRAFT as editable', () => {
    expect(isEditableStatus('DRAFT')).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(isEditableStatus(status), status).toBe(false);
    }
  });
});

describe('list query parsing', () => {
  it('keeps every value of a repeated key', () => {
    // Object.fromEntries would keep only the last, silently dropping filters.
    const params = new URLSearchParams('status=DRAFT&status=SUBMITTED');
    expect(parseListQuery(params).status).toEqual(['DRAFT', 'SUBMITTED']);
  });

  it('accepts a comma-separated list too', () => {
    expect(parseListQuery(new URLSearchParams('status=DRAFT,SUBMITTED')).status).toEqual([
      'DRAFT',
      'SUBMITTED',
    ]);
  });

  it('applies the defaults an empty query implies', () => {
    const query = parseListQuery(new URLSearchParams());
    expect(query).toMatchObject({ sort: 'updatedAt', dir: 'desc', page: 1, pageSize: 20 });
    expect(query.status).toBeUndefined();
  });

  it('refuses a sort column that is not on the allow-list', () => {
    // The allow-list is a security boundary: `sort` reaches Prisma as a column
    // name, so an arbitrary string must never get through.
    expect(() => parseListQuery(new URLSearchParams('sort=passwordHash'))).toThrow();
    expect(() => parseListQuery(new URLSearchParams('sort=ltp.email'))).toThrow();
  });

  it('accepts every column it claims to sort by', () => {
    for (const field of SORTABLE_FIELDS) {
      expect(parseListQuery(new URLSearchParams(`sort=${field}`)).sort).toBe(field);
    }
  });

  it('caps the page size, so one request cannot ask for the whole register', () => {
    expect(() => parseListQuery(new URLSearchParams('pageSize=5000'))).toThrow();
    expect(parseListQuery(new URLSearchParams('pageSize=100')).pageSize).toBe(100);
  });

  it('drops an empty status list rather than matching nothing', () => {
    expect(parseListQuery(new URLSearchParams('status=')).status).toBeUndefined();
  });
});
