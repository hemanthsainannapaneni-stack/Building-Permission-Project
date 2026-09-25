import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerTakeUpSchema } from '@/lib/schemas/developer-registration';
import { takeUpDeveloperRegistration } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Takes a submitted application up for scrutiny: SUBMITTED → IN_PROCESS. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => takeUpDeveloperRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_VERIFY], schema: developerTakeUpSchema }
);
