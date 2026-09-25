import type { Metadata } from 'next';
import { FileClock, FileCheck2, HardHat, CalendarClock } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isCommencementState } from '@/lib/commencement';
import { listWorkCommencements, workCommencementSummary } from '@/server/services/work-commencements';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { CommencementRegister, EMPTY_COMMENCEMENT_FILTERS } from '@/features/commencement/register';
import type { CommencementRow, Paged } from '@/features/commencement/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Work Initiated' };

/** The Work Initiated register — approved files, their proceedings and commencement. */
export default async function WorkInitiatedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.COMMENCEMENT_VIEW);
  const sp = await searchParams;
  const state = sp.state && isCommencementState(sp.state) ? sp.state : '';
  const [list, summary] = await Promise.all([listWorkCommencements(user, { state: state || undefined }), workCommencementSummary(user)]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Work Initiated"
        description="After approval: Approved → Proceeding issued → Work initiated. The LTP notifies commencement once the building permission order is issued."
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Proceeding not issued" value={summary.awaiting} hint="Approved, order not yet issued" icon={FileClock} tone="neutral" href="/work-initiated?state=AWAITING_PROCEEDING" />
        <KpiCard label="Proceeding issued" value={summary.issued} hint="Commencement not yet notified" icon={FileCheck2} tone={summary.issued ? 'info' : 'neutral'} href="/work-initiated?state=PROCEEDING_ISSUED" />
        <KpiCard label="Pending commencement" value={summary.pending} hint="Notified, start date to come" icon={CalendarClock} tone={summary.pending ? 'warning' : 'neutral'} href="/work-initiated?state=PENDING_COMMENCEMENT" />
        <KpiCard label="Work initiated" value={summary.initiated} hint="Work under way on site" icon={HardHat} tone={summary.initiated ? 'success' : 'neutral'} href="/work-initiated?state=WORK_INITIATED" />
      </div>
      <CommencementRegister
        key={state}
        initial={serialize(list) as unknown as Paged<CommencementRow>}
        initialFilters={{ ...EMPTY_COMMENCEMENT_FILTERS, state }}
      />
    </div>
  );
}
