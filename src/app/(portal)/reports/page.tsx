import type { Metadata } from 'next';
import { requirePageUser } from '@/server/auth/page-guard';
import { ReportsDashboard } from '@/features/reports/reports-dashboard';
import { fetchDashboardData } from './actions';
import { ReportsErrorBoundary } from '@/features/reports/error-boundary';

export const metadata: Metadata = { title: 'Reports & Analytics' };
export const dynamic = 'force-dynamic';

/**
 * Reports is an internal screen like every other page in the portal.
 *
 * `requirePageUser()` sends an unauthenticated visitor to the sign-in page by
 * THROWING Next's redirect signal. It must therefore not be wrapped in a
 * try/catch here: catching it swallows the redirect and renders the error
 * branch instead, which is how this page came to show a stack trace to anyone
 * who opened it signed out. Render failures inside the dashboard are handled
 * where they belong — in ReportsErrorBoundary, on the client.
 */
export default async function ReportsPage() {
  await requirePageUser();
  const data = await fetchDashboardData();

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Reports &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground">Comprehensive executive metrics, trends, and officer workloads.</p>
        </div>
      </div>
      <ReportsErrorBoundary>
        <ReportsDashboard initialData={data} />
      </ReportsErrorBoundary>
    </div>
  );
}
