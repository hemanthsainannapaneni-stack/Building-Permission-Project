# T. Phase-wise Development Plan

Eleven phases. Each ends with the §43 checklist run in full — app runs, tests pass, database inspected, routes reachable, RBAC verified, UI reviewed, workflow exercised, **every error fixed** — before the next begins.

Estimates assume two full-time engineers. They are planning figures, not commitments.

---

## Phase 0 — Foundations · ~1 week · ✅ **COMPLETE (25 Aug 2026)**

Repository, tooling, `env.ts`, Docker Compose (Postgres + app + worker), Prisma schema from E, initial migration, `defineRoute`, error envelope, serialisation, audit service, settings service, job queue + worker loop, outbox, health endpoints, CI pipeline.

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| App runs against a migrated database | 63 tables, 2 migrations, `migrate status` clean |
| `/api/health/ready` green | Reports database, migrations, queue and outbox; 503s when a required check fails |
| CI runs lint, typecheck, tests | `npm run verify` green; 18 unit tests |
| Build succeeds | `next build` clean |
| Auth gate works | `/api/auth/me` returns 401 with no session and with a forged cookie |
| Security headers present | CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed |
| Foundations verified against a real database | `npm run smoke` — 10 checks pass |

**Three things came out of Phase 0 that were not in the plan:**

1. **The production guardrails initially fired during `next build`.** A build has no business needing real secrets. Fixed by skipping the guardrails when `NEXT_PHASE=phase-production-build` — they run when the server actually boots, which is the moment that matters.
2. **Append-only is enforced with a trigger, not `REVOKE`.** The design assumed a separate `lams_app` role. Most deployments connect as the table owner, and `REVOKE` does not bind the owner — a trigger does. Documented in the constraints migration, with the `REVOKE` statements kept as an additional hardening step for role-separated deployments.
3. **The documented table count was wrong.** The spec said 51; the schema has 63. Corrected in `02-data-model.md`.

**Also noted:** host Postgres port is **5433**, because the adjacent land allotment project holds 5432.

## Phase 1 — Identity, RBAC, shell · ~1.5 weeks · ✅ **COMPLETE (26 Aug 2026)**

Argon2id hashing, session + refresh with rotation, login/logout/forgot/reset/change, lockout and rate limiting, permission and role seeds (H.3, H.4), 11 demo users (§35), departments/offices/zones, `AppShell` with capability-filtered navigation, admin user management, design system.

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| All 11 demo accounts sign in | Verified live; each returns its role and the correct landing route |
| Navigation matches capabilities | Sidebar filtered by `visibleNav()`; later-phase items shown disabled with the phase named, so nothing reads as broken |
| RBAC enforced server-side | Admin API returns 403 for LTP, TPA, Commissioner and Viewer; 200 only for SYSTEM_ADMIN |
| Protected routes | Signed-out → 307 to `/login?next=…`; signed-in without capability → 307 to `/unauthorized` |
| Read-only role | Viewer refused on every write at the route wrapper, before the handler runs |
| User CRUD | Create (with generated password), update, role reassignment, activate/deactivate, reset, unlock — all against the real database |
| Tests pass | **124 tests**, 8 files: unit (password, tokens, RBAC matrix, audit chain) + integration (auth flow, seeded RBAC, user CRUD) |
| No type or lint errors | `npm run verify` clean |
| Migration + seed work | 63 tables on UUID keys; seed idempotent, 48 permissions · 11 roles · 242 grants |

**Three things Phase 1 turned up:**

1. **A real bug, caught by a test.** `updateUser` selected the user row *before* writing the role change, so a role reassignment returned the **old** role to the caller — the UI would have shown a stale role until refresh. Now re-read after the write.
2. **Rate limiting by IP alone was wrong.** Sign-in keyed on IP meant five bad attempts could lock out an entire office behind one NAT. Now keyed on **email + IP**, which stops a grind against one account without punishing everyone who shares an address.
3. **The Zod schemas were in the wrong place.** They lived under `src/server/schemas/`, and the import-boundary ESLint rule rejected the first client form that imported one. Schemas are shared *contracts*, not server code — they moved to `src/lib/schemas/`. The rule found the mistake, which is the case for having it.

**Also decided:** primary keys are now `uuid(7)` — time-sortable, so they keep the index locality that makes people reach for cuid.

## Phase 2 — Applications · ~1.5 weeks · ✅ **COMPLETE (26 Aug 2026)**

