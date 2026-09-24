import { describe, it, expect } from 'vitest';
import {
  amountsAgree,
  canTransition,
  isOpenPayment,
  isRetryable,
  isTerminalPayment,
  OPEN_PAYMENT_STATUSES,
  PAYMENT_STATE_NAMES,
  PAYMENT_STATUSES,
  toPaise,
  whyCannotPay,
} from '@/lib/payments';

/**
 * The two drivers below reach `server/config/env`, which parses the whole
 * environment at import time and refuses an incomplete one. A unit test has no
 * database and needs none — every function it calls here is pure — so the two
 * required keys are filled in with placeholders and the drivers are imported
 * afterwards, dynamically, so the assignment happens first.
 *
 * `??=`, so a real value from a full test run is never overwritten.
 */
process.env.DATABASE_URL ??= 'postgresql://unit-tests/never-connected';
process.env.AUTH_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const { requestHash, responseHash } = await import('@/server/payments/payu');
const { ccavDecrypt, ccavEncrypt } = await import('@/server/payments/ccavenue');

/**
 * The pure parts of the payment machinery.
 *
 * Everything here is a function of its arguments, so it is tested without a
 * database, a gateway or a clock. That is deliberate: these are the pieces
 * that decide whether money moves, and they should be checkable in
 * milliseconds by anybody reading the file.
 */

// ═══════════════════════════════════════════════════════════════════════════
// The state machine
// ═══════════════════════════════════════════════════════════════════════════

