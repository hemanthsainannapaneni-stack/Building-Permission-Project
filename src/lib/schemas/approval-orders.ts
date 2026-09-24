import { z } from 'zod';
import { ORDER_STATUS } from '@/lib/approval-orders';

/**
 * What a client may ask of an approval order.
 *
 * It names the state it wants, and the engine decides whether that move is
 * legal from where the order actually is. The alternative — a payload saying
 * "approve" or "issue" — would put a second copy of the lifecycle in the
 * route, and the second copy is always the one that drifts.
 */
export const advanceOrderSchema = z.object({
  to: z.enum([
    ORDER_STATUS.DRAFT,
    ORDER_STATUS.PREVIEW,
    ORDER_STATUS.GENERATED,
    ORDER_STATUS.APPROVED,
    ORDER_STATUS.ISSUED,
  ]),
  remarks: z.string().trim().max(2000).default(''),
});

export type AdvanceOrderInput = z.infer<typeof advanceOrderSchema>;
