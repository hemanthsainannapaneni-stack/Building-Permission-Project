/**
 * DEVELOPER REGISTRATIONS FOR THE DEMONSTRATION — against an existing database.
 *
 *   npm run developers:seed              report what would happen, change nothing
 *   npm run developers:seed -- --apply   perform it
 *
 * A thin wrapper: the work is in prisma/seed/demo/developers.ts, which the full
 * demo seed also runs at its end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedDevelopers } from '../prisma/seed/demo/developers';

const prisma = new PrismaClient();

seedDevelopers(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
