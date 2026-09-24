import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  validateExpression,
  variablesUsed,
  ExpressionError,
  MAX_EXPRESSION_LENGTH,
} from '@/lib/fee-expression';

/**
 * The FORMULA sandbox.
 *
 * A fee formula is authored by an administrator through a web form and then
 * evaluated on the server against an applicant's data. That is user-supplied
 * code running on our machine. Half of this suite is arithmetic; the other
 * half is the part that matters — that there is no syntax for reaching
 * anything outside the scope, so there is nothing to escape from.
 */

const SCOPE = {
  plotAreaSqm: 300,
  builtUpAreaSqm: 620,
  numFloors: 4,
  achievedFar: 2.07,
  roadWidthM: 9,
};

describe('arithmetic', () => {
  it('evaluates the operators a fee schedule needs', () => {
    expect(evaluateExpression('1000', SCOPE)).toBe(1000);
    expect(evaluateExpression('plotAreaSqm * 15', SCOPE)).toBe(4500);
    expect(evaluateExpression('builtUpAreaSqm / 2', SCOPE)).toBe(310);
    expect(evaluateExpression('plotAreaSqm + builtUpAreaSqm', SCOPE)).toBe(920);
    expect(evaluateExpression('plotAreaSqm - 100', SCOPE)).toBe(200);
    expect(evaluateExpression('numFloors % 3', SCOPE)).toBe(1);
  });

  it('respects precedence and brackets', () => {
    expect(evaluateExpression('2 + 3 * 4', SCOPE)).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4', SCOPE)).toBe(20);
    expect(evaluateExpression('plotAreaSqm * (numFloors + 1)', SCOPE)).toBe(1500);
  });

  it('is left-associative, so 10 - 3 - 2 is 5 and not 9', () => {
    expect(evaluateExpression('10 - 3 - 2', SCOPE)).toBe(5);
    expect(evaluateExpression('100 / 5 / 2', SCOPE)).toBe(10);
  });

  it('handles unary minus and decimals', () => {
    expect(evaluateExpression('-plotAreaSqm', SCOPE)).toBe(-300);
    expect(evaluateExpression('plotAreaSqm * 2.5', SCOPE)).toBe(750);
    expect(evaluateExpression('-(-5)', SCOPE)).toBe(5);
  });

  it('supports the five permitted functions', () => {
    expect(evaluateExpression('min(plotAreaSqm, 100)', SCOPE)).toBe(100);
    expect(evaluateExpression('max(plotAreaSqm, 1000)', SCOPE)).toBe(1000);
    expect(evaluateExpression('round(2.5)', SCOPE)).toBe(3);
    expect(evaluateExpression('ceil(2.1)', SCOPE)).toBe(3);
    expect(evaluateExpression('floor(2.9)', SCOPE)).toBe(2);
  });

  it('yields 1 or 0 from a comparison, which is how a conditional charge is written', () => {
    // `plotAreaSqm * 10 * (numFloors >= 4)` charges only tall buildings, with
    // no need for an `if` in the grammar.
    expect(evaluateExpression('numFloors >= 4', SCOPE)).toBe(1);
    expect(evaluateExpression('numFloors > 4', SCOPE)).toBe(0);
    expect(evaluateExpression('plotAreaSqm * 10 * (numFloors >= 4)', SCOPE)).toBe(3000);
    expect(evaluateExpression('plotAreaSqm * 10 * (numFloors >= 9)', SCOPE)).toBe(0);
  });
});

