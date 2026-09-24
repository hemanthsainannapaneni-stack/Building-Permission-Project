import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listRevocations, revocationSummary } from '@/server/services/revocations';

export const dynamic = 'force-dynamic';

/** The revocation proceeding register. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      status: searchParams.get('status') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listRevocations(user, query), revocationSummary(user)]);
      return { ...result, summary };
    }
    return listRevocations(user, query);
  },
  { capabilities: [CAPABILITIES.REVOCATION_VIEW] }
);
