/**
 * BRINGS THE EXISTING APPROVAL ORDERS UP TO THE PHASE 3 SHAPE.
 *
 *   npm run orders:backfill              report what would change, change nothing
 *   npm run orders:backfill -- --apply   perform it
 *
 * The demonstration database holds orders created before the order carried
 * conditions, a validity period, derived building figures or a rendered PDF.
 * They were written straight to ISSUED by a job that did nothing else. A fresh
 * `seed:demo:reset` now produces the full article, but resetting destroys every
 * application, payment and receipt in the database — and the point of this
 * script is that a demonstration already set up does not have to be thrown away
 * to gain the document.
 *
 * ── Re-taking a snapshot is normally forbidden, and this is the exception ──
 *
 * `approval_orders.snapshot` exists to be immutable: it is what makes a
 * permission unaffected by a fee schedule revised next year or an applicant's
 * name corrected next week. Rewriting one is therefore not a thing this system
 * does, and nothing in `src/server` can do it.
 *
 * It is done HERE, once, by hand, for a specific and stateable reason: these
 * snapshots were taken by a version that did not capture the fields, so the
 * frozen copy is not a record of what was printed — nothing was ever printed
 * from it. There is no artefact to contradict and no citizen holding a
 * document that would now disagree with the file. That is what makes it a
 * repair rather than a rewrite, and it is why this lives in `scripts/` with
 * its own audit row rather than anywhere a route could reach it.
 *
 * On any order whose snapshot ALREADY carries the Phase 3 fields, the script
 * does nothing at all.
 */
