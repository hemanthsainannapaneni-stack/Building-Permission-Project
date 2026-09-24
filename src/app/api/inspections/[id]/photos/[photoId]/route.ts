import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { removeInspectionPhoto } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/** Removes a photograph from a report that has not yet been signed. */
export const DELETE = defineRoute(
  async ({ user, params, ip, userAgent, correlationId }) =>
    removeInspectionPhoto(user, params.id!, params.photoId!, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SITE_INSPECTION_CONDUCT] }
);
