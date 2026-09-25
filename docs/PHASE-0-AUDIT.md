# BBAS — Phase 0 Repository Audit

**Date:** 2026-09-11
**Branch:** `main` @ `9fba910`
**Scope:** Compare the existing BBAS implementation against the BBAS master brief and the four BBAS manuals (LTP workflow, TPA user manual, ZDD user manual, JD portal workflow report).
**Verdict:** BBAS is a genuinely mature, data-driven platform. The BBAS brief is an **extension**, not a rebuild. Roughly 40% of the brief already exists in some form; the remaining 60% is new modules that the existing engine, schema conventions and UI kit can carry without architectural change.

---

## 0. What was measured

| Measure | Value |
|---|---|
| Prisma models | 66 |
| Live database | Supabase PostgreSQL (`aws-0-ap-southeast-1.pooler`, pgbouncer) |
| Applications in DB | **263** |
| Users / workflow tasks | 20 / 352 |
| Shortfalls / approval orders / payments | 35 / 26 / 116 |
| Audit log rows (hash-chained) | 6,385 |
| Workflow stages (default workflow) | 13 |
| Workflow actions / guards / effects | 15 / 12 / 8 |
| Roles / capabilities | 11 / 46 |
| Application-detail tabs | 11 declared, 10 live |
| Sidebar items | 8 |
| `npm run typecheck` | **47 errors across 20 files** |
| `npm run lint` | **32 errors, 24 warnings** |
| `npm run test` | **script does not exist**; `tests/` deleted |
| `npm run demo:verify` | ~40 reconciliation checks pass, then crashes on a SQLite leftover |

---

## A. Existing and complete

These are production-quality and should be treated as fixed foundations.

1. **Data-driven workflow engine** — `src/server/workflow/`. Routing lives entirely in `workflow_transitions` rows: `(stage, status?, action, role) → (stage, status) + guards + effects`. `src/lib/workflow.ts` holds only the *alphabet* (action codes, guard names, effect names); no component hard-codes a hierarchy. `WorkflowInstance.parkedStageId` already implements "return to applicant, then back to whoever raised it". Workflow version is pinned per instance so config edits never corrupt in-flight files.
2. **Hash-chained audit trail** — `audit_logs` with `prevHash`/`rowHash`/`seq`, append-only, plus a Postgres advisory lock around chain append (uncommitted change in `src/server/services/audit.ts`).
3. **RBAC** — 46 capabilities × 11 roles in `src/lib/rbac-matrix.ts`, re-synced by the seed (grants removed from the matrix are *revoked*, not left behind). Server re-derives permissions per request; nav filtering is chrome-only.
4. **Application timeline vs audit separation** — `application_events` (human narrative, gap-free per-application sequence) is deliberately distinct from `audit_logs` (tamper evidence). Exactly the split the brief's §AR and §AU want.
5. **Document & drawing versioning** — `document_versions` / `drawing_versions`, append-only, one active version enforced by partial unique index.
6. **Fee engine** — `FeeStructure → FeeComponent → FeeSlab → FeeRule`, expression evaluator (`src/lib/fee-expression.ts`, a parser not `eval`), `ApplicationFee` + `FeeLineItem` itemisation.
7. **Payment abstraction** — provider interface with `mock`, `razorpay`, `payu`, `ccavenue` drivers; `PaymentTransaction` (append-only), `PaymentWebhookEvent` (dedupe key kills double-credit), `PaymentReceipt` with frozen snapshot, `Refund`.
8. **Shortfall engine** — `src/server/shortfalls/` (~1,600 lines). Full lifecycle `RAISED → NOTIFIED → ACTION_REQUIRED → RESOLUTION_SUBMITTED → UNDER_REVIEW → RESOLVED/RESOLUTION_REJECTED`, BLOCKING vs REPORTED modes, `ShortfallResolution` append-only with `attemptNo` — **multi-cycle history already exists at the data layer**.
9. **SLA subsystem** — `SlaRule` / `SlaInstance` / `Holiday`, working-day calendar, warn-at-percent, escalation role, pause-on-shortfall. Deliberately no deemed approval (matches brief §AT).
10. **Notification engine** — outbox pattern (`OutboxEvent` written inside the business transaction), templates, per-user channel preferences, in-app/email/SMS adapters, delivery logs, notification centre + bell.
11. **Dashboards** — six role-aware dashboards from one route, every number from `src/server/services/analytics.ts`, scoped per user. Sections already named *Caseload*, *Attention & SLA*, *Revenue & Finance*, *Department Review Desks*, *Recent Activity* — exactly the brief's §H.
12. **Reconciliation harness** — `scripts/verify-demo.ts` (`npm run demo:verify`) answers the dashboard's questions by a *different* query route and fails on divergence. This is precisely the brief's §AX requirement and it already passes on 263 applications.
13. **Demo seed architecture** — `prisma/seed/demo/` walks the **real services and real workflow engine** to 70 planned resting states; a state the engine cannot produce fails the seed loudly. `plan.ts` is a declarative stop-list. This is the single most valuable asset for §AV.
14. **UI kit** — 20 Radix-based primitives, `DataTable` (TanStack), `StatusBadge` with a single status→tone map (`src/lib/status.ts`), `KpiCard`, `PageHeader`, `EmptyState`, `ConfirmDialog`, `Drawer`, skeletons, breadcrumbs.

