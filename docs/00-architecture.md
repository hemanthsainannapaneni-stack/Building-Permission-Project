# A. Recommended Architecture

**System name (working):** LAMS — LTP Approval Management System.

## A.1 Architectural style

**A modular monolith on Next.js 15 (App Router) + TypeScript, backed by PostgreSQL via Prisma, with an out-of-process worker for asynchronous work.**

Not microservices. Not NestJS (for now). The reasoning:

| Force | Consequence |
|---|---|
| One database, one transactional boundary. Approving an application must atomically write workflow history, status, audit and outbox rows. | A monolith gives this for free. Microservices would need sagas for no benefit. |
| Traffic is low and bursty (a municipal corporation, not a consumer app). Load is dominated by file I/O and PDF/scrutiny work, not request volume. | Vertical scale + a worker pool is sufficient for years. |
| The team already runs this exact stack in the adjacent *land allotment portal* (Next.js 15, Prisma 6, Postgres, Zod, TanStack Query, Recharts). | Conventions, review habits and deployment pipeline transfer directly. |
| Business logic must be callable from HTTP routes, cron sweeps, the worker and the seeder. | Logic lives in `src/server/services` and `src/server/workflow`, which import **no HTTP types**. The route layer is a thin adapter. |

**Escape hatch.** Because every domain service is HTTP-agnostic and reached only through its module's public `index.ts`, extracting the workflow engine or the scrutiny pipeline into a separate NestJS service later is a transport swap, not a rewrite. We are not painting ourselves in.

### When to reconsider

Move the scrutiny pipeline out of process (its own service) if drawing scrutiny exceeds ~60s per job or needs a non-Node runtime (most commercial DCR engines are Windows/.NET or Java). The `ScrutinyProvider` adapter is designed so this becomes an HTTP driver swap.

### A.1.1 Scrutiny: decided scope

*(Ratified 25 Aug 2026 — resolves former Q2.)*

**There is no confirmed external scrutiny engine, and this project does not build one.** No DXF/DWG geometry parsing, no rule engine over CAD, no statutory scrutiny formulas. That work, if it ever happens, is a separate programme.

What this project delivers instead:

| | |
|---|---|
| **`ScrutinyProvider` interface** | The integration boundary. Business code depends only on this. |
| **`MockScrutinyProvider`** | The only driver shipped. Produces realistic PASS/FAIL outcomes and issue lists so the whole lifecycle is testable end to end. |
| **Persistent scrutiny domain** | `scrutiny_rules`, `scrutiny_requests`, `scrutiny_results`, `scrutiny_issues`, `scrutiny_reports` are real tables from day one — a future real engine writes into a schema that already exists. |
| **Configurable gate** | Scrutiny is a workflow gate that can be turned off per application type. The pipeline does not assume it runs. |

**The architecture must not depend on the mock.** Concretely, that means: nothing outside `adapters/scrutiny/mock.ts` may know the mock exists; no test may assert mock-specific behaviour except the mock's own unit tests; and swapping `SCRUTINY_DRIVER=http` must require no change to any service, route, guard or component. This is verified by a test that runs the golden path against a stub HTTP provider.

The correction loop is unchanged and remains the only route past a failure:

```
SCRUTINY_FAILED → LTP correction → new drawing version → re-scrutiny
```

There is **no override**. See H.3.1.

## A.2 The six architectural rules

These are the invariants. Every review checks them.

