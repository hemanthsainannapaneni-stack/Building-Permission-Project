import type { Metadata } from 'next';
import { Ban, ClipboardList, SearchCheck, ShieldX } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isRevocationStatus } from '@/lib/revocation';
import { listRevocations, revocationSummary } from '@/server/services/revocations';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { RevocationRegister, EMPTY_REVOCATION_FILTERS } from '@/features/proceedings/revocation-register';
import type { Paged, RevocationRow } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Revoke Proceedings' };

/** The revoke proceeding register. */
export default async function RevocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.REVOCATION_VIEW);
  const sp = await searchParams;
  const status = sp.status === 'OPEN' || (sp.status && isRevocationStatus(sp.status)) ? sp.status : '';
  const [list, summary] = await Promise.all([listRevocations(user, { status: status || undefined }), revocationSummary(user)]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Revoke Proceedings"
        description="Proposals to revoke a granted permission — proposed, reviewed and decided through the workflow. A revoked file keeps its approval history."
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Proposed" value={summary.proposed} hint="Awaiting review" icon={ClipboardList} tone={summary.proposed ? 'warning' : 'neutral'} href="/revocations?status=PROPOSED" />
        <KpiCard label="Under review" value={summary.underReview} hint="Awaiting decision" icon={SearchCheck} tone={summary.underReview ? 'info' : 'neutral'} href="/revocations?status=UNDER_REVIEW" />
        <KpiCard label="Revoked" value={summary.revoked} hint="Proceeding revoked" icon={ShieldX} tone={summary.revoked ? 'danger' : 'neutral'} href="/revocations?status=REVOKED" />
        <KpiCard label="Rejected" value={summary.rejected} hint="Permission stands" icon={Ban} tone="neutral" href="/revocations?status=REJECTED" />
      </div>
      <RevocationRegister key={status} initial={serialize(list) as unknown as Paged<RevocationRow>} initialFilters={{ ...EMPTY_REVOCATION_FILTERS, status }} />
    </div>
  );
}
