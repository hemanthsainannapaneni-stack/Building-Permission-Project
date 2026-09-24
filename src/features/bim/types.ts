import type { IfcFacts, ReadinessCheck, ReconciliationRow } from '@/lib/bim';

/**
 * The shapes the BIM tab receives. Dates are ISO strings by the time they
 * arrive — `serialize()` has already run at the boundary.
 */

export type BimStorey = {
  name: string;
  elevationM: number | null;
  heightM: number | null;
  grossAreaSqm: number | null;
  use: string;
};

export type BimRecord = {
  id: string;
  applicationId: string;

  modelReference: string;
  authoringSoftware: string;
  authoringVersion: string;
  ifcSchema: string;
  modelViewDefinition: string;
  levelOfDevelopment: string;
  classificationSystem: string;
  lengthUnit: string;
  disciplines: string[];

  crsCode: string;
  verticalDatum: string;
  siteLatitude: number | null;
  siteLongitude: number | null;
  originEasting: number | null;
  originNorthing: number | null;
  originHeightM: number | null;
  trueNorthDeg: number | null;

  modelPlotAreaSqm: number | null;
  modelBuiltUpAreaSqm: number | null;
  modelCoverageAreaSqm: number | null;
  modelFarAreaSqm: number | null;
  modelBuildingHeightM: number | null;
  modelNumFloors: number | null;
  modelNumBasements: number | null;
  modelDwellingUnits: number | null;
  modelParkingSpaces: number | null;
  modelSetbackFrontM: number | null;
  modelSetbackRearM: number | null;
  modelSetbackLeftM: number | null;
  modelSetbackRightM: number | null;
  storeys: BimStorey[];
  contentChecklist: Record<string, boolean>;

  clashDetectionDone: boolean;
  clashTool: string;
  clashDetectionDate: string | null;
  unresolvedHardClashes: number | null;
  unresolvedSoftClashes: number | null;
  ifcValidationDone: boolean;
  ifcValidationTool: string;
  drawingsFromModel: boolean;

  bepReference: string;
  cdePlatform: string;
  informationStandard: string;
  bimManagerName: string;
  bimManagerOrganisation: string;
  bimManagerEmail: string;
  bimManagerPhone: string;
  bimManagerCredential: string;

  remarks: string;

  declaredAt: string | null;
  declaredById: string | null;
  declaredByName: string | null;
  reviewStatus: string;
  reviewRemarks: string;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  updatedAt: string | null;
};

export type BimVersionRow = {
  id: string;
  versionNo: number;
  remarks: string;
  ifcFacts: IfcFacts | Record<string, never>;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  isActive: boolean;
  downloadable: boolean;
  file: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    scanStatus: string;
    checksumSha256: string;
  };
};

export type BimModelRow = {
  id: string;
  kind: string;
  discipline: string;
  title: string;
  currentVersionNo: number;
  createdAt: string;
  versions: BimVersionRow[];
};

export type BimPayload = {
  application: { id: string; applicationNumber: string; status: string };
  recorded: boolean;
  bim: BimRecord;
  models: BimModelRow[];
  primaryFacts: IfcFacts | null;
  readiness: {
    checks: ReadinessCheck[];
    reconciliation: ReconciliationRow[];
    ready: boolean;
    score: number;
  };
  canEdit: boolean;
  editBlockedReason: string | null;
  reviewOpen: boolean;
  isApplicant: boolean;
};
