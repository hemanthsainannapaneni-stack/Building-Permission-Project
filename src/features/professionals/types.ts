import type { ProfessionalDocument, ProfessionalTypeOption } from '@/lib/professional-registration';
import type { HistoryEvent, Offer, Paged } from '@/features/proceedings/types';

/** What the professional registration endpoints return, as the client sees it — dates as ISO strings. */

export type { Paged, ProfessionalTypeOption };

export type ProfessionalRow = {
  id: string;
  applicationNumber: string;
  registrationNumber: string;
  kind: string;
  professionalType: string;
  typeLabel: string;
  name: string;
  licenceNo: string;
  organization: string;
  account: string;
  status: string;
  isCurrent: boolean;
  submittedAt: string | null;
  validTo: string | null;
  renewalDueDate: string | null;
  renewalDue: boolean;
  available: boolean;
  openRenewal: { id: string; applicationNumber: string; status: string } | null;
  currentDesk: string;
};

export type ProfessionalRegistrationView = {
  id: string;
  applicationNumber: string;
  kind: string;
  registrationNumber: string | null;
  lineageId: string;
  renewalOfId: string | null;
  isCurrent: boolean;
  status: string;
  round: number;
  professionalType: string;
  typeLabel: string;
  userId: string | null;
  name: string;
  licenceNo: string;
  registrationBody: string;
  qualification: string;
  experienceYears: number | null;
  organization: string;
  address: string;
  district: string;
  pincode: string;
  mobile: string;
  email: string;
  licenceValidFrom: string | null;
  licenceValidTo: string | null;
  consentGiven: boolean;
  consentText: string;
  consentAt: string | null;
  documents: ProfessionalDocument[];
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
  cappedByLicence: boolean;
  expiredAt: string | null;
  supersededAt: string | null;
  outwardEntryId: string | null;
  outwardNumber: string;
  currentDesk: string;
  renewalDue: boolean;
  available: boolean;
  createdByName: string;
  createdAt: string;
};

export type ProfessionalDetailPayload = {
  registration: ProfessionalRegistrationView;
  type: ProfessionalTypeOption | null;
  account: { id: string; name: string; email: string; ltpLicenceNo: string | null } | null;
  filesNamed: number;
  requiredDocuments: string[];
  unverifiedDocuments: string[];
  submitBlocker: string | null;
  openRenewal: { id: string; applicationNumber: string } | null;
  chain: Array<{ id: string; applicationNumber: string; kind: string; status: string; isCurrent: boolean; validFrom: string | null; validTo: string | null; decidedAt: string | null; createdAt: string }>;
  events: HistoryEvent[];
  consentText: string;
  permissions: {
    edit: Offer;
    submit: Offer;
    takeUp: Offer;
    checkDocument: Offer;
    shortfall: Offer;
    respond: Offer;
    verify: Offer;
    decide: Offer;
    renew: Offer;
    demoAllowed: boolean;
  };
};

export type LinkableAccount = { id: string; name: string; email: string; licenceNo: string; registrations: Array<{ professionalType: string; registrationNumber: string | null; status: string }> };

export type ProfessionalTypeAdminRow = ProfessionalTypeOption & { id: string; registrations: number };
