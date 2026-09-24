import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  tryEvaluate,
  describeCondition,
  isAlways,
  resolvePath,
  ConditionError,
} from '@/lib/conditions';

/**
 * The condition language.
 *
 * This is the one evaluator behind three questions — which documents an
 * application requires, which fee components it is charged, and which
 * adjustments apply. A bug here does not produce a wrong answer in one place;
 * it produces a checklist that disagrees with the demand raised against it.
 */

const CONTEXT = {
  application: { typeCode: 'RESIDENTIAL_BUILDING', purpose: 'NEW' },
  applicant: { ownerSameAsApplicant: false },
  property: { landUseZone: 'RESIDENTIAL', plotAreaSqm: 300, lpNumber: '', district: 'Hyderabad' },
  building: {
    buildingUse: 'APARTMENT',
    occupancyType: 'A_RESIDENTIAL',
    numFloors: 4,
    numBasements: 0,
    buildingHeightM: 14.5,
    builtUpAreaSqm: 620,
  },
};

describe('isAlways', () => {
  it('treats an absent, empty or {} condition as always applying', () => {
    // The commonest case by far: a document required of every application has
    // no condition at all, and must not need one invented for it.
    expect(isAlways(undefined)).toBe(true);
    expect(isAlways(null)).toBe(true);
    expect(isAlways({})).toBe(true);
    expect(isAlways({ gte: ['building.numFloors', 4] })).toBe(false);
  });
});

describe('comparison', () => {
  it('resolves the first operand as a path and the rest as literals', () => {
    // The rule that makes a condition mean the same thing whatever context it
    // is evaluated against.
    expect(evaluateCondition({ eq: ['building.buildingUse', 'APARTMENT'] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ eq: ['building.buildingUse', 'DWELLING'] }, CONTEXT)).toBe(false);
  });

  it('compares numbers in every ordering operator', () => {
    expect(evaluateCondition({ gte: ['building.numFloors', 4] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ gt: ['building.numFloors', 4] }, CONTEXT)).toBe(false);
    expect(evaluateCondition({ lt: ['building.numFloors', 5] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ lte: ['building.numFloors', 4] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ ne: ['building.numFloors', 3] }, CONTEXT)).toBe(true);
  });

  it('refuses to order-compare two strings rather than comparing them wrongly', () => {
    // "APARTMENT" > "SHOP" would succeed as a JavaScript string comparison and
    // mean nothing at all. False is the honest answer.
    expect(evaluateCondition({ gt: ['building.buildingUse', 'AAA'] }, CONTEXT)).toBe(false);
  });

  it('handles in, nin, between and contains', () => {
    expect(
      evaluateCondition({ in: ['building.occupancyType', ['D_ASSEMBLY', 'A_RESIDENTIAL']] }, CONTEXT)
    ).toBe(true);
    expect(evaluateCondition({ nin: ['building.occupancyType', ['D_ASSEMBLY']] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ between: ['property.plotAreaSqm', 100, 500] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ between: ['property.plotAreaSqm', 400, 500] }, CONTEXT)).toBe(false);
    expect(evaluateCondition({ contains: ['property.district', 'hydera'] }, CONTEXT)).toBe(true);
  });

  it('treats exists and empty as questions about a value being given', () => {
    // An empty string is "not answered", which is what an unfilled optional
    // field on the wizard actually leaves behind.
    expect(evaluateCondition({ exists: 'property.lpNumber' }, CONTEXT)).toBe(false);
    expect(evaluateCondition({ empty: 'property.lpNumber' }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ exists: 'property.district' }, CONTEXT)).toBe(true);
  });

  it('compares booleans, which is what the owner-NOC rule depends on', () => {
    expect(evaluateCondition({ eq: ['applicant.ownerSameAsApplicant', false] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ eq: ['applicant.ownerSameAsApplicant', true] }, CONTEXT)).toBe(false);
  });

  it('is forgiving about case and numeric strings', () => {
    // Values reach the context from form input, master data and JSON
    // configuration. An administrator typing `residential` should not produce
    // a rule that silently never fires.
    expect(evaluateCondition({ eq: ['property.landUseZone', 'residential'] }, CONTEXT)).toBe(true);
    expect(evaluateCondition({ eq: ['building.numFloors', '4'] }, CONTEXT)).toBe(true);
  });
});

