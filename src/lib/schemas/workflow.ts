import { z } from 'zod';

/**
 * What a client may send the workflow.
 *
 * Note what is NOT here: the next stage, the next status, the shortfall's
 * blocking mode, or anything else about where the file goes. The client names
 * an ACTION and supplies what a person typed; the engine derives every
 * consequence from the transition row. A payload that could name its own
 * destination would make the transition table advisory.
 */

const remarks = z
  .string()
  .trim()
  .max(4000, 'Remarks are limited to 4000 characters.')
  .default('');

/**
 * An attachment already uploaded through the files endpoint, referenced by id.
 *
 * The workflow never receives bytes: an upload is scanned before it can be
 * read, and letting an action carry a file inline would put an unscanned
 * document on the record of a decision.
 */
const attachment = z.object({
  fileObjectId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  note: z.string().trim().max(500).default(''),
});

const shortfallItem = z.object({
  description: z.string().trim().min(1, 'Say what is required.').max(500),
  /** Only meaningful on a FEE shortfall; ignored otherwise. */
  amount: z.coerce.number().positive('An amount must be more than zero.').max(1e12).nullish(),
  documentTypeId: z.string().uuid().nullish(),
  /** The family of deficiency — free text, so an unanticipated one is sayable. */
  category: z.string().trim().max(120).default(''),
  /** What the applicant must do about THIS line. Falls back to the letter's. */
  requiredAction: z.string().trim().max(500).default(''),
  /** The document named in words, where no document type exists for it. */
  requiredDocument: z.string().trim().max(200).default(''),
  remarks: z.string().trim().max(1000).default(''),
  /** Defaults true: an unclassified item blocks approval rather than not. */
  isMandatory: z.boolean().default(true),
});

/** One line of an applicant's answer, carried through a workflow transition. */
const shortfallItemResponse = z.object({
  itemId: z.string().uuid(),
  response: z.string().trim().min(1).max(2000),
  applicantRemarks: z.string().trim().max(1000).default(''),
  attachments: z.array(attachment).max(10).default([]),
});

/** One line of an officer's verdict, carried through a workflow transition. */
const shortfallItemDecision = z.object({
  itemId: z.string().uuid(),
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  remarks: z.string().trim().max(2000).default(''),
});

export const performActionSchema = z.object({
  remarks,
  attachments: z.array(attachment).max(10).default([]),

  /** Supplied when the action raises a shortfall. */
  shortfall: z
    .object({
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(4000).optional(),
      dueDate: z.string().datetime().nullish(),
      items: z.array(shortfallItem).max(50).default([]),
    })
    .optional(),

  /** Narrows an action to one shortfall when a file carries several. */
  shortfallId: z.string().uuid().optional(),

  /**
   * Per-item answers and per-item verdicts, when the transition is one that
   * records a response or decides one.
   *
   * They travel on the workflow payload rather than on a shortfall endpoint of
   * their own because answering a BLOCKING shortfall IS a workflow transition —
   * it carries the file back to the desk that raised it. A second endpoint that
   * wrote the item rows separately would let the lines and the file move apart.
   */
  shortfallItems: z.array(shortfallItemResponse).max(50).default([]),
  shortfallDecisions: z.array(shortfallItemDecision).max(50).default([]),

  /**
   * The history sequence the screen was rendered from.
   *
   * Optional, because a script or an integration may legitimately act without
   * having rendered anything. The UI always sends it, which is what turns
   * "somebody else moved this file while you were reading it" into a 409 with
   * an explanation instead of a second decision on a stage the file has left.
   */
  expectedSequence: z.number().int().min(0).optional(),
});

export type PerformActionInput = z.infer<typeof performActionSchema>;

export const reassignTaskSchema = z.object({
  userId: z.string().uuid('Choose an officer.'),
  reason: z.string().trim().max(1000).default(''),
});

export type ReassignTaskInput = z.infer<typeof reassignTaskSchema>;
