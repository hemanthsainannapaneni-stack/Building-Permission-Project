import { defineRoute } from '@/server/http/route';
import { publicConsentSchema } from '@/lib/schemas/public-portal';
import { checkConsent, demoAcknowledgement } from '@/server/public-portal/consent';

export const dynamic = 'force-dynamic';

/**
 * The demonstration consent links. `check` validates the references and returns
 * what is being asked; `accept` / `decline` return a demonstration
 * acknowledgement. Stores NOTHING — see `src/server/public-portal/consent.ts`.
 */
export const POST = defineRoute(
  async ({ body }) => {
    const check = await checkConsent(body.kind, { partyReference: body.partyReference, applicationNumber: body.applicationNumber });
    if (!check.ok) return { ok: false, reason: check.reason };
    if (body.action === 'check') return { ok: true, application: check.application, party: check.party, request: check.request };
    return {
      ok: true,
      application: check.application,
      party: check.party,
      request: check.request,
      decision: body.action === 'accept' ? 'ACCEPTED' : 'DECLINED',
      acknowledgement: demoAcknowledgement(),
      demo: true,
      stored: false,
    };
  },
  { auth: false, rateLimit: 'publicVerify', schema: publicConsentSchema }
);
