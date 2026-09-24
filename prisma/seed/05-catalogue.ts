import type { PrismaClient } from '@prisma/client';

/**
 * Application types and master data.
 *
 * An ApplicationType must point at a Workflow, so a workflow SHELL is created
 * here — code, name, version, unpublished, and no stages. The stage catalogue
 * and transition matrix are Phase 7 work; seeding an empty unpublished
 * workflow satisfies the foreign key without pretending the engine exists.
 */

const MASTER_DATA: Array<{ category: string; code: string; label: string; order: number }> = [
  // Land use. Generic on purpose — the real classification depends on the
  // jurisdiction's development plan, which has not been supplied (Q1).
  { category: 'LAND_USE', code: 'RESIDENTIAL', label: 'Residential', order: 1 },
  { category: 'LAND_USE', code: 'COMMERCIAL', label: 'Commercial', order: 2 },
  { category: 'LAND_USE', code: 'INDUSTRIAL', label: 'Industrial', order: 3 },
  { category: 'LAND_USE', code: 'INSTITUTIONAL', label: 'Institutional', order: 4 },
  { category: 'LAND_USE', code: 'MIXED', label: 'Mixed use', order: 5 },

  { category: 'BUILDING_USE', code: 'DWELLING', label: 'Dwelling', order: 1 },
  { category: 'BUILDING_USE', code: 'APARTMENT', label: 'Apartment', order: 2 },
  { category: 'BUILDING_USE', code: 'SHOP', label: 'Shop', order: 3 },
  { category: 'BUILDING_USE', code: 'OFFICE', label: 'Office', order: 4 },
  { category: 'BUILDING_USE', code: 'WAREHOUSE', label: 'Warehouse', order: 5 },
  { category: 'BUILDING_USE', code: 'SCHOOL', label: 'School', order: 6 },
  { category: 'BUILDING_USE', code: 'HOSPITAL', label: 'Hospital', order: 7 },

  { category: 'OCCUPANCY', code: 'A_RESIDENTIAL', label: 'Residential', order: 1 },
  { category: 'OCCUPANCY', code: 'B_EDUCATIONAL', label: 'Educational', order: 2 },
  { category: 'OCCUPANCY', code: 'C_INSTITUTIONAL', label: 'Institutional', order: 3 },
  { category: 'OCCUPANCY', code: 'D_ASSEMBLY', label: 'Assembly', order: 4 },
  { category: 'OCCUPANCY', code: 'E_BUSINESS', label: 'Business', order: 5 },
  { category: 'OCCUPANCY', code: 'F_MERCANTILE', label: 'Mercantile', order: 6 },
  { category: 'OCCUPANCY', code: 'G_INDUSTRIAL', label: 'Industrial', order: 7 },
  { category: 'OCCUPANCY', code: 'H_STORAGE', label: 'Storage', order: 8 },

  { category: 'STRUCTURE_TYPE', code: 'RCC', label: 'RCC framed', order: 1 },
  { category: 'STRUCTURE_TYPE', code: 'LOAD_BEARING', label: 'Load bearing', order: 2 },
  { category: 'STRUCTURE_TYPE', code: 'STEEL', label: 'Steel framed', order: 3 },
  { category: 'STRUCTURE_TYPE', code: 'COMPOSITE', label: 'Composite', order: 4 },

  { category: 'TENURE', code: 'FREEHOLD', label: 'Freehold', order: 1 },
  { category: 'TENURE', code: 'LEASEHOLD', label: 'Leasehold', order: 2 },
  { category: 'TENURE', code: 'ASSIGNED', label: 'Assigned', order: 3 },

  { category: 'LTP_CLASS', code: 'CLASS_I', label: 'Class-I', order: 1 },
  { category: 'LTP_CLASS', code: 'CLASS_II', label: 'Class-II', order: 2 },
  { category: 'LTP_CLASS', code: 'CLASS_III', label: 'Class-III', order: 3 },

  // ── The BBAS general-information lists ──────────────────────────────
  //
  // Master data and not enums, for the reason the header of
  // prisma/schema.prisma gives: these are lists a jurisdiction extends, and
  // adding "Regularisation" to them must never require a migration. The
  // values below are the ones the BBAS manuals name in the course of
  // describing the forms; a jurisdiction with more adds them in Settings.
  { category: 'CASE_TYPE', code: 'NEW', label: 'New', order: 1 },
  { category: 'CASE_TYPE', code: 'REVISED', label: 'Revised', order: 2 },
  { category: 'CASE_TYPE', code: 'RENEWAL', label: 'Renewal', order: 3 },

  { category: 'PERMISSION_TYPE', code: 'BUILDING', label: 'Building permission', order: 1 },
  { category: 'PERMISSION_TYPE', code: 'LAYOUT', label: 'Layout permission', order: 2 },
  { category: 'PERMISSION_TYPE', code: 'SUB_DIVISION', label: 'Sub-division', order: 3 },

  { category: 'NATURE_OF_PERMISSION', code: 'INDIVIDUAL', label: 'Individual building', order: 1 },
  { category: 'NATURE_OF_PERMISSION', code: 'GROUP_HOUSING', label: 'Group housing', order: 2 },
  { category: 'NATURE_OF_PERMISSION', code: 'MULTI_STOREYED', label: 'Multi-storeyed building', order: 3 },
  { category: 'NATURE_OF_PERMISSION', code: 'COMMERCIAL_COMPLEX', label: 'Commercial complex', order: 4 },

  { category: 'LAND_TYPE', code: 'PATTA', label: 'Patta', order: 1 },
  { category: 'LAND_TYPE', code: 'FREEHOLD', label: 'Freehold', order: 2 },
  { category: 'LAND_TYPE', code: 'ASSIGNED', label: 'Assigned', order: 3 },
  { category: 'LAND_TYPE', code: 'ENDOWMENT', label: 'Endowment', order: 4 },
  { category: 'LAND_TYPE', code: 'GOVERNMENT', label: 'Government', order: 5 },

  // Derived from the checklist, never chosen by hand — the list exists so the
  // register's filter and the detail screen read the same labels.
  { category: 'RISK_CATEGORY', code: 'LOW', label: 'Low', order: 1 },
  { category: 'RISK_CATEGORY', code: 'MEDIUM', label: 'Medium', order: 2 },
  { category: 'RISK_CATEGORY', code: 'HIGH', label: 'High', order: 3 },

  { category: 'NATURE_OF_SITE', code: 'VACANT', label: 'Vacant', order: 1 },
  { category: 'NATURE_OF_SITE', code: 'PARTLY_BUILT', label: 'Partly built upon', order: 2 },
  { category: 'NATURE_OF_SITE', code: 'BUILT_UP', label: 'Built upon', order: 3 },
  { category: 'NATURE_OF_SITE', code: 'AGRICULTURAL', label: 'Agricultural', order: 4 },
];

