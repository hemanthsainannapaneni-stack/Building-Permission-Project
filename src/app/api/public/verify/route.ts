import { defineRoute } from '@/server/http/route';
import { findPublicRecord } from '@/server/services/public-verification';

export const dynamic = 'force-dynamic';

/**
 * Public verification. No session, no role, no scope.
 *
 * ── Rate limited by IP, and that is the only control there is ───────────
 *
 * An unauthenticated lookup that accepts an identifier is an oracle: given
 * enough attempts it tells you which application numbers exist. Three things
 * blunt that, and all three are needed —
 *
 *   · `publicVerify` (30/minute/IP) makes enumeration slow.
 *   · The lookup is EXACT, never a prefix, so a guess has to be complete.
 *   · A miss and a hit return the same shape, so timing and status code say
 *     nothing that the body does not already say.
 *
 * What it returns is fixed by `findPublicRecord`, which is a whitelist rather
 * than a filter. That distinction is the actual protection here.
 */
export const GET = defineRoute(
  async ({ searchParams }) => {
    const reference = searchParams.get('ref')?.trim() ?? '';

    if (!reference) {
      return { found: false, record: null, reason: 'Enter an application or proceeding number.' };
    }

    const record = await findPublicRecord(reference);

    // A miss is a 200 with `found: false`, not a 404. The distinction between
    // "no such reference" and "a reference you may not see" is one this
    // endpoint should never be able to draw, and a 404 draws it.
    return {
      found: record != null,
      record,
      reason: record ? null : 'No record matches that reference.',
    };
  },
  { auth: false, rateLimit: 'publicVerify' }
);
