import type { Metadata } from 'next';
import Link from 'next/link';
import { FilePlus2, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requirePageUser } from '@/server/auth/page-guard';
import { dashboardFor } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { getDashboardStats, getRecentApplications } from '@/server/services/applications';
import { consolidatedView, dashboardData, recentActivity } from '@/server/services/analytics';
import { listTasks, taskSummary } from '@/server/workflow/tasks';
import { serialize } from '@/server/http/serialize';
import { LtpDashboard } from '@/features/dashboard/ltp-dashboard';
import type { ApplicationRow } from '@/features/applications/types';
import {
  OfficerDashboard,
  ExecutiveDashboard,
  FinanceDashboard,
  AdminDashboard,
  ViewerDashboard,
  type ExecutiveRole,
} from '@/features/dashboard/dashboards';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * One route, six dashboards, chosen on the SERVER from the user's roles.
 *
 * Deciding here rather than in the client means a role never downloads a
 * dashboard it is not entitled to see, and there is no flash of the wrong one.
 * Every dashboard reads `src/server/services/analytics.ts`, which scopes each
 * query to this user — so the totals differ between roles because the ROWS
 * differ, not because the screens count differently.
 */
export default async function DashboardPage() {
  const user = await requirePageUser();
  const roleKeys = user.roleKeys as RoleKey[];
  const kind = dashboardFor(roleKeys);

  const greeting = `${timeOfDay()}, ${user.name.split(' ')[0]}`;

  // ── The applicant ─────────────────────────────────────────────────────
  if (kind === 'ltp') {
    const [stats, recent, activity] = await Promise.all([
      getDashboardStats(user),
      getRecentApplications(user, 8),
      recentActivity(user, 8),
    ]);

    return (
      <>
        {/* PageHeader removed by user request to move stat cards up */}
        <div className="mb-4 flex justify-end">
          <Button asChild variant="primary">
            <Link href="/applications/new">
              <FilePlus2 className="size-4" />
              New application
            </Link>
          </Button>
        </div>
        <LtpDashboard
          name={user.name}
          counts={stats.counts}
          recent={recent as unknown as ApplicationRow[]}
          activity={activity}
        />
      </>
    );
  }

  // ── The System Administrator ──────────────────────────────────────────
  if (kind === 'admin') {
    const [data, consolidated, activity] = await Promise.all([
      dashboardData(user),
      consolidatedView(user),
      recentActivity(user, 15),
    ]);

    return (
      <>
        <AdminDashboard data={data} consolidated={consolidated} activity={activity} />
      </>
    );
  }

  // ── The senior desks ──────────────────────────────────────────────────
  if (kind === 'executive') {
    const [data, summary] = await Promise.all([dashboardData(user), taskSummary(user)]);

    const role: ExecutiveRole = roleKeys.includes(ROLES.COMMISSIONER)
      ? 'COMMISSIONER'
      : roleKeys.includes(ROLES.ADDL_COMMISSIONER)
        ? 'ADDL_COMMISSIONER'
        : 'DIRECTOR_DP';

    return (
      <>
        {/* PageHeader removed by user request */}
        <div className="mb-4 flex justify-end">
          <Button asChild variant="primary">
            <Link href="/tasks">
              <ListChecks className="size-4" />
              Open the queue
            </Link>
          </Button>
        </div>
        <ExecutiveDashboard data={data} role={role} queue={summary} />
      </>
    );
  }

  // ── Finance ───────────────────────────────────────────────────────────
  if (kind === 'finance') {
    const data = await dashboardData(user);

    return (
      <>
        <PageHeader title={greeting} />
        <FinanceDashboard data={data} />
      </>
    );
  }

  // ── Oversight ─────────────────────────────────────────────────────────
  if (kind === 'viewer') {
    const data = await dashboardData(user);

    return (
      <>
        <PageHeader title={greeting} />
        <ViewerDashboard data={data} />
      </>
    );
  }

  // ── The review desks ──────────────────────────────────────────────────
  const [data, summary, queue] = await Promise.all([
    dashboardData(user),
    taskSummary(user),
    listTasks(user, { sort: 'received', dir: 'asc', pageSize: 6 }),
  ]);

  return (
    <>
      <PageHeader
        title={greeting}
        actions={
          <Button asChild variant="primary">
            <Link href="/tasks">
              <ListChecks className="size-4" />
              Open the queue
            </Link>
          </Button>
        }
      />
      <OfficerDashboard
        summary={summary}
        data={data}
        roleLabel={ROLE_LABELS[roleKeys[0] as RoleKey] ?? 'review'}
        recent={serialize(queue.rows) as Parameters<typeof OfficerDashboard>[0]['recent']}
      />
    </>
  );
}

const ROLE_LABELS: Partial<Record<RoleKey, string>> = {
  TPA: 'Town Planning Assistant',
  ZAD: 'Zonal Assistant Director',
  ZDD: 'Zonal Deputy Director',
  ZJD: 'Zonal Joint Director',
};

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