---

## B. Partially implemented

| Brief item | What exists | What is missing |
|---|---|---|
| **§E Workflow hierarchy** | TPA → ZAD/ZDD → ZJD → Director DP → Addl Commissioner → Commissioner, seeded and live | The BBAS default (TPA → **Planning Officer** → ZDD → ZJD). No `PLANNING_OFFICER` role or stage exists. ZDD is currently fused with ZAD in one stage (`ZAD_ZDD_REVIEW`). |
| **§K General Information** | district, mandal, village, ward, street, survey numbers, plot no, layout name, land use zone, tenure, lat/long | case type, permission type, nature of permission, application type (Private/Govt/CRDA), LPS vs non-LPS, gram panchayat, township, sector, colony, nature of site, block no, D.No, R.S.No, zoning district, proposed use/activity, abutting road status, **risk category** |
| **§L Applicant Information** | applicant, owner (same-as flag), aadhaar last-4, PAN masked, LTP declaration frozen at filing | developer block, structural engineer block, usage purpose (Self Use / Selling), professional licence validity display |
| **§M Plot Details** | plot area, road width, four boundary strings, land use zone | document area, ground area, road-widening deduction, green-buffer deduction, gift-deed surrender, **net plot area**, plot structure, compound wall, TDR, market value, IRR abutment, proximity constraints (religious/aerodrome/water body/railway/HT line/monument), typed boundary rows (type + plot/road/property + description) |
| **§O Document Checklist** | 15 document types seeded, requirement-rule engine (4 axes), verify/reject/remarks, versioning | BBAS-specific types (Land Pooling Ownership Certificate, Certificate of Supervision, Owner/Builder Affidavit, Mortgage Deed, CAR Insurance, Professional Appointment); **"Verify Primary"** batch action; `Shortfall` status on a document row |
| **§T Drawing / BIM** | drawings, versions, uploader, remarks, mock AutoDCR provider with issues + severity + `checksRun/checksPassed`, demo-watermarked report | `.rvt` is **not in `ALLOWED_UPLOAD_EXTENSIONS`**; no parameter-comparison table (Submitted vs Permitted vs Pass/Fail) for plot area / FSI / coverage / height / setbacks / parking / road width; no 3D viewer placeholder |
| **§V Fees** | full engine, itemised line items, demand statuses | BBAS fee heads (Development, Betterment, Publication, Infrastructure, Green, Labour Cess) not seeded as such; no **fee memo** document; no memo number/date |
| **§W Payments / CFMS** | mock gateway with success/failure paths, receipts, reconcile sweep, `/api/payments/reconcile` | challan number, CFMS reference, treasury status, reconciliation date; `RECONCILED` is not a payment status; no explicit "Mark Treasury Realized" action |
| **§AB Shortfall module** | engine + register + detail + banner; `attemptNo` gives cycle history | cycle *number* surfaced in UI, shortfall **letter PDF**, item-by-item applicant response/upload/reviewer verdict UI, register columns from the brief (response due, item count, response status, review status) |
| **§AD Letter / BPO** | `ApprovalOrder` model with order number, conditions, snapshot, storage key, verification code, revoke fields; `ensureApprovalOrder()` | no Letter tab, no draft-BPO preview, no DRAFT watermark, no PDF generation, no regenerate/print |
| **§AO Global search** | application number, owner name, phone, survey number, locality, plot number | proceeding number, outward number, developer, professional |
| **§AP Switch Desk** | working persona switcher in the topbar | hard-coded 6-persona array in `quick-persona-switcher.tsx`; **no Planning Officer, no ZDD**; re-logs in with a literal password; not DB-driven |
| **§AQ Tasks** | task queue, claim/release/reassign, 6 saved filters, priority, SLA | task *types* are implicit in the stage; no deep-link to a specific tab/action |

