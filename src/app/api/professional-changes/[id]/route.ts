import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { getProfessionalChange } from '@/server/services/professional-changes';

export const dynamic = 'force-dynamic';

export const GET = defineRoute(async ({ user, params }) => getProfessionalChange(user, params.id), {
  capabilities: [CAPABILITIES.PROFESSIONAL_CHANGE_VIEW],
});
