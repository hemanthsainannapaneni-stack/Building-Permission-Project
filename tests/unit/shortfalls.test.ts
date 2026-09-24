import { describe, it, expect } from 'vitest';
import {
  CLOSED_SHORTFALL_ITEM_STATUSES,
  SHORTFALL_ITEM_STATUS,
  SHORTFALL_STATUS,
  SHORTFALL_TRANSITIONS,
  canTransition,
  currentCycle,
  cycleLabel,
  isItemSettled,
  isShortfallOpen,
  itemStatusLabel,
  itemTally,
  shortfallSla,
  turnOf,
  whyNotTransition,
} from '@/lib/shortfalls';

/**
 * The shortfall vocabulary, checked where it is cheapest to check.
 *
 * Everything here is pure and isomorphic — the same functions the server uses
 * to refuse a transition and the client uses to decide which buttons exist. A
 * disagreement between those two is the bug this file is written against, and
 * it is knowable in milliseconds.
 */

const DAY = 86_400_000;

describe('the item lifecycle', () => {
  it('treats only accepted and waived items as settled', () => {
    expect(isItemSettled(SHORTFALL_ITEM_STATUS.ACCEPTED)).toBe(true);
    expect(isItemSettled(SHORTFALL_ITEM_STATUS.WAIVED)).toBe(true);
    expect(isItemSettled(SHORTFALL_ITEM_STATUS.PENDING)).toBe(false);
    expect(isItemSettled(SHORTFALL_ITEM_STATUS.RESPONDED)).toBe(false);
    expect(isItemSettled(SHORTFALL_ITEM_STATUS.REJECTED)).toBe(false);
  });

  it('treats a status it has never heard of as outstanding', () => {
    // The safe direction, and the reason the CLOSED set is the one enumerated:
    // a status added later blocks approval until somebody decides it should
    // not, rather than silently waving files through.
    expect(isItemSettled('SOMETHING_NEW')).toBe(false);
    expect(CLOSED_SHORTFALL_ITEM_STATUSES).toHaveLength(2);
  });

  it('labels every status it defines', () => {
    for (const status of Object.values(SHORTFALL_ITEM_STATUS)) {
      expect(itemStatusLabel(status)).not.toBe(status);
    }
  });
});

describe('itemTally', () => {
  it('counts resolved, pending and mandatory-pending apart', () => {
    const tally = itemTally([
      { status: 'ACCEPTED', isResolved: true, isMandatory: true },
      { status: 'REJECTED', isResolved: false, isMandatory: true },
      { status: 'PENDING', isResolved: false, isMandatory: false },
      { status: 'RESPONDED', isResolved: false, isMandatory: true },
    ]);

    expect(tally).toEqual({ total: 4, resolved: 1, pending: 3, mandatoryPending: 2 });
  });

  it('lets isResolved win over a status that disagrees', () => {
    // `isResolved` is the column the approval guard reads. A row where the two
    // disagree must not be able to make the register say "resolved" while the
    // guard blocks, or the other way round.
    const tally = itemTally([{ status: 'PENDING', isResolved: true, isMandatory: true }]);
    expect(tally.resolved).toBe(1);
    expect(tally.mandatoryPending).toBe(0);
  });

  it('treats an item with no status at all as resolved when isResolved says so', () => {
    // Rows written before item statuses existed. Counting them as unresolved
    // would retroactively block files that were correctly settled.
    expect(itemTally([{ isResolved: true }]).resolved).toBe(1);
    expect(itemTally([{ isResolved: false }]).mandatoryPending).toBe(1);
  });

  it('treats an unclassified item as mandatory', () => {
    // Matching the column default. An item nobody classified blocks.
    expect(itemTally([{ status: 'PENDING', isResolved: false }]).mandatoryPending).toBe(1);
  });

  it('is empty-safe', () => {
    expect(itemTally([])).toEqual({ total: 0, resolved: 0, pending: 0, mandatoryPending: 0 });
  });
});

describe('currentCycle', () => {
  it('puts an unanswered shortfall on cycle 1', () => {
    // Not cycle 0: the applicant HAS been asked, once.
    expect(currentCycle(SHORTFALL_STATUS.ACTION_REQUIRED, [])).toBe(1);
    expect(currentCycle(SHORTFALL_STATUS.RAISED, [])).toBe(1);
  });

  it('stays on the cycle an unjudged answer belongs to', () => {
    // Answered and waiting: nobody has asked again, so the cycle has not moved.
    expect(currentCycle(SHORTFALL_STATUS.RESOLUTION_SUBMITTED, [{ attemptNo: 1 }])).toBe(1);
    expect(currentCycle(SHORTFALL_STATUS.UNDER_REVIEW, [{ attemptNo: 1 }])).toBe(1);
  });

  it('advances the moment a response is rejected', () => {
    // The applicant is now working on attempt 2, before attempt 2 exists.
    expect(currentCycle(SHORTFALL_STATUS.RESOLUTION_REJECTED, [{ attemptNo: 1 }])).toBe(2);
    expect(
      currentCycle(SHORTFALL_STATUS.RESOLUTION_REJECTED, [{ attemptNo: 1 }, { attemptNo: 2 }])
    ).toBe(3);
  });

  it('counts the highest attempt, not how many rows there are', () => {
    expect(currentCycle(SHORTFALL_STATUS.RESOLVED, [{ attemptNo: 1 }, { attemptNo: 2 }])).toBe(2);
  });

  it('labels the cycle it computed', () => {
    expect(cycleLabel(SHORTFALL_STATUS.ACTION_REQUIRED, [])).toBe('Cycle 1');
    expect(cycleLabel(SHORTFALL_STATUS.RESOLUTION_REJECTED, [{ attemptNo: 1 }])).toBe('Cycle 2');
  });
});

