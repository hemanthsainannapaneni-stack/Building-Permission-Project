import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getApplicationProceedings } from '@/server/services/show-cause';

export const dynamic = 'force-dynamic';

/** The application's Proceedings tab: show causes, revocations, outward, and what the workflow offers. */
export const GET = defineRoute(async ({ user, params }) => getApplicationProceedings(user, params.id), {
  capabilities: [CAPABILITIES.SHOW_CAUSE_VIEW],
});
