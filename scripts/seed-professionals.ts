/**
 * PROFESSIONAL REGISTRATIONS FOR THE DEMONSTRATION — against an existing database.
 *
 *   npm run professionals:seed              report what would happen, change nothing
 *   npm run professionals:seed -- --apply   perform it
 *
 * A thin wrapper: the work is in prisma/seed/demo/professionals.ts, which the
 * full demo seed also runs at its end. Idempotent — see that file.
 */
import { PrismaClient } from '@prisma/client';
import { seedProfessionals } from '../prisma/seed/demo/professionals';

const prisma = new PrismaClient();

seedProfessionals(prisma, { apply: process.argv.includes('--apply'), log: (line) => console.log(line) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
