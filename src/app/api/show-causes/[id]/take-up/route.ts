import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { takeUpShowCauseSchema, type TakeUpShowCauseInput } from '@/lib/schemas/proceedings';
import { takeUpShowCause } from '@/server/services/show-cause';

export const dynamic = 'force-dynamic';

/** Take an answered notice up for review. The workflow decides who may. */
export const POST = defineRoute<TakeUpShowCauseInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    takeUpShowCause(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SHOW_CAUSE_DECIDE], schema: takeUpShowCauseSchema }
);
