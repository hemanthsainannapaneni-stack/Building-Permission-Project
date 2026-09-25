import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalRenewSchema } from '@/lib/schemas/professional-registration';
import { renewProfessionalRegistration } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Opens a renewal of an approved (due) or expired registration. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => renewProfessionalRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_REGISTER], schema: professionalRenewSchema }
);
