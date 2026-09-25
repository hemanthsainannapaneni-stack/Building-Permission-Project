import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { addProfessionalChangeDocumentsSchema } from '@/lib/schemas/professional-change';
import { addProfessionalChangeDocuments } from '@/server/services/professional-changes';
import { readDocumentUploads } from '@/server/professional-change/uploads';

export const dynamic = 'force-dynamic';

/** Documents that arrive after the request, as MULTIPART. Recorded; the request does not move. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readDocumentUploads(req);
    const parsed = addProfessionalChangeDocumentsSchema.safeParse({
      demoDocuments: field('demoDocuments'),
      demoKinds: field('demoKinds') ?? '',
      expectedStatus: field('expectedStatus') || undefined,
    });
    if (!parsed.success) {
      throw badRequest('The documents could not be read.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return addProfessionalChangeDocuments(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.LTP_CHANGE_REQUEST, CAPABILITIES.LTP_CHANGE_VERIFY], rateLimit: 'upload' }
);
