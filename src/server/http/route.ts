import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuthUser, getAuthUser, isReadOnly, requireCapability, type AuthUser } from '@/server/auth/context';
import { isApiError, describeInfrastructureFailure, forbidden, badRequest } from './errors';
import { enforceRateLimit, type RateLimitPolicy } from './rate-limit';
import { serialize } from './serialize';

/**
 * The wrapper every API route goes through.
 *
 * It owns the concerns that must never be forgotten: session resolution,
 * capability enforcement, the read-only role, rate limiting, body validation,
 * Decimal-safe serialisation and error shaping.
 *
 * The point is structural — a handler that forgets authorization cannot exist,
 * because the handler never sees an unauthenticated request. Handlers return
 * plain data and never deal with status codes on the failure paths.
 */

/**
 * The dynamic segments an API route may declare, and the value each carries.
 *
 * Named rather than left as an open `Record<string, string>` on purpose. Under
 * `noUncheckedIndexedAccess` an open index signature makes every read
 * `string | undefined`, which would put a `!` on the first line of every
 * `[id]` route and assert nothing anybody did not already know — the segment
 * is present because the handler lives at a path that declares it, and the
 * router will not dispatch to it otherwise.
 *
 * Naming the segments this API actually uses keeps the strictness
 * everywhere it earns its keep, and makes a route that reads a segment its
 * path does not declare a compile error rather than a runtime `undefined`.
 */
export type RouteParams = {
  id: string;
  code: string;
  photoId: string;
  componentId: string;
  ruleId: string;
  provider: string;
  ref: string;
};

export type RouteContext<Body = unknown> = {
  req: NextRequest;
  /** Dynamic segment values, already awaited. */
  params: RouteParams;
  searchParams: URLSearchParams;
  /** Null only on routes declared `auth: false`. */
  user: AuthUser;
  /** Parsed and validated body. `undefined` unless a schema was given. */
  body: Body;
  ip: string;
  userAgent: string;
  /** Threaded into logs, audit rows and outbox payloads. */
  correlationId: string;
};

export type PublicRouteContext<Body = unknown> = Omit<RouteContext<Body>, 'user'> & {
  user: AuthUser | null;
};

type Options<Body> = {
  /** Default true. Set false for sign-in, health and webhook endpoints. */
  auth?: boolean;
  /** Caller must hold at least one of these capabilities. */
  capabilities?: string[];
  /**
   * Default true: the read-only Viewer role may not issue writes. Enforced
   * before the handler runs, so a capability misconfiguration cannot make an
   * auditor account dangerous.
   */
  blockReadOnly?: boolean;
  /**
   * Validates the JSON body. Failures become a 400 with field-level detail.
   *
   * The input type is `unknown` on purpose: a schema using `.default()` or
   * `.transform()` has an input shape that differs from its output, and the
   * handler only ever sees the OUTPUT. Pinning both would reject exactly the
   * schemas worth writing.
   */
  schema?: ZodType<Body, ZodTypeDef, unknown>;
  /**
   * Named policy from RATE_LIMITS. Keyed by user id, falling back to IP.
   *
   * `rateLimitKey` narrows that key using the validated body. Sign-in needs
   * it: keying purely on IP would let five bad attempts lock out an entire
   * office behind one NAT, while keying on email alone lets an attacker
   * spread a spray across many accounts. Email + IP stops the grind against
   * one account without punishing everyone who shares an address.
   */
  rateLimit?: RateLimitPolicy;
  rateLimitKey?: (input: { body: Body; ip: string; user: AuthUser | null }) => string;
};

type Handler<C> = (ctx: C) => Promise<unknown>;

/**
 * Next 15 validates route-handler signatures at build time and requires the
 * second argument to be present, so it is not optional here even for routes
 * with no dynamic segments — those receive `{ params: Promise<{}> }`.
 */
type NextRouteArgs = { params: Promise<Record<string, string | string[]>> };

export function defineRoute<Body = undefined>(
  handler: Handler<RouteContext<Body>>,
  options?: Options<Body> & { auth?: true }
): (req: NextRequest, args: NextRouteArgs) => Promise<Response>;

export function defineRoute<Body = undefined>(
  handler: Handler<PublicRouteContext<Body>>,
  options: Options<Body> & { auth: false }
): (req: NextRequest, args: NextRouteArgs) => Promise<Response>;

