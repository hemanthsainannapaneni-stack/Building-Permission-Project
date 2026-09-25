'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEVELOPER_REGISTER_LABEL,
  DEVELOPER_STATUSES,
  DEVELOPER_STATUS_LABEL,
  DEVELOPER_TYPES,
  DEVELOPER_TYPE_LABEL,
  type DeveloperRegister,
  type DeveloperType,
} from '@/lib/developer-registration';
import { fmtShort, selectClass, useRegister } from '@/features/proceedings/shared';
import type { DeveloperRow, Paged } from './types';

export type DeveloperFilters = { q: string; register: string; type: string; status: string; dateFrom: string; dateTo: string };
export const EMPTY_DEVELOPER_FILTERS: DeveloperFilters = { q: '', register: 'ALL', type: '', status: '', dateFrom: '', dateTo: '' };

/** One of the developer registers — the tab chosen on the page — with search and a type filter. */
export function DeveloperRegisterTable({ initial, initialFilters = EMPTY_DEVELOPER_FILTERS }: { initial: Paged<DeveloperRow>; initialFilters?: DeveloperFilters }) {
  const r = useRegister<DeveloperRow, DeveloperFilters>('/api/developers', initial, initialFilters);
  const register = r.filters.register as DeveloperRegister;
  const filtered = Boolean(r.filters.q || r.filters.type || r.filters.status || r.filters.dateFrom || r.filters.dateTo);

  const columns = React.useMemo<ColumnDef<DeveloperRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Registration',
        cell: ({ row }) => (
          <Link href={`/developers/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.registrationNumber || 'Not yet registered'}
            <span className="block text-caption font-normal text-text-muted">
              {row.original.applicationNumber}
              {row.original.kind === 'RENEWAL' ? ' · renewal' : ''}
            </span>
          </Link>
        ),
      },
      {
        id: 'developer',
        header: 'Developer',
        cell: ({ row }) => (
          <span className="block max-w-[15rem]">
            <span className="block truncate font-medium text-text">{row.original.organization || row.original.developerName}</span>
            <span className="block truncate text-caption text-text-muted">
              {DEVELOPER_TYPE_LABEL[row.original.developerType as DeveloperType] ?? row.original.developerType} · {row.original.authorizedPerson || row.original.developerName}
            </span>
          </span>
        ),
      },
      { id: 'pan', header: 'PAN', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-small">{row.original.pan || '—'}</span> },
      { id: 'submitted', header: 'Submitted', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.submittedAt)}</span> },
      {
        id: 'validity',
        header: 'Valid To',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {fmtShort(row.original.validTo)}
            {row.original.renewalDueDate && (
              <span className={`block text-caption ${row.original.renewalDue ? 'font-medium text-warning' : 'text-text-muted'}`}>
                renewal due {fmtShort(row.original.renewalDueDate)}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="space-y-0.5">
            <StatusBadge kind="developer" status={row.original.status} />
            {row.original.currentDesk !== 'Closed' && <span className="block text-caption text-text-muted">{row.original.currentDesk}</span>}
            {row.original.openRenewal && (
              <Link href={`/developers/${row.original.openRenewal.id}`} className="block text-caption text-primary hover:underline">
                Renewal {row.original.openRenewal.applicationNumber}
              </Link>
            )}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by registration or application number, name, organisation, PAN or GSTIN"
          placeholder="Search number, developer, organisation, PAN, GSTIN…"
          className="w-80"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Developer type" className={selectClass} value={r.filters.type} onChange={(e) => r.update({ type: e.target.value })}>
          <option value="">All types</option>
          {DEVELOPER_TYPES.map((t) => (
            <option key={t} value={t}>
              {DEVELOPER_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {register === 'ALL' && (
          <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {DEVELOPER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DEVELOPER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-small text-text-muted">
          Submitted
          <Input aria-label="Submitted from" type="date" className="w-36" value={r.filters.dateFrom} onChange={(e) => r.update({ dateFrom: e.target.value })} />
          <span>to</span>
          <Input aria-label="Submitted to" type="date" className="w-36" value={r.filters.dateTo} onChange={(e) => r.update({ dateTo: e.target.value })} />
        </label>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} in {DEVELOPER_REGISTER_LABEL[register] ?? 'register'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={filtered ? 'Nothing matches those filters' : `Nothing in ${DEVELOPER_REGISTER_LABEL[register] ?? 'this register'}`}
        emptyDescription={filtered ? 'Try widening the filters.' : 'Registrations appear here as they reach this stage.'}
      />
      <Pagination page={r.data.page} pageSize={r.data.pageSize} total={r.data.total} totalPages={r.data.totalPages} onPageChange={r.setPage} disabled={r.loading} noun="registration" />
    </div>
  );
}
