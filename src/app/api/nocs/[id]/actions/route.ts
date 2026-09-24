import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { officerActionSchema, type OfficerActionInput } from '@/lib/schemas/nocs';
import { officerAction } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/**
 * The desk's decision: Verify, Reject, Shortfall, Mark Required, Mark Not
 * Required. The service also requires the file to be AT a desk the caller's
 * role owns — the capability alone is not enough.
 */
export const POST = defineRoute<OfficerActionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    officerAction(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.NOC_VERIFY], schema: officerActionSchema }
);
