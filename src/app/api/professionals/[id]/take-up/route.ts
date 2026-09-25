import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalRemarksSchema } from '@/lib/schemas/professional-registration';
import { takeUpProfessionalRegistration } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Takes a pending application up for scrutiny: SUBMITTED → IN_PROCESS. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => takeUpProfessionalRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.LTP_REG_VERIFY], schema: professionalRemarksSchema }
);
