import type { PrismaClient } from '@prisma/client';

/**
 * THE 19-POINT AND 27-POINT CHECKLISTS — PROVISIONAL WORDING.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  READ THIS BEFORE QUOTING ANY SENTENCE BELOW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  NONE OF THIS WORDING IS OFFICIAL BBAS TEXT.
 *
 *  The four BBAS manuals supplied for this project describe both checklists
 *  and show them in screenshots, but neither reproduces the questions as
 *  text. What they give is the SUBJECT AREAS:
 *
 *    Application checklist (TPA manual §5.5, ZDD §8.4, JD §9.4)
 *      Q1–10   "ownership validity, encumbrance status, master plan zoning,
 *               and layout compliance"
 *      Q11–19  "building height limits, setback clearances, structural
 *               safety, and seismic design standards"
 *      and, from the LTP manual §6.4, the thresholds those questions turn on:
 *      height over 10 m / 15 m commercial / 18 m residential or group
 *      housing, a monument buffer of 100–200 m, a railway buffer of 30 m, and
 *      built-up area over 20,000 sq m.
 *
 *    Site inspection checklist (TPA manual §5.8.1)
 *      Q1–12   "actual site boundaries, road width on ground, encroachment
 *               status, high-tension power line proximity, and natural water
 *               bodies"
 *      Q13–27  "physical site topography, presence of existing structures,
 *               tree preservation, and adherence to approved layout
 *               boundaries"
 *      and, from ZDD §8.7 and JD §10.7, the observations actually recorded:
 *      whether work has commenced, the stage of construction, total area as
 *      on ground, the compound wall, and the abutting road width measured on
 *      site.
 *
 *  The sentences below are written from those subject areas and NOTHING ELSE.
 *  No statutory requirement is asserted that the manuals do not name. Every
 *  row is stored with `isProvisional: true`, which the interface shows, and
 *  every row is editable from Settings → Checklists.
 *
 *  TO REPLACE THEM: export figures 5.6/5.7 (application) and 5.11/5.12 (site
 *  inspection) from the TPA manual, enter the real text in the administration
 *  screen or here, and clear `isProvisional`. No migration is involved and no
 *  module has to change — which is the whole reason the wording is a row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Re-running is safe. Wording an administrator has edited is PRESERVED: the
 * upsert only writes the question text of rows still marked provisional, so a
 * seed run cannot overwrite the official text once somebody has entered it.
 */

type ItemSeed = {
  itemNumber: number;
  question: string;
  description?: string;
  responseType?: 'YES_NO' | 'YES_NO_NA' | 'TEXT' | 'NUMBER' | 'MEASUREMENT';
  category: string;
  helpText?: string;
  isMandatory?: boolean;
  requiresDocument?: boolean;
  affectsRisk?: boolean;
};

const PROVISIONAL =
  'Provisional demo wording — replace with the official BBAS question when the ' +
  'corresponding manual figure is available.';

// ═══════════════════════════════════════════════════════════════════════════
// The 19-point application checklist
// ═══════════════════════════════════════════════════════════════════════════
//
// Q1–10 cover ownership, encumbrance, zoning and layout; Q11–19 cover height,
// setbacks, structural safety and seismic design. That split is the manuals';
// the sentences are this file's.

