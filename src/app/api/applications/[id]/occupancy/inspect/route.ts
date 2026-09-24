import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { inspectOccupancySchema } from '@/lib/schemas/occupancy';
import { recordOccupancyInspection } from '@/server/services/occupancy';
import { readOccupancyUploads } from '@/server/occupancy/uploads';

export const dynamic = 'force-dynamic';

/** Record the final inspection, as MULTIPART (photographs) — RECORD_FINAL_INSPECTION. */
export const POST = defineRoute(
  async ({ user, params, req, ip, userAgent, correlationId }) => {
    const { field, uploads } = await readOccupancyUploads(req);
    const parsed = inspectOccupancySchema.safeParse({
      inspectionDate: field('inspectionDate') ?? '',
      siteCondition: field('siteCondition') ?? '',
      actualConstruction: field('actualConstruction') ?? '',
      approvedConstruction: field('approvedConstruction') ?? '',
      deviations: field('deviations') ?? '',
      remarks: field('remarks') ?? '',
      recommendation: field('recommendation') ?? '',
      asBuilt: field('asBuilt') ?? '',
      demoAsBuilt: field('demoAsBuilt'),
      demoVariant: field('demoVariant') || undefined,
      demoPhotos: field('demoPhotos'),
      expectedStatus: field('expectedStatus') || undefined,
    });
    if (!parsed.success) {
      throw badRequest('The inspection report is not complete.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return recordOccupancyInspection(user, params.id, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.OCCUPANCY_INSPECT], rateLimit: 'upload' }
);
