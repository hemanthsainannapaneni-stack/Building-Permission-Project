import 'server-only';
import type { AuthUser } from '@/server/auth/context';

/**
 * The applicant at the public portal.
 *
 * ── Why this is not a role, and not a user ──────────────────────────────
 *
 * A developer or professional who registers from the public portal has no
 * account and no session, and the brief for this phase forbids inventing a
 * second authentication system. The registration services, though, are written
 * around an `AuthUser` and around the desk that holds each step's capability —
 * and the applicant's own steps (open, submit, renew) are the ones the TPA
 * inward desk takes when it keys an application in for somebody.
 *
 * So the portal supplies an actor for exactly those steps, built here on the
 * server and never from a cookie or a token:
 *
 *   · it holds only the two capabilities the applicant's steps need, so it
 *     cannot take up, verify or decide anything;
 *   · it is recorded on every event and audit row as `PUBLIC_APPLICANT`, with
 *     the applicant's own name — the trail says the applicant filed it, not
 *     that the TPA desk did;
 *   · its `sessionId` is a constant no real session can carry (session ids are
 *     UUIDs), which is how the two services recognise it.
 *
 * Anything the department does afterwards — take-up, shortfall, verification,
 * decision — is still taken by an officer holding the step's capability.
 */

export const PUBLIC_APPLICANT_ROLE = 'PUBLIC_APPLICANT';
export const PUBLIC_SESSION_ID = 'public-portal';

/** True only for an actor built by `publicApplicant` — never for a signed-in user. */
export const isPublicApplicant = (user: AuthUser): boolean => user.sessionId === PUBLIC_SESSION_ID;

export function publicApplicant(name: string, email: string, capabilities: string[]): AuthUser {
  return {
    id: PUBLIC_SESSION_ID,
    name: `${name.trim() || 'Applicant'} (public portal)`,
    email,
    roleKeys: [],
    roleNames: ['Public applicant'],
    capabilities,
    zoneIds: [],
    officeId: null,
    sessionId: PUBLIC_SESSION_ID,
  };
}
