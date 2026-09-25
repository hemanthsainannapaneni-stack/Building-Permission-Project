import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { professionalRespondSchema } from '@/lib/schemas/professional-registration';
import { respondProfessionalShortfall } from '@/server/services/professional-registrations';
import { readProfessionalUploads } from '@/server/professionals/uploads';

export const dynamic = 'force-dynamic';

/** Records the professional's answer to a shortfall, with any documents, as MULTIPART. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readProfessionalUploads(req);
    const parsed = professionalRespondSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The answer is not complete.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return respondProfessionalShortfall(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_REGISTER], rateLimit: 'upload' }
);
