import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { developerDecideSchema } from '@/lib/schemas/developer-registration';
import { decideDeveloperRegistration } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/** Approves or rejects: VERIFIED → APPROVED | REJECTED. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => decideDeveloperRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DEVELOPER_DECIDE], schema: developerDecideSchema }
);
