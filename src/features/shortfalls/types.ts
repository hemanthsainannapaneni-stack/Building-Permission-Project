/**
 * What the shortfall endpoints return, as the client sees it.
 *
 * Dates are ISO strings and money is a string, because that is what
 * `serialize()` puts on the wire. A shared type that claimed `Date` here would
 * be a type that lies at exactly the boundary types are for.
 */

export type ShortfallAttachment = { fileObjectId?: string; name?: string; note?: string };

/** One line's answer on one cycle, with the verdict that judged it. */
export type ShortfallItemResponse = {
  id: string;
  attemptNo: number;
  resolutionId: string | null;
  response: string;
  applicantRemarks: string;
  attachments: ShortfallAttachment[];
  respondedAt: string;
  respondedByName: string;
  decision: string | null;
  reviewedAt: string | null;
  reviewedByName: string;
  reviewRemarks: string;
};

export type ShortfallItem = {
  id: string;
  itemNo: number;
  description: string;
  category: string;
  requiredAction: string;
  requiredDocument: string;
  remarks: string;
  status: string;
  isMandatory: boolean;
  amount: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  documentTypeId: string | null;
  documentTypeCode: string;
  documentTypeName: string;
  responses: ShortfallItemResponse[];
  latestResponse: ShortfallItemResponse | null;
};

/** The item lines belonging to one cycle, as the history renders them. */
export type ShortfallCycleItem = {
  itemId: string;
  itemNo: number;
  description: string;
  category: string;
  response: string;
  applicantRemarks: string;
  attachments: ShortfallAttachment[];
  decision: string | null;
  reviewRemarks: string;
  reviewedByName: string;
  reviewedAt: string | null;
};

export type ShortfallResolution = {
  id: string;
  attemptNo: number;
  response: string;
  attachments: ShortfallAttachment[];
  respondedAt: string;
  respondedByName: string;
  reviewedAt: string | null;
  reviewedByName: string;
  accepted: boolean | null;
  reviewRemarks: string;
  items: ShortfallCycleItem[];
};

export type ShortfallDemand = {
  id: string;
  demandNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
};

export type ShortfallRow = {
  id: string;
  shortfallNumber: string;
  kind: string;
  mode: string;
  status: string;
  turn: 'APPLICANT' | 'OFFICER' | 'SYSTEM' | 'NOBODY';
  title: string;
  description: string;
  requiredAction: string;
  raisedAtStageCode: string;
  raisedByRoleKey: string;
  raisedByName: string;
  raisedAt: string;
  dueDate: string | null;
  notifiedAt: string | null;
  closedAt: string | null;
  itemCount: number;
  resolvedItems: number;
  pendingItems: number;
  mandatoryPendingItems: number;
  attempts: number;
  cycle: number;
  sla: {
    state: 'NO_CLOCK' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'STOPPED';
    percent: number | null;
    daysLeft: number | null;
    label: string;
  };
  amount: number;
  application: {
    id: string;
    applicationNumber: string;
    status: string;
    currentStageCode: string | null;
    applicantName: string;
    ltpName: string;
    type: string;
    typeCode: string;
    zone: string;
    slaStatus: string | null;
    slaDueAt: string | null;
  };
  demands: ShortfallDemand[];
};

export type ShortfallDetail = ShortfallRow & {
  closedByName: string;
  closureRemarks: string;
  items: ShortfallItem[];
  resolutions: ShortfallResolution[];
};

export type ShortfallListPayload = {
  rows: ShortfallRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: Record<string, number>;
  isApplicant: boolean;
  summary?: {
    open: number;
    awaitingApplicant: number;
    awaitingOfficer: number;
    overdue: number;
  };
};

/** What the register's filter bar holds. Mirrors `ShortfallListQuery`. */
export type ShortfallFilters = {
  filter: string;
  q: string;
  status: string;
  desk: string;
  from: string;
  to: string;
  owner: string;
  applicationId: string;
  attempt: string;
};

export type ShortfallActionResult = {
  shortfallId: string;
  shortfallNumber: string;
  status: string;
  movedTo: string | null;
  message: string;
};

export type UploadedAttachment = {
  fileObjectId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  scanStatus: string;
};
