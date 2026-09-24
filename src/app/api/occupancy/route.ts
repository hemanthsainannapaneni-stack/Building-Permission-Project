import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listOccupancy, occupancySummary } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** The occupancy register. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      state: searchParams.get('state') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listOccupancy(user, query), occupancySummary(user)]);
      return { ...result, summary };
    }
    return listOccupancy(user, query);
  },
  { capabilities: [CAPABILITIES.OCCUPANCY_VIEW] }
);
