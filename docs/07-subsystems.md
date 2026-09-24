# M. Notification Architecture

## M.1 Shape

```
  Service performs a business change
        │  same transaction
        ├─▶ business rows
        ├─▶ audit_log
        └─▶ outbox_events  ('SHORTFALL_RAISED', { applicationId, shortfallId })
                  │
            COMMIT ─── the officer's action is now durable and complete
                  │
        ┌─────────▼──────────┐
        │ Worker: dispatcher │  polls outbox, marks processed
        └─────────┬──────────┘
                  │  resolve recipients + template per channel
        ┌─────────┼──────────┬──────────────┐
        ▼         ▼          ▼              │
    IN_APP     EMAIL       SMS              │
   (insert)  (adapter)  (adapter)           │
        └─────────┴──────────┴──────────────┘
                  │
          notification_logs  (one row per recipient per channel)
```

**Why the outbox.** §25 requires the applicant to be told when a shortfall is raised. If notification were sent inline, an SMS provider outage would either roll back the officer's decision or silently drop the message. The outbox makes the notification a durable consequence of a committed fact: it will be delivered, or it will be visibly failed in `notification_logs` with a retry count an administrator can see at `/admin/notifications-log`.

## M.2 Event catalogue

| Event code | Emitted by | Recipients | Channels |
|---|---|---|---|
| `APPLICATION_CREATED` | applications | LTP | in-app |
| `DRAWING_UPLOADED` | drawings | LTP | in-app |
| `SCRUTINY_PASSED` | scrutiny | LTP | in-app, email, SMS |
| `SCRUTINY_FAILED` | scrutiny | LTP | in-app, email, SMS |
| `DOCUMENTS_PENDING` | workflow | LTP | in-app, email |
| `DOCUMENTS_COMPLETED` | documents | LTP | in-app |
| `FEE_GENERATED` | fees | LTP | in-app, email, SMS |
| `PAYMENT_SUCCESSFUL` | payments | LTP | in-app, email, SMS |
| `PAYMENT_FAILED` | payments | LTP | in-app, email |
| `APPLICATION_FORWARDED` | workflow | LTP + next-stage role | in-app, email |
| `TASK_ASSIGNED` | workflow | stage owners | in-app, email |
| `SHORTFALL_RAISED` | workflow | LTP | in-app, email, SMS |
| `SHORTFALL_RESPONDED` | shortfalls | raising officer | in-app, email |
| `SHORTFALL_RESOLVED` | workflow | LTP | in-app, email, SMS |
| `SHORTFALL_REJECTED` | workflow | LTP | in-app, email, SMS |
| `APPLICATION_APPROVED` | approvals | LTP | in-app, email, SMS |
| `APPLICATION_REJECTED` | workflow | LTP | in-app, email, SMS |
| `APPLICATION_RETURNED` | workflow | LTP + previous officer | in-app, email |
| `SLA_DUE_SOON` | sla sweep | assigned officer | in-app, email |
| `SLA_OVERDUE` | sla sweep | officer + supervisor role | in-app, email |
| `ORDER_ISSUED` | approvals | LTP | in-app, email, SMS |
| `USER_CREATED` / `PASSWORD_RESET` | identity | user | email |

## M.3 Templates

`notification_templates`, keyed `(eventCode, channel, locale)`, `{{variable}}` substitution over a declared variable list. Editable at `/admin/notification-templates` with a live preview against a sample application.

Standard variables: `applicationNumber` `applicantName` `applicationType` `currentStage` `status` `shortfallReason` `shortfallDueDate` `amount` `demandNumber` `receiptNumber` `orderNumber` `officerName` `remarks` `dueDate` `link`.

```
SMS  · SHORTFALL_RAISED
     Dear {{applicantName}}, application {{applicationNumber}} requires:
     {{shortfallReason}}. Please respond by {{dueDate}}. - {{orgShortName}}

Email · FEE_GENERATED
     Subject: Fee demand {{demandNumber}} for application {{applicationNumber}}
     Body:    A fee of Rs. {{amount}} has been generated…  {{link}}
```

**SMS in India requires DLT registration.** Every SMS template carries `providerTemplateId`, and the SMS adapter refuses to send without one — a missing registration surfaces as a clear configuration error at `/admin/integrations/sms`, not as silently undelivered messages. See Q13.