describe('the payment state machine', () => {
  it('names every §4 state', () => {
    // The six the specification lists, mapped onto the eight the database
    // holds. INITIATED and REFUNDED are ours, either side of the six.
    const named = new Set(Object.values(PAYMENT_STATE_NAMES));

    for (const state of [
      'PAYMENT_PENDING',
      'PAYMENT_PROCESSING',
      'PAYMENT_SUCCESS',
      'PAYMENT_FAILED',
      'PAYMENT_CANCELLED',
      'PAYMENT_TIMEOUT',
    ]) {
      expect(named).toContain(state);
    }

    // Every database state has a name; a new one cannot be added silently.
    for (const status of PAYMENT_STATUSES) {
      expect(PAYMENT_STATE_NAMES[status]).toBeTruthy();
    }
  });

  it('lets an open payment reach any terminal state', () => {
    for (const from of OPEN_PAYMENT_STATUSES) {
      expect(canTransition(from, 'SUCCESS')).toBe(true);
      expect(canTransition(from, 'FAILED')).toBe(true);
      expect(canTransition(from, 'CANCELLED')).toBe(true);
      expect(canTransition(from, 'TIMEOUT')).toBe(true);
    }
  });

  it('never lets a settled payment be talked into another outcome', () => {
    // The property §5 rests on: a late callback cannot revive a decided
    // attempt, whichever way it was decided.
    for (const from of ['FAILED', 'CANCELLED', 'TIMEOUT'] as const) {
      for (const to of PAYMENT_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }

    // A success may only ever become a refund.
    expect(canTransition('SUCCESS', 'FAILED')).toBe(false);
    expect(canTransition('SUCCESS', 'SUCCESS')).toBe(false);
    expect(canTransition('SUCCESS', 'REFUNDED')).toBe(true);
  });

  it('never goes backwards into an open state', () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of OPEN_PAYMENT_STATUSES) {
        if (from === 'INITIATED' && (to === 'PENDING' || to === 'PROCESSING')) continue;
        if (from === 'PENDING' && to === 'PROCESSING') continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('sorts every state into exactly one of open and terminal', () => {
    for (const status of PAYMENT_STATUSES) {
      expect(isOpenPayment(status)).toBe(!isTerminalPayment(status));
    }
  });

  it('offers a retry only for an attempt that ended without money moving', () => {
    expect(isRetryable('FAILED')).toBe(true);
    expect(isRetryable('CANCELLED')).toBe(true);
    expect(isRetryable('TIMEOUT')).toBe(true);
    expect(isRetryable('SUCCESS')).toBe(false);
    expect(isRetryable('PENDING')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Money
// ═══════════════════════════════════════════════════════════════════════════

describe('comparing two amounts', () => {
  it('compares in paisa, so float noise is not a mismatch', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754. A settlement that refused
    // on that would refuse a great many honest payments.
    expect(amountsAgree(0.1 + 0.2, 0.3)).toBe(true);
    expect(amountsAgree(33495, 33495.000000001)).toBe(true);
    expect(amountsAgree(1234.56, 1234.56)).toBe(true);
  });

  it('treats one paisa as a mismatch', () => {
    expect(amountsAgree(33495.0, 33495.01)).toBe(false);
    expect(amountsAgree(33495.0, 33494.99)).toBe(false);
    expect(amountsAgree(100, 1000)).toBe(false);
  });

  it('converts a two-decimal amount exactly', () => {
    // The only amounts this ever sees. Both sides of a settlement comparison
    // arrive as `Decimal.toFixed(2)` — the demand's from the database, the
    // gateway's from its own two-decimal string — so a third decimal place is
    // not a case that occurs, and `Math.round(x * 100)` is exact across the
    // whole range of a building-permission fee.
    expect(toPaise(0)).toBe(0);
    expect(toPaise(0.01)).toBe(1);
    expect(toPaise(1.99)).toBe(199);
    expect(toPaise(33495.0)).toBe(3_349_500);
    expect(toPaise(9_999_999.99)).toBe(999_999_999);
  });

  it('is not fooled by the float representation of a two-decimal amount', () => {
    // 1234.56 is not exactly representable; 1234.56 * 100 is
    // 123455.99999999999. Truncating would make it 123455 and turn an exact
    // payment into a one-paisa mismatch that refuses a correct settlement.
    expect(toPaise(1234.56)).toBe(123_456);
    expect(toPaise(8.29)).toBe(829);
    expect(toPaise(1.13)).toBe(113);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The gate
// ═══════════════════════════════════════════════════════════════════════════

describe('whether a demand may be paid', () => {
  const payable = { applicationStatus: 'FEE_GENERATED', demandStatus: 'ISSUED', balance: 33495 };

  it('permits an issued demand on an application at the payment stage', () => {
    expect(whyCannotPay(payable)).toBeNull();
    expect(whyCannotPay({ ...payable, applicationStatus: 'PAYMENT_PENDING' })).toBeNull();
    // A retry after a failure is an ordinary thing to do.
    expect(whyCannotPay({ ...payable, applicationStatus: 'PAYMENT_FAILED' })).toBeNull();
  });

  it('refuses a demand that is paid, cancelled or waived, and says which', () => {
    expect(whyCannotPay({ ...payable, demandStatus: 'PAID', balance: 0 })).toMatch(/paid in full/i);
    expect(whyCannotPay({ ...payable, demandStatus: 'CANCELLED' })).toMatch(/cancelled/i);
    expect(whyCannotPay({ ...payable, demandStatus: 'WAIVED' })).toMatch(/waived/i);
    expect(whyCannotPay({ ...payable, demandStatus: 'DRAFT' })).toMatch(/not been issued/i);
  });

  it('refuses a balance of zero even when the demand still says ISSUED', () => {
    expect(whyCannotPay({ ...payable, balance: 0 })).toMatch(/paid in full/i);
  });

  it('refuses an application that is past the payment stage', () => {
    expect(whyCannotPay({ ...payable, applicationStatus: 'PENDING_TPA' })).toMatch(/past the payment stage/i);
    expect(whyCannotPay({ ...payable, applicationStatus: 'DRAFT' })).toMatch(/not been filed/i);
    expect(whyCannotPay({ ...payable, applicationStatus: 'PAYMENT_SUCCESSFUL' })).toMatch(/already been paid/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PayU's hashes
// ═══════════════════════════════════════════════════════════════════════════

describe('the PayU hash sequences', () => {
  const base = {
    key: 'gtKFFx',
    txnid: 'PAY-2026-00000042',
    amount: '33495.00',
    productinfo: 'DM/2026/000007',
    firstname: 'Ravi Kumar',
    email: 'ravi@example.com',
    udf: ['BP/2026/000001', 'DM/2026/000007', '', '', ''] as [string, string, string, string, string],
    salt: 'eCwWELxi',
  };

  it('is a sha512 hex digest', () => {
    expect(requestHash(base)).toMatch(/^[0-9a-f]{128}$/);
  });

  it('changes when any signed field changes — which is what makes it tamper-evident', () => {
    const original = requestHash(base);

    // The one that matters: a payer editing the amount in the form.
    expect(requestHash({ ...base, amount: '1.00' })).not.toBe(original);
    expect(requestHash({ ...base, txnid: 'PAY-2026-00000043' })).not.toBe(original);
    expect(requestHash({ ...base, salt: 'wrong-salt' })).not.toBe(original);
    expect(requestHash({ ...base, udf: ['x', '', '', '', ''] })).not.toBe(original);
  });

  it('is stable for identical input', () => {
    expect(requestHash(base)).toBe(requestHash({ ...base }));
  });

  it('makes the response hash a different digest from the request hash', () => {
    // The reverse sequence is not the request sequence read backwards — the
    // empty block sits elsewhere — so the two must not coincide. A driver that
    // checked a response against the request hash would accept nothing, or
    // worse, be "fixed" by dropping the check.
    const response = responseHash({ ...base, status: 'success' });
    expect(response).toMatch(/^[0-9a-f]{128}$/);
    expect(response).not.toBe(requestHash(base));
  });

  it('changes the response hash when the status does', () => {
    const success = responseHash({ ...base, status: 'success' });
    const failure = responseHash({ ...base, status: 'failure' });
    expect(success).not.toBe(failure);
  });

  it('accounts for additionalCharges, which PayU prepends when present', () => {
    const plain = responseHash({ ...base, status: 'success' });
    const withCharges = responseHash({ ...base, status: 'success', additionalCharges: '10.00' });
    expect(withCharges).not.toBe(plain);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CCAvenue's encryption
// ═══════════════════════════════════════════════════════════════════════════

describe('the CCAvenue envelope', () => {
  const workingKey = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6';
  const plain = 'merchant_id=123&order_id=PAY-2026-00000042&amount=33495.00&currency=INR';

  it('round-trips a payload', () => {
    expect(ccavDecrypt(ccavEncrypt(plain, workingKey), workingKey)).toBe(plain);
  });

  it('produces hex, which is what the gateway form field carries', () => {
    expect(ccavEncrypt(plain, workingKey)).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — the IV is fixed by the integration kit, not chosen', () => {
    // Poor cryptography, and not our choice: the gateway requires it. Pinned
    // here so that "improving" it to a random IV, which would silently stop
    // the gateway from being able to read our requests, fails a test instead.
    expect(ccavEncrypt(plain, workingKey)).toBe(ccavEncrypt(plain, workingKey));
  });

  it('cannot be decrypted with the wrong working key', () => {
    const encrypted = ccavEncrypt(plain, workingKey);
    // Decryption IS the authentication for this gateway — there is no
    // signature to compare — so a wrong key must fail rather than return
    // rubbish that a parser might accept.
    expect(() => ccavDecrypt(encrypted, 'D6C5B4A3F2E1D0C9B8A7F6E5D4C3B2A1')).toThrow();
  });
});
