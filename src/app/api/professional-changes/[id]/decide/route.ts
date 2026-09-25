import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { decideProfessionalChangeSchema, type DecideProfessionalChangeInput } from '@/lib/schemas/professional-change';
import { decideProfessionalChange } from '@/server/services/professional-changes';

export const dynamic = 'force-dynamic';

/** APPROVE_PROFESSIONAL_CHANGE or REJECT_PROFESSIONAL_CHANGE — both workflow steps. */
export const POST = defineRoute<DecideProfessionalChangeInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    decideProfessionalChange(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.LTP_CHANGE_DECIDE], schema: decideProfessionalChangeSchema }
);