1. **Workflow is data, not code.** No file outside `src/server/workflow/engine.ts` may branch on a stage code. Stages, actions, transitions, guards and effects are rows. Adding "Additional Commissioner may raise a shortfall" is a seed/admin change, never a deployment.
2. **The server is the only authority.** The browser renders what it is told is allowed; it never decides. Every mutation re-derives permission, stage ownership and row scope on the server. A hostile client with a valid session must not be able to advance an application it does not own.
3. **Everything external is an adapter.** Payment, SMS, email, storage, scrutiny and virus-scanning sit behind interfaces in `src/server/adapters/*`. Mock drivers are separate files selected by env. Business code never learns which driver is live.
4. **History is append-only.** Drawings, documents, fee demands, workflow steps and audit rows are never updated in place and never hard-deleted. Corrections create new versions.
5. **Money and state changes are transactional and idempotent.** Payment verification, webhook handling and workflow transitions are safe to replay. Every one has a natural idempotency key.
6. **Never invent a rule; default restrictively.** *(Ratified 25 Aug 2026.)* Where the business has not specified a rule, the system does not guess one. Specifically: no invented legal or statutory behaviour, no invented fee rates, no invented scrutiny regulations, no invented approval powers. Undefined behaviour becomes **configuration** with a **safe restrictive default** — the option that cannot wrongly approve an application or wrongly release money — and the gap is recorded in `10-open-questions.md`. A restrictive default that irritates a user is recoverable; a permissive default that approves something it should not is not.

### Rule 6 in practice

| Unknown | What we do **not** do | What we do |
|---|---|---|
| No statutory fee schedule supplied | Invent plausible rates | Ship a placeholder structure marked as such; the engine is complete, the numbers are the department's |
| No scrutiny rule set supplied | Encode setback/FAR formulas from another state's byelaws | Mock provider with configurable outcomes; rules, results and issues are stored so a real engine drops in later |
| Deemed-approval period unknown | Assume a common value like 30 days | No legal effect from SLA at all; breach notifies and nothing more |
| Override authority unspecified | Grant it to a senior role "reasonably" | Do not implement it. Absence is the restrictive default. |

## A.3 Layering

```
┌──────────────────────────────────────────────────────────────┐
│  Client — React Server Components + Client Components         │
│  TanStack Query · React Hook Form + Zod · Recharts            │
└───────────────────────────┬──────────────────────────────────┘
                            │ typed fetch / server actions
┌───────────────────────────▼──────────────────────────────────┐
│  Route layer  src/app/api/**  — thin                          │
│  defineRoute(): session · capability · rate limit · Zod ·     │
│  Decimal-safe serialisation · error shaping                   │
└───────────────────────────┬──────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────┐
│  Service layer  src/server/services/**                        │
│  Use cases. Owns transactions. Emits domain events.           │
│  applications · drawings · scrutiny · documents · fees ·      │
│  payments · shortfalls · approvals · reports · admin          │
└───────────────────────────┬──────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────┐
│  Domain layer  src/server/workflow · src/server/fees          │
│  Workflow engine · guard evaluator · effect executor ·        │
│  fee calculator · SLA calculator. Pure where possible.        │
└───────────────────────────┬──────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────┐
│  Data + adapters                                              │
│  Prisma → PostgreSQL  ·  storage · payment · sms · email ·    │
│  scrutiny · antivirus  ·  outbox → worker                     │
└──────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point downward only. A service may call the domain layer and adapters; the domain layer may not import a service; nothing below the route layer may import `next/server`.

## A.4 Runtime topology

```
                    ┌────────────────┐
   Browser ────────▶│  Next.js app   │◀──── Payment gateway webhook
                    │  (web + API)   │◀──── Scrutiny engine callback
                    └───┬────────┬───┘
                        │        │
          ┌─────────────▼──┐  ┌──▼────────────────┐
          │  PostgreSQL    │  │  Object storage   │
          │  + outbox      │  │  (S3-compatible,  │
          │  + job queue   │  │   private bucket) │
          └─────────▲──────┘  └───────────────────┘
                    │
          ┌─────────┴───────────────────────────────┐
          │  Worker process (same image, no HTTP)   │
          │  · notification outbox dispatch          │
          │  · scrutiny job submission + polling     │
          │  · payment reconciliation sweep          │
          │  · SLA recompute + escalation sweep      │
          │  · approval-order PDF rendering          │
          │  · antivirus scan dispatch               │
          └─────────┬───────────────────────────────┘
                    │
          ┌─────────▼──────┐  ┌──────────────┐  ┌─────────────┐
          │ SMS provider   │  │ SMTP / email │  │ AV scanner  │
          └────────────────┘  └──────────────┘  └─────────────┘
