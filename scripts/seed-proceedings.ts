/**
 * SHOW CAUSE, REVOCATION AND OUTWARD FOR THE DEMONSTRATION — against an
 * existing database.
 *
 *   npm run proceedings:seed              report what would happen, change nothing
 *   npm run proceedings:seed -- --apply   perform it
 *
 * A thin wrapper, like scripts/backfill-bim.ts: the work is in
 * prisma/seed/demo/proceedings.ts, which the full demo seed also runs at its
 * end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedProceedings } from '../prisma/seed/demo/proceedings';

const prisma = new PrismaClient();

seedProceedings(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
