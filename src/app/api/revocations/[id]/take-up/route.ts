import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { takeUpRevocationSchema, type TakeUpRevocationInput } from '@/lib/schemas/proceedings';
import { takeUpRevocation } from '@/server/services/revocations';

export const dynamic = 'force-dynamic';

/** The TAKE_UP_REVOCATION workflow transition. */
export const POST = defineRoute<TakeUpRevocationInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    takeUpRevocation(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.ORDER_REVOKE], schema: takeUpRevocationSchema }
);