describe('the sandbox', () => {
  it('refuses an identifier that is not a declared variable', () => {
    // There is no fallback to a global, so an unknown name is an error rather
    // than `undefined` travelling silently into a demand as NaN.
    expect(() => evaluateExpression('process', SCOPE)).toThrow(ExpressionError);
    expect(() => evaluateExpression('globalThis', SCOPE)).toThrow(ExpressionError);
    expect(() => evaluateExpression('plotAreaSqm + secretRate', SCOPE)).toThrow(/not a fee variable/i);
  });

  it('has no syntax for property access', () => {
    // The dot only ever appears inside a number, so `x.constructor` is not
    // something the grammar can express at all.
    expect(() => evaluateExpression('plotAreaSqm.constructor', SCOPE)).toThrow(ExpressionError);
    expect(() => evaluateExpression('this.process', SCOPE)).toThrow(ExpressionError);
  });

  it('has no syntax for calling anything but the five functions', () => {
    // Two different refusals, both correct. Anything carrying a quote dies in
    // the TOKENISER, before a function name is even considered — there is no
    // string literal in this language. A bare call gets as far as the name
    // check and is refused there.
    expect(() => evaluateExpression('require("fs")', SCOPE)).toThrow(/not allowed in a fee formula/i);
    expect(() => evaluateExpression('eval(1)', SCOPE)).toThrow(/not a function/i);
    expect(() => evaluateExpression('alert(1)', SCOPE)).toThrow(/not a function/i);
    expect(() => evaluateExpression('fetch(plotAreaSqm)', SCOPE)).toThrow(ExpressionError);
  });

  it('rejects characters that are not part of the language', () => {
    // Where a JavaScript-shaped payload dies: quotes, semicolons, backticks,
    // logical operators and assignment are all simply not tokens.
    for (const attempt of [
      '1; process.exit()',
      '"string"',
      '`template`',
      'plotAreaSqm && 1',
      'plotAreaSqm = 5',
      'x => x',
      '[1,2][0]',
      '{}',
    ]) {
      expect(() => evaluateExpression(attempt, SCOPE)).toThrow(ExpressionError);
    }
  });

  it('cannot read a non-numeric value even when it is in the context', () => {
    // The scope handed to the parser is the numeric half of the fee context
    // only, so a code-like string cannot be dragged into arithmetic.
    expect(() =>
      evaluateExpression('buildingUse * 2', { ...SCOPE, buildingUse: Number.NaN })
    ).toThrow(/numeric value/i);
  });

  it('refuses division by zero rather than producing Infinity', () => {
    // Infinity would travel silently into a demand and become a number
    // somebody is asked to pay.
    expect(() => evaluateExpression('plotAreaSqm / 0', SCOPE)).toThrow(/divides by zero/i);
    expect(() => evaluateExpression('plotAreaSqm % 0', SCOPE)).toThrow(/divides by zero/i);
  });

  it('caps length and complexity', () => {
    const long = `plotAreaSqm${' + 1'.repeat(MAX_EXPRESSION_LENGTH)}`;
    expect(() => evaluateExpression(long, SCOPE)).toThrow(/longer than/i);

    // Under the length cap but over the node cap.
    const complex = `1${' + 1'.repeat(120)}`;
    expect(() => evaluateExpression(complex, SCOPE)).toThrow(/too complex/i);
  });

  it('reports unbalanced brackets and dangling operators clearly', () => {
    expect(() => evaluateExpression('(plotAreaSqm * 2', SCOPE)).toThrow(/bracket is not closed/i);
    expect(() => evaluateExpression('plotAreaSqm *', SCOPE)).toThrow(/ends unexpectedly/i);
    expect(() => evaluateExpression('plotAreaSqm 5', SCOPE)).toThrow(/after the end/i);
    expect(() => evaluateExpression('', SCOPE)).toThrow(/empty/i);
  });
});

describe('validateExpression', () => {
  it('accepts a formula over the declared variables and lists them', () => {
    // What the admin editor calls on every keystroke, so a broken formula is
    // caught by the person writing it rather than by a waiting applicant.
    const result = validateExpression('plotAreaSqm * 15 + builtUpAreaSqm');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.variables.sort()).toEqual(['builtUpAreaSqm', 'plotAreaSqm']);
  });

  it('names the variable that is not available', () => {
    const result = validateExpression('plotAreaSqm * madeUpRate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"madeUpRate" is not a fee variable/);
  });

  it('names an unavailable function and checks its arity', () => {
    const unknown = validateExpression('sqrt(plotAreaSqm)');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toMatch(/"sqrt" is not a function/);

    const arity = validateExpression('round(plotAreaSqm, 2)');
    expect(arity.ok).toBe(false);
    if (!arity.ok) expect(arity.error).toMatch(/round\(\) takes 1 argument/);
  });

  it('does not evaluate while validating', () => {
    // Validation runs against a formula whose variables have no values yet.
    // Division by zero is a runtime fault, not a syntax one.
    expect(validateExpression('plotAreaSqm / 0').ok).toBe(true);
  });

  it('variablesUsed reports what a formula reads', () => {
    expect(variablesUsed('min(plotAreaSqm * 2, builtUpAreaSqm)').sort()).toEqual([
      'builtUpAreaSqm',
      'plotAreaSqm',
    ]);
  });
});