// The implementation signature must accept both context shapes. Handlers are
// contravariant in their argument, so no single named type is assignable from
// both overloads — `any` here is contained to this one line, and every caller
// still goes through one of the two typed overloads above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineRoute<Body>(handler: Handler<any>, options: Options<Body> = {}) {
  const { auth = true, capabilities, blockReadOnly = true, schema, rateLimit, rateLimitKey } = options;

  return async function route(req: NextRequest, args: NextRouteArgs): Promise<Response> {
    const correlationId = req.headers.get('x-correlation-id') ?? randomUUID();

    try {
      const rawParams = args?.params ? await args.params : {};
      const collected: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        const v = Array.isArray(value) ? value[0] : value;
        if (v !== undefined) collected[key] = v;
      }
      // Only the segments this route's path declares are present. The cast
      // states what the router guarantees — see RouteParams.
      const params = collected as RouteParams;

      const user = auth ? await requireAuthUser() : await getAuthUser();
      const ip = clientIp(req);

      if (user && blockReadOnly && isReadOnly(user) && !isSafeMethod(req.method)) {
        throw forbidden('The Viewer role is read-only.');
      }

      if (user && capabilities?.length) {
        requireCapability(user, ...capabilities);
      }

      // Body is parsed before the rate-limit check so the key may depend on it
      // (see rateLimitKey). Parsing is cheap; the work worth protecting — the
      // Argon2 verify, the database writes — all happens after.
      let body = undefined as Body;
      if (schema) body = await parseBody(req, schema);

      if (rateLimit) {
        const key = rateLimitKey ? rateLimitKey({ body, ip, user }) : (user?.id ?? ip);
        await enforceRateLimit(rateLimit, key);
      }

      const result = await handler({
        req,
        params,
        searchParams: req.nextUrl.searchParams,
        user: user as AuthUser,
        body,
        ip,
        userAgent: req.headers.get('user-agent') ?? '',
        correlationId,
      });

      if (result instanceof Response) {
        result.headers.set('x-correlation-id', correlationId);
        return result;
      }
      if (result === undefined || result === null) {
        return new NextResponse(null, { status: 204, headers: { 'x-correlation-id': correlationId } });
      }

      return NextResponse.json(serialize(result), { headers: { 'x-correlation-id': correlationId } });
    } catch (err) {
      return toErrorResponse(err, correlationId);
    }
  };
}

const isSafeMethod = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method);

async function parseBody<Body>(req: NextRequest, schema: ZodType<Body, ZodTypeDef, unknown>): Promise<Body> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('The request body could not be read as JSON.');
  }
  return schema.parse(raw);
}

/** Shorthand for a JSON response with Decimal handling. */
export function json<T>(data: T, status = 200) {
  return NextResponse.json(serialize(data), { status });
}

export function created<T>(data: T) {
  return json(data, 201);
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? '';
  return req.headers.get('x-real-ip') ?? '';
}

export function toErrorResponse(err: unknown, correlationId = ''): NextResponse {
  const headers: Record<string, string> = {};
  if (correlationId) headers['x-correlation-id'] = correlationId;

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Some of the details are not valid. Correct the highlighted fields and try again.',
        code: 'VALIDATION_FAILED',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400, headers }
    );
  }

  // `isApiError`, not `instanceof`: an error thrown by a module Next bundled
  // into a different server layer is a genuine ApiError with a different
  // class object, and `instanceof` would send it down the 500 path. See the
  // brand in errors.ts.
  if (isApiError(err)) {
    if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
    return NextResponse.json(err.toJSON(), { status: err.status, headers });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique constraint — surfaced as a conflict, not a 500.
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join(', ') : 'value';
      return NextResponse.json(
        { error: `That ${target} is already in use.`, code: 'DUPLICATE' },
        { status: 409, headers }
      );
    }
    // P2025 record not found.
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'That could not be found.', code: 'NOT_FOUND' }, { status: 404, headers });
    }
    // P2003 foreign key violation.
    if (err.code === 'P2003') {
      return NextResponse.json(
        { error: 'That refers to something which no longer exists.', code: 'CONFLICT' },
        { status: 409, headers }
      );
    }
  }

  // Anything unexpected: log the detail server-side, return a sentence.
  console.error(`[route] unhandled error correlationId=${correlationId}`, err);
  return NextResponse.json(
    { error: describeInfrastructureFailure(err), code: 'INTERNAL' },
    { status: 500, headers }
  );
}
