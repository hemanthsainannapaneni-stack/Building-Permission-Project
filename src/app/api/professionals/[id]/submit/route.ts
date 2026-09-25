import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalRemarksSchema } from '@/lib/schemas/professional-registration';
import { submitProfessionalRegistration } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Submits a completed draft: DRAFT → SUBMITTED (Pending). */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => submitProfessionalRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_REGISTER], schema: professionalRemarksSchema }
);
