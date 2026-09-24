import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { createOutwardSchema, type CreateOutwardInput } from '@/lib/schemas/proceedings';
import { createOutward, listOutward, outwardSummary } from '@/server/services/outward';

export const dynamic = 'force-dynamic';

/** The Outward register. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const query = {
      q: searchParams.get('q')?.trim() || undefined,
      status: searchParams.get('status') ?? undefined,
      documentType: searchParams.get('documentType') ?? undefined,
      applicationId: searchParams.get('applicationId') ?? undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listOutward(user, query), outwardSummary(user)]);
      return { ...result, summary };
    }
    return listOutward(user, query);
  },
  { capabilities: [CAPABILITIES.OUTWARD_VIEW] }
);

/** Enter a document by hand — a BPO, a letter. Notices and orders arrive on their own. */
export const POST = defineRoute<CreateOutwardInput>(
  async ({ user, body, ip, userAgent, correlationId }) => createOutward(user, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OUTWARD_MANAGE], schema: createOutwardSchema }
);
