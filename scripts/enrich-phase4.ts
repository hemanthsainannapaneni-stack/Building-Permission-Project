/**
 * FILLS IN THE PHASE 4 FIELDS ON THE APPLICATIONS THAT ALREADY EXIST.
 *
 *   npm run demo:phase4              report what would change, change nothing
 *   npm run demo:phase4 -- --apply   perform it
 *
 * ── Why this is a script and not a change to the demo seed ───────────────
 *
 * Because `seed:demo:reset` DESTROYS every application, payment and receipt in
 * the database in order to rebuild them, and the 263 applications already
 * there are the demonstration. Phase 4 added columns — BBAS general
 * information, the plot-area chain, site constraints, the developer and
 * structural engineer, the Others block and the 19-point checklist — and the
 * point of this script is that an environment already set up gains all of them
 * without being thrown away.
 *
 * `prisma/seed/demo/index.ts` is untouched. A fresh reset produces these
 * fields too, because this script is idempotent and the seed can run it.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 *   · Create or delete an application. Not one.
 *   · Overwrite a field that already has a value. Every write is guarded on
 *     the column being empty, so an officer's real entry survives a re-run.
 *   · Move a file, approve one, or raise a shortfall.
 *   · Write a checklist answer or a verification by hand. Those go through
 *     `saveChecklistResponses` and `reviewChecklist` — the real services, with
 *     their capability checks, their status gates, their append-only history
 *     and their audit rows. A history entry this script produced is
 *     indistinguishable from one an officer produced, because it was made the
 *     same way.
 *
 * ── Variety ──────────────────────────────────────────────────────────────
 *
 * Different applications get genuinely different combinations, drawn from a
 * SEEDED generator so the run is reproducible: the same file gets the same
 * particulars on every machine, and "the net plot area on BP/2026/000042 is
 * wrong" stays a statement somebody else can check. Roughly a third of the
 * files get a constraint, a quarter get a mortgage, half get solar — so the
 * screens have something to show at every combination rather than the same
 * row 263 times.
 */
import { PrismaClient } from '@prisma/client';
import { makeRng } from '../prisma/seed/demo/rng';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import {
  canApplicantAnswer,
  canReviewerVerify,
  deriveRiskCategory,
  type ChecklistStatus,
} from '../src/lib/checklist';
import {
  saveChecklistResponses,
  reviewChecklist,
} from '../src/server/services/application-checklist';
import type { AuthUser } from '../src/server/auth/context';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
/** Recompute risk categories and do nothing else. */
const REDERIVE_ONLY = process.argv.includes('--rederive');

/**
 * How many applications should end up carrying an answered checklist.
 *
 * A CAP and not a target: the brief asks for SELECTED applications to be
 * given realistic values, not all 263, and a register in which every file has
 * been answered and verified is not a realistic register — a real office has
 * files nobody has opened yet. Ninety is about a third, which is enough for
 * every screen and every combination to have something to show.
 *
 * It is also what keeps this script finishable. Each application walks the
 * real services, and against a pooled database on the other side of the
 * world that is tens of round trips apiece.
 *
 *   npm run demo:phase4 -- --apply --limit 150
 */
const LIMIT = (() => {
  const flag = process.argv.indexOf('--limit');
  const value = flag >= 0 ? Number(process.argv[flag + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 90;
})();

/**
 * How many applications to walk at once.
 *
 * Three, not thirty. `DATABASE_URL` carries `connection_limit=5`, and the
 * audit chain takes a global advisory lock inside every transaction — so
 * beyond a handful the writers queue on each other and the only thing that
 * grows is the chance of a timeout. Three is roughly a threefold speed-up
 * with no contention worth the name.
 */
const CONCURRENCY = 3;

/** Runs `work` over `items`, `CONCURRENCY` at a time, in order. */
async function inBatches<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(work));
  }
}
const META = { ip: '127.0.0.1', userAgent: 'enrich-phase4', correlationId: 'phase4' };

/** Fixed, so the demonstration is the same on every machine. */
const rng = makeRng(20260401);

/**
 * The matrix, read by role key at runtime.
 *
 * `RBAC_MATRIX` is keyed by the RoleKey union and the keys here arrive from
 * the database as plain strings. Widening once beats an assertion at every
 * read, and a role the matrix does not know yields no capabilities — the safe
 * direction.
 */
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;

let wouldChange = 0;
const note = (line: string) => console.log(`    ${line}`);

// ═══════════════════════════════════════════════════════════════════════════
// The particulars
// ═══════════════════════════════════════════════════════════════════════════

const CASE_TYPES = ['NEW', 'NEW', 'NEW', 'REVISED', 'RENEWAL'] as const;
const PERMISSION_TYPES = ['BUILDING', 'BUILDING', 'BUILDING', 'LAYOUT', 'SUB_DIVISION'] as const;
const NATURE = [
  'INDIVIDUAL',
  'INDIVIDUAL',
  'GROUP_HOUSING',
  'MULTI_STOREYED',
  'COMMERCIAL_COMPLEX',
] as const;
const LAND_TYPES = ['PATTA', 'PATTA', 'FREEHOLD', 'ASSIGNED', 'ENDOWMENT'] as const;
const SITE_NATURE = ['VACANT', 'VACANT', 'PARTLY_BUILT', 'BUILT_UP', 'AGRICULTURAL'] as const;

