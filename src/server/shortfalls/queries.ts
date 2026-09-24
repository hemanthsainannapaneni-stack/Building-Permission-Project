import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { applicationScope } from '@/server/auth/scope';
import { isLtp, type AuthUser } from '@/server/auth/context';
import { notFound } from '@/server/http/errors';
import { isUuid } from '@/lib/utils';
import {
  CLOSED_SHORTFALL_STATUSES,
  SHORTFALL_FILTERS,
  SHORTFALL_STATUS,
  currentCycle,
  itemTally,
  shortfallSla,
  turnOf,
  type ShortfallFilter,
} from '@/lib/shortfalls';
import { SHORTFALL_SELECT, type ShortfallRow } from './engine';

/**
 * Reading shortfalls — the register, and one file's worth.
 *
 * ── Scope is merged into the query, never applied after ──────────────────
 *
 * A shortfall belongs to an application, and who may see an application is
 * already decided by `applicationScope`. Reusing it means a shortfall cannot
 * be visible to somebody the application is not — including through the
 * cross-application register, which is exactly where such a leak would be
 * least obvious.
 */

const LIST_SELECT = {
  ...SHORTFALL_SELECT,
  application: {
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      currentStageCode: true,
      slaStatus: true,
      slaDueAt: true,
      ltpUserId: true,
      zone: { select: { name: true } },
      applicant: { select: { name: true } },
      applicationType: { select: { code: true, name: true } },
      ltp: { select: { id: true, name: true } },
    },
  },
  raisedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShortfallSelect;

type ListRow = Prisma.ShortfallGetPayload<{ select: typeof LIST_SELECT }>;

export type ShortfallListQuery = {
  filter?: string;
  kind?: string;
  q?: string;
  applicationId?: string;
  /** One exact lifecycle status, narrower than the filter chips. */
  status?: string;
  /** The desk the FILE is at now — the register's Current Desk column. */
  desk?: string;
  /** The desk the shortfall was raised at. */
  raisedAtStage?: string;
  /** Raised on or after, and on or before. ISO dates. */
  from?: string;
  to?: string;
  /** The owner, by applicant name or by the LTP who filed. */
  owner?: string;
  /** Shortfalls that have reached this cycle. 1 matches everything. */
  attempt?: number;
  page?: number;
  pageSize?: number;
};

/** The WHERE fragment behind each filter chip. */
function filterWhere(filter: ShortfallFilter): Prisma.ShortfallWhereInput {
  switch (filter) {
    case SHORTFALL_FILTERS.OPEN:
      return { status: { notIn: [...CLOSED_SHORTFALL_STATUSES] } };

    case SHORTFALL_FILTERS.AWAITING_APPLICANT:
      return {
        status: {
          in: [
            SHORTFALL_STATUS.RAISED,
            SHORTFALL_STATUS.NOTIFIED,
            SHORTFALL_STATUS.ACTION_REQUIRED,
            SHORTFALL_STATUS.RESOLUTION_REJECTED,
          ],
        },
      };

    case SHORTFALL_FILTERS.AWAITING_OFFICER:
      return {
        status: { in: [SHORTFALL_STATUS.RESOLUTION_SUBMITTED, SHORTFALL_STATUS.UNDER_REVIEW] },
      };

    case SHORTFALL_FILTERS.OVERDUE:
      return {
        status: { notIn: [...CLOSED_SHORTFALL_STATUSES] },
        dueDate: { lt: new Date() },
      };

    case SHORTFALL_FILTERS.RESOLVED:
      return { status: { in: [...CLOSED_SHORTFALL_STATUSES] } };

    default:
      return {};
  }
}

export type ShortfallListRow = ReturnType<typeof shapeListRow>;

/**
 * "Reached cycle N", expressed exactly.
 *
 * Cycle 1 is every shortfall, answered or not — the applicant has been asked
 * once the moment it exists. Beyond that a shortfall has reached cycle N when
 * its highest attempt is N, or when it has been rejected off attempt N-1 and
 * the applicant is working on the next one. `some: { attemptNo: { gte: N } }`
 * is the max, stated as a relation filter, which is the one form Prisma can
 * push into the query rather than counting in memory.
 */
