import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerSubmitSchema } from '@/lib/schemas/developer-registration';
import { submitDeveloperRegistration } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Submits a completed draft: DRAFT → SUBMITTED. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => submitDeveloperRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_REGISTER], schema: developerSubmitSchema }
);
