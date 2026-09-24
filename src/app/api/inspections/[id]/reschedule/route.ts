import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { rescheduleInspectionSchema, type RescheduleInspectionInput } from '@/lib/schemas/site-inspections';
import { rescheduleInspection } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/** A new date or a different inspector, for a visit that has not been signed. */
export const POST = defineRoute<RescheduleInspectionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    rescheduleInspection(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SITE_INSPECTION_SCHEDULE], schema: rescheduleInspectionSchema }
);
