/**
 * BIM vocabulary and the readiness rules. Isomorphic — the BIM tab, the
 * validator and the service all read this file, so what the screen calls
 * "ready" and what the server calls "ready" are the same function.
 *
 * ── What a BIM-based permission asks of a model ──────────────────────────
 *
 * A PDF drawing is a picture of a building; an IFC model is a description of
 * one. The difference is what makes a BIM submission worth having: the plot
 * area, the storeys, the height and the floor areas can be READ OUT of the
 * model rather than typed in beside it. So the heart of this file is the
 * reconciliation — what the application declares against what the model
 * says — and every check below is either a precondition for that comparison
 * (a readable, georeferenced model with storeys and spaces) or the comparison
 * itself.
 *
 * The requirements follow the practice of the jurisdictions that run
 * model-based permitting (ISO 16739 IFC for exchange, ISO 19650 for
 * information management, BIMForum LOD for maturity). None of them is a
 * byelaw clause, and none is quoted as one.
 */

import { canUploadDrawing } from './drawings';

// ═══════════════════════════════════════════════════════════════════════════
// Vocabularies
// ═══════════════════════════════════════════════════════════════════════════

export type Option = { code: string; label: string; hint?: string };

export const IFC_SCHEMAS: Option[] = [
  { code: 'IFC4X3_ADD2', label: 'IFC 4.3 ADD2', hint: 'ISO 16739-1:2024' },
  { code: 'IFC4', label: 'IFC 4 ADD2 TC1', hint: 'ISO 16739-1:2018' },
  { code: 'IFC2X3', label: 'IFC 2x3 TC1', hint: 'Legacy — accepted, not preferred' },
];

export const MODEL_VIEW_DEFINITIONS: Option[] = [
  { code: 'REFERENCE_VIEW', label: 'IFC4 Reference View', hint: 'The usual view for a permit model' },
  { code: 'DESIGN_TRANSFER_VIEW', label: 'IFC4 Design Transfer View' },
  { code: 'COORDINATION_VIEW_2_0', label: 'Coordination View 2.0', hint: 'IFC 2x3' },
  { code: 'OTHER', label: 'Other' },
];

export const LOD_LEVELS: Option[] = [
  { code: 'LOD_100', label: 'LOD 100', hint: 'Conceptual massing' },
  { code: 'LOD_200', label: 'LOD 200', hint: 'Approximate geometry' },
  { code: 'LOD_300', label: 'LOD 300', hint: 'Precise geometry — the permit minimum' },
  { code: 'LOD_350', label: 'LOD 350', hint: 'Coordinated, with interfaces' },
  { code: 'LOD_400', label: 'LOD 400', hint: 'Fabrication' },
  { code: 'LOD_500', label: 'LOD 500', hint: 'As-built' },
];

/** The minimum level of development a permit model is expected to reach. */
export const MIN_PERMIT_LOD = 'LOD_300';

export const AUTHORING_TOOLS: Option[] = [
  { code: 'REVIT', label: 'Autodesk Revit' },
  { code: 'ARCHICAD', label: 'Graphisoft Archicad' },
  { code: 'TEKLA', label: 'Tekla Structures' },
  { code: 'ALLPLAN', label: 'Allplan' },
  { code: 'VECTORWORKS', label: 'Vectorworks' },
  { code: 'BRICSCAD_BIM', label: 'BricsCAD BIM' },
  { code: 'OPENBUILDINGS', label: 'Bentley OpenBuildings' },
  { code: 'BONSAI', label: 'Bonsai (BlenderBIM)' },
  { code: 'OTHER', label: 'Other' },
];

export const CLASSIFICATION_SYSTEMS: Option[] = [
  { code: 'NBC_2016', label: 'NBC 2016 occupancy groups', hint: 'National Building Code of India' },
  { code: 'UNICLASS_2015', label: 'Uniclass 2015' },
  { code: 'OMNICLASS', label: 'OmniClass' },
  { code: 'MASTERFORMAT', label: 'MasterFormat' },
  { code: 'NONE', label: 'None' },
];

export const LENGTH_UNITS: Option[] = [
  { code: 'MILLIMETRE', label: 'Millimetres' },
  { code: 'METRE', label: 'Metres' },
];

