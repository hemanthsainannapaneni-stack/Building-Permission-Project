import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { respondOccupancySchema } from '@/lib/schemas/occupancy';
import { respondOccupancyShortfall } from '@/server/services/occupancy';
import { readOccupancyUploads } from '@/server/occupancy/uploads';

export const dynamic = 'force-dynamic';

/** Answer an occupancy shortfall, as MULTIPART — RESPOND_OCCUPANCY_SHORTFALL. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readOccupancyUploads(req);
    const parsed = respondOccupancySchema.safeParse({
      remarks: field('remarks') ?? '',
      demoDocuments: field('demoDocuments'),
      demoKinds: field('demoKinds') ?? '',
      expectedStatus: field('expectedStatus') || undefined,
    });
    if (!parsed.success) {
      throw badRequest('The answer is not complete.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return respondOccupancyShortfall(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.OCCUPANCY_SUBMIT], rateLimit: 'upload' }
);
