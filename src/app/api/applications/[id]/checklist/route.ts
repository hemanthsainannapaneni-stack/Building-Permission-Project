import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { saveChecklistSchema } from '@/lib/schemas/checklists';
import {
  getApplicationChecklist,
  saveChecklistResponses,
} from '@/server/services/application-checklist';

export const dynamic = 'force-dynamic';

/**
 * The application checklist on one application.
 *
 * GET returns the nineteen ACTIVE questions joined to this file's answers,
 * with the full history of every act on each — not a list of answer rows. A
 * question nobody has answered yet has no row, and the payload says PENDING
 * for it, which is the same thing said honestly.
 *
 * PATCH is the APPLICANT'S side, and takes CHECKLIST_RESPOND. The reviewer's
 * side is a separate route with a separate capability, so that no combination
 * of a missing check and a crafted body lets an applicant verify their own
 * answers. See src/server/services/application-checklist.ts.
 */

export const GET = defineRoute(
  async ({ user, params, searchParams }) =>
    getApplicationChecklist(user, params.id, searchParams.get('kind') ?? 'APPLICATION'),
  { capabilities: [CAPABILITIES.CHECKLIST_VIEW] }
);

export const PATCH = defineRoute(
  async ({ user, params, body, searchParams, ip, userAgent, correlationId }) =>
    saveChecklistResponses(
      user,
      params.id,
      body,
      { ip, userAgent, correlationId },
      searchParams.get('kind') ?? 'APPLICATION'
    ),
  { capabilities: [CAPABILITIES.CHECKLIST_RESPOND], schema: saveChecklistSchema }
);
