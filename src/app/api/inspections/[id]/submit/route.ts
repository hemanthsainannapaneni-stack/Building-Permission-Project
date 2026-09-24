import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { submitInspectionSchema, type SubmitInspectionInput } from '@/lib/schemas/site-inspections';
import { submitInspection } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/**
 * Sign & Submit (DEMO signature).
 *
 * One transaction: readiness check, signature metadata, lock, audit, and the
 * workflow transition the recommendation calls for — which closes the
 * inspector's task and opens the next desk's.
 */
export const POST = defineRoute<SubmitInspectionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    submitInspection(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SITE_INSPECTION_CONDUCT], schema: submitInspectionSchema }
);