const MANDALS = [
  'Serilingampally',
  'Rajendranagar',
  'Shamshabad',
  'Kukatpally',
  'Uppal',
  'Balanagar',
];
const VILLAGES = ['Gachibowli', 'Kondapur', 'Nanakramguda', 'Manikonda', 'Bachupally', 'Nizampet'];
const PANCHAYATS = ['Tellapur GP', 'Osman Nagar GP', 'Ameenpur GP', 'Bowrampet GP', ''];
const TOWNSHIPS = ['', '', 'Financial District', 'Knowledge City', 'Hardware Park'];
const COLONIES = [
  'Jubilee Enclave',
  'Silicon Valley',
  'Vasavi Colony',
  'Lake View Enclave',
  'Green Meadows',
];
const ROADS = [
  'Old Mumbai Highway',
  'ORR Service Road',
  'Kondapur Main Road',
  'Gachibowli–Miyapur Road',
  'Nallagandla Road',
  '60ft Colony Road',
];
const ZONING = [
  'R-1 Residential',
  'R-2 Residential',
  'C-1 Commercial',
  'M-1 Mixed use',
  'I-1 Industrial',
];
const ACTIVITIES = [
  'Owner-occupied dwelling',
  'Apartments for sale',
  'Retail showroom',
  'Software offices',
  'Clinic and pharmacy',
  'Warehousing and despatch',
  'Coaching classes',
];
const PURPOSES = [
  'Own residence',
  'Rental income',
  'Own residence and one rented floor',
  'Office for the firm',
  'Sale of flats',
  'Let out on lease',
];
const FIRMS = [
  'Sri Venkateswara Constructions',
  'Lakshmi Infra Developers',
  'Meghana Builders',
  'Sai Krupa Projects',
  'Vamsi Structures',
  'Nandana Realtors',
];
const ENGINEERS = [
  'K. Ramachandra Rao',
  'S. Padmaja',
  'M. Abdul Kareem',
  'T. Srinivasa Reddy',
  'B. Lavanya',
  'G. Prashanth Kumar',
];
const SUB_REGISTRARS = [
  'Serilingampally',
  'Rajendranagar',
  'Kukatpally',
  'Shamshabad',
  'Balanagar',
];
const NEIGHBOURS = [
  'Plot 12, open',
  'Plot 14, two-storey dwelling',
  '9 m layout road',
  '12 m colony road',
  'Neighbour’s compound wall',
  'Open nala margin',
  'Vacant plot',
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. General information, applicant, plot
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fills the BBAS columns on every application that has none.
 *
 * Every write is guarded on the field being EMPTY. That is what makes the
 * script safe to run twice, and what stops it walking over an entry somebody
 * made by hand between runs.
 */
async function fillParticulars() {
  console.log('\n  General information, applicant and plot');

  const apps = await prisma.application.findMany({
    where: { deletedAt: null },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      caseType: true,
      landType: true,
      applicationType: { select: { code: true } },
      applicant: {
        select: { id: true, developerName: true, structuralEngineerName: true, usagePurpose: true },
      },
      property: {
        select: {
          id: true,
          plotAreaSqm: true,
          gramPanchayat: true,
          zoningDistrict: true,
          grossPlotAreaSqm: true,
          boundaryNorth: true,
          natureOfSite: true,
        },
      },
      building: {
        select: {
          id: true,
          proposedActivity: true,
          buildingHeightM: true,
          numFloors: true,
          builtUpAreaSqm: true,
        },
      },
    },
  });

  let generalFilled = 0;
  let propertyFilled = 0;
  let applicantFilled = 0;
  let buildingFilled = 0;

  for (const app of apps) {
    const commercial = app.applicationType?.code === 'COMMERCIAL_BUILDING';
    const tall = (app.building?.buildingHeightM ?? 0) > 15 || (app.building?.numFloors ?? 0) >= 5;

    // ── The case-level classification ─────────────────────────────────
    if (!app.caseType) {
      const caseType = rng.pick(CASE_TYPES);
      const permissionType = rng.pick(PERMISSION_TYPES);
      const natureOfPermission = tall
        ? rng.pick(['MULTI_STOREYED', 'GROUP_HOUSING'] as const)
        : commercial
          ? 'COMMERCIAL_COMPLEX'
          : rng.pick(NATURE);

      generalFilled += 1;
      if (APPLY) {
        await prisma.application.update({
          where: { id: app.id },
          data: {
            caseType,
            permissionType,
            natureOfPermission,
            landType: rng.pick(LAND_TYPES),
            // Roughly a third of sites in a layout scheme area, which is about
            // the real proportion in a peri-urban zone.
            lpsStatus: rng.chance(0.35) ? 'LPS' : 'NON_LPS',
          },
        });
      }
    }

    // ── The plot ──────────────────────────────────────────────────────
    if (app.property && !app.property.gramPanchayat && !app.property.grossPlotAreaSqm) {
      const base = app.property.plotAreaSqm ?? rng.float(150, 2400, 2);

      // The chain, computed rather than invented, so the arithmetic on screen
      // actually holds: gross − deductions = net. A handful of files are left
      // deliberately inconsistent below, because a system that can only show
      // correct data cannot show an officer what a discrepancy looks like.
      const documentArea = round2(base * rng.float(1.0, 1.04, 4));
      const groundArea = round2(documentArea * rng.float(0.965, 1.005, 4));
      const gross = round2(Math.min(documentArea, groundArea));
      const roadWidening = rng.chance(0.4) ? round2(gross * rng.float(0.02, 0.09, 4)) : 0;
      const greenBuffer = rng.chance(0.2) ? round2(gross * rng.float(0.01, 0.05, 4)) : 0;
      const surrender = rng.chance(0.12) ? round2(gross * rng.float(0.01, 0.04, 4)) : 0;
      const net = round2(gross - roadWidening - greenBuffer - surrender);

      // One file in twenty-five carries a net area that does not agree with
      // its own deductions. That is what the warning on the Plot card is for,
      // and a demo with none of them never shows it.
      const inconsistent = rng.chance(0.04);

      propertyFilled += 1;
      if (APPLY) {
        await prisma.propertyDetail.update({
          where: { id: app.property.id },
          data: {
            gramPanchayat: rng.pick(PANCHAYATS),
            township: rng.pick(TOWNSHIPS),
            sector: rng.chance(0.3) ? `Sector ${rng.int(1, 12)}` : '',
            colony: rng.pick(COLONIES),
            natureOfSite: app.property.natureOfSite || rng.pick(SITE_NATURE),
            blockNo: rng.chance(0.5) ? `Block ${rng.pick(['A', 'B', 'C', 'D'])}` : '',
            rsNo: rng.chance(0.45) ? `${rng.int(10, 480)}/${rng.int(1, 9)}` : '',
            zoningDistrict: rng.pick(ZONING),
            roadName: rng.pick(ROADS),
            mandal: rng.pick(MANDALS),
            village: rng.pick(VILLAGES),

            documentAreaSqm: documentArea,
            groundAreaSqm: groundArea,
            grossPlotAreaSqm: gross,
            roadWideningDeductionSqm: roadWidening,
            greenBufferDeductionSqm: greenBuffer,
            surrenderGiftAreaSqm: surrender,
            netPlotAreaSqm: inconsistent ? round2(net + rng.float(4, 30, 2)) : net,
            tdrAreaSqm: rng.chance(0.15) ? round2(gross * rng.float(0.05, 0.2, 4)) : null,
            marketValue: Math.round(gross * rng.int(18_000, 62_000)),
            // Stored verbatim under the label BBAS gives it; the manuals never
            // expand the abbreviation and nothing here guesses at it.
            irr: rng.chance(0.4) ? `IRR/${rng.int(2019, 2026)}/${rng.int(100, 999)}` : '',

            hasExistingConstruction: rng.chance(0.22),
            existingConstruction: rng.chance(0.22)
              ? rng.pick([
                  'Single-storey shed on the rear portion',
                  'Old load-bearing dwelling, to be demolished',
                  'Compound wall and watchman’s room',
                  'Foundation laid, work stopped',
                ])
              : '',

            ...constraintsFor(),

            boundaryNorth: app.property.boundaryNorth || rng.pick(NEIGHBOURS),
            boundarySouth: app.property.boundaryNorth ? '' : rng.pick(NEIGHBOURS),
            boundaryEast: app.property.boundaryNorth ? '' : rng.pick(NEIGHBOURS),
            boundaryWest: app.property.boundaryNorth ? '' : rng.pick(NEIGHBOURS),
          },
        });
      }
    }

    // ── The other parties ─────────────────────────────────────────────
    if (app.applicant && !app.applicant.usagePurpose) {
      // A developer on the bigger files and the commercial ones; a structural
      // engineer wherever the building is tall enough for question 19 to
      // matter. Not on everything — a plot owner building their own house has
      // neither, and that is the commonest file in the register.
      const hasDeveloper = tall || commercial || rng.chance(0.25);
      const hasEngineer = tall || rng.chance(0.4);

      applicantFilled += 1;
      if (APPLY) {
        await prisma.applicant.update({
          where: { id: app.applicant.id },
          data: {
            developerName: hasDeveloper ? rng.pick(FIRMS) : '',
            developerPhone: hasDeveloper ? `9${rng.int(400000000, 899999999)}` : '',
            developerRegistrationNo: hasDeveloper
              ? `TS/RERA/${rng.int(2019, 2026)}/${rng.int(1000, 9999)}`
              : '',
            structuralEngineerName: hasEngineer ? rng.pick(ENGINEERS) : '',
            structuralEngineerPhone: hasEngineer ? `9${rng.int(400000000, 899999999)}` : '',
            structuralEngineerRegNo: hasEngineer
              ? `SE/${rng.pick(['TS', 'AP'])}/${rng.int(2015, 2025)}/${rng.int(100, 999)}`
              : '',
            professionalRegistrationRef: `IE(I)/${rng.int(2010, 2024)}/${rng.int(10000, 99999)}`,
            usagePurpose: rng.pick(PURPOSES),
          },
        });
      }
    }

    // ── What actually goes on inside ──────────────────────────────────
    if (app.building && !app.building.proposedActivity) {
      buildingFilled += 1;
      if (APPLY) {
        await prisma.buildingDetail.update({
          where: { id: app.building.id },
          data: { proposedActivity: rng.pick(ACTIVITIES) },
        });
      }
    }
  }

  wouldChange += generalFilled + propertyFilled + applicantFilled + buildingFilled;
  note(`general information   ${generalFilled} application(s)`);
  note(`plot particulars      ${propertyFilled} application(s)`);
  note(`developer / engineer  ${applicantFilled} application(s)`);
  note(`proposed activity     ${buildingFilled} application(s)`);
}

