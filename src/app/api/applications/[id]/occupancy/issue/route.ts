import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { issueOccupancySchema } from '@/lib/schemas/occupancy';
import { issueOccupancyCertificateFor } from '@/server/services/occupancy';

export const dynamic = 'force-dynamic';

/** Issue the occupancy certificate — ISSUE_OCCUPANCY_CERTIFICATE. */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) => issueOccupancyCertificateFor(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.OCCUPANCY_DECIDE], schema: issueOccupancySchema }
);
