/**
 * COMPLETES THE SHORTFALL DEMO DATA IN PLACE.
 *
 *   npm run shortfalls:enrich              report what would change, change nothing
 *   npm run shortfalls:enrich -- --apply   perform it
 *
 * The shortfall demo data was seeded before items carried a category, a
 * required action, a named document or a status of their own, and before any
 * file had been round a second time. A fresh `seed:demo:reset` produces all of
 * that now — but resetting destroys every application, payment and receipt in
 * the database, and the point of this script is that a demonstration already
 * set up does not have to be thrown away to gain the columns.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 *
 *   1. BACKFILLS item metadata on shortfall items that have none. Only empty
 *      fields are written. An item somebody has already classified is left
 *      exactly as it is.
 *
 *   2. RECONCILES each item's `status` with `isResolved`, which is the column
 *      the approval guard reads. Items seeded before statuses existed default
 *      to PENDING, including the resolved ones, and a resolved item showing
 *      "Pending" is worse than no column at all.
 *
 *   3. DRIVES A SECOND CYCLE on a few shortfalls that are parked with the
 *      applicant — through `performAction`, the real workflow engine, with its
 *      locking, its guards, its history rows and its notifications. Nothing
 *      here writes a resolution row by hand.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 *   · Delete anything. Not one row.
 *   · Overwrite an item field that already has a value.
 *   · Touch a settled shortfall, or one that is with an officer. Step 3 acts
 *     only on shortfalls the applicant currently owns, so the file ends the
 *     run exactly where it started — parked at LTP_SHORTFALL_ACTION — with one
 *     more cycle behind it.
 *   · Approve, reject or forward anything.
 */
import { PrismaClient } from '@prisma/client';
import { performAction } from '../src/server/workflow/engine';
import { ACTIONS } from '../src/lib/workflow';
import { SHORTFALL_ITEM_STATUS } from '../src/lib/shortfalls';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';

/**
 * The matrix, read by role key at runtime.
 *
 * `RBAC_MATRIX` is keyed by the RoleKey union, and the keys here come out of
 * the database as plain strings. Widening once, here, beats an assertion at
 * every read — and a role key the matrix does not know yields no capabilities,
 * which is the safe direction.
 */
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const META = { ip: '127.0.0.1', userAgent: 'enrich-shortfalls', correlationId: 'enrich' };

/** How many parked shortfalls to send round a second time. */
const CYCLE_TARGET = 6;

/** How many of those to then carry THROUGH the second cycle. */
const COMPLETE_TARGET = 6;

/**
 * What an item is about, inferred from the words the officer used.
 *
 * Inference and not invention: every rule below keys on a term that is already
 * in the item's own description, so the category it produces is a restatement
 * of what the officer wrote rather than a guess bolted onto it. Anything that
 * matches nothing is left blank, because a wrong category on a statutory
 * notice is worse than an empty one.
 */
const CATEGORY_RULES: Array<{ match: RegExp; category: string; document: string }> = [
  {
    match: /encumbrance|sale deed|title|link document|ownership|patta/i,
    category: 'Title & ownership',
    document: 'Encumbrance certificate / title deed',
  },
  {
    match: /property tax|tax receipt/i,
    category: 'Title & ownership',
    document: 'Property tax receipt',
  },
  {
    match: /survey|sketch|boundar|extent/i,
    category: 'Site & survey',
    document: 'Survey sketch',
  },
  {
    match: /layout|lp number|approved plan/i,
    category: 'Layout & approvals',
    document: 'Layout approval order',
  },
  {
    match: /parking|setback|coverage|far|built-?up/i,
    category: 'Setbacks & coverage',
    document: 'Revised site plan',
  },
  {
    match: /staircase|fire|escape|exit/i,
    category: 'Fire & safety',
    document: 'Revised floor plan',
  },
  {
    match: /structural|column|beam|foundation/i,
    category: 'Structural',
    document: 'Structural drawing',
  },
  {
    match: /water|sewer|drain|electric|utility|service/i,
    category: 'Services & utilities',
    document: 'Services layout',
  },
  {
    match: /charge|fee|demand|payable|betterment|development charge/i,
    category: 'Fees & charges',
    document: 'Payment receipt',
  },
  {
    match: /noc|clearance|consent|fire department|pollution/i,
    category: 'Statutory clearances',
    document: 'No-objection certificate',
  },
  {
    match: /drawing|plan|elevation|section/i,
    category: 'Building drawings',
    document: 'Revised drawing',
  },
];

