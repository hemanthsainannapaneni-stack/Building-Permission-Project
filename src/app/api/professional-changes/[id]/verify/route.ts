import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalChangeStepSchema, type ProfessionalChangeStepInput } from '@/lib/schemas/professional-change';
import { verifyProfessionalChange } from '@/server/services/professional-changes';

export const dynamic = 'force-dynamic';

/** The VERIFY_PROFESSIONAL_CHANGE workflow step. */
export const POST = defineRoute<ProfessionalChangeStepInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) => verifyProfessionalChange(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_CHANGE_VERIFY], schema: professionalChangeStepSchema }
);
