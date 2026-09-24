import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { can, isLtp, type AuthUser } from '@/server/auth/context';
import { badRequest, conflict, forbidden, notFound } from '@/server/http/errors';
import { env } from '@/server/config/env';
import { storage } from '@/server/storage';
import { isUuid } from '@/lib/utils';
import { CAPABILITIES, TERMINAL_STATUSES } from '@/lib/constants';
import { stageName } from '@/lib/workflow';
import {
  DEMO_DOCUMENT_NOTE,
  NOC_ACTION_LABEL,
  NOC_ACTION_RESULT,
  NOC_STATUS,
  NOC_STATUS_LABEL,
  OUTSTANDING_NOC_STATUSES,
  REMARKS_REQUIRED,
  canMove,
  isNocStatus,
  nocMoves,
  nocTally,
  verificationProblems,
  type NocAction,
  type NocStatus,
} from '@/lib/noc';
import type {
  ApplicantUpdateInput,
  CreateNocInput,
  OfficerActionInput,
  UpdateNocTypeInput,
} from '@/lib/schemas/nocs';
import { audit } from './audit';
import { storeUpload } from './files';
import { formatNumber, nextSequence } from './numbering';

/**
 * THE NOC SUBSYSTEM.
 *
 *   open (desk or applicant) → applicant records the application to the
 *   authority → applicant records the certificate → the desk verifies,
 *   rejects, raises a shortfall, or rules it out
 *
 * ── Who may do what ──────────────────────────────────────────────────────
 *
 * The APPLICANT (NOC_UPDATE, their own file, while it is open) records what
 * they filed and what came back. They may declare a NOC, which opens it
 * PENDING — undetermined.
 *
 * The DESK (NOC_VERIFY) decides, and only "according to workflow": the file
 * must be AT a stage whose owner roles include one of the caller's roles. A
 * TPA cannot verify a NOC on a file that has moved on to the ZJD, and a ZJD
 * cannot reach down to a file still at the TPA. The stage's owner roles come
 * from the workflow configuration, so a desk added there is a desk that can
 * verify here — provided its role holds the grant.
 *
 * ── Every move is one transaction ────────────────────────────────────────
 *
 * The NOC row, its event row and the audit row commit together. A stale screen
 * — somebody else moved the NOC after it was rendered — gets a 409 rather than
 * a decision taken on a status that no longer holds.
 *
 * ── Nothing here decides applicability ───────────────────────────────────
 *
 * See src/lib/noc.ts. Checklist answers are shown as a hint; the officer's
 * Mark Required / Mark Not Required is the only thing that sets `isRequired`.
 */

type Meta = { ip: string; userAgent: string; correlationId?: string };

const TX_LIMITS = { timeout: 20_000, maxWait: 10_000 } as const;
const NOC_NUMBER_FORMAT = '{prefix}/{year}/{seq:6}';
const DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  currentStageId: true,
  currentStageCode: true,
  ltpUserId: true,
  zone: { select: { name: true } },
  applicant: { select: { name: true, ownerName: true } },
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const NOC_SELECT = {
  id: true,
  nocNumber: true,
  applicationId: true,
  nocTypeId: true,
  status: true,
  isRequired: true,
  authority: true,
  applicationReference: true,
  referenceNumber: true,
  appliedDate: true,
  issuedDate: true,
  expiryDate: true,
  fileObjectId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  isDemoDocument: true,
  documentAddedAt: true,
  verifiedByName: true,
  verifiedByRoleKey: true,
  verifiedAt: true,
  reviewedStageCode: true,
  remarks: true,
  applicantRemarks: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  nocType: { select: { id: true, code: true, name: true, requiresExpiry: true } },
} satisfies Prisma.ApplicationNocSelect;

type NocRow = Prisma.ApplicationNocGetPayload<{ select: typeof NOC_SELECT }>;

/** The actor as the audit chain should name them: in the capacity they acted in. */
const inCapacity = (user: AuthUser, roleKey: string) => ({ id: user.id, name: user.name, roleKeys: [roleKey] });

const hasDocument = (n: { fileObjectId: string | null; isDemoDocument: boolean }) =>
  Boolean(n.fileObjectId) || n.isDemoDocument;

function applicationSummary(app: ApplicationRow) {
  return {
    id: app.id,
    applicationNumber: app.applicationNumber,
    status: app.status,
    currentStageCode: app.currentStageCode,
    currentDesk: stageName(app.currentStageCode),
    zone: app.zone?.name ?? '',
    owner: app.applicant?.ownerName?.trim() || app.applicant?.name?.trim() || '',
  };
}

