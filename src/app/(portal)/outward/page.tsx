import type { Metadata } from 'next';
import { CheckCheck, Inbox, Truck, Undo2 } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { can } from '@/server/auth/context';
import { CAPABILITIES } from '@/lib/constants';
import { isOutwardDocumentType, isOutwardStatus } from '@/lib/outward';
import { listOutward, outwardSummary } from '@/server/services/outward';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/common/kpi-card';
import { OutwardRegister, EMPTY_OUTWARD_FILTERS } from '@/features/proceedings/outward-register';
import type { OutwardRow, Paged } from '@/features/proceedings/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Outward Register' };

/** The Outward register. */
export default async function OutwardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.OUTWARD_VIEW);
  const sp = await searchParams;
  const status = sp.status === 'PENDING' || (sp.status && isOutwardStatus(sp.status)) ? sp.status : '';
  const documentType = sp.documentType && isOutwardDocumentType(sp.documentType) ? sp.documentType : '';
  const [list, summary] = await Promise.all([
    listOutward(user, { status: status || undefined, documentType: documentType || undefined }),
    outwardSummary(user),
  ]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Outward Register"
        description="Every document leaving the office — BPOs, letters, show cause notices and revocation orders — with dispatch, delivery and acknowledgement."
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Awaiting dispatch" value={summary.pending} hint={`${summary.ready} ready for dispatch`} icon={Inbox} tone={summary.pending ? 'warning' : 'neutral'} href="/outward?status=PENDING" />
        <KpiCard label="In transit" value={summary.inTransit} hint="Dispatched, not yet delivered" icon={Truck} tone="info" href="/outward?status=DISPATCHED" />
        <KpiCard label="Delivered" value={summary.delivered} hint={`${summary.acknowledged} acknowledged`} icon={CheckCheck} tone="success" href="/outward?status=ACKNOWLEDGED" />
        <KpiCard label="Returned" value={summary.returned} hint="Came back undelivered" icon={Undo2} tone={summary.returned ? 'danger' : 'neutral'} href="/outward?status=RETURNED" />
      </div>
      <OutwardRegister
        key={`${status}|${documentType}`}
        initial={serialize(list) as unknown as Paged<OutwardRow>}
        initialFilters={{ ...EMPTY_OUTWARD_FILTERS, status, documentType }}
        canManage={can(user, CAPABILITIES.OUTWARD_MANAGE)}
      />
    </div>
  );
}
