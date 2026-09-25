/**
 * PHASE 11 CONFIGURATION ONLY — grants, validity settings, notification templates.
 *
 *   npm run developers:config
 *
 * For a database seeded before developer registration existed. Runs the
 * idempotent core seeds it needs — the permission matrix (adds DEVELOPER_*
 * and re-syncs every role to src/lib/rbac-matrix.ts), the system settings
 * (adds the two developer settings; an administrator's edited value is never
 * overwritten) and the notification templates (adds the seven
 * DEVELOPER_REGISTRATION_* events' IN_APP/EMAIL/SMS templates; an
 * administrator's registered provider template id is preserved — see
 * prisma/seed/10-notifications.ts). No workflow rows: a developer
 * registration belongs to no file. The tables themselves are created
 * separately (prisma/phase11-developer-registration.sql).
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/01-rbac';
import { seedSettings } from '../prisma/seed/04-settings';
import { seedNotifications } from '../prisma/seed/10-notifications';

const prisma = new PrismaClient();

async function main() {
  console.log('RBAC', JSON.stringify(await seedRbac(prisma)));
  console.log('Settings', JSON.stringify(await seedSettings(prisma)));
  console.log('Notifications', JSON.stringify(await seedNotifications(prisma)));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
