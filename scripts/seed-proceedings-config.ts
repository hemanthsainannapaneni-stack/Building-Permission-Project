/**
 * PHASE 7 CONFIGURATION ONLY — the grants and the workflow rows.
 *
 *   npm run proceedings:config
 *
 * For a database seeded before the show cause / revocation / outward modules
 * existed. Runs the two idempotent core seeds they need — the permission
 * matrix (adds SHOW_CAUSE_*, REVOCATION_*, OUTWARD_* and re-syncs every role
 * to src/lib/rbac-matrix.ts) and the workflow definitions (adds the actions,
 * the CLOSED_REVOKED stage and the show cause / revocation transitions, then
 * re-validates and re-publishes) — without re-running the whole core seed.
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/01-rbac';
import { seedWorkflow } from '../prisma/seed/09-workflow';

const prisma = new PrismaClient();

async function main() {
  const rbac = await seedRbac(prisma);
  console.log('RBAC', JSON.stringify(rbac));
  const wf = await seedWorkflow(prisma);
  console.log('Workflows', JSON.stringify(wf.workflows.map((w) => ({ code: w.code, transitions: w.transitions, retired: w.retired, published: w.published }))));
  const errors = wf.issues.filter((i) => i.severity === 'ERROR');
  if (errors.length) {
    console.error('Workflow validation errors:', JSON.stringify(errors, null, 2));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