function view(n: NocRow) {
  return {
    ...n,
    hasDocument: hasDocument(n),
    verificationProblems:
      n.status === NOC_STATUS.RECEIVED
        ? verificationProblems({
            referenceNumber: n.referenceNumber,
            issuedDate: n.issuedDate,
            expiryDate: n.expiryDate,
            hasDocument: hasDocument(n),
            requiresExpiry: n.nocType.requiresExpiry,
          })
        : [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

function requireView(user: AuthUser) {
  if (!can(user, CAPABILITIES.NOC_VIEW)) throw forbidden('Your role does not include NOCs.');
}

const isClosed = (status: string) => (TERMINAL_STATUSES as readonly string[]).includes(status);

/** An application the caller may see, or 404 — the same answer for "not yours". */
async function requireApplication(db: Tx | typeof prisma, user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That application could not be found.');
  const app = await db.application.findFirst({
    where: { id, deletedAt: null, ...applicationScope(user) },
    select: APPLICATION_SELECT,
  });
  if (!app) throw notFound('That application could not be found.');
  return app;
}

async function requireNoc(db: Tx | typeof prisma, user: AuthUser, id: string) {
  if (!isUuid(id)) throw notFound('That NOC could not be found.');
  const row = await db.applicationNoc.findFirst({
    where: { id, application: { deletedAt: null, ...applicationScope(user) } },
    select: { ...NOC_SELECT, application: { select: APPLICATION_SELECT } },
  });
  if (!row) throw notFound('That NOC could not be found.');
  return row;
}

/**
 * Whether the caller may act as the reviewing DESK on this file right now.
 *
 * "According to workflow": the grant, AND the file at a stage whose owner
 * roles include one of the caller's. `reason` is written for the screen.
 */
export async function deskAccess(
  db: Tx | typeof prisma,
  user: AuthUser,
  app: Pick<ApplicationRow, 'status' | 'currentStageId' | 'currentStageCode'>
): Promise<{ ok: boolean; reason: string; roleKey: string }> {
  const refuse = (reason: string) => ({ ok: false, reason, roleKey: '' });
  if (!can(user, CAPABILITIES.NOC_VERIFY)) return refuse('');
  if (isClosed(app.status)) return refuse('This application has been decided. Its NOCs are a closed record.');
  if (!app.currentStageId) return refuse('This file is not at a departmental desk yet.');

  const stage = await db.workflowStage.findUnique({
    where: { id: app.currentStageId },
    select: { ownerRoleKeys: true, name: true, isTerminal: true },
  });
  const owners = Array.isArray(stage?.ownerRoleKeys) ? (stage!.ownerRoleKeys as string[]) : [];
  // The role that OWNS the desk — for a multi-role officer, not simply their
  // first role — is the capacity they act in, and what the record names.
  const roleKey = owners.find((r) => user.roleKeys.includes(r as never));
  if (!stage || stage.isTerminal || !roleKey) {
    return refuse(`NOCs are verified by the desk the file is at. It is at ${stage?.name ?? stageName(app.currentStageCode)} now.`);
  }
  return { ok: true, reason: '', roleKey };
}

/** Whether the caller may act as the APPLICANT on this file. */
function applicantAccess(user: AuthUser, app: Pick<ApplicationRow, 'status' | 'ltpUserId'>) {
  if (!can(user, CAPABILITIES.NOC_UPDATE) || !isLtp(user) || app.ltpUserId !== user.id) {
    return { ok: false, reason: '' };
  }
  if (isClosed(app.status)) return { ok: false, reason: 'This application has been decided. Its NOCs are a closed record.' };
  return { ok: true, reason: '' };
}

function assertExpected(current: string, expected: string | undefined) {
  if (expected && expected !== current) {
    throw conflict(
      `This NOC is now ${NOC_STATUS_LABEL[current as NocStatus] ?? current}. Reload to see what changed before acting on it.`,
      'STALE_WRITE'
    );
  }
}

async function currentStageCode(db: Tx, applicationId: string) {
  const app = await db.application.findUnique({ where: { id: applicationId }, select: { currentStageCode: true } });
  return app?.currentStageCode ?? '';
}

/**
 * `roleKey` is the CAPACITY the actor acted in — the desk-owning role for an
 * officer, LTP for the applicant — not merely their first role. An officer
 * holding several roles would otherwise be recorded in whichever sorts first.
 */
async function recordEvent(
  tx: Tx,
  user: AuthUser | null,
  nocId: string,
  e: { action: string; from: string; to: string; stageCode: string; remarks: string; roleKey?: string }
) {
  await tx.applicationNocEvent.create({
    data: {
      nocId,
      action: e.action,
      fromStatus: e.from,
      toStatus: e.to,
      actorId: user?.id ?? null,
      actorName: user?.name ?? 'System',
      actorRoleKey: e.roleKey ?? user?.roleKeys[0] ?? 'SYSTEM',
      stageCode: e.stageCode,
      remarks: e.remarks,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Expiry
// ═══════════════════════════════════════════════════════════════════════════

let lastSweep = 0;

/**
 * Moves every RECEIVED or VERIFIED NOC whose validity has passed to EXPIRED,
 * with an event and an audit row each.
 *
 * Run on read (at most once a minute per process) rather than on a timer:
 * the demonstration has no scheduler guaranteed to be running, and a register
 * that still says "Verified" on a lapsed certificate is the error that
 * matters. `force` is for tests and the seed.
 */
export async function expireLapsedNocs(options: { force?: boolean; now?: Date } = {}) {
  const now = options.now ?? new Date();
  if (!options.force && now.getTime() - lastSweep < 60_000) return 0;
  lastSweep = now.getTime();

  const lapsed = await prisma.applicationNoc.findMany({
    where: { status: { in: [NOC_STATUS.RECEIVED, NOC_STATUS.VERIFIED] }, expiryDate: { lt: now } },
    select: { id: true, status: true, nocNumber: true, applicationId: true, expiryDate: true },
    take: 200,
  });

  for (const n of lapsed) {
    await prisma.$transaction(async (tx) => {
      // Re-read under the transaction: another sweep may have got there.
      const { count } = await tx.applicationNoc.updateMany({
        where: { id: n.id, status: n.status },
        data: { status: NOC_STATUS.EXPIRED },
      });
      if (!count) return;
      const remarks = `Validity ended ${n.expiryDate!.toISOString().slice(0, 10)}.`;
      await recordEvent(tx, null, n.id, {
        action: 'EXPIRE',
        from: n.status,
        to: NOC_STATUS.EXPIRED,
        stageCode: await currentStageCode(tx, n.applicationId),
        remarks,
      });
      await audit(tx, {
        action: 'NOC_EXPIRED',
        entityType: 'ApplicationNoc',
        entityId: n.id,
        applicationId: n.applicationId,
        before: { status: n.status },
        after: { status: NOC_STATUS.EXPIRED, nocNumber: n.nocNumber },
        remarks,
      });
    }, TX_LIMITS);
  }
  return lapsed.length;
}

const sweep = () => expireLapsedNocs().catch(() => 0);

// ═══════════════════════════════════════════════════════════════════════════
// The register
// ═══════════════════════════════════════════════════════════════════════════

export type NocListQuery = {
  q?: string;
  applicationId?: string;
  nocTypeId?: string;
  /** A status, or OUTSTANDING (everything not yet settled). */
  status?: string;
  /** The application's current stage code. */
  desk?: string;
  authority?: string;
  /** Expiry window, inclusive, YYYY-MM-DD. */
  expiringBefore?: string;
  page?: number;
  pageSize?: number;
};

const scopeWhere = (user: AuthUser): Prisma.ApplicationNocWhereInput => ({
  application: { deletedAt: null, ...applicationScope(user) },
});

function listWhere(user: AuthUser, query: NocListQuery): Prisma.ApplicationNocWhereInput {
  const and: Prisma.ApplicationNocWhereInput[] = [scopeWhere(user)];

  if (query.applicationId && isUuid(query.applicationId)) and.push({ applicationId: query.applicationId });
  if (query.nocTypeId && isUuid(query.nocTypeId)) and.push({ nocTypeId: query.nocTypeId });
  if (query.status === 'OUTSTANDING') and.push({ status: { in: [...OUTSTANDING_NOC_STATUSES] } });
  else if (query.status && isNocStatus(query.status)) and.push({ status: query.status });
  if (query.desk) and.push({ application: { currentStageCode: query.desk } });
  if (query.authority?.trim()) and.push({ authority: { contains: query.authority.trim(), mode: 'insensitive' } });
  if (query.expiringBefore) {
    const d = new Date(`${query.expiringBefore}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) and.push({ expiryDate: { not: null, lte: d } });
  }

  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { nocNumber: { contains: q, mode: 'insensitive' } },
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { applicationReference: { contains: q, mode: 'insensitive' } },
        { application: { applicationNumber: { contains: q, mode: 'insensitive' } } },
        { application: { applicant: { ownerName: { contains: q, mode: 'insensitive' } } } },
        { application: { applicant: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }

  return { AND: and };
}

export async function listNocs(user: AuthUser, query: NocListQuery = {}) {
  requireView(user);
  await sweep();

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(query.pageSize ?? 20)));
  const where = listWhere(user, query);

  const [total, rows] = await Promise.all([
    prisma.applicationNoc.count({ where }),
    prisma.applicationNoc.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { nocNumber: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { ...NOC_SELECT, application: { select: APPLICATION_SELECT } },
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => ({
      id: r.id,
      nocNumber: r.nocNumber,
      status: r.status,
      nocType: r.nocType,
      authority: r.authority,
      appliedDate: r.appliedDate,
      issuedDate: r.issuedDate,
      expiryDate: r.expiryDate,
      referenceNumber: r.referenceNumber,
      application: applicationSummary(r.application),
    })),
  };
}

/** The register's tiles, and the dashboards' "NOCs pending". */
export async function nocSummary(user: AuthUser) {
  requireView(user);
  await sweep();
  const scope = scopeWhere(user);

  // "At my desk": received NOCs on files at a stage one of my roles owns.
  const myStages = can(user, CAPABILITIES.NOC_VERIFY)
    ? (
        await prisma.workflowStage.findMany({
          where: { isTerminal: false },
          select: { code: true, ownerRoleKeys: true },
        })
      )
        .filter((s) => Array.isArray(s.ownerRoleKeys) && (s.ownerRoleKeys as string[]).some((r) => user.roleKeys.includes(r as never)))
        .map((s) => s.code)
    : [];

  const [byStatus, awaitingMe] = await Promise.all([
    prisma.applicationNoc.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    myStages.length
      ? prisma.applicationNoc.count({
          where: {
            ...scope,
            status: NOC_STATUS.RECEIVED,
            application: { deletedAt: null, ...applicationScope(user), currentStageCode: { in: [...new Set(myStages)] } },
          },
        })
      : 0,
  ]);

  const status = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const get = (s: NocStatus) => status[s] ?? 0;
  const total = Object.values(status).reduce((a, b) => a + b, 0);

  return {
    total,
    byStatus: status,
    pending: OUTSTANDING_NOC_STATUSES.reduce((sum, s) => sum + get(s), 0),
    awaitingVerification: get('RECEIVED'),
    awaitingMe,
    verified: get('VERIFIED'),
    notRequired: get('NOT_REQUIRED'),
    shortfall: get('SHORTFALL'),
    rejected: get('REJECTED'),
    expired: get('EXPIRED'),
  };
}

/** Filter options for the register: types, and the desks files with NOCs sit at. */
export async function nocRegisterMeta(user: AuthUser) {
  requireView(user);
  const [types, desks] = await Promise.all([
    prisma.nocType.findMany({
      where: { OR: [{ isActive: true }, { nocs: { some: {} } }] },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.application.findMany({
      where: { deletedAt: null, ...applicationScope(user), nocs: { some: {} }, currentStageCode: { not: null } },
      distinct: ['currentStageCode'],
      select: { currentStageCode: true },
    }),
  ]);
  return {
    types,
    desks: desks
      .map((d) => ({ code: d.currentStageCode!, label: stageName(d.currentStageCode) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// One NOC
// ═══════════════════════════════════════════════════════════════════════════

export async function getNoc(user: AuthUser, id: string) {
  requireView(user);
  await sweep();
  const noc = await requireNoc(prisma, user, id);

  const [events, desk] = await Promise.all([
    prisma.applicationNocEvent.findMany({
      where: { nocId: noc.id },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        action: true,
        fromStatus: true,
        toStatus: true,
        actorName: true,
        actorRoleKey: true,
        stageCode: true,
        remarks: true,
        occurredAt: true,
      },
    }),
    deskAccess(prisma, user, noc.application),
  ]);
  const applicant = applicantAccess(user, noc.application);

  const { application, ...rest } = noc;
  return {
    ...view(rest as NocRow),
    application: applicationSummary(application),
    events: events.map((e) => ({ ...e, stageName: e.stageCode ? stageName(e.stageCode) : '' })),
    permissions: {
      officerMoves: desk.ok ? nocMoves(noc.status, 'officer') : [],
      applicantMoves: applicant.ok ? nocMoves(noc.status, 'applicant') : [],
      deskReason: desk.reason,
      demoDocumentAllowed: env.demoMode,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The application's NOCs tab
// ═══════════════════════════════════════════════════════════════════════════

export async function getApplicationNocs(user: AuthUser, applicationId: string) {
  requireView(user);
  await sweep();
  const app = await requireApplication(prisma, user, applicationId);

  const [rows, types, answers, desk] = await Promise.all([
    prisma.applicationNoc.findMany({
      where: { applicationId: app.id },
      orderBy: { nocType: { displayOrder: 'asc' } },
      select: NOC_SELECT,
    }),
    prisma.nocType.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, code: true, name: true, authority: true, description: true, suggestedByChecklistItems: true },
    }),
    prisma.applicationChecklistResponse.findMany({
      where: { applicationId: app.id, kind: 'APPLICATION', response: 'YES' },
      select: { itemNumber: true },
    }),
    deskAccess(prisma, user, app),
  ]);
  const applicant = applicantAccess(user, app);

  // The hint, never the decision: which of this type's linked checklist
  // questions the applicant answered YES.
  const yes = new Set(answers.map((a) => a.itemNumber));
  const opened = new Set(rows.map((r) => r.nocTypeId));
  const available = types
    .filter((t) => !opened.has(t.id))
    .map(({ suggestedByChecklistItems, ...t }) => ({
      ...t,
      suggestedBy: (Array.isArray(suggestedByChecklistItems) ? (suggestedByChecklistItems as number[]) : []).filter((n) =>
        yes.has(n)
      ),
    }));

  return {
    application: applicationSummary(app),
    nocs: rows.map((r) => ({
      ...view(r),
      officerMoves: desk.ok ? nocMoves(r.status, 'officer') : [],
      applicantMoves: applicant.ok ? nocMoves(r.status, 'applicant') : [],
    })),
    tally: nocTally(rows),
    available,
    permissions: {
      isDesk: desk.ok,
      isApplicant: applicant.ok,
      deskReason: desk.reason,
      demoDocumentAllowed: env.demoMode,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Opening a NOC
// ═══════════════════════════════════════════════════════════════════════════

export async function createNoc(user: AuthUser, applicationId: string, input: CreateNocInput, meta: Meta) {
  requireView(user);

  return prisma.$transaction(async (tx) => {
    const app = await requireApplication(tx, user, applicationId);
    const [desk, applicant] = [await deskAccess(tx, user, app), applicantAccess(user, app)];
    if (!desk.ok && !applicant.ok) {
      throw forbidden(desk.reason || applicant.reason || 'Your role does not open NOCs on an application.');
    }

    const type = await tx.nocType.findUnique({
      where: { id: input.nocTypeId },
      select: { id: true, name: true, authority: true, isActive: true },
    });
    if (!type || !type.isActive) {
      throw badRequest('That kind of NOC is not in use.', [{ path: 'nocTypeId', message: 'Choose an active NOC type.' }]);
    }
    const existing = await tx.applicationNoc.findUnique({
      where: { applicationId_nocTypeId: { applicationId: app.id, nocTypeId: type.id } },
      select: { nocNumber: true },
    });
    if (existing) throw conflict(`${type.name} is already on this application as ${existing.nocNumber}.`);

    // The desk opens it DECIDED; the applicant's declaration is undetermined.
    const asDesk = desk.ok;
    const required = asDesk ? (input.required ?? true) : null;
    const status: NocStatus = required === null ? 'PENDING' : required ? 'REQUIRED' : 'NOT_REQUIRED';
    if (asDesk && required === false && !input.remarks.trim()) {
      throw badRequest('Say why this NOC is not required.', [{ path: 'remarks', message: 'Remarks are required.' }]);
    }

    const year = new Date().getFullYear();
    const seq = await nextSequence(tx, `NOC-${year}`);
    const nocNumber = formatNumber(NOC_NUMBER_FORMAT, { prefix: 'NOC', year, seq });
    const stageCode = app.currentStageCode ?? '';

    const noc = await tx.applicationNoc.create({
      data: {
        nocNumber,
        applicationId: app.id,
        nocTypeId: type.id,
        status,
        isRequired: required,
        authority: input.authority.trim() || type.authority,
        remarks: asDesk ? input.remarks : '',
        applicantRemarks: asDesk ? '' : input.remarks,
        reviewedStageCode: asDesk ? stageCode : '',
        createdById: user.id,
        createdByName: user.name,
      },
      select: { id: true, nocNumber: true, status: true },
    });

    const roleKey = asDesk ? desk.roleKey : 'LTP';
    await recordEvent(tx, user, noc.id, { action: 'CREATED', from: '', to: status, stageCode, remarks: input.remarks, roleKey });
    await audit(tx, {
      actor: inCapacity(user, roleKey),
      action: 'NOC_OPENED',
      entityType: 'ApplicationNoc',
      entityId: noc.id,
      applicationId: app.id,
      after: { nocNumber, type: type.name, status, isRequired: required, stageCode },
      remarks: input.remarks,
      ...meta,
    });

    return noc;
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// The desk's decision
// ═══════════════════════════════════════════════════════════════════════════

export async function officerAction(user: AuthUser, id: string, input: OfficerActionInput, meta: Meta) {
  requireView(user);
  const action = input.action as NocAction;

  return prisma.$transaction(async (tx) => {
    const noc = await requireNoc(tx, user, id);
    const desk = await deskAccess(tx, user, noc.application);
    if (!desk.ok) throw forbidden(desk.reason || 'Your role does not verify NOCs.');

    assertExpected(noc.status, input.expectedStatus);
    if (!canMove(action, noc.status)) {
      throw conflict(
        `${NOC_ACTION_LABEL[action]} is not possible on a NOC that is ${NOC_STATUS_LABEL[noc.status as NocStatus] ?? noc.status}.`
      );
    }
    const remarks = input.remarks.trim();
    if (REMARKS_REQUIRED.has(action) && !remarks) {
      throw badRequest(`Remarks are required to ${NOC_ACTION_LABEL[action].toLowerCase()}.`, [
        { path: 'remarks', message: 'Say why.' },
      ]);
    }

    if (action === 'VERIFY') {
      const problems = verificationProblems({
        referenceNumber: noc.referenceNumber,
        issuedDate: noc.issuedDate,
        expiryDate: noc.expiryDate,
        hasDocument: hasDocument(noc),
        requiresExpiry: noc.nocType.requiresExpiry,
      });
      if (problems.length) {
        throw badRequest(
          'This NOC cannot be verified yet.',
          problems.map((message) => ({ path: 'noc', message }))
        );
      }
    }

    const to = NOC_ACTION_RESULT[action];
    const now = new Date();
    const stageCode = noc.application.currentStageCode ?? '';
    const data: Prisma.ApplicationNocUpdateManyMutationInput = {
      status: to,
      remarks: remarks || noc.remarks,
      reviewedStageCode: stageCode,
    };
    if (action === 'MARK_REQUIRED') data.isRequired = true;
    if (action === 'MARK_NOT_REQUIRED') data.isRequired = false;
    if (action === 'VERIFY') {
      data.isRequired = true;
      data.verifiedById = user.id;
      data.verifiedByName = user.name;
      data.verifiedByRoleKey = desk.roleKey;
      data.verifiedAt = now;
    }
    // A shortfall or rejection asks for something the applicant must do — so
    // the NOC is required by implication, whatever it was before.
    if (action === 'SHORTFALL' || action === 'REJECT') data.isRequired = true;

    // Guarded on the status we read, so two desks deciding at once cannot
    // both win.
    const { count } = await tx.applicationNoc.updateMany({ where: { id: noc.id, status: noc.status }, data });
    if (!count) throw conflict('Somebody else acted on this NOC just now. Reload to see what changed.', 'STALE_WRITE');

    await recordEvent(tx, user, noc.id, { action, from: noc.status, to, stageCode, remarks, roleKey: desk.roleKey });
    await audit(tx, {
      actor: inCapacity(user, desk.roleKey),
      action: `NOC_${action}`,
      entityType: 'ApplicationNoc',
      entityId: noc.id,
      applicationId: noc.applicationId,
      before: { status: noc.status, isRequired: noc.isRequired },
      after: { status: to, nocNumber: noc.nocNumber, stageCode },
      remarks,
      ...meta,
    });

    return { id: noc.id, nocNumber: noc.nocNumber, status: to };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// The applicant's record
// ═══════════════════════════════════════════════════════════════════════════

type Upload = { name: string; type: string; bytes: Buffer };

function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function applicantUpdate(
  user: AuthUser,
  id: string,
  input: ApplicantUpdateInput & { file?: Upload | null },
  meta: Meta
) {
  requireView(user);
  const action = input.action as NocAction;

  // Checked before the upload, so a refused caller never writes to storage.
  const pre = await requireNoc(prisma, user, id);
  const access = applicantAccess(user, pre.application);
  if (!access.ok) throw forbidden(access.reason || 'Only the applicant records the NOC applied for and received.');
  assertExpected(pre.status, input.expectedStatus);
  if (!canMove(action, pre.status)) {
    throw conflict(
      `${NOC_ACTION_LABEL[action]} is not possible on a NOC that is ${NOC_STATUS_LABEL[pre.status as NocStatus] ?? pre.status}.`
    );
  }
  if (input.demoDocument && !env.demoMode) {
    throw badRequest('A demo placeholder certificate can only be used in the demonstration environment.');
  }

  const now = new Date();
  const problems: Array<{ path: string; message: string }> = [];
  const appliedDate = parseDay(input.appliedDate);
  const issuedDate = parseDay(input.issuedDate);
  const expiryDate = parseDay(input.expiryDate);
  const future = (d: Date | null) => d && d.getTime() > now.getTime() + 60_000;

  if (action === 'RECORD_APPLICATION') {
    if (!input.applicationReference?.trim()) problems.push({ path: 'applicationReference', message: 'Enter the reference the authority gave your application.' });
    if (!appliedDate) problems.push({ path: 'appliedDate', message: 'Enter the date you applied.' });
    else if (future(appliedDate)) problems.push({ path: 'appliedDate', message: 'The application date cannot be in the future.' });
  } else {
    if (!input.referenceNumber?.trim()) problems.push({ path: 'referenceNumber', message: 'Enter the NOC number printed on the certificate.' });
    if (!issuedDate) problems.push({ path: 'issuedDate', message: 'Enter the date of issue.' });
    else if (future(issuedDate)) problems.push({ path: 'issuedDate', message: 'The date of issue cannot be in the future.' });
    if (pre.nocType.requiresExpiry && !expiryDate) problems.push({ path: 'expiryDate', message: 'Enter the date the certificate is valid until.' });
    if (expiryDate && issuedDate && expiryDate <= issuedDate) problems.push({ path: 'expiryDate', message: 'The expiry must be after the date of issue.' });
    if (expiryDate && expiryDate <= now) problems.push({ path: 'expiryDate', message: 'That certificate has already expired.' });
    if (!input.file && !input.demoDocument && !hasDocument(pre)) {
      problems.push({ path: 'file', message: 'Attach a copy of the certificate.' });
    }
  }
  if (problems.length) throw badRequest('Some of the NOC details are missing or not valid.', problems);

  // Storage writes cannot be rolled back by Postgres, so they happen first.
  const stored = input.file
    ? await storeUpload({
        applicationId: pre.applicationId,
        kind: 'nocs',
        file: input.file,
        uploadedById: user.id,
        allowedExtensions: DOCUMENT_EXTENSIONS,
        maxBytes: MAX_DOCUMENT_BYTES,
      })
    : null;

  return prisma.$transaction(async (tx) => {
    const noc = await requireNoc(tx, user, id);
    if (noc.status !== pre.status) {
      throw conflict('This NOC changed while your record was uploading. Reload and try again.', 'STALE_WRITE');
    }
    const to = NOC_ACTION_RESULT[action];
    const data: Prisma.ApplicationNocUpdateInput = {
      status: to,
      applicantRemarks: input.remarks || noc.applicantRemarks,
      ...(input.authority?.trim() ? { authority: input.authority.trim() } : {}),
    };

    if (action === 'RECORD_APPLICATION') {
      data.applicationReference = input.applicationReference!.trim();
      data.appliedDate = appliedDate;
    } else {
      data.referenceNumber = input.referenceNumber!.trim();
      data.issuedDate = issuedDate;
      data.expiryDate = expiryDate;
      if (input.applicationReference?.trim()) data.applicationReference = input.applicationReference.trim();
      if (appliedDate) data.appliedDate = appliedDate;
      // A new receipt clears any earlier verification: this is a different
      // certificate, or the same one re-submitted after a shortfall.
      data.verifiedById = null;
      data.verifiedByName = '';
      data.verifiedByRoleKey = '';
      data.verifiedAt = null;
      if (stored) {
        Object.assign(data, {
          fileObjectId: stored.id,
          fileName: stored.originalName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          isDemoDocument: false,
          documentAddedAt: now,
        });
      } else if (input.demoDocument) {
        Object.assign(data, {
          fileObjectId: null,
          fileName: `${noc.nocNumber.replace(/\//g, '-')}-DEMO.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 0,
          isDemoDocument: true,
          documentAddedAt: now,
        });
      }
    }

    await tx.applicationNoc.update({ where: { id: noc.id }, data });

    const stageCode = noc.application.currentStageCode ?? '';
    await recordEvent(tx, user, noc.id, { action, from: noc.status, to, stageCode, remarks: input.remarks, roleKey: 'LTP' });
    await audit(tx, {
      actor: inCapacity(user, 'LTP'),
      action: `NOC_${action}`,
      entityType: 'ApplicationNoc',
      entityId: noc.id,
      applicationId: noc.applicationId,
      before: { status: noc.status },
      after: {
        status: to,
        nocNumber: noc.nocNumber,
        referenceNumber: data.referenceNumber ?? noc.referenceNumber,
        applicationReference: data.applicationReference ?? noc.applicationReference,
        fileObjectId: stored?.id ?? null,
        checksum: stored?.checksumSha256 ?? null,
        demoDocument: Boolean(input.demoDocument && !stored),
      },
      remarks: input.remarks,
      ...meta,
    });

    return { id: noc.id, nocNumber: noc.nocNumber, status: to };
  }, TX_LIMITS);
}

// ═══════════════════════════════════════════════════════════════════════════
// The certificate
// ═══════════════════════════════════════════════════════════════════════════

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** The bytes of the attached certificate, or a labelled placeholder for a demo one. */
export async function readNocDocument(user: AuthUser, id: string) {
  requireView(user);
  const noc = await requireNoc(prisma, user, id);

  if (noc.fileObjectId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: noc.fileObjectId },
      select: { storageKey: true, mimeType: true, scanStatus: true, originalName: true },
    });
    if (file && (file.scanStatus === 'CLEAN' || file.scanStatus === 'SKIPPED')) {
      return { bytes: await storage.get(file.storageKey), mimeType: file.mimeType, fileName: file.originalName };
    }
    throw conflict(
      file?.scanStatus === 'PENDING'
        ? 'The certificate is still being scanned. Try again in a moment.'
        : 'The certificate is withheld — it did not pass the virus scan.'
    );
  }
  if (!noc.isDemoDocument) throw notFound('No certificate is attached to this NOC.');

  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
  const line = (y: number, label: string, value: string) =>
    `<text x="48" y="${y}" font-family="system-ui,sans-serif" font-size="15" fill="#475569">${escapeXml(label)}</text>` +
    `<text x="230" y="${y}" font-family="system-ui,sans-serif" font-size="15" font-weight="600" fill="#0f172a">${escapeXml(value || '—')}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="820" viewBox="0 0 640 820">
  <rect width="640" height="820" fill="#fffdf7"/>
  <rect x="20" y="20" width="600" height="780" fill="none" stroke="#b45309" stroke-width="3"/>
  <text x="320" y="92" text-anchor="middle" font-family="Georgia,serif" font-size="28" font-weight="700" fill="#7c2d12">${escapeXml(noc.nocType.name)}</text>
  <text x="320" y="124" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#475569">${escapeXml(noc.authority)}</text>
  <line x1="48" y1="150" x2="592" y2="150" stroke="#e2e8f0"/>
  ${line(200, 'NOC number', noc.referenceNumber)}
  ${line(232, 'Application', noc.application.applicationNumber)}
  ${line(264, 'Date of issue', fmt(noc.issuedDate))}
  ${line(296, 'Valid until', fmt(noc.expiryDate))}
  ${line(328, 'Register entry', noc.nocNumber)}
  <g transform="rotate(-28 320 520)">
    <text x="320" y="540" text-anchor="middle" font-family="system-ui,sans-serif" font-size="84" font-weight="800" fill="#dc2626" opacity="0.16">DEMO</text>
  </g>
  <rect x="48" y="700" width="544" height="64" fill="#fef3c7"/>
  <text x="64" y="728" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#92400e">NOT A REAL CERTIFICATE</text>
  <text x="64" y="750" font-family="system-ui,sans-serif" font-size="11" fill="#92400e">${escapeXml(DEMO_DOCUMENT_NOTE.slice(0, 96))}</text>
</svg>`;
  return { bytes: Buffer.from(svg, 'utf8'), mimeType: 'image/svg+xml', fileName: noc.fileName || 'demo-noc.svg' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

export async function listNocTypes(user: AuthUser) {
  if (!can(user, CAPABILITIES.MASTER_DATA_MANAGE) && !can(user, CAPABILITIES.NOC_VIEW)) {
    throw forbidden('Your role does not include NOCs.');
  }
  const types = await prisma.nocType.findMany({
    orderBy: { displayOrder: 'asc' },
    include: { _count: { select: { nocs: true } } },
  });
  return types.map(({ _count, ...t }) => ({ ...t, nocCount: _count.nocs }));
}

export async function updateNocType(user: AuthUser, id: string, input: UpdateNocTypeInput, meta: Meta) {
  if (!can(user, CAPABILITIES.MASTER_DATA_MANAGE)) throw forbidden('Only an administrator configures NOC types.');
  if (!isUuid(id)) throw notFound('That NOC type could not be found.');

  return prisma.$transaction(async (tx) => {
    const before = await tx.nocType.findUnique({ where: { id } });
    if (!before) throw notFound('That NOC type could not be found.');
    const after = await tx.nocType.update({ where: { id }, data: input });
    await audit(tx, {
      actor: user,
      action: 'NOC_TYPE_UPDATED',
      entityType: 'NocType',
      entityId: id,
      before: { name: before.name, authority: before.authority, isActive: before.isActive, requiresExpiry: before.requiresExpiry },
      after: { name: after.name, authority: after.authority, isActive: after.isActive, requiresExpiry: after.requiresExpiry },
      ...meta,
    });
    return after;
  }, TX_LIMITS);
}
