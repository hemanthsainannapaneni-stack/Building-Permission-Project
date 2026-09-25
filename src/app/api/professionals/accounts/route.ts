import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { linkableAccounts } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/** Active LTP portal accounts a registration may be linked to. */
export const GET = defineRoute(async ({ user }) => linkableAccounts(user), { capabilities: [CAPABILITIES.PROFESSIONAL_REG_REGISTER] });
