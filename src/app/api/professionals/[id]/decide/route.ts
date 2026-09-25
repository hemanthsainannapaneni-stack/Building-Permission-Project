import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalDecideSchema } from '@/lib/schemas/professional-registration';
import { decideProfessionalRegistration } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Approves or rejects: VERIFIED → APPROVED | REJECTED. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => decideProfessionalRegistration(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_DECIDE], schema: professionalDecideSchema }
);
