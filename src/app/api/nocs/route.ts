import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listNocs, nocRegisterMeta, nocSummary } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/**
 * The NOC register, across applications.
 *
 * Every parameter NARROWS: `listNocs` merges the caller's application scope
 * into the query, so nothing here can widen what they see.
 */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      applicationId: searchParams.get('applicationId') ?? undefined,
      nocTypeId: searchParams.get('nocTypeId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      desk: searchParams.get('desk') ?? undefined,
      authority: searchParams.get('authority') ?? undefined,
      expiringBefore: searchParams.get('expiringBefore') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };

    if (searchParams.get('summary') === 'true') {
      const [result, summary, meta] = await Promise.all([
        listNocs(user, query),
        nocSummary(user),
        nocRegisterMeta(user),
      ]);
      return { ...result, summary, meta };
    }

    return listNocs(user, query);
  },
  { capabilities: [CAPABILITIES.NOC_VIEW] }
);
