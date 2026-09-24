import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { updateNocTypeSchema, type UpdateNocTypeInput } from '@/lib/schemas/nocs';
import { updateNocType } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/** Switch a NOC type on or off, or correct its name and usual authority. */
export const PATCH = defineRoute<UpdateNocTypeInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    updateNocType(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE], schema: updateNocTypeSchema }
);
