import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { decideRevocationSchema, type DecideRevocationInput } from '@/lib/schemas/proceedings';
import { decideRevocationProceeding } from '@/server/services/revocations';

export const dynamic = 'force-dynamic';

/** REVOKE_PROCEEDING or REJECT_REVOCATION — both workflow transitions. */
export const POST = defineRoute<DecideRevocationInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    decideRevocationProceeding(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.ORDER_REVOKE], schema: decideRevocationSchema }
);
