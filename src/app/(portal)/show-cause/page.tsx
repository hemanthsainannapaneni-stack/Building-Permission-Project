import type { Metadata } from 'next';
import { Gavel, Hourglass, MailCheck, Send } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isShowCauseStatus } from '@/lib/show-cause';
import { listShowCauses, showCauseSummary } from '@/server/services/show-cause';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { ShowCauseRegister, EMPTY_SHOW_CAUSE_FILTERS } from '@/features/proceedings/show-cause-register';
import type { Paged, ShowCauseRow } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Show Cause' };

/** The show cause register — separate from shortfalls, by design. */
export default async function ShowCausePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.SHOW_CAUSE_VIEW);
  const sp = await searchParams;
  const status = sp.status === 'OPEN' || (sp.status && isShowCauseStatus(sp.status)) ? sp.status : '';
  const [list, summary] = await Promise.all([listShowCauses(user, { status: status || undefined }), showCauseSummary(user)]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Show Cause"
        description="Notices asking an applicant to explain an observation, their responses, and the department’s decisions. Not shortfalls: a notice never parks a file."
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Awaiting dispatch" value={summary.awaitingDispatch} hint="Issued, not yet sent from Outward" icon={Send} tone={summary.awaitingDispatch ? 'warning' : 'neutral'} href="/show-cause?status=ISSUED" />
        <KpiCard
          label="Awaiting response"
          value={summary.awaitingResponse}
          hint={summary.pastDue ? `${summary.pastDue} past the due date` : 'With the applicant'}
          icon={Hourglass}
          tone="info"
          href="/show-cause?status=AWAITING_RESPONSE"
        />
        <KpiCard label="Awaiting decision" value={summary.awaitingDecision} hint="Answered, with the desk" icon={MailCheck} tone={summary.awaitingDecision ? 'warning' : 'neutral'} href="/show-cause?status=OPEN" />
        <KpiCard label="Decided" value={summary.decided} hint={`${summary.closed} closed · ${summary.referred} referred for revocation`} icon={Gavel} tone="success" />
      </div>
      <ShowCauseRegister key={status} initial={serialize(list) as unknown as Paged<ShowCauseRow>} initialFilters={{ ...EMPTY_SHOW_CAUSE_FILTERS, status }} />
    </div>
  );
}
