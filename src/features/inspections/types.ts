/**
 * What the site inspection endpoints return, as the client sees it — dates as
 * ISO strings, because that is what crosses the wire.
 */

export type InspectionApplication = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  zone: string;
  ltpName: string;
  owner: string;
  site: string;
  district: string;
};

export type Tally = {
  total: number;
  answered: number;
  satisfactory: number;
  shortfall: number;
  objection: number;
  na: number;
  pending: number;
};

export type InspectionRow = {
  id: string;
  inspectionNumber: string;
  round: number;
  status: string;
  inspectorId: string;
  inspectorName: string;
  scheduledFor: string;
  inspectedAt: string | null;
  submittedAt: string | null;
  recommendation: string;
  photoCount: number;
  overdue: boolean;
  application: InspectionApplication;
};

export type InspectionSummary = {
  scheduled: number;
  inProgress: number;
  submitted: number;
  recommended: number;
  shortfall: number;
  reject: number;
  overdue: number;
  mine: number;
};

export type InspectionListPayload = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: InspectionRow[];
  summary?: InspectionSummary;
  meta?: { inspectors: Array<{ id: string; name: string }> };
};

export type InspectionFilters = {
  q: string;
  inspectorId: string;
  status: string;
  recommendation: string;
  from: string;
  to: string;
};

export type InspectionResponse = {
  id: string;
  itemId: string;
  itemNumber: number;
  question: string;
  category: string;
  responseType: string;
  isMandatory: boolean;
  isProvisional: boolean;
  response: string;
  observation: string;
  remarks: string;
  status: string;
  answeredAt: string | null;
  helpText: string;
  description: string;
};

export type InspectionPhoto = {
  id: string;
  category: string;
  description: string;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  latitude: number;
  longitude: number;
  capturedAt: string;
  isDemoLocation: boolean;
  uploadedByName: string;
  uploadedAt: string;
};

export type Candidate = { id: string; name: string; designation: string };

export type InspectionDetail = {
  id: string;
  inspectionNumber: string;
  applicationId: string;
  round: number;
  status: string;
  inspectorId: string;
  inspectorName: string;
  scheduledByName: string;
  scheduledFor: string;
  scheduleRemarks: string;
  inspectedAt: string | null;
  stageCode: string;
  latitude: number | null;
  longitude: number | null;
  locationSource: string;
  siteAddress: string;
  generalObservation: string;
  recommendation: string;
  recommendationRemarks: string;
  signatureMethod: string;
  signedByName: string;
  signedByRoleKey: string;
  signedAt: string | null;
  signatureRef: string;
  documentHash: string;
  signatureMetadata: Record<string, unknown>;
  submittedAt: string | null;
  lockedAt: string | null;
  scheduleSequence: number | null;
  submitSequence: number | null;
  routedAt: string | null;
  routedActionCode: string;
  shortfallId: string | null;
  createdAt: string;
  responses: InspectionResponse[];
  photos: InspectionPhoto[];
  application: InspectionApplication;
  tally: Tally;
  shortfall: { id: string; shortfallNumber: string; status: string } | null;
  signatureValid: boolean | null;
  expectedSequence: number;
  provisional: { label: string; note: string };
  candidates: Candidate[];
  permissions: { canEdit: boolean; canSign: boolean; canReschedule: boolean; isInspector: boolean };
};

export type InspectionRound = Omit<InspectionDetail, 'responses' | 'photos' | 'application' | 'shortfall' | 'signatureValid' | 'expectedSequence' | 'provisional' | 'candidates' | 'permissions'> & {
  photoCount: number;
  photoCategories: string[];
};

export type ApplicationInspectionsPayload = {
  application: InspectionApplication;
  provisional: { label: string; note: string };
  rounds: InspectionRound[];
  canSchedule: boolean;
  scheduleBlockedReason: string;
  candidates: Candidate[];
  expectedSequence: number;
  demoLocation: { latitude: number; longitude: number };
};
