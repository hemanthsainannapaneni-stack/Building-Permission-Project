import type { ProfessionalChangeDocument, ProfessionalSnapshot } from '@/lib/professional-change';
import type { HistoryEvent, Offer, Paged } from '@/features/proceedings/types';

/**
 * What the change of professional endpoints return, as the client sees them —
 * dates as ISO strings.
 */

export type { Offer, Paged };

export type PcAppSummary = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  fileDesk: string;
  zone: string;
  owner: string;
};

export type ProfessionalChangeRow = {
  id: string;
  requestNumber: string;
  status: string;
  owner: string;
  requestDate: string;
  requestedAt: string;
  currentProfessional: { name: string; licenceNo: string };
  proposedProfessional: { name: string; licenceNo: string };
  currentDesk: string;
  decidedAt: string | null;
  application: PcAppSummary;
};

export type ProfessionalChangeSummary = { total: number; pending: number; underReview: number; approved: number; rejected: number };

export type Engagement = {
  id: string;
  userId: string;
  name: string;
  snapshot: ProfessionalSnapshot;
  status: string;
  drawingRights: boolean;
  source: string;
  engagedFrom: string;
  engagedUntil: string | null;
  broughtInBy: { id: string; requestNumber: string } | null;
  endedBy: { id: string; requestNumber: string } | null;
  /** Shown from the filing record; no engagement row has been written yet. */
  derived: boolean;
};

export type EligibleProfessional = {
  id: string;
  name: string;
  licenceNo: string;
  licenceClass: string;
  validUpto: string | null;
  firmName: string;
  registrationNumber: string;
  typeLabel: string;
};

export type ApplicationProfessionalPayload = {
  application: PcAppSummary;
  engagements: Engagement[];
  requests: Array<{
    id: string;
    requestNumber: string;
    status: string;
    requestDate: string;
    requestedAt: string;
    currentProfessional: string;
    proposedProfessional: string;
    currentDesk: string;
    decidedAt: string | null;
  }>;
  professionals: EligibleProfessional[];
  permissions: { request: Offer; demoDocumentAllowed: boolean };
};

export type ProfessionalChangeDetail = {
  id: string;
  requestNumber: string;
  applicationId: string;
  status: string;
  currentProfessionalId: string;
  proposedProfessionalId: string;
  currentSnapshot: ProfessionalSnapshot;
  proposedSnapshot: ProfessionalSnapshot;
  ownerName: string;
  requestDate: string;
  reason: string;
  documents: ProfessionalChangeDocument[];
  currentDesk: string;
  nextStep: string | null;
  requestedByName: string;
  requestedByRoleKey: string;
  requestedStageName: string;
  requestedAt: string;
  verifiedByName: string;
  verifiedByRoleKey: string;
  verifiedAt: string | null;
  verificationRemarks: string;
  reviewedByName: string;
  reviewedByRoleKey: string;
  reviewedAt: string | null;
  reviewRemarks: string;
  decision: string;
  decisionRemarks: string;
  decidedByName: string;
  decidedByRoleKey: string;
  decidedAt: string | null;
  application: PcAppSummary;
  holderId: string;
  engagements: Engagement[];
  events: HistoryEvent[];
  permissions: { verify: Offer; review: Offer; decide: Offer; addDocuments: boolean; demoDocumentAllowed: boolean };
};