---

## C. Completely missing

Nothing in this list exists in any form today.

1. **Application Checklist (19 statutory questions)** — §N. No model, no UI. Distinct from the document checklist.
2. **Site Inspection module** — §Q. No inspection header, no 27-question checklist, no recommendation block.
3. **Geo-tagged inspection photographs** — §R. No photo model, no categories, no lat/long/capture metadata, no gallery.
4. **Sign & Submit (demo eSign / USB token)** — §S. No signature record, no signer/method/timestamp, no lock-after-submit.
5. **NOC module** — §U. `FIRE_NOC` exists only as a *document type*. No `Noc` entity, no authority/status/reference/expiry/verification, no NOC register or tab.
6. **Others tab** — §P. CAR insurance, mortgage deed, solar, rainwater harvesting, greening/tree planting, special remarks. No storage at all.
7. **Show Cause module** — §AC. Entirely absent and must be built as a separate proceeding, not a shortfall variant.
8. **Outward Register** — §AF. Absent.
9. **Revoke Proceeding** — §AG. `ApprovalOrder.revokedAt`/`revokeReason` columns exist but there is no initiation → review → decision → order → dispatch flow and no register.
10. **Change of Technical Professional** — §AH. Absent.
11. **Commencement / Work Initiated** — §AI. Absent.
12. **Occupancy module** — §AJ (completion intimation → occupancy submission → final inspection → as-built review → recommendation → OC). Absent.
13. **Developer Registration** — §AK. Absent.
14. **Professional Registration** — §AL. LTP licence fields live on `User`; there is no registration application, workflow, validity or renewal.
15. **Public portal** — §AM. `src/app/page.tsx` redirects to `/login`; there is deliberately no public surface. Public status search, fee payment, downloads, registration entry points all absent.
16. **Proceeding Issued register** — §AE. Approval orders exist; the register screen does not.
17. **Planning Officer desk** — §Y. No role, no stage, no queue.
18. **Post-approval and registration dashboard metrics** — §H. Nothing to count yet.

---

## D. Existing features to reuse (do **not** rebuild)

| Need | Reuse |
|---|---|
| Any new review step (PO, ZDD, ZJD) | Add `WorkflowStage` + `WorkflowTransition` rows. **Zero code.** |
| Any new officer action | Add a `WorkflowAction` row; add a `GUARDS`/`EFFECTS` entry only if the engine must reason differently. |
| Show Cause / Revoke / Change-Professional / Occupancy state machines | Model each as its own `Workflow` record (the schema already supports many workflows; `ApplicationType.workflowId` points at one). |
| Any new register screen | `DataTable` + `ApplicationFilters` + `StatusBadge` + `Pagination`. |
| Any new detail tab | `application-tabs.ts` is data — add a `TabDef`, point `panel` at a component. No routing change. |
| Any new status | One entry in `src/lib/status.ts`. |
| Any new document requirement | A `DocumentRequirement` row (4 axes + JSON condition). No code. |
| Any new fee head | A `FeeComponent` row with an expression. No code. |
| Any new notification | A `NotificationTemplate` row + an `OutboxEvent` emit. |
| Demo data for any new module | Extend `prisma/seed/demo/plan.ts` with new stops; `journey.ts` drives real services. |
| Reconciliation for any new metric | Add a check to `scripts/verify-demo.ts`. |
| Mock AutoDCR replacement later | `src/server/scrutiny/` already has a driver interface (`mock` / `http`). |

