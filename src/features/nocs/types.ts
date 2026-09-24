import type { NocAction, NocTally } from '@/lib/noc';

/**
 * What the NOC endpoints return, as the client sees it — dates as ISO strings,
 * because that is what crosses the wire.
 */

export type NocApplication = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  currentDesk: string;
  zone: string;
  owner: string;
};

export type NocTypeRef = { id: string; code: string; name: string; requiresExpiry: boolean };

export type NocRecord = {
  id: string;
  nocNumber: string;
  applicationId: string;
  nocTypeId: string;
  status: string;
  isRequired: boolean | null;
  authority: string;
  applicationReference: string;
  referenceNumber: string;
  appliedDate: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  fileObjectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isDemoDocument: boolean;
  documentAddedAt: string | null;
  verifiedByName: string;
  verifiedByRoleKey: string;
  verifiedAt: string | null;
  reviewedStageCode: string;
  remarks: string;
  applicantRemarks: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  nocType: NocTypeRef;
  hasDocument: boolean;
  verificationProblems: string[];
};

export type TabNoc = NocRecord & { officerMoves: NocAction[]; applicantMoves: NocAction[] };

export type NocPermissions = {
  isDesk: boolean;
  isApplicant: boolean;
  deskReason: string;
  demoDocumentAllowed: boolean;
};

export type AvailableNocType = {
  id: string;
  code: string;
  name: string;
  authority: string;
  description: string;
  /** Checklist questions this applicant answered YES to — a hint only. */
  suggestedBy: number[];
};

export type ApplicationNocsPayload = {
  application: NocApplication;
  nocs: TabNoc[];
  tally: NocTally;
  available: AvailableNocType[];
  permissions: NocPermissions;
};

export type NocEvent = {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorName: string;
  actorRoleKey: string;
  stageCode: string;
  stageName: string;
  remarks: string;
  occurredAt: string;
};

export type NocDetail = NocRecord & {
  application: NocApplication;
  events: NocEvent[];
  permissions: {
    officerMoves: NocAction[];
    applicantMoves: NocAction[];
    deskReason: string;
    demoDocumentAllowed: boolean;
  };
};

export type NocRow = {
  id: string;
  nocNumber: string;
  status: string;
  nocType: NocTypeRef;
  authority: string;
  appliedDate: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  referenceNumber: string;
  application: NocApplication;
};

export type NocSummary = {
  total: number;
  byStatus: Record<string, number>;
  pending: number;
  awaitingVerification: number;
  awaitingMe: number;
  verified: number;
  notRequired: number;
  shortfall: number;
  rejected: number;
  expired: number;
};

export type NocListPayload = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: NocRow[];
  summary?: NocSummary;
  meta?: {
    types: Array<{ id: string; code: string; name: string; isActive: boolean }>;
    desks: Array<{ code: string; label: string }>;
  };
};

export type NocFilters = {
  q: string;
  nocTypeId: string;
  status: string;
  desk: string;
  authority: string;
};
