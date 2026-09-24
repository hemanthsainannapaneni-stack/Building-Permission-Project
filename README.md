# LAMS — LTP Approval Management System

Building permission platform: application intake → drawing scrutiny → document and fee gates → online payment → a six-tier departmental approval chain → approval order.

**Status: the workflow engine is live — an application now runs the whole way, from filing to an issued approval order.** (The delivery plan numbers this as Phase 7.) Foundations, identity, RBAC, the app shell and the design system; LTP application management — the filing wizard, the register, the application record and its timeline; drawing management with automated scrutiny; the derived document checklist with officer verification; the fee engine and demands that freeze on issue; online payment with server-side settlement and receipts; and now the **workflow engine** — a configurable transition table, guards and effects, officer tasks with SLA clocks, shortfalls in both their blocking and reported shapes, and an approval that cannot step over an open one. **612 tests** (578 unit and integration green, 34 over HTTP against a running server). Notifications are next.

Architecture, decisions and the phase plan live in [`docs/`](docs/README.md).

---

## Quick start

Requires Node 20+ and Docker.

```bash
cp .env.example .env          # dev defaults work as-is
npm install
docker compose up -d db       # Postgres on host port 5433
npm run db:deploy             # apply migrations
npm run db:seed               # roles, permissions, org, 11 demo accounts
npm run seed:demo             # 70 worked applications + 8 more demo accounts
npm run dev                   # http://localhost:3000
npm run worker                # in a second terminal
```

Sign in at `/login` with any demo account — the login page lists them all behind
**Demo accounts** when `DEMO_MODE=true`.

| Account | Role | Lands on |
|---|---|---|
| `ltp.demo@example.com` | Licensed Technical Person | `/dashboard` (applicant) |
| `tpa.demo@example.com` | Town Planning Assistant | `/dashboard` (officer) |
| `zad.demo@example.com` · `zdd.demo@example.com` | Zonal Assistant / Deputy Director | `/dashboard` (officer) |
| `zjd.demo@example.com` | Zonal Joint Director | `/dashboard` (officer) |
| `director.demo@example.com` | Director (Development Plan) | `/dashboard` (executive) |
| `addlcommissioner.demo@example.com` | Additional Commissioner | `/dashboard` (executive) |
| `commissioner.demo@example.com` | Commissioner | `/dashboard` (executive) |
| `finance.demo@example.com` | Finance Officer | `/dashboard` (finance) |
| `admin.demo@example.com` | System Administrator | `/admin` |
| `viewer.demo@example.com` | Viewer / Auditor | `/dashboard`, read-only |

`npm run seed:demo` adds eight more, so a shared inbox has more than one officer
in it and the user register has accounts that are not all ACTIVE:

| Account | Role | Zones | Note |
|---|---|---|---|
| `ltp2.demo@example.com` · `ltp3.demo@example.com` · `ltp4.demo@example.com` | Licensed Technical Person | — | The seventy applications are filed across all four LTPs |
| `tpa2.demo@example.com` | Town Planning Assistant | Z3, Z4, Z5 | Second holder of the TPA desk |
| `zad2.demo@example.com` | Zonal Assistant Director | Z5 | |
| `zjd2.demo@example.com` | Zonal Joint Director | Z4, Z5 | |
| `tpa3.demo@example.com` | Town Planning Assistant | Z2 | **INACTIVE** — so the register's status filter has something to filter |
| `viewer2.demo@example.com` | Viewer / Auditor | — | **SUSPENDED** — so the sign-in refusal is visible |

**Password for all of them: `Demo@12345`** (set by `DEMO_PASSWORD`). Demo accounts
are seeded only when `DEMO_MODE=true`, which the production guardrails refuse.
**Change it before this is deployed anywhere real** — and prefer the
environment-driven administrator below, whose password is never written down in
this repository.

### The administrator, without a password in the repository

`admin.demo@example.com` is a demonstration account and its password is printed
above, which is right for a demo and wrong for anything else. A real deployment
sets two environment variables and `npm run db:seed` creates or updates the
account from them:

```bash
SUPER_ADMIN_EMAIL=admin@example.gov.in
SUPER_ADMIN_PASSWORD='<at least 16 characters, from your secret store>'
```

