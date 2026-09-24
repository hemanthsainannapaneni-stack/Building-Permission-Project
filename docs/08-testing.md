# S. Testing Strategy

## S.1 Shape

Not a pyramid for its own sake. The distribution follows where this system can actually hurt someone: wrong money, wrong routing, wrong access.

```
        ╱ E2E — 8 journeys ╲            Playwright, real Postgres, mock adapters
      ╱───────────────────────╲
    ╱  API + RBAC — ~200 cases  ╲       Route handlers, real DB, table-driven
  ╱───────────────────────────────╲
╱  Integration — ~150 cases         ╲   Services + Prisma, Testcontainers
─────────────────────────────────────
   Unit — ~400 cases                    Pure logic: fees, guards, SLA, validators
```

## S.2 Unit — Vitest, no database

| Target | What is asserted |
|---|---|
| **Fee calculator** | Every basis. Slab boundaries (exactly at, one below, one above). Min/max clamping. Each rounding rule. Percentage referencing. Cyclic reference rejected. Empty structure. Zero-area application. |
| **Expression evaluator** | Whitelisted variables resolve; unknown variable rejected; `process`, `constructor`, `__proto__`, function calls and assignment all rejected; node-count and length caps enforced. |
| **SLA calculator** | Working-day counting across weekends, holiday runs, year boundaries, leap day. Pause/resume accumulation. `DUE_SOON` threshold. |
| **Guards** | Each of the nine predicates, true and false, at boundaries — e.g. `documents_complete` with one optional document missing (true) vs one mandatory missing (false). |
| **Status/format helpers** | Every status maps to a tone. INR formatting. Area formatting. |
| **Number allocation** | Format, year rollover, no gaps. |
| **Validators** | Filename normalisation against traversal (`../`, null bytes, unicode look-alikes). MIME/magic-byte agreement. |

## S.3 Integration — Testcontainers Postgres, real Prisma

A fresh migrated database per suite; each test in a transaction rolled back after.

- **Workflow engine** — every row of the G matrix executed and asserted: resulting stage, status, task, history row, SLA behaviour, effects applied.
- **Shortfall round trip** — raise blocking → parked at origin → LTP responds → officer rejects → responds again → accepted → **resumes at the raising stage**, which is the behaviour §9 and §12 hinge on.
- **Reported shortfall** — `REPORT_*_AND_FORWARD` advances the stage, leaves the shortfall open, and `APPROVE` is subsequently blocked by the guard.
- **Fee → payment → workflow** — demand issued, payment settled, application enters `TPA_REVIEW` exactly once.
- **Payment idempotency** — the same webhook delivered five times credits once. Return-page verify plus webhook race credits once.
- **Document completeness** — conditional requirements resolve correctly as building particulars change.
- **Drawing versioning** — three versions, one active, correct scrutiny linkage per version.
- **Audit chain** — hash chain verifies after a 50-action sequence.
- **Approval is blocked by any open shortfall (D3)** — parameterised across all four kinds × both modes: eight cases, each asserting `APPROVE` is unavailable, the POST returns 409, and no history row is written. Plus a race case: a shortfall opened between rendering the action bar and posting the approval still blocks, because the guard re-counts inside the transaction.
- **No override exists** — a negative test asserts that no route, capability or service method can approve past an open shortfall or pass a failed scrutiny. This is a test that something is *absent*, and it is deliberate: it fails loudly if anyone reintroduces a bypass.
- **Scrutiny driver independence (D1)** — the drawing → scrutiny → documents path runs twice, once against `MockScrutinyProvider` and once against a stub HTTP provider, asserting identical application state, statuses and history. Any service, guard, route or component that learns which driver is live fails this test.
- **Scrutiny gate off** — with `requiresScrutiny = false`, submission routes straight to documents and the rest of the lifecycle is unaffected.
- **SLA has no legal effect (D2)** — drive an application past its due date, run the sweep, and assert: status becomes `OVERDUE`, notifications are emitted, and the application's stage, workflow status and history are **byte-identical to before the sweep**. Reinforced by a structural test asserting the engine exposes no time-triggered transition path.
- **Concurrency** — two officers forwarding the same task simultaneously: one succeeds, one gets 409, one history row exists.

## S.4 API + RBAC

**The generated RBAC suite is the centrepiece.** It enumerates every `(role, endpoint, method)` triple from the route registry and asserts the result against the H.4 matrix:

- allowed → not 403
- denied → 403
- out of scope → 404 or 403, never a data leak
- `VIEWER` → 403 on every non-GET regardless of capability
- no session → 401 everywhere except declared public routes

An endpoint added without a matrix entry **fails the suite**. That is what keeps H.4 from decaying into a document that describes a system nobody built.

Plus per-endpoint contract tests: validation rejects malformed bodies with field-level messages; pagination is stable; `Decimal` serialises as a number; errors match the envelope.

## S.5 E2E — Playwright

Seeded database, mock adapters, `DEMO_MODE=true`.

**Journey 1 — the golden path of §42**, one test, no database editing at any point:

