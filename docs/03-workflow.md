# F. Workflow State Machine

## F.1 The engine contract

§17 states the rule precisely, and the engine implements exactly it and nothing more:

```
  ( current stage , current status , actor role , chosen action )
                            │
                    lookup transition row
                            │
                    evaluate guards   ── fail ──▶ reject, 409, nothing written
                            │ pass
                    apply effects (ordered)
                            │
  ( next stage , next status , tasks , SLA , history , audit , outbox )
```

`src/server/workflow/engine.ts` is the only file permitted to read `workflow_transitions`, and it never names a stage. Everything specific — that ZJD may report a fee shortfall and forward, that the Director may report and forward, that the Additional Commissioner's action set is TBD — is rows.

## F.2 Stage map

Two phases: the applicant-side pipeline (statuses on the application, no officer task), and the department pipeline (a task per stage, SLA-clocked).

```
╔═══════════════ LTP PHASE — no departmental task, no SLA ══════════════╗
║                                                                       ║
║  LTP_DRAFT                                                            ║
║     │ SUBMIT_DRAWING                                                  ║
║     ▼                                                                 ║
║  LTP_DRAWING ──▶ SCRUTINY_IN_PROGRESS                                 ║
║     │                    │                                            ║
║     │            ┌───────┴────────┐                                   ║
║     │          FAIL             PASS                                  ║
║     │            │                │                                   ║
║     └────────────┘                ▼                                   ║
║      (new version, loop)   LTP_DOCUMENTS                              ║
║                                   │ guard: documents_complete         ║
║                                   ▼                                   ║
║                            [effect: GENERATE_FEE_DEMAND]              ║
║                                   │                                   ║
║                            LTP_PAYMENT                                ║
║                                   │ guard: fees_paid (server verified)║
╚═══════════════════════════════════╪═══════════════════════════════════╝
                                    ▼
╔═══════════════ DEPARTMENT PHASE — task + SLA per stage ═══════════════╗
║                                                                       ║
║   TPA_REVIEW ──▶ ZAD_ZDD_REVIEW ──▶ ZJD_REVIEW ──▶ DIRECTOR_DP_REVIEW ║
║        │               │                │                 │          ║
║        └───────────────┴────────────────┴─────────────────┘          ║
║                        │ any may park the instance                    ║
║                        ▼                                              ║
║              LTP_SHORTFALL_ACTION  ──resolution accepted──▶ resume    ║
║                        ▲                     at parkedStageId         ║
║                        │                                              ║
║   ADDL_COMMISSIONER_REVIEW ──▶ COMMISSIONER_REVIEW                    ║
║                                       │                               ║
║                        ┌──────────────┼──────────────┐                ║
║                     APPROVE         RETURN        REJECT              ║
║                        ▼                             ▼                ║
║                  CLOSED_APPROVED               CLOSED_REJECTED        ║
║                  [GENERATE_APPROVAL_ORDER]                            ║
╚═══════════════════════════════════════════════════════════════════════╝
```

## F.3 Stage catalogue (seeded)

