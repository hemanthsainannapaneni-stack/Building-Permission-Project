import type {
  AsBuiltFigures,
  ComparisonRow,
  OccupancyDocument,
  OccupancyPhoto,
  OccupancyRegisterState,
} from '@/lib/occupancy';
import type { HistoryEvent, Offer, Paged } from '@/features/proceedings/types';

/** What the occupancy endpoints return, as the client sees it — dates as ISO strings. */

export type { Paged };

export type OccupancyRow = {
  applicationId: string;
  applicationNumber: string;
  occupancyNumber: string;
  orderNumber: string;
  owner: string;
  completionDate: string | null;
  submissionDate: string | null;
  inspectionDate: string | null;
  inspectionDone: boolean;
  state: OccupancyRegisterState;
  recommendation: string;
  currentDesk: string;
  certificateNumber: string;
};

export type OccupancySummary = Record<OccupancyRegisterState, number>;

export type OccupancyInspectionView = {
  id: string;
  round: number;
  status: string;
  scheduledFor: string;
  inspectorName: string;
  scheduledByName: string;
  inspectedAt: string | null;
  siteCondition: string;
  actualConstruction: string;
  approvedConstruction: string;
  deviations: string;
  remarks: string;
  photos: OccupancyPhoto[];
  recommendation: string;
  asBuiltSource: string;
};

export type ApplicationOccupancyPayload = {
  application: { id: string; applicationNumber: string; status: string; fileDesk: string; zone: string; approvedAt: string | null };
  owner: string;
  ltp: { name: string; licenceNo: string };
  order: { id: string; orderNumber: string; status: string; issuedAt: string } | null;
  commencement: { commencementNumber: string; commencementDate: string; notifiedAt: string } | null;
  state: OccupancyRegisterState;
  occupancy: {
    id: string;
    occupancyNumber: string;
    status: string;
    round: number;
    currentDesk: string;
    orderNumber: string;
    commencementNumber: string;
    commencementDate: string | null;
    completionDate: string;
    completionRemarks: string;
    documents: OccupancyDocument[];
    submittedAt: string;
    submittedByName: string;
    recommendation: string;
    recommendationLabel: string;
    recommendationNotes: string;
    reviewedByName: string;
    reviewedAt: string | null;
    shortfall: { items: string[]; remarks: string; raisedByName: string; raisedAt: string; response: string; respondedAt: string | null } | null;
    decision: string;
    decisionRemarks: string;
    decidedByName: string;
    decidedAt: string | null;
    certificate: {
      certificateNumber: string;
      issuedAt: string;
      issuedByName: string;
      approvedAreaSqm: number | null;
      completedAreaSqm: number | null;
      conditions: string[];
      outwardEntryId: string | null;
      outwardNumber: string;
      isDemo: boolean;
    } | null;
    inspections: OccupancyInspectionView[];
    comparison: ComparisonRow[];
    asBuiltSource: string;
    approvedFigures: AsBuiltFigures;
    events: HistoryEvent[];
  } | null;
  history: Array<{ id: string; occupancyNumber: string; status: string; submittedAt: string; decidedAt: string | null; decisionRemarks: string }>;
  blocker: string | null;
  inspectors: Array<{ id: string; name: string; designation: string }>;
  permissions: {
    submit: Offer;
    schedule: Offer;
    inspect: Offer;
    recommend: Offer;
    shortfall: Offer;
    respond: Offer;
    approve: Offer;
    reject: Offer;
    issue: Offer;
    demoAllowed: boolean;
  };
};
