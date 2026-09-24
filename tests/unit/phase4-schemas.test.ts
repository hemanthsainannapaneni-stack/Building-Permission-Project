import { describe, it, expect } from 'vitest';
import { saveChecklistSchema, reviewChecklistSchema } from '@/lib/schemas/checklists';
import { updateOthersSchema } from '@/lib/schemas/others';

/**
 * The request schemas for the checklist and the Others block.
 *
 * These assert the rules that are cheaper to enforce at the boundary than to
 * remember at every call site — and, in two cases, rules that exist to make a
 * particular mistake unrepresentable rather than merely unlikely.
 */

const uuid = () => '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const other = () => '3f2504e0-4f89-11d3-9a0c-0305e82c3302';

describe('the applicant answers', () => {
  it('accepts an answer with remarks', () => {
    const parsed = saveChecklistSchema.safeParse({
      answers: [{ itemId: uuid(), response: 'YES', applicantRemarks: 'Enclosed at page 14.' }],
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * An empty response is a deliberate CLEARING, not a malformed request: an
   * LTP who answered the wrong question must be able to take it back.
   */
  it('accepts an empty answer, because clearing one is a real act', () => {
    expect(saveChecklistSchema.safeParse({ answers: [{ itemId: uuid(), response: '' }] }).success).toBe(
      true
    );
  });

  it('refuses a body with no answers at all', () => {
    expect(saveChecklistSchema.safeParse({ answers: [] }).success).toBe(false);
  });

  it('refuses an item id that is not an id', () => {
    expect(
      saveChecklistSchema.safeParse({ answers: [{ itemId: 'question-14', response: 'YES' }] }).success
    ).toBe(false);
  });

  /**
   * The schema bounds the string; whether "MAYBE" is a valid answer depends on
   * the question's responseType, which lives in a row the schema cannot see.
   * `saveChecklistResponses` checks that against the definition. Neither check
   * is sufficient alone, and this pins the division.
   */
  it('does not try to judge the answer against a question it cannot see', () => {
    expect(
      saveChecklistSchema.safeParse({ answers: [{ itemId: uuid(), response: 'MAYBE' }] }).success
    ).toBe(true);
  });

  it('lets an answer cite a document, or clear the citation', () => {
    expect(
      saveChecklistSchema.safeParse({
        answers: [{ itemId: uuid(), response: 'YES', documentId: other() }],
      }).success
    ).toBe(true);
    expect(
      saveChecklistSchema.safeParse({
        answers: [{ itemId: uuid(), response: 'YES', documentId: null }],
      }).success
    ).toBe(true);
  });
});

describe('the desk verifies', () => {
  it('accepts a verification without a remark', () => {
    expect(
      reviewChecklistSchema.safeParse({ items: [{ itemId: uuid(), status: 'VERIFIED' }] }).success
    ).toBe(true);
  });

  /**
   * THE RULE WORTH HAVING HERE. An adverse finding with no reason is
   * unanswerable: the applicant is being told something is wrong with their
   * file and there is nothing they can do with the word "Shortfall" on its own.
   */
  it('refuses a shortfall or a rejection with no reason', () => {
    for (const status of ['SHORTFALL', 'REJECTED']) {
      const parsed = reviewChecklistSchema.safeParse({ items: [{ itemId: uuid(), status }] });
      expect(parsed.success, `${status} was accepted without a remark`).toBe(false);
    }
  });

  it('refuses whitespace as a reason', () => {
    expect(
      reviewChecklistSchema.safeParse({
        items: [{ itemId: uuid(), status: 'SHORTFALL', reviewerRemarks: '   ' }],
      }).success
    ).toBe(false);
  });

  it('accepts a shortfall once it says what is wrong', () => {
    expect(
      reviewChecklistSchema.safeParse({
        items: [
          { itemId: uuid(), status: 'SHORTFALL', reviewerRemarks: 'The certificate has expired.' },
        ],
      }).success
    ).toBe(true);
  });

  it('refuses a status it does not recognise', () => {
    expect(
      reviewChecklistSchema.safeParse({ items: [{ itemId: uuid(), status: 'APPROVED' }] }).success
    ).toBe(false);
  });
});

describe('the Others block', () => {
  /**
   * The tab saves one card at a time, so a body carrying only the solar fields
   * must leave the mortgage particulars alone. `.optional()` throughout is what
   * makes "not sent" and "sent as empty" survive the parse.
   */
  it('accepts a body that names one block and no other', () => {
    const parsed = updateOthersSchema.safeParse({ solarProposed: true, solarCapacityKw: 5 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toEqual(['solarProposed', 'solarCapacityKw']);
      expect('mortgageNumber' in parsed.data).toBe(false);
    }
  });

  it('refuses a body that changes nothing', () => {
    expect(updateOthersSchema.safeParse({}).success).toBe(false);
  });

  /**
   * Installed-but-not-proposed is an entry error, not a state of the world:
   * nothing gets installed on a permission that never proposed it, and the
   * Others screen has no way to explain the pair to the officer reading it.
   */
  it('refuses provided-without-proposed on all three undertakings', () => {
    expect(updateOthersSchema.safeParse({ solarInstalled: true, solarProposed: false }).success).toBe(
      false
    );
    expect(updateOthersSchema.safeParse({ rwhProvided: true, rwhProposed: false }).success).toBe(false);
    expect(
      updateOthersSchema.safeParse({ greeningProvided: true, greeningProposed: false }).success
    ).toBe(false);
  });

  it('allows provided when proposed is true, or simply not mentioned', () => {
    expect(updateOthersSchema.safeParse({ solarInstalled: true, solarProposed: true }).success).toBe(
      true
    );
    // Not mentioned means "leave it as it is", and the stored value may well
    // already be true — the service, not the schema, sees the stored row.
    expect(updateOthersSchema.safeParse({ solarInstalled: true }).success).toBe(true);
  });

  it('turns a date string into a Date and an empty one into null', () => {
    const parsed = updateOthersSchema.safeParse({ mortgageDate: '2026-03-14' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.mortgageDate).toBeInstanceOf(Date);

    const cleared = updateOthersSchema.safeParse({ mortgageDate: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.mortgageDate).toBeNull();
  });

  /**
   * `z.coerce.date()` on a nonsense string yields an Invalid Date rather than
   * throwing — which would reach Postgres and surface as a 500. The explicit
   * finite check is what turns it into a 400.
   */
  it('refuses a date that is not a date', () => {
    expect(updateOthersSchema.safeParse({ mortgageDate: 'sometime last March' }).success).toBe(false);
  });

  it('refuses a negative area and a fractional tree', () => {
    expect(updateOthersSchema.safeParse({ mortgageAreaSqm: -5 }).success).toBe(false);
    expect(updateOthersSchema.safeParse({ treeCount: 3.5 }).success).toBe(false);
  });
});
