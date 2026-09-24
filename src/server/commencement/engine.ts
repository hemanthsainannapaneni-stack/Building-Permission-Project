import 'server-only';
import type { Tx } from '@/server/db/prisma';
import { audit } from '@/server/services/audit';
import { formatNumber, nextSequence } from '@/server/services/numbering';
import { businessRule, conflict } from '@/server/http/errors';
import {
  COMMENCEMENT_DOCUMENT_LABEL,
  commencementBlocker,
  commencementDateProblem,
  missingCommencementDocuments,
  type CommencementDocument,
  type Contractor,
} from '@/lib/commencement';

/**
 * THE WRITE BEHIND NOTIFY_WORK_COMMENCEMENT.
 *
 * Called only from the workflow effect WORK_COMMENCEMENT, inside the
 * transition's transaction — the arrangement show cause, revocation and the
 * change of professional use. So every commencement on record is provably
 * attached to a recorded workflow step: there is no other code path that
 * writes `work_commencements`.
 *
 * The guards have already required an ISSUED order and no earlier notice.
 * What is checked again here is what the guards cannot see: the particulars
 * the professional supplied, measured against the order they work under.
 */

type Actor = { id: string; name: string; roleKeys?: string[] };
type Meta = { ip: string; userAgent: string; correlationId?: string };

export type CommencementCtx = {
  tx: Tx;
  actor: Actor;
  roleKey: string;
  now: Date;
  meta: Meta;
  application: { id: string; applicationNumber: string; status: string; ltpUserId: string };
  stageCode: string;
  sequence: number;
  remarks: string;
};

export type CommencementPayload = {
  commencementDate?: string;
  contractor?: Partial<Contractor>;
  documents?: CommencementDocument[];
};

export async function notifyWorkCommencement(c: CommencementCtx, payload: CommencementPayload | undefined) {
  const contractor = {
    name: payload?.contractor?.name?.trim() ?? '',
    licenceNo: payload?.contractor?.licenceNo?.trim() ?? '',
    phone: payload?.contractor?.phone?.trim() ?? '',
    address: payload?.contractor?.address?.trim() ?? '',
  };
  const documents = payload?.documents ?? [];
  if (!payload?.commencementDate || contractor.name.length < 2) {
    throw businessRule('Notify commencement from the Work Initiated tab — it needs the commencement date and the contractor.');
  }

  const [order, existing] = await Promise.all([
    c.tx.approvalOrder.findUnique({
      where: { applicationId: c.application.id },
      select: { id: true, orderNumber: true, status: true, issuedAt: true, validUntil: true, revokedAt: true },
    }),
    c.tx.workCommencement.findUnique({ where: { applicationId: c.application.id }, select: { id: true } }),
  ]);
  const blocked = commencementBlocker({
    applicationStatus: c.application.status,
    order,
    alreadyNotified: Boolean(existing),
    now: c.now,
  });
  if (blocked || !order) throw conflict(blocked ?? 'The building permission order has not been issued.');

  const dateProblem = commencementDateProblem(payload.commencementDate, order);
  if (dateProblem) throw businessRule(dateProblem);
  const missing = missingCommencementDocuments(documents.map((d) => d.kind));
  if (missing.length) {
    throw businessRule(`Attach the ${missing.map((k) => COMMENCEMENT_DOCUMENT_LABEL[k].toLowerCase()).join(' and the ')}.`);
  }

  const [applicant, ltp] = await Promise.all([
    c.tx.applicant.findUnique({ where: { applicationId: c.application.id }, select: { name: true, ownerName: true } }),
    c.tx.user.findUniqueOrThrow({ where: { id: c.application.ltpUserId }, select: { id: true, name: true, ltpLicenceNo: true } }),
  ]);
  const ownerName = applicant?.ownerName?.trim() || applicant?.name?.trim() || '';

  const year = c.now.getFullYear();
  const commencementNumber = formatNumber('{prefix}/{year}/{seq:6}', {
    prefix: 'WCN',
    year,
    seq: await nextSequence(c.tx, `WCN-${year}`),
  });
  const commencementDate = new Date(payload.commencementDate.slice(0, 10));

  const row = await c.tx.workCommencement.create({
    data: {
      commencementNumber,
      applicationId: c.application.id,
      approvalOrderId: order.id,
      orderNumber: order.orderNumber,
      orderIssuedAt: order.issuedAt,
      orderValidUntil: order.validUntil,
      ownerName,
      ltpUserId: ltp.id,
      ltpName: ltp.name,
      ltpLicenceNo: ltp.ltpLicenceNo ?? '',
      contractorName: contractor.name,
      contractorLicenceNo: contractor.licenceNo,
      contractorPhone: contractor.phone,
      contractorAddress: contractor.address,
      commencementDate,
      notifiedAt: c.now,
      documents: documents as never,
      remarks: c.remarks,
      notifiedById: c.actor.id,
      notifiedByName: c.actor.name,
      notifiedByRoleKey: c.roleKey,
      stageCode: c.stageCode,
      workflowSequence: c.sequence,
    },
    select: { id: true },
  });

  await audit(c.tx, {
    actor: { id: c.actor.id, name: c.actor.name, roleKeys: [c.roleKey] },
    action: 'WORK_COMMENCEMENT_NOTIFIED',
    entityType: 'WorkCommencement',
    entityId: row.id,
    applicationId: c.application.id,
    after: {
      commencementNumber,
      orderNumber: order.orderNumber,
      commencementDate: commencementDate.toISOString().slice(0, 10),
      contractor,
      ownerName,
      professional: { id: ltp.id, name: ltp.name, licenceNo: ltp.ltpLicenceNo ?? '' },
      documents: documents.map((d) => ({ kind: d.kind, fileObjectId: d.fileObjectId, fileName: d.fileName, isDemo: d.isDemo })),
      stageCode: c.stageCode,
      workflowSequence: c.sequence,
    },
    remarks: c.remarks,
    ...c.meta,
  });

  return { commencementId: row.id, commencementNumber, commencementDate: commencementDate.toISOString().slice(0, 10) };
}
