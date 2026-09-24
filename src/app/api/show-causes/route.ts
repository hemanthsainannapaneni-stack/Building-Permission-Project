import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listShowCauses, showCauseSummary } from '@/server/services/show-cause';

export const dynamic = 'force-dynamic';

/** The show cause register. Every parameter narrows; scope is merged by the service. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      status: searchParams.get('status') ?? undefined,
      applicationId: searchParams.get('applicationId') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listShowCauses(user, query), showCauseSummary(user)]);
      return { ...result, summary };
    }
    return listShowCauses(user, query);
  },
  { capabilities: [CAPABILITIES.SHOW_CAUSE_VIEW] }
);
