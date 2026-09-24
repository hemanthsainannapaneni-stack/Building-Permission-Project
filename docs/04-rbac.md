# H. RBAC & Permission Matrix

## H.1 The three-layer model

A permission check alone is not enough for this system. "Can TPA forward an application?" is the wrong question — the right one is "can *this* TPA officer forward *this* application *right now*?" Three layers, all server-side, all mandatory:

```
Layer 1 — CAPABILITY   Does the role hold WORKFLOW_FORWARD?
                       Enforced by defineRoute({ capabilities: [...] })
                       Coarse. Cheap. Rejects 403 before any query.
                              │
Layer 2 — ROW SCOPE    May this user see this row at all?
                       Enforced by merging scopeFor(user) into the WHERE clause,
                       never by filtering after the fetch — so counts and
                       pagination stay honest and no out-of-scope row is
                       ever loaded into memory.
                              │
Layer 3 — STAGE OWNERSHIP  Is this user an owner of the application's CURRENT
                       stage, and does a transition exist for their role?
                       Enforced by the workflow engine. This is the layer that
                       stops a TPA officer forwarding a file that is sitting
                       with the Commissioner.
```

A capability grants the *ability*; the workflow grants the *occasion*. Both are required. `TPA_REVIEW` is where this bites: every review role holds `WORKFLOW_FORWARD`, yet only one of them can act on a given application at a given moment.

## H.2 Row scope by role

```ts
// src/server/auth/scope.ts
export function applicationScope(user: AuthUser): Prisma.ApplicationWhereInput {
  if (isSystemAdmin(user)) return {};
  if (isLtp(user)) return { ltpUserId: user.id };          // own filings only
  if (isViewer(user) || isExecutive(user)) return {};       // read-only, whole register
  // Departmental officers: their jurisdiction
  const zoneIds = user.zoneIds.length ? user.zoneIds : ['__none__'];
  return { OR: [{ zoneId: { in: zoneIds } }, { zoneId: null }] };
}
```

| Role | Sees |
|---|---|
| `LTP` | Only applications where `ltpUserId = self` |
| `TPA` `ZAD` `ZDD` `ZJD` | Applications in their assigned zones |
| `DIRECTOR_DP` `ADDL_COMMISSIONER` `COMMISSIONER` | All applications (city-wide mandate) |
| `FINANCE_OFFICER` | All, but only fee/payment tabs |
| `SYSTEM_ADMIN` | All |
| `VIEWER` | All, read-only, **writes blocked at the route wrapper** regardless of capability |

`VIEWER` is enforced the way the land allotment portal does it: `blockReadOnly` in `defineRoute` rejects every non-GET before the handler runs. A capability misconfiguration cannot make an auditor account dangerous.

## H.3 Permission catalogue

51 capability keys, grouped by module. Keys are stable strings; the seed is idempotent so adding one is a re-run, not a migration.

| Module | Keys |
|---|---|
| Applications | `APPLICATION_CREATE` `APPLICATION_VIEW` `APPLICATION_VIEW_ALL` `APPLICATION_EDIT` `APPLICATION_DELETE` `APPLICATION_WITHDRAW` |
| Drawings | `DRAWING_UPLOAD` `DRAWING_VIEW` `DRAWING_DOWNLOAD` |
| Scrutiny | `SCRUTINY_REQUEST` `SCRUTINY_VIEW` |
| Documents | `DOCUMENT_UPLOAD` `DOCUMENT_VIEW` `DOCUMENT_DOWNLOAD` `DOCUMENT_VERIFY` |
| Fees | `FEE_VIEW` `FEE_GENERATE` `FEE_WAIVE` `FEE_STRUCTURE_MANAGE` |
| Payments | `PAYMENT_INITIATE` `PAYMENT_VIEW` `PAYMENT_RECONCILE` `PAYMENT_REFUND` |
| Workflow | `WORKFLOW_VIEW` `WORKFLOW_CLAIM_TASK` `WORKFLOW_FORWARD` `WORKFLOW_RETURN` `WORKFLOW_REASSIGN` `WORKFLOW_MANAGE` |
| Checklists | `CHECKLIST_VIEW` `CHECKLIST_RESPOND` `CHECKLIST_REVIEW` |
| Shortfalls | `SHORTFALL_CREATE` `SHORTFALL_VIEW` `SHORTFALL_RESPOND` `SHORTFALL_RESOLVE` |
| Approval | `APPLICATION_APPROVE` `APPLICATION_REJECT` `ORDER_VIEW` `ORDER_REVOKE` |
| Administration | `USER_MANAGE` `ROLE_MANAGE` `ORG_MANAGE` `MASTER_DATA_MANAGE` `SETTINGS_MANAGE` `NOTIFICATION_TEMPLATE_MANAGE` `INTEGRATION_MANAGE` |
| Oversight | `AUDIT_VIEW` `REPORT_VIEW` `ANALYTICS_VIEW` `NOTIFICATION_LOG_VIEW` |

## H.4 The matrix

● granted · ◐ granted but scoped to own rows · ○ not granted