| # | Code | Type | Owner roles | Entry status | Working status | SLA |
|---|---|---|---|---|---|---|
| 10 | `LTP_DRAFT` | LTP_ACTION | LTP | `DRAFT` | — | — |
| 20 | `LTP_DRAWING` | LTP_ACTION | LTP | `DRAWING_UPLOADED` | `SCRUTINY_IN_PROGRESS` | — |
| 30 | `LTP_DOCUMENTS` | LTP_ACTION | LTP | `DOCUMENT_UPLOAD_PENDING` | — | — |
| 40 | `LTP_PAYMENT` | LTP_ACTION | LTP | `FEE_GENERATED` | `PAYMENT_PENDING` | — |
| 50 | `TPA_REVIEW` | REVIEW | TPA | `PENDING_TPA` | `TPA_REVIEW` | 5 |
| 60 | `ZAD_ZDD_REVIEW` | REVIEW | ZAD, ZDD | `PENDING_ZAD_ZDD` | `ZAD_ZDD_REVIEW` | 5 |
| 70 | `ZJD_REVIEW` | REVIEW | ZJD | `PENDING_ZJD` | `ZJD_REVIEW` | 7 |
| 80 | `DIRECTOR_DP_REVIEW` | REVIEW | DIRECTOR_DP | `PENDING_DIRECTOR_DP` | `DIRECTOR_REVIEW` | 7 |
| 90 | `ADDL_COMMISSIONER_REVIEW` | REVIEW | ADDL_COMMISSIONER | `PENDING_ADDITIONAL_COMMISSIONER` | `ADDITIONAL_COMMISSIONER_REVIEW` | 5 |
| 100 | `COMMISSIONER_REVIEW` | APPROVAL | COMMISSIONER | `PENDING_COMMISSIONER` | `COMMISSIONER_REVIEW` | 5 |
| 110 | `LTP_SHORTFALL_ACTION` | LTP_ACTION | LTP | *(set by the raising transition)* | — | — |
| 900 | `CLOSED_APPROVED` | TERMINAL | — | `APPROVED` | — | — |
| 910 | `CLOSED_REJECTED` | TERMINAL | — | `REJECTED` | — | — |

SLA days are the illustrative values from §26 and are **seed data**, editable at `/admin/sla`. They are not law until confirmed — see `10-open-questions.md` Q11.

## F.4 Action catalogue (seeded)

| Code | Kind | Remarks? | Meaning |
|---|---|---|---|
| `SUBMIT_DRAWING` | FORWARD | no | LTP submits a drawing version for scrutiny |
| `SCRUTINY_PASSED` | FORWARD | no | System-raised on a PASS result |
| `SCRUTINY_FAILED` | RETURN | no | System-raised on a FAIL result |
| `SUBMIT_DOCUMENTS` | FORWARD | no | LTP declares the checklist complete |
| `CONFIRM_PAYMENT` | FORWARD | no | System-raised on verified settlement |
| `FORWARD` | FORWARD | yes | Send to the next stage |
| `RAISE_DOCUMENT_SHORTFALL` | RETURN | yes | Park; LTP must supply documents |
| `RAISE_FEE_SHORTFALL` | RETURN | yes | Park; LTP must pay an additional demand |
| `RAISE_TECHNICAL_SHORTFALL` | RETURN | yes | Park; LTP must correct the drawing |
| `RAISE_CLARIFICATION` | CLARIFY | yes | Park; LTP must answer in writing |
| `REPORT_FEE_SHORTFALL_AND_FORWARD` | REPORT_AND_FORWARD | yes | Record a non-blocking fee shortfall **and advance** |
| `REPORT_SHORTFALL_AND_FORWARD` | REPORT_AND_FORWARD | yes | Record a non-blocking shortfall **and advance** |
| `RESUBMIT` | RESUBMIT | yes | LTP answers a parked shortfall |
| `ACCEPT_RESOLUTION` | FORWARD | yes | Officer accepts; instance resumes |
| `REJECT_RESOLUTION` | RETURN | yes | Officer rejects; stays parked, new attempt |
| `RETURN_TO_PREVIOUS` | RETURN | yes | Send back one departmental stage |
| `APPROVE` | APPROVE | yes | Final approval |
| `REJECT` | REJECT | yes | Final rejection |

**This table is the direct answer to §12 and §13.** `RAISE_FEE_SHORTFALL` and `REPORT_FEE_SHORTFALL_AND_FORWARD` are two rows with different `kind` and different `effects`. The engine has no idea one of them is "the ZJD rule". Granting the same pair to the Additional Commissioner later is an admin edit.

## F.5 Guards

Pure predicates over the application context. Evaluated before any write; a failure produces a 409 naming the guard, and nothing is persisted.

