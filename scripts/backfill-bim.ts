/**
 * GIVES EVERY EXISTING APPLICATION ITS BIM SUBMISSION.
 *
 *   npm run bim:backfill              report what would change, change nothing
 *   npm run bim:backfill -- --apply   perform it
 *
 * Applications filed before the BIM module have drawings and no model. This
 * writes, for each one without a BIM submission, an IFC4 model of the
 * declared building (through the real upload pipeline, read by the real IFC
 * reader), the particulars an LTP would state about it, the LTP declaration
 * for anything already filed, and the department's acceptance for anything
 * already approved. See prisma/seed/demo/bim.ts for why this writes directly.
 *
 * Idempotent: an application that already has BIM particulars is left alone.
 */
import { PrismaClient } from '@prisma/client';
import { backfillBim } from '../prisma/seed/demo/bim';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? 'Backfilling BIM…' : 'Dry run — pass --apply to write.');
  await backfillBim(prisma, { apply: APPLY });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
