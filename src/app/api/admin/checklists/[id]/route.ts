import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import {
  updateChecklistItem,
  updateChecklistItemSchema,
} from '@/server/services/checklist-admin';

export const dynamic = 'force-dynamic';

export const PATCH = defineRoute(
  async ({ params, body, user, ip, userAgent, correlationId }) =>
    updateChecklistItem(params.id, body, user, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE], schema: updateChecklistItemSchema }
);
