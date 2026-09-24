import type { PrismaClient } from '@prisma/client';
import { demoBimFor, type DemoBimSource } from '../../../src/server/bim/demo-bim';
import { readIfc } from '../../../src/server/bim/ifc';
import { storeUpload } from '../../../src/server/services/files';
import type { ClaimedJob } from '../../../src/server/jobs/queue';

/**
 * BIM FOR EVERY APPLICATION.
 *
 * Two callers:
 *
 *   · the demo journey, which uploads the model through the real BIM service
 *     while the file is still editable — see `loadBimSource` below;
 *   · the backfill (`npm run bim:backfill`, and the tail of `seed:demo`),
 *     which brings every application that has no BIM submission up to shape.
 *
 * ── Why the backfill writes directly ──────────────────────────────────────
 *
 * Most demonstration files are long past the point where the service would
 * accept a model: scrutiny has passed and the drawings are part of the
 * record. The service refuses that, rightly. The backfill is the one-off
 * exception, run by hand, for files that pre-date the BIM module — exactly
 * the repair `orders:backfill` makes for approval orders. The model FILE still
 * goes through the full upload pipeline (sniff, checksum, storage, scan) and
 * is read by the same IFC reader as a live upload, so the facts on a
 * backfilled version are genuinely read from its bytes.
 *
 * Idempotent: an application that already has a BIM submission is skipped.
 */

export async function loadBimSource(prisma: PrismaClient, applicationId: string): Promise<DemoBimSource | null> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      applicationNumber: true,
      status: true,
      ltp: { select: { name: true, firmName: true } },
      applicant: { select: { name: true } },
      property: { select: { district: true, plotNo: true } },
      building: {
        select: {
          numFloors: true,
          numBasements: true,
          numDwellingUnits: true,
          buildingHeightM: true,
          plotAreaSqm: true,
          builtUpAreaSqm: true,
          floorAreaSqm: true,
          coverageAreaSqm: true,
          setbackFrontM: true,
          setbackRearM: true,
          setbackLeftM: true,
          setbackRightM: true,
          parkingAreaSqm: true,
          buildingUse: true,
        },
      },
    },
  });
  if (!app) return null;

  return {
    applicationNumber: app.applicationNumber,
    status: app.status,
    district: app.property?.district ?? '',
    plotNo: app.property?.plotNo || undefined,
    applicantName: app.applicant?.name ?? undefined,
    ltpName: app.ltp.name,
    firm: app.ltp.firmName ?? undefined,
    building: {
      numFloors: app.building?.numFloors ?? 1,
      numBasements: app.building?.numBasements ?? 0,
      numDwellingUnits: app.building?.numDwellingUnits ?? 0,
      buildingHeightM: app.building?.buildingHeightM ?? 0,
      plotAreaSqm: app.building?.plotAreaSqm ?? null,
      builtUpAreaSqm: app.building?.builtUpAreaSqm ?? null,
      floorAreaSqm: app.building?.floorAreaSqm ?? null,
      coverageAreaSqm: app.building?.coverageAreaSqm ?? null,
      setbackFrontM: app.building?.setbackFrontM ?? 0,
      setbackRearM: app.building?.setbackRearM ?? 0,
      setbackLeftM: app.building?.setbackLeftM ?? 0,
      setbackRightM: app.building?.setbackRightM ?? 0,
      parkingAreaSqm: app.building?.parkingAreaSqm ?? 0,
      buildingUse: app.building?.buildingUse ?? '',
    },
  };
}

/** Statuses at which the department has, by construction, looked at the file. */
const ACCEPTED_STATUSES = new Set(['APPROVED', 'ORDER_ISSUED', 'CLOSED']);

export async function backfillBim(
  prisma: PrismaClient,
  opts: { apply: boolean; log?: (line: string) => void }
): Promise<{ candidates: number; written: number }> {
  const log = opts.log ?? console.log;

  const apps = await prisma.application.findMany({
    where: { deletedAt: null, bim: null },
    select: { id: true, applicationNumber: true, status: true, ltpUserId: true, submittedAt: true },
    orderBy: { createdAt: 'asc' },
  });

  log(`  ${apps.length} application${apps.length === 1 ? '' : 's'} without BIM particulars.`);
  if (!opts.apply) return { candidates: apps.length, written: 0 };

  const { getHandler } = await import('../../../src/server/jobs/handlers');
  const scan = getHandler('SCAN_FILE');

  let written = 0;
  for (const app of apps) {
    const source = await loadBimSource(prisma, app.id);
    if (!source) continue;

    const demo = demoBimFor(source);
    const bytes = Buffer.from(demo.ifcText, 'utf8');
    const isDraft = app.status === 'DRAFT';

    // The file first, through the real pipeline.
    const stored = await storeUpload({
      applicationId: app.id,
      kind: 'bim',
      file: { name: demo.fileName, type: 'application/octet-stream', bytes },
      uploadedById: app.ltpUserId,
      allowedExtensions: ['ifc'],
    });
    const facts = readIfc(bytes, 'ifc');

    // Clear the scan now rather than leave the file undownloadable until a
    // worker runs. The handler decides CLEAN or SKIPPED exactly as it would.
    if (scan) await scan({ id: '', type: 'SCAN_FILE', payload: { fileObjectId: stored.id }, attempts: 1 } as unknown as ClaimedJob);

    const approver = ACCEPTED_STATUSES.has(app.status)
      ? await prisma.workflowHistory.findFirst({
          where: { instance: { applicationId: app.id }, actorId: { not: null } },
          orderBy: { sequence: 'desc' },
          select: { actorId: true, occurredAt: true },
        })
      : null;

    await prisma.$transaction(async (tx) => {
      const model = await tx.bimModel.create({
        data: {
          applicationId: app.id,
          kind: 'IFC_MODEL',
          discipline: 'FEDERATED',
          title: `${app.applicationNumber} — federated model`,
          currentVersionNo: 1,
        },
        select: { id: true },
      });

      await tx.bimModelVersion.create({
        data: {
          bimModelId: model.id,
          versionNo: 1,
          fileObjectId: stored.id,
          remarks: 'Federated model, exported with the drawings.',
          ifcFacts: facts as object,
          uploadedById: app.ltpUserId,
          uploadedAt: app.submittedAt ?? new Date(),
          isActive: true,
        },
      });

      await tx.bimSubmission.create({
        data: {
          applicationId: app.id,
          ...demo.particulars,
          clashDetectionDate: app.submittedAt ?? null,
          declaredAt: isDraft ? null : (app.submittedAt ?? new Date()),
          declaredById: isDraft ? null : app.ltpUserId,
          ...(approver?.actorId
            ? {
                reviewStatus: 'ACCEPTED',
                reviewRemarks: 'Model reconciled with the sanctioned drawings. No discrepancies.',
                reviewedAt: approver.occurredAt,
                reviewedById: approver.actorId,
              }
            : {}),
        },
      });
    });

    written += 1;
    if (written % 10 === 0) log(`    ${written}/${apps.length}`);
  }

  log(`  BIM written for ${written} application${written === 1 ? '' : 's'}.`);
  return { candidates: apps.length, written };
}
