import { describe, it, expect } from 'vitest';
import { isApplicationStatus } from '@/lib/status';
import { PLAN, PLANNED_TOTAL, planItems } from '../../prisma/seed/demo/plan';
import { STAGE_CODES } from '@/lib/constants';
import { makeRng } from '../../prisma/seed/demo/rng';

/**
 * The demo plan, checked before anything is seeded.
 *
 * ── Why a test rather than a runtime check ───────────────────────────────
 *
 * The seed takes about a minute and drives seventy applications through the
 * real services. Discovering at application sixty-three that a plan entry names
 * a status the enum does not have is a minute wasted and a half-built database
 * left behind. Every one of these is knowable from the plan alone, so it is
 * knowable in milliseconds.
 */

describe('the demo plan', () => {
  it('totals the 60–70 the brief asked for', () => {
    expect(PLANNED_TOTAL).toBeGreaterThanOrEqual(60);
    expect(PLANNED_TOTAL).toBeLessThanOrEqual(70);
  });

  it('flattens to exactly that many applications', () => {
    expect(planItems()).toHaveLength(PLANNED_TOTAL);
  });

  it('names only statuses the schema actually has', () => {
    // The whole reason the brief's SENT_TO_TPA / WITH_TPA / DRAWING_REUPLOADED
    // had to be mapped onto canonical names. A plan entry naming an invented
    // status would seed an application the engine could never produce.
    //
    // This used to read the native `ApplicationStatus` enum from the Prisma
    // client. The SQLite migration turned those enums into plain String
    // columns, so the vocabulary now lives in src/lib/status.ts and this asks
    // it instead — the same guarantee, from the list that is still the one
    // place every status has to be named.
    for (const entry of PLAN) {
      expect(
        isApplicationStatus(entry.landsOn),
        `${entry.stop} lands on "${entry.landsOn}", which is not an application status`
      ).toBe(true);
    }
  });

  it('names only stages the workflow has', () => {
    const codes = new Set<string>(Object.values(STAGE_CODES));

    for (const entry of PLAN) {
      if (entry.stageCode === null) continue;
      expect(
        codes.has(entry.stageCode),
        `${entry.stop} names stage "${entry.stageCode}", which is not in STAGE_CODES`
      ).toBe(true);
    }
  });

  it('gives every stop a distinct name', () => {
    const stops = PLAN.map((entry) => entry.stop);
    expect(new Set(stops).size).toBe(stops.length);
  });

  it('gives every group a sane age window', () => {
    for (const entry of PLAN) {
      const [min, max] = entry.ageDays;
      expect(min, `${entry.stop} has a non-positive minimum age`).toBeGreaterThan(0);
      expect(max, `${entry.stop} has an inverted age window`).toBeGreaterThanOrEqual(min);
      // Nine months is the trend window the dashboards chart. A file older than
      // that would exist and be invisible on every chart, which reads as a bug.
      expect(max, `${entry.stop} is older than the trend window`).toBeLessThanOrEqual(270);
    }
  });

  it('covers every desk in the approval chain', () => {
    const staged = new Set(PLAN.map((entry) => entry.stageCode).filter(Boolean));

    for (const code of [
      STAGE_CODES.TPA_REVIEW,
      STAGE_CODES.ZDD_REVIEW,
      STAGE_CODES.ZJD_REVIEW,
      STAGE_CODES.LTP_SHORTFALL_ACTION,
      STAGE_CODES.CLOSED_APPROVED,
      STAGE_CODES.CLOSED_REJECTED,
    ]) {
      expect(staged.has(code), `no application is planned to rest at ${code}`).toBe(true);
    }
  });

  it('represents both terminal outcomes', () => {
    const lands = PLAN.map((entry) => entry.landsOn);
    expect(lands).toContain('APPROVED');
    expect(lands).toContain('REJECTED');
  });
});

describe('the demo generator', () => {
  it('is deterministic for a given seed', () => {
    // The property the whole demo rests on: the same seed produces the same
    // seventy applications, so a screenshot and a bug report agree.
    const a = makeRng(20260831);
    const b = makeRng(20260831);

    const drawA = Array.from({ length: 50 }, () => a.int(0, 1_000_000));
    const drawB = Array.from({ length: 50 }, () => b.int(0, 1_000_000));

    expect(drawA).toEqual(drawB);
  });

  it('produces a different stream for a different seed', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(Array.from({ length: 20 }, () => a.next())).not.toEqual(
      Array.from({ length: 20 }, () => b.next())
    );
  });

  it('stays inside the bounds it is given', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i += 1) {
      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);

      const f = rng.float(1.5, 2.5, 2);
      expect(f).toBeGreaterThanOrEqual(1.5);
      expect(f).toBeLessThanOrEqual(2.5);
    }
  });

  it('samples without repeating', () => {
    const rng = makeRng(11);
    const pool = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 100; i += 1) {
      const taken = rng.sample(pool, 3);
      expect(taken).toHaveLength(3);
      expect(new Set(taken).size).toBe(3);
    }
  });

  it('never asks for more than the pool holds', () => {
    const rng = makeRng(13);
    expect(rng.sample(['a', 'b'], 10)).toHaveLength(2);
  });
});
