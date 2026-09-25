'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PROFESSIONAL_REGISTER_LABEL, PROFESSIONAL_STATUSES, PROFESSIONAL_STATUS_LABEL, type ProfessionalRegister } from '@/lib/professional-registration';
import { fmtShort, selectClass, useRegister } from '@/features/proceedings/shared';
import type { Paged, ProfessionalRow, ProfessionalTypeOption } from './types';

export type ProfessionalFilters = { q: string; register: string; type: string; status: string };
export const EMPTY_PROFESSIONAL_FILTERS: ProfessionalFilters = { q: '', register: 'ALL', type: '', status: '' };

/** One of the professional registers — the tab chosen on the page — with search, type and status filters. */
export function ProfessionalRegisterTable({
  initial,
  initialFilters = EMPTY_PROFESSIONAL_FILTERS,
  types,
}: {
  initial: Paged<ProfessionalRow>;
  initialFilters?: ProfessionalFilters;
  types: ProfessionalTypeOption[];
}) {
  const r = useRegister<ProfessionalRow, ProfessionalFilters>('/api/professionals', initial, initialFilters);
  const register = r.filters.register as ProfessionalRegister;

  const columns = React.useMemo<ColumnDef<ProfessionalRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Registration',
        cell: ({ row }) => (
          <Link href={`/professionals/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.registrationNumber || 'Not yet registered'}
            <span className="block text-caption font-normal text-text-muted">
              {row.original.applicationNumber}
              {row.original.kind === 'RENEWAL' ? ' · renewal' : ''}
            </span>
          </Link>
        ),
      },
      {
        id: 'professional',
        header: 'Professional',
        cell: ({ row }) => (
          <span className="block max-w-[15rem]">
            <span className="block truncate font-medium text-text">{row.original.name}</span>
            <span className="block truncate text-caption text-text-muted">
              {row.original.typeLabel}
              {row.original.organization ? ` · ${row.original.organization}` : ''}
            </span>
          </span>
        ),
      },
      {
        id: 'licence',
        header: 'Licence',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {row.original.licenceNo || '—'}
            {row.original.account && <span className="block text-caption text-text-muted">portal: {row.original.account}</span>}
          </span>
        ),
      },
      { id: 'submitted', header: 'Submitted', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.submittedAt)}</span> },
      {
        id: 'validity',
        header: 'Valid To',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {fmtShort(row.original.validTo)}
            {row.original.renewalDueDate && (
              <span className={`block text-caption ${row.original.renewalDue ? 'font-medium text-warning' : 'text-text-muted'}`}>renewal due {fmtShort(row.original.renewalDueDate)}</span>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="space-y-0.5">
            <StatusBadge kind="professional" status={row.original.status} />
            {row.original.available && (
              <span className="flex items-center gap-1 text-caption text-success">
                <CheckCircle2 className="size-3" /> Available for applications
              </span>
            )}
            {row.original.currentDesk !== 'Closed' && <span className="block text-caption text-text-muted">{row.original.currentDesk}</span>}
            {row.original.openRenewal && (
              <Link href={`/professionals/${row.original.openRenewal.id}`} className="block text-caption text-primary hover:underline">
                Renewal {row.original.openRenewal.applicationNumber}
              </Link>
            )}
          </span>
        ),
      },
    ],
    []
  );

  const filtered = Boolean(r.filters.q || r.filters.type || r.filters.status);
  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by registration or application number, name, licence, organisation or email"
          placeholder="Search number, name, licence, organisation…"
          className="w-80"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Professional type" className={selectClass} value={r.filters.type} onChange={(e) => r.update({ type: e.target.value })}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
              {t.isActive ? '' : ' (retired)'}
            </option>
          ))}
        </select>
        {register === 'ALL' && (
          <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {PROFESSIONAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROFESSIONAL_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} in {PROFESSIONAL_REGISTER_LABEL[register] ?? 'register'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={filtered ? 'Nothing matches those filters' : `Nothing in ${PROFESSIONAL_REGISTER_LABEL[register] ?? 'this register'}`}
        emptyDescription={filtered ? 'Try widening the filters.' : 'Registrations appear here as they reach this stage.'}
      />
      <Pagination page={r.data.page} pageSize={r.data.pageSize} total={r.data.total} totalPages={r.data.totalPages} onPageChange={r.setPage} disabled={r.loading} noun="registration" />
    </div>
  );
}