| Guard | True when |
|---|---|
| `drawing_uploaded` | An active drawing version exists |
| `scrutiny_passed` | The active drawing version's latest result is `PASS` |
| `documents_complete` | Every mandatory `DocumentRequirement` resolved for this application has a `VERIFIED` or `UPLOADED` document (which of the two is configurable — Q9) |
| `fee_demand_issued` | An `ORIGINAL` demand exists with status `ISSUED` or better |
| `fees_paid` | Every non-cancelled demand has `paidAmount >= totalAmount`, each confirmed by a server-side verification |
| `no_open_blocking_shortfalls` | No shortfall on this application with `mode = BLOCKING` and status in (OPEN, RESPONDED, UNDER_REVIEW) |
| `no_open_shortfalls` | **No open shortfall of any kind or mode.** The approval guard — see F.5.1 |
| `has_remarks` | The action carried non-empty remarks |
| `sla_not_overdue` | Informational only; never blocks anything |

### F.5.1 The approval guard

*(Ratified 25 Aug 2026 — resolves former Q7.)*

The rule is absolute and stated as one line:

```
OPEN_SHORTFALLS > 0  →  APPROVAL BLOCKED
```

`no_open_shortfalls` counts every shortfall on the application whose status is `OPEN`, `RESPONDED` or `UNDER_REVIEW`, **regardless of kind and regardless of mode**:

- `DOCUMENT` · `FEE` · `TECHNICAL` · `CLARIFICATION`, and any kind configured later
- `BLOCKING` **and** `REPORTED` alike

`REPORT_SHORTFALL_AND_FORWARD` therefore does exactly what its name says and nothing more: the application advances to the next level, and the reported shortfall stays tracked as `OPEN`, travelling with the file and visible to every subsequent officer — until someone resolves it. It cannot be approved away.

**The guard asks a second question about CLOSED shortfalls.** A shortfall closes as a whole and closing it settles every line, but an item carries `isMandatory` and `isResolved` of its own. A mandatory item left unresolved under a *closed* letter is exactly the state this guard exists to catch — whether it got there through a data repair, an item verdict that went one way while the letter went the other, or a path nobody has written yet. Checking the letter alone would trust a status to imply something about its contents, and the contents are what the approval is actually about. The refusal names the item, not just the count.

Items are the only thing `isMandatory` applies to, and it defaults to **true**: an item nobody classified blocks approval rather than being waved through. Nothing in the system sets it false automatically.

**The ZJD is the desk that decides.** In `BBAS_STANDARD` the only `APPROVE` and `REJECT`
transitions leave `ZJD_REVIEW`. `APPLICATION_APPROVE` and `APPLICATION_REJECT` were briefly
held only by the Commissioner — the apex of the older `BP_STANDARD` chain — which left the
ZJD owning a desk it could not act at and every application filed after the realignment
unapprovable. `tests/integration/rbac-seed.test.ts` now asserts the general property: no
active transition may name a capability that none of its stage's owner roles hold.
`ORDER_REVOKE` stays with the Commissioner in both chains.

**No administrative override is implemented.** The requirement contemplates that one might be configured in future, but per Rule 6 an unimplemented override is the restrictive default, so there is no capability, no settings key and no code path that bypasses this guard. Adding one later is a deliberate, separately authorised change — not a configuration flag someone can find and flip.

Implementation notes that make the guard trustworthy rather than merely present:

- `applications.openShortfalls` is a denormalised counter maintained by the engine inside the same transaction that opens or closes a shortfall. The guard reads the counter for speed but **re-verifies with a live count inside the approval transaction**, so a stale counter can never authorise an approval.
- The counter is also recomputed by a nightly consistency job that alerts on any divergence.
- The Commissioner's action bar shows `APPROVE` disabled with the reason *"3 shortfalls are still open — these must be resolved before approval."* and links to them.

## F.6 Effects

Ordered, executed inside the transition's transaction.

