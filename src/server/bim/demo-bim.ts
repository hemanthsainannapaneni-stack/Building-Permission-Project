import { buildSampleIfc } from './sample-ifc';

/**
 * The BIM a demonstration application carries: an IFC4 model of the declared
 * building, placed at its district on the earth, and the particulars an LTP
 * would state about it.
 *
 * Shared by the demo seed (which drives the real upload service while the
 * file is still editable) and the backfill (which brings applications that
 * pre-date BIM up to shape). Pure — no database, no storage.
 *
 * Positions are district headquarters, to four decimals; the UTM figures are
 * computed from them, not invented, so the georeferencing on a demo model is
 * internally consistent.
 */

const DISTRICT_POSITIONS: Record<string, { lat: number; lon: number; elevationM: number }> = {
  Guntur: { lat: 16.3067, lon: 80.4365, elevationM: 33 },
  Krishna: { lat: 16.5062, lon: 80.648, elevationM: 23 },
  Visakhapatnam: { lat: 17.6868, lon: 83.2185, elevationM: 45 },
  Nellore: { lat: 14.4426, lon: 79.9865, elevationM: 19 },
  Kurnool: { lat: 15.8281, lon: 78.0373, elevationM: 281 },
  Anantapur: { lat: 14.6819, lon: 77.6006, elevationM: 335 },
};

const FALLBACK_POSITION = { lat: 16.5062, lon: 80.648, elevationM: 23 };

export type DemoBimSource = {
  applicationNumber: string;
  district: string;
  plotNo?: string;
  applicantName?: string;
  ltpName?: string;
  firm?: string;
  status: string;
  building: {
    numFloors: number;
    numBasements: number;
    numDwellingUnits: number;
    buildingHeightM: number;
    plotAreaSqm: number | null;
    builtUpAreaSqm: number | null;
    floorAreaSqm: number | null;
    coverageAreaSqm: number | null;
    setbackFrontM: number;
    setbackRearM: number;
    setbackLeftM: number;
    setbackRightM: number;
    parkingAreaSqm: number;
    buildingUse: string;
  };
};

