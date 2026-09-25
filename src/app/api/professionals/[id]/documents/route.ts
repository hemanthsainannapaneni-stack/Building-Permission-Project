import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { professionalDocumentCheckSchema } from '@/lib/schemas/professional-registration';
import { checkProfessionalDocument } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Verifies or rejects one document — the latest of its kind — while IN_PROCESS. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => checkProfessionalDocument(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_VERIFY], schema: professionalDocumentCheckSchema }
);
