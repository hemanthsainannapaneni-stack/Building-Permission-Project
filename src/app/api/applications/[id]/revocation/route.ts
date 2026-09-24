import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { initiateRevocationSchema, type InitiateRevocationInput } from '@/lib/schemas/proceedings';
import { initiateRevocation } from '@/server/services/revocations';

export const dynamic = 'force-dynamic';

/** Propose revoking the permission — the INITIATE_REVOCATION workflow transition. */
export const POST = defineRoute<InitiateRevocationInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    initiateRevocation(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.REVOCATION_INITIATE], schema: initiateRevocationSchema }
);