export function demoBimFor(src: DemoBimSource) {
  const seed = hash(src.applicationNumber);
  const pos = DISTRICT_POSITIONS[src.district] ?? FALLBACK_POSITION;
  // Spread plots a few hundred metres around the district centre, stably.
  const lat = round(pos.lat + (((seed % 1000) / 1000) - 0.5) * 0.02, 6);
  const lon = round(pos.lon + ((((seed >> 10) % 1000) / 1000) - 0.5) * 0.02, 6);
  const utm = latLonToUtm(lat, lon);

  const b = src.building;
  const floors = Math.max(1, b.numFloors || 1);
  const basements = Math.max(0, b.numBasements || 0);
  const storeyHeight = b.buildingHeightM > 0 ? round(b.buildingHeightM / floors, 2) : 3.2;

  // A file that failed scrutiny is the one whose model shows why: its
  // built-up area runs over the declared figure. Everything else agrees, to
  // within the rounding an authoring tool's schedule introduces.
  const overBuilt = src.status === 'SCRUTINY_FAILED';
  const jitter = (n: number | null, pct: number) => (n === null ? null : round(n * (1 + pct), 2));
  const modelBua = jitter(b.builtUpAreaSqm, overBuilt ? 0.07 : ((seed % 7) - 3) / 1000);

  const tools = [
    { code: 'REVIT', version: 'Autodesk Revit 2025.2', system: 'Autodesk Revit 2025 (ENU)' },
    { code: 'ARCHICAD', version: 'Archicad 27', system: 'Archicad 27.3.0 INT FULL' },
    { code: 'REVIT', version: 'Autodesk Revit 2024.3', system: 'Autodesk Revit 2024 (ENU)' },
    { code: 'ALLPLAN', version: 'Allplan 2024', system: 'Allplan 2024-1-3' },
  ] as const;
  const tool = tools[seed % tools.length]!;

  const ifcText = buildSampleIfc({
    projectName: `${src.applicationNumber}${src.plotNo ? ` — Plot ${src.plotNo}` : ''}`,
    siteName: src.plotNo ? `Plot ${src.plotNo}` : 'Site',
    buildingName: src.applicantName ? `${src.applicantName} — ${titleCase(b.buildingUse || 'building')}` : 'Building',
    numFloors: floors,
    numBasements: basements,
    floorHeightM: storeyHeight,
    spacesPerFloor: Math.max(2, Math.ceil((b.numDwellingUnits || floors) / floors) * 3),
    latitude: lat,
    longitude: lon,
    elevationM: pos.elevationM,
    crsName: utm.epsg,
    eastings: utm.easting,
    northings: utm.northing,
    author: src.ltpName ?? 'LTP',
    organization: src.firm ?? 'BBAS LTP',
    originatingSystem: tool.system,
  });

  const storeys = [
    ...Array.from({ length: basements }, (_, i) => ({
      name: `Basement ${basements - i}`,
      elevationM: round(-(basements - i) * 3.2, 2),
      heightM: 3.2,
      grossAreaSqm: b.coverageAreaSqm ? round(b.coverageAreaSqm, 2) : null,
      use: 'Parking',
    })),
    ...Array.from({ length: floors }, (_, i) => ({
      name: i === 0 ? 'Ground Floor' : `Floor ${i}`,
      elevationM: round(i * storeyHeight, 2),
      heightM: storeyHeight,
      grossAreaSqm: modelBua ? round(modelBua / floors, 2) : null,
      use: i === 0 && basements === 0 && b.parkingAreaSqm > 0 ? 'Stilt parking' : titleCase(b.buildingUse || 'Residential'),
    })),
  ];

  const unresolvedHard = overBuilt ? 2 : 0;

  const particulars = {
    modelReference: `${src.applicationNumber}-FED-M3`,
    authoringSoftware: tool.code,
    authoringVersion: tool.version,
    ifcSchema: 'IFC4',
    modelViewDefinition: 'REFERENCE_VIEW',
    levelOfDevelopment: floors > 4 ? 'LOD_350' : 'LOD_300',
    classificationSystem: 'NBC_2016',
    lengthUnit: 'MILLIMETRE',
    disciplines: floors > 4 ? ['ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'FIRE'] : ['ARCHITECTURAL', 'STRUCTURAL'],
    crsCode: utm.epsg,
    verticalDatum: 'MSL',
    siteLatitude: lat,
    siteLongitude: lon,
    originEasting: utm.easting,
    originNorthing: utm.northing,
    originHeightM: pos.elevationM,
    trueNorthDeg: round(((seed >> 4) % 900) / 100 - 4.5, 2),
    modelPlotAreaSqm: jitter(b.plotAreaSqm, 0),
    modelBuiltUpAreaSqm: modelBua,
    modelCoverageAreaSqm: jitter(b.coverageAreaSqm, 0),
    modelFarAreaSqm: jitter(b.floorAreaSqm, overBuilt ? 0.07 : 0),
    modelBuildingHeightM: b.buildingHeightM > 0 ? round(b.buildingHeightM, 2) : null,
    modelNumFloors: floors,
    modelNumBasements: basements,
    modelDwellingUnits: b.numDwellingUnits || 0,
    modelParkingSpaces: b.parkingAreaSqm > 0 ? Math.max(1, Math.floor(b.parkingAreaSqm / 12.5)) : 0,
    modelSetbackFrontM: b.setbackFrontM,
    modelSetbackRearM: b.setbackRearM,
    modelSetbackLeftM: b.setbackLeftM,
    modelSetbackRightM: b.setbackRightM,
    storeys,
    contentChecklist: {
      SITE_BOUNDARY: true,
      ROAD_ACCESS: true,
      SETBACK_ZONES: true,
      BUILDING_FOOTPRINT: true,
      STOREYS_NAMED: true,
      SPACES_CLASSIFIED: true,
      UNITS_ZONED: (b.numDwellingUnits || 0) > 1,
      VERTICAL_CIRCULATION: true,
      FIRE_ESCAPE: true,
      PARKING: true,
      OPENINGS: true,
      STRUCTURE: true,
      ACCESSIBILITY: floors > 2,
      SERVICES: true,
      PROPERTY_SETS: true,
    } as Record<string, boolean>,
    clashDetectionDone: true,
    clashTool: seed % 2 ? 'Navisworks Manage 2025' : 'Solibri Office',
    unresolvedHardClashes: unresolvedHard,
    unresolvedSoftClashes: seed % 5,
    ifcValidationDone: true,
    ifcValidationTool: 'buildingSMART Validation Service',
    drawingsFromModel: true,
    bepReference: `BEP-${src.applicationNumber}-R1`,
    cdePlatform: seed % 2 ? 'Autodesk Construction Cloud' : 'Trimble Connect',
    informationStandard: 'ISO_19650',
    bimManagerName: src.ltpName ?? '',
    bimManagerOrganisation: src.firm ?? '',
    bimManagerEmail: src.ltpName ? `${slug(src.ltpName)}@bim.example.in` : '',
    bimManagerPhone: '',
    bimManagerCredential: '',
    remarks: '',
  };

  return { ifcText, particulars, fileName: `${slug(src.applicationNumber)}-federated.ifc` };
}

// ═══════════════════════════════════════════════════════════════════════════
// WGS 84 → UTM (north hemisphere), the standard Krüger series to ~1 mm
// ═══════════════════════════════════════════════════════════════════════════

export function latLonToUtm(lat: number, lon: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const a = 6_378_137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lambda0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lambda0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500_000;
  const northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));

  return { zone, epsg: `EPSG:${32600 + zone}`, easting: round(easting, 3), northing: round(northing, 3) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';

const titleCase = (v: string) =>
  v
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
