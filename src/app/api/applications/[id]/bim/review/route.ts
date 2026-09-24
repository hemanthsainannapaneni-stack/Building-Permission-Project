import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { reviewBimSchema } from '@/lib/schemas/bim';
import { reviewBim } from '@/server/services/bim';

export const dynamic = 'force-dynamic';

/**
 * The department's verdict on the model.
 *
 * CHECKLIST_REVIEW is the grant every departmental desk holds for verifying
 * what the applicant stated, and the LTP never holds — which is exactly the
 * separation a model review needs.
 */
export const POST = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    reviewBim(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.CHECKLIST_REVIEW], schema: reviewBimSchema }
);