export const BIM_DISCIPLINES: Option[] = [
  { code: 'ARCHITECTURAL', label: 'Architectural' },
  { code: 'STRUCTURAL', label: 'Structural' },
  { code: 'MEP', label: 'Mechanical, electrical & plumbing' },
  { code: 'FIRE', label: 'Fire & life safety' },
  { code: 'SITE', label: 'Site & civil' },
  { code: 'LANDSCAPE', label: 'Landscape' },
];

/**
 * Projected systems a model in this region is placed in. Geographic WGS 84 is
 * listed because people choose it, and warned about below because a model
 * cannot be measured in degrees.
 */
export const CRS_OPTIONS: Option[] = [
  { code: 'EPSG:32643', label: 'WGS 84 / UTM zone 43N', hint: 'EPSG:32643' },
  { code: 'EPSG:32644', label: 'WGS 84 / UTM zone 44N', hint: 'EPSG:32644' },
  { code: 'EPSG:32645', label: 'WGS 84 / UTM zone 45N', hint: 'EPSG:32645' },
  { code: 'EPSG:7755', label: 'WGS 84 / India NSF LCC', hint: 'EPSG:7755' },
  { code: 'EPSG:4326', label: 'WGS 84 geographic', hint: 'Not projected' },
  { code: 'OTHER', label: 'Other' },
];

export const VERTICAL_DATUMS: Option[] = [
  { code: 'MSL', label: 'Mean Sea Level (Survey of India)' },
  { code: 'EGM2008', label: 'EGM2008 geoid' },
  { code: 'LOCAL', label: 'Local site datum' },
];

export const INFORMATION_STANDARDS: Option[] = [
  { code: 'ISO_19650', label: 'ISO 19650-1/-2' },
  { code: 'BS_1192', label: 'BS 1192 / PAS 1192 (legacy)' },
  { code: 'ORGANISATION', label: "The firm's own standard" },
  { code: 'NONE', label: 'None' },
];

export const REVIEW_STATUSES: Option[] = [
  { code: 'NOT_REVIEWED', label: 'Not reviewed' },
  { code: 'ACCEPTED', label: 'Accepted' },
  { code: 'CORRECTIONS_REQUIRED', label: 'Corrections required' },
];

/**
 * What a permit model must contain. `required` items are the ones the
 * byelaws are checked against — setbacks, storeys, spaces, circulation,
 * escape, parking, openings — and the readiness check names any left
 * unticked.
 */
export const BIM_CONTENT_ITEMS: Array<Option & { required: boolean }> = [
  { code: 'SITE_BOUNDARY', label: 'Plot boundary on IfcSite', required: true },
  { code: 'ROAD_ACCESS', label: 'Abutting road and access, with width', required: false },
  { code: 'SETBACK_ZONES', label: 'Setback lines or zones', required: true },
  { code: 'BUILDING_FOOTPRINT', label: 'Building footprint', required: true },
  { code: 'STOREYS_NAMED', label: 'Every storey named, at its true elevation', required: true },
  { code: 'SPACES_CLASSIFIED', label: 'Every room an IfcSpace with use and area', required: true },
  { code: 'UNITS_ZONED', label: 'Dwelling / tenancy units grouped as IfcZone', required: false },
  { code: 'VERTICAL_CIRCULATION', label: 'Staircases, lifts and ramps', required: true },
  { code: 'FIRE_ESCAPE', label: 'Fire exits, escape routes and refuge areas', required: true },
  { code: 'PARKING', label: 'Parking bays and drive aisles', required: true },
  { code: 'OPENINGS', label: 'Doors and windows with sizes', required: true },
  { code: 'STRUCTURE', label: 'Structural grid, columns, beams and slabs', required: false },
  { code: 'ACCESSIBILITY', label: 'Accessible ramps, toilets and lifts', required: false },
  { code: 'SERVICES', label: 'Rainwater harvesting, solar, STP and fire services', required: false },
  {
    code: 'PROPERTY_SETS',
    label: 'Property sets populated (Pset_SpaceCommon, Pset_BuildingStoreyCommon)',
    required: true,
  },
];

