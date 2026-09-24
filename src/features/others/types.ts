/**
 * The shapes the Others screen receives.
 *
 * Dates are ISO strings and areas are numbers by the time they arrive —
 * `serialize()` has already run at the boundary, so the server's own row type
 * is not true of this value.
 */

export type OthersRecord = {
  id: string;
  applicationId: string;

  mortgageApplicable: boolean;
  mortgageNumber: string;
  mortgageDate: string | null;
  mortgageSubRegistrar: string;
  mortgagePortion: string;
  mortgageAreaSqm: number | null;
  mortgageDocumentId: string | null;

  insuranceApplicable: boolean;
  insurancePolicyNumber: string;
  insuranceDate: string | null;
  insuranceValidUpto: string | null;
  insuranceDocumentId: string | null;

  solarRequired: boolean;
  solarProposed: boolean;
  solarInstalled: boolean;
  solarCapacityKw: number | null;
  solarRemarks: string;

  rwhRequired: boolean;
  rwhProposed: boolean;
  rwhProvided: boolean;
  rwhRemarks: string;

  greeningRequired: boolean;
  greeningProposed: boolean;
  greeningProvided: boolean;
  treeCount: number | null;
  greeningRemarks: string;

  specialRemarks: string;
  updatedAt: string | null;
};

/** An uploaded document the mortgage deed or the policy can cite. */
export type SupportingDocument = {
  id: string;
  name: string;
  code: string;
  status: string;
};

export type OthersPayload = {
  application: { id: string; applicationNumber: string; status: string };
  /** False while the row is synthesised — nobody has entered anything yet. */
  recorded: boolean;
  others: OthersRecord;
  documents: SupportingDocument[];
  canEdit: boolean;
  editBlockedReason: string | null;
};