function cycleWhere(attempt: number): Prisma.ShortfallWhereInput {
  if (attempt <= 1) return {};

  return {
    OR: [
      { resolutions: { some: { attemptNo: { gte: attempt } } } },
      {
        AND: [
          { status: SHORTFALL_STATUS.RESOLUTION_REJECTED as never },
          { resolutions: { some: { attemptNo: { gte: attempt - 1 } } } },
        ],
      },
    ],
  };
}

/** The date range, read inclusively at both ends. */
function rangeWhere(from?: string, to?: string): Prisma.ShortfallWhereInput {
  const gte = from ? new Date(from) : null;
  const raw = to ? new Date(to) : null;

  // A bare "to" date means the END of that day. Without this, filtering to
  // today returns nothing raised today, which reads as missing data.
  const lte = raw ? new Date(raw.getTime() + (isMidnight(raw) ? 86_399_999 : 0)) : null;

  if (!isValid(gte) && !isValid(lte)) return {};

  return {
    raisedAt: {
      ...(isValid(gte) ? { gte: gte! } : {}),
      ...(isValid(lte) ? { lte: lte! } : {}),
    },
  };
}

const isValid = (d: Date | null): boolean => d !== null && !Number.isNaN(d.getTime());
const isMidnight = (d: Date): boolean =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;

