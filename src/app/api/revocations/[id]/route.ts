import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getRevocation } from '@/server/services/revocations';

export const dynamic = 'force-dynamic';

export const GET = defineRoute(async ({ user, params }) => getRevocation(user, params.id), {
  capabilities: [CAPABILITIES.REVOCATION_VIEW],
});
