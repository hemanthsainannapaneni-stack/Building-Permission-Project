import { defineRoute } from '@/server/http/route';
import { publicFeePaymentSchema } from '@/lib/schemas/public-portal';
import { makePublicDemoPayment } from '@/server/public-portal/payments';

export const dynamic = 'force-dynamic';

/**
 * The public DEMONSTRATION payment of an application's fee.
 *
 * No session. Whoever holds the application number, the demand number and the
 * applicant's mobile may make it. It runs the ordinary payment service with
 * the mock gateway (see `src/server/public-portal/payments.ts`), which is only
 * available when DEMO_MODE is on; no real transaction is ever processed.
 * Rate limited by address like every public write.
 */
export const POST = defineRoute(
  async ({ body, ip, userAgent, correlationId }) => makePublicDemoPayment(body, { ip, userAgent, correlationId }),
  { auth: false, rateLimit: 'publicSubmit', schema: publicFeePaymentSchema }
);
