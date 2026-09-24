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
import { SHOW_CAUSE_STATUSES, SHOW_CAUSE_STATUS_LABEL, responseDueLabel } from '@/lib/show-cause';
import { cn } from '@/lib/utils';
import { fmtShort, selectClass, useRegister } from './shared';
import type { Paged, ShowCauseRow } from './types';

export type ShowCauseFilters = { q: string; status: string };
export const EMPTY_SHOW_CAUSE_FILTERS: ShowCauseFilters = { q: '', status: '' };

/**
 * The show cause register — every notice on every file in scope. Separate
 * from the shortfall register by design: see src/lib/show-cause.ts.
 */
export function ShowCauseRegister({
  initial,
  initialFilters = EMPTY_SHOW_CAUSE_FILTERS,
}: {
  initial: Paged<ShowCauseRow>;
  initialFilters?: ShowCauseFilters;
}) {
  const r = useRegister<ShowCauseRow, ShowCauseFilters>('/api/show-causes', initial, initialFilters);

  const columns = React.useMemo<ColumnDef<ShowCauseRow, unknown>[]>(
    () => [
      {
        id: 'notice',
        header: 'Notice Number',
        cell: ({ row }) => (
          <Link href={`/show-cause/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.noticeNumber}
          </Link>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <Link href={`/applications/${row.original.application.id}?tab=proceedings`} className="whitespace-nowrap text-text hover:underline">
            {row.original.application.applicationNumber}
          </Link>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => <span className="block max-w-[11rem] truncate">{row.original.application.owner || '—'}</span>,
      },
      {
        id: 'violation',
        header: 'Violation',
        cell: ({ row }) => (
          <span className="block max-w-[18rem] truncate text-small" title={row.original.violation}>
            {row.original.violation}
          </span>
        ),
      },
      {
        id: 'issuedBy',
        header: 'Issued By',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {row.original.issuedByName}
            <span className="block text-caption text-text-muted">{row.original.issuedByRoleKey}</span>
          </span>
        ),
      },
      {
        id: 'issued',
        header: 'Issue Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.issuedAt)}</span>,
      },
      {
        id: 'due',
        header: 'Response Due',
        cell: ({ row }) => {
          const label = responseDueLabel(row.original.status, row.original.responseDueDate);
          return (
            <span className={cn('whitespace-nowrap tabular-nums', label.includes('past') ? 'font-medium text-warning' : 'text-text-muted')}>
              {fmtShort(row.original.responseDueDate)}
              {label && <span className="block text-caption">{label}</span>}
            </span>
          );
        },
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="showCause" status={row.original.status} /> },
      {
        id: 'desk',
        header: 'Current Desk',
        cell: ({ row }) => <span className="whitespace-nowrap text-small">{row.original.currentDesk}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by notice number, application number, violation or owner"
          placeholder="Search notice, application, owner…"
          className="w-64"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="OPEN">Open (not yet decided)</option>
          {SHOW_CAUSE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SHOW_CAUSE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {r.active && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} {r.data.total === 1 ? 'notice' : 'notices'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={r.active ? 'Nothing matches those filters' : 'No show cause notices yet'}
        emptyDescription={r.active ? 'Try widening the filters.' : 'Notices are issued from an application’s Proceedings tab, by the desk the workflow allows.'}
      />
      <Pagination
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        totalPages={r.data.totalPages}
        onPageChange={r.setPage}
        disabled={r.loading}
        noun="notice"
      />
    </div>
  );
}
