import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalShortfallSchema } from '@/lib/schemas/professional-registration';
import { raiseProfessionalShortfall } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Raises a shortfall: IN_PROCESS → SHORTFALL. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => raiseProfessionalShortfall(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_VERIFY], schema: professionalShortfallSchema }
);