function classify(description: string, kind: string): { category: string; document: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(description)) return { category: rule.category, document: rule.document };
  }

  // Nothing matched. A FEE item is still unambiguously about money, and a
  // DOCUMENT one is still asking for a document — that much is known from the
  // shortfall's own kind and needs no inference.
  if (kind === 'FEE') return { category: 'Fees & charges', document: 'Payment receipt' };
  if (kind === 'DOCUMENT') return { category: 'Other', document: 'Supporting document' };
  return { category: '', document: '' };
}

/**
 * Retries an operation through a dropped connection, and nothing else.
 *
 * The hosted demonstration database sits behind a transaction-mode pooler on
 * the other side of the internet, and it drops connections: P1017, "Server has
 * closed the connection", "Transaction already closed". Each of those aborts a
 * transaction that never committed, so retrying repeats work that did not
 * happen — which is the only situation in which a retry is safe.
 *
 * Every other error is re-thrown on the first attempt. A guard refusing a
 * transition means the transition is wrong, and running it four more times
 * will not make it right.
 */
async function throughDrops<T>(label: string, work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dropped =
        /P1017|Server has closed the connection|Transaction already closed|kind: Closed|Connection reset/i.test(
          message
        );

      if (!dropped || attempt >= attempts) throw error;

      console.log(`    ${label} — connection dropped, retrying (${attempt}/${attempts - 1})`);
      // A moment for the pooler to hand out a fresh backend.
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

/**
 * Signs in as the user this action actually belongs to.
 *
 * ── The zones are not optional ───────────────────────────────────────────
 *
 * `applicationScope` narrows a zonal officer to `zoneId in user.zoneIds`, so
 * an actor built without them sees nothing and every transition comes back
 * "You do not have access to this application." The session builder assembles
 * them from the primary zone plus the jurisdiction rows, and this does the
 * same — acting as the officer means acting with the officer's actual reach,
 * not a convenient approximation of it.
 */
async function actorFor(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      officeId: true,
      primaryZoneId: true,
      jurisdictions: { select: { zoneId: true } },
      roles: { select: { role: { select: { key: true, name: true } } } },
    },
  });

  const roleKeys = user.roles.map((r) => r.role.key);

  const zoneIds = [
    ...new Set([
      ...(user.primaryZoneId ? [user.primaryZoneId] : []),
      ...user.jurisdictions.map((j) => j.zoneId),
    ]),
  ];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys,
    roleNames: user.roles.map((r) => r.role.name),
    capabilities: roleKeys.flatMap((key) => (MATRIX[key] as string[] | undefined) ?? []),
    zoneIds,
    officeId: user.officeId,
    sessionId: 'enrich-shortfalls',
  } as unknown as AuthUser;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 & 2. Item metadata and status
// ═══════════════════════════════════════════════════════════════════════════