// ── Files ────────────────────────────────────────────────────────────────

export const BIM_FILE_KINDS = [
  {
    code: 'IFC_MODEL',
    label: 'IFC model',
    extensions: ['ifc', 'ifczip'],
    hint: 'The federated model, or one per discipline. .ifc or .ifczip.',
  },
  {
    code: 'CLASH_REPORT',
    label: 'Clash / coordination report',
    extensions: ['bcf', 'bcfzip', 'pdf'],
    hint: 'BCF issues or the clash report as a PDF.',
  },
  {
    code: 'COBIE',
    label: 'COBie data',
    extensions: ['xlsx'],
    hint: 'Space and asset schedules exported from the model.',
  },
  {
    code: 'BEP',
    label: 'BIM Execution Plan',
    extensions: ['pdf'],
    hint: 'The plan the model was produced under.',
  },
  { code: 'OTHER', label: 'Other BIM deliverable', extensions: ['pdf'], hint: 'A PDF.' },
] as const;

export type BimFileKind = (typeof BIM_FILE_KINDS)[number]['code'];

export const BIM_FILE_KIND_CODES = BIM_FILE_KINDS.map((k) => k.code) as BimFileKind[];

export const extensionsFor = (kind: string): readonly string[] =>
  BIM_FILE_KINDS.find((k) => k.code === kind)?.extensions ?? ['pdf'];

export const acceptFor = (kind: string): string =>
  extensionsFor(kind)
    .map((e) => `.${e}`)
    .join(',');

/** Every extension any BIM deliverable may have — the storage pipeline's allow-list. */
export const ALL_BIM_EXTENSIONS = [
  ...new Set(BIM_FILE_KINDS.flatMap((k) => k.extensions as readonly string[])),
];

// ── Labels ───────────────────────────────────────────────────────────────

const ALL_OPTIONS: Option[] = [
  ...IFC_SCHEMAS,
  ...MODEL_VIEW_DEFINITIONS,
  ...LOD_LEVELS,
  ...AUTHORING_TOOLS,
  ...CLASSIFICATION_SYSTEMS,
  ...LENGTH_UNITS,
  ...BIM_DISCIPLINES,
  ...CRS_OPTIONS,
  ...VERTICAL_DATUMS,
  ...INFORMATION_STANDARDS,
  ...REVIEW_STATUSES,
  ...BIM_FILE_KINDS,
];

/** An unknown code renders as itself rather than blank — silence hides bugs. */
export function bimLabel(code: string | null | undefined, list: Option[] = ALL_OPTIONS): string {
  if (!code) return '—';
  return list.find((o) => o.code === code)?.label ?? code;
}

export const codesOf = (list: readonly Option[]): string[] => list.map((o) => o.code);

// ═══════════════════════════════════════════════════════════════════════════
// Gates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The model is the drawing set in another form, so it opens and closes with
 * the drawings: editable while drawings are, frozen once scrutiny has passed.
 * Two gates that could disagree would let an approved drawing sit beside a
 * model that changed afterwards.
 */
export const canEditBim = (status: string): boolean => canUploadDrawing(status);

export function whyCannotEditBim(status: string): string | null {
  if (canEditBim(status)) return null;
  if (status === 'SCRUTINY_IN_PROGRESS') {
    return 'Scrutiny is running on the current drawings. Wait for the result before changing the model.';
  }
  if (status === 'SCRUTINY_PASSED' || status === 'DOCUMENT_UPLOAD_PENDING') {
    return 'Scrutiny has passed. The model is now part of the record alongside the approved drawings.';
  }
  return 'This application is with the department, so its BIM model can no longer be changed.';
}

/** A department reviews a filed model, never a draft nobody has submitted. */
export const canReviewBim = (status: string): boolean => status !== 'DRAFT';

// ═══════════════════════════════════════════════════════════════════════════
// Facts the server reads out of an IFC file
// ═══════════════════════════════════════════════════════════════════════════

export type IfcStorey = { name: string; elevationM: number | null };

