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
import { OCCUPANCY_REGISTER_STATES, OCCUPANCY_STATE_LABEL } from '@/lib/occupancy';
import { fmtShort, selectClass, useRegister } from '@/features/proceedings/shared';
import type { OccupancyRow, Paged } from './types';

export type OccupancyFilters = { q: string; state: string };
export const EMPTY_OCCUPANCY_FILTERS: OccupancyFilters = { q: '', state: '' };

/** The occupancy register: every file whose work has started, and where its occupancy stands. */
export function OccupancyRegister({ initial, initialFilters = EMPTY_OCCUPANCY_FILTERS }: { initial: Paged<OccupancyRow>; initialFilters?: OccupancyFilters }) {
  const r = useRegister<OccupancyRow, OccupancyFilters>('/api/occupancy', initial, initialFilters);

  const columns = React.useMemo<ColumnDef<OccupancyRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Occupancy Number',
        cell: ({ row }) => (
          <Link href={`/occupancy/${row.original.applicationId}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.occupancyNumber || 'Not yet applied'}
            {row.original.certificateNumber && <span className="block text-caption font-normal text-text-muted">{row.original.certificateNumber}</span>}
          </Link>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <Link href={`/applications/${row.original.applicationId}?tab=occupancy`} className="whitespace-nowrap text-text hover:underline">
            {row.original.applicationNumber}
          </Link>
        ),
      },
      { id: 'bpo', header: 'BPO', cell: ({ row }) => <span className="whitespace-nowrap text-small">{row.original.orderNumber || '—'}</span> },
      { id: 'owner', header: 'Owner', cell: ({ row }) => <span className="block max-w-[10rem] truncate text-small">{row.original.owner || '—'}</span> },
      { id: 'completion', header: 'Completion Date', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtShort(row.original.completionDate)}</span> },
      { id: 'submission', header: 'Submission Date', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.submissionDate)}</span> },
      {
        id: 'inspection',
        header: 'Inspection Date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-text-muted">
            {fmtShort(row.original.inspectionDate)}
            {row.original.inspectionDate && !row.original.inspectionDone && <span className="block text-caption">scheduled</span>}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="space-y-0.5">
            <StatusBadge kind="occupancy" status={row.original.state} />
            {row.original.occupancyNumber && <span className="block text-caption text-text-muted">{row.original.currentDesk}</span>}
          </span>
        ),
      },
      { id: 'recommendation', header: 'Recommendation', cell: ({ row }) => <span className="block max-w-[11rem] text-small">{row.original.recommendation || '—'}</span> },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by occupancy number, application, BPO, owner or certificate"
          placeholder="Search occupancy, application, BPO, owner, certificate…"
          className="w-72"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Status" className={selectClass} value={r.filters.state} onChange={(e) => r.update({ state: e.target.value })}>
          <option value="">All statuses</option>
          {OCCUPANCY_REGISTER_STATES.map((s) => (
            <option key={s} value={s}>
              {OCCUPANCY_STATE_LABEL[s]}
            </option>
          ))}
        </select>
        {r.active && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} {r.data.total === 1 ? 'file' : 'files'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={r.active ? 'Nothing matches those filters' : 'No file has reached occupancy yet'}
        emptyDescription={r.active ? 'Try widening the filters.' : 'A file appears here once work on it has commenced.'}
      />
      <Pagination page={r.data.page} pageSize={r.data.pageSize} total={r.data.total} totalPages={r.data.totalPages} onPageChange={r.setPage} disabled={r.loading} noun="file" />
    </div>
  );
}
