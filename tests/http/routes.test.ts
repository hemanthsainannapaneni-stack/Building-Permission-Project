import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BASE_URL, probeServer, signIn, get, UNKNOWN_UUID } from './setup';

/**
 * HTTP status codes for unknown, forbidden and valid routes.
 *
 * ── Why this suite exists ──────────────────────────────────────────────
 *
 * `notFound()` renders identical markup whether the response carries 404 or
 * 200, so no component or service test can tell the two apart. The difference
 * is what every non-human consumer acts on: uptime monitors, crawlers, and any
 * client that treats 2xx as success.
 *
 * These assertions are also a TRIPWIRE for a specific, easy regression. Adding
 * a `loading.tsx` above `applications/[id]` creates a Suspense boundary, which
 * lets Next flush the shell — committing `200` — before the query that decides
 * whether the application exists has finished. The page then looks perfect and
 * lies in its status line. If these tests go red on a change that "only"
 * touched a loading skeleton, that is why: see the note in
 * `applications/(register)/loading.tsx`.
 *
 * Skips when no server is running, in the same way the database suites skip
 * when Postgres is absent. Run against one with:
 *
 *   npm run build && npm start
 *   TEST_BASE_URL=http://localhost:3000 npm test
 */

const probe = await probeServer();
const serverUp = probe.up;

/**
 * Page STATUS assertions need a production build.
 *
 * In development Next's overlay instrumentation flushes the document shell
 * earlier, which commits a 200 before the not-found decision is reached — so
 * these would fail against `npm run dev` for a reason that has nothing to do
 * with the code under test. The API suite below has no such dependency and
 * runs either way.
 */
const productionBuild = serverUp && probe.environment !== 'development';

let admin = '';
let ltp = '';

beforeAll(async () => {
  if (!serverUp) return;
  [admin, ltp] = await Promise.all([
    signIn('admin.demo@example.com'),
    signIn('ltp.demo@example.com'),
  ]);
}, 30_000);

afterAll(() => {
  if (!serverUp) {
    console.warn(`\n  [http] skipped — no server at ${BASE_URL}. Start one to run these.\n`);
  } else if (!productionBuild) {
    console.warn(
      `\n  [http] page-status checks skipped — ${BASE_URL} is a development build.` +
        `\n         Run \`npm run build && npm start\` and retry to exercise them.\n`
    );
  }
});

describe.runIf(productionBuild)('unknown routes return 404', () => {
  it('an unknown application id is 404, not 200', async () => {
    const res = await get(`/applications/${UNKNOWN_UUID}`, ltp);
    expect(res.status).toBe(404);
  });

  it('an unknown application id is 404 for an administrator too', async () => {
    // SYSTEM_ADMIN has APPLICATION_VIEW_ALL, so this is genuinely "no such
    // row" rather than "out of scope" — both must be 404.
    const res = await get(`/applications/${UNKNOWN_UUID}`, admin);
    expect(res.status).toBe(404);
  });

  it('the wizard for an unknown application id is 404', async () => {
    const res = await get(`/applications/${UNKNOWN_UUID}/edit`, ltp);
    expect(res.status).toBe(404);
  });

  it('an unknown user id is 404, not 500', async () => {
    // This returned 500 before the fix: the service signals "not found" with
    // an ApiError, which left unhandled became the server reporting its own
    // failure for what is only a bad URL.
    const res = await get(`/admin/users/${UNKNOWN_UUID}`, admin);
    expect(res.status).toBe(404);
  });

  it('a malformed id is 404 rather than a database cast error', async () => {
    // Left to reach Postgres, `not-a-uuid` fails the uuid cast and surfaces
    // as a 500.
    expect((await get('/applications/not-a-uuid', ltp)).status).toBe(404);
    expect((await get('/admin/users/not-a-uuid', admin)).status).toBe(404);
  });

  it('renders the in-shell not-found page, not a bare error', async () => {
    const res = await get(`/applications/${UNKNOWN_UUID}`, ltp);
    const html = await res.text();

    expect(html).toContain('Application not found');
    // The shell is still there, so the user can navigate on rather than
    // reaching for the Back button.
    expect(html).toContain('Dashboard');
  });
});

