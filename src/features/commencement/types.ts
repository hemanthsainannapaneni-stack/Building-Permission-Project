import type { CommencementDocument, CommencementState } from '@/lib/commencement';
import type { Offer, Paged } from '@/features/proceedings/types';

/** What the Work Initiated endpoints return, as the client sees it — dates as ISO strings. */

export type { Paged };

export type CommencementRow = {
  applicationId: string;
  applicationNumber: string;
  applicationStatus: string;
  zone: string;
  owner: string;
  ltp: { name: string; licenceNo: string };
  order: { orderNumber: string; status: string; issuedAt: string } | null;
  contractor: string;
  commencementNumber: string;
  commencementDate: string | null;
  notifiedAt: string | null;
  state: CommencementState;
};

export type CommencementSummary = { awaiting: number; issued: number; pending: number; initiated: number };

export type ApplicationCommencementPayload = {
  application: { id: string; applicationNumber: string; status: string; fileDesk: string; zone: string; approvedAt: string | null };
  state: CommencementState;
  owner: string;
  ltp: { id: string; name: string; licenceNo: string; firmName: string };
  order: {
    id: string;
    orderNumber: string;
    status: string;
    issuedAt: string;
    validUntil: string | null;
    downloadable: boolean;
  } | null;
  approvedPlan: Array<{ id: string; title: string; category: string; versionNo: number; fileName: string; uploadedAt: string }>;
  scrutiny: {
    id: string;
    outcome: string;
    evaluatedAt: string;
    checksRun: number;
    checksPassed: number;
    hasReport: boolean;
    isDemo: boolean;
  } | null;
  commencement: {
    id: string;
    commencementNumber: string;
    orderNumber: string;
    contractor: { name: string; licenceNo: string; phone: string; address: string };
    ltpName: string;
    ltpLicenceNo: string;
    commencementDate: string;
    notifiedAt: string;
    notifiedByName: string;
    notifiedByRoleKey: string;
    documents: CommencementDocument[];
    remarks: string;
    workflowStep: { sequence: number; actionCode: string; actorName: string; actorRoleKey: string; occurredAt: string } | null;
  } | null;
  blocker: string | null;
  permissions: { notify: Offer; demoDocumentAllowed: boolean };
};
