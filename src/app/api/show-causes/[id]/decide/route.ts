import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { decideShowCauseSchema, type DecideShowCauseInput } from '@/lib/schemas/proceedings';
import { decideShowCauseNotice } from '@/server/services/show-cause';

export const dynamic = 'force-dynamic';

/**
 * The desk's decision — performed as the DECIDE_SHOW_CAUSE workflow
 * transition (and, for Revoke proceeding, INITIATE_REVOCATION with it).
 */
export const POST = defineRoute<DecideShowCauseInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    decideShowCauseNotice(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SHOW_CAUSE_DECIDE], schema: decideShowCauseSchema }
);
