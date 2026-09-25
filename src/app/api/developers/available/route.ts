import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { availableDevelopers } from '@/server/services/developer-registrations';

export const dynamic = 'force-dynamic';

/**
 * Approved developers a building-permission application may name: `?q=`.
 * Open to whoever fills the LTP step — the full administrative register
 * (DEVELOPER_VIEW) is not exposed here; this is deliberately narrower.
 */
export const GET = defineRoute(
  async ({ searchParams }) => availableDevelopers({ q: searchParams.get('q')?.trim() || undefined }),
  { capabilities: [CAPABILITIES.APPLICATION_EDIT] }
);
