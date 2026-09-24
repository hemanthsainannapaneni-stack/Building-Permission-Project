import type { Metadata } from 'next';
import { Award, ClipboardCheck, FileWarning, Hourglass, Send, ThumbsUp } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isOccupancyRegisterState } from '@/lib/occupancy';
import { listOccupancy, occupancySummary } from '@/server/services/occupancy';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { OccupancyRegister, EMPTY_OCCUPANCY_FILTERS } from '@/features/occupancy/register';
import type { OccupancyRow, Paged } from '@/features/occupancy/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Occupancy' };

/** The occupancy register. */
export default async function OccupancyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.OCCUPANCY_VIEW);
  const sp = await searchParams;
  const state = sp.state && isOccupancyRegisterState(sp.state) ? sp.state : '';
  const [list, s] = await Promise.all([listOccupancy(user, { state: state || undefined }), occupancySummary(user)]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Occupancy"
        description="Completion intimation → occupancy submission → final inspection → as-built review → recommendation → occupancy certificate."
      />
      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Completion pending" value={s.COMPLETION_PENDING} hint="Work under way" icon={Hourglass} tone="neutral" href="/occupancy?state=COMPLETION_PENDING" />
        <KpiCard label="Submitted" value={s.SUBMITTED + s.INSPECTION_PENDING} hint="Awaiting final inspection" icon={Send} tone={s.SUBMITTED + s.INSPECTION_PENDING ? 'info' : 'neutral'} href="/occupancy?state=INSPECTION_PENDING" />
        <KpiCard label="Under review" value={s.INSPECTION_COMPLETED + s.RECOMMENDED} hint="Inspected, not yet decided" icon={ClipboardCheck} tone={s.INSPECTION_COMPLETED + s.RECOMMENDED ? 'warning' : 'neutral'} href="/occupancy?state=INSPECTION_COMPLETED" />
        <KpiCard label="Shortfall" value={s.SHORTFALL} hint="With the applicant" icon={FileWarning} tone={s.SHORTFALL ? 'danger' : 'neutral'} href="/occupancy?state=SHORTFALL" />
        <KpiCard label="Approved" value={s.APPROVED} hint="Certificate to issue" icon={ThumbsUp} tone={s.APPROVED ? 'success' : 'neutral'} href="/occupancy?state=APPROVED" />
        <KpiCard label="Certificates" value={s.CERTIFICATE_ISSUED} hint={`${s.REJECTED} rejected`} icon={Award} tone={s.CERTIFICATE_ISSUED ? 'success' : 'neutral'} href="/occupancy?state=CERTIFICATE_ISSUED" />
      </div>
      <OccupancyRegister key={state} initial={serialize(list) as unknown as Paged<OccupancyRow>} initialFilters={{ ...EMPTY_OCCUPANCY_FILTERS, state }} />
    </div>
  );
}
