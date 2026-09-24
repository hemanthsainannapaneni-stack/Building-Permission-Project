import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseIfcText, readIfc } from '@/server/bim/ifc';
import { buildSampleIfc } from '@/server/bim/sample-ifc';
import { checkContent } from '@/server/storage/sniff';
import { evaluateReadiness, reconcile, type BimRecordLike, type DeclaredBuilding } from '@/lib/bim';
import { updateBimSchema, reviewBimSchema } from '@/lib/schemas/bim';

const sample = () =>
  buildSampleIfc({
    projectName: 'Plot 42 Residence',
    numFloors: 4,
    numBasements: 1,
    latitude: 17.385044,
    longitude: 78.486671,
    elevationM: 505,
    crsName: 'EPSG:32644',
    eastings: 217_000.5,
    northings: 1_924_000.25,
    originatingSystem: 'Autodesk Revit 2025 (ENU)',
  });

describe('IFC reader', () => {
  it('reads the header, units, storeys, spaces and georeferencing', () => {
    const facts = parseIfcText(sample());

    expect(facts.parsed).toBe(true);
    expect(facts.schema).toBe('IFC4');
    expect(facts.viewDefinition).toBe('ReferenceView_V1.2');
    expect(facts.originatingSystem).toBe('Autodesk Revit 2025 (ENU)');
    expect(facts.lengthUnit).toBe('MILLIMETRE');
    expect(facts.projectName).toBe('Plot 42 Residence');

    // Millimetre elevations come back in metres, sorted, basement first.
    expect(facts.storeys.map((s) => s.name)).toEqual([
      'Basement 1',
      'Ground Floor',
      'Floor 1',
      'Floor 2',
      'Floor 3',
    ]);
    expect(facts.storeys[0]!.elevationM).toBeCloseTo(-3.2);
    expect(facts.storeys[2]!.elevationM).toBeCloseTo(3.2);

    expect(facts.counts.IFCSPACE).toBe(20);
    expect(facts.counts.IFCBUILDINGSTOREY).toBe(5);
    expect(facts.georef.hasMapConversion).toBe(true);
    expect(facts.georef.crsName).toBe('EPSG:32644');
    expect(facts.georef.eastings).toBeCloseTo(217_000.5);
    expect(facts.georef.refLatitude).toBeCloseTo(17.385044, 4);
    expect(facts.georef.refLongitude).toBeCloseTo(78.486671, 4);
    expect(facts.georef.refElevation).toBeCloseTo(505);
  });

  it('counts IfcWallStandardCase as a wall, and ignores semicolons inside strings', () => {
    const text = sample().replace(
      'ENDSEC;\nEND-ISO',
      "#9001=IFCWALLSTANDARDCASE('x',$,'Wall; with a semicolon',$,$,$,$,$,$);\nENDSEC;\nEND-ISO"
    );
    const facts = parseIfcText(text);
    expect(facts.parsed).toBe(true);
    expect(facts.counts.IFCWALL).toBe(21);
  });

  it('decodes \\X2\\ escapes in names', () => {
    const text = sample().replace("'Ground Floor'", "'Ground \\X2\\0924\\X0\\ Floor'");
    expect(parseIfcText(text).storeys.some((s) => s.name === 'Ground त Floor')).toBe(true);
  });

  it('reads a model inside an .ifczip', () => {
    const zipped = Buffer.from(zipSync({ 'model.ifc': strToU8(sample()) }));
    const facts = readIfc(zipped, 'ifczip');
    expect(facts.parsed).toBe(true);
    expect(facts.format).toBe('IFC_ZIP');
    expect(facts.storeys).toHaveLength(5);
  });

  it('reports rather than throws on something that is not IFC', () => {
    const facts = readIfc(Buffer.from('%PDF-1.7 nope'), 'ifc');
    expect(facts.parsed).toBe(false);
    expect(facts.error).toMatch(/not an IFC/);
  });
});

