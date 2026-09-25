import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerVerifySchema } from '@/lib/schemas/developer-registration';
import { verifyDeveloperRegistration } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Verifies the documents, recommending approval or rejection: IN_PROCESS → VERIFIED. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => verifyDeveloperRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_VERIFY], schema: developerVerifySchema }
);
