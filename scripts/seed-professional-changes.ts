/**
 * CHANGE OF TECHNICAL PROFESSIONAL FOR THE DEMONSTRATION — against an
 * existing database.
 *
 *   npm run tpchange:seed              report what would happen, change nothing
 *   npm run tpchange:seed -- --apply   perform it
 *
 * A thin wrapper, like scripts/seed-proceedings.ts: the work is in
 * prisma/seed/demo/professional-changes.ts, which the full demo seed also runs
 * at its end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedProfessionalChanges } from '../prisma/seed/demo/professional-changes';

const prisma = new PrismaClient();

seedProfessionalChanges(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
