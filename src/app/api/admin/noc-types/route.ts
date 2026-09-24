import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listNocTypes } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/** The NOC catalogue, active and inactive, with how many NOCs each carries. */
export const GET = defineRoute(async ({ user }) => listNocTypes(user), {
  capabilities: [CAPABILITIES.MASTER_DATA_MANAGE],
});
