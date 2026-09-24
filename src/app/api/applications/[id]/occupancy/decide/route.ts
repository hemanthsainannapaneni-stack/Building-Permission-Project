import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { decideOccupancySchema } from '@/lib/schemas/occupancy';
import { decideOccupancyApplication } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** Approve or reject occupancy — APPROVE_ / REJECT_OCCUPANCY. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => decideOccupancyApplication(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OCCUPANCY_DECIDE], schema: decideOccupancySchema }
);
