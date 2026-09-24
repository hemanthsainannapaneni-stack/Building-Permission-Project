import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { audit } from './audit';
import { recordEvent, EVENT_TYPES } from './timeline';
import { emit, EVENTS } from '@/server/events/outbox';
import { conflict, guardFailed, notFound } from '@/server/http/errors';
import { nextSequence, formatNumber } from './numbering';
import { settingString, settingNumber, settingJson } from './settings';
import { applicationScope } from '@/server/auth/scope';
import type { AuthUser } from '@/server/auth/context';
import {
  DEFAULT_CONDITIONS,
  DEFAULT_VALIDITY_YEARS,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  canTransitionOrder,
  orderStatusLabel,
  deriveCoveragePercent,
  deriveFsi,
  deriveNetPlotArea,
  whyNotOrder,
} from '@/lib/approval-orders';

/**
 * The approval order — the document the applicant actually receives.
 *
 * Created by the RENDER_APPROVAL_ORDER job, which the workflow's
 * GENERATE_APPROVAL_ORDER effect enqueues inside the approving transaction. The
 * approval and the order are therefore not the same write: an order that failed
 * to render must never be able to roll back an approval the Commissioner made,
 * and a slow renderer must never be able to make an approval fail.
 *
 * ── The snapshot is the record ───────────────────────────────────────────
 *
 * Everything printed on the order is frozen into `snapshot` at issue time, for
 * the same reason a receipt is: an applicant's name may be corrected, a fee
 * schedule revised or a zone renamed years later, and none of that may alter a
 * permission already granted. The renderer reads the snapshot, never the live
 * tables.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────
 *
 * No PDF, and no signature. Rendering to PDF and a digital signature (DSC /
 * eSign) are separate pieces of work with their own dependencies — see
 * docs/10-open-questions.md S3. `storageKey` and `signatureRef` stay empty
 * rather than being filled with something that looks signed and is not, which
 * on a statutory permission would be the worst possible shortcut.
 */

const DEFAULT_ORDER_FORMAT = '{prefix}/{year}/{seq:5}';

/**
 * Creates the order if the application does not already have one.
 *
 * Idempotent by the unique index on `applicationId`: the job may be retried,
 * and a second run finds the existing row and returns it rather than issuing a
 * second permission for the same file.
 */
