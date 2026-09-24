import type { PrismaClient } from '@prisma/client';

/**
 * THE NOC CATALOGUE.
 *
 * Fire is ACTIVE. The other six are seeded INACTIVE so switching one on is a
 * data change from Settings → NOC Types, with no migration and no deployment.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No height, area, distance or occupancy threshold. Whether a file needs any
 * of these is decided by the reviewing officer on that file. The only link to
 * the rest of the record is `suggestedByChecklistItems`: application checklist
 * questions that ask about the same subject, whose YES answer the NOCs tab
 * shows beside the decision. Those links are to questions that already name
 * the subject (12-checklists.ts says Q12 and Q13 "drive the external Fire NOC
 * requirement"; Q17 asks about a protected monument; Q18 about a railway
 * boundary). None of them is decisive.
 *
 * The authorities are the usual issuing bodies, stated generically. They are
 * copied onto each NOC when it is opened and can be corrected per file.
 *
 * Idempotent. An existing row keeps its `isActive`, name and authority — an
 * administrator's edit survives a re-seed.
 */

type Seed = {
  code: string;
  name: string;
  authority: string;
  description: string;
  documentTypeCode?: string;
  suggestedByChecklistItems?: number[];
  requiresExpiry?: boolean;
  isActive: boolean;
  displayOrder: number;
};

export const NOC_TYPES: Seed[] = [
  {
    code: 'FIRE',
    name: 'Fire NOC',
    authority: 'State Disaster Response & Fire Services Department',
    description: 'No-objection certificate from the fire service for the proposed building.',
    documentTypeCode: 'FIRE_NOC',
    suggestedByChecklistItems: [12, 13],
    isActive: true,
    displayOrder: 10,
  },
  {
    code: 'AIRPORT',
    name: 'Airport Authority NOC',
    authority: 'Airports Authority of India',
    description: 'Height clearance from the airport authority. Configure before use.',
    isActive: false,
    displayOrder: 20,
  },
  {
    code: 'RAILWAY',
    name: 'Railway NOC',
    authority: 'Railway Divisional Office',
    description: 'No-objection certificate from the railway administration. Configure before use.',
    suggestedByChecklistItems: [18],
    isActive: false,
    displayOrder: 30,
  },
  {
    code: 'ENVIRONMENT',
    name: 'Environmental Clearance',
    authority: 'State Environment Impact Assessment Authority',
    description: 'Environmental clearance for the project. Configure before use.',
    isActive: false,
    displayOrder: 40,
  },
  {
    code: 'WATER_RESOURCES',
    name: 'Water Resources NOC',
    authority: 'Water Resources Department',
    description: 'No-objection certificate for a site near a water body or irrigation work. Configure before use.',
    isActive: false,
    displayOrder: 50,
  },
  {
    code: 'HERITAGE',
    name: 'Heritage / Monument NOC',
    authority: 'Competent Authority for Protected Monuments',
    description: 'No-objection certificate for a site near a protected monument. Configure before use.',
    suggestedByChecklistItems: [17],
    isActive: false,
    displayOrder: 60,
  },
  {
    code: 'OTHER',
    name: 'Other NOC',
    authority: '',
    description: 'Any other no-objection certificate the desk asks for. Name the authority on the NOC.',
    requiresExpiry: false,
    isActive: false,
    displayOrder: 90,
  },
];

export async function seedNocTypes(prisma: PrismaClient) {
  let created = 0;
  let preserved = 0;

  for (const t of NOC_TYPES) {
    const existing = await prisma.nocType.findUnique({ where: { code: t.code }, select: { id: true } });
    if (existing) {
      // Only the wiring is refreshed; what an administrator edits is left alone.
      await prisma.nocType.update({
        where: { code: t.code },
        data: {
          documentTypeCode: t.documentTypeCode ?? '',
          suggestedByChecklistItems: t.suggestedByChecklistItems ?? [],
          displayOrder: t.displayOrder,
        },
      });
      preserved += 1;
      continue;
    }
    await prisma.nocType.create({
      data: {
        code: t.code,
        name: t.name,
        authority: t.authority,
        description: t.description,
        documentTypeCode: t.documentTypeCode ?? '',
        suggestedByChecklistItems: t.suggestedByChecklistItems ?? [],
        requiresExpiry: t.requiresExpiry ?? true,
        isActive: t.isActive,
        displayOrder: t.displayOrder,
      },
    });
    created += 1;
  }

  const active = await prisma.nocType.count({ where: { isActive: true } });
  return { total: NOC_TYPES.length, created, preserved, active };
}
