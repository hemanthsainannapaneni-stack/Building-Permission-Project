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
import { REVOCATION_STATUSES, REVOCATION_STATUS_LABEL } from '@/lib/revocation';
import { fmtShort, selectClass, useRegister } from './shared';
import type { Paged, RevocationRow } from './types';

export type RevocationFilters = { q: string; status: string };
export const EMPTY_REVOCATION_FILTERS: RevocationFilters = { q: '', status: '' };

const DECISION: Record<string, string> = { REVOKED: 'Revoked', REJECTED: 'Rejected' };

/** The revocation proceeding register. */
export function RevocationRegister({
  initial,
  initialFilters = EMPTY_REVOCATION_FILTERS,
}: {
  initial: Paged<RevocationRow>;
  initialFilters?: RevocationFilters;
}) {
  const r = useRegister<RevocationRow, RevocationFilters>('/api/revocations', initial, initialFilters);

  const columns = React.useMemo<ColumnDef<RevocationRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Revocation Number',
        cell: ({ row }) => (
          <Link href={`/revocations/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.revocationNumber}
          </Link>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <div>
            <Link href={`/applications/${row.original.application.id}?tab=proceedings`} className="whitespace-nowrap text-text hover:underline">
              {row.original.application.applicationNumber}
            </Link>
            <p className="max-w-[11rem] truncate text-caption text-text-muted">{row.original.application.owner || '—'}</p>
          </div>
        ),
      },
      {
        id: 'bpo',
        header: 'BPO / Proceeding',
        cell: ({ row }) => <span className="whitespace-nowrap text-small">{row.original.orderNumber || '—'}</span>,
      },
      {
        id: 'initiated',
        header: 'Initiated By',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {row.original.initiatedByName}
            <span className="block text-caption text-text-muted">{row.original.initiatedByRoleKey}</span>
          </span>
        ),
      },
      {
        id: 'date',
        header: 'Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.initiatedAt)}</span>,
      },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <span className="block max-w-[16rem] truncate text-small" title={row.original.reason}>
            {row.original.reason}
          </span>
        ),
      },
      {
        id: 'grounds',
        header: 'Grounds',
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate text-small" title={row.original.grounds.join('\n')}>
            {row.original.grounds.length} ground{row.original.grounds.length === 1 ? '' : 's'}
            {row.original.grounds[0] ? ` — ${row.original.grounds[0]}` : ''}
          </span>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="revocation" status={row.original.status} /> },
      {
        id: 'decision',
        header: 'Decision',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {DECISION[row.original.decision] ?? '—'}
            {row.original.revocationOrderNumber && (
              <span className="block text-caption text-text-muted">Order {row.original.revocationOrderNumber}</span>
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
          aria-label="Search by revocation number, BPO number, application or reason"
          placeholder="Search revocation, BPO, application…"
          className="w-64"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="OPEN">Open (not yet decided)</option>
          {REVOCATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REVOCATION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {r.active && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} {r.data.total === 1 ? 'proceeding' : 'proceedings'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={r.active ? 'Nothing matches those filters' : 'No revocation proceedings'}
        emptyDescription={r.active ? 'Try widening the filters.' : 'A revocation is initiated on an approved file, from its Proceedings tab or a show cause decision.'}
      />
      <Pagination
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        totalPages={r.data.totalPages}
        onPageChange={r.setPage}
        disabled={r.loading}
        noun="proceeding"
      />
    </div>
  );
}
