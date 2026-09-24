import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { saveInspectionSchema, type SaveInspectionInput } from '@/lib/schemas/site-inspections';
import { getInspection, saveInspectionDraft } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/** One inspection report: header, the 27 answers, photographs, signature. */
export const GET = defineRoute(async ({ user, params }) => getInspection(user, params.id!), {
  capabilities: [CAPABILITIES.SITE_INSPECTION_VIEW],
});

/**
 * Save Draft. Only the named inspector, only while the report is open — the
 * service checks both, and refuses a signed report whoever asks.
 */
export const PATCH = defineRoute<SaveInspectionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    saveInspectionDraft(user, params.id!, body, { ip, userAgent, correlationId }),
  { capabilities: [CAPABILITIES.SITE_INSPECTION_CONDUCT], schema: saveInspectionSchema }
);
