import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { recommendOccupancySchema } from '@/lib/schemas/occupancy';
import { recommendOccupancyApplication } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** As-built review: recommend approval or rejection — RECOMMEND_OCCUPANCY. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => recommendOccupancyApplication(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OCCUPANCY_REVIEW], schema: recommendOccupancySchema }
);
