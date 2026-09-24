import type { ChecklistProgress, RiskCategory } from '@/lib/checklist';

/**
 * The shapes the checklist screen receives.
 *
 * Declared rather than inferred from the service, because these cross the
 * server/client boundary: by the time a row gets here `serialize()` has turned
 * every Date into an ISO string, so the server's own type is no longer true of
 * the value that arrives.
 */

export type ChecklistHistoryEntry = {
  id: string;
  /** APPLICANT_RESPONSE | REVIEW */
  entryType: string;
  response: string;
  remarks: string;
  status: string;
  actorName: string;
  actorRoleKey: string;
  /** The desk it was recorded at. Empty before the file reaches one. */
  stageCode: string;
  recordedAt: string;
};

export type ChecklistItem = {
  id: string;
  kind: string;
  itemNumber: number;
  question: string;
  description: string;
  responseType: string;
  category: string;
  helpText: string;
  isMandatory: boolean;
  requiresDocument: boolean;
  affectsRisk: boolean;
  displayOrder: number;
  /**
   * True while this is demo wording rather than the official BBAS question.
   * The screen SAYS SO next to the question — a provisional sentence presented
   * as a statutory one is the failure this flag exists to prevent.
   */
  isProvisional: boolean;
  source: string;

  responseId: string | null;
  response: string;
  applicantRemarks: string;
  respondedByName: string;
  respondedAt: string | null;

  reviewerResponse: string;
  reviewerRemarks: string;
  status: string;
  reviewedByName: string;
  reviewedRoleKey: string;
  reviewedStageCode: string;
  reviewedAt: string | null;
  documentId: string | null;

  /** Oldest first. Every act on this question, by everybody who acted. */
  history: ChecklistHistoryEntry[];
};

/** An uploaded document an answer can cite in support. */
export type SupportingDocument = {
  id: string;
  name: string;
  code: string;
  status: string;
};

export type ChecklistPayload = {
  application: {
    id: string;
    applicationNumber: string;
    status: string;
    currentStageCode: string | null;
    riskCategory: string;
  };
  kind: string;
  documents: SupportingDocument[];
  items: ChecklistItem[];
  progress: ChecklistProgress;
  derivedRisk: RiskCategory;
  canRespond: boolean;
  respondBlockedReason: string | null;
  canReview: boolean;
  reviewBlockedReason: string | null;
};

/** One pending edit in the answer form, before it is saved. */
export type DraftAnswer = {
  response: string;
  applicantRemarks: string;
  /** Null clears the reference; undefined leaves it untouched. */
  documentId?: string | null;
};

/** One pending edit in the verification form. */
export type DraftReview = {
  status: string;
  reviewerResponse: string;
  reviewerRemarks: string;
};
