import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { developerDraftSchema } from '@/lib/schemas/developer-registration';
import { getDeveloperRegistration, updateDeveloperDraft } from '@/server/services/developer-registrations';
import { readDeveloperUploads } from '@/server/developers/uploads';

export const dynamic = 'force-dynamic';

/** One registration: particulars, documents, validity, history and the steps open to the caller. */
export const GET = defineRoute(async ({ user, params }) => getDeveloperRegistration(user, params.id), {
  capabilities: [CAPABILITIES.DEVELOPER_VIEW],
});

/** Saves a DRAFT's particulars and adds documents, as MULTIPART. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readDeveloperUploads(req);
    const parsed = developerDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return updateDeveloperDraft(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.DEVELOPER_REGISTER], rateLimit: 'upload' }
);
