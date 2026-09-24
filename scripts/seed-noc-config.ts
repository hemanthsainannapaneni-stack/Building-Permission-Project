/**
 * NOC CONFIGURATION ONLY — the catalogue and the grants.
 *
 *   npm run nocs:config
 *
 * For a database seeded before the NOC module existed. Runs the two
 * idempotent core seeds the module needs — the permission matrix (which adds
 * NOC_VIEW / NOC_UPDATE / NOC_VERIFY and re-syncs every role's grants to
 * src/lib/rbac-matrix.ts) and the NOC type catalogue — without re-running the
 * whole core seed.
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/01-rbac';
import { seedNocTypes } from '../prisma/seed/13-noc-types';

const prisma = new PrismaClient();

async function main() {
  const rbac = await seedRbac(prisma);
  console.log('RBAC', JSON.stringify(rbac));
  const types = await seedNocTypes(prisma);
  console.log('NOC types', JSON.stringify(types));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
