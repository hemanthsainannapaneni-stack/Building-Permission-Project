import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getNoc } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/** One NOC: its particulars, the certificate, its history and the moves open to the caller. */
export const GET = defineRoute(async ({ user, params }) => getNoc(user, params.id!), {
  capabilities: [CAPABILITIES.NOC_VIEW],
});
