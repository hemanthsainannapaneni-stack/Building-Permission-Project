# J. Folder Structure

```
lams/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│       ├── index.ts                 # orchestrator, idempotent, safe to re-run
│       ├── 01-permissions.ts        # capability catalogue (H.3)
│       ├── 02-roles.ts              # role → capability matrix (H.4)
│       ├── 03-org.ts                # departments, offices, zones
│       ├── 04-users.ts              # 11 demo accounts (§35)
│       ├── 05-master-data.ts        # land use, occupancy, structure type
│       ├── 06-workflow.ts           # stages, actions, transitions (F, G)
│       ├── 07-document-types.ts     # types + requirement rules
│       ├── 08-fee-structures.ts     # components, slabs
│       ├── 09-sla.ts                # SLA rules + holidays
│       ├── 10-templates.ts          # notification templates × 3 channels
│       ├── 11-scrutiny-rules.ts
│       └── 20-demo-applications.ts  # 24 applications across every state (§36)
│
├── src/
│   ├── app/
│   │   ├── (auth)/                  # login, forgot, reset, verify-order
│   │   ├── (portal)/
│   │   │   ├── layout.tsx           # AppShell: sidebar + topbar + breadcrumbs
│   │   │   ├── dashboard/           # role-switched at the server
│   │   │   ├── applications/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/
│   │   │   │   └── [id]/
│   │   │   │       ├── layout.tsx   # header + tab bar, fetched once
│   │   │   │       ├── page.tsx     # Overview
│   │   │   │       ├── details/ drawings/ scrutiny/ documents/
│   │   │   │       ├── fees/ payment/ receipts/
│   │   │   │       └── workflow/ shortfalls/ audit/ order/
│   │   │   ├── tasks/ shortfalls/ payments/ reports/ analytics/
│   │   │   ├── notifications/ profile/ help/
│   │   │   └── admin/               # 30 admin routes (C.5)
│   │   ├── api/                     # mirrors I.2 exactly
│   │   ├── layout.tsx
│   │   ├── error.tsx  not-found.tsx  global-error.tsx
│   │   └── globals.css
│   │
│   ├── server/                      # never imported by a client component
│   │   ├── config/env.ts            # Zod-parsed, fail-fast, the only process.env reader
│   │   ├── db/prisma.ts
│   │   ├── http/
│   │   │   ├── route.ts             # defineRoute
│   │   │   ├── errors.ts            # ApiError + typed constructors
│   │   │   ├── serialize.ts         # Decimal → number at the edge
│   │   │   └── rate-limit.ts
│   │   ├── auth/
│   │   │   ├── context.ts  session.ts  password.ts  tokens.ts  scope.ts
│   │   ├── workflow/
│   │   │   ├── engine.ts            # THE state machine — the only stage-aware file
│   │   │   ├── guards.ts            # named predicate registry
│   │   │   ├── effects.ts           # named effect registry
│   │   │   ├── actions.ts           # availableActions()
│   │   │   └── validate.ts          # G.4 publish-time validation
│   │   ├── fees/
│   │   │   ├── calculator.ts        # pure: (structure, context) → line items
│   │   │   ├── expression.ts        # sandboxed formula evaluator
│   │   │   └── rounding.ts
│   │   ├── sla/  calculator.ts  sweep.ts
│   │   ├── services/                # one file per domain module (B.2)
│   │   │   ├── applications.ts drawings.ts scrutiny.ts documents.ts
│   │   │   ├── fees.ts payments.ts shortfalls.ts approvals.ts
│   │   │   ├── notifications.ts reports.ts dashboard.ts
│   │   │   ├── audit.ts settings.ts users.ts numbering.ts
│   │   ├── adapters/
│   │   │   ├── storage/    { index.ts, s3.ts, local.ts }
│   │   │   ├── payment/    { index.ts, mock.ts, razorpay.ts }
│   │   │   ├── sms/        { index.ts, mock.ts, msg91.ts }
│   │   │   ├── email/      { index.ts, console.ts, smtp.ts }
│   │   │   ├── scrutiny/   { index.ts, mock.ts, http.ts }
│   │   │   └── antivirus/  { index.ts, noop.ts, clamav.ts }
│   │   ├── jobs/           { queue.ts, worker.ts, handlers/ }
│   │   ├── events/         { outbox.ts, dispatcher.ts }
│   │   └── pdf/            { order.tsx, receipt.tsx, scrutiny-report.tsx }
│   │
│   ├── components/
│   │   ├── ui/             # shadcn primitives — unmodified
│   │   ├── layout/         # AppShell, Sidebar, Topbar, Breadcrumb, PageHeader
│   │   ├── data/           # DataTable, FilterBar, SearchInput, Pagination, Export
│   │   ├── feedback/       # EmptyState, ErrorState, Skeletons, Toast, Confirm
│   │   ├── status/         # StatusBadge, SlaBadge, StageChip, SeverityDot
│   │   ├── files/          # DocumentUploader, FilePreview, FileVersionList, Dropzone
│   │   ├── workflow/       # WorkflowStepper, ActionBar, ActionModal, HistoryList
│   │   ├── application/    # Header, TabNav, Timeline, ShortfallCard, FeeBreakdown, PaymentCard
│   │   └── charts/         # Recharts wrappers with the shared theme
│   │
│   ├── features/           # page-level composition, colocated hooks + types
│   │   ├── applications/ drawings/ scrutiny/ documents/ fees/ payments/
│   │   ├── workflow/ shortfalls/ dashboard/ reports/ analytics/ admin/
│   │
│   ├── lib/                # isomorphic only — no server imports
│   │   ├── schemas/        # Zod contracts shared by forms AND routes
│   │   ├── rbac-matrix.ts  # THE permission matrix, read by seed + tests + UI
│   │   ├── navigation.ts   # sidebar as data, capability-filtered
│   │   ├── constants.ts    # ROLES, CAPABILITIES, STAGE_CODES
│   │   ├── format.ts       # currency (INR), dates, area, file size
│   │   ├── status.ts       # status → label, tone, icon
│   │   ├── api-client.ts   # typed fetch + error normalisation
│   │   └── query-keys.ts   # TanStack Query key factory
│   │
│   └── middleware.ts       # session presence, security headers, correlation id
│
├── worker/index.ts         # same image, different entrypoint
├── tests/
│   ├── unit/ integration/ api/ rbac/ workflow/ e2e/ fixtures/
├── docs/                   # this architecture
├── docker-compose.yml  Dockerfile  Dockerfile.worker
└── .env.example
```