## M.4 Delivery rules

- **Preferences** per user per event per channel. Transactional events (shortfall, payment, approval) are not opt-out-able for the LTP who owns the application — losing those breaks the process.
- **Retry** 3 attempts, exponential backoff (1 min, 5 min, 30 min), then `FAILED` and visible in the admin log.
- **Quiet hours** configurable; SMS defers to the next window, email and in-app do not.
- **Deduplication** the same `(eventCode, applicationId, recipient, channel)` within 60 s is collapsed — a double-click on Forward must not send two SMS.
- **Demo mode** all adapters log to `notification_logs` with `provider = 'mock'` and status `SENT`; the UI shows a persistent DEMO MODE banner so nobody mistakes a logged SMS for a delivered one.

---

# N. Fee Engine Architecture

## N.1 Principle

A fee is calculated **once**, at demand time, and then frozen. Rates change; issued demands do not. Every issued demand records the structure version and the exact input values used, so a demand from March is still explainable in November after two rate revisions.

```
  Trigger (documents complete | fee shortfall raised)
        │
   resolveStructure(applicationType, date)  ── effective-dated, versioned
        │
   buildContext(application)  ── the whitelisted variable set
        │
   for each component, in displayOrder:
        evaluate condition ── false ▶ skip
        compute by basis   ── FLAT | PER_UNIT_AREA | SLAB | PERCENTAGE | FORMULA
        clamp min/max
        round per structure rule
        └─▶ FeeLineItem { basis, variable, value, rate, computed, amount, note }
        │
   sum ▶ ApplicationFee (demand) — status ISSUED, immutable
```

## N.2 Calculation bases

| Basis | Definition | Example |
|---|---|---|
| `FLAT` | `amount = rate` | Application fee ₹1,000 |
| `PER_UNIT_AREA` | `rate × context[variable]` | ₹25/m² × builtUpAreaSqm |
| `SLAB` | Walk `fee_slabs` ascending; **cumulative** unless the slab sets `flatAmount` | First 100 m² @ ₹20, next 200 @ ₹30, above @ ₹45 |
| `PERCENTAGE` | `rate% × amount of component percentOfCode` | Betterment charge = 10% of development charge |
| `FORMULA` | Sandboxed expression over the context | `plotAreaSqm * far * 12.5` |

`PERCENTAGE` components are resolved after their referent by `displayOrder`; the calculator topologically checks references and refuses to save a structure with a cycle or a forward reference.

## N.3 Context variables

The **only** names an expression may use. Anything else is a validation error at structure-save time, not a runtime surprise.

```
plotAreaSqm  builtUpAreaSqm  floorAreaSqm  coverageAreaSqm  parkingAreaSqm
numFloors  numBasements  numDwellingUnits  buildingHeightM
achievedFar  achievedCoverage  roadWidthM
landUseZone  buildingUse  occupancyType  structureType  tenureType
applicationTypeCode  zoneCode  district
```

## N.4 Expression safety

`FORMULA` never uses `eval`, `new Function`, or any dynamic code path. It uses a parser (`expr-eval` or equivalent) with:

- a fixed variable scope — the context object above, nothing else,
- arithmetic and comparison operators plus `min`, `max`, `round`, `ceil`, `floor` only,
- no property access, no function definition, no assignment,
- an expression length cap and a node-count cap,
- validation at **save** time in the admin UI, with a live preview against a sample application, so a broken formula is caught by the person writing it rather than by an applicant.

This is a genuine injection surface — an administrator authoring a formula is authoring code — and it is treated as one.

## N.5 Demand types

| Type | Raised when | Behaviour |
|---|---|---|
| `ORIGINAL` | Documents complete | Blocks entry into the department workflow until paid |
| `SHORTFALL` | An officer raises a fee shortfall | Linked to the shortfall; blocking or reported per the action taken (F.7) |
| `REVISION` | Building particulars change after issue | Charges the delta; a negative delta creates a refund entitlement, not a negative demand |

A demand is `DRAFT` only while being assembled inside the transaction; it is `ISSUED` at commit and never edited again. Cancelling requires a reason and is audited; the replacement is a new demand.

