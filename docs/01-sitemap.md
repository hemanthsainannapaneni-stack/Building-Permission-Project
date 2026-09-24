# C. Complete Page / Sitemap Inventory

Route groups mirror the audience. `(portal)` carries the authenticated AppShell; `(auth)` is bare.

Legend for **Access**: role keys from H. `OFFICER` = TPA · ZAD · ZDD · ZJD · DIRECTOR_DP · ADDL_COMMISSIONER · COMMISSIONER.

## C.1 Public / unauthenticated — `src/app/(auth)`

| Route | Page | Notes |
|---|---|---|
| `/login` | Sign in | Email + password, rate limited, lockout after N failures. Demo-account chips when `DEMO_MODE=true`. |
| `/forgot-password` | Request reset | Always returns the same response — no account enumeration. |
| `/reset-password/[token]` | Set new password | Single-use token, 30 min TTL, invalidates all sessions on success. |
| `/verify-order/[orderNumber]` | Public approval-order verification | QR target printed on the order. Shows order number, application number, status, issue date **only**. No personal data. |
| `/unauthorized` | 403 | |
| `/error`, `/not-found` | 500 / 404 | |

## C.2 LTP portal — `src/app/(portal)`

Access: `LTP`. Row scope: only applications the signed-in LTP owns.

| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | LTP dashboard | 8 KPI tiles (§20), action-required queue, recent activity |
| `/applications` | My applications | DataTable: filter by status/type/zone/date, saved views, export |
| `/applications/new` | New application wizard | 5 steps — Applicant & Owner → Property & Location → Plot & Survey → Building & Development → LTP & Contact. Autosaves as DRAFT. |
| `/applications/[id]` | **Application detail** | The hub. Tabs below. |
| `/applications/[id]/drawings` | Drawings tab | Version list, upload new version, per-version scrutiny outcome |
| `/applications/[id]/scrutiny` | Scrutiny tab | Result, issue list grouped by severity, downloadable report per version |
| `/applications/[id]/documents` | Documents tab | Required-document checklist, uploader, per-type version history, verification state |
| `/applications/[id]/fees` | Fees tab | Demand list, component breakdown, computation basis shown per line |
| `/applications/[id]/payment/[demandId]` | Pay demand | Gateway handoff |
| `/applications/[id]/payment/[demandId]/return` | Post-payment landing | Polls server verification — **never** trusts the gateway's return params |
| `/applications/[id]/receipts/[receiptId]` | Receipt | Printable, PDF download |
| `/applications/[id]/workflow` | Workflow tab | Stepper + full history |
| `/applications/[id]/shortfalls` | Shortfalls tab | Open/closed, respond inline |
| `/applications/[id]/audit` | Audit tab | Read-only trail (LTP sees its own application's trail) |
| `/applications/[id]/order` | Approval order | Visible once APPROVED |
| `/shortfalls` | All my shortfalls | Cross-application work queue |
| `/payments` | My payments | All demands and transactions |
| `/notifications` | Notification centre | |
| `/profile` | Profile & password | LTP licence details, contact, password change |
| `/help` | Help & guides | Document checklists, drawing standards, FAQ |

## C.3 Officer portal — `src/app/(portal)`

Access: `OFFICER`, `FINANCE_OFFICER`, `VIEWER`. Row scope: jurisdiction (zone/office) + current-stage ownership.

| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | Officer dashboard | New / Pending / Due soon / Overdue / Shortfalls raised / Forwarded (§20) |
| `/tasks` | Task queue | The officer's real workspace. Grouped by SLA state, bulk-open, sortable by age. |
| `/tasks/[taskId]` | Task review | Redirects into the application detail with the action bar armed |
| `/applications` | Application register | All in-jurisdiction, any stage |
| `/applications/[id]` | **Application detail** | Same component as LTP, different action set and tab visibility |
| `/applications/[id]/technical-scrutiny` | Technical scrutiny worksheet | TPA-only: rule-by-rule observations against the auto-scrutiny result, attachable notes |
| `/applications/[id]/compare` | Drawing version compare | Side-by-side V(n-1) vs V(n) with issue overlay |
| `/shortfalls` | Shortfalls raised by me / my stage | Review responses, accept or reject |
| `/reports` | Report catalogue | 11 reports (§30) |
| `/reports/[slug]` | Report viewer | Filters, pagination, CSV/XLSX export |
| `/notifications` | Notification centre | |
| `/profile` | Profile & password | |

## C.4 Executive — `src/app/(portal)/analytics`

Access: `COMMISSIONER`, `ADDL_COMMISSIONER`, `DIRECTOR_DP`, `SYSTEM_ADMIN`, `VIEWER`.

| Route | Page |
|---|---|
| `/analytics` | Executive dashboard — volume, approval rate, fee collected, avg processing time, overdue % |
| `/analytics/applications` | Application analytics — trend, type mix, zone mix |
| `/analytics/pendency` | Pendency analytics — stage-wise ageing heatmap, bottleneck ranking |
| `/analytics/approvals` | Approval analytics — approved/rejected/returned, cycle time distribution |
| `/analytics/fees` | Fee analytics — generated vs collected vs outstanding, shortfall demand share |
| `/analytics/sla` | SLA analytics — breach % by stage and officer, trend |

## C.5 Administration — `src/app/(portal)/admin`

Access: `SYSTEM_ADMIN` unless noted.

| Route | Page | Notes |
|---|---|---|
| `/admin` | Admin home | Health, integration status, demo-mode banner |
| `/admin/users` · `/admin/users/[id]` | Users | Create, edit, activate/deactivate, reset password, lock/unlock, assign role + department + office + zone, activity log |
| `/admin/roles` · `/admin/roles/[id]` | Roles | Capability grid editor |
| `/admin/permissions` | Permissions | Read-mostly catalogue of capability keys |
| `/admin/departments` · `/admin/offices` · `/admin/zones` | Org structure | |
| `/admin/workflows` · `/admin/workflows/[id]` | Workflow versions | Draft / publish / clone. Publishing pins a version; running instances keep theirs. |
| `/admin/workflows/[id]/stages` | Stages | Order, owner roles, SLA, type |
| `/admin/workflows/[id]/transitions` | **Transition matrix editor** | The heart of admin. Grid of stage × action → next stage/status, with guards and effects. Validated on save (see G.4). |
| `/admin/application-types` | Application types | Which workflow, which fee structure, which document rule set |
| `/admin/fee-structures` · `/admin/fee-structures/[id]` | Fee structures | Versioned, effective-dated, with a **live calculator preview** |
| `/admin/document-requirements` | Document rules | Condition → required document types |
| `/admin/document-types` | Document type master | |
| `/admin/scrutiny-rules` | Scrutiny rule catalogue | Rule code, severity, description, active |
| `/admin/sla` | SLA rules | Per stage per application type, calendar vs working days |
| `/admin/holidays` | Holiday calendar | Feeds working-day SLA maths |
| `/admin/notification-templates` · `/[id]` | Templates | Per event per channel, variable palette, live preview |
| `/admin/integrations/payment` | Payment configuration | Provider, mode, key presence (never key values) |
| `/admin/integrations/sms` | SMS configuration | Provider, sender ID, DLT template IDs |
| `/admin/integrations/email` | Email configuration | Driver, from-address, test send |
| `/admin/integrations/scrutiny` | Scrutiny provider configuration | Driver, endpoint, health probe |
| `/admin/master-data` | Master data | Land use, building use, zones, occupancy, structure type, etc. |
| `/admin/audit` | Audit log explorer | Filter by actor/entity/action/date. Read-only, no delete path exists. |
| `/admin/notifications-log` | Delivery log | Per-recipient per-channel status, provider ref, retry |
| `/admin/jobs` | Job queue monitor | Pending / running / failed, retry, dead-letter |
| `/admin/settings` | System settings | Business configuration (A.6 tier two) |

## C.6 Application detail — tab matrix

One route (`/applications/[id]`), one shell component, tabs gated by capability. This is §21.

| Tab | LTP | TPA | ZAD/ZDD/ZJD | DIR/AC/CMR | FINANCE | ADMIN | VIEWER |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Overview | ● | ● | ● | ● | ● | ● | ● |
| Application Details | ● | ● | ● | ● | ○ | ● | ● |
| Drawings | ● | ● | ● | ● | ○ | ● | ● |
| Scrutiny | ● | ● | ● | ● | ○ | ● | ● |
| Documents | ● | ● | ● | ● | ○ | ● | ● |
| Fees | ● | ● | ● | ● | ● | ● | ● |
| Payments | ● | ● | ● | ● | ● | ● | ● |
| Workflow | ● | ● | ● | ● | ○ | ● | ● |
| Shortfalls | ● | ● | ● | ● | ● | ● | ● |
| Communications | ● | ● | ● | ● | ○ | ● | ○ |
| Audit Trail | ◐ | ● | ● | ● | ○ | ● | ● |

● full · ◐ own application only · ○ hidden

**Header (always visible):** Application Number · Applicant · Application Type · Current Stage · Current Status badge · SLA badge · Last Updated · action buttons derived from `GET /workflow/:id/actions`.

## C.7 Page count

| Group | Distinct routes |
|---|---|
| Public / auth | 7 |
| LTP | 20 |
| Officer | 12 |
| Executive | 6 |
| Admin | 30 |
| **Total** | **75** |

Every route in this table is reachable from navigation and backed by real data. Per §43 there are no placeholder pages and no dead links — a route that cannot yet be implemented is not added to the nav until it can.
