import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { shortfallOccupancySchema } from '@/lib/schemas/occupancy';
import { raiseOccupancyShortfallFor } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** As-built review: raise an occupancy shortfall — RAISE_OCCUPANCY_SHORTFALL. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => raiseOccupancyShortfallFor(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OCCUPANCY_REVIEW], schema: shortfallOccupancySchema }
);
