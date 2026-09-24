import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { inspectionSummary, listInspections, registerMeta } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/**
 * The site inspection register, across applications.
 *
 * Every parameter NARROWS: `listInspections` merges the caller's application
 * scope into the query, so nothing here can widen what they see.
 */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      applicationId: searchParams.get('applicationId') ?? undefined,
      inspectorId: searchParams.get('inspectorId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      recommendation: searchParams.get('recommendation') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };

    if (searchParams.get('summary') === 'true') {
      const [result, summary, meta] = await Promise.all([
        listInspections(user, query),
        inspectionSummary(user),
        registerMeta(user),
      ]);
      return { ...result, summary, meta };
    }

    return listInspections(user, query);
  },
  { capabilities: [CAPABILITIES.SITE_INSPECTION_VIEW] }
);
