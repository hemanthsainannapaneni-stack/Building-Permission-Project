import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { submitOccupancySchema } from '@/lib/schemas/occupancy';
import { getApplicationOccupancy, submitOccupancyApplication } from '@/server/services/occupancy';
import { readOccupancyUploads } from '@/server/occupancy/uploads';

export const dynamic = 'force-dynamic';

/** The file's occupancy position — the Occupancy tab and detail page. */
export const GET = defineRoute(async ({ user, params }) => getApplicationOccupancy(user, params.id), {
  capabilities: [CAPABILITIES.OCCUPANCY_VIEW],
});

/** Completion intimation + occupancy submission, as MULTIPART. The SUBMIT_OCCUPANCY workflow step. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readOccupancyUploads(req);
    const parsed = submitOccupancySchema.safeParse({
      completionDate: field('completionDate') ?? '',
      remarks: field('remarks') ?? '',
      demoDocuments: field('demoDocuments'),
      demoKinds: field('demoKinds') ?? '',
    });
    if (!parsed.success) {
      throw badRequest('The completion intimation is not complete.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return submitOccupancyApplication(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.OCCUPANCY_SUBMIT], rateLimit: 'upload' }
);
