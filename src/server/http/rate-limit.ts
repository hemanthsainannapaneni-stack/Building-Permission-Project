import 'server-only';
import { rateLimited } from './errors';

/**
 * Rate limiting behind an interface, so the in-memory driver used in
 * development can be swapped for a Postgres or Redis one without touching a
 * call site.
 *
 * The in-memory driver is correct for a single process only. A multi-instance
 * deployment must use a shared driver — the limits on sign-in and payment
 * initiation are security controls, and a per-instance counter multiplies the
 * real limit by the instance count.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export interface RateLimiter {
  readonly name: string;
  check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

// ── In-memory driver ─────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };

class MemoryRateLimiter implements RateLimiter {
  readonly name = 'memory';
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Drop expired buckets occasionally so the map cannot grow without bound. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const globalForLimiter = globalThis as unknown as { limiter?: RateLimiter };
export const limiter: RateLimiter = globalForLimiter.limiter ?? new MemoryRateLimiter();
globalForLimiter.limiter = limiter;

// ── Named policies ───────────────────────────────────────────────────────
// The numbers come from docs/05-api.md I.3.

export const RATE_LIMITS = {
  login: { limit: 5, windowSeconds: 15 * 60 },
  forgotPassword: { limit: 3, windowSeconds: 60 * 60 },
  upload: { limit: 20, windowSeconds: 60 * 60 },
  // A site visit produces a dozen photographs at a sitting, and an inspector
  // may visit several sites in a day — the document-upload ceiling would stop
  // them half way round the second plot.
  inspectionPhoto: { limit: 120, windowSeconds: 60 * 60 },
  paymentInitiate: { limit: 10, windowSeconds: 60 * 60 },
  webhook: { limit: 100, windowSeconds: 60 },
  publicVerify: { limit: 30, windowSeconds: 60 },
  // The public portal's registers and dashboard: paged, aggregated reads that
  // return no identifier a caller did not already hold. Looser than
  // `publicVerify`, which guards lookups by reference number.
  publicBrowse: { limit: 120, windowSeconds: 60 },
  // A registration or renewal filed from the public portal writes rows and
  // stores files, with no account behind it to attribute the abuse to.
  publicSubmit: { limit: 10, windowSeconds: 60 * 60 },
  default: { limit: 300, windowSeconds: 60 },
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;

/** Throws 429 when the caller is over the limit. */
export async function enforceRateLimit(policy: RateLimitPolicy, identifier: string): Promise<void> {
  const { limit, windowSeconds } = RATE_LIMITS[policy];
  const result = await limiter.check(`${policy}:${identifier}`, limit, windowSeconds);
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
}