## N.6 Worked example

Plot 300 m², built-up 620 m², residential:

| # | Component | Basis | Detail | Amount |
|---|---|---|---|---|
| 1 | Application fee | FLAT | — | 1,000.00 |
| 2 | Scrutiny fee | PER_UNIT_AREA | 620 × 5.00 | 3,100.00 |
| 3 | Development charge | SLAB | 100@20 + 200@30 + 320@45 | 22,400.00 |
| 4 | Betterment charge | PERCENTAGE | 10% of #3 | 2,240.00 |
| 5 | Labour cess | PERCENTAGE | 1% of (#2+#3) | 255.00 |
| 6 | Open-space contribution | FORMULA | `plotAreaSqm * 15`, min 2,000 | 4,500.00 |
| | | | **Total (NEAREST_1)** | **33,495.00** |

Every one of those rows is stored on the demand with its basis, variable, value and rate. That is what `FeeBreakdown` renders, and it is why an officer never has to ask how a number was reached.

**These rates are illustrative placeholders.** No statutory fee schedule was supplied. See Q3.

---

# O. Payment Architecture

## O.1 Provider abstraction

```ts
export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  initiate(input: InitiateInput): Promise<{ paymentRef: string; redirectUrl?: string; payload?: Json }>;
  verify(paymentRef: string): Promise<ProviderStatus>;   // authoritative, server→gateway
  parseWebhook(req: Request): Promise<WebhookEvent>;     // verifies signature, returns externalId
  refund?(paymentRef: string, amount: Decimal): Promise<RefundResult>;
}
```

Drivers: `mock` (dev/demo), and one real provider at integration time. Nothing in `services/payments.ts` knows which is live.

## O.2 Lifecycle

```
   LTP clicks Pay
        │
   POST /payments/initiate ─── creates Payment(INITIATED) + txn(INITIATE)
        │                      idempotent per (demand, open attempt)
        ▼
   Gateway ──────────────────────────────────┐
        │                                    │
   browser returns                    webhook arrives
        │                                    │
   POST /payments/:id/verify          POST /payments/webhook/:provider
        │                                    │
        │                            store webhook_event
        │                            unique (provider, externalId)
        │                            duplicate ▶ 200, no-op
        │                                    │
        └──────────┬─────────────────────────┘
                   ▼
        provider.verify()  ← the ONLY thing that may settle a payment
                   │
        SELECT … FOR UPDATE on payments
        settlementLockAt already set? ▶ no-op, return current state
                   │
        ┌──────────┴────────────┐
     SUCCESS                 FAILED / CANCELLED
        │                       │
   demand.paidAmount += amt   status = FAILED
   issue receipt              application → PAYMENT_FAILED
   emit PAYMENT_SUCCESSFUL    (stage does NOT advance)
   workflow CONFIRM_PAYMENT
        ▼
   TPA_REVIEW
```

## O.3 The three rules

1. **The browser is never believed.** §33 is absolute. The return page's query parameters are used for nothing but deciding to call `verify`. Settlement comes only from `provider.verify()`, a server-to-server call.
2. **Duplicate callbacks are free.** `payment_webhook_events` has `@@unique([provider, externalId])`; a repeated delivery hits the constraint and returns 200 without touching money. `settlementLockAt` on `payments` means even two *different* events for the same payment settle it once.
3. **Failure never advances the application.** There is no transition from `LTP_PAYMENT` on a failed payment. The application sits at `PAYMENT_FAILED` and the LTP retries. This is structural, not a conditional.

## O.4 Edge cases

| Case | Handling |
|---|---|
| User closes the browser mid-payment | Reconciliation sweep verifies every `INITIATED`/`PENDING` payment older than 10 min |
| Webhook before the return | Webhook settles; the return page then reads the settled state |
| Webhook never arrives | Sweep catches it; also a manual `POST /payments/reconcile` for finance |
| Gateway timeout | `TIMEOUT` after a configurable window; sweep keeps verifying up to 24 h |
| Amount mismatch | Settlement refuses, logs `PAYMENT_AMOUNT_MISMATCH`, alerts finance. Never partially credits. |
| Double payment of one demand | Second settles as `SUCCESS` but over-payment is flagged for refund; `paid_not_over_total` prevents a corrupt demand |
| Refund after rejection | `Refund` row, finance-initiated, provider-dependent. Policy is Q8. |

## O.5 Receipts

Issued in the settlement transaction: sequential `receiptNumber` from `number_sequences`, a frozen JSON snapshot of payer and line items, and a PDF rendered by the worker. The receipt does not re-query the demand at render time — a later fee revision must never alter a receipt already given to a citizen.

---

# P. Document & Drawing Architecture

## P.1 Versioning

Both follow one rule: **nothing is ever overwritten**.

```
Drawing "Architectural"          ApplicationDocument "Structural Stability Cert"
├── v1  FAILED   12 issues       ├── v1  REJECTED  "Not signed by engineer"
├── v2  FAILED   3 issues        └── v2  VERIFIED  ← isActive
└── v3  PASSED   0 issues ← isActive
```

`isActive` is enforced by a partial unique index (E.1), so "two current versions" is impossible rather than merely avoided. Every version keeps its uploader, timestamp, remarks and outcome — the §23/§24 audit surface, and the input to the version-compare view.

## P.2 Dynamic requirements

§4 requires the document list to be derived, not fixed. `document_requirements` rows carry a JSON condition evaluated against the application:

```json
{ "documentTypeCode": "STRUCTURAL_STABILITY_CERTIFICATE",
  "isMandatory": true,
  "condition": { "or": [ { "gte": ["building.numFloors", 4] },
                         { "gt": ["building.buildingHeightM", 15] } ] } }
```

`documents.requiredFor(application)` evaluates every active rule for the application type and returns the resolved checklist with a completeness count. `documents_complete` — the guard on §5's "no fee before documents are complete" — is that function returning zero missing mandatory items. One implementation, used by the guard, the UI checklist and the LTP dashboard tile alike.

## P.3 Upload pipeline

```
  multipart
     ▼
  1. size cap (per document type)
  2. extension allow-list
  3. declared MIME allow-list
  4. MAGIC BYTES sniff — must agree with 3.  ← a .pdf that is a PE binary dies here
  5. filename normalised: strip path separators, unicode-normalise,
     collapse to [a-zA-Z0-9._-], regenerate as {cuid}.{ext}
  6. sha256 checksum → FileObject
  7. store under a NON-GUESSABLE key in a PRIVATE bucket
  8. enqueue antivirus scan (scanStatus = PENDING)
  9. create version row
```

Nothing is served from the application filesystem, and the bucket has no public-read policy. Step 4 is the important one: extension and declared MIME are both attacker-controlled; the file's first bytes are not.

## P.4 Download

Downloads never expose a storage key. `GET /documents/versions/:id/download`:

1. resolves the version → application,
2. re-checks capability **and** row scope,
3. refuses if `scanStatus` is `PENDING`, `INFECTED` or `FAILED`,
4. mints a signed URL with a 5-minute TTL,
5. writes an `AuditLog` row (`DOCUMENT_DOWNLOADED`) **before** returning it.

Who read which citizen's document, and when, is therefore always answerable.

## P.5 Antivirus

```ts
export interface ScanProvider {
  readonly name: string;
  scan(fileObjectId: string): Promise<{ status: ScanStatus; detail: string }>;
}
```

`noop` in development marks `SKIPPED`. A real driver (ClamAV sidecar or a hosted API) marks `CLEAN` or `INFECTED`. An `INFECTED` file is quarantined: the version is soft-deleted, the uploader is notified, an alert fires. The integration point exists from day one so that turning scanning on is configuration, not a refactor.

## P.6 Retention

Files outlive the application — an approval order and its supporting documents are municipal records. Deletion is soft everywhere; hard deletion happens only through a documented retention job that does not exist by default. Policy is Q17.

## P.7 Scrutiny provider

*(Ratified 25 Aug 2026 — implements the A.1.1 decision.)*

### The interface

The whole integration boundary, and the only thing business code may depend on:

```ts
export interface ScrutinyProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Submit a drawing version. May return a terminal result or a pending handle. */
  submit(input: ScrutinySubmission): Promise<ScrutinyAck>;
  /** Poll a pending request. Called by the worker; not all providers need it. */
  poll?(externalRef: string): Promise<ScrutinyOutcome | null>;
  /** Parse and verify a provider-initiated callback. */
  parseCallback?(req: Request): Promise<ScrutinyOutcome>;
}

export type ScrutinyOutcome = {
  externalRef: string;
  outcome: 'PASS' | 'FAIL';
  summary: string;
  issues: Array<{
    ruleCode: string;
    severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
    title: string;
    description: string;
    expectedValue?: string;
    actualValue?: string;
    layer?: string;
    locationHint?: Record<string, unknown>;
  }>;
  raw: unknown;
};
```

Three delivery styles are accommodated because we do not yet know which a real engine will use: synchronous (`submit` returns terminal), polled (`submit` returns pending, worker calls `poll`), and callback (`submit` returns pending, engine posts to `/api/scrutiny/callback`). The service layer handles all three identically — it writes a `ScrutinyRequest`, and applies whatever `ScrutinyOutcome` arrives, from wherever.

### The mock

`MockScrutinyProvider` is the only driver that ships. It exists to make the lifecycle testable, **not** to assess compliance, and it is built so that nobody can mistake it for the latter.

| Setting | Default | Purpose |
|---|---|---|
| `mock_scrutiny_mode` | `VERSION_LADDER` | `VERSION_LADDER` · `ALWAYS_PASS` · `ALWAYS_FAIL` · `SEEDED_RANDOM` |
| `mock_scrutiny_pass_from_version` | `3` | Under `VERSION_LADDER`, the version at which PASS begins |
| `mock_scrutiny_delay_ms` | `3000` | Simulated engine latency, so the async pipeline and polling UI are genuinely exercised rather than accidentally synchronous |
| `mock_scrutiny_error_rate` | `0` | Fraction of runs that fail with `ERRORED` rather than returning a result — exercises the retry path |

`VERSION_LADDER` is the default because it makes the required demo journey reproducible: V1 fails, V2 fails, V3 passes. Which rules are flagged is chosen deterministically from `hash(applicationId + versionNo)` against the seeded rule catalogue, so a reseeded database produces an identical demo.

**The rule catalogue is explicitly non-statutory.** Seeded `scrutiny_rules` carry plausible codes and human-readable titles — front setback, ground coverage, staircase width, parking provision — with the `reference` column **deliberately empty**, because no byelaw clause was supplied and Rule 6 forbids inventing one. Issue text describes a generic condition, never a numeric threshold presented as law.

### Honesty guardrails

Because a mock PASS is not a compliance decision, three things make that visible rather than implicit:

1. **Result provenance.** `scrutiny_requests.engineDriver` records which driver produced every result, forever. An officer looking at a two-year-old file can tell whether it was machine-checked for real.
2. **Watermarked reports.** A scrutiny report PDF generated by a non-production driver is watermarked *"DEMO SCRUTINY — NOT A COMPLIANCE CERTIFICATE"*, and the UI labels the result the same way.
3. **A refusal to pretend.** The mock driver refuses to run when `NODE_ENV=production` and `ALLOW_MOCK_SCRUTINY_IN_PRODUCTION` is not explicitly set. Deploying to production without a real provider is then a conscious act with an audit trail, not an oversight.

### Independence from the mock

The architecture must not depend on the mock, so this is tested rather than asserted: the integration suite runs the full drawing→scrutiny→documents path twice, once against `MockScrutinyProvider` and once against a stub HTTP provider, and asserts identical application state. If any service, guard, route or component ever learns which driver is live, that test fails.

---

# Q. Audit Architecture

## Q.1 What is recorded

Every state change, every authorization-relevant read (document and drawing downloads, report exports), every administrative configuration change, and every authentication event.

```ts
await audit(tx, {
  actor: user, action: 'SHORTFALL_RAISED',
  entityType: 'Shortfall', entityId: shortfall.id,
  applicationId, before: null, after: snapshot,
  remarks, ip, userAgent, correlationId,
});
```

`audit()` takes the transaction client, so the audit row and the change it describes commit together or not at all. An action that succeeded but was not recorded is not possible.

## Q.2 Tamper evidence

Each row stores `prevHash` (the previous row's `rowHash`) and `rowHash = sha256(prevHash ‖ canonical(row))`. A verification job walks the chain and reports the first break. This does not prevent a database administrator with direct access from rewriting history, but it makes rewriting *undetectably* substantially harder — which is the realistic goal.

Combined with the `REVOKE UPDATE, DELETE` grants from E.1, the application itself — even fully compromised — cannot alter a past audit row. §27's "not editable through normal UI" is met at the database, not by omitting a button.

## Q.3 Reading

`/admin/audit` filters by actor, entity type, entity id, application, action and date range. The application detail Audit tab shows the same data scoped to one application. Exports are themselves audited.

## Q.4 Retention

Audit rows are never deleted by the application. Growth is managed by monthly range partitioning on `occurredAt` once volume justifies it; old partitions detach to cold storage rather than being dropped.

---

# R. SLA Architecture

## R.1 Model

An SLA clock belongs to a **task**, not an application — an application that visits ZJD twice has two ZJD clocks, which is what makes officer performance measurable.

```
  Task created at stage
        │  resolve SlaRule (stage + applicationType, falling back to stage)
        ▼
  SlaInstance { startedAt, dueAt = start + N days, status ON_TRACK }
        │
        ├── shortfall parks the instance ──▶ PAUSED, accumulate pausedMs
        ├── resolution accepted           ──▶ resume, dueAt shifted by pausedMs
        ├── elapsed ≥ warnAtPercent       ──▶ DUE_SOON, notify assignee
        ├── now > dueAt                   ──▶ OVERDUE, notify + escalate
        └── task completed                ──▶ COMPLETED, freeze the elapsed time
```

## R.1.1 What an SLA breach does — and does not do

*(Ratified 25 Aug 2026 — resolves former Q11.)*

**SLA is a management instrument, not a legal one.** Passing the due date has exactly three consequences:

1. The task and its application are marked **`OVERDUE`**.
2. The assigned officer is notified, and the configured supervisor role is notified.
3. The breach appears in the officer dashboard, the pendency analytics and the SLA report.

That is the complete list. Explicitly, and enforced by the absence of any code that could do otherwise:

- An overdue application is **never** approved automatically.
- An overdue application **never** acquires an approval status, a deemed status, or any other legal effect.
- No workflow transition is triggered by the clock. The engine has no time-based transitions at all, so this is structural rather than a rule someone remembered to omit.
- No statutory clock or deemed-approval period is assumed anywhere. The seeded day counts are internal service targets, editable by an administrator, and carry no legal claim.

The status is named `OVERDUE` rather than `BREACHED` throughout the schema, the API and the UI, because "breached" invites a reading — that some obligation was violated with consequences — which the business has explicitly not adopted.

**Escalation is deliberately shallow.** `escalateToRoleKey` notifies one supervisor role. Multi-tier escalation ladders, auto-reassignment of overdue tasks and time-based routing are all *not* implemented; each is a configuration surface that can be added when the department defines the policy. Per Rule 6, an unspecified escalation policy defaults to "tell someone", not to "act".

## R.2 Working-day arithmetic

`WORKING_DAYS` (the default) skips Saturdays, Sundays and rows in `holidays`. `CALENDAR_DAYS` counts everything. Per-rule, because statutory clocks and internal targets often differ.

The calculator is pure and separately unit-tested — off-by-one errors in due-date maths are the single most common source of "the system says I'm late and I'm not" disputes, so it gets property tests over year boundaries, leap days and holiday runs.

## R.3 Pausing during shortfall

`pauseOnShortfall` defaults to true: the clock stops while the file is with the applicant, because an officer should not be scored for an applicant's delay. It is per-rule configurable. Since no statutory clock exists in this system (R.1.1), this is purely a question of how internal performance is measured — see Q12.

## R.4 The sweep

A worker job (default every 15 min) recomputes open `SlaInstance` rows, transitions `ON_TRACK → DUE_SOON → OVERDUE`, emits `SLA_DUE_SOON` / `SLA_OVERDUE` once per instance per transition, notifies the assignee and the configured supervisor role, and refreshes the denormalised `slaStatus` / `slaDueAt` on `applications` that the officer queue sorts by.

The sweep writes statuses and sends notifications. **It does not call the workflow engine**, and the engine exposes no method it could call to advance an application. That is what makes R.1.1 an architectural property rather than a promise.