| Effect | Parameters | Does |
|---|---|---|
| `RAISE_SHORTFALL` | `kind`, `mode`, `items[]` | Creates the shortfall + items. If `mode=BLOCKING`, sets `parkedStageId` to the current stage and routes to `LTP_SHORTFALL_ACTION`. If `REPORTED`, records it and lets routing proceed. |
| `RESOLVE_SHORTFALL` | `shortfallId` | Marks resolved, decrements `openShortfalls` |
| `GENERATE_FEE_DEMAND` | `type` | Runs the fee calculator, freezes a demand |
| `RECALCULATE_FEE` | — | Issues a `REVISION` demand for the delta |
| `RETURN_TO_ORIGIN` | — | Routes to `parkedStageId` and clears it. **This is what makes the return path configurable rather than hard-coded.** |
| `GENERATE_APPROVAL_ORDER` | — | Enqueues order creation + PDF |
| `CLOSE_WORKFLOW` | `status` | Marks the instance COMPLETED, cancels open tasks |
| `NOTIFY` | `eventCode` | Writes an outbox row (usually implicit via `notifyEvent`) |
| `START_SLA` / `PAUSE_SLA` / `RESUME_SLA` / `STOP_SLA` | — | Clock control |

## F.7 The two shortfall shapes, side by side

This is the distinction the requirement is emphatic about, so it is worth being explicit.

```
BLOCKING (RAISE_*)                      REPORTED (REPORT_*_AND_FORWARD)
─────────────────────                   ──────────────────────────────
ZJD_REVIEW                              ZJD_REVIEW
   │ RAISE_FEE_SHORTFALL                   │ REPORT_FEE_SHORTFALL_AND_FORWARD
   │ effects:                               │ effects:
   │  RAISE_SHORTFALL(FEE, BLOCKING)        │  RAISE_SHORTFALL(FEE, REPORTED)
   │  GENERATE_FEE_DEMAND(SHORTFALL)        │  GENERATE_FEE_DEMAND(SHORTFALL)
   │  PAUSE_SLA                             │  (SLA continues)
   ▼                                        ▼
LTP_SHORTFALL_ACTION                    DIRECTOR_DP_REVIEW
 parkedStageId = ZJD_REVIEW              shortfall travels with the file,
 status = ZJD_FEE_SHORTFALL              visible to every later officer
   │ LTP pays                              │
   │ ACCEPT_RESOLUTION                     │ … reaches COMMISSIONER_REVIEW
   │ effects: RETURN_TO_ORIGIN             │ APPROVE blocked by guard
   ▼                                       │ no_open_shortfalls
ZJD_REVIEW  ← resumes exactly where it     ▼
            left off                     must be settled before approval
```

Same engine. Same tables. Two configuration rows.

## F.8 Scrutiny as a configurable gate

*(Ratified 25 Aug 2026.)* Because no real scrutiny engine is confirmed, the pipeline must work whether or not scrutiny runs. `application_types.requiresScrutiny` decides, per type:

**Gate on** (default): `LTP_DRAFT → LTP_DRAWING → [scrutiny] → LTP_DOCUMENTS`

**Gate off**: transition 4a fires on submission instead, and the drawing is still versioned, stored and visible to officers — it simply is not machine-checked.

| # | From stage | From status | Action | Guards | To stage | To status |
|---|---|---|---|---|---|---|
| 4a | `LTP_DRAWING` | `DRAWING_UPLOADED` | `SUBMIT_DRAWING` | `drawing_uploaded`, `scrutiny_gate_disabled` | `LTP_DOCUMENTS` | `DOCUMENT_UPLOAD_PENDING` |

Both rows exist in the seed; their guards are mutually exclusive, so exactly one is ever available. Turning the gate off is a configuration change, not a code path, and the departmental review that follows is unaffected either way — TPA's technical scrutiny worksheet remains the human check regardless.

**Why this matters now.** With scrutiny mocked, the honest position is that automated compliance checking is not yet a real control. Making the gate explicitly switchable keeps that visible rather than letting a mock PASS masquerade as a compliance decision in production.

---

# G. Workflow Transition Matrix

