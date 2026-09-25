import type { DeveloperDocument } from '@/lib/developer-registration';
import type { HistoryEvent, Offer, Paged } from '@/features/proceedings/types';

/** What the developer registration endpoints return, as the client sees it — dates as ISO strings. */

export type { Paged };

export type DeveloperRow = {
  id: string;
  applicationNumber: string;
  registrationNumber: string;
  kind: string;
  developerType: string;
  developerName: string;
  organization: string;
  authorizedPerson: string;
  pan: string;
  status: string;
  isCurrent: boolean;
  submittedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  renewalDueDate: string | null;
  renewalDue: boolean;
  openRenewal: { id: string; applicationNumber: string; status: string } | null;
  currentDesk: string;
};

export type DeveloperRegistrationView = {
  id: string;
  applicationNumber: string;
  kind: string;
  registrationNumber: string | null;
  lineageId: string;
  renewalOfId: string | null;
  isCurrent: boolean;
  status: string;
  round: number;
  developerType: string;
  developerName: string;
  organization: string;
  authorizedPerson: string;
  authorizedDesignation: string;
  address: string;
  district: string;
  pincode: string;
  mobile: string;
  email: string;
  pan: string;
  gstin: string;
  incorporationNo: string;
  incorporationDate: string | null;
  reraNo: string;
  experienceYears: number | null;
  projectsCompleted: number | null;
  registrationInfo: string;
  documents: DeveloperDocument[];
  submittedByName: string;
  submittedAt: string | null;
  takenUpByName: string;
  takenUpAt: string | null;
  shortfallItems: string[];
  shortfallRemarks: string;
  shortfallRaisedByName: string;
  shortfallRaisedAt: string | null;
  shortfallResponse: string;
  shortfallRespondedAt: string | null;
  verificationOutcome: string;
  verificationRemarks: string;
  verifiedByName: string;
  verifiedAt: string | null;
  decision: string;
  decisionRemarks: string;
  decidedByName: string;
  decidedAt: string | null;
  issueDate: string | null;
  validFrom: string | null;
  validTo: string | null;
  renewalDueDate: string | null;
  validityYears: number | null;
  expiredAt: string | null;
  supersededAt: string | null;
  outwardEntryId: string | null;
  outwardNumber: string;
  currentDesk: string;
  renewalDue: boolean;
  createdByName: string;
  createdAt: string;
};

export type DeveloperDetailPayload = {
  registration: DeveloperRegistrationView;
  requiredDocuments: string[];
  submitBlocker: string | null;
  openRenewal: { id: string; applicationNumber: string } | null;
  chain: Array<{ id: string; applicationNumber: string; kind: string; status: string; isCurrent: boolean; validFrom: string | null; validTo: string | null; decidedAt: string | null; createdAt: string }>;
  events: HistoryEvent[];
  permissions: {
    edit: Offer;
    submit: Offer;
    takeUp: Offer;
    shortfall: Offer;
    respond: Offer;
    verify: Offer;
    decide: Offer;
    renew: Offer;
    demoAllowed: boolean;
  };
};
