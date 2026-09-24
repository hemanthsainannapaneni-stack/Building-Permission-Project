import type { Metadata } from 'next';
import { CalendarClock, ClipboardCheck, MapPin, TriangleAlert } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { inspectionSummary, listInspections, registerMeta } from '@/server/services/site-inspections';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { InspectionRegister } from '@/features/inspections/inspection-register';
import type { InspectionListPayload } from '@/features/inspections/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Site Inspections' };

/** The site inspection register — TPA manual §5.8. */
export default async function InspectionsPage() {
  const user = await requirePageCapability(CAPABILITIES.SITE_INSPECTION_VIEW);

  const [list, summary, meta] = await Promise.all([
    listInspections(user, {}),
    inspectionSummary(user),
    registerMeta(user),
  ]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Site Inspections"
        description="Every site visit booked in your jurisdiction — the 27 questions (provisional demo wording), geo-tagged photographs with demo coordinates, the recommendation and the demo signature."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending"
          value={summary.scheduled + summary.inProgress}
          hint={`${summary.scheduled} scheduled · ${summary.inProgress} in progress`}
          icon={CalendarClock}
          tone="info"
        />
        <KpiCard label="Assigned to me" value={summary.mine} icon={MapPin} tone={summary.mine ? 'warning' : 'neutral'} />
        <KpiCard
          label="Completed"
          value={summary.submitted}
          hint={`${summary.recommended} recommended · ${summary.shortfall} shortfall · ${summary.reject} reject`}
          icon={ClipboardCheck}
          tone="success"
        />
        <KpiCard label="Overdue" value={summary.overdue} icon={TriangleAlert} tone={summary.overdue ? 'danger' : 'neutral'} />
      </div>

      <InspectionRegister initial={serialize({ ...list, summary, meta }) as unknown as InspectionListPayload} />
    </div>
  );
}
