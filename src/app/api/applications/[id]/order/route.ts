import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getApprovalOrder } from '@/server/services/approval-orders';

export const dynamic = 'force-dynamic';

/** The approval order on one application, or null when it has none yet. */
export const GET = defineRoute(
  async ({ user, params }) => {
    const order = await getApprovalOrder(user, params.id!);
    return { order };
  },
  { capabilities: [CAPABILITIES.ORDER_VIEW] }
);