describe('logical operators', () => {
  it('combines with and, or and not', () => {
    const structural = {
      or: [{ gte: ['building.numFloors', 4] }, { gt: ['building.buildingHeightM', 15] }],
    };
    expect(evaluateCondition(structural, CONTEXT)).toBe(true);

    expect(
      evaluateCondition(
        { and: [{ gte: ['building.numFloors', 4] }, { gt: ['building.buildingHeightM', 15] }] },
        CONTEXT
      )
    ).toBe(false);

    expect(evaluateCondition({ not: { gte: ['building.numFloors', 9] } }, CONTEXT)).toBe(true);
  });

  it('nests to any depth', () => {
    expect(
      evaluateCondition(
        {
          and: [
            { or: [{ eq: ['building.buildingUse', 'APARTMENT'] }, { eq: ['building.buildingUse', 'SHOP'] }] },
            { not: { eq: ['applicant.ownerSameAsApplicant', true] } },
          ],
        },
        CONTEXT
      )
    ).toBe(true);
  });
});

describe('unknown paths', () => {
  it('yields false rather than throwing, in the safe direction', () => {
    // A rule that cannot be evaluated does not apply: the document is not
    // demanded and the fee is not charged. The mandatory-document gate is what
    // stops that safety becoming a missing statutory paper.
    expect(evaluateCondition({ gte: ['building.thereIsNoSuchField', 1] }, CONTEXT)).toBe(false);
    expect(evaluateCondition({ eq: ['nothing.at.all', 'x'] }, CONTEXT)).toBe(false);
  });

  it('does not reach through the prototype chain', () => {
    // `{"eq": ["constructor.name", "Object"]}` must not be a way to interrogate
    // the runtime from a configuration row.
    expect(resolvePath('constructor', CONTEXT)).toBeUndefined();
    expect(resolvePath('__proto__.constructor', CONTEXT)).toBeUndefined();
    expect(resolvePath('building.numFloors', CONTEXT)).toBe(4);
  });
});

describe('malformed conditions', () => {
  it('refuses an object with several operators rather than guessing', () => {
    // "and" or "or"? Nobody reading the JSON could tell, so it is an error.
    expect(() =>
      evaluateCondition({ gte: ['building.numFloors', 4], lte: ['building.numFloors', 8] }, CONTEXT)
    ).toThrow(ConditionError);
  });

  it('reports an unknown operator', () => {
    expect(() => evaluateCondition({ approximately: ['building.numFloors', 4] }, CONTEXT)).toThrow(
      /unknown condition operator/i
    );
  });

  it('tryEvaluate turns a broken rule into false plus a reason', () => {
    // One bad JSON blob in the configuration must not take the checklist down
    // for every applicant.
    const result = tryEvaluate({ approximately: ['building.numFloors', 4] }, CONTEXT);
    expect(result.matched).toBe(false);
    expect(result.error).toMatch(/unknown condition operator/i);
  });
});

describe('describeCondition', () => {
  it('turns a condition into a sentence an applicant can read', () => {
    expect(describeCondition({ gte: ['building.numFloors', 4] })).toBe('num floors is at least 4');
    expect(
      describeCondition({ gte: ['building.numFloors', 4] }, { 'building.numFloors': 'the building has' })
    ).toBe('the building has is at least 4');
  });

  it('describes combinations and lists', () => {
    expect(
      describeCondition({
        or: [{ gt: ['building.buildingHeightM', 15] }, { gte: ['building.numFloors', 4] }],
      })
    ).toBe('building height m is more than 15 or num floors is at least 4');

    expect(describeCondition({ in: ['building.occupancyType', ['D_ASSEMBLY', 'F_MERCANTILE']] })).toBe(
      'occupancy type is one of d assembly, f mercantile'
    );
  });

  it('returns nothing for an unconditional rule, and never throws', () => {
    expect(describeCondition({})).toBe('');
    // An unexplainable condition is not worth failing a page render over.
    expect(describeCondition({ nonsense: 'x', alsoNonsense: 'y' })).toBe('');
  });
});
