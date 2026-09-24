import 'server-only';
import { prisma } from '@/server/db/prisma';
import { ORDER_STATUS, orderStatusLabel } from '@/lib/approval-orders';

/**
 * PUBLIC VERIFICATION — what a stranger may learn about an application.
 *
 * ── This file is a whitelist, and that is the whole design ──────────────
 *
 * Every other read path in this system starts from "who is asking" and narrows
 * by scope. This one has no asker. There is no session, no role and no
 * jurisdiction to narrow by, so the only safe construction is the opposite
 * one: name the handful of fields that may leave, build the response from
 * those fields ONLY, and never spread a database row into the result.
 *
 * That is why nothing here does `...application`. A spread would mean the next
 * column somebody adds to `applications` becomes public the day it is added,
 * silently, and the failure would be invisible until it mattered.
 *
 * ── What is deliberately NOT returned ───────────────────────────────────
 *
 *   · Officer names, remarks, internal notes and every audit row.
 *   · The workflow stage, the desk holding it, and who it is assigned to.
 *   · Fee amounts, demands and payment references.
 *   · Shortfall text — the department's objections to somebody's building are
 *     between the department and the applicant.
 *   · The applicant's address, phone and email. The OWNER'S NAME is returned
 *     only for an ISSUED permission, because a granted permission is a public
 *     act and the name on it is the point of verifying one.
 *   · Anything at all about an application that has not been decided beyond
 *     the fact that it exists and is under process.
 *
 * ── Status is COARSENED, not passed through ─────────────────────────────
 *
 * The internal vocabulary has forty-odd statuses and several of them name a
 * desk or an objection ("TPA — fee shortfall"). Publishing those would leak
 * the department's internal handling of a file to anybody with an application
 * number. `publicStatus` maps all of them onto five words the public can act
 * on, and an unrecognised status maps to "Under process" rather than falling
 * through to itself.
 */

/** The only five things this system will say publicly about a file. */
export const PUBLIC_STATUS = {
  UNDER_PROCESS: 'UNDER_PROCESS',
  WITH_APPLICANT: 'WITH_APPLICANT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NOT_SUBMITTED: 'NOT_SUBMITTED',
} as const;

export type PublicStatus = (typeof PUBLIC_STATUS)[keyof typeof PUBLIC_STATUS];

export const PUBLIC_STATUS_LABELS: Record<PublicStatus, string> = {
  UNDER_PROCESS: 'Under process',
  WITH_APPLICANT: 'Awaiting applicant response',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  NOT_SUBMITTED: 'Not yet submitted',
};

/**
 * Maps an internal status onto the public vocabulary.
 *
 * The default is UNDER_PROCESS, and the direction matters: a status this
 * function has never heard of is treated as "still going", which says nothing
 * it should not. Falling through to the raw value would publish the internal
 * name of whatever state somebody added last week.
 */
export function publicStatus(status: string): PublicStatus {
  if (status === 'APPROVED') return PUBLIC_STATUS.APPROVED;
  if (status === 'REJECTED') return PUBLIC_STATUS.REJECTED;
  if (status === 'DRAFT') return PUBLIC_STATUS.NOT_SUBMITTED;

  // Parked with the applicant. Named as a family rather than listed, because
  // every desk has its own shortfall status and a new desk would add more.
  if (
    status.includes('SHORTFALL') ||
    status === 'RETURNED_TO_APPLICANT' ||
    status === 'SHORTFALL_RESPONDED'
  ) {
    return PUBLIC_STATUS.WITH_APPLICANT;
  }

  return PUBLIC_STATUS.UNDER_PROCESS;
}

export const publicStatusLabel = (status: PublicStatus): string => PUBLIC_STATUS_LABELS[status];

export type PublicRecord = {
  applicationNumber: string;
  permissionType: string;
  submittedOn: string | null;
  status: PublicStatus;
  statusLabel: string;
  approvedOn: string | null;
  /** The BPO / proceeding number. Only ever populated for an ISSUED order. */
  proceedingNumber: string | null;
  orderStatus: string | null;
  orderStatusLabel: string | null;
  validUntil: string | null;
  /** Only for an ISSUED permission — a granted permission is a public act. */
  ownerName: string | null;
  /** Locality and district only. Never the door number. */
  locality: string | null;
  isRevoked: boolean;
};

/**
 * Looks a file up by application number, proceeding number or verification code.
 *
 * One function for all three because they are the three things a person might
 * be holding: the acknowledgement, the permission, or the QR link on it. The
 * lookup is exact and case-insensitive; there is deliberately NO partial match
 * and no listing endpoint, because a public search that accepted a prefix
 * would let somebody enumerate every permission in the district.
 */
export async function findPublicRecord(reference: string): Promise<PublicRecord | null> {
  const query = reference.trim();

  // Short references are refused outright rather than searched. An application
  // number is ~15 characters and a verification code is 32; anything under six
  // is somebody testing what the box does.
  if (query.length < 6 || query.length > 64) return null;

  const application = await prisma.application.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { applicationNumber: { equals: query, mode: 'insensitive' } },
        { approvalOrder: { orderNumber: { equals: query, mode: 'insensitive' } } },
        { approvalOrder: { verificationCode: { equals: query } } },
      ],
    },
    // Named fields only. Never a spread — see the note at the top of this file.
    select: {
      applicationNumber: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      applicationType: { select: { name: true } },
      applicant: { select: { name: true } },
      property: { select: { localityName: true, district: true } },
      approvalOrder: {
        select: {
          orderNumber: true,
          status: true,
          validUntil: true,
          revokedAt: true,
        },
      },
    },
  });

  if (!application) return null;

  const order = application.approvalOrder;

  // An order that has not been ISSUED does not exist as far as the public is
  // concerned. A draft permission number quoted to a builder is a permission
  // number as far as the builder is concerned.
  const released = order != null && order.status === ORDER_STATUS.ISSUED;
  const state = publicStatus(application.status);

  return {
    applicationNumber: application.applicationNumber,
    permissionType: application.applicationType.name,
    submittedOn: application.submittedAt?.toISOString() ?? null,
    status: state,
    statusLabel: publicStatusLabel(state),
    approvedOn: application.approvedAt?.toISOString() ?? null,
    proceedingNumber: released ? order.orderNumber : null,
    orderStatus: released ? order.status : null,
    orderStatusLabel: released ? orderStatusLabel(order.status) : null,
    validUntil: released ? (order.validUntil?.toISOString() ?? null) : null,
    ownerName: released ? (application.applicant?.name ?? null) : null,
    // Enough to confirm you are looking at the right plot, not enough to find
    // the house. A verifier already knows the address; they are checking the
    // permission against it.
    locality: released
      ? [application.property?.localityName, application.property?.district]
          .filter(Boolean)
          .join(', ') || null
      : null,
    isRevoked: Boolean(order?.revokedAt),
  };
}
