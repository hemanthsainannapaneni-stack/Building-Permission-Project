import 'server-only';
import { headers } from 'next/headers';
import { enforceRateLimit, type RateLimitPolicy } from '@/server/http/rate-limit';
import { isApiError } from '@/server/http/errors';

/**
 * Rate limiting for the public PAGES that run a lookup on render.
 *
 * The public API routes get this from `defineRoute`. A server-rendered page
 * has no such wrapper, and a lookup by reference number is the same oracle
 * whether it arrives as `/api/public/verify` or as `/public/status?ref=…` —
 * so the page asks the same limiter, keyed by the caller's address.
 *
 * Returns rather than throws: a page that is over its limit renders a
 * sentence in place of the result, and the person's search box stays put.
 */
export async function pageRateLimit(policy: RateLimitPolicy): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0]?.trim() : h.get('x-real-ip')) || 'unknown';
  try {
    await enforceRateLimit(policy, ip);
    return { ok: true };
  } catch (error) {
    if (isApiError(error) && error.status === 429) return { ok: false, retryAfterSeconds: error.retryAfter ?? 60 };
    throw error;
  }
}

/** Reads one query-string value as a trimmed string, whatever shape Next hands it over in. */
export function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export const pageNumber = (value: string | string[] | undefined): number => {
  const n = Number(param(value));
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
};
