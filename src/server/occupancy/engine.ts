import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Tx } from '@/server/db/prisma';
import { audit } from '@/server/services/audit';
import { formatNumber, nextSequence } from '@/server/services/numbering';
import { businessRule, conflict } from '@/server/http/errors';
import { addressee, createOutwardEntry } from '@/server/proceedings/engine';
import { ROLES } from '@/lib/constants';
import { deriveCoveragePercent, deriveFsi } from '@/lib/approval-orders';
import {
  AS_BUILT_PARAMETERS,
  DEFAULT_OCCUPANCY_CONDITIONS,
  INSPECTION_RECOMMENDATIONS,
  NEXT_STEPS,
  OCCUPANCY_DOCUMENT_LABEL,
  OCCUPANCY_STEP_CAPABILITY,
  REVIEW_RECOMMENDATIONS,
  compareAsBuilt,
  completionDateProblem,
  deviationsOf,
  missingOccupancyDocuments,
  occupancyBlocker,
  statusAfterInspection,
  type AsBuiltFigures,
  type InspectionRecommendation,
  type OccupancyDocument,
  type OccupancyPhoto,
  type OccupancyStatus,
  type ReviewRecommendation,
} from '@/lib/occupancy';

/**
 * THE WRITES BEHIND THE OCCUPANCY TRANSITIONS.
 *
 * Called only from the workflow effect OCCUPANCY, inside the transition's
 * transaction — the arrangement every post-approval branch uses. So every
 * occupancy application, inspection, recommendation, decision and certificate
 * is provably attached to a recorded workflow step by a named person.
 *
 * The guards have ordered the steps. What is checked here is what the guards
 * cannot see: the particulars supplied, against the permission and the work
 * they complete. Nothing is deleted; each step is an event and an audit row.
 */

type Actor = { id: string; name: string; roleKeys?: string[] };
type Meta = { ip: string; userAgent: string; correlationId?: string };

