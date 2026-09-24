'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PROFESSIONAL_CHANGE_STATUSES, PROFESSIONAL_CHANGE_STATUS_LABEL } from '@/lib/professional-change';
import { fmtShort, selectClass, useRegister } from '@/features/proceedings/shared';
import type { Paged, ProfessionalChangeRow } from './types';

export type ProfessionalChangeFilters = { q: string; status: string };
export const EMPTY_PROFESSIONAL_CHANGE_FILTERS: ProfessionalChangeFilters = { q: '', status: '' };

function Professional({ p }: { p: { name: string; licenceNo: string } }) {
  return (
    <span className="whitespace-nowrap text-small">
      {p.name || '—'}
      <span className="block text-caption text-text-muted">{p.licenceNo}</span>
    </span>
  );
}

/** The change of technical professional register. */
export function ProfessionalChangeRegister({
  initial,
  initialFilters = EMPTY_PROFESSIONAL_CHANGE_FILTERS,
}: {
  initial: Paged<ProfessionalChangeRow>;
  initialFilters?: ProfessionalChangeFilters;
}) {
  const r = useRegister<ProfessionalChangeRow, ProfessionalChangeFilters>('/api/professional-changes', initial, initialFilters);

  const columns = React.useMemo<ColumnDef<ProfessionalChangeRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Request Number',
        cell: ({ row }) => (
          <Link href={`/professional-changes/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.requestNumber}
          </Link>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <Link
            href={`/applications/${row.original.application.id}?tab=professional`}
            className="whitespace-nowrap text-text hover:underline"
          >
            {row.original.application.applicationNumber}
          </Link>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => <span className="block max-w-[11rem] truncate text-small">{row.original.owner || '—'}</span>,
      },
      { id: 'current', header: 'Current Professional', cell: ({ row }) => <Professional p={row.original.currentProfessional} /> },
      {
        id: 'proposed',
        header: 'Proposed Professional',
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <ArrowRight className="size-3.5 shrink-0 text-text-muted" aria-hidden />
            <Professional p={row.original.proposedProfessional} />
          </span>
        ),
      },
      {
        id: 'date',
        header: 'Request Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.requestDate)}</span>,
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="professionalChange" status={row.original.status} /> },
      {
        id: 'desk',
        header: 'Current Desk',
        cell: ({ row }) => <span className="block max-w-[12rem] text-small">{row.original.currentDesk}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by request number, application, owner or professional"
          placeholder="Search request, application, owner, professional…"
          className="w-72"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="OPEN">Open (not yet decided)</option>
          {PROFESSIONAL_CHANGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROFESSIONAL_CHANGE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {r.active && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {r.data.total} {r.data.total === 1 ? 'request' : 'requests'}
        </Badge>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={r.active ? 'Nothing matches those filters' : 'No change of professional requests'}
        emptyDescription={
          r.active ? 'Try widening the filters.' : 'A request is registered from an application’s Technical Professional tab, on receipt of the owner’s letter.'
        }
      />
      <Pagination
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        totalPages={r.data.totalPages}
        onPageChange={r.setPage}
        disabled={r.loading}
        noun="request"
      />
    </div>
  );
}