---

## E. Database changes required

All additive. No destructive migration is needed anywhere.

**New models (~18):**

- `ApplicationChecklistDefinition` (19 configurable questions: number, text, category, mandatory, risk indicator, response type) and `ApplicationChecklistResponse` (applicant answer, reviewer answer, verification status, remarks, supporting document, verified by/at).
- `SiteInspection` (inspection number, scheduled/actual date, inspector, officer, site address, lat/long, status, recommendation, remarks, signature ref, signed by/at, signature method), `SiteInspectionItem` (27 responses), `SiteInspectionPhoto` (category, lat/long, capture date/time, uploaded by, remarks, fileObjectId).
- `ApplicationNoc` (type, authority, required flag, status, application/reference number, applied/issued/expiry dates, uploaded NOC, verified by/at, remarks) + `NocAuthority` master.
- `ApplicationOthers` (CAR insurance, mortgage, solar, rainwater harvesting, greening, special remarks) — or a typed `Json` column on a new `application_others` table.
- `DrawingScrutinyParameter` (parameter, submitted value, permitted value, result) attached to `ScrutinyResult` — extends the existing scrutiny record rather than replacing it.
- `ShowCauseNotice` + `ShowCauseResponse`.
- `OutwardRecord` (outward number, document type, recipient, address, assigned/dispatch date, mode, tracking, delivery status, acknowledgement, document, remarks, status).
- `RevocationCase` (proceeding, reason, grounds, evidence, review, decision, order, outward link).
- `ProfessionalChangeRequest` (current/proposed professional, request letter, NOC, termination, indemnity, handover, decision) — **append, never overwrite** `Application.ltpUserId`; keep an `ApplicationProfessionalHistory` row.
- `Commencement` (proceeding, contractor, commencement date, notification date, site status, document).
- `OccupancyApplication` + `OccupancyInspection` + `OccupancyCertificate`.
- `DeveloperRegistration`, `ProfessionalRegistration` (+ shared `RegistrationDocument`).
- `TreasuryReconciliation` fields on `Payment` (challan number, CFMS reference, treasury status, reconciliation date) — columns, not a table.

**Extensions to existing models:**

- `PropertyDetail`: document area, ground area, road-widening/green-buffer/gift-deed deductions, **net plot area**, plot structure, compound wall, TDR flag + details, market value, IRR abutment, proximity flags, typed boundary rows (consider a `PlotBoundary` child model).
- `Application`: `caseType`, `permissionType`, `natureOfPermission`, `applicationType` (Private/Govt/CRDA), `isLps`, `riskCategory`, `proceedingNumber`.
- `Applicant`: developer block, structural engineer block, usage purpose.
- `ApprovalOrder`: `draftGeneratedAt`, `proceedingNumber`, `outwardId`.
- `ALLOWED_UPLOAD_EXTENSIONS`: add `rvt`.

**Note on the schema's current state:** the native Postgres enums were converted to `String` during the SQLite→Postgres migration (commit `3c0e150`). Statuses are now free text at the DB level, guarded only by TypeScript. This is workable for a demo but means a typo'd status will persist silently. Recommend keeping `String` for now (it makes additive status work cheap) and documenting it as a production item.

---

## F. Workflow configuration changes required

1. **Add `PLANNING_OFFICER`** to `ROLES`, `REVIEW_ROLES`, `ROLE_META` and `RBAC_MATRIX` (`src/lib/constants.ts`, `src/lib/rbac-matrix.ts`).
2. **Split `ZAD_ZDD_REVIEW`** into distinct `ZDD_REVIEW` (and keep `ZAD_REVIEW` for the legacy workflow) so ZDD is addressable on its own.
3. **Seed a second published workflow** `BBAS_STANDARD` v1 alongside the existing `STANDARD`:
   `LTP_DRAFT → LTP_BIM → LTP_DOCUMENTS → LTP_PAYMENT → TPA_REVIEW → PLANNING_OFFICER_REVIEW → ZDD_REVIEW → ZJD_REVIEW → CLOSED_APPROVED`, plus `LTP_SHORTFALL_ACTION`, `SHOW_CAUSE_ACTION`, `CLOSED_REJECTED`.
   Point the demo `ApplicationType` at it. **Keep the existing 10-stage workflow published and selectable** (brief §E) — it becomes the "extended hierarchy" configuration.