const APPLICATION_ITEMS: ItemSeed[] = [
  {
    itemNumber: 1,
    question: 'Is the applicant the registered owner of the site, or authorised in writing by the owner?',
    category: 'Ownership',
    helpText: 'Attach the registered sale deed, or the authorisation and the owner’s title.',
    requiresDocument: true,
  },
  {
    itemNumber: 2,
    question: 'Is the registered title document for the site enclosed?',
    category: 'Ownership',
    requiresDocument: true,
  },
  {
    itemNumber: 3,
    question: 'Is a current encumbrance certificate for the site enclosed?',
    category: 'Encumbrance',
    helpText: 'The period covered should reach the date of application.',
    requiresDocument: true,
  },
  {
    itemNumber: 4,
    question: 'Is the site free of any subsisting mortgage, lien, attachment or court proceeding?',
    category: 'Encumbrance',
    affectsRisk: true,
  },
  {
    itemNumber: 5,
    question: 'Is the latest property tax receipt for the site enclosed?',
    category: 'Ownership',
    requiresDocument: true,
  },
  {
    itemNumber: 6,
    question: 'Does the land use of the site under the master plan permit the proposed use?',
    category: 'Zoning',
    helpText: 'State the master plan land use zone and the proposed use.',
    affectsRisk: true,
  },
  {
    itemNumber: 7,
    question: 'Does the site fall within an approved layout?',
    category: 'Layout',
    responseType: 'YES_NO_NA',
  },
  {
    itemNumber: 8,
    question: 'Is the approved layout plan, with its approval number and date, enclosed?',
    category: 'Layout',
    responseType: 'YES_NO_NA',
    requiresDocument: true,
  },
  {
    itemNumber: 9,
    question: 'Does the plot as proposed agree with the plot shown in the approved layout in number, extent and dimensions?',
    category: 'Layout',
    responseType: 'YES_NO_NA',
  },
  {
    itemNumber: 10,
    question: 'Is any part of the site affected by a road widening, green buffer or other master plan reservation?',
    category: 'Zoning',
    helpText: 'If yes, the affected extent must be deducted in Plot Details before the net plot area is computed.',
    affectsRisk: true,
  },

  {
    itemNumber: 11,
    question: 'Does the proposed building exceed 10 m in height?',
    category: 'Height',
    helpText: 'The 10 m threshold is named in the LTP manual’s account of this checklist.',
    affectsRisk: true,
  },
  {
    itemNumber: 12,
    question: 'If the proposal is commercial, does it exceed 15 m in height?',
    category: 'Height',
    responseType: 'YES_NO_NA',
    helpText: 'Drives the external Fire NOC requirement.',
    affectsRisk: true,
  },
  {
    itemNumber: 13,
    question: 'If the proposal is residential or group housing, does it exceed 18 m in height?',
    category: 'Height',
    responseType: 'YES_NO_NA',
    helpText: 'Drives the external Fire NOC requirement.',
    affectsRisk: true,
  },
  {
    itemNumber: 14,
    question: 'Does the total built-up area proposed exceed 20,000 sq m?',
    category: 'Scale',
    affectsRisk: true,
  },
  {
    itemNumber: 15,
    question: 'Are the front, rear and side setbacks proposed as required for a building of this height and use?',
    category: 'Setbacks',
    helpText: 'The setbacks entered here are checked against the drawing during scrutiny.',
  },
  {
    itemNumber: 16,
    question: 'Is the parking provided as required for the proposed use and floor area?',
    category: 'Parking',
  },
  {
    itemNumber: 17,
    question: 'Is the site within 100 m to 200 m of a protected monument?',
    category: 'Proximity',
    helpText: 'The 100–200 m monument buffer is named in the LTP manual.',
    affectsRisk: true,
  },
  {
    itemNumber: 18,
    question: 'Is the site within 30 m of a railway boundary?',
    category: 'Proximity',
    helpText: 'The 30 m railway buffer is named in the LTP manual.',
    affectsRisk: true,
  },
  {
    itemNumber: 19,
    question: 'Is the structural design certificate, covering structural safety and seismic design, enclosed and signed by the structural engineer on record?',
    category: 'Structural safety',
    requiresDocument: true,
    affectsRisk: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// The 27-point site inspection checklist
// ═══════════════════════════════════════════════════════════════════════════
//
// Q1–12 are what the TPA measures and looks at on the ground; Q13–27 are the
// site's condition and what is already on it. Again, the split is the manual's
// and the sentences are this file's.

const SITE_INSPECTION_ITEMS: ItemSeed[] = [
  {
    itemNumber: 1,
    question: 'Do the site boundaries on the ground agree with the boundaries shown in the application?',
    category: 'Boundaries',
  },
  {
    itemNumber: 2,
    question: 'Do the plot dimensions measured on site agree with those in the document and the drawing?',
    category: 'Boundaries',
    responseType: 'YES_NO',
  },
  {
    itemNumber: 3,
    question: 'What is the total area of the site as measured on the ground (sq m)?',
    category: 'Boundaries',
    responseType: 'MEASUREMENT',
    helpText: 'Recorded against the document area; a difference is a shortfall, not a rejection.',
  },
  {
    itemNumber: 4,
    question: 'Is there an approach road to the site?',
    category: 'Access',
  },
  {
    itemNumber: 5,
    question: 'What is the width of the abutting road measured on the ground (m)?',
    category: 'Access',
    responseType: 'MEASUREMENT',
    helpText: 'Recorded against the road width declared in General Information.',
    affectsRisk: true,
  },
  {
    itemNumber: 6,
    question: 'Is the abutting road width on the ground the same as the width shown in the master plan or approved layout?',
    category: 'Access',
    affectsRisk: true,
  },
  {
    itemNumber: 7,
    question: 'Is the site accessible for construction traffic and for fire tender access?',
    category: 'Access',
  },
  {
    itemNumber: 8,
    question: 'Is any part of the site encroached upon?',
    category: 'Encroachment',
    affectsRisk: true,
  },
  {
    itemNumber: 9,
    question: 'Does the site encroach on any road, drain, channel or other public land?',
    category: 'Encroachment',
    affectsRisk: true,
  },
  {
    itemNumber: 10,
    question: 'Does a high-tension power line pass over or beside the site?',
    category: 'Constraints',
    helpText: 'If yes, record the clearance measured on site in the observation.',
    affectsRisk: true,
  },
  {
    itemNumber: 11,
    question: 'Is there a natural water body, canal, tank or watercourse adjoining the site?',
    category: 'Constraints',
    affectsRisk: true,
  },
  {
    itemNumber: 12,
    question: 'Is there any other physical constraint on the site that the application does not disclose?',
    category: 'Constraints',
    responseType: 'YES_NO',
  },

  {
    itemNumber: 13,
    question: 'What is the topography of the site — level, sloping, low-lying or undulating?',
    category: 'Site condition',
    responseType: 'TEXT',
  },
  {
    itemNumber: 14,
    question: 'Is the ground condition suitable for the construction proposed?',
    category: 'Site condition',
  },
  {
    itemNumber: 15,
    question: 'Is the site filled, excavated or otherwise altered from its natural level?',
    category: 'Site condition',
  },
  {
    itemNumber: 16,
    question: 'Is any existing structure standing on the site?',
    category: 'Existing construction',
    affectsRisk: true,
  },
  {
    itemNumber: 17,
    question: 'If a structure is standing, is it shown in the application and the drawing?',
    category: 'Existing construction',
    responseType: 'YES_NO_NA',
  },
  {
    itemNumber: 18,
    question: 'Has work already commenced on the site?',
    category: 'Existing construction',
    helpText: 'The ZDD and JD manuals record this observation explicitly.',
    affectsRisk: true,
  },
  {
    itemNumber: 19,
    question: 'What is the stage of construction at the time of inspection?',
    category: 'Existing construction',
    responseType: 'TEXT',
    helpText: 'For example: not commenced, excavation, foundation, slabs laid.',
  },
  {
    itemNumber: 20,
    question: 'Is a compound wall standing on the site?',
    category: 'Existing construction',
  },
  {
    itemNumber: 21,
    question: 'Are there trees standing on the site?',
    category: 'Trees and greenery',
  },
  {
    itemNumber: 22,
    question: 'How many trees are standing, and are any proposed to be felled?',
    category: 'Trees and greenery',
    responseType: 'TEXT',
    isMandatory: false,
  },
  {
    itemNumber: 23,
    question: 'Does the plot on the ground conform to the plot shown in the approved layout?',
    category: 'Layout conformity',
    responseType: 'YES_NO_NA',
  },
  {
    itemNumber: 24,
    question: 'Are the layout roads and open spaces adjoining the plot formed as approved?',
    category: 'Layout conformity',
    responseType: 'YES_NO_NA',
  },
  {
    itemNumber: 25,
    question: 'What is the predominant use of the surrounding development?',
    category: 'Surroundings',
    responseType: 'TEXT',
  },
  {
    itemNumber: 26,
    question: 'Is the neighbouring development consistent with the use proposed on this site?',
    category: 'Surroundings',
  },
  {
    itemNumber: 27,
    question: 'Any other observation recorded during the inspection?',
    category: 'Other',
    responseType: 'TEXT',
    isMandatory: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Seeding
// ═══════════════════════════════════════════════════════════════════════════

async function seedKind(prisma: PrismaClient, kind: string, items: ItemSeed[]) {
  let created = 0;
  let refreshed = 0;
  let preserved = 0;

  for (const [index, item] of items.entries()) {
    const existing = await prisma.checklistItemDefinition.findUnique({
      where: { kind_itemNumber: { kind, itemNumber: item.itemNumber } },
      select: { id: true, isProvisional: true },
    });

    const shape = {
      description: item.description ?? '',
      responseType: item.responseType ?? 'YES_NO_NA',
      category: item.category,
      helpText: item.helpText ?? '',
      isMandatory: item.isMandatory ?? true,
      requiresDocument: item.requiresDocument ?? false,
      affectsRisk: item.affectsRisk ?? false,
      displayOrder: (index + 1) * 10,
    };

    if (!existing) {
      await prisma.checklistItemDefinition.create({
        data: {
          kind,
          itemNumber: item.itemNumber,
          question: item.question,
          isActive: true,
          isProvisional: true,
          source: PROVISIONAL,
          ...shape,
        },
      });
      created += 1;
      continue;
    }

    if (!existing.isProvisional) {
      // Somebody has entered the official wording. The seed does not touch the
      // question, the help text or anything else an administrator may have
      // corrected alongside it — re-running must never undo that work.
      preserved += 1;
      continue;
    }

    await prisma.checklistItemDefinition.update({
      where: { id: existing.id },
      data: { question: item.question, source: PROVISIONAL, ...shape },
    });
    refreshed += 1;
  }

  return { created, refreshed, preserved, total: items.length };
}

export async function seedChecklists(prisma: PrismaClient) {
  const application = await seedKind(prisma, 'APPLICATION', APPLICATION_ITEMS);
  const inspection = await seedKind(prisma, 'SITE_INSPECTION', SITE_INSPECTION_ITEMS);

  return { application, inspection };
}
