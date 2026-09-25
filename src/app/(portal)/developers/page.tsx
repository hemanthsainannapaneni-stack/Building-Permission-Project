import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { can } from '@/server/auth/context';
import { CAPABILITIES } from '@/lib/constants';
import { DEVELOPER_REGISTERS, DEVELOPER_REGISTER_HINT, DEVELOPER_REGISTER_LABEL, isDeveloperRegister, type DeveloperRegister } from '@/lib/developer-registration';
import { developerRegisterSummary, listDeveloperRegistrations } from '@/server/services/developer-registrations';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DeveloperRegisterTable, EMPTY_DEVELOPER_FILTERS } from '@/features/developers/register';
import type { DeveloperRow, Paged } from '@/features/developers/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Developers' };

const TONE: Record<DeveloperRegister, string> = {
  ALL: 'text-text',
  PENDING: 'text-info',
  SHORTFALL: 'text-warning',
  APPROVED: 'text-success',
  REJECTED: 'text-danger',
  EXPIRED: 'text-danger',
  RENEWAL: 'text-warning',
};

/** The developer registers — one page, seven registers. */
export default async function DevelopersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.DEVELOPER_VIEW);
  const sp = await searchParams;
  const register: DeveloperRegister = sp.register && isDeveloperRegister(sp.register) ? sp.register : 'ALL';
  // The list sweeps lapsed validity first, so the counts are read after it.
  const list = await listDeveloperRegistrations(user, { register });
  const summary = await developerRegisterSummary(user);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Developers"
        description="Registration → documents → review → shortfall / verification → approval → validity → renewal."
        actions={
          can(user, CAPABILITIES.DEVELOPER_REGISTER) ? (
            <Button asChild>
              <Link href="/developers/new">
                <Plus className="size-4" /> New registration
              </Link>
            </Button>
          ) : undefined
        }
      />
      <nav aria-label="Registers" className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {DEVELOPER_REGISTERS.map((r) => (
          <Link
            key={r}
            href={r === 'ALL' ? '/developers' : `/developers?register=${r}`}
            aria-current={r === register ? 'page' : undefined}
            className={cn(
              'rounded border px-3 py-2 transition-colors',
              r === register ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-surface hover:bg-surface-sunk'
            )}
          >
            <span className="block text-caption text-text-muted">{DEVELOPER_REGISTER_LABEL[r]}</span>
            <span className={cn('block text-h3 font-semibold tabular-nums', summary[r] ? TONE[r] : 'text-text-muted')}>{summary[r]}</span>
            <span className="block truncate text-caption text-text-muted" title={DEVELOPER_REGISTER_HINT[r]}>
              {DEVELOPER_REGISTER_HINT[r]}
            </span>
          </Link>
        ))}
      </nav>
      <DeveloperRegisterTable key={register} initial={serialize(list) as unknown as Paged<DeveloperRow>} initialFilters={{ ...EMPTY_DEVELOPER_FILTERS, register }} />
    </div>
  );
}