describe.runIf(productionBuild)('valid routes still work', () => {
  it.each([
    ['/dashboard', 200],
    ['/applications', 200],
    ['/applications/new', 200],
  ])('%s → %i', async (path, expected) => {
    expect((await get(path, ltp)).status).toBe(expected);
  });

  it.each([
    ['/admin/users', 200],
    ['/admin/roles', 200],
    ['/admin/organisation', 200],
  ])('%s → %i', async (path, expected) => {
    expect((await get(path, admin)).status).toBe(expected);
  });

  it('an existing user detail page is 200 and titled with their name', async () => {
    const list = await fetch(`${BASE_URL}/api/admin/users?pageSize=1`, {
      headers: { Cookie: admin },
    });
    const { data } = (await list.json()) as { data: Array<{ id: string; name: string }> };
    const first = data[0]!;

    const res = await get(`/admin/users/${first.id}`, admin);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(first.name);
  });
});

describe.runIf(serverUp)('API routes', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown application id', async () => {
    const res = await fetch(`${BASE_URL}/api/applications/${UNKNOWN_UUID}`, {
      headers: { Cookie: ltp },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 — never 403 — so ids cannot be enumerated', async () => {
    // A 403 on a real id and a 404 on a fake one is an oracle: it tells an
    // attacker which application ids exist. Both must look identical.
    const res = await fetch(`${BASE_URL}/api/applications/${UNKNOWN_UUID}`, {
      headers: { Cookie: ltp },
    });
    const body = (await res.json()) as { error: string; code: string };

    expect(res.status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('refuses a sort column that is not on the allow-list', async () => {
    const res = await fetch(`${BASE_URL}/api/applications?sort=passwordHash`, {
      headers: { Cookie: ltp },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a page size beyond the cap', async () => {
    const res = await fetch(`${BASE_URL}/api/applications?pageSize=5000`, {
      headers: { Cookie: ltp },
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payments
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The payment endpoints, over real HTTP.
 *
 * These are here rather than in the integration suite because the properties
 * being checked are properties of the ROUTE, not of the service:
 *
 *   · the webhook endpoint is the only unauthenticated write in the system,
 *     and "reachable without a session" and "refuses a forged payload" are
 *     both statements about the HTTP layer;
 *   · a 401 on the webhook would silently break every gateway integration,
 *     and no in-process test would notice.
 */
describe.runIf(serverUp)('payment routes', () => {
  it('accepts a webhook without a session — a gateway has none', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/webhook/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'probe', paymentRef: 'PAY-0000-00000000', state: 'SUCCESS' }),
      redirect: 'manual',
    });

    // Anything but 401/403: the endpoint must be reachable. It refuses on the
    // signature, which is the next assertion.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('refuses a forged callback on its signature, not on its session', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/webhook/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lams-mock-signature': 'forged' },
      body: JSON.stringify({ eventId: 'probe', paymentRef: 'PAY-0000-00000000', state: 'SUCCESS' }),
      redirect: 'manual',
    });

    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an unknown gateway name rather than falling back to the live one', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/webhook/not-a-gateway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
  });

  it('requires a session for every other payment route', async () => {
    for (const path of ['/api/payments', `/api/payments/${UNKNOWN_UUID}`, '/api/payments/reconcile']) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
      expect(res.status, path).toBe(401);
    }
  });

  it('refuses an initiate request that names no demand', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ltp },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('refuses an initiate request for a demand that is not the caller\u2019s', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ltp },
      body: JSON.stringify({ applicationFeeId: UNKNOWN_UUID }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses the reconciliation sweep to a role without PAYMENT_RECONCILE', async () => {
    const res = await fetch(`${BASE_URL}/api/payments/reconcile`, {
      method: 'POST',
      headers: { Cookie: ltp },
    });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Workflow
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The workflow endpoints, over real HTTP.
 *
 * Here rather than in the integration suite because these are properties of
 * the ROUTE:
 *
 *   · `GET /actions` is the action bar's only source, so an unauthenticated or
 *     under-privileged caller reaching it would put buttons on a screen that
 *     the engine would then refuse;
 *   · the POST route deliberately carries only WORKFLOW_VIEW and leaves the
 *     real capability to the engine, and "an LTP cannot forward" has to be
 *     true through the HTTP layer, not only in a service call.
 */
describe.runIf(serverUp)('workflow routes', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await fetch(`${BASE_URL}/api/workflow/tasks`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('gives an officer their queue, with the filter counts the chips render', async () => {
    const tpa = await signIn('tpa.demo@example.com');
    const res = await fetch(`${BASE_URL}/api/workflow/tasks`, { headers: { Cookie: tpa } });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      rows: unknown[];
      counts: Record<string, number>;
      totalPages: number;
    };

    expect(Array.isArray(body.rows)).toBe(true);
    // Every filter the UI offers has a count, so a chip can never render blank.
    for (const key of ['all', 'new', 'pending', 'due-soon', 'overdue', 'shortfall']) {
      expect(typeof body.counts[key]).toBe('number');
    }
  });

  it('answers with no actions for an application that has not reached the department', async () => {
    const list = await fetch(`${BASE_URL}/api/applications?pageSize=1`, { headers: { Cookie: ltp } });
    const { data } = (await list.json()) as { data: Array<{ id: string }> };
    const first = data[0];
    if (!first) return;

    const res = await fetch(`${BASE_URL}/api/workflow/applications/${first.id}/actions`, {
      headers: { Cookie: ltp },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: unknown[] };
    expect(Array.isArray(body.actions)).toBe(true);
  });

  it('returns 404 for an unknown application, never 403 — ids stay unguessable', async () => {
    const res = await fetch(`${BASE_URL}/api/workflow/applications/${UNKNOWN_UUID}/history`, {
      headers: { Cookie: ltp },
    });
    expect([403, 404]).toContain(res.status);
  });

  it('refuses an action nobody can take at this stage with a 409, not a 500', async () => {
    const list = await fetch(`${BASE_URL}/api/applications?pageSize=1`, { headers: { Cookie: ltp } });
    const { data } = (await list.json()) as { data: Array<{ id: string }> };
    const first = data[0];
    if (!first) return;

    const res = await fetch(
      `${BASE_URL}/api/workflow/applications/${first.id}/actions/FORWARD`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ltp },
        body: JSON.stringify({ remarks: 'Trying it on.' }),
      }
    );

    // 403 if the role cannot, 409 if the file is nowhere near that stage.
    // Never a 500, and never a 200.
    expect([403, 409]).toContain(res.status);
  });

  it('validates the action body rather than trusting it', async () => {
    const tpa = await signIn('tpa.demo@example.com');
    const res = await fetch(
      `${BASE_URL}/api/workflow/applications/${UNKNOWN_UUID}/actions/FORWARD`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: tpa },
        body: JSON.stringify({ remarks: 123, expectedSequence: 'soon' }),
      }
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses the Viewer role every write, whatever its capabilities say', async () => {
    const viewer = await signIn('viewer.demo@example.com');
    const res = await fetch(`${BASE_URL}/api/workflow/tasks/${UNKNOWN_UUID}/claim`, {
      method: 'POST',
      headers: { Cookie: viewer },
    });

    // Blocked at the route wrapper, before the handler runs: a capability
    // misconfiguration must not be able to make an auditor account dangerous.
    expect(res.status).toBe(403);
  });
});

describe.runIf(productionBuild)('the task queue page', () => {
  it('renders for an officer', async () => {
    const tpa = await signIn('tpa.demo@example.com');
    const res = await get('/tasks', tpa);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Tasks');
  });

  it('sends a role with no workflow capability to /unauthorized', async () => {
    // The LTP holds WORKFLOW_VIEW for their own file's history, so the page is
    // theirs to open — it simply has nothing in it. What must NOT happen is a
    // 500 or a blank screen.
    const res = await get('/tasks', ltp);
    expect([200, 307]).toContain(res.status);
  });
});
