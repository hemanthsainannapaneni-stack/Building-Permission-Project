import type { Metadata } from 'next';
import { BadgeCheck, FileClock, FileWarning, Inbox } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { isNocStatus } from '@/lib/noc';
import { listNocs, nocRegisterMeta, nocSummary } from '@/server/services/nocs';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { NocRegister, EMPTY_NOC_FILTERS } from '@/features/nocs/noc-register';
import type { NocFilters, NocListPayload } from '@/features/nocs/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'NOCs' };

/** The NOC register — every no-objection certificate on every file in scope. */
export default async function NocsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.NOC_VIEW);
  const sp = await searchParams;
  const status = sp.status === 'OUTSTANDING' || (sp.status && isNocStatus(sp.status)) ? sp.status : '';
  const filters: NocFilters = { ...EMPTY_NOC_FILTERS, status };

  const [list, summary, meta] = await Promise.all([
    listNocs(user, { status: status || undefined }),
    nocSummary(user),
    nocRegisterMeta(user),
  ]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="NOCs"
        description="No-objection certificates from external authorities — Fire today, other kinds switched on by configuration. Applicability is the reviewing desk’s determination; nothing here is decided by a threshold."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="NOCs pending"
          value={summary.pending}
          hint="Not yet verified"
          icon={FileClock}
          tone={summary.pending ? 'warning' : 'neutral'}
          href="/nocs?status=OUTSTANDING"
        />
        <KpiCard
          label="Awaiting verification"
          value={summary.awaitingVerification}
          hint={summary.awaitingMe ? `${summary.awaitingMe} at your desk` : 'Received, not yet verified'}
          icon={Inbox}
          tone={summary.awaitingMe ? 'info' : 'neutral'}
          href="/nocs?status=RECEIVED"
        />
        <KpiCard label="Verified" value={summary.verified} hint={`${summary.notRequired} not required`} icon={BadgeCheck} tone="success" href="/nocs?status=VERIFIED" />
        <KpiCard
          label="Shortfall / rejected / expired"
          value={summary.shortfall + summary.rejected + summary.expired}
          hint={`${summary.shortfall} shortfall · ${summary.rejected} rejected · ${summary.expired} expired`}
          icon={FileWarning}
          tone={summary.shortfall + summary.rejected + summary.expired ? 'danger' : 'neutral'}
        />
      </div>

      <NocRegister
        key={status}
        initial={serialize({ ...list, summary, meta }) as unknown as NocListPayload}
        initialFilters={filters}
      />
    </div>
  );
}
