/**
 * HTTP-level test support.
 *
 * These tests exercise the running application over real HTTP, because that is
 * the only place some behaviour is observable at all. A page's STATUS LINE is
 * the clearest example: `notFound()` renders the same markup whether the
 * response carries 404 or 200, so a component test cannot tell the two apart —
 * and the difference is exactly what uptime checks, crawlers and API clients
 * act on.
 *
 * They skip rather than fail when no server is running, the same way the
 * database-backed suites skip when Postgres is absent. Point them at a server
 * with:
 *
 *   TEST_BASE_URL=http://localhost:3000 npm test
 */

export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

/**
 * Whether a server is reachable, and which build it is.
 *
 * The build matters. Next streams pages differently in development — the dev
 * overlay adds instrumentation that flushes the shell earlier — so a page's
 * STATUS LINE is only meaningful against a production build. Running these
 * assertions against `npm run dev` would produce confident, wrong failures, so
 * the page-status suite skips there and says why.
 */
export async function probeServer(): Promise<{ up: boolean; environment: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { up: false, environment: '' };
    const body = (await res.json()) as { environment?: string };
    return { up: true, environment: body.environment ?? '' };
  } catch {
    return { up: false, environment: '' };
  }
}

/** True when a server is reachable, so suites can skip rather than fail. */
export async function serverAvailable(): Promise<boolean> {
  return (await probeServer()).up;
}

/**
 * Signs in and returns the Cookie header for that session.
 *
 * `redirect: 'manual'` so a redirect response never swallows the Set-Cookie
 * headers we came for.
 */
export async function signIn(email: string, password = 'Demo@12345'): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });

  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${res.status}`);

  const cookies = res.headers.getSetCookie?.() ?? [];
  if (!cookies.length) throw new Error(`Sign-in for ${email} returned no cookies`);

  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/**
 * A GET that does NOT follow redirects.
 *
 * Following them would report the status of wherever we landed, which is the
 * opposite of what these tests are checking.
 */
export function get(path: string, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
}

export const UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';
