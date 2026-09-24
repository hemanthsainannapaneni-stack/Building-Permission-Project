import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { listChecklistItems } from '@/server/services/checklist-admin';

export const dynamic = 'force-dynamic';

export const GET = defineRoute(
  async ({ searchParams }) => listChecklistItems(searchParams.get('kind') ?? undefined),
  { capabilities: [CAPABILITIES.MASTER_DATA_MANAGE] }
);