4. **New actions** (rows, plus guard/effect entries where the engine must reason): `ISSUE_SHOW_CAUSE`, `RESPOND_SHOW_CAUSE`, `CLOSE_SHOW_CAUSE`, `INITIATE_REVOCATION`, `APPROVE_REVOCATION`, `REJECT_REVOCATION`, `SUBMIT_INSPECTION`, `RECORD_NOC_VERIFICATION`, `ISSUE_PROCEEDING`, `DISPATCH_OUTWARD`, `NOTIFY_COMMENCEMENT`, `SUBMIT_OCCUPANCY`, `ISSUE_OCCUPANCY_CERTIFICATE`.
5. **New guards:** `checklist_complete`, `inspection_signed`, `nocs_verified`, `drawing_recommendation_recorded`, `treasury_reconciled`.
6. **New effects:** `GENERATE_DRAFT_BPO`, `ISSUE_PROCEEDING`, `CREATE_OUTWARD`, `REVOKE_ORDER`, `REASSIGN_PROFESSIONAL`.
7. **Stage labels** for every new stage in `STAGE_LABELS`.

The approval guard already refuses to approve with any open shortfall (`NO_OPEN_SHORTFALLS`, re-counted inside the transaction). Brief §BH.3 is therefore already satisfied and must not be weakened.

---

## G. UI and navigation changes required

1. **Sidebar** (`src/lib/navigation.ts`) — extend the flat 8-item list to the brief's §G structure. `NavSection` already supports grouping; add nesting for Scrutiny / Proceedings / Post Approval / Registrations. Every item keeps its `capabilities` gate.
2. **Application detail** (`application-tabs.ts`) — grow from 11 tabs to the brief's 15: Overview, General, Applicant, Plot, Application Checklist, Documents, Others, Site Inspection, Drawing/BIM, NOCs, Fees & Payments, Letter, Workflow, Proceedings, Audit. Retire `communications` (never built) or fold it into Workflow.
3. **Sticky header** on the detail page carrying application number, permission type, owner, project type, status, current desk, risk category, submission date, SLA and primary actions.
4. **Switch Desk** — replace the hard-coded persona array with a DB-driven list of demo accounts (one per role, including Planning Officer and ZDD), and show the active desk prominently.
5. **Public portal** — a new `(public)` route group with its own layout, visually distinct from the officer shell.
6. **Demo banner** — "Demo Environment — documents and approvals generated here are for demonstration only" (§BJ), on every generated document and the public portal.

---

## H. Repository health — must be fixed before Phase 1 lands code

Commit `c70cf3e` ("clean bloat") deleted the verification infrastructure. The brief's §BK references a baseline commit `5dccc07`, **which does not exist in this repository** (13 commits total, oldest `86e9946`) — so the deleted files must be recovered from `c70cf3e^` rather than from that hash.

