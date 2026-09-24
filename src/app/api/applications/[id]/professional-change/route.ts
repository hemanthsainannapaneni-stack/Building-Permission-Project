import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { requestProfessionalChangeSchema } from '@/lib/schemas/professional-change';
import { getApplicationProfessional, requestProfessionalChange } from '@/server/services/professional-changes';
import { readDocumentUploads } from '@/server/professional-change/uploads';

export const dynamic = 'force-dynamic';

/** The file's professional history and change requests — the Technical Professional tab. */
export const GET = defineRoute(async ({ user, params }) => getApplicationProfessional(user, params.id), {
  capabilities: [CAPABILITIES.PROFESSIONAL_CHANGE_VIEW],
});

/**
 * Register a change of technical professional, as MULTIPART (the documents
 * travel with it). Performed as the REQUEST_PROFESSIONAL_CHANGE workflow step.
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readDocumentUploads(req);
    const parsed = requestProfessionalChangeSchema.safeParse({
      proposedProfessionalId: field('proposedProfessionalId') ?? '',
      requestDate: field('requestDate') ?? '',
      reason: field('reason') ?? '',
      demoDocuments: field('demoDocuments'),
      demoKinds: field('demoKinds') ?? '',
      expectedSequence: field('expectedSequence') || undefined,
    });
    if (!parsed.success) {
      throw badRequest(
        'The request is not complete.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }
    return requestProfessionalChange(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.PROFESSIONAL_CHANGE_REQUEST], rateLimit: 'upload' }
);
