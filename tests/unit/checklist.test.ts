import { describe, it, expect } from 'vitest';
import {
  CHECKLIST_STATUS,
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_LABEL,
  CHECKLIST_STATUS_TONE,
  APPLICANT_ANSWERABLE_STATUSES,
  allowedResponses,
  canApplicantAnswer,
  canReviewerVerify,
  checklistProgress,
  deriveRiskCategory,
  isChecklistStatus,
  isSettledStatus,
  isValidResponse,
} from '@/lib/checklist';
import { APPLICATION_STATUSES } from '@/lib/status';

/**
 * The checklist machinery.
 *
 * Note what is NOT tested here: the wording of any question. There is none in
 * the codebase to test — the nineteen questions are rows, seeded as
 * provisional demo wording, and replacing them with the official BBAS text
 * must not require a single change to a test. That is the whole point of
 * keeping the sentence in the database, and a test asserting on one would
 * quietly undo it.
 */

const item = (over: Partial<{ status: string; response: string; isMandatory: boolean }> = {}) => ({
  status: CHECKLIST_STATUS.PENDING,
  response: '',
  isMandatory: true,
  ...over,
});

describe('status vocabulary', () => {
  it('has a label and a tone for every status', () => {
    for (const status of CHECKLIST_STATUSES) {
      expect(CHECKLIST_STATUS_LABEL[status], `no label for ${status}`).toBeTruthy();
      expect(CHECKLIST_STATUS_TONE[status], `no tone for ${status}`).toBeTruthy();
    }
  });

  it('recognises its own statuses and nothing else', () => {
    expect(isChecklistStatus('VERIFIED')).toBe(true);
    expect(isChecklistStatus('APPROVED')).toBe(false);
  });

  /**
   * PENDING and NA are different facts and the difference is load-bearing:
   * PENDING is work nobody has done, NA is work an officer finished by
   * recording that the question does not apply. An office measured on the
   * first would be reported as behind on the second.
   */
  it('counts NA as settled and PENDING as not', () => {
    expect(isSettledStatus(CHECKLIST_STATUS.NA)).toBe(true);
    expect(isSettledStatus(CHECKLIST_STATUS.VERIFIED)).toBe(true);
    expect(isSettledStatus(CHECKLIST_STATUS.REJECTED)).toBe(true);
    expect(isSettledStatus(CHECKLIST_STATUS.PENDING)).toBe(false);
    expect(isSettledStatus(CHECKLIST_STATUS.SHORTFALL)).toBe(false);
  });
});

describe('progress', () => {
  it('reports the counts the header states', () => {
    const progress = checklistProgress([
      ...Array.from({ length: 12 }, () => item({ status: 'VERIFIED', response: 'YES' })),
      ...Array.from({ length: 3 }, () => item({ status: 'PENDING', response: 'YES' })),
      ...Array.from({ length: 2 }, () => item({ status: 'SHORTFALL', response: 'NO' })),
      item({ status: 'NA', response: 'NA' }),
      item({ status: 'REJECTED', response: 'NO' }),
    ]);

    expect(progress.total).toBe(19);
    expect(progress.verified).toBe(12);
    expect(progress.pending).toBe(3);
    expect(progress.shortfall).toBe(2);
    expect(progress.na).toBe(1);
    expect(progress.rejected).toBe(1);
  });

  it('treats an unknown status as pending rather than dropping it', () => {
    // The safe direction: a status added later is outstanding until somebody
    // deliberately says it is not, and a question that vanished from every
    // count would be a question nobody ever looks at again.
    const progress = checklistProgress([item({ status: 'SOMETHING_NEW' })]);
    expect(progress.pending).toBe(1);
    expect(progress.total).toBe(1);
  });

  it('separates answered from reviewed', () => {
    const progress = checklistProgress([
      item({ response: 'YES', status: 'PENDING' }),
      item({ response: '', status: 'PENDING', isMandatory: true }),
      item({ response: '', status: 'PENDING', isMandatory: false }),
    ]);

    expect(progress.answered).toBe(1);
    // Only the MANDATORY unanswered one counts against filing.
    expect(progress.unanswered).toBe(1);
  });

  it('is complete only when nothing is pending and nothing is in shortfall', () => {
    expect(checklistProgress([item({ status: 'VERIFIED' }), item({ status: 'NA' })]).complete).toBe(
      true
    );
    expect(checklistProgress([item({ status: 'VERIFIED' }), item({ status: 'SHORTFALL' })]).complete).toBe(
      false
    );
    // An empty checklist is not "complete" — there is nothing to have finished.
    expect(checklistProgress([]).complete).toBe(false);
  });
});