| Problem | Evidence | Recommended action |
|---|---|---|
| `prisma/migrations/` deleted (18 migrations) | `git show --stat c70cf3e` | Schema is now managed by `db push` against Supabase. For a demo this is acceptable; **document it** and restore migrations only if a clean rebuild is needed. Do not spend Phase 1 on it. |
| `tests/` deleted; `npm run test` script absent | `npm run verify` and CI both call it | Restore a minimal vitest setup: `tests/stubs/server-only.ts` (referenced by `vitest.config.ts` and missing) + a small integration suite per new module. Proportional to a demo. |
| `docs/` deleted (11 files) | schema comments still cite `docs/02-data-model.md` | Low priority. This audit file re-establishes `docs/`. |
| `.github/workflows/ci.yml` cannot pass | fails at Lint, then `prisma migrate deploy` | Either fix or disable. Leaving a permanently red CI is worse than no CI. |
| **47 typecheck errors** | `npm run typecheck` | Mostly mechanical: Next 15 route handler `params` now a Promise (14 admin routes), `Button size="xs"` not in the variant union, `Checkbox onCheckedChange`, `Panel icon` prop, `ErrorBoundary` missing `override`. Fix before adding code, or new errors are invisible in the noise. |
| **32 lint errors** | `npm run lint` | Includes the five stray `test-*.mjs`/`test-*.js` files in the repo root. Delete those. |
| `next.config.ts` ignores lint **and** type errors during build | lines 41–46 | Keep for now (it is what unblocked Vercel), but restore once the 47 errors are cleared — otherwise a broken demo ships silently. |
| `scripts/verify-demo.ts:493` uses SQLite `datetime()` | `npm run demo:verify` crashes at the last check | One-line fix to `a."createdAt" - interval '1 second'`. Everything before it passes. |
| `/reports` added to `PUBLIC_PATHS` **and** its page swallows `redirect()` in a `try/catch` | `src/middleware.ts:24`, `src/app/(portal)/reports/page.tsx:27` | An unauthenticated visitor gets a raw stack-trace page instead of a login redirect. Remove `/reports` from `PUBLIC_PATHS` and remove the debug catch block. |
| Untracked root clutter | `output.html`, `run_seeds*.sh`, `test-*.mjs`, `test-browser.js`, `seed.log` | Delete or gitignore. |

---

## I. Blocking question — the exact checklist wording

**The four manuals do not contain the verbatim text of the 19-point application checklist or the 27-point site inspection checklist.** Both are described only in prose and shown in screenshots that carry no extractable text:

- TPA manual §5.5: *"Questions 1 to 10 covering ownership validity, encumbrance status, master plan zoning, and layout compliance… Questions 11 to 19 covering building height limits, setback clearances, structural safety, and seismic design standards"* (Figures 5.6, 5.7).
- TPA manual §5.8.1: *"Questions 1 to 12… actual site boundaries, road width on ground, encroachment status, high-tension power line proximity, natural water bodies… Questions 13 to 27… topography, existing structures, tree preservation, adherence to approved layout"* (Figures 5.11, 5.12).

Brief §N says the wording must be derived from the manuals and that unsupported statutory requirements must not be invented. I therefore cannot produce the exact 19 and 27 questions from what was supplied.

**Three ways forward — your call:**

1. **Supply the wording** — export Figures 5.6/5.7 and 5.11/5.12 as images, or paste the question text, and I will seed it verbatim.
2. **Build the structure, seed placeholder text** — ship `ApplicationChecklistDefinition` / `SiteInspectionItem` as *configurable data* with question text that is clearly marked provisional and editable from the admin screen. The demo is fully clickable; the wording is swapped in a single seed edit when the text arrives. **This is my recommendation** — it unblocks Phases 4 and 5 today and costs nothing to correct later.
3. **Derive from AP Building Rules 2017 / GO 119** — the manuals cite these as the source. I can draft questions from the categories named above, flagged as derived-not-verbatim.

Everything else in the brief can proceed without waiting on this.

---

## J. Recommended Phase 1 scope (for approval)

Per §BF/§BG, Phase 1 is **Workflow Alignment** only:

1. Add `PLANNING_OFFICER` role, capabilities, RBAC matrix entry, role metadata.
2. Split `ZDD_REVIEW` from `ZAD_ZDD_REVIEW`; add `PLANNING_OFFICER_REVIEW`.
3. Seed a second published workflow `BBAS_STANDARD` (TPA → PO → ZDD → ZJD) and make it the demo default; leave the existing 10-stage workflow published and selectable.
4. Add stage labels and statuses for the new desks.
5. Add demo users for Planning Officer and ZDD; make Switch Desk DB-driven and include them.
6. Re-run the demo journey so existing files distribute across the new desks; confirm `npm run demo:verify` still reconciles to 263.
7. Fix the repository-health items marked as blocking above (typecheck, lint, `/reports` exposure, `verify-demo` SQL, root clutter).

I will stop after Phase 1 and report before starting Phase 2, per §BG.

---

# BBAS — Phase 4 record

**Application checklist · Others · General information, applicant and plot.**

