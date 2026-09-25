import type { ApplicationDetail } from '@/features/applications/types';
import { checkPlotAreas } from './plot-area';

/**
 * THE MAP FROM A BBAS FIELD NAME TO THE COLUMN THAT ANSWERS IT.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The BBAS forms name about sixty particulars across General Information, the
 * Applicant block and the Plot block. This system already had columns for
 * roughly half of them under different names — BBAS's "D.No" is
 * `property_details.doorNo`, its "Proposed Use" is
 * `building_details.buildingUse`, its "Floors" is `numFloors`. Phase 4 added
 * columns for the rest.
 *
 * The temptation was to add a second column for every BBAS name and be done.
 * That would have produced two district columns, two plot-number columns and
 * two road-width columns, each free to disagree with the other, and no way for
 * a later reader to know which one the sanction was issued against. So the
 * rule is ONE FIELD, ONE COLUMN — and the cost of that rule is that somebody
 * holding the manual cannot find "D.No" by searching the schema for "D.No".
 *
 * This file is that cost paid down. It is the only place where the manual's
 * vocabulary and the schema's vocabulary are written side by side, it is what
 * the Details screen renders from, and a field that moves changes here and
 * nowhere else.
 *
 * ── On the fields whose meaning the manuals do not give ──────────────────
 *
 * Two are stored and displayed verbatim, under the label BBAS gives them,
 * with no interpretation: `irr`, whose abbreviation the supplied manuals never
 * expand, and `lpsStatus`, which they name without defining the scheme. They
 * are shown as entered. Guessing at either would put an invented meaning on a
 * statutory form, which is worse than an unexpanded abbreviation.
 */

export type Fact = [label: string, value: string | number | null];

export type FactGroup = {
  key: string;
  title: string;
  description: string;
  facts: Fact[];
};

/** Resolves a master-data code to its administrator-set label. */
export type LabelFn = (category: string, code: string) => string;

const m = (value: number | null | undefined, unit = 'm'): string | null =>
  typeof value === 'number' ? `${value} ${unit}` : null;

const sqm = (value: number | null | undefined): string | null =>
  typeof value === 'number' ? `${value} sq m` : null;

const yesNo = (value: boolean | null | undefined): string | null =>
  value === true ? 'Yes' : value === false ? 'No' : null;

const rupees = (value: number | null | undefined): string | null =>
  typeof value === 'number'
    ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    : null;

/** "Yes — 45 m" / "Yes — distance not measured" / "No". */
function proximity(near: boolean, distanceM: number | null): string {
  if (!near) return 'No';
  return typeof distanceM === 'number' ? `Yes — ${distanceM} m` : 'Yes — distance not measured';
}

// ═══════════════════════════════════════════════════════════════════════════
// General information
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The BBAS General Information block, in the manual's own order.
 *
 * The order is not cosmetic. Somebody checking a file against a paper form
 * reads down both at once, and a screen that groups the same facts differently
 * makes them do a lookup per line.
 */
export function generalInformationFacts(app: ApplicationDetail, label: LabelFn): Fact[] {
  const { property, building } = app;

  return [
    ['Case type', app.caseType ? label('CASE_TYPE', app.caseType) : null],
    ['Permission type', app.permissionType ? label('PERMISSION_TYPE', app.permissionType) : null],
    [
      'Nature of permission',
      app.natureOfPermission ? label('NATURE_OF_PERMISSION', app.natureOfPermission) : null,
    ],
    // BBAS's "Application Type" is this system's application type — the row in
    // `application_types` that decides the workflow, the fee structure and the
    // document requirements. It is not a second free-text field.
    ['Application type', app.applicationType?.name ?? null],
    ['Land type', app.landType ? label('LAND_TYPE', app.landType) : null],
    ['LPS / Non-LPS', app.lpsStatus ? (app.lpsStatus === 'LPS' ? 'LPS' : 'Non-LPS') : null],

    ['District', property?.district ?? null],
    ['Mandal', property?.mandal ?? null],
    ['Village', property?.village ?? null],
    ['Gram panchayat', property?.gramPanchayat ?? null],
    ['Township', property?.township ?? null],
    ['Sector', property?.sector ?? null],
    ['Colony', property?.colony ?? null],
    ['Nature of site', property?.natureOfSite ?? null],

    ['Block', property?.blockNo ?? null],
    ['Survey number', property?.surveyNumbers ?? null],
    ['D.No', property?.doorNo ?? null],
    ['R.S.No', property?.rsNo ?? null],
    ['Plot number', property?.plotNo ?? null],

    ['Land use zone', property?.landUseZone ? label('LAND_USE', property.landUseZone) : null],
    ['Zoning district', property?.zoningDistrict ?? null],
    ['Proposed use', building?.buildingUse ? label('BUILDING_USE', building.buildingUse) : null],
    ['Proposed activity', building?.proposedActivity ?? null],

    ['Road', property?.roadName ?? null],
    ['Road width', property?.roadWidthM ? m(property.roadWidthM) : null],
    ['Building height', building?.buildingHeightM ? m(building.buildingHeightM) : null],
    ['Floors', building ? building.numFloors : null],
    ['Risk category', app.riskCategory ? riskLabel(app.riskCategory) : null],
  ];
}

