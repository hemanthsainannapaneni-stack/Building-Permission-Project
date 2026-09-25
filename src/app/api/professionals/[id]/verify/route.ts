import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalVerifySchema } from '@/lib/schemas/professional-registration';
import { verifyProfessionalRegistration } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Verifies the registration, recommending approval or rejection: IN_PROCESS → VERIFIED. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => verifyProfessionalRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_VERIFY], schema: professionalVerifySchema }
);
