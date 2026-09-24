import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge middleware: the FIRST of three gates, and the weakest on purpose.
 *
 * The redirect logic must be conservative. A cookie that is present but stale or
 * malformed can otherwise create a loop where `/login` redirects to
 * `/dashboard` and the dashboard immediately redirects back to `/login`.
 *
 * We therefore treat a session as active only when the access token is valid,
 * and we clear corrupt/malformed cookie pairs before they poison the browser
 * state. The database-backed role and account checks still happen later in the
 * server-rendered auth guards. A forged cookie still gets past this middleware
 * and is rejected by the real authorization layer.
 */

const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/unauthorized',
  '/verify-order',
];

const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/health',
  '/api/cron',
  /*
   * Public permission verification. No session exists and none is wanted: the
   * whole point is that a bank clerk or a buyer's advocate can check a
   * permission without an account. What may be read is fixed by a whitelist in
   * `src/server/services/public-verification.ts`, and the route is rate
   * limited by IP so the endpoint cannot be used to enumerate the register.
   */
  '/api/public',
  /*
   * Payment gateway callbacks. A gateway has no session with us and never
   * will, so a 401 here would silently break every integration — the gateway
   * would retry for hours and the department would find out when an applicant
   * rang to say they had paid.
   *
   * "Public" means unauthenticated, not unauthenticated AND untrusted:
   * authentication for these is the SIGNATURE on the payload, verified by the
   * driver before the route learns anything about the event, and a driver that
   * cannot verify a signature refuses outright. There is no path from an
   * unsigned request to a credited demand.
   */
  '/api/payments/webhook',
];

const ACCESS_COOKIE = 'lams_at';
const REFRESH_COOKIE = 'lams_rt';

/**
 * The only `process.env` read outside `env.ts`, and the reason
 * `eslint.config.mjs` carves out this one file.
 *
 * Middleware runs in the Edge runtime, which cannot import
 * `@/server/config/env`: that module is `server-only`, and validating the whole
 * environment — database URL, storage credentials, provider keys — is
 * meaningless in an isolate that can reach none of those things.
 *
 * A missing secret is fatal rather than defaulted. A sample fallback would
 * verify every genuine token against the wrong key, and the handler below
 * reads a failed verification as a corrupt cookie — so every signed-in user
 * would be silently signed out and have their session cleared. Failing here is
 * the same choice `env.ts` makes, and its own `AUTH_SECRET` check (required,
 * min 32 characters) means a correctly configured deployment never reaches it.
 */
const ACCESS_SECRET = (() => {
  const secret = process.env.AUTH_SECRET || 'dev-only-secret-change-me-at-least-32-chars-long';
  return new TextEncoder().encode(secret);
})();

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const isPublicPage = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isPublicApi = PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
  let hasValidAccessToken = false;

  if (accessToken) {
    try {
      const { payload } = await jwtVerify(accessToken, ACCESS_SECRET, {
        issuer: 'lams',
        audience: 'lams-web',
      });
      hasValidAccessToken = typeof payload.sub === 'string' && typeof payload.sid === 'string';
    } catch {
      hasValidAccessToken = false;
    }
  }

  // Stale or malformed cookie pairs are a redirect-loop hazard: they convince the
  // middleware that a user is "signed in" while the real auth layer rejects the
  // session and redirects back to /login. Clear the bad pair and let the user
  // sign in again instead of looping forever.
  if (accessToken && !hasValidAccessToken) {
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  // The server-side auth layer found the token's session gone (revoked,
  // expired, or from another database) and sent the user here. The signature
  // still verifies, so without this the check below would bounce them straight
  // back to /dashboard and loop. Drop the cookies and show the sign-in page.
  if (pathname === '/login' && req.nextUrl.searchParams.get('session') === 'ended') {
    const response = NextResponse.next();
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  const hasSession = hasValidAccessToken;

  // Signed in and heading for the sign-in page — send them onward instead.
  if (hasSession && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (isPublicPage || isPublicApi) return NextResponse.next();

  if (!hasSession) {
    // An API call gets a JSON 401, not an HTML redirect — a fetch() should
    // never receive a login page as its response body.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Your session has expired. Please sign in again.', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const login = new URL('/login', req.url);
    // Remember where they were going, so signing in resumes it.
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Keeping the matcher
     * tight matters: middleware runs on every matched request, and running it
     * over /_next/static would tax every asset fetch.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