```

**Why a real worker and not only Vercel Cron.** Scrutiny can run for minutes, PDF rendering is CPU-heavy, and notification dispatch must retry with backoff. Serverless function timeouts make these unreliable. The worker is the same Docker image with a different entrypoint (`npm run worker`), so there is one build artifact.

**If deploying to Vercel** (as the land allotment portal does), run the worker on a small always-on host (Fly.io / Render / an ECS task) against the same database, and keep Vercel Cron only for the cheap sweeps. This is an ops choice; the code is identical.

### Queue

A `jobs` table in Postgres driven by `SELECT … FOR UPDATE SKIP LOCKED`, wrapped in a `JobQueue` interface. Postgres is already there, is transactional with the business write, and at this volume needs no Redis. If throughput ever demands it, swap the driver for pg-boss or BullMQ without touching call sites.

### Transactional outbox

Domain events are inserted **in the same transaction** as the business change:

```
BEGIN
  update application status
  insert workflow_history
  insert audit_log
  insert outbox_event ('SHORTFALL_RAISED', payload)
COMMIT
        │
        └──▶ worker picks up outbox_event ──▶ notification dispatcher ──▶ SMS / email / in-app
```

This is what guarantees §25's promise: an officer's action and the applicant's SMS cannot diverge. A notification failure retries; it never rolls back the officer's decision.

## A.5 Technology decisions

| Concern | Choice | Note |
|---|---|---|
| Framework | Next.js 15, App Router, React 19 | Matches sibling project |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` | |
| Styling | Tailwind CSS + shadcn/ui + Lucide | |
| Forms | React Hook Form + Zod resolver | One Zod schema shared by client and server |
| Server state | TanStack Query; TanStack Table for grids | |
| Charts | Recharts | |
| DB | PostgreSQL 16 | Pooled `DATABASE_URL` + `DIRECT_URL` for migrations |
| ORM | Prisma 6 | Native enums for engine-branching values; `String` for admin-extensible master data |
| Money | `Decimal(18,2)`, serialised to number at the API edge | Never float |
| Auth | Short-lived access JWT (`jose`) for identity + revocable DB session row | Role/capabilities re-read from DB every request |
| Passwords | Argon2id (`@node-rs/argon2`) | Upgrade over bcrypt; bcrypt acceptable if the platform blocks native modules |
| Files | S3-compatible, **private** bucket, signed short-lived URLs | Never public-read — see P |
| PDF | React-PDF or Puppeteer in the worker | Approval orders, receipts, scrutiny reports |
| Validation | Zod at every boundary | |
| Tests | Vitest + Testcontainers + Playwright | |
| Deploy | Docker (app + worker), or Vercel + external worker | |

## A.6 Configuration and secrets

`src/server/config/env.ts` parses `process.env` through a Zod schema **once**, at boot, and fails fast with a readable message listing every missing key. Nothing else in the codebase reads `process.env`. Client-visible values are limited to `NEXT_PUBLIC_*` and audited in review.

Two tiers of configuration, deliberately separated:

- **Environment** — secrets and infrastructure (DB URL, gateway keys, bucket credentials). Changed by ops, requires redeploy.
- **`system_settings` table** — business configuration (SLA days, demo mode, fee rounding rule, whether SLA pauses during shortfall). Changed by SYSTEM_ADMIN in the UI, takes effect immediately, and every change is audited.

If a rule was not given to us in writing, it goes in tier two. See `10-open-questions.md`.

---

# B. Complete Module List

