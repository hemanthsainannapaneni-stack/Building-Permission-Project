import { PrismaClient } from '@prisma/client';
import { seedRbac } from './01-rbac';
import { seedOrg } from './02-org';
import { seedUsers } from './03-users';
import { seedSettings } from './04-settings';
import { seedCatalogue } from './05-catalogue';
import { seedScrutiny } from './06-scrutiny';
import { seedDocuments } from './07-documents';
import { seedFees } from './08-fees';
import { seedWorkflow } from './09-workflow';
import { seedNotifications } from './10-notifications';
import { seedSuperAdmin } from './11-superadmin';
import { seedChecklists } from './12-checklists';
import { seedNocTypes } from './13-noc-types';

/**
 * Seed orchestrator.
 *
 * Idempotent: safe to re-run against a database that already has data. Order
 * matters — users need roles and offices, application types need a workflow.
 *
 *   npm run db:seed
 */

const prisma = new PrismaClient();

// Read directly rather than through server/config/env. The seed is a plain
// script that must run before the app has ever booted — and importing env.ts
// would drag `server-only` and the whole server tree into a CLI process.
const DEMO_MODE = (process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

async function main() {
  const started = Date.now();
  console.log('\nSeeding LAMS\n');

  const rbac = await seedRbac(prisma);
  console.log(
    `  RBAC        ${rbac.permissions} permissions · ${rbac.roles} roles · ` +
      `+${rbac.granted} grants · -${rbac.revoked} revoked` +
      (rbac.orphansRemoved ? ` · ${rbac.orphansRemoved} orphan permission(s) removed` : '')
  );

  const org = await seedOrg(prisma);
  console.log(
    `  Org         ${org.departments} departments · ${org.zones} zones · ${org.offices} offices`
  );

  const settings = await seedSettings(prisma);
  console.log(
    `  Settings    ${settings.total} keys · ${settings.created} new · ` +
      `${settings.preserved} existing values preserved`
  );

  const catalogue = await seedCatalogue(prisma);
  console.log(
    `  Catalogue   ${catalogue.masterData} master rows · ` +
      `${catalogue.applicationTypes} application types · ${catalogue.workflows} workflow shell`
  );

  const scrutiny = await seedScrutiny(prisma);
  console.log(
    `  Scrutiny    ${scrutiny.rules} rules (no statutory reference — see 06-scrutiny.ts) · ` +
      `${scrutiny.drawingCategories} drawing categories`
  );

  const documents = await seedDocuments(prisma);
  console.log(
    `  Documents   ${documents.documentTypes} document types · ${documents.requirements} requirement rules`
  );

  const fees = await seedFees(prisma);
  console.log(
    `  Fees        ${fees.components} components · ${fees.rules} rules` +
      (fees.isPlaceholder ? ' — PLACEHOLDER RATES, see 08-fees.ts' : '')
  );

  const workflow = await seedWorkflow(prisma);
  console.log(
    `  Workflow    ${workflow.stages} stages · ${workflow.actions} actions · ` +
      `${workflow.transitions} transitions · ${workflow.slaRules} SLA rules · ` +
      `${workflow.assignments} assignment rules` +
      (workflow.retired ? ` · ${workflow.retired} retired` : '')
  );

  if (workflow.published) {
    console.log('              published — applications will route through it');
  } else {
    // Loud, and it stops nothing else: an invalid graph must not be published,
    // and the reason must be readable without going and looking for it.
    console.log('              NOT PUBLISHED — the graph did not validate:');
    for (const issue of workflow.issues) {
      console.log(`                ${issue.severity}  ${issue.rule}: ${issue.message}`);
    }
  }

  const checklists = await seedChecklists(prisma);
  console.log(
    `  Checklists  ${checklists.application.total}-point application · ` +
      `${checklists.inspection.total}-point site inspection` +
      `  (${checklists.application.created + checklists.inspection.created} new, ` +
      `${checklists.application.refreshed + checklists.inspection.refreshed} refreshed, ` +
      `${checklists.application.preserved + checklists.inspection.preserved} edited rows preserved)`
  );
  console.log(
    '              PROVISIONAL WORDING — the BBAS manuals do not contain the question text. ' +
      'See 12-checklists.ts.'
  );

  const nocTypes = await seedNocTypes(prisma);
  console.log(
    `  NOC types   ${nocTypes.total} (${nocTypes.active} active · ${nocTypes.created} new, ` +
      `${nocTypes.preserved} kept as configured)`
  );

  const notifications = await seedNotifications(prisma);
  console.log(
    `  Notices     ${notifications.total} templates across ${notifications.events} events · ` +
      `${notifications.created} new · ${notifications.updated} updated`
  );
  console.log(
    `              ${notifications.sms} SMS templates carry no DLT id yet — the SMS adapter refuses ` +
      `to send without one (Q13)`
  );

  // The real administrator, from the environment. Runs in every mode,
  // including DEMO_MODE, so a demonstration deployment can still have an
  // account whose password is not written in the README.
  const superAdmin = await seedSuperAdmin(prisma);
  if (superAdmin.seeded) {
    console.log(
      `  Super admin ${superAdmin.email} — ${superAdmin.created ? 'created' : 'already existed'}` +
        (superAdmin.passwordSet
          ? ', password set from SUPER_ADMIN_PASSWORD (must be changed at first sign-in)'
          : ', password left as it stands')
    );
  } else {
    console.log(`  Super admin skipped — ${superAdmin.reason}`);
  }

  if (DEMO_MODE) {
    const users = await seedUsers(prisma, DEMO_PASSWORD);
    console.log(`  Demo users  ${users.total} accounts (${users.created} new, ${users.updated} updated)`);
    console.log(`\n  Demo password: ${DEMO_PASSWORD}`);
    console.log('  Sign in as ltp.demo@example.com, tpa.demo@example.com, admin.demo@example.com, …');
    console.log('  Then run `npm run seed:demo` for seventy worked applications.');
  } else {
    console.log('  Demo users  skipped (DEMO_MODE is off)');
  }

  // A system with no way in is a system nobody can administer. Checked in
  // every mode, because DEMO_MODE being on is not a reason to stop looking.
  const admins = await prisma.user.count({
    where: { roles: { some: { role: { key: 'SYSTEM_ADMIN' } } }, deletedAt: null, status: 'ACTIVE' },
  });
  if (admins === 0) {
    console.log(
      '\n  WARNING: no active SYSTEM_ADMIN account exists. Set SUPER_ADMIN_EMAIL and ' +
        'SUPER_ADMIN_PASSWORD and seed again before deploying.'
    );
  }

  console.log(`\nSeeded in ${Date.now() - started}ms (${NODE_ENV})\n`);
}

main()
  .catch((err) => {
    console.error('\nSeed failed:\n', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