const APPLICATION_TYPES = [
  {
    code: 'RESIDENTIAL_BUILDING',
    name: 'Residential building permission',
    description: 'Individual residential building or apartment block.',
    numberPrefix: 'BP',
    requiresScrutiny: true,
  },
  {
    code: 'COMMERCIAL_BUILDING',
    name: 'Commercial building permission',
    description: 'Shop, office or mixed commercial development.',
    numberPrefix: 'BP',
    requiresScrutiny: true,
  },
  {
    code: 'LAYOUT_APPROVAL',
    name: 'Layout approval',
    description: 'Sub-division of land into plots.',
    numberPrefix: 'LP',
    requiresScrutiny: true,
  },
];

export async function seedCatalogue(prisma: PrismaClient) {
  // ── Master data ───────────────────────────────────────────────────────
  for (const m of MASTER_DATA) {
    await prisma.masterData.upsert({
      where: { category_code: { category: m.category, code: m.code } },
      create: { category: m.category, code: m.code, label: m.label, displayOrder: m.order },
      update: { label: m.label, displayOrder: m.order },
    });
  }

  // ── Workflow shell ────────────────────────────────────────────────────
  // Deliberately unpublished and stage-less. Phase 7 seeds the real stage
  // catalogue and transition matrix; this only satisfies the FK so that
  // application types can exist now.
  const workflow = await prisma.workflow.upsert({
    where: { code_version: { code: 'BP_STANDARD', version: 1 } },
    create: {
      code: 'BP_STANDARD',
      version: 1,
      name: 'Standard building permission workflow',
      description:
        'Shell only. Stages, actions and transitions are seeded in Phase 7 — publishing is blocked until the graph validates.',
      isPublished: false,
    },
    update: { name: 'Standard building permission workflow' },
  });

  // ── Application types ─────────────────────────────────────────────────
  for (const t of APPLICATION_TYPES) {
    await prisma.applicationType.upsert({
      where: { code: t.code },
      create: { ...t, workflowId: workflow.id },
      update: {
        name: t.name,
        description: t.description,
        numberPrefix: t.numberPrefix,
        requiresScrutiny: t.requiresScrutiny,
      },
    });
  }

  return {
    masterData: MASTER_DATA.length,
    applicationTypes: APPLICATION_TYPES.length,
    workflows: 1,
  };
}
