import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getOutward } from '@/server/services/outward';

export const dynamic = 'force-dynamic';

export const GET = defineRoute(async ({ user, params }) => getOutward(user, params.id), {
  capabilities: [CAPABILITIES.OUTWARD_VIEW],
});
