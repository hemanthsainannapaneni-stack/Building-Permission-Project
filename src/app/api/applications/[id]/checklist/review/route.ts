import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { reviewChecklistSchema } from '@/lib/schemas/checklists';
import { reviewChecklist } from '@/server/services/application-checklist';

export const dynamic = 'force-dynamic';

/**
 * A departmental desk's verification of the checklist.
 *
 * A route of its own rather than a mode of the PATCH above, because the
 * capability is what separates answering from verifying and a capability
 * guards a route. Folding both into one endpoint would mean the difference
 * between an applicant and an officer came down to a branch inside a handler —
 * which is exactly the kind of check that survives three refactors and then
 * does not.
 *
 * Nothing here can write the applicant's answer. The service has no path to
 * that column, and every act appends to `checklist_review_entries`, which has
 * no update path at all: a ZDD may disagree with the TPA and may not erase
 * them.
 */

export const POST = defineRoute(
  async ({ user, params, body, searchParams, ip, userAgent, correlationId }) =>
    reviewChecklist(
      user,
      params.id,
      body,
      { ip, userAgent, correlationId },
      searchParams.get('kind') ?? 'APPLICATION'
    ),
  { capabilities: [CAPABILITIES.CHECKLIST_REVIEW], schema: reviewChecklistSchema }
);
