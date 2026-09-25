import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { APPLICATION_STATUSES } from '@/lib/status';
import { ORDER_STATUS } from '@/lib/approval-orders';
import { isDashboardStatusFilter, type DashboardStatusFilter } from '@/lib/public-portal';
import { ROLES } from '@/lib/constants';
import { PORTAL_STATUS, PORTAL_STATUS_LABEL, portalStatus, type PortalStatus } from './status';
import { ltpTypes } from './registers';

/**
 * THE PUBLIC DASHBOARD — counts, and only counts.
 *
 * Not the officer dashboard, and it shares none of its code: that one is
 * scoped by the caller's zones and roles and reads task queues; this one has no
 * caller. It answers a single kind of question — "how many" — with aggregates
 * over the same tables, filtered by three things the public can see for
 * themselves (a date range, a permission type, a public status).
 *
 * What it can never return is a row. No application number, no applicant, no
 * officer, no desk, no SLA state. A count of one is still a count, and at demo
 * scale nobody is being singled out by a number.
 *
 * Every figure is a `count` or `groupBy` on the database. Nothing here is a
 * constant.
 */

export type PublicDashboardQuery = { from?: string; to?: string; type?: string; status?: string };

export type PublicDashboard = {
  filters: { from: string; to: string; type: string; status: DashboardStatusFilter };
  types: { code: string; name: string }[];
  kpis: {
    total: number;
    submitted: number;
    approved: number;
    underProcess: number;
    shortfall: number;
    /** Submitted and not yet decided: under process, or waiting on the applicant. */
    pending: number;
    bposIssued: number;
  };
  /** Registrations in force today. Not narrowed by the filters above, which describe applications. */
  registers: { developers: number; ltps: number; tpas: number };
  byStatus: { key: PortalStatus; label: string; count: number }[];
  byType: { code: string; name: string; count: number }[];
  asOf: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | undefined) => (v && DAY.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : '');

/** Every internal status that maps to a public status — and which side of "submitted" it is counted on. */
function statusesFor(key: PortalStatus, submitted: boolean): string[] {
  return APPLICATION_STATUSES.filter((s) => portalStatus(s, submitted) === key);
}

export async function getPublicDashboard(query: PublicDashboardQuery = {}): Promise<PublicDashboard> {
  const from = day(query.from);
  const to = day(query.to);
  const statusFilter: DashboardStatusFilter = isDashboardStatusFilter(query.status ?? '') ? (query.status as DashboardStatusFilter) : '';

  const types = await prisma.applicationType.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { code: true, name: true } });
  const type = types.some((t) => t.code === query.type) ? (query.type as string) : '';

  // The date a file "entered the system": when it was submitted, or — for one still
  // being prepared — when it was started.
  const range = { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
  const dated: Prisma.ApplicationWhereInput[] =
    from || to ? [{ OR: [{ submittedAt: range }, { submittedAt: null, createdAt: range }] }] : [];

  const base: Prisma.ApplicationWhereInput = {
    deletedAt: null,
    ...(type ? { applicationType: { code: type } } : {}),
    AND: dated,
  };

  // The status filter is applied in the public vocabulary and translated to the statuses
  // (on the right side of "submitted") that map to it.
  const statusClause: Prisma.ApplicationWhereInput[] = [];
  if (statusFilter) {
    const key = statusFilter as PortalStatus;
    statusClause.push({
      OR: [
        { submittedAt: { not: null }, status: { in: statusesFor(key, true) } },
        { submittedAt: null, status: { in: statusesFor(key, false) } },
      ],
    });
  }
  const where: Prisma.ApplicationWhereInput = { ...base, AND: [...dated, ...statusClause] };

  const [submittedGroups, unsubmittedGroups, typeGroups, bposIssued, registers] = await Promise.all([
    prisma.application.groupBy({ by: ['status'], where: { ...where, submittedAt: { not: null } }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['status'], where: { ...where, submittedAt: null }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['applicationTypeId'], where, _count: { _all: true } }),
    prisma.approvalOrder.count({ where: { status: ORDER_STATUS.ISSUED, application: where } }),
    registerCounts(),
  ]);

  const tally = new Map<PortalStatus, number>();
  const add = (key: PortalStatus, n: number) => tally.set(key, (tally.get(key) ?? 0) + n);
  let submitted = 0;
  let unsubmitted = 0;
  for (const g of submittedGroups) {
    submitted += g._count._all;
    add(portalStatus(g.status, true), g._count._all);
  }
  for (const g of unsubmittedGroups) {
    unsubmitted += g._count._all;
    add(portalStatus(g.status, false), g._count._all);
  }

  const typeName = new Map((await prisma.applicationType.findMany({ select: { id: true, code: true, name: true } })).map((t) => [t.id, t] as const));
  const byType = typeGroups
    .map((g) => ({ code: typeName.get(g.applicationTypeId)?.code ?? '', name: typeName.get(g.applicationTypeId)?.name ?? 'Other', count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  const order: PortalStatus[] = [PORTAL_STATUS.UNDER_PROCESS, PORTAL_STATUS.WITH_APPLICANT, PORTAL_STATUS.APPROVED, PORTAL_STATUS.NOT_APPROVED, PORTAL_STATUS.CLOSED, PORTAL_STATUS.NOT_SUBMITTED];

  return {
    filters: { from, to, type, status: statusFilter },
    types,
    kpis: {
      total: submitted + unsubmitted,
      submitted,
      approved: tally.get(PORTAL_STATUS.APPROVED) ?? 0,
      underProcess: tally.get(PORTAL_STATUS.UNDER_PROCESS) ?? 0,
      shortfall: tally.get(PORTAL_STATUS.WITH_APPLICANT) ?? 0,
      pending: (tally.get(PORTAL_STATUS.UNDER_PROCESS) ?? 0) + (tally.get(PORTAL_STATUS.WITH_APPLICANT) ?? 0),
      bposIssued,
    },
    registers,
    byStatus: order.map((key) => ({ key, label: PORTAL_STATUS_LABEL[key], count: tally.get(key) ?? 0 })),
    byType,
    asOf: new Date().toISOString(),
  };
}

/** The three registers, counted the way the public lists show them: in force today, one per registered party. */
async function registerCounts() {
  const now = new Date();
  const codes = (await ltpTypes()).map((t) => t.code);
  const [developers, ltps, tpas] = await Promise.all([
    prisma.developerRegistration.count({ where: { isCurrent: true, status: 'APPROVED', registrationNumber: { not: null }, validTo: { gte: now } } }),
    codes.length
      ? prisma.professionalRegistration.count({ where: { isCurrent: true, status: 'APPROVED', registrationNumber: { not: null }, validTo: { gte: now }, professionalType: { in: codes } } })
      : Promise.resolve(0),
    prisma.user.count({
      where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: ROLES.TPA } } }, AND: [{ roles: { none: { role: { key: ROLES.SYSTEM_ADMIN } } } }] },
    }),
  ]);
  return { developers, ltps, tpas };
}
