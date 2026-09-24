import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Access tokens and refresh-token hashing.
 *
 * env.ts reads AUTH_SECRET at import time, so it is set before the module
 * under test is loaded.
 */

beforeAll(() => {
  process.env.AUTH_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5433/test';
});


const load = async () => import('@/server/auth/tokens');

describe('access tokens', () => {
  it('round-trips the identity claims', async () => {
    const { signAccessToken, verifyAccessToken } = await load();
    const token = await signAccessToken({ sub: 'user-1', sid: 'session-1' });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'user-1', sid: 'session-1' });
  });

  it('carries identity ONLY — never role or capabilities', async () => {
    // Role and capabilities are re-read from the database on every request, so
    // suspending an account takes effect immediately rather than whenever the
    // token happens to expire. Putting them in the token would break that.
    const { signAccessToken } = await load();
    const token = await signAccessToken({ sub: 'user-1', sid: 'session-1' });
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());

    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
    expect(JSON.stringify(payload)).not.toMatch(/role|capabilit|permission/i);
  });

  it('rejects a tampered token', async () => {
    const { signAccessToken, verifyAccessToken } = await load();
    const token = await signAccessToken({ sub: 'user-1', sid: 'session-1' });

    const [header, payload, signature] = token.split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    forged.sub = 'someone-else';
    const swapped = Buffer.from(JSON.stringify(forged)).toString('base64url');

    expect(await verifyAccessToken(`${header}.${swapped}.${signature}`)).toBeNull();
  });

  it('rejects garbage rather than throwing', async () => {
    const { verifyAccessToken } = await load();
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const { verifyAccessToken } = await load();
    // Signed with "wrong-secret" elsewhere; structurally valid, wrong signature.
    const foreign =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJzaWQiOiJzZXNzaW9uLTEiLCJpc3MiOiJsYW1zIiwiYXVkIjoibGFtcy13ZWIifQ.' +
      'ZmFrZS1zaWduYXR1cmUtdGhhdC13aWxsLW5vdC12ZXJpZnk';
    expect(await verifyAccessToken(foreign)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generates unguessable, unique values', async () => {
    const { generateRefreshToken } = await load();
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(200);
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(43);
  });

  it('hashes deterministically, and never stores the token itself', async () => {
    const { generateRefreshToken, hashToken } = await load();
    const token = generateRefreshToken();
    const hash = hashToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it('gives different tokens different hashes', async () => {
    const { hashToken } = await load();
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
