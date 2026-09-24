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
import { COMMENCEMENT_STATES, COMMENCEMENT_STATE_LABEL } from '@/lib/commencement';
import { fmtShort, selectClass, useRegister } from '@/features/proceedings/shared';
import type { CommencementRow, Paged } from './types';

export type CommencementFilters = { q: string; state: string };
export const EMPTY_COMMENCEMENT_FILTERS: CommencementFilters = { q: '', state: '' };

/** The Work Initiated register: every approved file, and where it stands after approval. */
export function CommencementRegister({
  initial,
  initialFilters = EMPTY_COMMENCEMENT_FILTERS,
}: {
  initial: Paged<CommencementRow>;
  initialFilters?: CommencementFilters;
}) {
  const r = useRegister<CommencementRow, CommencementFilters>('/api/work-commencements', initial, initialFilters);

  const columns = React.useMemo<ColumnDef<CommencementRow, unknown>[]>(
    () => [
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <Link href={`/work-initiated/${row.original.applicationId}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.applicationNumber}
            {row.original.commencementNumber && (
              <span className="block text-caption font-normal text-text-muted">{row.original.commencementNumber}</span>
            )}
          </Link>
        ),
      },
      {
        id: 'order',
        header: 'BPO / Proceeding',
        cell: ({ row }) =>
          row.original.order ? (
            <span className="whitespace-nowrap text-small">
              {row.original.order.orderNumber}
              <span className="block text-caption text-text-muted">
                {row.original.order.status === 'ISSUED' ? `Issued ${fmtShort(row.original.order.issuedAt)}` : row.original.order.status.toLowerCase()}
              </span>
            </span>
          ) : (
            <span className="text-text-muted">Not drawn up</span>
          ),
      },
      {
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => <span className="block max-w-[11rem] truncate text-small">{row.original.owner || '—'}</span>,
      },
      {
        id: 'ltp',
        header: 'LTP',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {row.original.ltp.name}
            <span className="block text-caption text-text-muted">{row.original.ltp.licenceNo}</span>
          </span>
        ),
      },
      {
        id: 'contractor',
        header: 'Contractor',
        cell: ({ row }) => <span className="block max-w-[11rem] truncate text-small">{row.original.contractor || '—'}</span>,
      },
      {
        id: 'commencement',
        header: 'Commencement Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtShort(row.original.commencementDate)}</span>,
      },
      {
        id: 'notified',
        header: 'Notification Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.notifiedAt)}</span>,
      },
      { id: 'state', header: 'Status', cell: ({ row }) => <StatusBadge kind="commencement" status={row.original.state} /> },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by application, BPO, owner, LTP or contractor"
          placeholder="Search application, BPO, owner, LTP, contractor…"
          className="w-72"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Status" className={selectClass} value={r.filters.state} onChange={(e) => r.update({ state: e.target.value })}>
          <option value="">All statuses</option>
          {COMMENCEMENT_STATES.map((s) => (
            <option key={s} value={s}>
              {COMMENCEMENT_STATE_LABEL[s]}
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
        emptyTitle={r.active ? 'Nothing matches those filters' : 'No approved files yet'}
        emptyDescription={
          r.active ? 'Try widening the filters.' : 'A file appears here once it is approved. Work may be notified once its building permission order is issued.'
        }
      />
      <Pagination
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        totalPages={r.data.totalPages}
        onPageChange={r.setPage}
        disabled={r.loading}
        noun="file"
      />
    </div>
  );
}
