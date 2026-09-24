import { defineRoute, created } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { createNocSchema, type CreateNocInput } from '@/lib/schemas/nocs';
import { createNoc, getApplicationNocs } from '@/server/services/nocs';

export const dynamic = 'force-dynamic';

/** The application's NOCs tab: every NOC, the summary, and what may be opened. */
export const GET = defineRoute(async ({ user, params }) => getApplicationNocs(user, params.id!), {
  capabilities: [CAPABILITIES.NOC_VIEW],
});

/**
 * Opens a NOC on the file. The desk opens it decided (Required / Not
 * Required); the applicant's declaration opens it Pending. Either grant
 * reaches the service, which decides which of the two the caller is.
 */
export const POST = defineRoute<CreateNocInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    created(await createNoc(user, params.id!, body, { ip, userAgent, correlationId })),
  { capabilities: [CAPABILITIES.NOC_VERIFY, CAPABILITIES.NOC_UPDATE], schema: createNocSchema }
);
