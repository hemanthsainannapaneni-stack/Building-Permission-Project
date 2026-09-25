import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { professionalDraftSchema } from '@/lib/schemas/professional-registration';
import { getProfessionalRegistration, updateProfessionalDraft } from '@/server/services/professional-registrations';
import { readProfessionalUploads } from '@/server/professionals/uploads';

export const dynamic = 'force-dynamic';

/** One registration: particulars, documents and their checks, validity, history, and the steps open to the caller. */
export const GET = defineRoute(async ({ user, params }) => getProfessionalRegistration(user, params.id), {
  capabilities: [CAPABILITIES.LTP_REG_VIEW],
});

/** Saves a DRAFT's particulars and adds documents, as MULTIPART. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readProfessionalUploads(req);
    const parsed = professionalDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return updateProfessionalDraft(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.LTP_REG_REGISTER], rateLimit: 'upload' }
);