/** Every WHERE fragment the register's filter bar can contribute. */
function queryWhere(user: AuthUser, query: ShortfallListQuery): Prisma.ShortfallWhereInput {
  const filter = (query.filter ?? SHORTFALL_FILTERS.ALL) as ShortfallFilter;

  return {
    AND: [
      { application: { deletedAt: null, ...applicationScope(user) } },
      filterWhere(filter),
      ...(query.kind ? [{ kind: query.kind as never }] : []),
      ...(query.status ? [{ status: query.status as never }] : []),
      ...(query.applicationId ? [{ applicationId: query.applicationId }] : []),
      ...(query.desk ? [{ application: { currentStageCode: query.desk } }] : []),
      ...(query.raisedAtStage ? [{ raisedAtStageCode: query.raisedAtStage }] : []),
      ...(query.owner
        ? [
            {
              application: {
                OR: [
                  { applicant: { name: { contains: query.owner, mode: 'insensitive' as const } } },
                  { ltp: { name: { contains: query.owner, mode: 'insensitive' as const } } },
                ],
              },
            },
          ]
        : []),
      rangeWhere(query.from, query.to),
      cycleWhere(query.attempt ?? 1),
      ...(query.q
        ? [
            {
              OR: [
                { shortfallNumber: { contains: query.q, mode: 'insensitive' as const } },
                { title: { contains: query.q, mode: 'insensitive' as const } },
                { description: { contains: query.q, mode: 'insensitive' as const } },
                {
                  application: {
                    applicationNumber: { contains: query.q, mode: 'insensitive' as const },
                  },
                },
                {
                  application: {
                    applicant: { name: { contains: query.q, mode: 'insensitive' as const } },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export async function listShortfalls(user: AuthUser, query: ShortfallListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 20));

  const where = queryWhere(user, query);

  const [rows, total, counts] = await Promise.all([
    prisma.shortfall.findMany({
      where,
      select: LIST_SELECT,
      // Open first, then oldest first: the one that has been waiting longest
      // is the one somebody should look at, and a settled shortfall is history.
      orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { raisedAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.shortfall.count({ where }),
    countByFilter(user, query),
  ]);

  return {
    rows: rows.map(shapeListRow),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    /** True when this user answers shortfalls rather than deciding them. */
    isApplicant: isLtp(user),
  };
}

/**
 * The number on each filter chip.
 *
 * Counted with every OTHER filter applied but this chip's own status rule
 * replaced — so "Open 4" beside a desk filter means four open shortfalls AT
 * THAT DESK. A chip counting the unfiltered register would send somebody to a
 * tab that then shows an empty table, which is the one thing a count on a tab
 * is there to prevent.
 */
async function countByFilter(
  user: AuthUser,
  query: ShortfallListQuery
): Promise<Record<string, number>> {
  const keys = Object.values(SHORTFALL_FILTERS);

  const results = await Promise.all(
    keys.map((key) => prisma.shortfall.count({ where: queryWhere(user, { ...query, filter: key }) }))
  );

  return Object.fromEntries(keys.map((key, i) => [key, results[i]!]));
}

function shapeListRow(row: ListRow) {
  const tally = itemTally(row.items);
  const cycle = currentCycle(row.status, row.resolutions);

  return {
    id: row.id,
    shortfallNumber: row.shortfallNumber,
    kind: row.kind,
    mode: row.mode,
    status: row.status,
    turn: turnOf(row.status),
    title: row.title,
    description: row.description,
    requiredAction: row.requiredAction,
    raisedAtStageCode: row.raisedAtStageCode,
    raisedByRoleKey: row.raisedByRoleKey,
    raisedByName: row.raisedBy?.name ?? '',
    raisedAt: row.raisedAt,
    dueDate: row.dueDate,
    notifiedAt: row.notifiedAt,
    closedAt: row.closedAt,
    itemCount: tally.total,
    resolvedItems: tally.resolved,
    pendingItems: tally.pending,
    mandatoryPendingItems: tally.mandatoryPending,
    attempts: row.resolutions.length,
    cycle,
    // The shortfall's own response clock, computed once on the server so the
    // register and the detail header cannot disagree about it.
    sla: shortfallSla({ status: row.status, raisedAt: row.raisedAt, dueDate: row.dueDate }),
    amount: row.items.reduce((sum, i) => sum + (i.amount ? Number(i.amount) : 0), 0),
    application: {
      id: row.application.id,
      applicationNumber: row.application.applicationNumber,
      status: row.application.status,
      currentStageCode: row.application.currentStageCode,
      // The OWNER is the person the permission would be granted to. The LTP is
      // whoever filed on their behalf, and on most files they are different
      // people — so both travel, and the register labels them apart.
      applicantName: row.application.applicant?.name ?? '—',
      ltpName: row.application.ltp?.name ?? '',
      type: row.application.applicationType.name,
      typeCode: row.application.applicationType.code,
      zone: row.application.zone?.name ?? '—',
      slaStatus: row.application.slaStatus,
      slaDueAt: row.application.slaDueAt,
    },
    demands: row.feeDemands.map((d) => ({
      id: d.id,
      demandNumber: d.demandNumber,
      status: d.status,
      totalAmount: d.totalAmount,
      paidAmount: d.paidAmount,
    })),
  };
}

export type ShortfallDetail = Awaited<ReturnType<typeof getShortfall>>;

/**
 * One shortfall, with everything the detail screen shows.
 *
 * Row scope goes into the WHERE, so a shortfall on somebody else's application
 * is "not found" rather than "forbidden" — the same rule the application
 * endpoints follow, and for the same reason: distinguishing them would confirm
 * which references exist.
 */
export async function getShortfall(user: AuthUser, shortfallId: string) {
  if (!isUuid(shortfallId)) throw notFound('That shortfall could not be found.');

  const row = await prisma.shortfall.findFirst({
    where: {
      id: shortfallId,
      application: { deletedAt: null, ...applicationScope(user) },
    },
    select: {
      ...LIST_SELECT,
      closedBy: { select: { id: true, name: true } },
    },
  });

  if (!row) throw notFound('That shortfall could not be found.');

  return {
    ...shapeListRow(row),
    closedByName: row.closedBy?.name ?? '',
    closureRemarks: row.closureRemarks,
    items: row.items.map((item, index) => {
      const responses = item.responses.map((r) => ({
        id: r.id,
        attemptNo: r.attemptNo,
        resolutionId: r.resolutionId,
        response: r.response,
        applicantRemarks: r.applicantRemarks,
        attachments: r.attachments,
        respondedAt: r.respondedAt,
        respondedByName: r.respondedBy?.name ?? '',
        decision: r.decision,
        reviewedAt: r.reviewedAt,
        reviewedByName: r.reviewedBy?.name ?? '',
        reviewRemarks: r.reviewRemarks,
      }));

      return {
        id: item.id,
        // 1-based, from the stored order. A number the applicant can quote
        // back — "item 3 of SF/2026/00123" — which is the whole point of
        // printing one beside each line of the letter.
        itemNo: item.displayOrder + 1 || index + 1,
        description: item.description,
        category: item.category,
        requiredAction: item.requiredAction,
        requiredDocument: item.requiredDocument || item.documentType?.name || '',
        remarks: item.remarks,
        status: item.status,
        isMandatory: item.isMandatory,
        amount: item.amount,
        isResolved: item.isResolved,
        resolvedAt: item.resolvedAt,
        documentTypeId: item.documentTypeId,
        documentTypeCode: item.documentType?.code ?? '',
        documentTypeName: item.documentType?.name ?? '',
        responses,
        /** The answer that counts right now — the newest one on record. */
        latestResponse: responses.length ? responses[responses.length - 1]! : null,
      };
    }),
    resolutions: row.resolutions.map((r) => ({
      id: r.id,
      attemptNo: r.attemptNo,
      response: r.response,
      attachments: r.attachments,
      respondedAt: r.respondedAt,
      respondedByName: r.respondedBy?.name ?? '',
      reviewedAt: r.reviewedAt,
      reviewedByName: r.reviewedBy?.name ?? '',
      accepted: r.accepted,
      reviewRemarks: r.reviewRemarks,
      /** The lines answered in THIS cycle, so history reads cycle by cycle. */
      items: row.items
        .flatMap((item) =>
          item.responses
            .filter((response) => response.attemptNo === r.attemptNo)
            .map((response) => ({
              itemId: item.id,
              itemNo: item.displayOrder + 1,
              description: item.description,
              category: item.category,
              response: response.response,
              applicantRemarks: response.applicantRemarks,
              attachments: response.attachments,
              decision: response.decision,
              reviewRemarks: response.reviewRemarks,
              reviewedByName: response.reviewedBy?.name ?? '',
              reviewedAt: response.reviewedAt,
            }))
        )
        .sort((a, b) => a.itemNo - b.itemNo),
    })),
  };
}

/** Open shortfalls on one application — the banner's source. */
export async function openShortfallsFor(user: AuthUser, applicationId: string) {
  const rows = await prisma.shortfall.findMany({
    where: {
      applicationId,
      status: { notIn: [...CLOSED_SHORTFALL_STATUSES] },
      application: { deletedAt: null, ...applicationScope(user) },
    },
    select: LIST_SELECT,
    orderBy: { raisedAt: 'asc' },
  });

  return rows.map(shapeListRow);
}

/** The counts behind the dashboard tile and the nav badge. */
export async function shortfallSummary(user: AuthUser) {
  const scope: Prisma.ShortfallWhereInput = {
    application: { deletedAt: null, ...applicationScope(user) },
  };

  const [open, awaitingApplicant, awaitingOfficer, overdue] = await Promise.all([
    prisma.shortfall.count({
      where: { AND: [scope, filterWhere(SHORTFALL_FILTERS.OPEN)] },
    }),
    prisma.shortfall.count({
      where: { AND: [scope, filterWhere(SHORTFALL_FILTERS.AWAITING_APPLICANT)] },
    }),
    prisma.shortfall.count({
      where: { AND: [scope, filterWhere(SHORTFALL_FILTERS.AWAITING_OFFICER)] },
    }),
    prisma.shortfall.count({
      where: { AND: [scope, filterWhere(SHORTFALL_FILTERS.OVERDUE)] },
    }),
  ]);

  return { open, awaitingApplicant, awaitingOfficer, overdue };
}

export type { ShortfallRow };