/**
 * The six proximities.
 *
 * Deliberately uneven. Most plots are near nothing; a few are near one thing;
 * a handful are near two. Spreading them evenly would put a constraint on
 * every second file and make the flag meaningless on screen.
 */
function constraintsFor() {
  const near = (p: number, min: number, max: number) => {
    const yes = rng.chance(p);
    return { yes, distance: yes ? rng.float(min, max, 1) : null };
  };

  const religious = near(0.1, 15, 180);
  const aerodrome = near(0.06, 900, 8000);
  const water = near(0.14, 20, 400);
  const railway = near(0.07, 12, 250);
  const ht = near(0.11, 5, 60);
  const monument = near(0.05, 90, 300);

  const any = [religious, aerodrome, water, railway, ht, monument].some((c) => c.yes);

  return {
    religiousStructureNearby: religious.yes,
    religiousStructureDistanceM: religious.distance,
    aerodromeNearby: aerodrome.yes,
    aerodromeDistanceM: aerodrome.distance,
    waterBodyNearby: water.yes,
    waterBodyDistanceM: water.distance,
    railwayNearby: railway.yes,
    railwayDistanceM: railway.distance,
    htLineNearby: ht.yes,
    htLineDistanceM: ht.distance,
    monumentNearby: monument.yes,
    monumentDistanceM: monument.distance,
    constraintRemarks: any
      ? rng.pick([
          'Measured on site during the pre-scrutiny visit.',
          'Distances taken from the layout plan and verified on the ground.',
          'Clearance to be confirmed before the drawing is approved.',
        ])
      : '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. The Others block
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Writes the Others block on about two files in three.
 *
 * Not on all of them, on purpose: "nobody has entered anything here yet" is a
 * real state of a live application and the tab has to be able to show it.
 */
async function fillOthers() {
  console.log('\n  Others');

  const apps = await prisma.application.findMany({
    where: { deletedAt: null, others: { is: null } },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      building: { select: { numFloors: true, builtUpAreaSqm: true, buildingHeightM: true } },
    },
  });

  let written = 0;

  for (const app of apps) {
    if (!rng.chance(0.66)) continue;

    const floors = app.building?.numFloors ?? 0;
    const builtUp = app.building?.builtUpAreaSqm ?? 0;
    const height = app.building?.buildingHeightM ?? 0;

    // REQUIRED is the rule's answer, so it is derived from the building rather
    // than drawn at random: solar and rainwater harvesting on the larger
    // proposals, greening on everything with a plot to plant on. PROPOSED and
    // PROVIDED are the applicant's and the world's, and those do vary.
    const solarRequired = builtUp > 500 || floors >= 3;
    const rwhRequired = builtUp > 300;
    const greeningRequired = true;

    const solarProposed = solarRequired ? rng.chance(0.82) : rng.chance(0.15);
    const rwhProposed = rwhRequired ? rng.chance(0.88) : rng.chance(0.2);
    const greeningProposed = rng.chance(0.85);

    // Nothing is INSTALLED on a file that has not been approved — an
    // undertaking is discharged after sanction, not before it, and a demo that
    // showed otherwise would be teaching the wrong sequence.
    const built = app.status === 'APPROVED';

    const mortgage = (floors >= 4 || builtUp > 1500) && rng.chance(0.55);
    const insurance = height > 15 || rng.chance(0.3);

    written += 1;
    if (!APPLY) continue;

    await prisma.applicationOthers.create({
      data: {
        applicationId: app.id,

        mortgageApplicable: mortgage,
        mortgageNumber: mortgage ? `${rng.int(1000, 9999)}/${rng.int(2023, 2026)}` : '',
        mortgageDate: mortgage ? daysAgo(rng.int(30, 700)) : null,
        mortgageSubRegistrar: mortgage ? rng.pick(SUB_REGISTRARS) : '',
        mortgagePortion: mortgage
          ? rng.pick([
              'Second floor, east portion',
              'Ground floor shops 3 and 4',
              'Third floor in entirety',
              'Flat 401 and one covered car park',
            ])
          : '',
        mortgageAreaSqm: mortgage ? round2(builtUp * rng.float(0.08, 0.18, 4)) : null,

        insuranceApplicable: insurance,
        insurancePolicyNumber: insurance
          ? `POL/${rng.pick(['NIA', 'OIC', 'UIIC', 'NIC'])}/${rng.int(100000, 999999)}`
          : '',
        insuranceDate: insurance ? daysAgo(rng.int(20, 400)) : null,
        // A few expired policies, because that is the commonest defect on this
        // block and the screen warns about it.
        insuranceValidUpto: insurance
          ? rng.chance(0.15)
            ? daysAgo(rng.int(5, 90))
            : daysAhead(rng.int(30, 500))
          : null,

        solarRequired,
        solarProposed,
        solarInstalled: built && solarProposed && rng.chance(0.6),
        solarCapacityKw: solarProposed ? rng.float(1, 25, 1) : null,
        solarRemarks:
          solarRequired && !solarProposed
            ? 'Not shown on the drawing. To be taken up with the applicant.'
            : '',

        rwhRequired,
        rwhProposed,
        rwhProvided: built && rwhProposed && rng.chance(0.7),
        rwhRemarks: rwhProposed
          ? rng.pick([
              'Two recharge pits shown on the site plan.',
              'Percolation pit at the rear setback.',
              'Storage sump with filter media proposed.',
              '',
            ])
          : '',

        greeningRequired,
        greeningProposed,
        greeningProvided: built && greeningProposed && rng.chance(0.65),
        treeCount: greeningProposed ? rng.int(2, 24) : null,
        greeningRemarks: '',

        specialRemarks: rng.chance(0.2)
          ? rng.pick([
              'Corner plot — splay to be left at the junction as shown.',
              'Applicant has requested phased occupancy for the lower floors.',
              'Layout road on the north is yet to be formed by the layout owner.',
              'Existing borewell to be retained and shown on the completion plan.',
            ])
          : '',
      },
    });
  }

  wouldChange += written;
  note(`others block          ${written} application(s)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. The checklist — through the real services
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Answers and verifies the 19-point checklist on the files that have reached
 * far enough for it to make sense.
 *
 * Both halves go through the services, never through Prisma. That is what puts
 * a real append-only history row behind each one, with the desk and the
 * officer, and it is what makes the "a later reviewer cannot erase an earlier
 * one" demonstration real rather than staged: the ZDD entries below were
 * written by the same function a ZDD's browser calls.
 */
async function fillChecklist() {
  console.log('\n  Application checklist');

  const definitions = await prisma.checklistItemDefinition.findMany({
    where: { kind: 'APPLICATION', isActive: true },
    orderBy: { itemNumber: 'asc' },
    select: {
      id: true,
      itemNumber: true,
      responseType: true,
      affectsRisk: true,
      isMandatory: true,
    },
  });

  if (!definitions.length) {
    note('no active application checklist questions — run `npm run db:seed` first');
    return;
  }

  // Already done on a previous run. The cap is on the TOTAL that end up with
  // a checklist, not on how many this run adds, so an interrupted run resumes
  // to the same finishing line rather than adding ninety more.
  const alreadyDone = await prisma.application.count({
    where: { deletedAt: null, checklistResponses: { some: {} } },
  });

  const remaining = Math.max(0, LIMIT - alreadyDone);
  if (!remaining) {
    note(`${alreadyDone} application(s) already carry a checklist — at the cap of ${LIMIT}`);
    return;
  }

  const apps = await prisma.application.findMany({
    where: { deletedAt: null, checklistResponses: { none: {} } },
    orderBy: { applicationNumber: 'asc' },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      ltpUserId: true,
      currentStageCode: true,
      zoneId: true,
    },
    take: remaining,
  });

  let answered = 0;
  let reviewed = 0;
  let secondOpinions = 0;
  const failures: string[] = [];

  /**
   * One file's failure must not end the run.
   *
   * This walks 263 applications through the real services against a remote
   * database. A single timeout, a single file in a state the guard refuses —
   * and without this the whole pass stops, leaving the demonstration
   * half-enriched with no record of how far it got. The failure is counted,
   * named, and the loop moves on.
   */
  const attempt = async (label: string, work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
      return false;
    }
  };

  type Candidate = (typeof apps)[number];

  /**
   * Every random decision for one application, drawn UP FRONT.
   *
   * `inBatches` walks three applications at once, and a seeded generator drawn
   * from concurrently stops being deterministic — the draws interleave
   * differently on every run, which is exactly what seeding it was for. So the
   * whole plan is made sequentially first, and the concurrent part does
   * database work and no drawing at all.
   */
  type WalkPlan = {
    answers: Array<{ itemId: string; response: string; applicantRemarks: string }>;
    items: Array<{
      itemId: string;
      status: ChecklistStatus;
      reviewerResponse: string;
      reviewerRemarks: string;
    }>;
    revisit: boolean;
    revisitCount: number;
  };

  function planFor(): WalkPlan {
    // Not always all nineteen. A file still with the applicant is commonly
    // part-answered, and the progress counts are only worth showing if some of
    // them are genuinely short.
    const count = rng.chance(0.7) ? definitions.length : rng.int(8, definitions.length - 2);

    const answers = definitions.slice(0, count).map((definition) => ({
      itemId: definition.id,
      response: answerFor(definition.responseType, definition.affectsRisk),
      applicantRemarks: rng.chance(0.15) ? rng.pick(REMARKS) : '',
    }));

    // How far down the checklist the desk has got. A file that arrived
    // yesterday is part-verified; one that has been through three desks is not.
    const depth = rng.chance(0.55) ? definitions.length : rng.int(6, definitions.length);

    const items = definitions.slice(0, depth).map((definition) => {
      const status = verdictFor();
      return {
        itemId: definition.id,
        status,
        reviewerResponse: '',
        reviewerRemarks:
          status === 'SHORTFALL' || status === 'REJECTED'
            ? rng.pick(FINDINGS)
            : rng.chance(0.1)
              ? 'Checked against the enclosure.'
              : '',
      };
    });

    return {
      answers,
      items,
      revisit: rng.chance(0.3),
      revisitCount: rng.int(2, 5),
    };
  }

  /**
   * One application, end to end: the LTP answers, a desk verifies, and
   * sometimes a second desk revisits the same questions.
   */
  const walk = async (app: Candidate, plan: WalkPlan) => {
    const ltp = await actorFor(app.ltpUserId);
    if (!ltp) return;

    // ── The applicant answers ─────────────────────────────────────────
    if (canApplicantAnswer(app.status)) {
      if (
        await attempt(`${app.applicationNumber} answers`, () =>
          saveChecklistResponses(ltp, app.id, { answers: plan.answers }, META)
        )
      ) {
        answered += 1;
      }
    } else {
      // The file is with a desk, so the LTP can no longer post. The answers
      // WERE given before it was forwarded, which is the truth of it, and the
      // rows are written directly here for exactly that reason — the one place
      // this script does not use the service, because the service would
      // correctly refuse.
      if (
        await attempt(`${app.applicationNumber} answers (backdated)`, () =>
          backdateAnswers(app.id, plan.answers, ltp, definitions)
        )
      ) {
        answered += 1;
      }
    }

    // ── The desks verify ──────────────────────────────────────────────
    if (!canReviewerVerify(app.status)) return;

    const officer = await officerFor(app.zoneId, ['TPA']);
    if (!officer) return;

    if (
      await attempt(`${app.applicationNumber} verification`, () =>
        reviewChecklist(officer, app.id, { items: plan.items }, META)
      )
    ) {
      reviewed += 1;
    }

    // ── A second desk looks at the same questions ─────────────────────
    //
    // This is the demonstration that matters: a senior desk reaching its own
    // conclusion on a question the TPA already answered, WITHOUT the TPA's
    // entry going anywhere. Both are in the history afterwards, each with the
    // desk it was made at.
    if (!plan.revisit) return;

    const senior = await officerFor(app.zoneId, ['ZDD', 'ZJD', 'PLANNING_OFFICER']);
    if (!senior) return;

    const revisited = plan.items.slice(0, plan.revisitCount).map((item) => ({
      itemId: item.itemId,
      status:
        item.status === 'VERIFIED'
          ? ('SHORTFALL' as ChecklistStatus)
          : ('VERIFIED' as ChecklistStatus),
      reviewerResponse: '',
      // A senior desk that reached the SAME conclusion would add a row saying
      // nothing, and the service would correctly decline to record it. These
      // deliberately differ from the TPA's finding, because the point being
      // demonstrated is that a disagreement does not erase what came before.
      reviewerRemarks: '',
    }));

    for (const item of revisited) {
      item.reviewerRemarks =
        item.status === 'SHORTFALL' ? rng.pick(FINDINGS) : 'Seen and accepted at this desk.';
    }

    if (
      await attempt(`${app.applicationNumber} second desk`, () =>
        reviewChecklist(senior, app.id, { items: revisited }, META)
      )
    ) {
      secondOpinions += 1;
    }
  };

  // Plans first, sequentially, so the seeded generator is drawn from in a
  // fixed order. Then the database work, three at a time.
  const planned = apps
    // A draft the LTP has barely started has no business carrying a completed
    // checklist. Files at every other stop get one.
    .filter((app) => !(app.status === 'DRAFT' && rng.chance(0.5)))
    .map((app) => ({ app, plan: planFor() }));

  if (!APPLY) {
    answered = planned.length;
    reviewed = planned.filter((p) => canReviewerVerify(p.app.status)).length;
    secondOpinions = planned.filter(
      (p) => p.plan.revisit && canReviewerVerify(p.app.status)
    ).length;
  } else {
    await inBatches(planned, ({ app, plan }) => walk(app, plan));
  }

  wouldChange += answered + reviewed;
  note(`answered by the LTP   ${answered} application(s)`);
  note(`verified by a desk    ${reviewed} application(s)`);
  note(`second desk revisited ${secondOpinions} application(s)`);

  if (failures.length) {
    note(`FAILED                ${failures.length} operation(s) — re-run to retry them:`);
    for (const failure of failures.slice(0, 10)) note(`  ${failure}`);
    if (failures.length > 10) note(`  … and ${failures.length - 10} more`);
  }
}

const REMARKS = [
  'Enclosed at page 14 of the application.',
  'Certificate obtained on the date shown.',
  'Applies in part — see the covering letter.',
  'Copy enclosed; original produced for verification.',
];

const FINDINGS = [
  'The certificate enclosed has expired. A current one is required.',
  'The enclosure does not cover the whole extent applied for.',
  'Not enclosed with the application. Please furnish.',
  'The figure stated does not agree with the drawing. Reconcile and resubmit.',
  'The approval number quoted could not be traced in the layout register.',
];

/** Weighted so a real spread of answers comes out, not nineteen identical ones. */
function answerFor(responseType: string, affectsRisk: boolean): string {
  if (responseType === 'YES_NO' || responseType === 'YES_NO_NA') {
    // A risk-bearing question asks whether a threshold is crossed or a
    // constraint is present, so YES is the UNCOMMON answer on most files —
    // and the risk category is only meaningful if that stays true. Most
    // buildings are under 10 m, most plots are nowhere near a monument.
    if (affectsRisk) return rng.chance(0.18) ? 'YES' : 'NO';
    if (responseType === 'YES_NO_NA' && rng.chance(0.18)) return 'NA';
    return rng.chance(0.85) ? 'YES' : 'NO';
  }
  if (responseType === 'NUMBER' || responseType === 'MEASUREMENT') {
    return String(rng.float(3, 240, 1));
  }
  return rng.pick([
    'Level, with a slight fall towards the rear.',
    'Not commenced.',
    'Predominantly residential.',
    'Nothing further to record.',
  ]);
}

/**
 * How a desk actually disposes of a checklist question.
 *
 * Weighted the way a real file is: most questions verify clean, a few are not
 * reached, a handful raise a shortfall, and a rejection is rare. The first
 * draft made a shortfall a one-in-seven event, which — across nine
 * risk-bearing questions — put three files in four at HIGH risk and made the
 * category useless.
 */
function verdictFor(): ChecklistStatus {
  const draw = rng.next();
  if (draw < 0.78) return 'VERIFIED';
  if (draw < 0.88) return 'PENDING';
  if (draw < 0.95) return 'SHORTFALL';
  if (draw < 0.99) return 'NA';
  return 'REJECTED';
}

/**
 * Writes the applicant's answers on a file that has already been forwarded.
 *
 * The one place this script bypasses a service, and the comment above says
 * why: the answers WERE given before the file left the applicant, and
 * `saveChecklistResponses` would correctly refuse to accept them now. The
 * history entry is written the same shape the service writes it, so the screen
 * cannot tell the difference — because there is no difference in what actually
 * happened.
 */
async function backdateAnswers(
  applicationId: string,
  answers: Array<{ itemId: string; response: string; applicantRemarks: string }>,
  ltp: AuthUser,
  definitions: Array<{ id: string; itemNumber: number }>
) {
  const numberOf = new Map(definitions.map((d) => [d.id, d.itemNumber]));
  const when = daysAgo(rng.int(10, 120));

  for (const answer of answers) {
    const itemNumber = numberOf.get(answer.itemId);
    if (itemNumber === undefined) continue;

    const row = await prisma.applicationChecklistResponse.create({
      data: {
        applicationId,
        itemId: answer.itemId,
        itemNumber,
        kind: 'APPLICATION',
        status: 'PENDING',
        response: answer.response,
        applicantRemarks: answer.applicantRemarks,
        respondedById: ltp.id,
        respondedByName: ltp.name,
        respondedAt: when,
      },
    });

    await prisma.checklistReviewEntry.create({
      data: {
        responseId: row.id,
        applicationId,
        itemNumber,
        entryType: 'APPLICANT_RESPONSE',
        response: answer.response,
        remarks: answer.applicantRemarks,
        status: '',
        actorId: ltp.id,
        actorName: ltp.name,
        actorRoleKey: 'LTP',
        stageCode: '',
        recordedAt: when,
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Risk, re-derived
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recomputes every application's risk category from its stored answers.
 *
 *   npm run demo:phase4 -- --apply --rederive
 *
 * The services already do this inside the transaction that changes an answer,
 * so this is not needed for data they wrote. It is needed after the DEFINITION
 * rows change — marking one more question risk-bearing in Settings, or editing
 * the rule in `deriveRiskCategory` — because neither of those touches an
 * answer, and every stored category silently becomes stale.
 *
 * Writes only where the stored value and the derived one actually differ, so
 * a run that finds nothing to do says so and writes nothing.
 */
async function rederiveRisk() {
  console.log('\n  Risk categories');

  const definitions = await prisma.checklistItemDefinition.findMany({
    where: { kind: 'APPLICATION', isActive: true },
    select: { id: true, affectsRisk: true },
  });
  const affectsRisk = new Map(definitions.map((d) => [d.id, d.affectsRisk]));

  const apps = await prisma.application.findMany({
    where: { deletedAt: null, checklistResponses: { some: {} } },
    select: {
      id: true,
      riskCategory: true,
      checklistResponses: {
        where: { kind: 'APPLICATION' },
        select: { itemId: true, response: true, status: true },
      },
    },
  });

  let changed = 0;
  const spread: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };

  for (const app of apps) {
    const derived = deriveRiskCategory(
      app.checklistResponses
        .filter((r) => affectsRisk.has(r.itemId))
        .map((r) => ({
          affectsRisk: affectsRisk.get(r.itemId) ?? false,
          response: r.response,
          status: r.status,
        }))
    );

    spread[derived] = (spread[derived] ?? 0) + 1;

    if (app.riskCategory === derived) continue;
    changed += 1;
    if (APPLY) {
      await prisma.application.update({ where: { id: app.id }, data: { riskCategory: derived } });
    }
  }

  wouldChange += changed;
  note(`restated              ${changed} of ${apps.length} application(s)`);
  note(`spread                LOW ${spread.LOW} · MEDIUM ${spread.MEDIUM} · HIGH ${spread.HIGH}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Actors
// ═══════════════════════════════════════════════════════════════════════════

const actorCache = new Map<string, AuthUser | null>();

async function actorFor(userId: string): Promise<AuthUser | null> {
  if (actorCache.has(userId)) return actorCache.get(userId) ?? null;

  const user = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      officeId: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
      jurisdictions: { select: { zoneId: true } },
    },
  });

  const actor = user ? toAuthUser(user) : null;
  actorCache.set(userId, actor);
  return actor;
}