```
LTP signs in
  → creates an application, fills five wizard steps
  → uploads drawing V1            → scrutiny FAILS, report lists issues
  → uploads drawing V2            → scrutiny PASSES
  → sees the derived document checklist, uploads all mandatory documents
  → fee demand is generated automatically; breakdown is itemised
  → pays via the mock gateway     → receipt is issued
TPA signs in
  → sees the task in the queue, opens it
  → raises a DOCUMENT shortfall: "Structural Stability Certificate required"
LTP signs in
  → sees in-app notification and the shortfall
  → uploads the certificate, responds
TPA
  → reviews and accepts the resolution   → application resumes AT TPA
  → forwards
ZAD → forwards
ZJD → REPORTS a fee shortfall AND FORWARDS      (§12 — the non-blocking path)
Director → REPORTS a shortfall AND FORWARDS      (§13)
LTP → pays the shortfall demand
Additional Commissioner → forwards
Commissioner
  → sees the complete history, every remark, every version
  → approves
  → approval order is generated and downloadable
LTP → sees APPROVED, downloads the order
Auditor → opens the audit trail and finds every one of the above
```

Journeys 2–8: rejection at Commissioner; blocking fee shortfall at ZJD with return-to-origin; payment failure then retry; SLA going overdue and notifying (asserting no status change); admin edits a transition and the officer's action bar changes accordingly; RBAC negative walk (each role attempts a forbidden route); LTP scope isolation (LTP A cannot open LTP B's application by URL).

## S.6 Non-functional

| Kind | Approach |
|---|---|
| **Security** | `npm audit` + Semgrep in CI. Manual review of: upload pipeline, signed-URL issuance, expression evaluator, webhook signature verification, session handling. Authenticated ZAP baseline scan against a seeded instance. |
| **Performance** | k6 against list endpoints with 10k seeded applications. Budget: p95 < 400 ms for a filtered application list, < 800 ms for the detail aggregate. Every dashboard query has an `EXPLAIN` reviewed at Phase 8. |
| **Accessibility** | axe-core in Playwright on the twelve highest-traffic pages. WCAG 2.1 AA. Keyboard-only walkthrough of the golden path. |
| **Migration safety** | Every migration applied to a copy of seeded data in CI; rollback rehearsed for anything destructive. |

## S.7 CI gate

```
lint → typecheck → unit → integration → api+rbac → build → e2e → security scan
```

Nothing merges below **85% line coverage on `src/server`** — the layer where a bug costs money or misroutes a file. UI coverage is not chased for its own sake; the E2E journeys cover what matters there.

## S.8 Test data

One factory module (`tests/fixtures/`) builds applications at any stage by *driving the real services* — never by inserting rows directly. If the fixture can only reach `PENDING_ZJD` by performing the actual transitions, then the fixture itself proves the workflow works, and it can never drift into constructing a state the application cannot produce.


---

## The demo environment, and reconciling it

`npm run seed:demo` builds seventy applications by driving the real services and
the real workflow engine — `createApplication` → `saveStep` → `submitApplication`
→ `uploadDrawing` → `requestScrutiny` → `uploadDocument` → `generateFee` →
`initiatePayment` → a signed gateway callback → `performAction`, desk by desk.

That is slower than inserting rows and it is the point. **A state the system
cannot produce cannot appear in the demo.** An approved application with an open
shortfall is impossible because the `no_open_shortfalls` guard runs on the way
in; a file at `PENDING_ZJD` really did pass every guard between the payment gate
and that desk. The seed is therefore also a end-to-end exercise of the whole
product, and it fails loudly — on the application that needed it — if a
transition stops being reachable.

### `npm run demo:verify`

Thirty-nine checks that ask the database the same questions the dashboards ask,
**by a different route**, and exit non-zero when the answers differ.

The different route is the whole value. `analytics.ts` answers "how much was
collected" with one aggregate over settled payments; the verifier walks the
payments and adds them up. Two implementations of the same query would agree by
construction and would only be testing that Prisma can run a query twice.

Two families:

| | |
|---|---|
| **Consistency** | dashboard total = applications table · status breakdown sums to the total · stage distribution = applications carrying a stage · trend chart counts the same rows · collections = sum of settled payments · open shortfalls = unresolved shortfall rows |
| **Integrity** | no approved application with an open shortfall or an unpaid demand · no settled payment without a receipt · no application at two stages or holding two open tasks · no demand marked paid without a settled payment behind it · no `openShortfalls` counter disagreeing with its rows · nothing decided before it was filed |

### `tests/integration/analytics.test.ts`

The same properties as assertions, run in CI against whatever is in the
database. Every assertion is **relational rather than absolute** — parts sum to
wholes, scoped totals are less than or equal to unscoped ones, the tile equals
the register it links to — so the suite neither depends on the demo seed having
been run nor passes vacuously because it has.

The scope assertions are the ones worth reading: an LTP's total counts their own
files, a zonal officer's counts their jurisdiction, and the money, the
shortfalls and the activity feed are scoped too. Scoping the application count
and forgetting the payment aggregate would put the city's collections under one
zone's heading, and that is an authorization defect wearing a KPI tile.

### `tests/unit/demo-plan.test.ts`

Checks the plan before anything is seeded: that it totals 60–70, that every
`landsOn` is a real `ApplicationStatus` and every `stageCode` a real stage, that
every desk in the chain is represented, and that the generator is deterministic
for a given `DEMO_SEED`. All of that is knowable from the plan alone, so it is
knowable in milliseconds rather than sixty seconds into a seed run.
