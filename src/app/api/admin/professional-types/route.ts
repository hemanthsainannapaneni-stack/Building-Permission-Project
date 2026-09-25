import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalTypeSchema, type ProfessionalTypeInput } from '@/lib/schemas/professional-registration';
import { createProfessionalType, listProfessionalTypesForAdmin } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** The professional types, active and inactive, with how many registrations each carries. */
export const GET = defineRoute(async ({ user }) => listProfessionalTypesForAdmin(user), { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE] });

/** Adds a professional type. */
export const POST = defineRoute<ProfessionalTypeInput>(
  async ({ user, body, ip, userAgent, correlationId }) => createProfessionalType(user, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE], schema: professionalTypeSchema }
);
