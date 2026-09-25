/**
 * Writes a small, well-formed IFC4 model of a building from its particulars.
 *
 * Used by the demo seed, the BIM backfill and the tests, so the model the
 * upload pipeline reads in a demonstration is a real STEP file with a real
 * spatial structure — project, georeferenced site, building, one storey per
 * floor (basements below zero), spaces, walls, slabs, doors, windows, stairs —
 * and never a placeholder the parser has been taught to accept.
 *
 * Geometry is omitted: nothing in the permit pipeline reads B-reps, and a
 * geometry-free IFC is still valid ISO 10303-21.
 */

export type SampleIfcInput = {
  projectName: string;
  siteName?: string;
  buildingName?: string;
  numFloors: number;
  numBasements?: number;
  floorHeightM?: number;
  spacesPerFloor?: number;
  latitude?: number;
  longitude?: number;
  elevationM?: number;
  crsName?: string;
  eastings?: number;
  northings?: number;
  author?: string;
  organization?: string;
  originatingSystem?: string;
  timeStamp?: string;
};

export function buildSampleIfc(input: SampleIfcInput): string {
  const floors = Math.max(1, Math.trunc(input.numFloors));
  const basements = Math.max(0, Math.trunc(input.numBasements ?? 0));
  const h = input.floorHeightM ?? 3.2;
  const spacesPerFloor = Math.max(1, input.spacesPerFloor ?? 4);
  const lines: string[] = [];
  let n = 0;
  const add = (entity: string): string => {
    n += 1;
    lines.push(`#${n}=${entity};`);
    return `#${n}`;
  };
  const s = (v: string) => `'${v.replace(/'/g, "''")}'`;
  let guidCounter = 0;
  const guid = () => {
    guidCounter += 1;
    // 22-character IFC GlobalId alphabet; deterministic so tests are stable.
    return s(`0${guidCounter.toString(36).padStart(21, '0')}`.slice(0, 22));
  };

  const person = add(`IFCPERSON($,${s(input.author ?? 'LTP')},$,$,$,$,$,$)`);
  const org = add(`IFCORGANIZATION($,${s(input.organization ?? 'BBAS')},$,$,$)`);
  const pando = add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = add(`IFCAPPLICATION(${org},'1.0',${s(input.originatingSystem ?? 'BBAS BIM sample')},'BBAS')`);
  const owner = add(`IFCOWNERHISTORY(${pando},${app},$,.ADDED.,$,$,$,0)`);

  const mm = add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const area = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const units = add(`IFCUNITASSIGNMENT((${mm},${area}))`);

  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const axis = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${axis},$)`);

  const project = add(`IFCPROJECT(${guid()},${owner},${s(input.projectName)},$,$,$,$,(${context}),${units})`);

  if (input.crsName) {
    const crs = add(`IFCPROJECTEDCRS(${s(input.crsName)},$,'WGS84',$,'UTM',$,$)`);
    add(`IFCMAPCONVERSION(${context},${crs},${(input.eastings ?? 0).toFixed(3)},${(input.northings ?? 0).toFixed(3)},${(input.elevationM ?? 0).toFixed(3)},1.,0.,1.)`);
  }

  const angle = (deg: number | undefined) => {
    if (deg === undefined) return '$';
    const sign = deg < 0 ? -1 : 1;
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const sec = Math.floor(((a - d) * 60 - m) * 60);
    const micro = Math.round(((((a - d) * 60 - m) * 60 - sec) * 1_000_000));
    return `(${sign * d},${sign * m},${sign * sec},${sign * micro})`;
  };

  const placement = add(`IFCLOCALPLACEMENT($,${axis})`);
  const site = add(
    `IFCSITE(${guid()},${owner},${s(input.siteName ?? 'Site')},$,$,${placement},$,$,.ELEMENT.,${angle(input.latitude)},${angle(input.longitude)},${((input.elevationM ?? 0) * 1000).toFixed(1)},$,$)`
  );
  const building = add(`IFCBUILDING(${guid()},${owner},${s(input.buildingName ?? 'Building')},$,$,${placement},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${site},(${building}))`);

  const storeyRefs: string[] = [];
  const levels: Array<{ name: string; elevation: number }> = [];
  for (let b = basements; b >= 1; b -= 1) levels.push({ name: `Basement ${b}`, elevation: -b * h });
  for (let f = 0; f < floors; f += 1) levels.push({ name: f === 0 ? 'Ground Floor' : `Floor ${f}`, elevation: f * h });

  for (const level of levels) {
    const storey = add(
      `IFCBUILDINGSTOREY(${guid()},${owner},${s(level.name)},$,$,${placement},$,$,.ELEMENT.,${(level.elevation * 1000).toFixed(1)})`
    );
    storeyRefs.push(storey);

    const contained: string[] = [];
    for (let i = 1; i <= spacesPerFloor; i += 1) {
      contained.push(add(`IFCSPACE(${guid()},${owner},${s(`${level.name} — Room ${i}`)},$,$,${placement},$,$,.ELEMENT.,.INTERNAL.,$)`));
    }
    for (let i = 0; i < 4; i += 1) contained.push(add(`IFCWALL(${guid()},${owner},'Wall',$,$,${placement},$,$,.STANDARD.)`));
    contained.push(add(`IFCSLAB(${guid()},${owner},'Floor slab',$,$,${placement},$,$,.FLOOR.)`));
    contained.push(add(`IFCDOOR(${guid()},${owner},'Door',$,$,${placement},$,$,2100.,900.,.DOOR.,.SINGLE_SWING_LEFT.,$)`));
    contained.push(add(`IFCWINDOW(${guid()},${owner},'Window',$,$,${placement},$,$,1200.,1500.,.WINDOW.,.SINGLE_PANEL.,$)`));
    contained.push(add(`IFCSTAIR(${guid()},${owner},'Stair',$,$,${placement},$,$,.STRAIGHT_RUN_STAIR.)`));
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},${owner},$,$,(${contained.join(',')}),${storey})`);
  }
  add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${building},(${storeyRefs.join(',')}))`);

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${s(`${input.projectName}.ifc`)},${s(input.timeStamp ?? new Date().toISOString().slice(0, 19))},(${s(input.author ?? 'LTP')}),(${s(input.organization ?? 'BBAS')}),'IfcOpenShell',${s(input.originatingSystem ?? 'BBAS BIM sample')},'');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];

  return [...header, ...lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
