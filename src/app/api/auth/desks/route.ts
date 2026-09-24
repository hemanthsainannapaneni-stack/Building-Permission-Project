import { defineRoute } from '@/server/http/route';
import { listDesks } from '@/server/services/desks';

export const dynamic = 'force-dynamic';

/**
 * The desks the Switch Desk control offers.
 *
 * Authenticated — `defineRoute` requires a session by default, and this one
 * keeps it. Somebody who is already signed in learning the demonstration
 * account names gives away nothing; an anonymous endpoint listing them would.
 * Outside DEMO_MODE the list is empty, so the answer is the same either way.
 */
export const GET = defineRoute(async () => listDesks());