The seed for `workflow_transitions`. `⟨parked⟩` means the effect chooses the destination.

## G.1 LTP phase

| # | From stage | From status | Action | Role | Guards | Effects | To stage | To status | Notify |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `LTP_DRAFT` | `DRAFT` | `SUBMIT_DRAWING` | LTP | `drawing_uploaded` | — | `LTP_DRAWING` | `SCRUTINY_IN_PROGRESS` | `DRAWING_UPLOADED` |
| 2 | `LTP_DRAWING` | `SCRUTINY_IN_PROGRESS` | `SCRUTINY_FAILED` | SYSTEM | — | — | `LTP_DRAWING` | `SCRUTINY_FAILED` | `SCRUTINY_FAILED` |
| 3 | `LTP_DRAWING` | `SCRUTINY_FAILED` | `SUBMIT_DRAWING` | LTP | `drawing_uploaded` | — | `LTP_DRAWING` | `SCRUTINY_IN_PROGRESS` | `DRAWING_UPLOADED` |
| 4 | `LTP_DRAWING` | `SCRUTINY_IN_PROGRESS` | `SCRUTINY_PASSED` | SYSTEM | — | — | `LTP_DOCUMENTS` | `DOCUMENT_UPLOAD_PENDING` | `SCRUTINY_PASSED` |
| 5 | `LTP_DOCUMENTS` | `DOCUMENT_UPLOAD_PENDING` | `SUBMIT_DOCUMENTS` | LTP | `documents_complete` | `GENERATE_FEE_DEMAND(ORIGINAL)` | `LTP_PAYMENT` | `FEE_GENERATED` | `FEE_GENERATED` |
| 6 | `LTP_PAYMENT` | `FEE_GENERATED` | `CONFIRM_PAYMENT` | SYSTEM | `fees_paid` | `START_SLA` | `TPA_REVIEW` | `PENDING_TPA` | `PAYMENT_SUCCESSFUL` |

Rows 2, 4 and 6 are raised by the system, never by a user. `PAYMENT_FAILED` sets the status without moving the stage — §6's rule that failure must not advance the application is enforced by the absence of a transition, not by an `if`.

## G.2 Review stages

Rows 7–10 repeat per review stage. Written once here with the stage as a parameter; the seed expands them.

| # | From stage | Action | Role | Guards | Effects | To stage | To status |
|---|---|---|---|---|---|---|---|
| 7 | *any review stage* | `FORWARD` | stage owner | `has_remarks` | `STOP_SLA`, `START_SLA` | next stage by sequence | next stage's entry status |
| 8 | *any review stage* | `RAISE_DOCUMENT_SHORTFALL` | stage owner | `has_remarks` | `RAISE_SHORTFALL(DOCUMENT, BLOCKING)`, `PAUSE_SLA` | `LTP_SHORTFALL_ACTION` | `<STAGE>_DOCUMENT_SHORTFALL` |
| 9 | *any review stage* | `RAISE_FEE_SHORTFALL` | stage owner | `has_remarks` | `RAISE_SHORTFALL(FEE, BLOCKING)`, `GENERATE_FEE_DEMAND(SHORTFALL)`, `PAUSE_SLA` | `LTP_SHORTFALL_ACTION` | `<STAGE>_FEE_SHORTFALL` |
| 10 | *any review stage* | `RETURN_TO_PREVIOUS` | stage owner | `has_remarks` | `STOP_SLA`, `START_SLA` | previous stage | previous entry status |

### Concrete expansion