describe('responses', () => {
  it('offers NA only where the question type allows it', () => {
    expect(allowedResponses('YES_NO')).toEqual(['YES', 'NO']);
    expect(allowedResponses('YES_NO_NA')).toEqual(['YES', 'NO', 'NA']);
    expect(allowedResponses('TEXT')).toEqual([]);
  });

  it('refuses an answer the question does not take', () => {
    expect(isValidResponse('YES_NO', 'YES')).toBe(true);
    expect(isValidResponse('YES_NO', 'NA')).toBe(false);
    expect(isValidResponse('YES_NO_NA', 'NA')).toBe(true);
  });

  it('accepts a measurement only as a non-negative number', () => {
    expect(isValidResponse('MEASUREMENT', '12.5')).toBe(true);
    expect(isValidResponse('MEASUREMENT', '0')).toBe(true);
    expect(isValidResponse('MEASUREMENT', '-3')).toBe(false);
    expect(isValidResponse('NUMBER', 'about twelve')).toBe(false);
  });

  it('treats an empty answer as no answer, whatever the type', () => {
    for (const type of ['YES_NO', 'YES_NO_NA', 'TEXT', 'NUMBER', 'MEASUREMENT']) {
      expect(isValidResponse(type, '')).toBe(false);
    }
  });
});

describe('risk', () => {
  const risky = (response: string, status: string = CHECKLIST_STATUS.PENDING) => ({
    affectsRisk: true,
    response,
    status,
  });

  it('is LOW when no risk-bearing question is answered in the raising direction', () => {
    expect(deriveRiskCategory([risky('NO'), risky('NO'), risky('NA')])).toBe('LOW');
  });

  it('is MEDIUM on one or two flags and HIGH on three', () => {
    expect(deriveRiskCategory([risky('YES'), risky('NO')])).toBe('MEDIUM');
    expect(deriveRiskCategory([risky('YES'), risky('YES')])).toBe('MEDIUM');
    expect(deriveRiskCategory([risky('YES'), risky('YES'), risky('YES')])).toBe('HIGH');
  });

  /**
   * A REJECTION is a finding against the proposal on a matter bearing on risk.
   * One is decisive.
   */
  it('is HIGH on a single rejection, however few flags', () => {
    expect(deriveRiskCategory([risky('NO', CHECKLIST_STATUS.REJECTED)])).toBe('HIGH');
  });

  /**
   * A SHORTFALL is not. It is recoverable — an expired certificate, a missing
   * enclosure — and it is the most ordinary finding an officer makes. Treating
   * one as decisive put three files in four at HIGH on the demonstration
   * register, and a grade almost everything shares tells a reader nothing.
   */
  it('is MEDIUM on one shortfall and HIGH only once they accumulate', () => {
    expect(deriveRiskCategory([risky('NO', CHECKLIST_STATUS.SHORTFALL)])).toBe('MEDIUM');
    expect(
      deriveRiskCategory([
        risky('NO', CHECKLIST_STATUS.SHORTFALL),
        risky('NO', CHECKLIST_STATUS.SHORTFALL),
      ])
    ).toBe('HIGH');
  });

  it('ignores questions that do not bear on risk', () => {
    expect(
      deriveRiskCategory([
        { affectsRisk: false, response: 'YES', status: CHECKLIST_STATUS.SHORTFALL },
        { affectsRisk: false, response: 'YES', status: CHECKLIST_STATUS.REJECTED },
      ])
    ).toBe('LOW');
  });

  it('is LOW when the checklist has no risk-bearing questions at all', () => {
    expect(deriveRiskCategory([])).toBe('LOW');
  });
});

describe('who may write, and when', () => {
  /**
   * The list is string literals against a vocabulary that lives elsewhere, so
   * a typo would silently make a file unanswerable — the applicant's buttons
   * would just never appear, with nothing to show for it in any log. This is
   * the same guard `demo-plan.test.ts` puts on its own status literals.
   */
  it('names only statuses this system actually has', () => {
    for (const status of APPLICANT_ANSWERABLE_STATUSES) {
      expect(APPLICATION_STATUSES, `${status} is not an application status`).toContain(status);
    }
  });

  it('lets the applicant answer before filing and while the file is back with them', () => {
    expect(canApplicantAnswer('DRAFT')).toBe(true);
    expect(canApplicantAnswer('RETURNED_TO_APPLICANT')).toBe(true);
    expect(canApplicantAnswer('TPA_DOCUMENT_SHORTFALL')).toBe(true);
  });

  it('stops the applicant answering while a desk holds the file', () => {
    expect(canApplicantAnswer('TPA_REVIEW')).toBe(false);
    expect(canApplicantAnswer('ZDD_REVIEW')).toBe(false);
    expect(canApplicantAnswer('APPROVED')).toBe(false);
  });

  it('lets a desk verify everywhere except on a draft or a closed file', () => {
    expect(canReviewerVerify('TPA_REVIEW')).toBe(true);
    expect(canReviewerVerify('PENDING_ZJD')).toBe(true);
    expect(canReviewerVerify('DRAFT')).toBe(false);
    expect(canReviewerVerify('APPROVED')).toBe(false);
    expect(canReviewerVerify('REJECTED')).toBe(false);
    expect(canReviewerVerify('WITHDRAWN')).toBe(false);
    expect(canReviewerVerify('LAPSED')).toBe(false);
  });

  it('leaves a status nobody has classified reviewable rather than locked', () => {
    // Stated as the closed set, so the failure mode of forgetting one is a
    // desk that can still do its work.
    expect(canReviewerVerify('SOME_NEW_STATUS')).toBe(true);
  });
});