export async function ensureApprovalOrder(applicationId: string, issuedById: string) {
  const existing = await prisma.approvalOrder.findUnique({
    where: { applicationId },
    select: { id: true, orderNumber: true, status: true, verificationCode: true },
  });

  if (existing) return existing;

  const application = await prisma.application.findFirstOrThrow({
    where: { id: applicationId },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      approvedAt: true,
      ltpUserId: true,
      applicationType: { select: { code: true, name: true } },
      zone: { select: { code: true, name: true } },
      applicant: { select: { name: true, phone: true, email: true, address: true } },
      property: {
        select: {
          district: true,
          mandal: true,
          village: true,
          localityName: true,
          surveyNumbers: true,
          plotNo: true,
          plotAreaSqm: true,
        },
      },
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
      // The NOCs and clearances actually on the file. Read from the verified
      // document set rather than from a list of expected types: an order that
      // printed "Fire NOC: obtained" because the rule said one was needed
      // would be evidence of something nobody checked.
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
            select: { expiresOn: true, uploadedAt: true },
          },
        },
      },
      fees: {
        where: { status: { in: ['PAID', 'PARTIALLY_PAID'] } },
        select: { demandNumber: true, totalAmount: true, paidAmount: true, paidAt: true },
      },
    },
  });

  // An order is evidence that a permission was granted. Refusing to issue one
  // for an application that is not approved is what stops a retried or
  // mis-enqueued job from manufacturing that evidence.
  if (application.status !== 'APPROVED') {
    throw new Error(
      `Approval order refused: ${application.applicationNumber} is ${application.status}, not APPROVED.`
    );
  }

  const now = new Date();
  const [format, conditions, validityYears] = await Promise.all([
    settingString('approval_order_number_format', DEFAULT_ORDER_FORMAT),
    settingJson<string[]>('approval_order_conditions', [...DEFAULT_CONDITIONS]),
    settingNumber('approval_order_validity_years', DEFAULT_VALIDITY_YEARS),
  ]);

  const building = application.building;
  const fsi = building ? deriveFsi(building) : null;
  const coveragePercent = building ? deriveCoveragePercent(building) : null;
  const netPlot = deriveNetPlotArea(
    building?.plotAreaSqm ?? application.property?.plotAreaSqm ?? null,
    building?.metadata
  );

  const validUntil = new Date(now);
  validUntil.setFullYear(validUntil.getFullYear() + Math.max(1, validityYears));

  return prisma.$transaction(async (tx) => {
    const year = now.getFullYear();
    const prefix = 'BPO';
    const seq = await nextSequence(tx, `order:${prefix}:${year}`);
    const orderNumber = formatNumber(format || DEFAULT_ORDER_FORMAT, { prefix, year, seq });

    // 16 bytes of randomness, rendered as 32 hex characters. This is a public
    // handle — /verify-order/[code] is reachable without signing in — so it
    // must not be guessable from the order number or the date.
    const verificationCode = randomBytes(16).toString('hex');

    const order = await tx.approvalOrder.create({
      data: {
        applicationId: application.id,
        orderNumber,
        // DRAFT, not ISSUED. The permission was granted by the workflow; this
        // row is the DOCUMENT that evidences it, and a document nobody has
        // rendered or looked at has not been issued to anybody. The lifecycle
        // in src/lib/approval-orders.ts carries it the rest of the way.
        status: ORDER_STATUS.DRAFT,
        issuedById,
        issuedAt: now,
        validUntil,
        conditions: conditions as never,
        verificationCode,
        snapshot: {
          orderNumber,
          issuedAt: now.toISOString(),
          validUntil: validUntil.toISOString(),
          application: {
            id: application.id,
            applicationNumber: application.applicationNumber,
            type: application.applicationType.name,
            typeCode: application.applicationType.code,
            approvedAt: application.approvedAt?.toISOString() ?? now.toISOString(),
            zone: application.zone?.name ?? '',
          },
          applicant: application.applicant ?? {},
          property: application.property
            ? {
                ...application.property,
                plotAreaSqm: application.property.plotAreaSqm?.toString() ?? null,
              }
            : {},
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
            : {},
          // Frozen alongside the inputs they came from, so a reader can check
          // the arithmetic on the order itself years later.
          derived: {
            fsi,
            coveragePercent,
            netPlotAreaSqm: netPlot.net,
            deductedAreaSqm: netPlot.deducted,
            /** True when nobody recorded a deduction, so net equals gross. */
            netPlotAssumed: netPlot.isAssumed,
          },
          // Only what is actually on the file and actually verified.
          clearances: application.documents.map((doc) => ({
            code: doc.documentType.code,
            name: doc.documentType.name,
            verifiedAt: doc.verifiedAt?.toISOString() ?? null,
            expiresOn: doc.versions[0]?.expiresOn?.toISOString() ?? null,
          })),
          conditions,
          fees: application.fees.map((f) => ({
            demandNumber: f.demandNumber,
            totalAmount: f.totalAmount.toFixed(2),
            paidAmount: f.paidAmount.toFixed(2),
            paidAt: f.paidAt?.toISOString() ?? null,
          })),
        } as never,
      },
      select: { id: true, orderNumber: true, status: true, verificationCode: true },
    });

    await recordEvent(tx, {
      applicationId: application.id,
      type: EVENT_TYPES.APPLICATION_APPROVED,
      title: 'Approval order drafted',
      description: `Order ${orderNumber} prepared for issue.`,
      metadata: { orderNumber, approvalOrderId: order.id },
      occurredAt: now,
    });

    await audit(tx, {
      action: 'APPROVAL_ORDER_DRAFTED',
      entityType: 'ApprovalOrder',
      entityId: order.id,
      applicationId: application.id,
      after: { orderNumber, status: ORDER_STATUS.DRAFT, issuedById },
    });

    // No ORDER_ISSUED here. Telling an applicant their permission is ready
    // before anybody has rendered or checked it is the one thing this
    // lifecycle exists to prevent — `advanceOrder` emits it on the move to
    // ISSUED, which is the moment the statement becomes true.

    return order;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The lifecycle
// ═══════════════════════════════════════════════════════════════════════════

export type AdvanceInput = {
  orderId: string;
  to: string;
  actor: { id: string; name: string; roleKeys?: string[] };
  remarks?: string;
  meta?: { ip: string; userAgent: string; correlationId?: string };
};

/**
 * Moves an order along its lifecycle, refusing anything the machine forbids.
 *
 * The status is in the WHERE as well as the SET, so two officers clicking at
 * once serialise and the loser is told rather than silently overwriting the
 * winner — the same guard `move()` uses on a shortfall, for the same reason.
 */
export async function advanceOrder(input: AdvanceInput) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const order = await tx.approvalOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        applicationId: true,
        storageKey: true,
        application: {
          select: { applicationNumber: true, status: true, ltpUserId: true },
        },
      },
    });

    if (!order) throw notFound('That approval order could not be found.');

    if (!canTransitionOrder(order.status, input.to)) {
      throw conflict(
        `${order.orderNumber}: ${whyNotOrder(order.status, input.to) ?? 'That is not possible right now.'}`
      );
    }

    // Belt and braces. `ensureApprovalOrder` already refuses to create a row
    // for an application that is not APPROVED, but an application can be
    // rejected or reopened after the draft exists, and an order must never
    // outlive the approval it evidences.
    if (order.application.status !== 'APPROVED') {
      throw guardFailed(
        `${order.orderNumber} cannot move: ${order.application.applicationNumber} is ` +
          `${order.application.status}, not APPROVED.`
      );
    }

    // Issuing a permission with nothing behind it would be issuing a promise
    // of a document rather than the document.
    if (input.to === ORDER_STATUS.ISSUED && !order.storageKey) {
      throw guardFailed(
        `${order.orderNumber} has no rendered document. Generate it before issuing.`
      );
    }

    const moved = await tx.approvalOrder.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status: input.to,
        ...(input.to === ORDER_STATUS.ISSUED ? { issuedAt: now, issuedById: input.actor.id } : {}),
      },
    });

    if (moved.count === 0) {
      throw conflict(
        `${order.orderNumber} has moved on since this screen was loaded. Reload to see where it stands.`
      );
    }

    await audit(tx, {
      actor: input.actor,
      action: `APPROVAL_ORDER_${input.to}`,
      entityType: 'ApprovalOrder',
      entityId: order.id,
      applicationId: order.applicationId,
      before: { status: order.status },
      after: { status: input.to, orderNumber: order.orderNumber },
      remarks: input.remarks ?? '',
      ...(input.meta ?? {}),
    });

    if (input.to === ORDER_STATUS.ISSUED) {
      await recordEvent(tx, {
        applicationId: order.applicationId,
        type: EVENT_TYPES.APPLICATION_APPROVED,
        title: 'Building permission order issued',
        description: `Order ${order.orderNumber} has been issued.`,
        actor: input.actor,
        metadata: { orderNumber: order.orderNumber, approvalOrderId: order.id },
        occurredAt: now,
      });

      await emit(tx, {
        eventCode: EVENTS.ORDER_ISSUED,
        applicationId: order.applicationId,
        payload: {
          applicationNumber: order.application.applicationNumber,
          orderNumber: order.orderNumber,
          ltpUserId: order.application.ltpUserId,
        },
      });
    }

    return { id: order.id, orderNumber: order.orderNumber, status: input.to };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading
