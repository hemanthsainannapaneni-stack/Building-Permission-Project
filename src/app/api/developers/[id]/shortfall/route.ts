import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerShortfallSchema } from '@/lib/schemas/developer-registration';
import { raiseDeveloperShortfall } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Raises a shortfall: IN_PROCESS → SHORTFALL. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => raiseDeveloperShortfall(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_VERIFY], schema: developerShortfallSchema }
);