const riskLabel = (value: string): string =>
  ({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' })[value] ?? value;

// ═══════════════════════════════════════════════════════════════════════════
// The other parties
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Developer, structural engineer and the registration each is on record under.
 *
 * Returns an empty array when there is no developer and no structural engineer
 * named, so the screen can leave the card out rather than show a block of
 * "Not entered". A plot owner building their own house has neither, and that
 * is the ordinary case, not a gap in the file.
 */
export function professionalFacts(app: ApplicationDetail): Fact[] {
  const a = app.applicant;
  if (!a) return [];

  const any =
    a.developerName || a.structuralEngineerName || a.professionalRegistrationRef || a.usagePurpose;
  if (!any) return [];

  return [
    ['Developer', a.developerName || null],
    ['Developer mobile', a.developerPhone || null],
    ['Developer registration', a.developerRegistrationNo || null],
    ['Structural engineer', a.structuralEngineerName || null],
    ['Structural engineer mobile', a.structuralEngineerPhone || null],
    ['Structural engineer registration', a.structuralEngineerRegNo || null],
    ['LTP registration reference', a.professionalRegistrationRef || null],
    ['Purpose of the building', a.usagePurpose || null],
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// The plot
// ═══════════════════════════════════════════════════════════════════════════

/** The area chain, in the order the deductions are taken. */
export function plotAreaFacts(app: ApplicationDetail): Fact[] {
  const p = app.property;
  if (!p) return [];

  return [
    ['Document area', sqm(p.documentAreaSqm)],
    ['Area on ground', sqm(p.groundAreaSqm)],
    ['Gross plot area', sqm(p.grossPlotAreaSqm)],
    ['Less — road widening', sqm(p.roadWideningDeductionSqm)],
    ['Less — green buffer', sqm(p.greenBufferDeductionSqm)],
    ['Less — surrender / gift', sqm(p.surrenderGiftAreaSqm)],
    ['Net plot area', sqm(p.netPlotAreaSqm)],
    ['TDR loaded', sqm(p.tdrAreaSqm)],
    ['Market value', rupees(p.marketValue)],
    ['IRR', p.irr || null],
    ['Existing construction', p.hasExistingConstruction ? p.existingConstruction || 'Yes' : 'None'],
  ];
}

/**
 * The six proximities, always all six.
 *
 * "No" is shown for every constraint that does not apply rather than the row
 * being dropped, because the absence of a row cannot be told apart from a
 * question nobody asked — and on a file near a monument or a railway that
 * difference decides whether a clearance was needed.
 */
export function plotConstraintFacts(app: ApplicationDetail): Fact[] {
  const p = app.property;
  if (!p) return [];

  return [
    ['Religious structure', proximity(p.religiousStructureNearby, p.religiousStructureDistanceM)],
    ['Aerodrome', proximity(p.aerodromeNearby, p.aerodromeDistanceM)],
    ['Water body', proximity(p.waterBodyNearby, p.waterBodyDistanceM)],
    ['Railway', proximity(p.railwayNearby, p.railwayDistanceM)],
    ['HT line', proximity(p.htLineNearby, p.htLineDistanceM)],
    ['Monument', proximity(p.monumentNearby, p.monumentDistanceM)],
    ['Remarks', p.constraintRemarks || null],
  ];
}

export function boundaryFacts(app: ApplicationDetail): Fact[] {
  const p = app.property;
  if (!p) return [];
  return [
    ['North', p.boundaryNorth || null],
    ['South', p.boundarySouth || null],
    ['East', p.boundaryEast || null],
    ['West', p.boundaryWest || null],
  ];
}

/**
 * What to warn the officer about on the plot figures, if anything.
 *
 * Sentences and not error codes, because the reader is deciding whether to
 * raise a shortfall. Nothing here changes a stored value — see the note at the
 * top of src/lib/plot-area.ts for why.
 */
export function plotAreaWarnings(app: ApplicationDetail): string[] {
  const p = app.property;
  if (!p) return [];

  const check = checkPlotAreas(p);
  const warnings: string[] = [];

  if (check.overDeducted) {
    warnings.push(
      `The deductions total ${check.totalDeductionSqm} sq m, which is more than the gross plot area. One of the figures is wrong.`
    );
  }

  if (check.netMismatch) {
    const { stored, computed, differenceSqm } = check.netMismatch;
    warnings.push(
      `The net plot area on file is ${stored} sq m, but the gross less the deductions comes to ${computed} sq m — a difference of ${Math.abs(differenceSqm)} sq m.`
    );
  }

  if (check.groundMismatch) {
    const { document, ground, differenceSqm } = check.groundMismatch;
    warnings.push(
      `The area measured on the ground is ${ground} sq m against ${document} sq m in the document — ${Math.abs(differenceSqm)} sq m ${differenceSqm < 0 ? 'less' : 'more'}.`
    );
  }

  return warnings;
}

export { yesNo };
