import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { advanceOrderSchema, type AdvanceOrderInput } from '@/lib/schemas/approval-orders';
import { advanceOrder } from '@/server/services/approval-orders';
import { storeApprovalOrderPdf } from '@/server/services/approval-order-pdf';
import { ORDER_STATUS } from '@/lib/approval-orders';

export const dynamic = 'force-dynamic';

/**
 * Moves an order along its lifecycle.
 *
 * ── APPLICATION_APPROVE, for every step ──────────────────────────────────
 *
 * Not ORDER_VIEW, which the applicant holds so they can download their own
 * permission. Every state change here is an act of the sanctioning desk: a
 * preview is a draft of a statutory instrument, and issuing one releases it.
 * The capability that grants a permission is the capability that governs the
 * document evidencing it.
 *
 * The PDF is re-rendered on any move that changes what the document should
 * say, BEFORE the status is written — so a stored artefact never disagrees
 * with the row that describes it.
 */
export const POST = defineRoute<AdvanceOrderInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) => {
    const rerender = body.to === ORDER_STATUS.PREVIEW || body.to === ORDER_STATUS.GENERATED;
    if (rerender) await storeApprovalOrderPdf(params.id!);

    return advanceOrder({
      orderId: params.id!,
      to: body.to,
      actor: user,
      remarks: body.remarks,
      meta: { ip, userAgent, correlationId },
    });
  },
  { capabilities: [CAPABILITIES.APPLICATION_APPROVE], schema: advanceOrderSchema }
);
