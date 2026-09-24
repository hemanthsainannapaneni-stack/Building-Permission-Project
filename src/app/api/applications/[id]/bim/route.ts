import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { updateBimSchema } from '@/lib/schemas/bim';
import { getBim, updateBim } from '@/server/services/bim';

export const dynamic = 'force-dynamic';

/**
 * The BIM particulars of one application, with its model files and the
 * readiness check computed against the declared building.
 *
 * Visibility rides on DRAWING_VIEW and writing on DRAWING_UPLOAD: the model is
 * the drawing set in another form, and a role that may see or change one may
 * see or change the other. The PATCH is partial — one card at a time.
 */

export const GET = defineRoute(async ({ user, params }) => getBim(user, params.id!), {
  capabilities: [CAPABILITIES.DRAWING_VIEW],
});

export const PATCH = defineRoute(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    updateBim(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.DRAWING_UPLOAD], schema: updateBimSchema }
);
