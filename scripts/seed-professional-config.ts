/**
 * PHASE 12 CONFIGURATION ONLY — grants, validity settings, professional types.
 *
 *   npm run professionals:config
 *
 * Runs the idempotent core seeds it needs: the permission matrix (adds
 * LTP_REG_* and re-syncs every role to src/lib/rbac-matrix.ts), the
 * system settings (adds the two professional settings; edited values are kept)
 * and the professional types (create-only; edited types are kept). No workflow
 * rows: a registration belongs to no file. The tables themselves are created
 * separately (prisma/phase12-professional-registration.sql).
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/01-rbac';
import { seedSettings } from '../prisma/seed/04-settings';
import { seedProfessionalTypes } from '../prisma/seed/14-professional-types';

const prisma = new PrismaClient();

async function main() {
  console.log('RBAC', JSON.stringify(await seedRbac(prisma)));
  console.log('Settings', JSON.stringify(await seedSettings(prisma)));
  console.log('LTP types', JSON.stringify(await seedProfessionalTypes(prisma)));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