export type IfcFacts = {
  /** False when the file could not be read — `error` says why. */
  parsed: boolean;
  error?: string;
  format: 'IFC_STEP' | 'IFC_ZIP' | 'OTHER';
  schema: string;
  /** From FILE_DESCRIPTION's ViewDefinition, e.g. ReferenceView_V1.2. */
  viewDefinition: string;
  originatingSystem: string;
  preprocessor: string;
  author: string;
  organization: string;
  timeStamp: string;
  lengthUnit: string;
  projectName: string;
  siteName: string;
  buildingName: string;
  storeys: IfcStorey[];
  /** Element counts by IFC entity, upper-case. */
  counts: Record<string, number>;
  entityCount: number;
  georef: {
    hasMapConversion: boolean;
    crsName: string;
    eastings: number | null;
    northings: number | null;
    orthogonalHeight: number | null;
    refLatitude: number | null;
    refLongitude: number | null;
    refElevation: number | null;
  };
};

/** The entity counts worth showing an officer, in the order they read. */
export const IFC_COUNTED: Array<{ entity: string; label: string }> = [
  { entity: 'IFCBUILDINGSTOREY', label: 'Storeys' },
  { entity: 'IFCSPACE', label: 'Spaces' },
  { entity: 'IFCZONE', label: 'Zones' },
  { entity: 'IFCWALL', label: 'Walls' },
  { entity: 'IFCSLAB', label: 'Slabs' },
  { entity: 'IFCCOLUMN', label: 'Columns' },
  { entity: 'IFCBEAM', label: 'Beams' },
  { entity: 'IFCDOOR', label: 'Doors' },
  { entity: 'IFCWINDOW', label: 'Windows' },
  { entity: 'IFCSTAIR', label: 'Stairs' },
  { entity: 'IFCRAMP', label: 'Ramps' },
  { entity: 'IFCTRANSPORTELEMENT', label: 'Lifts' },
  { entity: 'IFCROOF', label: 'Roofs' },
  { entity: 'IFCPROPERTYSET', label: 'Property sets' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Readiness
// ═══════════════════════════════════════════════════════════════════════════

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'PENDING';

export type ReadinessCheck = {
  code: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type ReconciliationRow = {
  code: string;
  label: string;
  unit: string;
  declared: number | null;
  model: number | null;
  /** model − declared, when both are known. */
  difference: number | null;
  status: 'MATCH' | 'MISMATCH' | 'MISSING';
  tolerance: string;
};

/** The subset of the BIM record the rules read. */
export type BimRecordLike = {
  authoringSoftware: string;
  ifcSchema: string;
  modelViewDefinition: string;
  levelOfDevelopment: string;
  lengthUnit: string;
  disciplines: string[];
  crsCode: string;
  siteLatitude: number | null;
  siteLongitude: number | null;
  modelPlotAreaSqm: number | null;
  modelBuiltUpAreaSqm: number | null;
  modelCoverageAreaSqm: number | null;
  modelFarAreaSqm: number | null;
  modelBuildingHeightM: number | null;
  modelNumFloors: number | null;
  modelNumBasements: number | null;
  modelDwellingUnits: number | null;
  modelSetbackFrontM: number | null;
  modelSetbackRearM: number | null;
  modelSetbackLeftM: number | null;
  modelSetbackRightM: number | null;
  contentChecklist: Record<string, boolean>;
  clashDetectionDone: boolean;
  unresolvedHardClashes: number | null;
  unresolvedSoftClashes: number | null;
  ifcValidationDone: boolean;
  bimManagerName: string;
  bimManagerEmail: string;
  declaredAt: string | Date | null;
};

/** What the application itself declares, from `building_details`. */
export type DeclaredBuilding = {
  plotAreaSqm: number | null;
  builtUpAreaSqm: number | null;
  /** FSI-countable floor area — the FAR numerator. */
  floorAreaSqm: number | null;
  coverageAreaSqm: number | null;
  buildingHeightM: number | null;
  numFloors: number | null;
  numBasements: number | null;
  numDwellingUnits: number | null;
  achievedFar: number | null;
  setbackFrontM: number | null;
  setbackRearM: number | null;
  setbackLeftM: number | null;
  setbackRightM: number | null;
};

/** Areas may differ by rounding in the authoring tool's schedules; 2 % absorbs it. */
export const AREA_TOLERANCE = 0.02;
export const LENGTH_TOLERANCE_M = 0.15;
export const FAR_TOLERANCE = 0.02;

const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * A declared 0 on a nullable-by-default column is the schema's default, not
 * an answer, for the quantities that can never truly be zero on a filed
 * application. Treating it as "not declared" keeps a blank from reading as a
 * mismatch.
 */
const declaredOrNull = (n: number | null | undefined, zeroMeansBlank: boolean) =>
  !known(n) || (zeroMeansBlank && n === 0) ? null : n;

export function reconcile(bim: BimRecordLike, declared: DeclaredBuilding): ReconciliationRow[] {
  // The same convention as deriveFsi in approval-orders.ts: FSI-countable
  // floor area over plot area, falling back to built-up area where the model
  // does not separate the exempt parts out.
  const farArea = known(bim.modelFarAreaSqm) ? bim.modelFarAreaSqm : bim.modelBuiltUpAreaSqm;
  const modelFar =
    known(farArea) && known(bim.modelPlotAreaSqm) && bim.modelPlotAreaSqm > 0
      ? round(farArea / bim.modelPlotAreaSqm, 2)
      : null;

  const rows: Array<{
    code: string;
    label: string;
    unit: string;
    declared: number | null;
    model: number | null;
    kind: 'area' | 'length' | 'count' | 'ratio';
  }> = [
    { code: 'PLOT_AREA', label: 'Plot area', unit: 'sq m', kind: 'area', declared: declaredOrNull(declared.plotAreaSqm, true), model: bim.modelPlotAreaSqm },
    { code: 'BUILT_UP_AREA', label: 'Built-up area', unit: 'sq m', kind: 'area', declared: declaredOrNull(declared.builtUpAreaSqm, true), model: bim.modelBuiltUpAreaSqm },
    { code: 'FAR_AREA', label: 'FAR floor area', unit: 'sq m', kind: 'area', declared: declaredOrNull(declared.floorAreaSqm, true), model: bim.modelFarAreaSqm },
    { code: 'COVERAGE_AREA', label: 'Ground coverage', unit: 'sq m', kind: 'area', declared: declaredOrNull(declared.coverageAreaSqm, true), model: bim.modelCoverageAreaSqm },
    { code: 'FAR', label: 'FAR / FSI', unit: '', kind: 'ratio', declared: declaredOrNull(declared.achievedFar, true), model: modelFar },
    { code: 'HEIGHT', label: 'Building height', unit: 'm', kind: 'length', declared: declaredOrNull(declared.buildingHeightM, true), model: bim.modelBuildingHeightM },
    { code: 'FLOORS', label: 'Floors', unit: '', kind: 'count', declared: declaredOrNull(declared.numFloors, true), model: bim.modelNumFloors },
    { code: 'BASEMENTS', label: 'Basements', unit: '', kind: 'count', declared: declaredOrNull(declared.numBasements, false), model: bim.modelNumBasements },
    { code: 'DWELLING_UNITS', label: 'Dwelling units', unit: '', kind: 'count', declared: declaredOrNull(declared.numDwellingUnits, false), model: bim.modelDwellingUnits },
    { code: 'SETBACK_FRONT', label: 'Front setback', unit: 'm', kind: 'length', declared: declaredOrNull(declared.setbackFrontM, false), model: bim.modelSetbackFrontM },
    { code: 'SETBACK_REAR', label: 'Rear setback', unit: 'm', kind: 'length', declared: declaredOrNull(declared.setbackRearM, false), model: bim.modelSetbackRearM },
    { code: 'SETBACK_LEFT', label: 'Left setback', unit: 'm', kind: 'length', declared: declaredOrNull(declared.setbackLeftM, false), model: bim.modelSetbackLeftM },
    { code: 'SETBACK_RIGHT', label: 'Right setback', unit: 'm', kind: 'length', declared: declaredOrNull(declared.setbackRightM, false), model: bim.modelSetbackRightM },
  ];

  return rows.map((row) => {
    const tolerance =
      row.kind === 'area'
        ? `±${AREA_TOLERANCE * 100}%`
        : row.kind === 'length'
          ? `±${LENGTH_TOLERANCE_M} m`
          : row.kind === 'ratio'
            ? `±${FAR_TOLERANCE}`
            : 'exact';

    if (!known(row.declared) || !known(row.model)) {
      return { ...base(row), tolerance, difference: null, status: 'MISSING' as const };
    }

    const difference = round(row.model - row.declared, 2);
    const within =
      row.kind === 'area'
        ? Math.abs(difference) <= Math.max(row.declared * AREA_TOLERANCE, 0.5)
        : row.kind === 'length'
          ? Math.abs(difference) <= LENGTH_TOLERANCE_M
          : row.kind === 'ratio'
            ? Math.abs(difference) <= FAR_TOLERANCE
            : difference === 0;

    return { ...base(row), tolerance, difference, status: within ? ('MATCH' as const) : ('MISMATCH' as const) };
  });
}

const base = (row: { code: string; label: string; unit: string; declared: number | null; model: number | null }) => ({
  code: row.code,
  label: row.label,
  unit: row.unit,
  declared: row.declared,
  model: row.model,
});

const LOD_RANK = new Map(LOD_LEVELS.map((l, i) => [l.code, i]));

/**
 * Every check a BIM submission must pass before it is ready for the desk,
 * each with a sentence saying why it stands where it does.
 *
 * FAIL blocks readiness; WARN is reported and does not; PENDING is something
 * nobody has done yet. The sentence matters more than the colour — "3 storeys
 * in the model, 4 declared" is an instruction, a red dot is not.
 */
export function evaluateReadiness(input: {
  bim: BimRecordLike;
  declared: DeclaredBuilding;
  /** Facts from the active version of the first IFC model on file, if any. */
  ifc: IfcFacts | null;
  ifcModelCount: number;
}): { checks: ReadinessCheck[]; reconciliation: ReconciliationRow[]; ready: boolean; score: number } {
  const { bim, declared, ifc, ifcModelCount } = input;
  const checks: ReadinessCheck[] = [];
  const push = (code: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ code, label, status, detail });

  // 1 ── A model on file
  push(
    'MODEL_UPLOADED',
    'IFC model on file',
    ifcModelCount > 0 ? 'PASS' : 'FAIL',
    ifcModelCount > 0
      ? `${ifcModelCount} IFC model${ifcModelCount === 1 ? '' : 's'} uploaded.`
      : 'Upload the federated IFC model (.ifc or .ifczip) below.'
  );

  // 2 ── Readable
  if (!ifc) {
    push('MODEL_READABLE', 'Model readable by the system', 'PENDING', 'No model has been read yet.');
  } else if (!ifc.parsed) {
    push('MODEL_READABLE', 'Model readable by the system', 'FAIL', ifc.error || 'The model could not be read.');
  } else {
    push(
      'MODEL_READABLE',
      'Model readable by the system',
      'PASS',
      `${ifc.entityCount.toLocaleString('en-IN')} entities read${ifc.originatingSystem ? ` · exported from ${ifc.originatingSystem}` : ''}.`
    );
  }

  // 3 ── Schema
  const fileSchema = normaliseSchema(ifc?.schema ?? '');
  if (!ifc?.parsed) {
    push('IFC_SCHEMA', 'IFC schema', bim.ifcSchema ? 'PENDING' : 'FAIL', bim.ifcSchema ? `Declared ${bimLabel(bim.ifcSchema, IFC_SCHEMAS)}; waiting for a readable model to confirm it.` : 'Declare the IFC schema the model was exported in.');
  } else if (bim.ifcSchema && fileSchema && bim.ifcSchema !== fileSchema) {
    push('IFC_SCHEMA', 'IFC schema', 'FAIL', `Declared ${bimLabel(bim.ifcSchema, IFC_SCHEMAS)}, but the file is ${ifc.schema}.`);
  } else if (fileSchema === 'IFC2X3') {
    push('IFC_SCHEMA', 'IFC schema', 'WARN', 'IFC 2x3 is accepted, but IFC 4 or later carries georeferencing and quantities far more reliably.');
  } else if (fileSchema) {
    push('IFC_SCHEMA', 'IFC schema', 'PASS', `${bimLabel(fileSchema, IFC_SCHEMAS)}, confirmed from the file.`);
  } else {
    push('IFC_SCHEMA', 'IFC schema', 'WARN', `The file declares an unrecognised schema (${ifc.schema || 'none'}).`);
  }

  // 4 ── Georeferencing
  const fileGeo = Boolean(ifc?.parsed && (ifc.georef.hasMapConversion || (known(ifc.georef.refLatitude) && known(ifc.georef.refLongitude))));
  const declaredGeo = Boolean(bim.crsCode) && known(bim.siteLatitude) && known(bim.siteLongitude);
  if (bim.crsCode === 'EPSG:4326') {
    push('GEOREFERENCED', 'Georeferenced', 'WARN', 'WGS 84 geographic is not a projected system — place the model in UTM or the India NSF LCC so distances are metres.');
  } else if (fileGeo && declaredGeo) {
    push('GEOREFERENCED', 'Georeferenced', 'PASS', ifc?.georef.hasMapConversion ? `IfcMapConversion present${ifc.georef.crsName ? ` (${ifc.georef.crsName})` : ''}.` : 'Site latitude and longitude are set in the model.');
  } else if (declaredGeo) {
    push('GEOREFERENCED', 'Georeferenced', 'WARN', 'The CRS and site position are declared, but the model itself carries no georeferencing.');
  } else {
    push('GEOREFERENCED', 'Georeferenced', 'FAIL', 'Declare the coordinate reference system and the site latitude and longitude.');
  }

  // 5 ── Storeys
  const expected = (declared.numFloors ?? 0) + (declared.numBasements ?? 0);
  if (!ifc?.parsed) {
    push('STOREYS', 'Storeys match the application', 'PENDING', 'Waiting for a readable model.');
  } else if (!expected) {
    push('STOREYS', 'Storeys match the application', 'PENDING', 'The application does not declare its floors yet.');
  } else {
    const found = ifc.storeys.length;
    push(
      'STOREYS',
      'Storeys match the application',
      found === expected ? 'PASS' : found === expected + 1 ? 'WARN' : 'FAIL',
      found === expected
        ? `${found} storeys in the model, as declared.`
        : found === expected + 1
          ? `${found} storeys in the model, ${expected} declared — the extra level is usually a roof or terrace datum. Confirm it is not habitable.`
          : `${found} storeys in the model, ${expected} declared (floors plus basements).`
    );
  }

  // 6 ── Spaces
  if (!ifc?.parsed) {
    push('SPACES', 'Spaces modelled', 'PENDING', 'Waiting for a readable model.');
  } else {
    const spaces = ifc.counts.IFCSPACE ?? 0;
    push('SPACES', 'Spaces modelled', spaces > 0 ? 'PASS' : 'FAIL', spaces > 0 ? `${spaces} IfcSpace objects — areas can be verified room by room.` : 'The model has no IfcSpace objects, so its floor areas cannot be verified.');
  }

  // 7 ── Quantities
  const reconciliation = reconcile(bim, declared);
  const mismatched = reconciliation.filter((r) => r.status === 'MISMATCH');
  const missing = reconciliation.filter((r) => r.status === 'MISSING' && known(r.declared));
  push(
    'QUANTITIES',
    'Model quantities agree with the application',
    mismatched.length ? 'FAIL' : missing.length ? 'PENDING' : 'PASS',
    mismatched.length
      ? `Out of tolerance: ${mismatched.map((r) => r.label).join(', ')}.`
      : missing.length
        ? `Enter the model's figure for: ${missing.map((r) => r.label).join(', ')}.`
        : 'Every declared figure is within tolerance of the model.'
  );

  // 8 ── Model particulars
  const missingInfo = [
    !bim.authoringSoftware && 'authoring software',
    !bim.ifcSchema && 'IFC schema',
    !bim.modelViewDefinition && 'model view definition',
    !bim.levelOfDevelopment && 'level of development',
    !bim.lengthUnit && 'length unit',
    !bim.disciplines.length && 'disciplines',
  ].filter(Boolean) as string[];
  push('MODEL_INFO', 'Model particulars complete', missingInfo.length ? 'FAIL' : 'PASS', missingInfo.length ? `Missing: ${missingInfo.join(', ')}.` : 'Authoring, schema, view, LOD, units and disciplines are all stated.');

  // 9 ── LOD
  if (bim.levelOfDevelopment) {
    const ok = (LOD_RANK.get(bim.levelOfDevelopment) ?? -1) >= (LOD_RANK.get(MIN_PERMIT_LOD) ?? 0);
    push('LOD', 'Level of development', ok ? 'PASS' : 'WARN', ok ? `${bimLabel(bim.levelOfDevelopment, LOD_LEVELS)} meets the permit minimum.` : `${bimLabel(bim.levelOfDevelopment, LOD_LEVELS)} is below LOD 300 — setbacks and areas may not be measurable.`);
  } else {
    push('LOD', 'Level of development', 'PENDING', 'Declare the level of development.');
  }

  // 10 ── Clashes
  if (!bim.clashDetectionDone) {
    push('CLASHES', 'Clash detection', 'WARN', 'No clash detection has been reported for the federated model.');
  } else if (!known(bim.unresolvedHardClashes)) {
    push('CLASHES', 'Clash detection', 'PENDING', 'Report the number of unresolved hard clashes.');
  } else if (bim.unresolvedHardClashes > 0) {
    push('CLASHES', 'Clash detection', 'FAIL', `${bim.unresolvedHardClashes} unresolved hard clash${bim.unresolvedHardClashes === 1 ? '' : 'es'}.`);
  } else {
    push('CLASHES', 'Clash detection', 'PASS', `No unresolved hard clashes${known(bim.unresolvedSoftClashes) && bim.unresolvedSoftClashes > 0 ? `; ${bim.unresolvedSoftClashes} soft clash${bim.unresolvedSoftClashes === 1 ? '' : 'es'} noted` : ''}.`);
  }

  // 11 ── Content
  const unticked = BIM_CONTENT_ITEMS.filter((i) => i.required && !bim.contentChecklist[i.code]);
  push('CONTENT', 'Required model content', unticked.length ? 'WARN' : 'PASS', unticked.length ? `Not confirmed: ${unticked.map((i) => i.label.toLowerCase()).join('; ')}.` : 'Every required element is confirmed present.');

  // 12 ── BIM manager
  push('BIM_MANAGER', 'BIM manager named', bim.bimManagerName && bim.bimManagerEmail ? 'PASS' : 'WARN', bim.bimManagerName && bim.bimManagerEmail ? `${bim.bimManagerName} answers for the model.` : 'Name the person answerable for the model, with an email address.');

  // 13 ── Declaration
  push('DECLARATION', 'LTP declaration', bim.declaredAt ? 'PASS' : 'PENDING', bim.declaredAt ? 'The LTP has declared the model and drawings consistent.' : 'The LTP has not yet declared the current model.');

  const ready = !checks.some((c) => c.status === 'FAIL' || c.status === 'PENDING');
  const score = Math.round((checks.filter((c) => c.status === 'PASS').length / checks.length) * 100);

  return { checks, reconciliation, ready, score };
}

/** IFC4X3_ADD2, IFC4X3, IFC4X3_TC1 … all read as the 4.3 family. */
export function normaliseSchema(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (s.startsWith('IFC4X3')) return 'IFC4X3_ADD2';
  if (s.startsWith('IFC4')) return 'IFC4';
  if (s.startsWith('IFC2X3')) return 'IFC2X3';
  return '';
}

/** The MVD code a ViewDefinition string in the header corresponds to. */
export function normaliseViewDefinition(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('reference')) return 'REFERENCE_VIEW';
  if (s.includes('designtransfer') || s.includes('design transfer')) return 'DESIGN_TRANSFER_VIEW';
  if (s.includes('coordination')) return 'COORDINATION_VIEW_2_0';
  return raw ? 'OTHER' : '';
}

export const BIM_DECLARATION_TEXT =
  'I declare that the IFC model uploaded with this application describes the same building as the ' +
  'drawings on file; that the model quantities stated here were extracted from it; that the model is ' +
  'placed in the coordinate reference system stated; and that I am answerable for its accuracy.';

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