**The rule that keeps this clean:** `src/lib` may be imported by anything; `src/server` may be imported by nothing outside `src/server` and `src/app/api`; `src/components` never imports `src/server`. Enforced by an ESLint `no-restricted-imports` rule, not by discipline.

---

# K. UI Design System

## K.1 Design intent

A caseworker looks at this screen for seven hours a day. An applicant sees it three times and needs to know what to do next. Both are served by the same thing: **density without noise**. §39 asks for restraint, and restraint here is a discipline, not a mood — every visual device must carry information.

Concretely: no gradient unless it encodes something, no card where a table row will do, no animation longer than 150 ms, no colour that is not in the token set, no icon without a label in a primary action.

## K.2 Tokens

```css
:root {
  /* Neutrals — the interface is 90% these */
  --bg:            #f7f8fa;   --surface:       #ffffff;
  --surface-sunk:  #f1f3f6;   --border:        #e2e5ea;
  --border-strong: #cbd1da;
  --text:          #14181f;   --text-muted:    #5a6472;
  --text-subtle:   #8b95a4;

  /* Brand — government-serious, not corporate-blue */
  --primary:       #1b4d8f;   --primary-hover: #16406f;
  --primary-subtle:#e8eef7;   --primary-text:  #ffffff;

  /* Status — fixed meanings, used nowhere decoratively */
  --neutral:  #5a6472;  --neutral-bg:  #eef0f3;   /* draft, closed        */
  --info:     #1b6fa8;  --info-bg:     #e6f1f9;   /* in progress, pending */
  --success:  #1a7f4b;  --success-bg:  #e6f4ec;   /* passed, paid, approved */
  --warning:  #a86a00;  --warning-bg:  #fdf1e0;   /* shortfall, due soon  */
  --danger:   #b3261e;  --danger-bg:   #fbeae9;   /* failed, overdue, rejected */
  --purple:   #6b4ea8;  --purple-bg:   #f0ecf8;   /* under approval       */

  --radius-sm: 4px; --radius: 6px; --radius-lg: 8px;   /* nothing rounder */
  --shadow-sm: 0 1px 2px rgb(20 24 31 / .06);
  --shadow:    0 2px 8px rgb(20 24 31 / .08);

  --space: 4px;  /* everything is a multiple */
}
```

