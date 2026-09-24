/**
 * OCCUPANCY FOR THE DEMONSTRATION — against an existing database.
 *
 *   npm run occupancy:seed              report what would happen, change nothing
 *   npm run occupancy:seed -- --apply   perform it
 *
 * A thin wrapper: the work is in prisma/seed/demo/occupancy.ts, which the full
 * demo seed also runs at its end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedOccupancy } from '../prisma/seed/demo/occupancy';

const prisma = new PrismaClient();

seedOccupancy(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