Twenty modules. Each owns its tables, its service, its Zod schemas and its tests, and exposes a single public entry point.

## B.1 Platform modules

| # | Module | Owns | Public surface |
|---|---|---|---|
| 1 | **identity** | users, sessions, password resets, login attempts | `signIn`, `signOut`, `getAuthUser`, `resetPassword`, lockout policy |
| 2 | **rbac** | roles, permissions, role_permissions, user_roles | `can()`, `requireCapability()`, `scopeFor()`, matrix seeding |
| 3 | **org** | departments, offices, zones, user_jurisdictions | jurisdiction resolution for task routing |
| 4 | **audit** | audit_logs (append-only, hash-chained) | `audit()` — transaction-aware |
| 5 | **settings** | system_settings, master_data | typed cached accessor, invalidation on write |
| 6 | **files** | file_objects, storage adapter, AV scan | `store()`, `signedUrl()`, `scan()`, MIME/magic-byte validation |
| 7 | **jobs** | jobs table, worker loop, schedules | `enqueue()`, handler registry, backoff |
| 8 | **events** | outbox_events | `emit()` — transaction-aware |

## B.2 Domain modules

| # | Module | Owns | Public surface |
|---|---|---|---|
| 9 | **applications** | applications, applicants, property/building details, application_types, number sequences | `createDraft`, `updateSection`, `submit`, `scopeFor` |
| 10 | **drawings** | drawings, drawing_versions | `uploadVersion`, `listVersions`, `activeVersion` |
| 11 | **scrutiny** | scrutiny_requests/results/issues/reports, rules | `requestScrutiny`, `applyResult`, report generation |
| 12 | **documents** | document_types, requirement rules, application_documents, document_versions | `requiredFor`, `upload`, `verify`, `completeness` |
| 13 | **fees** | fee_structures, components, slabs, application_fees, fee_line_items | `calculate`, `issueDemand`, `issueShortfallDemand` |
| 14 | **payments** | payments, transactions, webhook events, receipts | `initiate`, `verify`, `handleWebhook`, `reconcile` |
| 15 | **workflow** | workflows, stages, actions, transitions, instances, tasks, history | `start`, `availableActions`, `perform`, `park`, `resume` |
| 16 | **shortfalls** | shortfalls, items, resolutions | `raise`, `respond`, `accept`, `reject` |
| 17 | **sla** | sla_rules, sla_instances, holiday calendar | `startClock`, `pause`, `recompute`, `overdueSweep` |
| 18 | **notifications** | templates, notifications, logs, preferences | `dispatch(event)`, channel adapters |
| 19 | **approvals** | approval_orders | `generateOrder`, `renderPdf`, `verifyOrder` |
| 20 | **reporting** | no tables — read models and materialised views | dashboard aggregates, 11 reports, CSV/XLSX export |

## B.3 Module dependency graph

```
                         settings ◀── (everything)
                         audit    ◀── (everything that mutates)
                         events   ◀── (everything that notifies)

  applications ──▶ drawings ──▶ scrutiny
       │                            │
       ├──▶ documents ◀─────────────┘  (scrutiny PASS unlocks documents)
       │        │
       │        ▼
       ├──▶ fees ──▶ payments
       │                 │
       │                 ▼
       └──▶ workflow ◀───┘  (payment success starts the department workflow)
                │
                ├──▶ shortfalls ──▶ documents | fees   (a shortfall targets one of these)
                ├──▶ sla
                ├──▶ notifications
                └──▶ approvals

  reporting reads everything, writes nothing.
```

**The one cycle to avoid:** `shortfalls` must not import `workflow` while `workflow` imports `shortfalls`. Resolved by making shortfall creation an *effect* the workflow engine executes (`RAISE_SHORTFALL`), and shortfall acceptance an *event* the workflow engine subscribes to (`SHORTFALL_ACCEPTED` → `resume`). The engine depends on the shortfall service; the shortfall service depends only on `events`.