Dark mode is defined as a token override under both `prefers-color-scheme` and `[data-theme="dark"]`, never as per-component overrides.

## K.3 Typography

| Role | Size / weight | Use |
|---|---|---|
| Display | 24 / 600 | Page titles only |
| H1 | 20 / 600 | Section headers |
| H2 | 16 / 600 | Card and panel headers |
| Body | 14 / 400 | Default |
| Body-strong | 14 / 500 | Labels, table headers |
| Small | 13 / 400 | Secondary metadata |
| Caption | 12 / 400 | Timestamps, helper text |
| Mono | 13 | Application numbers, receipt numbers, survey numbers |

One family: Inter (system fallback stack). Numbers use `font-variant-numeric: tabular-nums` in every table and every money field, so columns align.

## K.4 Status colour map

Status colour is **semantic and fixed**. A reviewer learns it once.

| Application status | Tone |
|---|---|
| `DRAFT` | neutral |
| `DRAWING_UPLOADED` `SCRUTINY_IN_PROGRESS` | info |
| `SCRUTINY_FAILED` `PAYMENT_FAILED` `REJECTED` | danger |
| `SCRUTINY_PASSED` `DOCUMENTS_COMPLETED` `PAYMENT_SUCCESSFUL` `APPROVED` | success |
| `DOCUMENT_UPLOAD_PENDING` `FEE_GENERATED` `PAYMENT_PENDING` | warning |
| `PENDING_*` | info |
| `*_REVIEW` | purple |
| `*_SHORTFALL` | warning |
| `WITHDRAWN` `LAPSED` | neutral |

| SLA | Tone |
|---|---|
| `ON_TRACK` | success |
| `DUE_SOON` | warning |
| `OVERDUE` | danger |
| `PAUSED` | neutral |
| `COMPLETED` | neutral |

Colour is never the only signal — every badge carries text, and severity dots carry a shape difference. That is what makes the interface usable for a colour-blind officer and is the baseline for the WCAG 2.1 AA target.

## K.5 Layout

- **Shell** 240 px sidebar (collapsible to 56 px icons) · 56 px topbar · content max-width 1440 px, gutters 24 px.
- **Grid** 12-column, 16 px gap. KPI rows are 4-up desktop, 2-up tablet, 1-up mobile.
- **Tables** 40 px rows, 12 px cell padding, sticky header, sticky first column on wide tables, horizontal scroll inside the table container — never the page.
- **Forms** single column at 640 px max. Two columns only for genuinely paired fields. Labels above inputs. Errors inline below, in words, never "Invalid input".
- **Responsive** the officer console targets ≥1280 px; the LTP portal must work on a phone, because an LTP will pay a demand from one.

## K.6 Interaction rules

- Every destructive or workflow-advancing action opens a confirmation carrying a plain-language summary of consequence: *"This forwards the application to ZJD. You will not be able to act on it again unless it is returned."*
- Every mutation shows an optimistic pending state, then a toast naming what happened.
- Every list has three designed states: loading skeleton, empty (with the action that fills it), error (with retry).
- Nothing autosaves silently except the draft wizard, which shows "Saved 14:32".
- Keyboard: `/` focuses search, `g then a` goes to applications, `Esc` closes the top layer. Every modal traps focus and returns it.

---

# L. Component Architecture

## L.1 Four tiers