const officerCache = new Map<string, AuthUser | null>();

/** A live officer of one of these roles who can actually see this zone. */
async function officerFor(zoneId: string | null, roleKeys: string[]): Promise<AuthUser | null> {
  const key = `${zoneId ?? 'none'}:${roleKeys.join(',')}`;
  if (officerCache.has(key)) return officerCache.get(key) ?? null;

  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: { in: roleKeys } } } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      officeId: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
      jurisdictions: { select: { zoneId: true } },
    },
  });

  // A city-wide officer holds no jurisdictions, and an empty zone list matches
  // everything — exactly what `applicationScope` does for them.
  const inScope = users.filter((u) => {
    const zones = u.jurisdictions.map((j) => j.zoneId);
    return zones.length === 0 || (zoneId !== null && zones.includes(zoneId));
  });

  /**
   * A REAL desk account in preference to an all-access one.
   *
   * `super.demo` and `admin.demo` hold every role in the system, LTP included,
   * and they hold no jurisdiction — so they match every zone and, without
   * this, won every draw. The history then read "LTP verified question 2",
   * which is a thing an LTP cannot do.
   *
   * The service no longer records a role the actor could not have been acting
   * in, so this is no longer a correctness problem. It is still the wrong
   * account for the demonstration: a file should show the officer who would
   * really have handled it, and the all-access accounts exist for a human to
   * sign in with, not to appear in the record as the author of every finding.
   */
  const match =
    inScope.find((u) => u.roles.length <= 2) ??
    inScope.find((u) => u.roles.length < 5) ??
    inScope[0] ??
    null;

  const actor = match ? toAuthUser(match) : null;
  officerCache.set(key, actor);
  return actor;
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  officeId: string | null;
  roles: Array<{ role: { key: string; name: string } }>;
  jurisdictions: Array<{ zoneId: string }>;
};

