import { defineRoute } from '@/server/http/route';
import { publicRenewalPaymentSchema } from '@/lib/schemas/public-portal';
import { payRenewalDemoFee } from '@/server/public-portal/payments';

export const dynamic = 'force-dynamic';

/** The demonstration fee of a renewal filed from the public portal. A labelled demo record — see `payments.ts`. */
export const POST = defineRoute(
  async ({ body, ip, userAgent, correlationId }) =>
    payRenewalDemoFee({ kind: body.kind, renewalNumber: body.renewalNumber, mobileLast4: body.mobileLast4, method: body.method }, { ip, userAgent, correlationId }),
  { auth: false, rateLimit: 'publicSubmit', schema: publicRenewalPaymentSchema }
);