```
Tier 1  PRIMITIVES        src/components/ui/*
        shadcn/ui, unmodified. Button, Input, Dialog, Table, Tabs…
        No business meaning. Upgraded by re-running the generator.

Tier 2  PATTERNS          src/components/{data,feedback,status,files,layout}/*
        Domain-agnostic compositions. DataTable, EmptyState, StatusBadge.
        Reusable in any project. No imports from features/.

Tier 3  DOMAIN            src/components/{workflow,application,charts}/*
        Know LAMS concepts but not routes. WorkflowStepper, FeeBreakdown,
        ShortfallCard. Take data as props; fetch nothing.

Tier 4  FEATURES          src/features/*
        Route-level composition. Owns fetching (TanStack Query), mutations,
        and page state. The only tier that calls the API.
```

**The rule:** data flows down, events flow up, and only Tier 4 talks to the network. A Tier 3 component that fetches is a bug — it makes the component untestable and the page's loading behaviour unpredictable.

## L.2 The components that carry the product

| Component | Contract | Why it matters |
|---|---|---|
| `AppShell` | `{ user, nav }` | Sidebar filtered by capability, so a role never sees a link it cannot use |
| `DataTable<T>` | `{ columns, data, total, sort, filters, onExport }` | TanStack Table. Server-side sort/filter/paginate. One implementation behind every list and report in the product. |
| `StatusBadge` | `{ status, kind }` | Single source of status→tone. Adding a status touches one map. |
| `SlaBadge` | `{ dueAt, status, overdueDays }` | Renders "3 days left" / "Overdue 2 days" with the right tone |
| `WorkflowStepper` | `{ stages, currentStageCode, history }` | The §22 journey — completed, current, upcoming, with the shortfall detours shown as branches, not hidden |
| `ActionBar` | `{ applicationId }` | Fetches `GET /workflow/:id/actions` and renders exactly that. **No component anywhere else may render a workflow button.** Disabled actions show the failing guard as a tooltip — the officer learns *why*, not just *no*. |
| `WorkflowActionModal` | `{ action, onSubmit }` | Builds its form from the action definition: remarks required, attachment required, shortfall item builder for `RAISE_*`, amount field for fee shortfalls |
| `ApplicationTimeline` | `{ events }` | Merged, reverse-chronological, grouped by day. Each entry: timestamp, actor, role, action, remarks, attachments. |
| `DocumentUploader` | `{ accept, maxSize, onUpload }` | Client-side type/size check for fast feedback; server re-validates by magic bytes regardless |
| `FileVersionList` | `{ versions }` | V1…Vn with outcome per version — the §23/§24 audit surface |
| `FeeBreakdown` | `{ demand }` | Every line shows basis, variable, value, rate → amount. An officer can audit a fee without asking anyone. |
| `ShortfallCard` | `{ shortfall, canRespond, canReview }` | Items, attempt history, and the one action this viewer may take |
| `NotificationCenter` | — | Topbar popover, unread count, polls on an interval |

## L.3 Data-fetching pattern

- **Server Components** for first paint of read-heavy pages — the application detail header, report tables. No client bundle for data that never changes after load.
- **TanStack Query** for anything interactive or refetchable: task queues, action lists, notification counts, scrutiny status polling.
- **Query keys** from a single factory in `lib/query-keys.ts`, so an invalidation after "forward" can precisely drop the affected application, its actions, its history and the task list without a blanket refetch.
- **Mutations** invalidate explicitly. After a workflow action: `['application', id]`, `['workflow-actions', id]`, `['workflow-history', id]`, `['tasks']`, `['dashboard']`.
- **Polling** only where state changes without the user: scrutiny in progress (3 s, capped at 5 min), payment verification (2 s, capped at 2 min), notification count (60 s).

## L.4 Forms

One Zod schema per form, in `src/lib/schemas/`, imported by both the React Hook Form resolver and the API route. A field the server rejects cannot be a field the client accepted — they are literally the same object.

**They live in `lib`, not `server`.** An earlier draft placed them under `src/server/schemas/`; the import-boundary ESLint rule correctly rejected that the moment a client form imported one. Schemas are shared *contracts* — pure Zod, no server code — so `lib` is where they belong. The boundary rule found the mistake, which is the argument for having it.

The new-application wizard keeps five step schemas plus a composed submit schema. Steps validate on blur and on next; the composed schema runs server-side at submit. Draft autosave is a `PATCH` per section, so a browser crash at step 4 loses nothing.