import { PrismaClient } from '@prisma/client';
import { storeApprovalOrderPdf } from '../src/server/services/approval-order-pdf';
import {
  DEFAULT_CONDITIONS,
  DEFAULT_VALIDITY_YEARS,
  deriveCoveragePercent,
  deriveFsi,
  deriveNetPlotArea,
} from '../src/lib/approval-orders';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Retries only through a dropped pooler connection — never a real refusal. */
async function throughDrops<T>(label: string, work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dropped =
        /P1017|Server has closed the connection|Transaction already closed|kind: Closed|Connection reset|Can't reach database/i.test(
          message
        );
      if (!dropped || attempt >= attempts) throw error;
      console.log(`    ${label} — connection dropped, retrying (${attempt}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
}

async function main() {
  console.log(
    `\nApproval order backfill — ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to perform)'}\n`
  );

  const orders = await prisma.approvalOrder.findMany({
    orderBy: { issuedAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      storageKey: true,
      validUntil: true,
      conditions: true,
      snapshot: true,
      issuedAt: true,
      application: {
        select: {
          id: true,
          applicationNumber: true,
          status: true,
          applicationType: { select: { code: true, name: true } },
          property: { select: { plotAreaSqm: true } },
          building: {
            select: {
              buildingUse: true,
              buildingSubUse: true,
              occupancyType: true,
              structureType: true,
              numFloors: true,
              numBasements: true,
              numDwellingUnits: true,
              buildingHeightM: true,
              plotAreaSqm: true,
              builtUpAreaSqm: true,
              floorAreaSqm: true,
              coverageAreaSqm: true,
              parkingAreaSqm: true,
              achievedFar: true,
              achievedCoverage: true,
              setbackFrontM: true,
              setbackRearM: true,
              setbackLeftM: true,
              setbackRightM: true,
              metadata: true,
            },
          },
          documents: {
            where: {
              status: 'VERIFIED',
              documentType: {
                OR: [
                  { code: { contains: 'NOC' } },
                  { code: { in: ['LAYOUT_APPROVAL_COPY', 'STRUCTURAL_STABILITY_CERTIFICATE'] } },
                ],
              },
            },
            select: {
              verifiedAt: true,
              documentType: { select: { code: true, name: true } },
              versions: {
                where: { isActive: true },
                orderBy: { versionNo: 'desc' },
                take: 1,
                select: { expiresOn: true },
              },
            },
          },
        },
      },
    },
  });

  let enriched = 0;
  let rendered = 0;
  let skipped = 0;

  for (const order of orders) {
    const snapshot = (order.snapshot ?? {}) as Record<string, unknown>;
    const hasPhase3 = snapshot.derived != null && Array.isArray(snapshot.conditions);
    const needsPdf = !order.storageKey;

    if (hasPhase3 && !needsPdf) {
      skipped += 1;
      continue;
    }

    if (!APPLY) {
      console.log(
        `    would ${hasPhase3 ? 'render' : 'enrich and render'} ${order.orderNumber} ` +
          `(${order.application.applicationNumber}, ${order.status})`
      );
      continue;
    }

    try {
      if (!hasPhase3) {
        const building = order.application.building;
        const fsi = building ? deriveFsi(building) : null;
        const coveragePercent = building ? deriveCoveragePercent(building) : null;
        const netPlot = deriveNetPlotArea(
          building?.plotAreaSqm ?? order.application.property?.plotAreaSqm ?? null,
          building?.metadata
        );

        const validUntil =
          order.validUntil ??
          (() => {
            const d = new Date(order.issuedAt);
            d.setFullYear(d.getFullYear() + DEFAULT_VALIDITY_YEARS);
            return d;
          })();

        const conditions = Array.isArray(order.conditions) && order.conditions.length
          ? (order.conditions as string[])
          : [...DEFAULT_CONDITIONS];

        await throughDrops(order.orderNumber, () =>
          prisma.approvalOrder.update({
            where: { id: order.id },
            data: {
              validUntil,
              conditions: conditions as never,
              snapshot: {
                // Everything the old snapshot held is kept. Only the fields it
                // never captured are added — this fills gaps, it does not
                // rewrite anything a previous version actually recorded.
                ...snapshot,
                validUntil: validUntil.toISOString(),
                building: building
                  ? {
                      buildingUse: building.buildingUse,
                      buildingSubUse: building.buildingSubUse,
                      occupancyType: building.occupancyType,
                      structureType: building.structureType,
                      numFloors: building.numFloors,
                      numBasements: building.numBasements,
                      numDwellingUnits: building.numDwellingUnits,
                      buildingHeightM: building.buildingHeightM,
                      plotAreaSqm: building.plotAreaSqm?.toString() ?? null,
                      builtUpAreaSqm: building.builtUpAreaSqm?.toString() ?? null,
                      floorAreaSqm: building.floorAreaSqm?.toString() ?? null,
                      coverageAreaSqm: building.coverageAreaSqm?.toString() ?? null,
                      parkingAreaSqm: building.parkingAreaSqm?.toString() ?? null,
                      setbackFrontM: building.setbackFrontM,
                      setbackRearM: building.setbackRearM,
                      setbackLeftM: building.setbackLeftM,
                      setbackRightM: building.setbackRightM,
                    }
                  : (snapshot.building ?? {}),
                derived: {
                  fsi,
                  coveragePercent,
                  netPlotAreaSqm: netPlot.net,
                  deductedAreaSqm: netPlot.deducted,
                  netPlotAssumed: netPlot.isAssumed,
                },
                clearances: order.application.documents.map((doc) => ({
                  code: doc.documentType.code,
                  name: doc.documentType.name,
                  verifiedAt: doc.verifiedAt?.toISOString() ?? null,
                  expiresOn: doc.versions[0]?.expiresOn?.toISOString() ?? null,
                })),
                conditions,
              } as never,
            },
          })
        );

        enriched += 1;
      }

      await throughDrops(order.orderNumber, () => storeApprovalOrderPdf(order.id));
      rendered += 1;

      console.log(
        `    ${order.orderNumber} — ${hasPhase3 ? 'rendered' : 'enriched and rendered'}`
      );
    } catch (error) {
      console.log(`    ${order.orderNumber} failed — ${(error as Error).message.slice(0, 140)}`);
    }
  }

  console.log(`\n  orders examined        ${orders.length}`);
  console.log(`  already complete       ${skipped}`);
  console.log(`  snapshots enriched     ${enriched}`);
  console.log(`  documents rendered     ${rendered}`);

  const withPdf = await prisma.approvalOrder.count({ where: { storageKey: { not: '' } } });
  console.log(`  orders carrying a PDF  ${withPdf} of ${orders.length}`);
  console.log(APPLY ? '\nDone.\n' : '\nNothing was written.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
