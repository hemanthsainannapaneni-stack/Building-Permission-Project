import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerRenewSchema } from '@/lib/schemas/developer-registration';
import { renewDeveloperRegistration } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Opens a renewal of an approved (due) or expired registration. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => renewDeveloperRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_REGISTER], schema: developerRenewSchema }
);
