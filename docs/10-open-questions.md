# Decisions, Ambiguities & Configuration

**Status:** Q2, Q7, Q10 and Q11 were decided on 25 Aug 2026 and are now specification. The remaining items are recorded below with their default behaviour and the phase by which each is needed.

Governing principle — **Rule 6** (`00-architecture.md` A.2): never invent a legal rule, a fee rate, a scrutiny regulation or an approval power. Make it configurable, default restrictively, record the gap here.

---

# Part 1 — Ratified decisions

These four are closed. They are documented here for the record; the specification sections named are authoritative.

## D1 — Scrutiny engine · *was Q2* · **Mock now, integration-ready later**

**Decision.** There is no confirmed external scrutiny engine, and this project does not build one. No DXF/DWG geometry parsing, no CAD rule engine, no statutory scrutiny formulas.

What is built instead:

- A `ScrutinyProvider` adapter interface — the integration boundary.
- `MockScrutinyProvider` producing realistic PASS/FAIL outcomes and issue lists, so the whole lifecycle is testable end to end.
- Persistent `scrutiny_rules` / `requests` / `results` / `issues` / `reports` tables from day one, so a future real engine writes into a schema that already exists.
- Scrutiny as a **configurable workflow gate**, switchable per application type.
- **No architectural dependency on the mock**, verified by running the golden path against a stub HTTP provider and asserting identical state.

Seeded scrutiny rules are generic placeholders with an empty statutory `reference`. No threshold is presented as law.

*Specification:* `00-architecture.md` A.1.1 · `03-workflow.md` F.8 · `07-subsystems.md` P.7

## D2 — Deemed approval · *was Q11* · **No. SLA is notification only.**

**Decision.** SLA breach has no legal effect. Passing the due date marks the task and application `OVERDUE`, notifies the officer and the configured supervisor, and appears in dashboards and reports. Nothing else.

- No automatic approval. No deemed status. No legal effect of any kind.
- **No time-based workflow transitions exist in the engine at all**, so this is structural rather than an omission someone must remember.
- No statutory clock or deemed-approval period is assumed anywhere; seeded day counts are internal service targets, editable, and carry no legal claim.
- The status is named `OVERDUE`, not `BREACHED`, throughout schema, API and UI.
- Escalation is one notification to one supervisor role. Multi-tier ladders and auto-reassignment are deliberately not implemented.

*Specification:* `07-subsystems.md` R.1.1

## D3 — Approval with an open shortfall · *was Q7* · **Blocked. No override.**

**Decision.**

```
OPEN_SHORTFALLS > 0  →  APPROVAL BLOCKED
```

Counting every shortfall in status `OPEN`, `RESPONDED` or `UNDER_REVIEW`, of **every kind** (document, fee, technical, clarification, and any kind configured later) and **every mode** (blocking and reported alike).

`REPORT_SHORTFALL_AND_FORWARD` advances the application to the next level and leaves the shortfall tracked as `OPEN`, travelling with the file. It cannot be approved away.

**No administrative override is implemented** — no capability, no settings key, no code path. Per Rule 6, an unimplemented override is the restrictive default. Introducing one later is a deliberate, separately authorised change.

The guard re-verifies with a live count inside the approval transaction, so a stale denormalised counter can never authorise an approval.

*Specification:* `03-workflow.md` F.5.1, transition row 14

## D4 — Scrutiny override capability · *was Q10* · **Removed.**

**Decision.** `SCRUTINY_OVERRIDE` is removed entirely — no capability key, no matrix row, no route, no service method, no UI affordance. Officers are not authorised to override a failed automated scrutiny result.

The only route past a failure is:

```
SCRUTINY_FAILED → LTP correction → new drawing version → re-scrutiny
```

Nothing in the codebase anticipates a future override, because a dormant bypass is a bypass.

*Specification:* `04-rbac.md` H.3.1

---

# Part 2 — Remaining scope-changing ambiguities

Four items remain that would change *what is built* rather than *how it is configured*. Each is listed with the phase by which an answer is needed. **None blocks Phase 0.**

### S1 — Language and localisation · **Phase 1 shipped English-only**

Now the highest-priority remaining unknown, because it is the only one that is expensive to retrofit and whose phase is imminent.

English-only is assumed, and Phase 1 has now shipped that way — the shell, login, dashboards and admin screens all carry hard-coded English strings.

The cost of adding Telugu or Hindi grows with every page built. It is still modest today (roughly 20 screens) and will not be by Phase 10 (75 routes, plus notification templates and the approval order).

*Current state:* `notification_templates` carries a `locale` column. The UI does not. Nothing else anticipates translation.

**This is the cheapest it will ever be to answer. A yes/no now saves multiples later.**

### S2 — Parallel review (fork/join) · needed **before Phase 7**

The workflow is strictly sequential. If any stage must consult two departments concurrently — fire, environment, heritage, airport height clearance are the usual ones — the engine needs fork/join semantics: parallel branches, a join condition, and partial-completion state.

That is a genuine addition to the engine, not a configuration row. Nothing in the requirement suggests it, but confirming its absence before Phase 7 is far cheaper than discovering it during Phase 8.

### S3 — Digital signature on approval orders · needed **before Phase 9**

Is a legally valid signature required on the approval order — a Class-3 DSC token, or Aadhaar eSign — or is a system-generated order with QR verification sufficient?

A DSC/HSM integration is meaningful additional work (token handling, signing service, certificate lifecycle, possibly a Windows-hosted signing component) and is not in the 20-week estimate.

*Current state:* QR-verifiable system-generated order; `approval_orders.signatureRef` reserved and unused.

### S4 — Revalidation, revision and renewal · needed **before Phase 2 schema freeze**

