/**
 * What the show cause, revocation and outward endpoints return, as the client
 * sees it — dates as ISO strings.
 */

export type Offer = { offered: boolean; available: boolean; reason: string };

export type AppSummary = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  currentDesk: string;
  zone: string;
  owner: string;
  orderNumber: string;
  orderRevoked: boolean;
  approvedAt: string | null;
  site?: string;
};

export type Attachment = { fileObjectId: string | null; fileName: string; mimeType: string; sizeBytes: number; isDemo: boolean };

export type HistoryEvent = {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorName: string;
  actorRoleKey: string;
  stageName?: string;
  remarks: string;
  occurredAt: string;
};

export type Paged<Row> = { page: number; pageSize: number; total: number; totalPages: number; rows: Row[] };

// ── Show cause ──────────────────────────────────────────────────────────────

export type ShowCauseRow = {
  id: string;
  noticeNumber: string;
  status: string;
  violation: string;
  issuedByName: string;
  issuedByRoleKey: string;
  issuedAt: string;
  responseDueDate: string;
  respondedAt: string | null;
  decision: string;
  currentDesk: string;
  application: AppSummary;
};

export type ShowCauseSummary = {
  total: number;
  open: number;
  awaitingDispatch: number;
  awaitingResponse: number;
  awaitingDecision: number;
  closed: number;
  decided: number;
  referred: number;
  pastDue: number;
};

export type ShowCauseListPayload = Paged<ShowCauseRow> & { summary?: ShowCauseSummary };

export type ShowCauseDetail = {
  id: string;
  noticeNumber: string;
  status: string;
  reason: string;
  violation: string;
  responseDueDate: string;
  supportingDocuments: Attachment[];
  issuedByName: string;
  issuedByRoleKey: string;
  issuedStageCode: string;
  issuedAt: string;
  responseText: string;
  responseDocuments: Attachment[];
  respondedByName: string;
  respondedAt: string | null;
  reviewerName: string;
  reviewerRoleKey: string;
  reviewStartedAt: string | null;
  decision: string;
  decisionRemarks: string;
  decidedByName: string;
  decidedByRoleKey: string;
  decidedAt: string | null;
  currentDesk: string;
  application: AppSummary;
  outward: {
    id: string;
    outwardNumber: string;
    status: string;
    mode: string;
    trackingNumber: string;
    dispatchDate: string | null;
    deliveredAt: string | null;
    acknowledgement: string;
    acknowledgementDate: string | null;
  } | null;
  revocation: { id: string; revocationNumber: string; status: string; statusLabel: string } | null;
  events: HistoryEvent[];
  permissions: {
    respond: boolean;
    takeUp: boolean;
    decide: boolean;
    decideReason: string;
    canReferForRevocation: boolean;
    demoDocumentAllowed: boolean;
    sequence: number;
  };
};

// ── Revocation ──────────────────────────────────────────────────────────────

export type RevocationRow = {
  id: string;
  revocationNumber: string;
  status: string;
  orderNumber: string;
  reason: string;
  grounds: string[];
  initiatedByName: string;
  initiatedByRoleKey: string;
  initiatedAt: string;
  decision: string;
  decidedAt: string | null;
  revocationOrderNumber: string;
  application: AppSummary;
};

export type RevocationSummary = { total: number; proposed: number; underReview: number; revoked: number; rejected: number };

export type RevocationListPayload = Paged<RevocationRow> & { summary?: RevocationSummary };

export type RevocationDetail = RevocationRow & {
  showCauseId: string | null;
  showCause: { id: string; noticeNumber: string; status: string; decision: string } | null;
  reviewerName: string;
  reviewerRoleKey: string;
  reviewStartedAt: string | null;
  decisionRemarks: string;
  decidedByName: string;
  decidedByRoleKey: string;
  orderGeneratedAt: string | null;
  outward: { id: string; outwardNumber: string; status: string; mode: string; dispatchDate: string | null } | null;
  approval: { sequence: number; actorName: string; actorRoleKey: string; occurredAt: string; remarks: string } | null;
  events: HistoryEvent[];
  permissions: { takeUp: boolean; decide: boolean; sequence: number };
};

// ── Outward ─────────────────────────────────────────────────────────────────

export type OutwardRow = {
  id: string;
  outwardNumber: string;
  documentType: string;
  documentReference: string;
  recipient: string;
  address: string;
  assignedDate: string;
  dispatchDate: string | null;
  mode: string;
  trackingNumber: string;
  status: string;
  deliveryStatus: string;
  acknowledgement: string;
  acknowledgementDate: string | null;
  application: { id: string; applicationNumber: string; owner: string } | null;
};

export type OutwardSummary = {
  total: number;
  pending: number;
  ready: number;
  inTransit: number;
  delivered: number;
  acknowledged: number;
  returned: number;
};

export type OutwardListPayload = Paged<OutwardRow> & { summary?: OutwardSummary };

export type OutwardDetail = OutwardRow & {
  subject: string;
  sourceType: string;
  sourceId: string;
  sourceLink: string;
  deliveredAt: string | null;
  returnedAt: string | null;
  returnReason: string;
  remarks: string;
  createdByName: string;
  events: HistoryEvent[];
  permissions: { moves: string[] };
};

// ── The application's Proceedings tab ──────────────────────────────────────

export type ApplicationProceedingsPayload = {
  application: AppSummary;
  showCauses: Array<{
    id: string;
    noticeNumber: string;
    status: string;
    violation: string;
    reason: string;
    issuedAt: string;
    issuedByName: string;
    issuedByRoleKey: string;
    responseDueDate: string;
    respondedAt: string | null;
    decision: string;
    decidedAt: string | null;
    currentDesk: string;
  }>;
  revocations: Array<{
    id: string;
    revocationNumber: string;
    status: string;
    reason: string;
    initiatedByName: string;
    initiatedAt: string;
    decidedAt: string | null;
    revocationOrderNumber: string;
  }>;
  outward: Array<{
    id: string;
    outwardNumber: string;
    documentType: string;
    documentReference: string;
    status: string;
    assignedDate: string;
    dispatchDate: string | null;
  }>;
  permissions: {
    issueShowCause: Offer;
    takeUpShowCause: Offer;
    decideShowCause: Offer;
    initiateRevocation: Offer;
    takeUpRevocation: Offer;
    revoke: Offer;
    rejectRevocation: Offer;
    isApplicant: boolean;
    demoDocumentAllowed: boolean;
    sequence: number;
  };
};