describe('sniffing BIM files', () => {
  it('accepts an IFC as .ifc, whatever the browser called it', () => {
    const bytes = Buffer.from(sample());
    expect(checkContent(bytes, 'application/octet-stream', 'ifc')).toMatchObject({ ok: true, kind: 'ifc' });
    expect(checkContent(bytes, 'text/plain', 'ifc')).toMatchObject({ ok: true, kind: 'ifc' });
  });

  it('refuses a PDF renamed to .ifc', () => {
    expect(checkContent(Buffer.from('%PDF-1.7\n'), 'application/octet-stream', 'ifc').ok).toBe(false);
  });

  it('accepts zip containers for .ifczip, .bcfzip and .xlsx', () => {
    const zip = Buffer.from(zipSync({ 'a.txt': strToU8('x') }));
    for (const ext of ['ifczip', 'bcfzip', 'bcf', 'xlsx']) {
      expect(checkContent(zip, 'application/octet-stream', ext).ok).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

const declared: DeclaredBuilding = {
  plotAreaSqm: 500,
  builtUpAreaSqm: 1000,
  floorAreaSqm: 900,
  coverageAreaSqm: 250,
  buildingHeightM: 12.8,
  numFloors: 4,
  numBasements: 1,
  numDwellingUnits: 8,
  achievedFar: 1.8,
  setbackFrontM: 3,
  setbackRearM: 2,
  setbackLeftM: 1.5,
  setbackRightM: 1.5,
};

const complete: BimRecordLike = {
  authoringSoftware: 'REVIT',
  ifcSchema: 'IFC4',
  modelViewDefinition: 'REFERENCE_VIEW',
  levelOfDevelopment: 'LOD_300',
  lengthUnit: 'MILLIMETRE',
  disciplines: ['ARCHITECTURAL', 'STRUCTURAL'],
  crsCode: 'EPSG:32644',
  siteLatitude: 17.38,
  siteLongitude: 78.48,
  modelPlotAreaSqm: 502,
  modelBuiltUpAreaSqm: 1004,
  modelCoverageAreaSqm: 250,
  modelFarAreaSqm: 902,
  modelBuildingHeightM: 12.8,
  modelNumFloors: 4,
  modelNumBasements: 1,
  modelDwellingUnits: 8,
  modelSetbackFrontM: 3,
  modelSetbackRearM: 2,
  modelSetbackLeftM: 1.5,
  modelSetbackRightM: 1.5,
  contentChecklist: Object.fromEntries(
    [
      'SITE_BOUNDARY',
      'SETBACK_ZONES',
      'BUILDING_FOOTPRINT',
      'STOREYS_NAMED',
      'SPACES_CLASSIFIED',
      'VERTICAL_CIRCULATION',
      'FIRE_ESCAPE',
      'PARKING',
      'OPENINGS',
      'PROPERTY_SETS',
    ].map((c) => [c, true])
  ),
  clashDetectionDone: true,
  unresolvedHardClashes: 0,
  unresolvedSoftClashes: 2,
  ifcValidationDone: true,
  bimManagerName: 'A. Rao',
  bimManagerEmail: 'rao@example.com',
  declaredAt: new Date(),
};

describe('reconciliation', () => {
  it('agrees within tolerance and names what disagrees', () => {
    const rows = reconcile(complete, declared);
    expect(rows.every((r) => r.status === 'MATCH')).toBe(true);

    const off = reconcile({ ...complete, modelBuiltUpAreaSqm: 1100, modelFarAreaSqm: 1000, modelSetbackFrontM: 2.5 }, declared);
    expect(off.find((r) => r.code === 'BUILT_UP_AREA')!.status).toBe('MISMATCH');
    expect(off.find((r) => r.code === 'SETBACK_FRONT')!.status).toBe('MISMATCH');
    // The model's FAR is derived from its FAR area, so that moves it too.
    expect(off.find((r) => r.code === 'FAR')!.status).toBe('MISMATCH');
  });

  it('treats a blank model figure as missing, not as a mismatch', () => {
    const rows = reconcile({ ...complete, modelBuildingHeightM: null }, declared);
    expect(rows.find((r) => r.code === 'HEIGHT')!.status).toBe('MISSING');
  });
});

describe('readiness', () => {
  const ifc = parseIfcText(sample());

  it('is ready when the model, the particulars and the application all agree', () => {
    const result = evaluateReadiness({ bim: complete, declared, ifc, ifcModelCount: 1 });
    expect(result.checks.filter((c) => c.status === 'FAIL' || c.status === 'PENDING')).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it('fails with no model, and says so first', () => {
    const result = evaluateReadiness({ bim: complete, declared, ifc: null, ifcModelCount: 0 });
    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ code: 'MODEL_UPLOADED', status: 'FAIL' });
  });

  it('catches a model with the wrong number of storeys', () => {
    const result = evaluateReadiness({ bim: complete, declared: { ...declared, numFloors: 6 }, ifc, ifcModelCount: 1 });
    expect(result.checks.find((c) => c.code === 'STOREYS')!.status).toBe('FAIL');
  });

  it('catches a declared schema the file contradicts', () => {
    const result = evaluateReadiness({ bim: { ...complete, ifcSchema: 'IFC2X3' }, declared, ifc, ifcModelCount: 1 });
    expect(result.checks.find((c) => c.code === 'IFC_SCHEMA')!.status).toBe('FAIL');
  });

  it('blocks on unresolved hard clashes', () => {
    const result = evaluateReadiness({ bim: { ...complete, unresolvedHardClashes: 3 }, declared, ifc, ifcModelCount: 1 });
    expect(result.checks.find((c) => c.code === 'CLASHES')!.status).toBe('FAIL');
    expect(result.ready).toBe(false);
  });

  it('waits for the declaration', () => {
    const result = evaluateReadiness({ bim: { ...complete, declaredAt: null }, declared, ifc, ifcModelCount: 1 });
    expect(result.checks.find((c) => c.code === 'DECLARATION')!.status).toBe('PENDING');
    expect(result.ready).toBe(false);
  });
});

describe('BIM schemas', () => {
  it('refuses an unlisted code and accepts a cleared one', () => {
    expect(updateBimSchema.safeParse({ levelOfDevelopment: 'LOD_999' }).success).toBe(false);
    expect(updateBimSchema.safeParse({ levelOfDevelopment: '' }).success).toBe(true);
  });

  it('refuses an empty patch', () => {
    expect(updateBimSchema.safeParse({}).success).toBe(false);
  });

  it('requires remarks when returning a model for correction', () => {
    expect(reviewBimSchema.safeParse({ reviewStatus: 'CORRECTIONS_REQUIRED', reviewRemarks: '' }).success).toBe(false);
    expect(reviewBimSchema.safeParse({ reviewStatus: 'ACCEPTED' }).success).toBe(true);
  });
});

describe('demo BIM', () => {
  it('converts a known point to UTM correctly', async () => {
    const { latLonToUtm } = await import('@/server/bim/demo-bim');
    // Vijayawada sits ~0.35° west of zone 44's central meridian (81°E), so
    // ~37.6 km west of the 500 km false easting.
    const utm = latLonToUtm(16.5062, 80.648);
    expect(utm.epsg).toBe('EPSG:32644');
    expect(utm.easting).toBeCloseTo(462_435, -1);
    expect(utm.northing).toBeCloseTo(1_824_962, -1);
    // Anantapur is west of 78°E, so zone 43.
    expect(latLonToUtm(14.6819, 77.6006).epsg).toBe('EPSG:32643');
  });

  it('produces a model the reader and the readiness check both accept', async () => {
    const { demoBimFor } = await import('@/server/bim/demo-bim');
    const building = {
      numFloors: 3, numBasements: 0, numDwellingUnits: 3, buildingHeightM: 9.6,
      plotAreaSqm: 300, builtUpAreaSqm: 540, floorAreaSqm: 540, coverageAreaSqm: 180,
      setbackFrontM: 3, setbackRearM: 1.5, setbackLeftM: 1, setbackRightM: 1,
      parkingAreaSqm: 40, buildingUse: 'RESIDENTIAL',
    };
    const demo = demoBimFor({ applicationNumber: 'BP-2026-000042', district: 'Guntur', status: 'APPROVED', ltpName: 'K. Rao', building });
    const facts = parseIfcText(demo.ifcText);
    expect(facts.parsed).toBe(true);
    expect(facts.storeys).toHaveLength(3);

    const result = evaluateReadiness({
      bim: { ...demo.particulars, declaredAt: new Date() },
      declared: { ...building, achievedFar: 1.8 },
      ifc: facts,
      ifcModelCount: 1,
    });
    expect(result.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
  });
});