| From | Action | To stage | To status |
|---|---|---|---|
| `TPA_REVIEW` | `FORWARD` | `ZAD_ZDD_REVIEW` | `PENDING_ZAD_ZDD` |
| `TPA_REVIEW` | `RAISE_DOCUMENT_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `TPA_DOCUMENT_SHORTFALL` |
| `TPA_REVIEW` | `RAISE_FEE_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `TPA_FEE_SHORTFALL` |
| `TPA_REVIEW` | `RAISE_TECHNICAL_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `TPA_TECHNICAL_SHORTFALL` |
| `ZAD_ZDD_REVIEW` | `FORWARD` | `ZJD_REVIEW` | `PENDING_ZJD` |
| `ZAD_ZDD_REVIEW` | `RAISE_DOCUMENT_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `ZAD_ZDD_SHORTFALL` |
| `ZAD_ZDD_REVIEW` | `RAISE_CLARIFICATION` | `LTP_SHORTFALL_ACTION` | `ZAD_ZDD_SHORTFALL` |
| `ZJD_REVIEW` | `FORWARD` | `DIRECTOR_DP_REVIEW` | `PENDING_DIRECTOR_DP` |
| `ZJD_REVIEW` | `RAISE_DOCUMENT_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `ZJD_SHORTFALL` |
| `ZJD_REVIEW` | `RAISE_FEE_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `ZJD_FEE_SHORTFALL` |
| **`ZJD_REVIEW`** | **`REPORT_FEE_SHORTFALL_AND_FORWARD`** | **`DIRECTOR_DP_REVIEW`** | **`PENDING_DIRECTOR_DP`** |
| `DIRECTOR_DP_REVIEW` | `FORWARD` | `ADDL_COMMISSIONER_REVIEW` | `PENDING_ADDITIONAL_COMMISSIONER` |
| `DIRECTOR_DP_REVIEW` | `RAISE_SHORTFALL`* | `LTP_SHORTFALL_ACTION` | `DIRECTOR_SHORTFALL` |
| **`DIRECTOR_DP_REVIEW`** | **`REPORT_SHORTFALL_AND_FORWARD`** | **`ADDL_COMMISSIONER_REVIEW`** | **`DIRECTOR_REPORTED_SHORTFALL`** |
| `ADDL_COMMISSIONER_REVIEW` | `FORWARD` | `COMMISSIONER_REVIEW` | `PENDING_COMMISSIONER` |
| `ADDL_COMMISSIONER_REVIEW` | `RAISE_DOCUMENT_SHORTFALL` | `LTP_SHORTFALL_ACTION` | `ADDITIONAL_COMMISSIONER_SHORTFALL` |
| `ADDL_COMMISSIONER_REVIEW` | `RETURN_TO_PREVIOUS` | `DIRECTOR_DP_REVIEW` | `PENDING_DIRECTOR_DP` |

\* `RAISE_SHORTFALL` at Director level is seeded as `RAISE_DOCUMENT_SHORTFALL`; §13 does not say which kind, so all three kinds are granted and the Director chooses. See Q6.

The Additional Commissioner's set is a **provisional seed** — §14 says only "configurable according to workflow configuration". See Q5.

## G.3 Shortfall, approval and terminal

