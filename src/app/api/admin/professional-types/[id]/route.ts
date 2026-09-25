import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { updateProfessionalTypeSchema, type UpdateProfessionalTypeInput } from '@/lib/schemas/professional-registration';
import { updateProfessionalType } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Renames, re-prefixes or switches a professional type on or off. */
export const PATCH = defineRoute<UpdateProfessionalTypeInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) => updateProfessionalType(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE], schema: updateProfessionalTypeSchema }
);
