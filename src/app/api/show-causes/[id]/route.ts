import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getShowCause } from '@/server/services/show-cause';

export const dynamic = 'force-dynamic';

export const GET = defineRoute(async ({ user, params }) => getShowCause(user, params.id), {
  capabilities: [CAPABILITIES.SHOW_CAUSE_VIEW],
});
