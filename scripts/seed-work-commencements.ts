/**
 * WORK INITIATED FOR THE DEMONSTRATION — against an existing database.
 *
 *   npm run commencement:seed              report what would happen, change nothing
 *   npm run commencement:seed -- --apply   perform it
 *
 * A thin wrapper, like scripts/seed-professional-changes.ts: the work is in
 * prisma/seed/demo/work-commencements.ts, which the full demo seed also runs
 * at its end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedWorkCommencements } from '../prisma/seed/demo/work-commencements';

const prisma = new PrismaClient();

seedWorkCommencements(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