Phase 4 does not revisit the blocking question in §I. It builds on the answer
that was given to it — option 2, the recommendation: **the checklist structure
is data, and the wording is provisional until somebody supplies the real text.**

## What the wording still is

Nothing in Phase 4 claims any question is official BBAS text. The position is
unchanged from §I and is now enforced in four places rather than asserted in
one:

| Where | What it does |
|---|---|
| `checklist_item_definitions.isProvisional` | A column, true on all 19 + 27 rows |
| `prisma/seed/12-checklists.ts` | Seeds from the SUBJECT AREAS in §I and nothing else; refuses to overwrite a row whose flag has been cleared |
| The Checklist tab | A banner above the questions and a badge on each one |
| Settings → Checklists | Where the real text is typed in, and the flag cleared |

Replacing the wording remains a typing job: no migration, no deployment, no
code change. That was the whole reason for the recommendation and it still
holds.

## What was built

**The 19-point checklist, per application.** Each question carries a number, a
category, a mandatory flag, the applicant's response, the reviewer's response,
a status (Pending · Verified · Shortfall · Rejected · NA), remarks on both
sides, a supporting document, and a risk-relevance flag. The header states the
counts — 19 total, and how many verified, pending, in shortfall and NA.

**Three readers, three capabilities.** `CHECKLIST_RESPOND` (the LTP answers),
`CHECKLIST_REVIEW` (a desk verifies), `CHECKLIST_VIEW` (reads both). No role
holds both of the first two. See 04-rbac.md.

**Later reviewers cannot erase earlier ones**, and not by convention:
`checklist_review_entries` is append-only, the service contains no update or
delete against it, and the screen shows every entry with the desk it was made
at. A ZDD who disagrees with the TPA adds a finding; the TPA's stays.

**The Others tab** — mortgage, car insurance, solar, rainwater harvesting,
greening and trees, special remarks. The three-part required / proposed /
provided shape is kept apart wherever BBAS uses it, because the gap between
the three is the content: required-and-not-proposed is a shortfall waiting to
be raised, and required-proposed-not-provided is the ordinary state of a file
under consideration.

**The BBAS field set** — general information, the other parties, and the plot
arithmetic (document → ground → gross → deductions → net), with the six
proximity constraints and the four boundaries. `src/lib/bbas-fields.ts` is the
single place the manual's field names and this schema's column names appear
side by side; one field, one column, no duplicates.

## What Phase 4 deliberately did not do

* **The checklist is not a wizard step, and does not block filing.** It is
  answered again every time a desk returns the file, which a wizard step by
  definition is not. And nothing in the manuals says an unanswered checklist
  refuses an application — declining to accept a filing on the strength of a
  sentence this system wrote itself would be the wrong way round.
* **`irr` and `lpsStatus` are stored verbatim and not interpreted.** The
  manuals name both fields and expand neither. They are shown under the label
  BBAS gives them, exactly as entered.
* **Nothing recomputes a stored plot area.** A disagreement between the net
  area on file and the gross less the deductions is REPORTED to the officer.
  Silently restating a figure a demand was already raised against is the one
  thing that must not happen. See `src/lib/plot-area.ts`.
* Site inspection, NOC, show cause, outward, revoke, CTP, commencement,
  occupancy and registration remain out of scope, per the brief. The 27-point
  site inspection checklist has its definitions seeded and its machinery in
  place — `getApplicationChecklist(user, id, 'SITE_INSPECTION')` works — but no
  screen is wired to it.

## Two defects this phase found

| What | Where | Fix |
|---|---|---|
| A 19-question save exceeded Prisma's 5 s transaction default against the pooled remote database — 19 sequential `findUnique` calls, then 19 sequential writes, all inside the transaction | `application-checklist.ts`, found by the demo enrichment at full width | Existing rows prefetched in one read before the transaction opens; new rows written with one `createMany` using client-generated ids; history entries batched likewise; an explicit 30 s limit for a genuinely larger unit of work |
| A save where nothing changed still wrote a timeline event and an audit row | same | Both paths return early when no entry was produced. The screen posts the whole checklist on save, so this was the common case, and the timeline was reporting that something happened when nothing had |
