import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { outwardActionSchema, type OutwardActionInput } from '@/lib/schemas/proceedings';
import { outwardAction } from '@/server/services/outward';

export const dynamic = 'force-dynamic';

/** Mark ready, Dispatch, Record delivery / acknowledgement / return, Cancel. */
export const POST = defineRoute<OutwardActionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    outwardAction(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OUTWARD_MANAGE], schema: outwardActionSchema }
);