export type OccupancyCtx = {
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

const inCapacity = (actor: Actor, roleKey: string) => ({ id: actor.id, name: actor.name, roleKeys: [roleKey] });
const docs = (v: unknown): OccupancyDocument[] => (Array.isArray(v) ? (v as OccupancyDocument[]) : []);
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The departmental roles holding the next step's capability, as the DATABASE grants them. */
export async function deskFor(tx: Tx, status: OccupancyStatus): Promise<string> {
  const steps = NEXT_STEPS[status];
  if (!steps.length) return '';
  const caps = [...new Set(steps.map((s) => OCCUPANCY_STEP_CAPABILITY[s]))];
  const roles = await tx.role.findMany({
    where: { key: { not: ROLES.SYSTEM_ADMIN }, permissions: { some: { permission: { key: { in: caps } } } } },
    orderBy: { rank: 'asc' },
    select: { key: true },
  });
  return roles.map((r) => r.key).join(',');
}

/**
 * The sanctioned figures, from the building permission order's snapshot —
 * what was actually permitted, frozen when the order was drawn up. A file
 * whose snapshot lacks a figure falls back to the filed building details.
 */
export async function approvedFiguresOf(tx: Tx, applicationId: string, snapshot: unknown): Promise<AsBuiltFigures> {
  const s = (snapshot ?? {}) as { building?: Record<string, unknown>; derived?: { fsi?: number | null; coveragePercent?: number | null } };
  const live = await tx.buildingDetail.findUnique({ where: { applicationId } });
  const b = { ...(live ?? {}), ...(s.building ?? {}) } as Record<string, unknown>;
  const building = {
    plotAreaSqm: num(b.plotAreaSqm),
    builtUpAreaSqm: num(b.builtUpAreaSqm),
    floorAreaSqm: num(b.floorAreaSqm),
    coverageAreaSqm: num(b.coverageAreaSqm),
    achievedFar: num(b.achievedFar),
    achievedCoverage: num(b.achievedCoverage),
  };
  const setbacks = [b.setbackFrontM, b.setbackRearM, b.setbackLeftM, b.setbackRightM].map(num).filter((v): v is number => v != null);
  return {
    plotAreaSqm: building.plotAreaSqm,
    builtUpAreaSqm: building.builtUpAreaSqm,
    coveragePercent: s.derived?.coveragePercent ?? deriveCoveragePercent(building),
    fsi: s.derived?.fsi ?? deriveFsi(building),
    heightM: num(b.buildingHeightM),
    floors: num(b.numFloors),
    setbackMinM: setbacks.length ? Math.min(...setbacks) : null,
    parkingAreaSqm: num(b.parkingAreaSqm),
  };
}

async function event(c: OccupancyCtx, occupancyId: string, action: string, fromStatus: string, toStatus: string, remarks: string) {
  await c.tx.occupancyEvent.create({
    data: { occupancyId, action, fromStatus, toStatus, actorId: c.actor.id, actorName: c.actor.name, actorRoleKey: c.roleKey, remarks, occurredAt: c.now },
  });
}

async function current(c: OccupancyCtx, status: OccupancyStatus, id?: string) {
  const row = await c.tx.occupancyApplication.findFirst({
    where: { applicationId: c.application.id, isCurrent: true, status, ...(id ? { id } : {}) },
  });
  if (!row) throw conflict('That occupancy application has already moved on. Reload to see where it stands.', 'STALE_WRITE');
  return row;
}

/** Moves the current application from → to, with its event and audit row. */
async function advance(
  c: OccupancyCtx,
  row: { id: string; occupancyNumber: string },
  from: OccupancyStatus,
  to: OccupancyStatus,
  data: Record<string, unknown>,
  eventAction: string,
  auditAction: string,
  after: Record<string, unknown> = {}
) {
  const desk = await deskFor(c.tx, to);
  const { count } = await c.tx.occupancyApplication.updateMany({
    where: { id: row.id, status: from },
    data: { ...data, status: to, currentDeskRoleKey: desk },
  });
  if (!count) throw conflict('Somebody else acted on this occupancy application just now. Reload to see what changed.', 'STALE_WRITE');
  await event(c, row.id, eventAction, from, to, c.remarks);
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: auditAction,
    entityType: 'OccupancyApplication',
    entityId: row.id,
    applicationId: c.application.id,
    before: { status: from },
    after: { status: to, occupancyNumber: row.occupancyNumber, nextDesk: desk, workflowSequence: c.sequence, ...after },
    remarks: c.remarks,
    ...c.meta,
  });
  return { occupancyId: row.id, occupancyNumber: row.occupancyNumber, status: to };
}

// ═══════════════════════════════════════════════════════════════════════════
// Completion intimation + occupancy submission
// ═══════════════════════════════════════════════════════════════════════════

export type SubmitPayload = { completionDate?: string; completionRemarks?: string; documents?: OccupancyDocument[] };

