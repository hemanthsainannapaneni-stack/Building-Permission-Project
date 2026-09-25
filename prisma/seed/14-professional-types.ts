import type { PrismaClient } from '@prisma/client';
import { DEFAULT_PROFESSIONAL_TYPES, PROFESSIONAL_TYPE_CATEGORY } from '../../src/lib/professional-registration';

/**
 * The professional types (master_data PROFESSIONAL_TYPE) — Phase 12.
 *
 * Create-only: a type an administrator has renamed, re-prefixed or switched
 * off on Settings → Professional Types is left exactly as configured.
 */
export async function seedProfessionalTypes(prisma: PrismaClient) {
  let created = 0;
  for (const t of DEFAULT_PROFESSIONAL_TYPES) {
    const existing = await prisma.masterData.findUnique({ where: { category_code: { category: PROFESSIONAL_TYPE_CATEGORY, code: t.code } } });
    if (existing) continue;
    await prisma.masterData.create({
      data: { category: PROFESSIONAL_TYPE_CATEGORY, code: t.code, label: t.label, displayOrder: t.order, metadata: t.metadata },
    });
    created += 1;
  }
  return { total: DEFAULT_PROFESSIONAL_TYPES.length, created, preserved: DEFAULT_PROFESSIONAL_TYPES.length - created };
}
