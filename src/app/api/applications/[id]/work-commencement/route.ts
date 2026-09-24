import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { notifyCommencementSchema } from '@/lib/schemas/commencement';
import { getApplicationCommencement, notifyWorkCommencement } from '@/server/services/work-commencements';
import { readCommencementUploads } from '@/server/commencement/uploads';

export const dynamic = 'force-dynamic';

/** The file's post-approval position — the Work Initiated tab and detail page. */
export const GET = defineRoute(async ({ user, params }) => getApplicationCommencement(user, params.id), {
  capabilities: [CAPABILITIES.COMMENCEMENT_VIEW],
});

/**
 * Notify work commencement, as MULTIPART (the supporting documents travel
 * with it). Performed as the NOTIFY_WORK_COMMENCEMENT workflow step.
 */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readCommencementUploads(req);
    const parsed = notifyCommencementSchema.safeParse({
      commencementDate: field('commencementDate') ?? '',
      contractorName: field('contractorName') ?? '',
      contractorLicenceNo: field('contractorLicenceNo') ?? '',
      contractorPhone: field('contractorPhone') ?? '',
      contractorAddress: field('contractorAddress') ?? '',
      remarks: field('remarks') ?? '',
      demoDocuments: field('demoDocuments'),
      demoKinds: field('demoKinds') ?? '',
      expectedSequence: field('expectedSequence') || undefined,
    });
    if (!parsed.success) {
      throw badRequest(
        'The notice is not complete.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      );
    }
    return notifyWorkCommencement(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.COMMENCEMENT_NOTIFY], rateLimit: 'upload' }
);