| Capability | LTP | TPA | ZAD | ZDD | ZJD | DIR | AC | CMR | FIN | ADM | VWR |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `APPLICATION_CREATE` | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `APPLICATION_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `APPLICATION_VIEW_ALL` | ○ | ○ | ○ | ○ | ○ | ● | ● | ● | ● | ● | ● |
| `APPLICATION_EDIT` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `APPLICATION_DELETE` | ◐* | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `APPLICATION_WITHDRAW` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `DRAWING_UPLOAD` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `DRAWING_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● |
| `DRAWING_DOWNLOAD` | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● |
| `SCRUTINY_REQUEST` | ◐ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `SCRUTINY_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● |
| `DOCUMENT_UPLOAD` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `DOCUMENT_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `DOCUMENT_DOWNLOAD` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `DOCUMENT_VERIFY` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `FEE_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `FEE_GENERATE` | ○ | ● | ○ | ○ | ● | ● | ● | ● | ● | ● | ○ |
| `FEE_WAIVE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| `FEE_STRUCTURE_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ |
| `PAYMENT_INITIATE` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `PAYMENT_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `PAYMENT_RECONCILE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ |
| `PAYMENT_REFUND` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| `WORKFLOW_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `WORKFLOW_CLAIM_TASK` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `WORKFLOW_FORWARD` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `WORKFLOW_RETURN` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `WORKFLOW_REASSIGN` | ○ | ○ | ● | ● | ● | ● | ● | ● | ○ | ● | ○ |
| `WORKFLOW_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `SHORTFALL_CREATE` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `SHORTFALL_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `SHORTFALL_RESPOND` | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `SHORTFALL_RESOLVE` | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `APPLICATION_APPROVE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| `APPLICATION_REJECT` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| `ORDER_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `ORDER_REVOKE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| `USER_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `ROLE_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `ORG_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `MASTER_DATA_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `SETTINGS_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `NOTIFICATION_TEMPLATE_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `INTEGRATION_MANAGE` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `AUDIT_VIEW` | ◐ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `REPORT_VIEW` | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `ANALYTICS_VIEW` | ○ | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `NOTIFICATION_LOG_VIEW` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |

\* `APPLICATION_DELETE` for LTP is soft-delete of a `DRAFT` only. Once an application has a number and a drawing, it can be **withdrawn**, never deleted.

### Why the checklist takes three keys and not one

Three different people do three different things to the 19-point checklist, and
folding them together loses the distinction that matters most.

* **`CHECKLIST_RESPOND`** — the LTP ANSWERS. Held by the LTP alone.
* **`CHECKLIST_REVIEW`** — a departmental desk VERIFIES those answers. Held by
  every officer role from the TPA upward, because the BBAS manuals put the same
  checklist in front of the TPA, the ZDD and the JD in turn.
* **`CHECKLIST_VIEW`** — reads both and writes neither. Also held by Finance and
  the System Administrator, who have business reading a file and none forming a
  planning judgement on it.

**No role holds both RESPOND and REVIEW.** An applicant verifying their own
answers is the single thing this separation exists to prevent, and it is
enforced by the routes being separate — `PATCH /checklist` and
`POST /checklist/review` — rather than by a branch inside one handler. The
service reachable from the review route has no code path to the applicant's
`response` column at all.

The nearest existing grant was `SHORTFALL_CREATE`, and reusing it would have
given the Finance Officer a verification power nobody intended, because they
hold it for money reasons.

### Notes on deliberate choices

- **`ZAD` and `ZDD` are given identical grants.** §11 treats them as one review step. Whether they are alternates by zone or two sequential desks is Q4; the stage already accepts both role keys, so either answer is configuration.
- **`FEE_GENERATE` for officers** exists because raising a fee shortfall issues a demand. It does not let them edit the fee *structure*, which is `FEE_STRUCTURE_MANAGE`.
- **`SYSTEM_ADMIN` does not hold `APPLICATION_APPROVE`.** An administrator can configure the system but cannot grant a permission — the separation that makes the audit trail meaningful. They *can* grant it to themselves via `ROLE_MANAGE`, but that act is itself audited and alarming, which is the intended deterrent.

## H.3.1 On scrutiny override — removed

*(Ratified 25 Aug 2026 — resolves former Q10.)*

An earlier draft proposed a `SCRUTINY_OVERRIDE` capability so that a senior officer could pass an application over a failed automated check. **It has been removed**, because the business has not authorised officers to override a scrutiny result. The only route past a failure is the one the requirement states:

```
SCRUTINY_FAILED → LTP correction → new drawing version → re-scrutiny
```

Removed means removed: there is no capability key, no matrix row, no route, no service method and no UI affordance. A future department decision could reintroduce it as a separately authorised, narrowly granted and heavily audited capability — but nothing in the codebase anticipates it, because a dormant bypass is a bypass.

This is Rule 6 applied to an addition of our own making: the restrictive default is the one that cannot let a non-compliant drawing through.

## H.5 Enforcement points

| Where | Mechanism |
|---|---|
| Route | `defineRoute(handler, { capabilities: ['SHORTFALL_CREATE'] })` — 403 before the handler |
| Query | `where: { ...applicationScope(user), id }` merged into every read |
| Detail fetch | `assertApplicationAccess(user, id)` returns 403, not 404-then-403 |
| Action | `engine.availableActions(user, application)` — the UI renders only these, the server re-derives them on `perform` |
| Download | Signed-URL issuance re-checks capability + scope, then audits |
| Read-only | `blockReadOnly` rejects every non-GET for `VIEWER` |
| Client | `<Can capability="...">` for chrome only — **never** the sole gate |

## H.6 The test that makes this real

A single table-driven suite enumerates every `(role, endpoint, method)` pair from the route registry and asserts the outcome against this matrix. A new endpoint with no matrix entry fails the suite. This is how the matrix stays true after six months of changes rather than becoming documentation that lies.
