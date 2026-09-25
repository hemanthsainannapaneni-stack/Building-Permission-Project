import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listProfessionalChanges, professionalChangeSummary } from '@/server/services/professional-changes';

export const dynamic = 'force-dynamic';

/** The change of technical professional register. */
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
      const [result, summary] = await Promise.all([listProfessionalChanges(user, query), professionalChangeSummary(user)]);
      return { ...result, summary };
    }
    return listProfessionalChanges(user, query);
  },
  { capabilities: [CAPABILITIES.LTP_CHANGE_VIEW] }
);