Application types, master data, number sequences, the filing wizard with per-step validation and autosave, application list with server-side search/filter/sort/paginate, the detail shell with header and tab bar, Overview and Details tabs, the application timeline, row scoping.

The `parentApplicationId` and `purpose` columns recommended by **S4** were already added in Phase 0 and remain unused, as intended.

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| An LTP creates a DRAFT and it appears with a number | Verified live; `BP/2026/000001` format from `{prefix}/{year}/{seq:6}` |
| LTP A cannot open LTP B's application by URL | 404 — and the *same* 404 as a genuinely missing id, so the endpoint cannot be used to enumerate |
| Number is unique under concurrency | 20 parallel creates → 20 distinct, gap-free numbers. Single-statement `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the caller's transaction |
| Wizard saves, resumes and validates | 10 steps; validated saves go to the real tables, unvalidated ones to `application_drafts.scratch`; resume returns to the exact step with partial input intact |
| Submission is guarded | Completeness re-derived from the persisted rows through the same step schemas — `completedSteps` is not consulted |
| List filters server-side | Search, status, bucket, type, zone, date range, sort allow-list, pagination — all in the database, all in the URL |
| KPI tiles match the lists they link to | Both read `src/lib/application-buckets.ts`; asserted by test |
| Tests pass | **257 tests**, 12 files (+133 this phase) |
| No type or lint errors | `npm run verify` clean; production build clean |
| Unknown routes return 404 | Verified against a production build, not dev — `tests/http/routes.test.ts` |

**Four things Phase 2 turned up:**

1. **The Phase 1 schema made a progressive wizard impossible.** `applicants.name`, `applicants.phone`, `property_details.district`, `.surveyNumbers` and `.plotAreaSqm` were `NOT NULL` with no default, but the wizard builds those rows a step at a time and several of those columns belong to *different* steps of the same table. They now carry defaults. A draft is incomplete by definition; completeness is enforced at SUBMIT, which is the moment it means something.
2. **The obvious number allocator races.** `SELECT current` then `UPDATE` hands two concurrent filings the same value. The unique index would catch it — after the applicant filled in ten steps. It is now one statement, inside the caller's transaction, so it is both duplicate-free and gap-free.
3. **`Object.fromEntries(searchParams)` silently drops filters.** It keeps only the *last* value of a repeated key, so `?status=DRAFT&status=SUBMITTED` filtered on one of them. The list query is parsed with `parseListQuery()`, which preserves repeats.
4. **A blank optional number field is not zero.** `z.coerce.number('')` is `0`, which would have plotted every unsurveyed site at latitude 0. Optional numbers go through `blankToNull()`.

**The cleanup pass turned up five more:**

5. **A 404 page was being served with HTTP 200.** Next streams the response, and a `loading.tsx` anywhere above a segment creates a Suspense boundary that lets the shell flush — committing the status line — before the query that decides whether the row exists has finished. The later `notFound()` then renders the right page and lies in its status. Fixed by deciding in `generateMetadata` (which resolves before the head is emitted) and confining the list's skeleton to a `(register)` route group so `[id]` has no boundary above it. `redirect()` had the same problem and was degrading to a `<meta refresh>`; it is now a real 307.
6. **`/admin/users/{unknown}` returned 500** — a Phase 1 route. `getUser()` signals "not found" with an `ApiError`, correct for an API route and wrong for a page, where unhandled it became the server reporting its own failure for a bad URL.
7. **`/admin/users/{valid-id}` returned 500 in production builds** — also Phase 1, and invisible in dev. `initials()` is a pure string function that lived in a `'use client'` module, so a server component could not call it. Moved to `src/lib/utils.ts`. Caught by the new HTTP suite the moment it existed.
8. **`npm run smoke` had been broken since the `cuid()` → `uuid(7)` decision**, and one of its checks was passing for the wrong reason — it inserted `'smoke_fee'` into a uuid column, so the statement died on the cast long before the `paid_not_over_total` CHECK was evaluated, and a bare `catch` counted that as proof the constraint works.
9. **Sentinel values were standing in for "not answered".** The first Phase 2 migration gave the mandatory columns defaults so the wizard could build rows a step at a time. `''` is defensible; `plotAreaSqm = 0` is not — that is a false claim, not an unmeasured plot, and nothing downstream could tell them apart. Those columns are now nullable, and nullability carries meaning: see docs/02-data-model.md §D.5.

**Also decided:** the timeline (`application_events`) is a separate table from `audit_logs`, not a view over it. They answer different questions for different readers — "what happened to my application" in plain language, versus hash-chained before/after evidence for an auditor. `type` is an open string so Phase 7 can append workflow events without a migration.

## Phase 3 — Files, drawings, scrutiny · ~2 weeks · ✅ **COMPLETE (27 Aug 2026)**

`FileObject`, the storage adapter, the full upload pipeline including magic-byte sniffing, audited downloads, the AV integration point, drawing versioning, the `ScrutinyProvider` interface, `MockScrutinyProvider`, a real `HttpScrutinyProvider`, scrutiny request/result/issue/report, the async jobs, the Drawings and Scrutiny tabs, the watermarked report, and the configurable scrutiny gate (F.8).

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| The §3 loop works end to end | V1 fails with a readable issue list, V2 fails, V3 passes — verified in the test suite *and* over real HTTP with the worker running |
| All versions remain downloadable with their own results | Superseded versions keep their file, their report and their verdict; asserted by test |
| Independence from the mock | The same path runs green against a stub provider with no change to any service, route, guard or component — `provider independence` in tests/integration/scrutiny.test.ts |
| The gate can be switched off per type | `requiresScrutiny = false` skips the engine and moves straight to documents; the drawing is still versioned and stored |
| A drawing is never overwritten | Enforced by the `drawing_one_active` partial unique index, not only by code — a test proves the database refuses a second active version |
| Uploads are validated on their BYTES | An executable renamed `.pdf` is refused by magic-byte sniffing, over HTTP as well as in unit tests |
| Files are private and audited | No public URL exists; every download re-checks scope, refuses unscanned files, and writes an audit row before any byte moves |
| A mock result cannot pass for a decision | `engineDriver` recorded per request; every mock report watermarked "DEMO SCRUTINY — NOT A COMPLIANCE CERTIFICATE"; the driver refuses to run in production without an explicit opt-in |
| Tests pass | **345 tests**, 15 files (+88 this phase) |
| No type or lint errors | `npm run verify` clean; production build clean |

**Five things Phase 3 turned up:**

1. **A shell heredoc silently corrupted a security regex.** The filename sanitiser was written through a shell heredoc, which mangled its character class into `[^@-^_^?"']` — a negated class that stripped lowercase letters, digits and dots, so `site-plan-v1.pdf` would have been reduced to almost nothing. ESLint spotted it indirectly, via an "unused eslint-disable directive" warning that only made sense if the regex was not what it looked like. Source files are no longer written through heredocs, and `safeFilename` now has regression tests.
2. **An engine error is not a verdict, and the difference had to be built in.** A run that ERRORs has not judged the drawing, so it returns the application to `DRAWING_UPLOADED` rather than `SCRUTINY_FAILED`. Marking it failed would tell an applicant to correct a drawing that may be perfectly correct.
3. **A date filter was timezone-inconsistent** — Phase 2 code, surfaced here only because the clock crossed midnight relative to UTC. `from`/`to` were parsed as UTC midnight while the window's end was computed in local time, so in UTC+5:30 a filter for "26 August" ran from 05:30 to 18:29 and an application created that evening was missing from a filter for its own creation date. Both ends are now local, with a regression test.
4. **The job queue's backoff made retries untestable** until the harness learned to fast-forward `runAt`. Without that, `drainJobs` silently skipped every retry and re-poll, and three tests passed for the wrong reason.
5. **`file_objects` rows outlive their applications by design** (P.6 — municipal records), which is right, but there is no retention job to sweep genuine orphans. A test run left 479 behind. Test teardown now cleans up after itself; the production sweep is Phase 11.

**Also decided:** scrutiny runs one request per ACTIVE drawing version, and the application status is the aggregate — derived from the latest run of every sheet rather than accumulated, so it is self-correcting whatever order results arrive in.

## Phase 4 — Documents · ~1 week · ✅ **COMPLETE (27 Aug 2026)**

Document types, conditional requirement rules, the derived checklist, upload and versioning, officer verification, the `documents_complete` computation, the Documents tab, the cross-application register, and the admin screens for types and rules.

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| Changing `numFloors` from 3 to 5 changes the required list | The structural stability certificate appears, and **only** it — the rest of the list is asserted unchanged. No rule edited, no migration, no administrator involved |
| Fee generation is unreachable while a mandatory document is missing | Refused with every outstanding document named; nothing written, status unmoved. Also refused when the missing document is one a *conditional* rule added |
| The gate is re-derived, never trusted | `documentsComplete()` rebuilds from the requirement rules; a test corrupts `applications.status` and the gate is still right |
| The checklist explains itself | Every conditional row carries a sentence — "the number of floors is at least 4 or the building height in metres is more than 15" — asserted whole, not by substring |
| A document is never overwritten | Versions supersede; V1 stays downloadable with its own verdict; the `document_one_active` partial unique index refuses a second active version |
| Uploads are validated on their BYTES | An executable renamed `.pdf` is refused; a `.dwg` is refused for a photo ID because a drawing belongs on the other tab |
| Verification moves the application both ways | Last document in → `DOCUMENTS_COMPLETED`; an officer rejection → back to `DOCUMENT_UPLOAD_PENDING`, with the reason on the timeline |
| Scope holds | An LTP cannot upload to, or fetch a version from, an application they did not file — the same 404 a missing id gets |
| Tests pass | **36 tests** in `tests/integration/documents.test.ts`, plus **15** for the admin service, **18** for the register and **16** for condition validation |

**Two things Phase 4 turned up:**

1. **Superseding a document erased the officer's verdict.** The upload path set `status: 'SUPERSEDED'` on whatever version was active, unconditionally — including one an officer had just REJECTED. The service's own comment promised the opposite ("V1 rejected — unsigned; V2 verified" rather than two indistinguishable rows), so the code contradicted its documentation, and the reason an applicant had been asked to upload again was overwritten by the act of their doing so. `isActive` now decides which version counts; `status` records what was decided about it, and a VERIFIED or REJECTED verdict survives.
2. **The "why is this required" sentence did not parse.** The label map was written as verb phrases where the describer needs noun phrases, so an applicant asked for a structural certificate was told "Required because the building has is at least 4 or the building height in metres is more than 15." Now noun phrases, and the test asserts the whole rendered sentence rather than a substring that would have passed either way.

**Also decided:** an uploaded document whose requirement stops applying — the building lost a floor — stays on the checklist marked "no longer required" rather than vanishing. Hiding a file somebody uploaded is how a system loses a document.

**The two surfaces that were outstanding are now built.**

**`/admin/document-types` — the catalogue and its rules.** This is the screen that makes a claim repeated throughout the documentation actually true: no document list is hard-coded, so a department changes a threshold without a migration or a deploy. `resolveRequirements()` reads these rows and nothing else, and until this page existed, exercising that meant editing the database by hand. An integration test lowers the structural-certificate threshold from four floors to three through the service and asserts that a *live* application's checklist changes with it.

Three things the screen has to get right, and does:

- **A rule is validated when it is SAVED, not when it runs.** The asymmetry is the point. The resolver treats a condition it cannot evaluate as not applying — correct, because one bad rule must not take the checklist down for every applicant — but the same forgiveness means a mistyped rule fails *silently*: the document is never asked for, nothing errors, and the omission surfaces months later as a file that reached an officer without a certificate it needed. `validateCondition()` refuses it at the point somebody writes it, and the editor will not save one the evaluator would choke on.
- **The editor reads the rule back in the applicant's own words.** JSON is not a language anybody proofreads well, so the condition box previews live: "Required because the number of floors is at least 4." The preview uses the *same* label map as the applicant-facing checklist, asserted by test — an administrator must read the exact sentence the applicant will, not an approximation.
- **"Delete" means two different things, and the row says which before it is pressed.** A type nothing references is removed; one an applicant has uploaded against is archived, because those documents are municipal records and orphaning them would make an approved application unexplainable. Archiving deactivates the rules pointing at it, so the effect is visible in the rules list rather than inferred from an empty checklist. Restoring does *not* switch those rules back on by itself.

**`/documents` — the register.** The Documents *tab* answers "what does this application still need"; the register answers the officer's question instead — "what is waiting for me across every file I am responsible for" — which is why a verification desk is a queue rather than a tour of applications one at a time. Server-side search, filters, sorting and pagination, with the row scope merged into the query so an LTP sees their own and a zonal officer sees their jurisdiction. The KPI tiles are asserted to agree with the lists they link to.

**One more bug, found by building them:**

3. **The row-scope fragment put a non-UUID sentinel into a UUID comparison.** `applicationScope()` returned `{ zoneId: { in: ['__none__'] } }` for a zonal officer holding no jurisdiction. Postgres failed the cast, so the officer's **application register answered 500** — a Phase 2 screen, reachable the moment an administrator creates a zonal account and forgets to assign its zone. It is now an empty `in`, which means the same thing and is type-correct: that officer sees nothing, which is the right answer, rather than an error page.

**Also cleaned up:** `isUuid` had accumulated five identical copies across the services. It is one function in `src/lib/utils.ts` now — a security-shaped regex maintained in five places is five chances for one to drift, and this codebase has already had a character class silently corrupted once.

## Phase 5 — Fees · ~1.5 weeks · ⚠️ **EXIT CRITERIA MET (27 Aug 2026) — the admin editor outstanding**

Fee structures, components, slabs, the calculator, the sandboxed expression evaluator, demand issue and freezing, the Fees tab with full breakdown.

**Exit criteria — all met:**

| Criterion | Evidence |
|---|---|
| The N.6 worked example computes to the rupee | **₹33,495.00** on a 300 m² plot with 620 m² built up — asserted as an exact string, and line by line: FLAT 1,000 · PER_UNIT_AREA 3,100 · SLAB 22,400 · PERCENTAGE-of-one 2,240 · PERCENTAGE-of-two 255 · FORMULA 4,500 |
| An issued demand is unchanged after the structure is edited | The application fee is tripled in place after issue; the demand keeps its total, its line amounts, its component *names* and its structure version. What the applicant is shown comes from the frozen rows, never a recalculation |
| The inputs are recorded beside the outputs | `calculationInputs` on the demand and on the audit row — a demand is only explainable if what went in is kept next to what came out |
| One live demand per application | Refused by the status claim, and again by the `one_live_original_demand` partial unique index when the service is bypassed entirely. Three concurrent generations produce one demand |
| A demand is corrected by cancelling, never by editing | Cancellation needs a reason, returns the file to `DOCUMENTS_COMPLETED`, and leaves the cancelled demand in place with its reason. A demand with money against it cannot be cancelled — that is a refund, and Phase 6's problem |
| Clamps and conditional adjustments fire on the real schedule | Open-space contribution clamps 1,500 up to its 2,000 floor; the small-plot rebate applies at ≤100 m² and the high-rise surcharge from five floors, neither on an ordinary application |
| Nobody can mistake a demonstration rate for law | `isPlaceholder` is true on the seeded schedule and travels onto every demand raised under it |
| Tests pass | **23 new tests** in `tests/integration/fees.test.ts` |

**Also decided:** the preview persists nothing and is not offered beside an issued demand. A recalculated figure sitting next to an issued demand that says something different is how trust in the number is lost.

**Not delivered, and carried forward — the last outstanding piece of Phases 4 and 5:** the **admin fee-structure editor with live preview**. This is the more consequential of the outstanding admin surfaces. The seeded schedule is explicitly a placeholder (open question Q3), and the design says a department replaces it by publishing a **new version** with a later `effectiveFrom` — never by editing the live one, because demands already issued under it become unexplainable. Everything that makes that safe exists in the data model and the calculator; the screen that would let an administrator do it correctly does not. Until it is built, a schedule change means a hand-written migration, which is precisely the operation most likely to be done the wrong way round.

## The audit chain — a Phase 0 defect the phase gate found

`npm run smoke` failed on the hash chain, and the cause was two defects in the Phase 0 audit service that had been live since Phase 2.

1. **Appends raced.** `audit()` read the head row and then inserted, with nothing between the two steps, so two concurrent writers read the same head and both linked to it. 154 rows in the development database share a predecessor — and ten of them are concurrent `LOGIN_SUCCEEDED` rows, so this happened on ordinary traffic, not only under a test that parallelises on purpose. A chain that forks whenever two people act at the same moment is not tamper evidence; it is a column of hashes. Appends now take a **transaction-scoped advisory lock**, so reading the head and linking to it is one indivisible step. A caller that passes the bare client gets a transaction of its own rather than a silently unprotected append.

2. **The row hash could not be reproduced.** `before` and `after` are `jsonb`, so a value handed in as a `Date` was hashed *as a Date* — `canonical()` renders one as a bare ISO instant — and came back from the database as a string, which it renders quoted. The recomputed hash differed from the stored hash by two quote characters. `submittedAt`, `verifiedAt`, `issuedAt`, `expiresOn` and `dueDate` all reach audit payloads as Dates, so a large share of rows reported as tampered with. Payloads are now normalised to the representation the database will store, *before* the hash is taken. This is the worse of the two: a mechanism that cries wolf on ordinary rows makes the real signal unreadable.

Two supporting changes went with them. `audit_logs` gained a monotonic **`seq`**, because the walk was ordered by `occurredAt` and 22 rows already tie on that millisecond — two rows in the same millisecond can be walked in either order, which reports a break in a chain that is intact. And verification now runs from a recorded **anchor**: rows written before the fix keep their unreproducible hashes, because the table is append-only and rewriting history so a verification passes is exactly what it exists to prevent. An operator is told "intact across N rows since seq X", never a bare "intact" covering rows nobody can vouch for. On a fresh deployment the anchor is 0 and the whole table is verified, which is the case that matters.

`tests/integration/audit-chain.test.ts` proves the fix: twenty simultaneous writers produce **no** new forks — not few, none, because one fork is one place where history cannot be shown to be unaltered.

## Phase 6 — Payments · ~1.5 weeks · **delivered**

Provider abstraction, mock gateway, initiate/verify/webhook/reconcile, idempotency, receipts and receipt PDFs, the payment and return pages, the reconciliation sweep, the finance view.

**Exit:** a payment succeeds and moves the application to `PENDING_TPA`; a failed payment provably does not move it; the same webhook delivered five times credits once.

**Exit criteria met.** `tests/integration/payments.test.ts` holds all three as named assertions, alongside retry, cancellation, an amount mismatch, an unplaceable callback, timeout, the sweep, and receipt generation and immutability. Four drivers ship — `mock`, `razorpay`, `payu`, `ccavenue` — and a test drives the whole path through a fourth stub that shares no code with the mock, asserting identical application state.

### Deviations from the O sketch, and why

**`PROCESSING` was added to `PaymentStatus`.** §4 names six states and the enum held five of them; `INITIATED` and `PENDING` were being asked to cover both "our row exists" and "the payer is at the gateway". They fail differently — an INITIATED payment the gateway never heard of can be abandoned, a PENDING one may yet be paid — so they are now distinct. It ships as its own migration, because Postgres refuses to use a new enum value in the transaction that added it and the next migration puts `PROCESSING` inside a partial index predicate.

**Receipts are HTML, not PDF.** The same reasoning as the scrutiny report: a PDF renderer is a dependency decision rather than something to slip in. What ships is a self-contained, print-ready document that opens anywhere and prints to PDF from any browser. Replacing `render()` changes nothing else — not the storage key, not the row, not the download route.

**`/payments/:id/verify` accepts `PAYMENT_RECONCILE` as well as `PAYMENT_INITIATE`.** The API sketch listed the latter alone, which would have shut finance out of the endpoint they need most: "did this actually go through?", asked with an applicant on the telephone. It is still not `PAYMENT_VIEW` — verification can settle a payment, and settling credits a demand.

### A defect this phase found in shared infrastructure

`toErrorResponse` matched `err instanceof ApiError`, and Next bundles server code into more than one layer: an error constructed by a module reached from a React Server Component fails `instanceof` against the route handler's copy of the same class. The payment drivers are cached on `globalThis`, so the driver a webhook route used had usually been constructed while a page rendered — and a forged-callback signature failure, which must be a 400, came back as a **500** on the one unauthenticated endpoint in the system that touches money. Reproduced deliberately: cold server → 400; render one page → 500.

`ApiError` now carries a `Symbol.for` brand and every boundary uses `isApiError` instead. The registry symbol is process-wide, so duplicate module instances still agree. Every page guard that mapped an error to a 404 had the same latent fault and was changed with it.

**Also fixed:** `/api/payments/webhook` had to join the middleware's public path list. A gateway has no session, so a 401 there would have broken every integration silently — the gateway retrying for hours while the department found out from an applicant. `tests/http/routes.test.ts` now pins both: the endpoint is reachable unauthenticated, and a forged payload is refused on its signature.

## Phase 7 — Workflow engine · ~2.5 weeks · **delivered**

The engine, guard registry, effect registry, `getWorkflowState`, transition execution with row locking and stale-write detection, tasks with claim/release/reassign, history, the full G seed, the officer task queue, the action bar and action modal, the workflow tab, SLA clocks with a sweep, and the graph validator that gates publishing.

**Exit:** an application walks TPA → ZAD → ZJD → Director → AC → Commissioner → Approved with correct statuses and tasks at every step. Every row of the G matrix has a passing integration test.

**Exit criteria met.** `tests/integration/workflow.test.ts` (49 assertions) drives every seeded transition from the stage it leaves, by a role that owns it, and checks the resulting stage, status, task, SLA, history row, audit row, outbox event and shortfall. The full six-desk journey is one test; every blocking-shortfall desk and every reported-shortfall desk are two more that loop over the configuration rather than restating it, so a transition added to the seed is exercised without the test changing.

**Shortfalls arrived with it, not after it.** The plan separated them into Phase 8, but the split is not real: raising one is an EFFECT of a transition, the park/resume loop is `parkedStageId` plus `RETURN_TO_ORIGIN`, and the approval guard is the reason the engine exists. Building the engine without them would have meant building an engine that could not be tested against its own most important rule. What Phase 8 keeps is the cross-application shortfall queue at `/shortfalls` and the LTP-facing response screens; the mechanism is done.

### Deviations from the F and G sketch, and why

**An answered shortfall returns to the officer's desk, not to the applicant's stage.** G.3 rows 11–13 leave the file at `LTP_SHORTFALL_ACTION` for the officer to accept it from there. It is seeded the other way: `RESUBMIT` carries the file back to the parked stage (`RETURN_TO_ORIGIN`) with status `SHORTFALL_RESPONDED`, and the officer accepts or rejects from their own stage. The reason is the task queue — a task belongs to a stage and the stage's owner roles decide whose inbox it appears in, so an answer left at the applicant's stage would sit in an inbox addressed to the applicant, and the officer waiting for it would never see it arrive. The engine behaves identically either way; this is the arrangement that produces a working inbox.

**`RESOLVE_REPORTED_SHORTFALL` was added, and the test suite is what found the need.** A REPORTED shortfall never parks the file, so it has no parked stage to return to and no `RESUBMIT` to answer it — and since an open shortfall of *either* mode blocks approval absolutely, a file carrying one could never have been approved. The applicant settles it by paying the demand or supplying the document; whichever officer holds the file then records that it is settled. Every review desk is seeded with it.

**Three application statuses were added.** `RETURNED_TO_APPLICANT`, `SHORTFALL_RESPONDED` and `COMMISSIONER_SHORTFALL`. The first two are the parked states the model above needs; the third closes a gap in the enum — G.3 row 16 had the Commissioner's shortfall setting the status to `COMMISSIONER_REVIEW`, which would have read as "with the Commissioner" while the file sat with the applicant.

**A transition may leave the file where it is.** Accepting a response or closing a reported shortfall is not a movement, so a same-stage transition keeps the existing task rather than completing one and opening an identical one. Without that, settling a shortfall would reset the SLA clock, empty and refill an officer's inbox, and tell the queue the file had just arrived.

**`workflow_assignments` was added to the schema.** The data model had no table saying WHO a stage's work goes to, so the engine would have had to decide — and a stage-to-role map in code is exactly the hard-coding this phase exists to avoid. The table holds routing rules per (stage, role, zone) with a strategy (`ROLE_QUEUE`, `DIRECT`, `LEAST_LOADED`, `ROUND_ROBIN`) and the priority to stamp on the task, and the most specific active rule wins.

**Guards are of two kinds, and the difference is visible.** A failing READINESS guard leaves the action on screen, disabled, with its reason — "Approve · 2 shortfalls are still open" tells an officer what to do next. A failing APPLICABILITY guard (`shortfall_awaiting_review`, `reported_shortfall_open`) hides the action entirely, because a permanently disabled "Close reported shortfall" on every file that never had one is furniture, and furniture teaches people to stop reading the action bar.

### A defect this phase found in payments

**A shortfall demand could never be paid.** `canPayFrom()` gated payment on the application's status being in the LTP payment window, with a comment saying a further amount "is a shortfall demand, which is Phase 8's". Phase 8's demand now exists — raised by an officer with the file at their desk, so the application is at `ZJD_FEE_SHORTFALL` when the applicant comes to pay. The gate now takes the demand TYPE: the ORIGINAL is payable only in the LTP window, a SHORTFALL or REVISION whenever the file is live. Without the fix, §12's "the LTP pays the shortfall and the file resumes" was a dead end, and the integration test that walks it is what surfaced that.

**The per-application audit tab shipped with it.** The plan put the audit view in Phase 10, but an officer deciding a file needs to see what was done to it and by whom — the requirement lists it among what the review screen must show. `/applications/:id?tab=audit` renders the hash-chained rows with their before and after values, as data rather than prose: the moment an evidence screen starts paraphrasing it stops being evidence. What Phase 10 keeps is the CROSS-application audit search at `/admin/audit` and the chain-verification report.

## Phase 8 — Shortfall register · ~0.5 weeks

What remains after Phase 7: the cross-application shortfall queue at `/shortfalls`, the applicant's dedicated response screen with attachments, and shortfall reporting.

**Exit:** an officer can see every shortfall they have raised across applications, and an applicant can answer one without going through the workflow tab.

## Phase 9 — Notifications, SLA, approval · ~2 weeks

Templates for all 22 events across three channels, the outbox dispatcher, in-app/email/SMS adapters, preferences, the notification centre, SLA rules and holidays, the sweep with escalation, SLA badges, approval-order generation with PDF and public verification, order revocation.

**Exit:** every §25 event delivers on every configured channel and is visible in the delivery log; an overdue task notifies its officer and supervisor; an approval order downloads and verifies at its public URL.

## Phase 10 — Reporting, analytics, admin completion · ~2 weeks

All 11 reports with filters and export, the three dashboards, the six executive analytics pages, and the remaining admin screens (scrutiny rules, integrations, master data, jobs monitor, system settings).

**Exit:** all 75 routes in C are reachable, none is a placeholder, and every dashboard number reconciles against a report.

## Phase 11 — Hardening and release · ~2 weeks

Security headers and CSP, the ZAP pass and remediation, k6 performance pass and index tuning, accessibility pass, the full E2E suite, the 24-application demo seed (§36), operational runbooks, backup and restore rehearsal, deployment.

**Exit:** **§44 is satisfied** — a tester completes the entire lifecycle without touching the database once.

---

## Timeline

| Phase | Weeks | Cumulative |
|---|---|---|
| 0 Foundations | 1.0 | 1.0 |
| 1 Identity & RBAC | 1.5 | 2.5 |
| 2 Applications | 1.5 | 4.0 |
| 3 Drawings & scrutiny | 2.0 | 6.0 |
| 4 Documents | 1.0 | 7.0 |
| 5 Fees | 1.5 | 8.5 |
| 6 Payments | 1.5 | 10.0 |
| 7 **Workflow engine** | 2.5 | 12.5 |
| 8 Shortfalls | 1.5 | 14.0 |
| 9 Notifications, SLA, approval | 2.0 | 16.0 |
| 10 Reporting & admin | 2.0 | 18.0 |
| 11 Hardening & release | 2.0 | **20.0** |

**~20 weeks / 5 months** for two engineers to a production-ready v1 on mock external services. Integrating a real payment gateway, a real SMS provider and a real scrutiny engine is additional and depends on procurement — the adapters exist from Phase 3 onward, so each is days of work once credentials and specifications arrive.

## Sequencing rationale

- **RBAC lands in Phase 1, not at the end.** Retrofitting authorization is how systems ship with holes. From Phase 1 the RBAC suite is a permanent gate.
- **The workflow engine lands in Phase 7, not Phase 1.** It needs documents, fees and payments to exist to have anything meaningful to guard. Building it first means building it twice.
- **Shortfalls follow the engine immediately.** They are the engine's hardest consumer, and building them straight after proves the effect/parking design while it is fresh.
- **Notifications wait until Phase 9** because every event they carry must already exist. Building templates for events that are not yet emitted produces untested templates.

## Demo seed (§36)

24 applications, deterministic (fixed seed), all reached by driving the real services (S.8):

| State | Count |
|---|---|
| DRAFT | 2 |
| Scrutiny failed (V1 or V2 pending correction) | 2 |
| Scrutiny passed, documents pending | 2 |
| Documents complete, fee generated, unpaid | 2 |
| Payment failed | 1 |
| At TPA | 2 |
| TPA document shortfall (open) | 1 |
| At ZAD/ZDD | 2 |
| At ZJD | 2 |
| ZJD fee shortfall — blocking | 1 |
| ZJD fee shortfall — reported and forwarded | 1 |
| At Director-DP | 2 |
| At Additional Commissioner | 1 |
| At Commissioner | 1 |
| Approved with order | 1 |
| Rejected | 1 |
| **Total** | **24** |

Each carries realistic applicant details, survey and plot numbers, drawing versions, documents, fee demands, payments, workflow history, notifications and audit rows. Demo mode shows a persistent banner and demo accounts use a single configurable password from `DEMO_PASSWORD`.

## Definition of done (§44)

A tester, given only the eleven demo logins, can complete: create → drawing → scrutiny fail → re-upload → pass → documents → fee → payment → TPA → shortfall → resolution → ZAD → ZJD → Director → Additional Commissioner → Commissioner → approval → order → notifications → audit trail → reports.

Without editing a single database record.
