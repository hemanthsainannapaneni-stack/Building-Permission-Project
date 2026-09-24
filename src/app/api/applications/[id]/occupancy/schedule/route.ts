import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { scheduleOccupancySchema } from '@/lib/schemas/occupancy';
import { scheduleOccupancyInspection } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** Book the final inspection — SCHEDULE_FINAL_INSPECTION. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => scheduleOccupancyInspection(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OCCUPANCY_INSPECT], schema: scheduleOccupancySchema }
);