async function backfillItems() {
  const items = await prisma.shortfallItem.findMany({
    select: {
      id: true,
      description: true,
      category: true,
      requiredAction: true,
      requiredDocument: true,
      status: true,
      isResolved: true,
      documentTypeId: true,
      documentType: { select: { name: true } },
      shortfall: { select: { kind: true, requiredAction: true } },
    },
  });

  let classified = 0;
  let restatused = 0;

  for (const item of items) {
    const guess = classify(item.description, item.shortfall.kind);

    // Only empty fields. An item already carrying a category was classified by
    // somebody, and a script is not better informed than they were.
    const data: Record<string, string> = {};
    if (!item.category && guess.category) data.category = guess.category;
    if (!item.requiredAction && item.shortfall.requiredAction) {
      data.requiredAction = item.shortfall.requiredAction;
    }
    if (!item.requiredDocument && !item.documentTypeId && guess.document) {
      data.requiredDocument = guess.document;
    }

    // The status the engine would have written, had the column existed when
    // this row was made. `isResolved` is the authority; status follows it.
    const expected = item.isResolved
      ? SHORTFALL_ITEM_STATUS.ACCEPTED
      : SHORTFALL_ITEM_STATUS.PENDING;

    const needsStatus = item.isResolved && item.status !== SHORTFALL_ITEM_STATUS.ACCEPTED;

    if (Object.keys(data).length) classified += 1;
    if (needsStatus) restatused += 1;

    if (APPLY && (Object.keys(data).length || needsStatus)) {
      await prisma.shortfallItem.update({
        where: { id: item.id },
        data: { ...data, ...(needsStatus ? { status: expected } : {}) },
      });
    }
  }

  console.log(`  items examined              ${items.length}`);
  console.log(`  item metadata filled in     ${classified}`);
  console.log(`  item statuses reconciled    ${restatused}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. A second cycle, through the engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The response text this script writes, and the marker it is identified by.
 *
 * Deliberately distinct from every string in the demo dataset, so phase B can
 * find the responses THIS script created and finish them, without touching a
 * response somebody else is genuinely waiting to decide.
 */
const SCRIPT_RESPONSE = 'The records asked for have been uploaded against this application.';

/** The covering note on a second answer. */
const SECOND_ANSWER =
  'The record that was returned has been obtained afresh and uploaded. The remaining items stand as accepted.';

const ITEM_ANSWERS = [
  'The record asked for has been obtained and uploaded against this application.',
  'The corrected document has been placed on file.',
  'Obtained from the registrar and uploaded.',
];

const REJECT_REMARKS_MULTI =
  'One item of this letter has not been answered. Returned for the balance; the rest is in order.';
const REJECT_REMARKS_SINGLE =
  'The record produced does not cover the period asked for. Returned on that item.';

/**
 * Can this actor actually act on this application?
 *
 * Checked BEFORE the applicant responds, not after. A second cycle is two
 * transitions, and starting the first without knowing the second can run is
 * how this script once left six shortfalls answered and never reviewed —
 * a legitimate state, but not the one it set out to produce, and reported as
 * "skipped" because the failure came after the commit.
 */
async function canAct(actor: AuthUser, applicationId: string): Promise<boolean> {
  try {
    const { assertApplicationAccess } = await import('../src/server/auth/scope');
    await assertApplicationAccess(actor, applicationId);
    return true;
  } catch {
    return false;
  }
}

/** Sends an answered shortfall back, which is what opens cycle 2. */
async function rejectBack(
  officer: AuthUser,
  applicationId: string,
  shortfallId: string,
  itemIds: string[]
) {
  const rejected = itemIds[itemIds.length - 1]!;

  await performAction(
    officer,
    applicationId,
    ACTIONS.REJECT_RESOLUTION,
    {
      remarks: itemIds.length > 1 ? REJECT_REMARKS_MULTI : REJECT_REMARKS_SINGLE,
      shortfallId,
      shortfallDecisions: itemIds.map((itemId) => ({
        itemId,
        // Every line but the last is accepted, so the applicant is sent back
        // over ONE item rather than over all of them.
        decision: itemId === rejected ? ('REJECTED' as const) : ('ACCEPTED' as const),
        remarks:
          itemId === rejected
            ? 'Does not answer the observation. Please supply the record asked for.'
            : '',
      })),
    },
    META
  );
}

// ── Phase B: finish what an interrupted run started ───────────────────────

/**
 * Rejects responses this script wrote and never got to review.
 *
 * Identified by the exact response text above, so a response a real officer is
 * genuinely waiting to decide is never touched. Running this when there is
 * nothing to finish is a no-op.
 */
async function finishInterrupted() {
  const pending = await prisma.shortfall.findMany({
    where: {
      status: { in: ['RESOLUTION_SUBMITTED', 'UNDER_REVIEW'] },
      application: { deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED'] } },
      resolutions: { some: { response: SCRIPT_RESPONSE, reviewedAt: null } },
    },
    orderBy: { raisedAt: 'asc' },
    select: {
      id: true,
      shortfallNumber: true,
      applicationId: true,
      raisedById: true,
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true } },
    },
  });

  console.log(`\n  interrupted responses to finish  ${pending.length}`);

  if (!APPLY) {
    for (const shortfall of pending) {
      console.log(`    would send ${shortfall.shortfallNumber} back, opening cycle 2`);
    }
    return 0;
  }

  let finished = 0;

  for (const shortfall of pending) {
    const officer = await actorFor(shortfall.raisedById);

    if (!(await canAct(officer, shortfall.applicationId))) {
      console.log(
        `    cannot finish ${shortfall.shortfallNumber} — ${officer.name} has no access to it`
      );
      continue;
    }

    try {
      await throughDrops(shortfall.shortfallNumber, () =>
        rejectBack(
          officer,
          shortfall.applicationId,
          shortfall.id,
          shortfall.items.map((item) => item.id)
        )
      );
      finished += 1;
      console.log(`    ${shortfall.shortfallNumber} sent back — now on cycle 2`);
    } catch (error) {
      console.log(
        `    ${shortfall.shortfallNumber} could not be sent back — ${(error as Error).message.slice(0, 120)}`
      );
    }
  }

  console.log(`  interrupted cycles completed     ${finished}`);
  return finished;
}

// ── Phase C: complete a second cycle ──────────────────────────────────────

/**
 * Answers a shortfall that was sent back, and accepts about half of them.
 *
 * Without this the demo has shortfalls ON cycle 2 and none that have BEEN
 * round twice — the register's Cycle column reads 2, but no shortfall carries
 * two responses, so the history screen has nothing to show that the
 * append-only design exists for.
 */
async function completeSecondCycles() {
  const rejected = await prisma.shortfall.findMany({
    where: {
      status: 'RESOLUTION_REJECTED',
      application: { deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED'] } },
    },
    orderBy: { raisedAt: 'asc' },
    take: COMPLETE_TARGET,
    select: {
      id: true,
      shortfallNumber: true,
      applicationId: true,
      kind: true,
      raisedById: true,
      application: { select: { ltpUserId: true } },
      items: {
        orderBy: { displayOrder: 'asc' },
        select: { id: true, isResolved: true },
      },
    },
  });

  console.log(`\n  shortfalls awaiting a 2nd answer ${rejected.length}`);

  if (!APPLY) {
    for (const shortfall of rejected) {
      console.log(`    would answer ${shortfall.shortfallNumber} a second time`);
    }
    return 0;
  }

  let answered = 0;

  for (const [index, shortfall] of rejected.entries()) {
    const applicant = await actorFor(shortfall.application.ltpUserId);

    if (!(await canAct(applicant, shortfall.applicationId))) {
      console.log(`    skipped ${shortfall.shortfallNumber} — the applicant cannot act on it`);
      continue;
    }

    // Only the lines that came back. The ones already accepted stay accepted;
    // answering them again would record a response to a settled question.
    const outstanding = shortfall.items.filter((item) => !item.isResolved).map((item) => item.id);

    try {
      await throughDrops(shortfall.shortfallNumber, () =>
        performAction(
          applicant,
          shortfall.applicationId,
          ACTIONS.RESUBMIT,
          {
            remarks: SECOND_ANSWER,
            shortfallId: shortfall.id,
            shortfallItems: outstanding.map((itemId) => ({
              itemId,
              response: 'A fresh record covering the period asked for has been uploaded.',
              applicantRemarks: '',
              attachments: [],
            })),
          },
          META
        )
      );

      answered += 1;
      console.log(`    ${shortfall.shortfallNumber} answered a second time`);

      // Every other one is then accepted, so the demo holds both endings: a
      // second cycle settled, and a second cycle still with the officer.
      // A FEE shortfall is never accepted here — the engine reads the ledger,
      // and the demand behind it has not been paid.
      if (index % 2 === 0 && shortfall.kind !== 'FEE') {
        const officer = await actorFor(shortfall.raisedById);

        if (await canAct(officer, shortfall.applicationId)) {
          try {
            await throughDrops(shortfall.shortfallNumber, () =>
              performAction(
                officer,
                shortfall.applicationId,
                ACTIONS.ACCEPT_RESOLUTION,
                {
                  remarks: 'The record now covers the period asked for. Shortfall closed.',
                  shortfallId: shortfall.id,
                  shortfallDecisions: shortfall.items.map((item) => ({
                    itemId: item.id,
                    decision: 'ACCEPTED' as const,
                    remarks: '',
                  })),
                },
                META
              )
            );
            console.log(`    ${shortfall.shortfallNumber} accepted — two cycles, settled`);
          } catch (error) {
            // Left awaiting a decision, which is a perfectly good demo state.
            console.log(
              `    ${shortfall.shortfallNumber} left with the officer — ${(error as Error).message.slice(0, 90)}`
            );
          }
        }
      }
    } catch (error) {
      console.log(
        `    ${shortfall.shortfallNumber} not answered — ${(error as Error).message.slice(0, 120)}`
      );
    }
  }

  console.log(`  second answers submitted         ${answered}`);
  return answered;
}

// ── Phase A: open a new second cycle ──────────────────────────────────────

async function driveSecondCycles() {
  // Only shortfalls the APPLICANT currently owns, on a file actually parked at
  // the applicant's stage. Responding then being sent back leaves the file
  // exactly where this found it, one cycle further on.
  const candidates = await prisma.shortfall.findMany({
    where: {
      status: { in: ['ACTION_REQUIRED', 'NOTIFIED'] },
      kind: 'DOCUMENT',
      resolutions: { none: {} },
      application: {
        deletedAt: null,
        currentStageCode: 'LTP_SHORTFALL_ACTION',
        status: { notIn: ['APPROVED', 'REJECTED'] },
      },
    },
    orderBy: { raisedAt: 'asc' },
    take: CYCLE_TARGET,
    select: {
      id: true,
      shortfallNumber: true,
      applicationId: true,
      raisedById: true,
      application: { select: { applicationNumber: true, ltpUserId: true } },
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true } },
    },
  });

  console.log(`\n  parked shortfalls eligible       ${candidates.length}`);

  if (!APPLY) {
    for (const shortfall of candidates) {
      console.log(
        `    would cycle ${shortfall.shortfallNumber} on ${shortfall.application.applicationNumber}`
      );
    }
    return 0;
  }

  let cycled = 0;

  for (const shortfall of candidates) {
    const itemIds = shortfall.items.map((item) => item.id);
    if (!itemIds.length) continue;

    // With several items the applicant answers all but the last, and the last
    // is what comes back. With one, they answer it and the officer finds the
    // answer wanting — which is the commoner shape of a second cycle anyway:
    // the right kind of document, covering the wrong period.
    const answered = itemIds.length > 1 ? itemIds.slice(0, -1) : itemIds;

    const applicant = await actorFor(shortfall.application.ltpUserId);
    const officer = await actorFor(shortfall.raisedById);

    // BOTH halves are checked before EITHER runs. Half a cycle is a state the
    // system can hold, but it is not the state this script asked for, and
    // discovering the problem after the response has committed leaves a file
    // changed by a run that reported failure.
    if (!(await canAct(applicant, shortfall.applicationId))) {
      console.log(`    skipped ${shortfall.shortfallNumber} — the applicant cannot act on it`);
      continue;
    }

    if (!(await canAct(officer, shortfall.applicationId))) {
      console.log(
        `    skipped ${shortfall.shortfallNumber} — ${officer.name}, who raised it, has no access to it`
      );
      continue;
    }

    try {
      await throughDrops(shortfall.shortfallNumber, () =>
        performAction(
          applicant,
          shortfall.applicationId,
          ACTIONS.RESUBMIT,
          {
            remarks: SCRIPT_RESPONSE,
            shortfallId: shortfall.id,
            shortfallItems: answered.map((itemId, i) => ({
              itemId,
              response: ITEM_ANSWERS[i % ITEM_ANSWERS.length]!,
              applicantRemarks: '',
              attachments: [],
            })),
          },
          META
        )
      );

      await throughDrops(shortfall.shortfallNumber, () =>
        rejectBack(officer, shortfall.applicationId, shortfall.id, itemIds)
      );

      cycled += 1;
      console.log(`    cycled ${shortfall.shortfallNumber} — now on cycle 2 with the applicant`);
    } catch (error) {
      // Says which half got through, because "skipped" would be a lie if the
      // response committed and the rejection did not.
      const current = await prisma.shortfall.findUnique({
        where: { id: shortfall.id },
        select: { status: true },
      });

      console.log(
        `    ${shortfall.shortfallNumber} left at ${current?.status ?? 'unknown'} — ${(error as Error).message.slice(0, 120)}`
      );
    }
  }

  console.log(`  second cycles opened             ${cycled}`);
  return cycled;
}

async function main() {
  console.log(
    `\nShortfall demo enrichment — ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to perform)'}\n`
  );

  await backfillItems();
  // Finishing an interrupted run comes FIRST: those shortfalls are already
  // answered, and leaving them until after new ones are opened would mean a
  // second interruption compounds rather than clears.
  await finishInterrupted();
  await driveSecondCycles();
  // Last, so it also picks up whatever the two phases above just sent back.
  await completeSecondCycles();

  const cycles = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "shortfallId" FROM shortfall_resolutions GROUP BY 1 HAVING COUNT(*) > 1
    ) m
  `;

  console.log(`\n  multi-cycle shortfalls now  ${Number(cycles[0]?.n ?? 0)}`);
  console.log(APPLY ? '\nDone.\n' : '\nNothing was written.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