The lifecycle as specified ends at approval. Real permissions expire, get revised mid-construction, and get renewed — each of which references a prior approval.

This is out of scope as written, and stays out. But a revision application that points at its parent is materially cheaper to add if `applications` carries a nullable parent reference and a purpose enum from the start. **The question is not "build it now" but "should the schema anticipate it".**

*Recommendation:* add the two nullable columns in Phase 2. They cost nothing unused, and they avoid a migration over live data later.

---

# Part 3 — Configuration questions

These have working defaults. Answer them as their phase arrives; none changes the shape of the build.

| # | Phase | Question | Default until answered |
|---|---|---|---|
| **Q1** | 5 / go-live | **Which jurisdiction and which building rules?** Never named in the requirement. Determines the fee schedule, document checklist and — when a real engine appears — the scrutiny rules. | Placeholder rule set and fee structure, labelled as such. No byelaw invented. |
| **Q3** | 5 | **The actual fee schedule** — heads, rates, slabs, rounding convention, heads of account for treasury reconciliation. | The illustrative components in `07-subsystems.md` N.6, clearly marked placeholder. |
| **Q4** | 7 | **ZAD and ZDD** — alternates by zone, two sequential desks, or one role with two titles? | **Built as one stage owning both role keys**, and the task queue is scoped by the STAGE's owners so a file addressed to either is worked by both. If they turn out to be sequential the stage list grows by one row and the SLA figures shift; no code moves. |
| **Q5** | 7 | **What may the Additional Commissioner do?** The one stage whose action set the requirement declines to state. | **Seeded and live**: forward · raise document shortfall · report shortfall and forward · return to previous · close a reported shortfall · decide a response. Changing it is a row in `prisma/seed/09-workflow.ts` or an admin edit — no code changes, which is the point of the engine. |
| **Q6** | 8 | **Which shortfall kinds may the Director raise?** The requirement says "shortfall" unqualified. | **Seeded**: document, technical and fee, plus report-and-forward. All configuration. |
| **Q18** | 7 | **Who settles a shortfall that was merely REPORTED?** It never parks the file, so there is no origin to return to and no resubmission to answer — and an open one blocks approval absolutely. Raised by the delivery of the engine, not by the requirement. | The officer holding the file records that it is settled (`RESOLVE_REPORTED_SHORTFALL`), after the applicant has paid the demand or supplied the document. Seeded at every review desk. Whether a department wants that decision reserved to the raising desk is a configuration question. |
| **Q19** | 7 | **How long does an applicant have to answer a shortfall?** No statutory response period was supplied. | `shortfall_response_days = 0` — no due date is put on the applicant, because inventing one would put a deadline on a citizen that no rule supports. Set the setting and every new shortfall carries a date. |
| **Q8** | 6 | **Payment specifics** — which gateway; who bears convenience charges; is partial payment of a demand allowed; are fees refundable on rejection or withdrawal and who authorises it. | Full payment per demand. Refund rows exist; no automatic policy fires. |
| **Q9** | 4 | **Does "documents complete" mean uploaded, or verified?** If verification is required, an officer step must precede fee generation and the pipeline order changes. | Uploaded — verification happens at TPA, after payment. |
| **Q12** | 9 | **Does the SLA clock pause during a shortfall?** Now purely a performance-measurement question, since no statutory clock exists (D2). | Yes, per rule. Both behaviours supported. |
| **Q13** | 9 | **SMS provider and DLT registration** — whose account registers the templates? A procurement lead-time item; start early. | Mock adapter. The real one refuses to send without a registered template id. |
| **Q15** | 2 | **Is LTP registration verified against an external register?** Must an expired licence block filing? | Captured, not enforced. If a register API exists this becomes an integration. |
| **Q16** | 2 | **Application number format** — is a ULB code, zone code, type code or financial year mandated? | `BP/2026/000123`. Trivial to change now, painful once numbers are issued. |
| **Q17** | 0 / 11 | **Data residency and hosting** — state data centre, MeghRaj, or commercial cloud? And what is the document retention period? | Cloud-agnostic, Docker-ready. Nothing is ever hard-deleted. |
| **Q19** | 7 | **Delegation and leave** — may another officer act for an absent one, with an audit distinction ("acting for X")? | Tasks are role-addressed, so any holder of the role can act. Formal delegation is not modelled. |
| **Q22** | 8 | **Withdrawal and lapsing** — may an LTP withdraw at any stage? Does an unpaid demand lapse after N days? | Statuses exist; no rule drives them. |
| **Q23** | 10 | **Officer performance reporting** — where individual metrics are published is often policy, sometimes service rules. | Data supports it; audience to be confirmed. |

---

# Part 4 — Standing assumptions

Neutral defaults chosen so work can proceed. Each is a settings row, a seed value or a transition — never a line of code — and each is cheap to change.

| Assumption | Where it lives |
|---|---|
| One drawing per application (schema supports several) | seed |
| Sequential review, no parallel stages | transitions — see **S2** |
| Payment in full per demand, no partial payment | settings |
| English only | code — see **S1** |
| Documents required at "uploaded", not "verified" | guard config — Q9 |
| SLA pauses during shortfall | `sla_rules.pauseOnShortfall` |
| **Any open shortfall blocks approval** | transition guard — **D3, no override** |
| **SLA overdue notifies; it never routes** | structural — **D2** |
| Working-day SLA counting with a holiday calendar | `sla_rules.calendar` |
| One LTP account per application; no co-filing or transfer | schema |
| QR-verified orders, no digital signature | code — see **S3** |
| Fees non-refundable absent an explicit policy | settings — Q8 |
| Scrutiny gate on by default, per application type | `application_types.requiresScrutiny` |
| Mock scrutiny refuses to run in production unless explicitly permitted | env |
