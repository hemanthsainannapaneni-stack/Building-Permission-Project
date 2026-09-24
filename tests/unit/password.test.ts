import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, checkPasswordStrength } from '@/server/auth/password';

/**
 * Password hashing.
 *
 * Argon2id is deliberately slow, so these are the only tests allowed to take
 * real time — hence the raised timeouts.
 */

describe('hashPassword', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
  }, 15_000);

  it('never stores the password in the hash', async () => {
    const password = 'SuperSecret12345';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  }, 15_000);

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
    expect(a).not.toBe(b);
  }, 20_000);
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword('Rightpassword1');
    expect(await verifyPassword('Rightpassword1', hash)).toBe(true);
  }, 15_000);

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('Rightpassword1');
    expect(await verifyPassword('Wrongpassword1', hash)).toBe(false);
  }, 15_000);

  it('is case sensitive', async () => {
    const hash = await hashPassword('CaseSensitive1');
    expect(await verifyPassword('casesensitive1', hash)).toBe(false);
  }, 15_000);

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    // A damaged row must read as "wrong password", not as a 500 that tells an
    // attacker something about the account.
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('checkPasswordStrength', () => {
  it.each([
    ['short1', false, 'too short'],
    ['abcdefghij', false, 'no digit'],
    ['1234567890', false, 'no letter'],
    ['correcthorse1', true, 'long with a letter and a digit'],
    ['Passw0rd12', true, 'meets the minimum'],
  ])('%s → %s (%s)', (password, expected) => {
    expect(checkPasswordStrength(password).ok).toBe(expected);
  });

  it('is length-led rather than composition-led', () => {
    // Composition rules push people toward Password1!. A long passphrase with
    // one digit is stronger and must pass.
    expect(checkPasswordStrength('the quick brown fox jumps 1').ok).toBe(true);
  });

  it('rejects absurdly long input rather than hashing it', () => {
    expect(checkPasswordStrength('a1'.repeat(200)).ok).toBe(false);
  });
});
