/**
 * Worker entrypoint.
 *
 * Same image as the web app, different entrypoint — one build artifact to
 * produce, one to secure, one set of dependencies to patch.
 *
 *   npm run worker
 */
import { startWorker } from '../src/server/jobs/worker';
import { prisma } from '../src/server/db/prisma';
import { env } from '../src/server/config/env';

async function main() {
  if (!env.workerEnabled) {
    console.log('[worker] WORKER_ENABLED=false — exiting');
    return;
  }

  // Fail fast rather than spinning in a claim-retry loop against a database
  // that is not there.
  await prisma.$queryRaw`SELECT 1`;
  console.log(`[worker] database reachable (${env.nodeEnv})`);

  const handle = startWorker();

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received — finishing in-flight jobs`);
    await handle.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('[worker] fatal', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
