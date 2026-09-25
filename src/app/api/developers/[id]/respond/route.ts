import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { developerRespondSchema } from '@/lib/schemas/developer-registration';
import { respondDeveloperShortfall } from '@/server/services/developer-registrations';
import { readDeveloperUploads } from '@/server/developers/uploads';

export const dynamic = 'force-dynamic';

/** Records the developer's answer to a shortfall, with any documents, as MULTIPART. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readDeveloperUploads(req);
    const parsed = developerRespondSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The answer is not complete.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return respondDeveloperShortfall(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.DEVELOPER_REGISTER], rateLimit: 'upload' }
);