| # | From stage | From status | Action | Role | Guards | Effects | To stage | To status | Notify |
|---|---|---|---|---|---|---|---|---|---|
| 11 | `LTP_SHORTFALL_ACTION` | *any* | `RESUBMIT` | LTP | `has_remarks` | — | `LTP_SHORTFALL_ACTION` | *unchanged* | `SHORTFALL_RESPONDED` |
| 12 | `LTP_SHORTFALL_ACTION` | *any* | `ACCEPT_RESOLUTION` | raising role | — | `RESOLVE_SHORTFALL`, `RETURN_TO_ORIGIN`, `RESUME_SLA` | ⟨parked⟩ | parked stage's working status | `SHORTFALL_RESOLVED` |
| 13 | `LTP_SHORTFALL_ACTION` | *any* | `REJECT_RESOLUTION` | raising role | `has_remarks` | — | `LTP_SHORTFALL_ACTION` | *unchanged* | `SHORTFALL_REJECTED` |
| 14 | `COMMISSIONER_REVIEW` | `PENDING_COMMISSIONER`, `COMMISSIONER_REVIEW` | `APPROVE` | COMMISSIONER | `no_open_shortfalls`, `fees_paid`, `has_remarks` | `GENERATE_APPROVAL_ORDER`, `STOP_SLA`, `CLOSE_WORKFLOW(APPROVED)` | `CLOSED_APPROVED` | `APPROVED` | `APPLICATION_APPROVED` |
| 15 | `COMMISSIONER_REVIEW` | *as above* | `REJECT` | COMMISSIONER | `has_remarks` | `STOP_SLA`, `CLOSE_WORKFLOW(REJECTED)` | `CLOSED_REJECTED` | `REJECTED` | `APPLICATION_REJECTED` |
| 16 | `COMMISSIONER_REVIEW` | *as above* | `RAISE_DOCUMENT_SHORTFALL` | COMMISSIONER | `has_remarks` | `RAISE_SHORTFALL(DOCUMENT, BLOCKING)`, `PAUSE_SLA` | `LTP_SHORTFALL_ACTION` | `COMMISSIONER_REVIEW` | `SHORTFALL_RAISED` |
| 17 | `COMMISSIONER_REVIEW` | *as above* | `RETURN_TO_PREVIOUS` | COMMISSIONER | `has_remarks` | `STOP_SLA`, `START_SLA` | `ADDL_COMMISSIONER_REVIEW` | `PENDING_ADDITIONAL_COMMISSIONER` | `APPLICATION_RETURNED` |

Row 14 carries the approval guard decided in F.5.1: an application holding *any* open shortfall — blocking or merely reported, of any kind — physically cannot be approved, because `no_open_shortfalls` fails and the transaction never opens. This is the single most important guard in the system, and it is the one with no override.

## G.4 Validation rules for the transition editor

`/admin/workflows/[id]/transitions` refuses to publish a workflow that fails any of these. This is what keeps a configurable engine from becoming a footgun.

1. Every non-terminal stage has at least one outbound transition.
2. Every stage except the entry stage is reachable from the entry stage.
3. At least one path from the entry stage reaches a terminal stage.
4. No two active transitions share `(fromStage, action, fromStatus)`.
5. Every `allowedRoleKeys` entry is a subset of the from-stage's `ownerRoleKeys`.
6. Every guard name and effect type is in the engine's registry.
7. `RETURN_TO_ORIGIN` only appears on transitions out of a stage typed `LTP_ACTION`.
8. A transition with `toStageId = null` must carry an effect that sets a destination.
9. Exactly one stage is terminal-approved; at least one is terminal-rejected.
10. Publishing pins the version. Running instances keep the version they started on, so editing configuration never corrupts an in-flight application.

## G.5 Concurrency

Two officers opening the same task is normal; both acting on it must not be.

- `performAction` opens with `SELECT … FOR UPDATE` on the `workflow_instances` row.
- The client sends the `historySequence` it rendered; a mismatch returns 409 *"This application has moved on — reload to see the current state."*
- Task claiming is a conditional update: `UPDATE workflow_tasks SET claimed... WHERE id = ? AND status = 'PENDING'`. Zero rows affected means someone else took it.
- The partial unique index `one_open_task` makes a duplicate open task impossible at the database level, not merely unlikely.

---

# H. What was built, and where it departs from the sketch

*(Written after delivery. F and G above are the design; this is the record of the
engine that exists, and every place the two differ.)*

## H.1 The files

| File | Holds |
|---|---|
| `src/server/workflow/engine.ts` | Resolution, authorisation, guards, effects, the write. The only file that reads `workflow_transitions`, and it names no stage. |
| `src/server/workflow/guards.ts` | The guard registry. An unknown guard name FAILS — a typo in configuration must never silently permit. |
| `src/server/workflow/effects.ts` | The effect registry. An unknown effect type THROWS, abandoning the transition. |
| `src/server/workflow/assignment.ts` | Who the next task goes to, from `workflow_assignments`. |
| `src/server/workflow/sla.ts` | The clock: working days, holidays, pause, carry-over, the sweep. |
| `src/server/workflow/tasks.ts` | The officer queue, and claim / release / reassign. |
| `src/server/workflow/validate.ts` | G.4, as code. The seed publishes only a graph that passes it. |
| `prisma/seed/09-workflow.ts` | **Every stage, action, transition, SLA rule and assignment rule.** All of the policy, none of the mechanism. |