The value is treated as a BOOTSTRAP credential — it has been through a shell, an
environment file and probably a deployment log — so the account is required to
change it at first sign-in. Re-seeding does **not** reset an existing
administrator's password unless `SUPER_ADMIN_RESET_PASSWORD=true`, so a routine
seed on a live system cannot quietly put the credential back.

The Super Admin can see and administer everything: every application at every
stage, every user, drawing, scrutiny report, document, demand, payment,
shortfall, workflow history, notification, audit row and setting. What that does
**not** confer is the power to decide an application. Approving still requires
the file to be at the Commissioner's desk, the `no_open_shortfalls` guard to
pass, and the action to be recorded with an actor, remarks, a workflow-history
row and an audit entry — exactly as it does for the Commissioner. Administrative
visibility and workflow authority are separate on purpose.

> Host port **5433**, not 5432 — the adjacent land allotment project's Postgres holds 5432. Inside the compose network the port is still 5432.

Check it came up:

```bash
curl localhost:3000/api/health        # liveness — does not touch the database
curl localhost:3000/api/health/ready  # readiness — database, migrations, queue, outbox
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run worker` | Job worker (out of process) |
| `npm run verify` | lint → typecheck → test. Run before every commit. |
| `npm run smoke` | Exercises the foundations against a real database |
| `npm run test:http` | Route-level status checks against a **running** server. Skips if none is up. |
| `npm run db:migrate` | Create + apply a migration |
| `npm run db:deploy` | Apply existing migrations |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:seed` | Seed roles, permissions, org and demo accounts (idempotent) |
| `npm run seed:demo` | Build the 70-application demo environment (idempotent — a second run does nothing) |
| `npm run seed:demo:reset` | **Local only.** TRUNCATE every application table and rebuild the demo |
| `npm run demo:verify` | Reconcile the dashboards against the database. Exits non-zero on any mismatch |

## The demo environment

`npm run seed:demo` builds seventy applications spread across every stage of the
approval chain, so every dashboard, register, filter, chart and role screen has
something true to show.

### It is built by driving the real system

Not one row is inserted with a status written into it. Every application is
created through `createApplication`, filled through `saveStep`, filed through
`submitApplication`, drawn through `uploadDrawing`, checked by the real scrutiny
engine, documented through `uploadDocument`, charged by the fee calculator, paid
through a signed mock-gateway callback, and then moved desk to desk by
`performAction` — the same code path an officer's button press takes.

That costs about fifty seconds instead of about two, and it buys the only thing
that matters here: **a state the system cannot produce cannot appear in the
demo.** An approved application with an open shortfall is impossible because the
`no_open_shortfalls` guard runs; a `PAYMENT_SUCCESSFUL` file really does have a
demand, a settled payment, a receipt and a workflow instance behind it, because
that is what made it successful.

It also means the demo fails loudly rather than quietly. If a transition stops
being reachable, the seed throws on the application that needed it.

### What you get

| | |
|---|---|
| Applications | **70**, across **26 distinct statuses** |
| Application types | Residential and commercial building permission (`BP/2026/…`), layout approval (`LP/2026/…`) |
| Filed by | 4 LTP accounts, spread across 5 zones |
| Worked by | 10 officer accounts, each only within their real jurisdiction |
| Related records | drawings and versions, scrutiny requests, results and issues, document checklists and versions, demands and line items, payments, transactions and receipts, workflow instances, tasks, history and SLA clocks, shortfalls, items and resolutions, notifications, timeline events and audit rows |

The distribution is a real office's shape: a wide base of applicant-side work, a
busy first review desk, progressively fewer files at each senior desk, and a
handful closed at either end. Roughly half the files went through at least one
shortfall cycle on the way, so a history is not six identical "Forwarded" rows.

### Dates

Every application is built in the same fifty seconds, which would put seventy
files on one day and make every trend chart a single bar. So each file's own
timeline is then stretched onto the span its plan gave it — one affine map in
epoch seconds, applied to every timestamp of that application, so ordering and
relative spacing survive: the drawing is still uploaded after the filing, the
payment still settles before the file reaches the TPA.

`audit_logs` is deliberately **not** moved. It is hash-chained tamper evidence
and its rows say when this database was actually written to. Rewriting them
would break the chain and falsify the one table whose whole purpose is to be
trustworthy. So the audit trail records the truth — a seed script created these
rows today — while the business timeline reads as the department's history.
Where the two disagree, the audit trail is right.

### Re-running it

`npm run seed:demo` is idempotent. It records what it created in
`system_settings.demo_seed_manifest`; a second run finds those rows still
present and stops. Two runs leave seventy applications, not a hundred and forty.

It cannot delete and rebuild instead: an application that has taken money is not
deletable by design (`payments.applicationId` is `ON DELETE RESTRICT`) and
workflow history refuses `DELETE` at the database level. Those rules are correct
and the seed does not get an exception from them.

`npm run seed:demo:reset` is the way out. It `TRUNCATE`s the application tables —
which the constraints migration deliberately left available so a development
database can be rebuilt — and it refuses to run unless `LAMS_ALLOW_DEMO_RESET`
is set, and refuses outright when `NODE_ENV=production`. It prints the host and
database it is about to truncate before it does. RBAC, organisation, catalogue,
workflow configuration and the audit trail are left alone.

The generator is deterministic: `DEMO_SEED` fixes the pseudo-random stream, so
the seventieth application is the same application on every machine and a bug
report about `BP/2026/000042` is reproducible.

### Checking the numbers

```bash
npm run demo:verify
```

Asks the database the same questions the dashboards ask, by a **different
route**, and exits non-zero if the answers differ. Both using the same query
would prove nothing — it would only show that Prisma can run a query twice. So
`src/server/services/analytics.ts` sums collections with one aggregate over
settled payments, and the verifier walks the payments and adds them up.

Thirty-nine checks, in two families:

- **Consistency** — the dashboard total equals the applications table; the
  status breakdown sums to the total; the trend chart counts the same rows;
  collections equal the sum of settled payments; open shortfalls equal
  unresolved shortfall rows.
- **Integrity** — no approved application with an open shortfall or an unpaid
  demand; no settled payment without a receipt; no application at two stages or
  with two open tasks; no demand marked paid without a settled payment behind
  it; no `openShortfalls` counter that disagrees with the rows; no file decided
  before it was filed.

### Where the numbers come from

Every figure on every dashboard is a database count from
`src/server/services/analytics.ts`, and every query in that module is scoped
through `applicationScope(user)` — merged into the `WHERE` clause, not filtered
afterwards. An LTP's total counts their own files, a zonal officer's counts
their jurisdiction, a Commissioner's counts the city. They differ because the
**rows** differ, not because the screens count differently. There is no constant
in the dashboard code that a reader could mistake for data.

## What is built

### The workflow engine

| | |
|---|---|
| **Routing is data, not code** | `src/server/workflow/engine.ts` contains no stage name. Search it for `TPA` or `COMMISSIONER` and there is nothing to find: `(stage, status, role, action) → (stage, status, task, SLA, notification, audit)` is a row in `workflow_transitions`, and `prisma/seed/09-workflow.ts` holds every one of them. Granting the Additional Commissioner the power to report a shortfall and forward is a seed row — not a branch, not a page, not a deployment. |
| **One engine, one queue, one screen** | There is no TPA page and no Commissioner page. Six desks share one action bar, one inbox and one review screen, and what an officer sees is decided by the roles they hold and the transitions configured at the stage the file is at. |
| **The action bar cannot lie** | `GET /api/workflow/applications/:id/actions` runs the same resolution and the same guards the POST will run, so a button that is offered cannot be refused and a refusal is never a surprise. A blocked action stays on screen, disabled, carrying the sentence that says what it is waiting for — *"Approve · 2 shortfalls are still open"*. |
| **An open shortfall blocks approval, absolutely** | Of any kind, in either mode, raised at any desk, with **no override anywhere in the system** — no capability, no settings key, no code path. A shortfall the ZJD merely *reported* travels with the file and still stops the Commissioner six desks later. The guard re-counts live inside the approving transaction, because a denormalised counter must never be the thing that authorises an approval. |
| **The return path is one column** | A blocking shortfall parks the file and records `parkedStageId`. The applicant answers, `RETURN_TO_ORIGIN` reads that column, and the file goes back to the desk that raised it with the clock resuming on the days it had left. There is no map from raising stage to resuming stage anywhere in the repository. |
| **Every movement is recorded once, and cannot be edited** | Status, task, SLA, history row, timeline entry, audit row and notification all commit in ONE transaction with the change they describe. `workflow_history` is append-only by database trigger — an UPDATE is refused for the application's own role, not merely avoided by convention. |
| **Two officers, one file** | `performAction` opens with `SELECT … FOR UPDATE` on the instance. The screen sends the history sequence it rendered, and a mismatch is a 409 that says the file has moved on. Claiming is a conditional update decided by the database, and `one_open_task` makes a duplicate open task impossible rather than unlikely. |
| **Tasks route by rule** | `workflow_assignments` says who a stage's work goes to — a shared role queue by default, or a named officer, the least-loaded, or a rotation — per stage and per zone. The engine asks; it never decides. |
| **The clock measures the department** | Working days, holidays, a warning threshold that scales with the window, and a pause while the file is with the applicant, so the figure means "working days this desk held the file" rather than "how slow the applicant was". Overdue **notifies and reports and does nothing else** — it never moves an application and never changes what an officer may do. |
| **The officer's review screen is the whole file** | Application, applicant, property, drawings, scrutiny, documents, fees, payments, shortfalls, previous actions, the timeline and the hash-chained audit trail — one screen, one set of tabs, the same for every desk. |
| **A workflow publishes only if it validates** | Reachability from the entry stage, no dead ends, no ambiguous routing, no unknown guard or effect, no role granted an action at a desk it does not work at, and at least one path to an ending. The seed refuses to publish a graph that fails, and `startWorkflow` refuses to route applications through an unpublished workflow. |

### Payments

| | |
|---|---|
| **Provider abstraction** | One `PaymentProvider` interface; four drivers behind it — `mock`, `razorpay`, `payu`, `ccavenue`. Nothing in `services/payments.ts` knows which is live, and the gateway name appears in exactly one place outside a driver file: the registry that resolves it. An integration test drives the whole path through a stub driver that shares no code with the mock and asserts identical application state, so "not coupled to one gateway" is proven rather than claimed. |
| **The browser is never believed** | The return page's query string is read by nothing. Every route — the return, the webhook, the sweep, a finance officer pressing Reconcile — converges on one `settle()`, which takes its verdict from `provider.verify()`, server to server, and from nothing else. The database backs it up: `payment_success_is_locked` means a row cannot claim SUCCESS without having passed through the settlement lock, so no code path and no hand-written UPDATE can mark a payment paid on the strength of a redirect. |
| **Duplicate callbacks are free** | `payment_webhook_events (provider, externalId)` is unique, so a redelivery is a no-op before any money is touched. `payments.settlementLockAt`, stamped inside the settlement transaction while the row is held `FOR UPDATE`, means even two *different* events for one payment credit it once. Five deliveries → one credit, one receipt, one advanced application. |
| **Amount mismatch refuses** | The gateway's figure and the demand's must agree to the paisa. They do not, and the settlement credits **neither** — no partial credit, no receipt, no advance, the attempt locked, and finance alerted under its own audit action. Crediting the gateway's figure would let a payer pay less than they owe; crediting the demand's would book money the department never received. |
| **Failure never advances** | There is no branch reachable from a failed payment into the transition that submits an application. `advanceOnPaymentSuccess` is called from one place, inside the SUCCESS arm, and it re-derives from the demands rather than trusting the payment it was called for — so two live demands cannot be cleared by paying one. |
| **Retries and the sweep** | A retry is always a new row; `payment_one_open_per_demand` makes a second live attempt against one demand impossible at the database. A reconciliation sweep verifies every unsettled payment against the gateway every five minutes, so a payer who closed the browser mid-payment is a non-event and nothing depends on a browser coming back. |
| **Receipts** | Issued inside the settlement transaction, numbered gap-free, and rendered from a frozen JSON snapshot that joins nothing — a later fee revision must never alter a receipt already given to a citizen. A trigger refuses any UPDATE touching the number, amount, payment, date or snapshot, and refuses DELETE outright; only the rendered artefact may be re-pointed. |
| **Honesty guardrails** | `payments.provider` records the driver against every attempt forever; every mock receipt is watermarked *"DEMO PAYMENT — NO MONEY HAS CHANGED HANDS"*; the demo gateway page is styled to look nothing like the product and says what it is; and the mock **refuses to run in production** unless someone explicitly opted in. |
| **Payment UI** | Fee summary and full breakdown beside the Pay button, a gateway handoff that supports both redirect and signed form-POST checkouts, a return page that polls the server with backoff and tells a waiting payer *not to pay again*, success with the receipt, failure and timeout with a retry, the per-attempt gateway ledger, and a finance register with a manual reconcile. |

### Phase 3 — drawings and scrutiny

| | |
|---|---|
| **Upload pipeline** | Size cap → extension allow-list → declared MIME → **magic-byte sniff** → filename normalisation → SHA-256 → private storage under a non-guessable key → antivirus queue → `FileObject`. Step 4 is the one that matters: extension and declared type are both supplied by the uploader, the file's first bytes are not. An executable renamed `.pdf` dies there. |
| **Versioning** | A drawing is **never overwritten**. A correction is V+1 and the previous version is superseded but kept, downloadable, with its own report and verdict — a report that judged V1 is meaningless if V1 is gone. `drawing_one_active` makes two current versions impossible at the database. |
| **Private storage** | No public URL exists, by design. Every download re-checks capability and row scope, refuses anything the scanner has not cleared, and writes an audit row **before** a byte moves. |
| **Scrutiny provider** | One interface, three delivery styles — synchronous, polled, callback — all converging on a single `applyOutcome()`. `MockScrutinyProvider` ships; `HttpScrutinyProvider` is real. A test runs the whole path against a non-mock stub and asserts identical state, so "the architecture does not depend on the mock" is proven rather than claimed. |
| **Honesty guardrails** | `engineDriver` is recorded against every result forever; every mock report is watermarked *"DEMO SCRUTINY — NOT A COMPLIANCE CERTIFICATE"*; the mock **refuses to run in production** unless someone explicitly opted in. A mock PASS is not a compliance decision, and nothing lets it look like one. |
| **The correction loop** | Upload → scrutiny → fail → report → re-upload → V2 → scrutiny → pass. The same application throughout: a failure is a correction cycle, not a rejection. An engine **error** is never a verdict — the file returns to the drawing stage rather than being marked failed. |
| **Scrutiny UI** | Outcome banner, check tally, blocking issues separated from advisories, a plain-language remedy inside each finding, and the downloadable report. Polls only while a run is in flight. |
| **Configurable gate** | `applicationType.requiresScrutiny = false` skips the engine entirely and moves straight to documents. Configuration, not a code path. |

### BIM — the building information model

| | |
|---|---|
| **Model files** | The **BIM** tab, beside Drawings, takes the federated IFC model (`.ifc` / `.ifczip`, ISO 16739), discipline models, BCF clash sets, COBie and the BIM Execution Plan — through the same upload pipeline, versioned the same way (`bim_model_one_active`). |
| **Read from the bytes** | On upload the server reads the IFC itself (`src/server/bim/ifc.ts`): schema, model view definition, authoring tool, units, storeys and elevations, spaces, element counts, `IfcMapConversion` and the site's latitude/longitude. Those facts fill any particular the LTP left blank — never one they answered. |
| **Particulars** | Model identity (authoring, schema, MVD, LOD, classification, disciplines), georeferencing (EPSG CRS, datum, origin, true north), the model's own quantities and level schedule, a model-content checklist, coordination (clash detection, IFC validation), ISO 19650 information management and the answerable BIM manager. |
| **Reconciliation** | What the application declares beside what the model reports — plot, BUA, FAR floor area, FAR, coverage, height, floors, basements, units, four setbacks — each with a stated tolerance. Thirteen readiness checks in `src/lib/bim.ts`, shared by screen and server. |
| **Declaration and review** | The LTP declares a specific model; a new version or any changed particular withdraws it. A departmental desk (`CHECKLIST_REVIEW`) accepts the model or returns it with remarks the LTP sees. |
| **Existing files** | `npm run bim:backfill -- --apply` gives every application without one a georeferenced IFC4 model of its declared building and the particulars to go with it. Idempotent; `seed:demo` runs it at the end. |

### Phase 2 — LTP application management

| | |
|---|---|
| **Filing wizard** | Ten steps — applicant, owner, property, location, survey/plot, development, building, LTP declaration, review, submit. Per-step Zod schemas used three times: to validate the form, to validate the write, and to prove completeness at submission. |
| **Draft & resume** | "Next" validates and writes to the real tables. "Save draft" writes unvalidated input to `application_drafts.scratch`, plus a 20-second autosave — so a half-filled step survives a reload without a half-valid row reaching the register. Resume returns to the exact step. |
| **Application numbers** | `BP/2026/000001`, from the `application_number_format` setting and the type's `numberPrefix` — configurable, not hard-coded. Sequences are scoped per type and year, so `BP/2026/000001` and `LP/2026/000001` coexist. Allocated by a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the caller's transaction: duplicate-free under concurrency *and* gap-free on rollback, which a Postgres sequence is not. See [docs/02-data-model.md](docs/02-data-model.md) §D.4. |
| **Two identifiers** | The row is keyed on an opaque `uuid(7)`; the application number is the human reference. The number is sequential and therefore guessable, so **no read path accepts it** — every one takes the UUID with the caller's row scope merged into the query. |
| **Draft vs submitted** | A `DRAFT` may be incomplete and says so: columns required to file are **nullable**, and `NULL` means "not answered yet" rather than a placeholder `0` nobody typed. `SUBMITTED` requires all of them, re-derived from the persisted rows with a field-level reason for each one missing. |
| **Register** | Server-side search, status and bucket filters, type, zone, date range, allow-listed sorting, pagination. The URL is the state, so a filtered view is a link you can send. |
| **Application record** | Header (number, applicant, type, status, stage, SLA) and eleven tabs. Overview and Details are live; the other nine are declared, disabled, and each names the phase that delivers it. |
| **Timeline** | `application_events` — created, updated, submitted, append-only at the database. Separate from the audit trail: this is the story in plain language, that is hash-chained evidence. Phase 7 appends workflow events to the same table without a migration. |
| **Row scoping** | Every read merges `applicationScope(user)` **into** the query. An LTP's own files and nothing else; a foreign id and a missing id return the identical 404, so the endpoint cannot be used to enumerate. |
| **LTP dashboard** | Nine KPI tiles over real rows, each linking to the list it counted — both read `src/lib/application-buckets.ts`, so a tile and its list cannot disagree. |

### Phase 1 — identity, RBAC, shell

| | |
|---|---|
| **Auth** | Sign in / out, forgot / reset / change password, session refresh with token rotation. Argon2id hashing. Per-account lockout **and** email+IP rate limiting — two different controls: the limiter slows a spray across accounts, the lockout stops a grind against one. |
| **Three-layer authorization** | Edge middleware (cookie presence, redirect) → server page guard (capability, `/unauthorized`) → route wrapper (capability + 403). The middleware is deliberately the weakest: the Edge runtime has no database, so it cannot re-read role or account status. |
| **RBAC** | 11 roles, 48 capabilities, 242 grants. `src/lib/rbac-matrix.ts` is the single source, read by the seed, the tests and the admin UI — an integration test asserts the database matches it exactly. |
| **App shell** | Capability-filtered sidebar, breadcrumbs, profile menu, notification and search placeholders, responsive (rail above `lg`, drawer below). |
| **Design system** | 20 primitives on Radix + CVA, plus StatusBadge, KpiCard, DataTable, EmptyState, ErrorState, PageHeader. |
| **Dashboards** | Five role-specific shells. Admin figures are real; the rest show honest zeros rather than invented numbers. |
| **Admin** | User list, detail, create, edit, activate/deactivate, role reassignment, password reset, unlock. Roles, organisation and settings are readable. |

### Phase 0 — foundations

| | |
|---|---|
| **Config** | `src/server/config/env.ts` — Zod-parsed once at boot, fails fast naming every bad key. The only `process.env` reader, enforced by ESLint. Production guardrails refuse a sample `AUTH_SECRET`, local storage, demo mode, or an unacknowledged mock scrutiny driver. |
| **Database** | 66 tables, five migrations. Hand-written constraints add partial unique indexes, financial CHECK constraints and append-only triggers. |
| **Route wrapper** | `defineRoute` — session, capability, read-only role, rate limit, Zod body, Decimal-safe serialisation, error envelope, correlation id. A handler that forgets authorization cannot exist. |
| **Auth primitives** | Access JWT for identity only; role and capabilities re-read from the database every request, so suspending an account takes effect immediately. Argon2id hashing. Revocable session rows. |
| **Audit** | Transaction-aware, hash-chained, and append-only *at the database*. |
| **Outbox** | Events written inside the business transaction, drained by the worker. |
| **Job queue** | Postgres `FOR UPDATE SKIP LOCKED`, exponential backoff, dead-letter, idempotent enqueue. |
| **Worker** | Same image, different entrypoint, graceful shutdown, stale-lock recovery. |

## Three things worth knowing before you change anything

**1. History is append-only, and the database enforces it.**

`audit_logs`, `workflow_history` and `payment_transactions` carry a `BEFORE UPDATE OR DELETE` trigger that raises, and `payment_receipts` carries a narrower one that refuses DELETE and any UPDATE except to the rendered artefact's storage key. A trigger rather than `REVOKE`, because a trigger binds the table owner too and most deployments connect as the owner:

```
ERROR: audit_logs is append-only: UPDATE is not permitted on this table
HINT:  Corrections are recorded as new rows, never by editing history.
```

Audit rows are additionally hash-chained, so an out-of-band edit is detectable. A daily job walks the chain and shouts if it breaks.

**2. Sign-in tells you nothing about who has an account.**

A wrong password, an unknown email, a deactivated account and a locked account all
return the same message, and the unknown-account path still pays the Argon2 cost so
it cannot be identified by timing. Forgot-password always returns the same response
and creates nothing for an address that does not exist.

**3. Never invent a rule; default restrictively.**

Where the business has not specified something, the system does not guess. No invented statutory behaviour, fee rates, scrutiny regulations or approval powers. Undefined behaviour becomes configuration with the option that *cannot* wrongly approve an application or wrongly release money, and the gap is recorded in [`docs/10-open-questions.md`](docs/10-open-questions.md).

Three consequences you will meet in the code:

- **Scrutiny is mocked.** No real engine is confirmed and none is built here. `MockScrutinyProvider` sits behind a `ScrutinyProvider` interface; results record which driver produced them; the mock refuses to run in production unless explicitly permitted. A mock PASS is not a compliance decision.
- **An SLA that passes its date does nothing but notify.** It marks `OVERDUE` and tells the officer and a supervisor. The engine has no time-based transitions at all, so no clock can ever approve anything.
- **Any open shortfall blocks approval** — every kind, every mode, blocking and reported alike, with no override implemented anywhere.

## Layout

```
docs/            architecture, decisions, phase plan     ← read first
prisma/
  schema.prisma  63 tables, uuid(7) keys
  migrations/    init + hand-written constraints
  seed/          idempotent: rbac, org, users, settings, catalogue, workflow
src/app/
  (auth)/        login, forgot-password, reset-password
  (portal)/      authenticated shell: dashboard, profile, admin
  api/           route handlers
src/server/      server-only: config, http, auth, db, services, workflow, jobs, events
src/lib/         isomorphic: constants, rbac-matrix, schemas, navigation, status
src/components/  ui/ primitives · common/ composites · layout/ shell
src/features/    page-level composition — the only tier that fetches
worker/          worker entrypoint
tests/           unit/ + integration/ (e2e arrives with Playwright)
scripts/         smoke check, test-user cleanup
```

**Import boundary**, enforced by ESLint rather than by discipline: `src/lib` is importable by anything; `src/server` by nothing outside `src/server` and `src/app/api`; `src/components` never imports `src/server`. One stray import otherwise pulls the Prisma client — and the database URL — into a client bundle.

## Deployment

```bash
docker compose up -d --build       # app + worker + Postgres
```

Compose runs with `NODE_ENV=production`, so the guardrails apply; the local values it passes acknowledge them explicitly. A real deployment supplies secrets from its own store and should set a real scrutiny driver, or accept the mock deliberately.