// ═══════════════════════════════════════════════════════════════════════════

export type ApprovalOrderView = NonNullable<Awaited<ReturnType<typeof getApprovalOrder>>>;

/**
 * The order on one application, as the officer's panel shows it.
 *
 * Scope is merged into the WHERE through `applicationScope`, so an order on
 * somebody else's application is "not there" rather than forbidden — the same
 * answer every other read path in this system gives, and for the same reason.
 *
 * Returns null rather than throwing when there is no order: an application
 * that has not been approved legitimately has none, and that is the commonest
 * case on the screen this feeds.
 */
export async function getApprovalOrder(user: AuthUser, applicationId: string) {
  const order = await prisma.approvalOrder.findFirst({
    where: {
      applicationId,
      application: { deletedAt: null, ...applicationScope(user) },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      issuedAt: true,
      validUntil: true,
      conditions: true,
      storageKey: true,
      snapshot: true,
      verificationCode: true,
      revokedAt: true,
      revokeReason: true,
      applicationId: true,
      application: { select: { applicationNumber: true, status: true } },
    },
  });

  if (!order) return null;

  const snapshot = (order.snapshot ?? {}) as Record<string, unknown>;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: orderStatusLabel(order.status),
    issuedAt: order.issuedAt,
    validUntil: order.validUntil,
    conditions: Array.isArray(order.conditions) ? (order.conditions as string[]) : [],
    /** Whether a rendered document exists to look at. */
    hasDocument: Boolean(order.storageKey),
    // The verification link is printed on the order itself, so an officer
    // looking at the panel can follow exactly what the applicant will.
    verificationCode: order.verificationCode,
    revokedAt: order.revokedAt,
    revokeReason: order.revokeReason,
    applicationId: order.applicationId,
    applicationNumber: order.application.applicationNumber,
    applicationStatus: order.application.status,
    /** What the machine allows from here — the buttons the panel may show. */
    nextStates: ORDER_TRANSITIONS[order.status] ?? [],
    derived: (snapshot.derived ?? {}) as Record<string, unknown>,
    building: (snapshot.building ?? {}) as Record<string, unknown>,
    clearances: (snapshot.clearances ?? []) as Array<Record<string, unknown>>,
    fees: (snapshot.fees ?? []) as Array<Record<string, unknown>>,
  };
}
