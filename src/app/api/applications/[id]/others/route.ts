import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { updateOthersSchema } from '@/lib/schemas/others';
import {
  getApplicationOthers,
  updateApplicationOthers,
} from '@/server/services/application-others';

export const dynamic = 'force-dynamic';

/**
 * The Others block — mortgage, car insurance, solar, rainwater harvesting,
 * greening and the special remarks.
 *
 * The PATCH is PARTIAL. The tab saves one card at a time, so a body carrying
 * only the solar fields leaves the mortgage particulars exactly as they were.
 * Visibility rides on APPLICATION_VIEW because this is part of the
 * application's own particulars and every reader of the file may see it;
 * writing rides on APPLICATION_EDIT, and the status gate inside the service
 * decides whether it may be written RIGHT NOW.
 */

export const GET = defineRoute(async ({ user, params }) => getApplicationOthers(user, params.id), {
  capabilities: [CAPABILITIES.APPLICATION_VIEW],
});

export const PATCH = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    updateApplicationOthers(user, params.id, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.APPLICATION_EDIT], schema: updateOthersSchema }
);
