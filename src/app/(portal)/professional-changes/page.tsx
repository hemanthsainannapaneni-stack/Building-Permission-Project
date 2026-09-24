import type { Metadata } from 'next';
import { Ban, ClipboardList, SearchCheck, UserRoundCheck } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isProfessionalChangeStatus } from '@/lib/professional-change';
import { listProfessionalChanges, professionalChangeSummary } from '@/server/services/professional-changes';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { ProfessionalChangeRegister, EMPTY_PROFESSIONAL_CHANGE_FILTERS } from '@/features/professional-change/register';
import type { Paged, ProfessionalChangeRow } from '@/features/professional-change/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Change of Technical Professional' };

/** The change of technical professional register. */
export default async function ProfessionalChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.PROFESSIONAL_CHANGE_VIEW);
  const sp = await searchParams;
  const status = sp.status === 'OPEN' || (sp.status && isProfessionalChangeStatus(sp.status)) ? sp.status : '';
  const [list, summary] = await Promise.all([
    listProfessionalChanges(user, { status: status || undefined }),
    professionalChangeSummary(user),
  ]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Change of Technical Professional"
        description="Owners’ requests to replace the professional on a file — registered, verified, reviewed and decided through the workflow. A replaced professional stays in the file’s history."
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending" value={summary.pending} hint="Awaiting verification" icon={ClipboardList} tone={summary.pending ? 'warning' : 'neutral'} href="/professional-changes?status=PENDING_VERIFICATION" />
        <KpiCard label="Under review" value={summary.underReview} hint="Verified, not yet decided" icon={SearchCheck} tone={summary.underReview ? 'info' : 'neutral'} href="/professional-changes?status=OPEN" />
        <KpiCard label="Approved" value={summary.approved} hint="Professional changed" icon={UserRoundCheck} tone={summary.approved ? 'success' : 'neutral'} href="/professional-changes?status=APPROVED" />
        <KpiCard label="Rejected" value={summary.rejected} hint="Professional unchanged" icon={Ban} tone="neutral" href="/professional-changes?status=REJECTED" />
      </div>
      <ProfessionalChangeRegister
        key={status}
        initial={serialize(list) as unknown as Paged<ProfessionalChangeRow>}
        initialFilters={{ ...EMPTY_PROFESSIONAL_CHANGE_FILTERS, status }}
      />
    </div>
  );
}
