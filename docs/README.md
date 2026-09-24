# LAMS — LTP Approval Management System

Architecture and design documents, plus the decisions ratified against them.

> ### Restored, and out of date in three known ways
>
> These documents were deleted in commit `c70cf3e` and restored from
> `c70cf3e^` during BBAS Phase 1. They describe the system as designed, and
> three things have changed since they were written:
>
> 1. **Statuses and kinds are no longer native Postgres enums.** The SQLite
>    migration (`3c0e150`) turned every one into a `String` column. The
>    vocabulary now lives in `src/lib/status.ts`, which exports
>    `APPLICATION_STATUSES` in the enum's place.
> 2. **`prisma/migrations/` no longer exists.** It was deleted in the same
>    commit and was deliberately NOT restored: the schema is now applied with
>    `prisma db push` against a hosted Postgres. Anything these documents say
>    about `migrate deploy` or the constraints migration describes how it was
>    built, not how it is deployed today.
> 3. **There are two workflows, not one.** `BBAS_STANDARD`
>    (TPA → Planning Officer → ZDD → ZJD) is the default; the six-desk chain
>    `03-workflow.md` documents is retained as `BP_STANDARD`. See
>    `prisma/seed/workflow/`.
>
> The status line below is the ORIGINAL project's phase numbering and is
> unrelated to the BBAS phases. For where the BBAS work stands, see
> [PHASE-0-AUDIT.md](PHASE-0-AUDIT.md).

**Status: Phase 1 complete.** Foundations, identity, RBAC, the app shell, the design system and admin user management are built and verified — 124 tests green. Phase 2 (applications and the filing wizard) is next.

## Contents

| Doc | Sections | Contents |
|---|---|---|
| [00-architecture.md](00-architecture.md) | A, B | Recommended architecture, the six architectural rules, layering, runtime topology, technology decisions, 20-module list, dependency graph |
| [01-sitemap.md](01-sitemap.md) | C | 75 routes across LTP, officer, executive and admin portals; the application-detail tab matrix |
| [02-data-model.md](02-data-model.md) | D, E | ERD, 63 tables, the full Prisma schema, and the constraints Prisma cannot express |
| [03-workflow.md](03-workflow.md) | F, G | The state machine, stage and action catalogues, guards, effects, the full transition matrix, publish-time validation, concurrency |
| [04-rbac.md](04-rbac.md) | H | Three-layer authorization, row scope, 48 capabilities, the role matrix, enforcement points |
| [05-api.md](05-api.md) | I | Conventions, the full endpoint inventory, rate limits |
| [06-frontend.md](06-frontend.md) | J, K, L | Folder structure, design tokens, status colour map, four-tier component architecture, data-fetching patterns |
| [07-subsystems.md](07-subsystems.md) | M–R | Notification, fee, payment, document, audit and SLA architectures |
| [08-testing.md](08-testing.md) | S | Test distribution, the generated RBAC suite, the golden-path E2E journey |
| [09-delivery-plan.md](09-delivery-plan.md) | T | Eleven phases with exit criteria, ~20 weeks, demo seed plan, definition of done |
| [10-open-questions.md](10-open-questions.md) | — | Four ratified decisions, four remaining scope-changing ambiguities, and fifteen configuration questions with their defaults |

## The three ideas that matter most

1. **Workflow is data, not code.** Stages, actions, transitions, guards and effects are rows. `RAISE_FEE_SHORTFALL` and `REPORT_FEE_SHORTFALL_AND_FORWARD` — the distinction §12 and §13 are emphatic about — are two configuration rows with different effects, not two branches. No file outside the engine names a stage.

2. **A parked instance remembers where it came from.** `parkedStageId` plus the `RETURN_TO_ORIGIN` effect is what keeps "fee shortfall returns to LTP, then back to whoever raised it" out of the codebase. A shortfall raised at ZJD resumes at ZJD because the row says so, not because an `if` does.

3. **Every history is append-only, and the database enforces it.** Drawings, documents, demands, transitions and audit rows are never updated in place. A `BEFORE UPDATE OR DELETE` trigger on `audit_logs`, `workflow_history` and `payment_transactions` raises rather than permitting the write — chosen over `REVOKE` because a trigger binds the table owner too, and most deployments connect as the owner. Rows are additionally hash-chained, so an out-of-band edit is detectable.

## Read in this order

New to the project: `00` → `03` → `02` → `10`.
Reviewing for approval: `10` first — the open questions decide how much of the rest is settled.
Implementing: `09` for the phase, then the docs that phase names.

## Decisions ratified 25 Aug 2026

The four scope-setting questions are closed. Implementation proceeds on these:

| | Decision |
|---|---|
| **Scrutiny** | No real engine exists and none is built. `ScrutinyProvider` adapter + `MockScrutinyProvider` only; scrutiny domain tables persist from day one; the gate is configurable per application type; the architecture provably does not depend on the mock. |
| **SLA breach** | No legal effect, ever. Marks `OVERDUE`, notifies officer and supervisor, appears in reports. The engine has **no time-based transitions at all**. |
| **Open shortfalls** | `OPEN_SHORTFALLS > 0 → APPROVAL BLOCKED`, every kind, every mode, **no override implemented**. |
| **Scrutiny override** | Removed entirely. The only route past a failure is correct → new version → re-scrutiny. |

A sixth architectural rule was added alongside them: **never invent a rule; default restrictively.** No invented statutory behaviour, fee rates, scrutiny regulations or approval powers — undefined behaviour becomes configuration with the safe restrictive default, recorded in the open-questions document.

## Still open, and worth answering soon

Four items remain that change *what is built* rather than *how it is configured*:

- **S1 — Language.** English-only is assumed. If Telugu or Hindi is required, i18n must be designed into **Phase 1** — this is the only remaining item that is expensive to retrofit and whose phase is imminent.
- **S2 — Parallel review.** Strictly sequential today. Fork/join for concurrent departmental clearances is an engine addition; confirm before Phase 7.
- **S3 — Digital signature.** QR-verified orders today. A DSC or Aadhaar eSign integration is meaningful additional work not in the estimate.
- **S4 — Revision/renewal.** Out of scope, but two nullable columns added in Phase 2 avoid a migration over live data later.

Everything else has a working default and can be answered as its phase arrives.
