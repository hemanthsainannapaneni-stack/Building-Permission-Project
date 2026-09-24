import { z } from 'zod';

/**
 * What a client may send the shortfall engine.
 *
 * Note what is absent: no status, no next state, no mode. The caller says what
 * they DID — answered, accepted, rejected, withdrew — and the engine derives
 * the state from its own machine. A payload that could name its own status
 * would make the state machine advisory.
 */

/**
 * A file already uploaded and scanned, referenced by id.
 *
 * The shortfall never receives bytes. An upload is virus-scanned before it can
 * be read, and letting a response carry a file inline would attach an
 * unscanned document to the record of a decision.
 */
const attachment = z.object({
  fileObjectId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  note: z.string().trim().max(500).default(''),
});

/**
 * One line of the answer, against the item it answers.
 *
 * The item is named by id and nothing else. A payload that could carry the
 * item's TEXT would let a client re-describe the deficiency it is answering,
 * and the deficiency is the officer's words, not the applicant's.
 */
const itemResponse = z.object({
  itemId: z.string().uuid(),
  response: z.string().trim().min(1, 'Say what you have done about this item.').max(2000),
  applicantRemarks: z.string().trim().max(1000).default(''),
  attachments: z.array(attachment).max(10).default([]),
});

export const respondToShortfallSchema = z.object({
  response: z
    .string()
    .trim()
    .min(1, 'Say what you have done about it. This goes to the officer who asked.')
    .max(4000),
  attachments: z.array(attachment).max(20).default([]),
  /**
   * Per-item answers. Optional, because a clarification has no items to answer
   * line by line and a covering paragraph is still a response. The covering
   * `response` above is never optional.
   */
  items: z.array(itemResponse).max(50).default([]),
});

export type RespondToShortfallInput = z.infer<typeof respondToShortfallSchema>;

/** The officer's verdict on one line. */
const itemDecision = z.object({
  itemId: z.string().uuid(),
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  remarks: z.string().trim().max(2000).default(''),
});

export const reviewShortfallSchema = z.object({
  accept: z.boolean(),
  remarks: z
    .string()
    .trim()
    .min(1, 'Say why, in a sentence. Your decision goes on the record either way.')
    .max(4000),
  /**
   * Per-item verdicts. Optional: accepting the letter accepts every line in
   * it, and making an officer tick six boxes to say so would be ceremony.
   */
  items: z.array(itemDecision).max(50).default([]),
});

export type ReviewShortfallInput = z.infer<typeof reviewShortfallSchema>;

export const withdrawShortfallSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this shortfall is being withdrawn.').max(1000),
});

export type WithdrawShortfallInput = z.infer<typeof withdrawShortfallSchema>;
