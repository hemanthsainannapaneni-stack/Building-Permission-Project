import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { availableProfessionals } from '@/server/services/professional-registrations';

export const dynamic = 'force-dynamic';

/**
 * Approved professionals an application may name: `?purpose=FILE_HOLDER|STRUCTURAL`,
 * `&mine=true` for the caller's own registrations (the LTP step), `&q=`.
 * Open to whoever edits an application or registers a change of professional —
 * the register of approved professionals is public.
 */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const purpose = searchParams.get('purpose') === 'STRUCTURAL' ? 'STRUCTURAL' : 'FILE_HOLDER';
    const mine = searchParams.get('mine') === 'true';
    return availableProfessionals({ purpose, userId: mine ? user.id : undefined, q: searchParams.get('q')?.trim() || undefined });
  },
  { capabilities: [CAPABILITIES.APPLICATION_EDIT, CAPABILITIES.LTP_CHANGE_REQUEST, CAPABILITIES.LTP_REG_VIEW] }
);
