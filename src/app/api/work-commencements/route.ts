import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listWorkCommencements, workCommencementSummary } from '@/server/services/work-commencements';

export const dynamic = 'force-dynamic';

/** The Work Initiated register. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      state: searchParams.get('state') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listWorkCommencements(user, query), workCommencementSummary(user)]);
      return { ...result, summary };
    }
    return listWorkCommencements(user, query);
  },
  { capabilities: [CAPABILITIES.COMMENCEMENT_VIEW] }
);
