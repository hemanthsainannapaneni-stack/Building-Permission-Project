/**
 * The shapes the application screens receive.
 *
 * Declared here rather than inferred from the Prisma selects because these
 * cross the server/client boundary: by the time a row reaches a client
 * component, `serialize()` has turned every Date into an ISO string, so the
 * server's type is no longer accurate. These say what actually arrives.
 */

export type ApplicationRow = {
  id: string;
  applicationNumber: string;
  status: string;
  currentStageCode: string | null;
  slaDueAt: string | null;
  slaStatus: string | null;
  slaDaysRemaining: number | null;
  openShortfalls: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  propertyLabel: string;
  applicationType: { id: string; code: string; name: string; numberPrefix: string } | null;
  applicant: { name: string | null; phone: string | null } | null;
  property: {
    district: string | null;
    localityName: string;
    surveyNumbers: string | null;
    plotNo: string;
    plotAreaSqm: number | null;
  } | null;
  zone: { id: string; code: string; name: string } | null;
  ltp: { id: string; name: string; firmName: string | null } | null;
  /** Worst outstanding state across every live demand on the file. */
  feeStatus: 'NONE' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED';
  /** The most recent payment attempt, or null when none has been made. */
  paymentStatus: string | null;
  /**
   * Who holds the open task. `claimed: false` means the file is addressed to
   * the role and sitting in a shared inbox — which is a different fact from
   * "nobody is working on it", and the register shows the difference.
   */
  assignedTo: { name: string | null; roleKey: string; claimed: boolean } | null;
};

export type ApplicationDetail = ApplicationRow & {
  ltpUserId: string;
  zoneId: string | null;
  purpose: string;
  /** The BBAS general-information classification. See src/lib/bbas-fields.ts. */
  caseType: string;
  permissionType: string;
  natureOfPermission: string;
  landType: string;
  lpsStatus: string;
  riskCategory: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  ltpDeclaredAt: string | null;
  ltpDeclaration: Record<string, unknown> | null;
  hasDraft: boolean;
  applicationType: {
    id: string;
    code: string;
    name: string;
    description: string;
    numberPrefix: string;
    requiresScrutiny: boolean;
  } | null;
  applicant: ApplicantRecord | null;
  property: PropertyRecord | null;
  building: BuildingRecord | null;
};

/**
 * Nullable where the column is nullable, and that is load-bearing: NULL means
 * the LTP has not answered yet, which a DRAFT is entitled to. Rendering must
 * therefore distinguish "not entered" from an empty string a user actually
 * typed. See prisma/schema.prisma for the convention.
 */
export type ApplicantRecord = {
  name: string | null;
  fatherName: string;
  email: string;
  phone: string | null;
  aadhaarLast4: string;
  panMasked: string;
  address: string;
  ownerSameAsApplicant: boolean;
  ownerName: string;
  ownerPhone: string;
  ownerAddress: string;
  developerName: string;
  developerPhone: string;
  developerRegistrationNo: string;
  structuralEngineerName: string;
  structuralEngineerPhone: string;
  structuralEngineerRegNo: string;
  professionalRegistrationRef: string;
  usagePurpose: string;
};

export type PropertyRecord = {
  district: string | null;
  mandal: string;
  village: string;
  localityName: string;
  wardNo: string;
  streetName: string;
  doorNo: string;
  pincode: string;
  surveyNumbers: string | null;
  plotNo: string;
  layoutName: string;
  lpNumber: string;
  plotAreaSqm: number | null;
  roadWidthM: number;
  landUseZone: string;
  tenureType: string;
  latitude: number | null;
  longitude: number | null;
  boundaryNorth: string;
  boundarySouth: string;
  boundaryEast: string;
  boundaryWest: string;

  // BBAS location
  gramPanchayat: string;
  township: string;
  sector: string;
  colony: string;
  natureOfSite: string;
  blockNo: string;
  rsNo: string;
  zoningDistrict: string;
  roadName: string;

  // The plot-area chain. Null means not entered — see src/lib/plot-area.ts.
  documentAreaSqm: number | null;
  groundAreaSqm: number | null;
  grossPlotAreaSqm: number | null;
  roadWideningDeductionSqm: number | null;
  greenBufferDeductionSqm: number | null;
  surrenderGiftAreaSqm: number | null;
  netPlotAreaSqm: number | null;
  tdrAreaSqm: number | null;
  marketValue: number | null;
  irr: string;
  hasExistingConstruction: boolean;
  existingConstruction: string;

  // Constraints
  religiousStructureNearby: boolean;
  religiousStructureDistanceM: number | null;
  aerodromeNearby: boolean;
  aerodromeDistanceM: number | null;
  waterBodyNearby: boolean;
  waterBodyDistanceM: number | null;
  railwayNearby: boolean;
  railwayDistanceM: number | null;
  htLineNearby: boolean;
  htLineDistanceM: number | null;
  monumentNearby: boolean;
  monumentDistanceM: number | null;
  constraintRemarks: string;
};

export type BuildingRecord = {
  buildingUse: string;
  buildingSubUse: string;
  occupancyType: string;
  structureType: string;
  proposedActivity: string;
  numFloors: number;
  numBasements: number;
  numDwellingUnits: number;
  buildingHeightM: number;
  plotAreaSqm: number | null;
  builtUpAreaSqm: number | null;
  floorAreaSqm: number;
  coverageAreaSqm: number;
  parkingAreaSqm: number;
  achievedFar: number;
  achievedCoverage: number;
  setbackFrontM: number;
  setbackRearM: number;
  setbackLeftM: number;
  setbackRightM: number;
};

export type ApplicationMeta = {
  types: Array<{
    id: string;
    code: string;
    name: string;
    description: string;
    numberPrefix: string;
    requiresScrutiny: boolean;
  }>;
  zones: Array<{ id: string; code: string; name: string }>;
  /** Administrator-extensible lists, keyed by category. */
  master: Record<string, Array<{ code: string; label: string }>>;
};

export type TimelineEvent = {
  id: string;
  sequence: number;
  type: string;
  title: string;
  description: string;
  actorName: string;
  actorRoleKey: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
};

export type WizardState = {
  application: ApplicationDetail;
  steps: Record<string, Record<string, unknown>>;
  completion: Record<string, boolean>;
  problems: Array<{ path: string; message: string }>;
  draft: {
    currentStep: number;
    completedSteps: string[];
    scratch: Record<string, unknown>;
    updatedAt: string | null;
  };
};

export type ListResult = {
  data: ApplicationRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** The API's error envelope. Every failing route returns this shape. */
export type ApiErrorBody = {
  error: string;
  code?: string;
  details?: Array<{ path: string; message: string }>;
};
