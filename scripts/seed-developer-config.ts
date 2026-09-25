/**
 * PHASE 11 CONFIGURATION ONLY — the grants and the validity settings.
 *
 *   npm run developers:config
 *
 * For a database seeded before developer registration existed. Runs the two
 * idempotent core seeds it needs — the permission matrix (adds DEVELOPER_* and
 * re-syncs every role to src/lib/rbac-matrix.ts) and the system settings (adds
 * the two developer settings; an administrator's edited value is never
 * overwritten). No workflow rows: a developer registration belongs to no file.
 * The tables themselves are created separately (prisma/phase11-developer-registration.sql).
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/01-rbac';
import { seedSettings } from '../prisma/seed/04-settings';

const prisma = new PrismaClient();

async function main() {
  console.log('RBAC', JSON.stringify(await seedRbac(prisma)));
  console.log('Settings', JSON.stringify(await seedSettings(prisma)));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