export async function submitOccupancy(c: OccupancyCtx, payload: SubmitPayload | undefined) {
  const documents = (payload?.documents ?? []).map((d) => ({ ...d, round: 1 }));
  if (!payload?.completionDate) throw businessRule('Intimate completion from the Occupancy tab — it needs the completion date and the documents.');

  const [order, wc, open, issued] = await Promise.all([
    c.tx.approvalOrder.findUnique({
      where: { applicationId: c.application.id },
      select: { id: true, orderNumber: true, status: true, revokedAt: true, snapshot: true },
    }),
    c.tx.workCommencement.findUnique({ where: { applicationId: c.application.id }, select: { commencementNumber: true, commencementDate: true } }),
    c.tx.occupancyApplication.findFirst({
      where: { applicationId: c.application.id, status: { notIn: ['REJECTED', 'CERTIFICATE_ISSUED'] } },
      select: { occupancyNumber: true },
    }),
    c.tx.occupancyApplication.count({ where: { applicationId: c.application.id, status: 'CERTIFICATE_ISSUED' } }),
  ]);
  // The workflow row decides whether commencement is required (its
  // `work_initiated` guard). Here: if a notice exists, completion must follow it.
  const blocked = occupancyBlocker({
    applicationStatus: c.application.status,
    order,
    commencementDate: wc?.commencementDate ?? null,
    requiresCommencement: false,
    openOccupancyNumber: open?.occupancyNumber ?? null,
    certificateIssued: issued > 0,
    now: c.now,
  });
  if (blocked || !order) throw conflict(blocked ?? 'The building permission order has not been issued.');
  const dateProblem = completionDateProblem(payload.completionDate, wc?.commencementDate ?? null, c.now);
  if (dateProblem) throw businessRule(dateProblem);
  const missing = missingOccupancyDocuments(documents.map((d) => d.kind));
  if (missing.length) throw businessRule(`Attach the ${missing.map((k) => OCCUPANCY_DOCUMENT_LABEL[k].toLowerCase()).join(' and the ')}.`);

  const [applicant, ltp, approvedFigures] = await Promise.all([
    c.tx.applicant.findUnique({ where: { applicationId: c.application.id }, select: { name: true, ownerName: true } }),
    c.tx.user.findUniqueOrThrow({ where: { id: c.application.ltpUserId }, select: { id: true, name: true, ltpLicenceNo: true } }),
    approvedFiguresOf(c.tx, c.application.id, order.snapshot),
  ]);

  const year = c.now.getFullYear();
  const occupancyNumber = formatNumber('{prefix}/{year}/{seq:6}', { prefix: 'OCC', year, seq: await nextSequence(c.tx, `OCC-${year}`) });
  // An earlier, rejected application stays on record; it is simply no longer current.
  await c.tx.occupancyApplication.updateMany({ where: { applicationId: c.application.id, isCurrent: true }, data: { isCurrent: false } });
  const desk = await deskFor(c.tx, 'SUBMITTED');

  const row = await c.tx.occupancyApplication.create({
    data: {
      occupancyNumber,
      applicationId: c.application.id,
      status: 'SUBMITTED',
      approvalOrderId: order.id,
      orderNumber: order.orderNumber,
      commencementNumber: wc?.commencementNumber ?? '',
      commencementDate: wc?.commencementDate ?? null,
      ownerName: applicant?.ownerName?.trim() || applicant?.name?.trim() || '',
      ltpUserId: ltp.id,
      ltpName: ltp.name,
      ltpLicenceNo: ltp.ltpLicenceNo ?? '',
      approvedFigures: approvedFigures as never,
      completionDate: new Date(payload.completionDate.slice(0, 10)),
      completionRemarks: payload.completionRemarks?.trim() ?? '',
      documents: documents as never,
      submittedById: c.actor.id,
      submittedByName: c.actor.name,
      submittedAt: c.now,
      currentDeskRoleKey: desk,
    },
    select: { id: true },
  });

  await event(c, row.id, 'SUBMITTED', '', 'SUBMITTED', payload.completionRemarks?.trim() || `Completion on ${payload.completionDate.slice(0, 10)} intimated.`);
  await audit(c.tx, {
    actor: inCapacity(c.actor, c.roleKey),
    action: 'OCCUPANCY_SUBMITTED',
    entityType: 'OccupancyApplication',
    entityId: row.id,
    applicationId: c.application.id,
    after: {
      occupancyNumber,
      status: 'SUBMITTED',
      orderNumber: order.orderNumber,
      commencementNumber: wc?.commencementNumber ?? '',
      completionDate: payload.completionDate.slice(0, 10),
      documents: documents.map((d) => ({ kind: d.kind, fileObjectId: d.fileObjectId, fileName: d.fileName, isDemo: d.isDemo })),
      workflowSequence: c.sequence,
    },
    remarks: payload.completionRemarks ?? '',
    ...c.meta,
  });
  return { occupancyId: row.id, occupancyNumber, status: 'SUBMITTED' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Final inspection
// ═══════════════════════════════════════════════════════════════════════════

export type SchedulePayload = { occupancyId?: string; scheduledFor?: string; inspectorId?: string };

export async function scheduleFinalInspection(c: OccupancyCtx, payload: SchedulePayload | undefined) {
  const row = await current(c, 'SUBMITTED', payload?.occupancyId);
  if (!payload?.scheduledFor || !payload.inspectorId) throw businessRule('Name the inspector and the inspection date.');
  const when = new Date(payload.scheduledFor);
  if (Number.isNaN(when.getTime())) throw businessRule('Enter a valid inspection date.');
  if (when.getTime() < new Date(row.completionDate.toISOString().slice(0, 10)).getTime()) {
    throw businessRule('The final inspection cannot be before the completion date.');
  }
  const inspector = await c.tx.user.findFirst({
    where: {
      id: payload.inspectorId,
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { permissions: { some: { permission: { key: OCCUPANCY_STEP_CAPABILITY.INSPECT } } } } } },
    },
    select: { id: true, name: true },
  });
  if (!inspector) throw businessRule('The inspector must be an active officer of a desk that conducts final inspections.');

  await c.tx.occupancyInspection.create({
    data: {
      occupancyId: row.id,
      applicationId: c.application.id,
      round: row.round,
      scheduledFor: when,
      inspectorId: inspector.id,
      inspectorName: inspector.name,
      scheduledByName: c.actor.name,
      scheduledAt: c.now,
    },
  });
  return advance(c, row, 'SUBMITTED', 'INSPECTION_PENDING', {}, 'INSPECTION_SCHEDULED', 'OCCUPANCY_INSPECTION_SCHEDULED', {
    round: row.round,
    scheduledFor: when.toISOString(),
    inspector: inspector.name,
  });
}

