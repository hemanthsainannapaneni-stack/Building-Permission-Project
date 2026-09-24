import { describe, it, expect } from 'vitest';
import { validateCondition, conditionError, evaluateCondition } from '@/lib/conditions';

/**
 * Validating a condition's SHAPE, with no data to evaluate it against.
 *
 * This is the check the admin save path runs, and the reason it has to exist
 * is asymmetric. `resolveRequirements()` treats a condition it cannot evaluate
 * as NOT APPLYING — right, because one bad rule must not take the checklist
 * down for every applicant — but the same forgiveness means a broken rule
 * fails SILENTLY: the document is never asked for, nothing errors, and the
 * omission surfaces months later as a file that reached an officer without a
 * certificate it needed.
 *
 * So every case below is a rule an administrator could plausibly type, and the
 * question each one asks is: would it be caught at the point of writing, or
 * would it quietly never fire?
 */

describe('conditions that are valid', () => {
  it('accepts an empty condition — "always applies"', () => {
    expect(validateCondition({})).toEqual([]);
    expect(validateCondition(null)).toEqual([]);
    expect(validateCondition(undefined)).toEqual([]);
  });

  it('accepts the seeded rules, every one of them', () => {
    const seeded = [
      { eq: ['applicant.ownerSameAsApplicant', false] },
      { or: [{ gte: ['building.numFloors', 4] }, { gt: ['building.buildingHeightM', 15] }] },
      {
        or: [
          { gt: ['building.buildingHeightM', 15] },
          { in: ['building.occupancyType', ['D_ASSEMBLY', 'C_INSTITUTIONAL', 'F_MERCANTILE']] },
        ],
      },
      { gte: ['building.numBasements', 1] },
      { exists: 'property.lpNumber' },
    ];

    for (const condition of seeded) {
      expect(validateCondition(condition), JSON.stringify(condition)).toEqual([]);
    }
  });

  it('accepts nesting, and reports the path of a problem inside it', () => {
    expect(validateCondition({ and: [{ not: { eq: ['a.b', 1] } }, { between: ['a.c', 1, 2] }] })).toEqual(
      []
    );

    const problems = validateCondition({ and: [{ eq: ['a.b', 1] }, { nonsense: ['a.c', 2] }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.path).toBe('condition.and[1]');
  });

  it('accepts the wrapper forms that let a rule compare two paths', () => {
    expect(validateCondition({ eq: [{ var: 'a.b' }, { value: 'X' }] })).toEqual([]);
  });
});

describe('conditions that would silently never fire', () => {
  it('refuses an unknown operator', () => {
    const problems = validateCondition({ greaterThan: ['building.numFloors', 4] });
    expect(problems[0]!.message).toMatch(/not a condition operator/i);
  });

  it('refuses two operators in one object, because the combining rule is a guess', () => {
    const problems = validateCondition({
      gte: ['building.numFloors', 4],
      lte: ['building.numFloors', 10],
    });
    expect(problems[0]!.message).toMatch(/exactly one operator/i);
    // And it says what to do instead.
    expect(problems[0]!.message).toMatch(/"and" or "or"/i);
  });

  it('refuses a rule written back to front', () => {
    // `{ eq: [4, "building.numFloors"] }` compares the literal 4 to the
    // literal "building.numFloors" and is false for every application ever
    // filed. Nothing at evaluation time would ever say so.
    const problems = validateCondition({ eq: [4, 'building.numFloors'] });
    expect(problems[0]!.message).toMatch(/first operand is the field/i);
    expect(evaluateCondition({ eq: [4, 'building.numFloors'] }, { building: { numFloors: 4 } })).toBe(
      false
    );
  });

  it('refuses a bare string, which isAlways() would wave through as "always"', () => {
    const problems = validateCondition('building.numFloors');
    expect(problems[0]!.message).toMatch(/must be an object/i);
  });

  it('refuses a list where an object belongs', () => {
    expect(validateCondition([{ eq: ['a.b', 1] }])[0]!.message).toMatch(/object, not a list/i);
  });

  it('refuses "and" with nothing in it', () => {
    expect(validateCondition({ and: [] })[0]!.message).toMatch(/non-empty list/i);
  });

  it('refuses the wrong number of operands', () => {
    expect(validateCondition({ exists: ['a.b', 'c'] })[0]!.message).toMatch(/takes 1 operand/i);
    expect(validateCondition({ between: ['a.b', 1] })[0]!.message).toMatch(/takes 3 operands/i);
  });

  it('refuses a "between" whose bounds are not numbers', () => {
    const problems = validateCondition({ between: ['a.b', '1', '2'] });
    expect(problems.some((p) => /two numbers/i.test(p.message))).toBe(true);
  });

  it('refuses an empty field path', () => {
    expect(validateCondition({ eq: ['', 4] })[0]!.message).toMatch(/path is empty/i);
  });

  it('reports every problem it finds, so a form can mark them all at once', () => {
    const problems = validateCondition({ between: [4, '1', '2'] });
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe('conditionError', () => {
  it('is null for a rule that will work', () => {
    expect(conditionError({ gte: ['building.numFloors', 4] })).toBeNull();
  });

  it('is a sentence for one that will not', () => {
    expect(conditionError({ nope: 1 })).toMatch(/not a condition operator/i);
  });
});
