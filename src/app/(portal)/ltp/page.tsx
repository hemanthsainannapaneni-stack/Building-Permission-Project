import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { can } from '@/server/auth/context';
import { CAPABILITIES } from '@/lib/constants';
import { PROFESSIONAL_REGISTERS, PROFESSIONAL_REGISTER_HINT, PROFESSIONAL_REGISTER_LABEL, isProfessionalRegister, type ProfessionalRegister } from '@/lib/professional-registration';
import { listProfessionalRegistrations, professionalRegisterSummary, professionalTypes } from '@/server/services/professional-registrations';
import { serialize } from '@/server/http/serialize';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EMPTY_PROFESSIONAL_FILTERS, ProfessionalRegisterTable } from '@/features/professionals/register';
import type { Paged, ProfessionalRow } from '@/features/professionals/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'LTP — Licensed Technical Persons' };

const TONE: Record<ProfessionalRegister, string> = {
  ALL: 'text-text',
  PENDING: 'text-info',
  IN_PROCESS: 'text-purple',
  SHORTFALL: 'text-warning',
  VERIFIED: 'text-info',
  REJECTED: 'text-danger',
  EXPIRED: 'text-danger',
  RENEWAL: 'text-warning',
};

/** The professional registers — one page, eight registers. */
export default async function ProfessionalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageCapability(CAPABILITIES.LTP_REG_VIEW);
  const sp = await searchParams;
  const register: ProfessionalRegister = sp.register && isProfessionalRegister(sp.register) ? sp.register : 'ALL';
  // The list sweeps lapsed validity first, so the counts are read after it.
  const list = await listProfessionalRegistrations(user, { register });
  const [summary, types] = await Promise.all([professionalRegisterSummary(user), professionalTypes()]);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="LTP — Licensed Technical Persons"
        description={`Registration → review → shortfall / verification → approval → available for applications → renewal. ${summary.AVAILABLE} LTP${summary.AVAILABLE === 1 ? ' is' : 's are'} approved and in force.`}
        actions={
          can(user, CAPABILITIES.LTP_REG_REGISTER) ? (
            <Button asChild>
              <Link href="/ltp/new">
                <Plus className="size-4" /> New registration
              </Link>
            </Button>
          ) : undefined
        }
      />
      <nav aria-label="Registers" className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {PROFESSIONAL_REGISTERS.map((r) => (
          <Link
            key={r}
            href={r === 'ALL' ? '/ltp' : `/ltp?register=${r}`}
            aria-current={r === register ? 'page' : undefined}
            className={cn('rounded border px-3 py-2 transition-colors', r === register ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-surface hover:bg-surface-sunk')}
          >
            <span className="block text-caption text-text-muted">{PROFESSIONAL_REGISTER_LABEL[r]}</span>
            <span className={cn('block text-h3 font-semibold tabular-nums', summary[r] ? TONE[r] : 'text-text-muted')}>{summary[r]}</span>
            <span className="block truncate text-caption text-text-muted" title={PROFESSIONAL_REGISTER_HINT[r]}>
              {PROFESSIONAL_REGISTER_HINT[r]}
            </span>
          </Link>
        ))}
      </nav>
      <ProfessionalRegisterTable
        key={register}
        types={types}
        initial={serialize(list) as unknown as Paged<ProfessionalRow>}
        initialFilters={{ ...EMPTY_PROFESSIONAL_FILTERS, register }}
      />
    </div>
  );
}