## H.2 Where the engine's authority begins

The instance is created at the PAYMENT GATE, not at filing. `startWorkflow` runs
inside the settlement transaction, creates the instance at `LTP_PAYMENT` and
immediately performs the seeded `CONFIRM_PAYMENT` transition — so the first row
of every file's history is the payment that carried it to the department, and
§8's "only a confirmed payment may do this" is true by construction rather than
by convention.

The applicant-side stages are seeded as catalogue entries but carry no
transitions, because the filing services built in Phases 2–5 drive that phase
directly. Configuration that nothing executes would be a lie about how the
system works, so it is not written.

## H.3 The four departures

**1. An answered shortfall returns to the officer's desk.** G.3 rows 11–13 keep
the file at `LTP_SHORTFALL_ACTION` and have the officer accept from there. As
built, `RESUBMIT` carries it back to the parked stage with status
`SHORTFALL_RESPONDED`, and the officer accepts or rejects from their own stage.

The reason is the queue. A task belongs to a stage, and the stage's owner roles
decide whose inbox it appears in — so an answer left at the applicant's stage
sits in an inbox addressed to the applicant, and the officer waiting for it
never sees it arrive.

**2. `RESOLVE_REPORTED_SHORTFALL` exists.** F.7 describes a REPORTED shortfall
travelling with the file "until someone resolves it" without saying who or how.
Nobody could: it never parks the file, so there is no origin to return to and no
`RESUBMIT` to answer it — and an open shortfall of either mode blocks approval
absolutely, so a file carrying one could never have been approved. Every review
desk now has the action. The applicant settles the matter by paying or
supplying; the officer holding the file records that it is settled.

*The integration suite found this, not review.* The test that walks §12's fee
shortfall to approval could not be made to pass, which is the outcome a test
suite is for.

**3. A transition may leave the file where it is.** Accepting a response or
closing a reported shortfall is not a movement, so a same-stage transition keeps
the existing task. Completing one and opening an identical one would reset the
SLA clock, empty and refill an inbox, and tell the queue the file had just
arrived.

**4. Guards are of two kinds.** A failing READINESS guard leaves the action on
screen, disabled, carrying its reason. A failing APPLICABILITY guard
(`shortfall_awaiting_review`, `reported_shortfall_open`) hides it. A permanently
disabled "Close reported shortfall" on every file that never had one is
furniture, and furniture is how people learn to stop reading the action bar.

## H.4 G.4, as implemented

Nine of the ten rules are as written. Rule 2 became *reachability is computed
from the stage flagged `isEntry`*, and applicant-side stages are exempt because
they are catalogue entries rather than part of the engine's graph. Rule 5 is
enforced strictly — every `allowedRoleKeys` entry must be one of the from-stage's
owners — which the departure in H.3.1 is what makes possible: every action is now
performed at a stage the actor owns.

Three constraints were added below the validator, because a rule the database
enforces cannot be forgotten: one catch-all transition per (stage, action), one
catch-all assignment rule per (stage, role), and exactly one entry stage per
workflow. All three exist because `NULL <> NULL` in a unique index, so the
model's own keys do not stop the ambiguous case.

## H.5 The statuses added

| Status | Why it exists |
|---|---|
| `RETURNED_TO_APPLICANT` | The file is with the applicant with no specific shortfall kind — a first-desk return, or a rejected response. |
| `SHORTFALL_RESPONDED` | The applicant has answered and the file is back at the raising desk, awaiting a verdict. |
| `COMMISSIONER_SHORTFALL` | G.3 row 16 had the Commissioner's shortfall setting the status to `COMMISSIONER_REVIEW`, which reads as "with the Commissioner" while the file sits with the applicant. |