function toAuthUser(user: UserRow): AuthUser {
  const roleKeys = user.roles.map((r) => r.role.key);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKeys: roleKeys as AuthUser['roleKeys'],
    capabilities: [...new Set(roleKeys.flatMap((key) => MATRIX[key] ?? []))],
    zoneIds: user.jurisdictions.map((j) => j.zoneId),
    officeId: user.officeId,
    sessionId: 'enrich-phase4',
    roleNames: user.roles.map((r) => r.role.name),
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────

const round2 = (value: number): number => Math.round(value * 100) / 100;
const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);
const daysAhead = (days: number): Date => new Date(Date.now() + days * 86_400_000);

// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(
    `\nPhase 4 demo enrichment — ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to perform)'}`
  );

  const total = await prisma.application.count({ where: { deletedAt: null } });
  console.log(`  ${total} applications on file. None will be created or deleted.`);

  // `--rederive` on its own recomputes the risk categories and does nothing
  // else — what you run after changing which questions bear on risk, or the
  // rule that reads them.
  if (REDERIVE_ONLY) {
    await rederiveRisk();
  } else {
    await fillParticulars();
    await fillOthers();
    await fillChecklist();
    await rederiveRisk();
  }

  if (APPLY) {
    const [withChecklist, withOthers, byRisk] = await Promise.all([
      prisma.application.count({ where: { deletedAt: null, checklistResponses: { some: {} } } }),
      prisma.applicationOthers.count(),
      prisma.application.groupBy({
        by: ['riskCategory'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { riskCategory: 'asc' },
      }),
    ]);

    console.log('\n  Now on file');
    note(`applications with a checklist  ${withChecklist}`);
    note(`applications with an others block ${withOthers}`);
    for (const row of byRisk) {
      note(`risk ${(row.riskCategory || 'not derived').padEnd(12)} ${row._count._all}`);
    }
  }

  console.log(
    APPLY ? '\nDone.\n' : `\n${wouldChange} record(s) would change. Nothing was written.\n`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