describe('the response clock', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('stops on a settled shortfall', () => {
    // A green "12 days left" on a resolved row reads as something outstanding.
    const sla = shortfallSla(
      { status: SHORTFALL_STATUS.RESOLVED, raisedAt: new Date(now.getTime() - 5 * DAY), dueDate: new Date(now.getTime() + 12 * DAY) },
      now
    );
    expect(sla.state).toBe('STOPPED');
    expect(sla.percent).toBeNull();
  });

  it('says so plainly when no period was set', () => {
    const sla = shortfallSla(
      { status: SHORTFALL_STATUS.ACTION_REQUIRED, raisedAt: now, dueDate: null },
      now
    );
    expect(sla.state).toBe('NO_CLOCK');
    expect(sla.label).toBe('No response period');
  });

  it('runs on track early in the period', () => {
    const sla = shortfallSla(
      {
        status: SHORTFALL_STATUS.ACTION_REQUIRED,
        raisedAt: new Date(now.getTime() - 2 * DAY),
        dueDate: new Date(now.getTime() + 12 * DAY),
      },
      now
    );
    expect(sla.state).toBe('ON_TRACK');
    expect(sla.percent).toBeGreaterThan(0);
    expect(sla.percent).toBeLessThan(75);
  });

  it('warns once three quarters of the period is gone', () => {
    const sla = shortfallSla(
      {
        status: SHORTFALL_STATUS.ACTION_REQUIRED,
        raisedAt: new Date(now.getTime() - 15 * DAY),
        dueDate: new Date(now.getTime() + 1 * DAY),
      },
      now
    );
    expect(sla.state).toBe('DUE_SOON');
  });

  it('goes overdue past the date, with a negative day count', () => {
    const sla = shortfallSla(
      {
        status: SHORTFALL_STATUS.ACTION_REQUIRED,
        raisedAt: new Date(now.getTime() - 20 * DAY),
        dueDate: new Date(now.getTime() - 3 * DAY),
      },
      now
    );
    expect(sla.state).toBe('OVERDUE');
    expect(sla.percent).toBe(100);
    expect(sla.daysLeft).toBeLessThan(0);
  });

  it('survives a due date that is not after the raise date', () => {
    // Nothing to divide by. It must not produce NaN or Infinity on a screen.
    const sla = shortfallSla(
      { status: SHORTFALL_STATUS.ACTION_REQUIRED, raisedAt: now, dueDate: now },
      now
    );
    expect(Number.isFinite(sla.percent)).toBe(true);
  });
});

describe('the state machine', () => {
  it('never leaves a settled shortfall', () => {
    expect(SHORTFALL_TRANSITIONS[SHORTFALL_STATUS.RESOLVED]).toEqual([]);
    expect(SHORTFALL_TRANSITIONS[SHORTFALL_STATUS.CANCELLED]).toEqual([]);
  });

  it('allows the full two-cycle path and nothing outside it', () => {
    // Raise → answer → reject → answer again → resolve. The path this phase
    // is built around, walked one legal step at a time.
    expect(canTransition(SHORTFALL_STATUS.ACTION_REQUIRED, SHORTFALL_STATUS.RESOLUTION_SUBMITTED)).toBe(true);
    expect(canTransition(SHORTFALL_STATUS.RESOLUTION_SUBMITTED, SHORTFALL_STATUS.RESOLUTION_REJECTED)).toBe(true);
    expect(canTransition(SHORTFALL_STATUS.RESOLUTION_REJECTED, SHORTFALL_STATUS.RESOLUTION_SUBMITTED)).toBe(true);
    expect(canTransition(SHORTFALL_STATUS.RESOLUTION_SUBMITTED, SHORTFALL_STATUS.RESOLVED)).toBe(true);

    // And the step that would settle a shortfall nobody answered.
    expect(canTransition(SHORTFALL_STATUS.RESOLVED, SHORTFALL_STATUS.RESOLUTION_SUBMITTED)).toBe(false);
  });

  it('explains a refusal in words the person refused can act on', () => {
    const why = whyNotTransition(
      SHORTFALL_STATUS.RESOLUTION_SUBMITTED,
      SHORTFALL_STATUS.RESOLUTION_SUBMITTED
    );
    expect(why).toContain('already with the department');
    expect(whyNotTransition(SHORTFALL_STATUS.ACTION_REQUIRED, SHORTFALL_STATUS.RESOLUTION_SUBMITTED)).toBeNull();
  });

  it('agrees with turnOf about who is waiting', () => {
    // Every status whose turn is the applicant's must accept a response, or
    // the screen offers a form the engine refuses.
    for (const status of Object.values(SHORTFALL_STATUS)) {
      if (turnOf(status) !== 'APPLICANT') continue;
      expect(
        canTransition(status, SHORTFALL_STATUS.RESOLUTION_SUBMITTED),
        `${status} is the applicant's turn but refuses a response`
      ).toBe(true);
    }
  });

  it('agrees with isShortfallOpen about which statuses are terminal', () => {
    for (const status of Object.values(SHORTFALL_STATUS)) {
      const terminal = (SHORTFALL_TRANSITIONS[status] ?? []).length === 0;
      if (terminal) expect(isShortfallOpen(status)).toBe(false);
    }
  });
});
