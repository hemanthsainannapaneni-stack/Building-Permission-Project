import { z } from 'zod';
import { CHECKLIST_STATUSES } from '@/lib/checklist';

/**
 * What may be written to an application's checklist, and by whom.
 *
 * Two schemas and not one, because the applicant's side and the reviewer's
 * side are different acts by different people with different authority. An
 * applicant STATES something; a reviewer FINDS something. Sharing one schema
 * would mean one missing capability check away from an applicant posting
 * `status: "VERIFIED"` against their own answers, and the shape of the request
 * body is the cheapest place to make that impossible.
 */

const remarks = z.string().max(2000);

// ── The applicant answers ─────────────────────────────────────────────────

/**
 * `response` is validated for SHAPE here and for MEANING in the service.
 *
 * It has to be: whether "MAYBE" is a valid answer depends on the question's
 * `responseType`, which lives in a row this schema cannot see. So the schema
 * bounds the string and `saveChecklistResponses()` checks it against the
 * definition with `isValidResponse()`. Neither check is sufficient alone.
 */
export const checklistAnswerSchema = z.object({
  itemId: z.string().uuid(),
  response: z.string().max(500),
  applicantRemarks: remarks.optional(),
  /** The document offered in support, where the question calls for one. */
  documentId: z.string().uuid().nullable().optional(),
});

export const saveChecklistSchema = z.object({
  answers: z.array(checklistAnswerSchema).min(1).max(100),
});

export type SaveChecklistInput = z.infer<typeof saveChecklistSchema>;

// ── The reviewer verifies ─────────────────────────────────────────────────

export const checklistReviewItemSchema = z
  .object({
    itemId: z.string().uuid(),
    status: z.enum(CHECKLIST_STATUSES),
    reviewerResponse: z.string().max(500).optional(),
    reviewerRemarks: remarks.optional(),
  })
  .refine(
    (v) =>
      v.status !== 'SHORTFALL' && v.status !== 'REJECTED'
        ? true
        : Boolean(v.reviewerRemarks?.trim()),
    {
      // An adverse finding with no reason is unanswerable. The applicant is
      // being told something is wrong with their file, and there is nothing
      // they can do with the word "Shortfall" on its own.
      message: 'Say what is wrong. A shortfall or a rejection needs a remark.',
      path: ['reviewerRemarks'],
    }
  );

export const reviewChecklistSchema = z.object({
  items: z.array(checklistReviewItemSchema).min(1).max(100),
});

export type ReviewChecklistInput = z.infer<typeof reviewChecklistSchema>;