export type InspectPayload = {
  occupancyId?: string;
  inspectionDate?: string;
  siteCondition?: string;
  actualConstruction?: string;
  approvedConstruction?: string;
  deviations?: string;
  photos?: OccupancyPhoto[];
  recommendation?: string;
  asBuilt?: AsBuiltFigures;
  asBuiltSource?: 'MEASURED' | 'DEMO';
};

export async function recordFinalInspection(c: OccupancyCtx, payload: InspectPayload | undefined) {
  const row = await current(c, 'INSPECTION_PENDING', payload?.occupancyId);
  const recommendation = payload?.recommendation as InspectionRecommendation;
  if (!(INSPECTION_RECOMMENDATIONS as readonly string[]).includes(recommendation)) {
    throw businessRule('Record the inspection’s recommendation: Recommended, Shortfall or Reject.');
  }
  if (!payload?.inspectionDate || !payload.siteCondition?.trim() || !payload.actualConstruction?.trim()) {
    throw businessRule('Record the inspection date, the site condition and the construction found.');
  }
  const inspectedAt = new Date(payload.inspectionDate);
  if (Number.isNaN(inspectedAt.getTime()) || inspectedAt.getTime() > c.now.getTime() + 86_400_000) {
    throw businessRule('The inspection date cannot be in the future.');
  }
  if (inspectedAt.getTime() < new Date(row.completionDate.toISOString().slice(0, 10)).getTime()) {
    throw businessRule('The inspection cannot precede the completion date.');
  }
  const inspection = await c.tx.occupancyInspection.findUnique({ where: { occupancyId_round: { occupancyId: row.id, round: row.round } } });
  if (!inspection || inspection.status !== 'SCHEDULED') throw conflict('No scheduled inspection for this round.', 'STALE_WRITE');

  // Only known parameters, only numbers.
  const asBuilt: AsBuiltFigures = {};
  for (const p of AS_BUILT_PARAMETERS) asBuilt[p.key] = num(payload.asBuilt?.[p.key]);
  const deviations = deviationsOf(compareAsBuilt(row.approvedFigures as AsBuiltFigures, asBuilt));

  await c.tx.occupancyInspection.update({
    where: { id: inspection.id },
    data: {
      status: 'COMPLETED',
      inspectedAt,
      siteCondition: payload.siteCondition.trim(),
      actualConstruction: payload.actualConstruction.trim(),
      approvedConstruction: payload.approvedConstruction?.trim() ?? '',
      deviations: payload.deviations?.trim() ?? '',
      remarks: c.remarks,
      photos: (payload.photos ?? []) as never,
      recommendation,
      asBuiltFigures: asBuilt as never,
      asBuiltSource: payload.asBuiltSource === 'DEMO' ? 'DEMO' : 'MEASURED',
    },
  });

  const to = statusAfterInspection(recommendation);
  const shortfall =
    to === 'SHORTFALL'
      ? {
          shortfallItems: (payload.deviations?.split('\n').map((l) => l.trim()).filter(Boolean) ?? []) as never,
          shortfallRemarks: c.remarks,
          shortfallRaisedByName: c.actor.name,
          shortfallRaisedAt: c.now,
          shortfallResponse: '',
          shortfallRespondedAt: null,
        }
      : {};
  return advance(c, row, 'INSPECTION_PENDING', to, shortfall, 'INSPECTED', 'OCCUPANCY_INSPECTED', {
    round: row.round,
    recommendation,
    deviationsFound: deviations.map((d) => d.key),
    asBuiltSource: payload.asBuiltSource === 'DEMO' ? 'DEMO' : 'MEASURED',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// As-built review: recommend, or raise a shortfall
// ═══════════════════════════════════════════════════════════════════════════

export async function recommendOccupancy(c: OccupancyCtx, payload: { occupancyId?: string; recommendation?: string } | undefined) {
  const row = await current(c, 'INSPECTION_COMPLETED', payload?.occupancyId);
  const recommendation = payload?.recommendation as ReviewRecommendation;
  if (!(REVIEW_RECOMMENDATIONS as readonly string[]).includes(recommendation)) throw businessRule('Recommend approval or rejection.');
  return advance(
    c,
    row,
    'INSPECTION_COMPLETED',
    'RECOMMENDED',
    { recommendation, recommendationNotes: c.remarks, reviewedById: c.actor.id, reviewedByName: c.actor.name, reviewedByRoleKey: c.roleKey, reviewedAt: c.now },
    'RECOMMENDED',
    'OCCUPANCY_RECOMMENDED',
    { recommendation }
  );
}

export async function raiseOccupancyShortfall(c: OccupancyCtx, payload: { occupancyId?: string; items?: string[] } | undefined) {
  const row = await current(c, 'INSPECTION_COMPLETED', payload?.occupancyId);
  const items = (payload?.items ?? []).map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw businessRule('List at least one thing the applicant must put right.');
  return advance(
    c,
    row,
    'INSPECTION_COMPLETED',
    'SHORTFALL',
    {
      shortfallItems: items as never,
      shortfallRemarks: c.remarks,
      shortfallRaisedByName: c.actor.name,
      shortfallRaisedAt: c.now,
      shortfallResponse: '',
      shortfallRespondedAt: null,
      reviewedById: c.actor.id,
      reviewedByName: c.actor.name,
      reviewedByRoleKey: c.roleKey,
      reviewedAt: c.now,
    },
    'SHORTFALL_RAISED',
    'OCCUPANCY_SHORTFALL_RAISED',
    { items }
  );
}

export async function respondToOccupancyShortfall(c: OccupancyCtx, payload: { occupancyId?: string; documents?: OccupancyDocument[] } | undefined) {
  const row = await current(c, 'SHORTFALL', payload?.occupancyId);
  const round = row.round + 1;
  const added = (payload?.documents ?? []).map((d) => ({ ...d, round }));
  return advance(
    c,
    row,
    'SHORTFALL',
    'SUBMITTED',
    { round, shortfallResponse: c.remarks, shortfallRespondedAt: c.now, documents: [...docs(row.documents), ...added] as never },
    'SHORTFALL_ANSWERED',
    'OCCUPANCY_SHORTFALL_ANSWERED',
    { round, documents: added.map((d) => ({ kind: d.kind, fileName: d.fileName, isDemo: d.isDemo })) }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Decision and certificate
// ═══════════════════════════════════════════════════════════════════════════

export async function decideOccupancy(c: OccupancyCtx, outcome: 'APPROVED' | 'REJECTED', payload: { occupancyId?: string } | undefined) {
  const row = await current(c, 'RECOMMENDED', payload?.occupancyId);
  return advance(
    c,
    row,
    'RECOMMENDED',
    outcome,
    { decision: outcome, decisionRemarks: c.remarks, decidedById: c.actor.id, decidedByName: c.actor.name, decidedByRoleKey: c.roleKey, decidedAt: c.now },
    outcome,
    outcome === 'APPROVED' ? 'OCCUPANCY_APPROVED' : 'OCCUPANCY_REJECTED',
    { recommendation: row.recommendation }
  );
}

export async function issueOccupancyCertificate(c: OccupancyCtx, payload: { occupancyId?: string } | undefined) {
  const row = await current(c, 'APPROVED', payload?.occupancyId);
  const [inspection, app, order, to] = await Promise.all([
    c.tx.occupancyInspection.findFirst({ where: { occupancyId: row.id, status: 'COMPLETED' }, orderBy: { round: 'desc' } }),
    c.tx.application.findUniqueOrThrow({
      where: { id: c.application.id },
      select: {
        applicationNumber: true,
        zone: { select: { name: true } },
        property: { select: { doorNo: true, streetName: true, localityName: true, plotNo: true, surveyNumbers: true, village: true, mandal: true, district: true } },
        building: { select: { buildingUse: true, occupancyType: true } },
      },
    }),
    c.tx.approvalOrder.findUniqueOrThrow({ where: { id: row.approvalOrderId }, select: { orderNumber: true, issuedAt: true } }),
    addressee(c.tx, c.application.id),
  ]);
  const approved = row.approvedFigures as AsBuiltFigures;
  const asBuilt = (inspection?.asBuiltFigures ?? {}) as AsBuiltFigures;
  const approvedArea = approved.builtUpAreaSqm ?? null;
  const completedArea = asBuilt.builtUpAreaSqm ?? approvedArea;

  const year = c.now.getFullYear();
  const certificateNumber = formatNumber('{prefix}/{year}/{seq:6}', { prefix: 'OC', year, seq: await nextSequence(c.tx, `OC-${year}`) });
  const conditions = [...DEFAULT_OCCUPANCY_CONDITIONS];

  const outward = await createOutwardEntry(
    c.tx,
    {
      applicationId: c.application.id,
      documentType: 'OCCUPANCY_CERTIFICATE',
      documentReference: certificateNumber,
      sourceType: 'OccupancyApplication',
      sourceId: row.id,
      subject: `Occupancy certificate ${certificateNumber} — ${app.applicationNumber}`,
      recipient: to.recipient,
      address: to.address,
      status: 'READY_FOR_DISPATCH',
    },
    { actor: c.actor, roleKey: c.roleKey, now: c.now, meta: c.meta }
  );

  const p = app.property;
  const snapshot = {
    certificateNumber,
    issuedAt: c.now.toISOString(),
    issuedBy: { name: c.actor.name, roleKey: c.roleKey },
    verificationCode: randomBytes(6).toString('hex').toUpperCase(),
    occupancyNumber: row.occupancyNumber,
    applicationNumber: app.applicationNumber,
    zone: app.zone?.name ?? '',
    orderNumber: order.orderNumber,
    orderIssuedAt: order.issuedAt.toISOString(),
    owner: row.ownerName,
    ltp: { name: row.ltpName, licenceNo: row.ltpLicenceNo },
    site: [p?.doorNo && `D.No ${p.doorNo}`, p?.plotNo && `Plot ${p.plotNo}`, p?.surveyNumbers && `Sy. No. ${p.surveyNumbers}`, p?.streetName, p?.localityName, p?.village, p?.mandal, p?.district]
      .filter(Boolean)
      .join(', '),
    use: [app.building?.buildingUse, app.building?.occupancyType].filter(Boolean).join(' · '),
    commencementDate: row.commencementDate?.toISOString() ?? null,
    completionDate: row.completionDate.toISOString(),
    inspection: inspection ? { inspectedAt: inspection.inspectedAt?.toISOString() ?? null, inspector: inspection.inspectorName, asBuiltSource: inspection.asBuiltSource } : null,
    comparison: compareAsBuilt(approved, asBuilt),
    approvedAreaSqm: approvedArea,
    completedAreaSqm: completedArea,
    conditions,
    outwardNumber: outward.outwardNumber,
  };

  return advance(
    c,
    row,
    'APPROVED',
    'CERTIFICATE_ISSUED',
    {
      certificateNumber,
      certificateIssuedAt: c.now,
      certificateIssuedByName: c.actor.name,
      approvedAreaSqm: approvedArea,
      completedAreaSqm: completedArea,
      certificateConditions: conditions as never,
      certificateSnapshot: snapshot as never,
      outwardEntryId: outward.id,
      outwardNumber: outward.outwardNumber,
    },
    'CERTIFICATE_ISSUED',
    'OCCUPANCY_CERTIFICATE_ISSUED',
    { certificateNumber, outwardNumber: outward.outwardNumber }
  ).then((r) => ({ ...r, certificateNumber, outwardNumber: outward.outwardNumber }));
}
