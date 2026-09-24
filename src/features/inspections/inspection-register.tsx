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
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import { stageName } from '@/lib/workflow';
import { RECOMMENDATIONS, RECOMMENDATION_LABEL } from '@/lib/site-inspection';
import { cn } from '@/lib/utils';
import type { InspectionFilters, InspectionListPayload, InspectionRow } from './types';

export const EMPTY_INSPECTION_FILTERS: InspectionFilters = {
  q: '',
  inspectorId: '',
  status: '',
  recommendation: '',
  from: '',
  to: '',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Pending (scheduled or in progress)' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'OVERDUE', label: 'Overdue' },
];

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const selectClass =
  'h-9 rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The site inspection register, across applications, within the caller's
 * scope. Filters narrow only; the server merges scope into every query.
 */
export function InspectionRegister({
  initial,
  initialFilters = EMPTY_INSPECTION_FILTERS,
}: {
  initial: InspectionListPayload;
  initialFilters?: InspectionFilters;
}) {
  const [data, setData] = React.useState(initial);
  const [filters, setFilters] = React.useState<InspectionFilters>(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const inspectors = initial.meta?.inspectors ?? [];

  const update = (next: Partial<InspectionFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };

  // Debounced free-text search.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const next = await api.get<InspectionListPayload>(`/api/inspections?${params}`);
      setData((d) => ({ ...next, summary: d.summary, meta: d.meta }));
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'The register could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [load]);

  const columns = React.useMemo<ColumnDef<InspectionRow, unknown>[]>(
    () => [
      {
        id: 'inspection',
        header: 'Inspection ID',
        cell: ({ row }) => (
          <div>
            <Link href={`/inspections/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
              {row.original.inspectionNumber}
            </Link>
            {row.original.round > 1 && <p className="text-caption text-text-muted">Round {row.original.round}</p>}
          </div>
        ),
      },
      {
        id: 'application',
        header: 'Application Number',
        cell: ({ row }) => (
          <Link
            href={`/applications/${row.original.application.id}?tab=inspection`}
            className="whitespace-nowrap text-text hover:underline"
          >
            {row.original.application.applicationNumber}
          </Link>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => <span className="block max-w-[12rem] truncate">{row.original.application.owner || '—'}</span>,
      },
      {
        id: 'site',
        header: 'Site',
        cell: ({ row }) => (
          <div className="max-w-[16rem]">
            <p className="truncate text-small" title={row.original.application.site}>
              {row.original.application.site || '—'}
            </p>
            <p className="truncate text-caption text-text-muted">{row.original.application.zone}</p>
          </div>
        ),
      },
      { id: 'inspector', header: 'Inspector', cell: ({ row }) => <span className="whitespace-nowrap">{row.original.inspectorName}</span> },
      {
        id: 'scheduled',
        header: 'Scheduled Date',
        cell: ({ row }) => (
          <span className={cn('whitespace-nowrap tabular-nums', row.original.overdue ? 'font-medium text-danger' : 'text-text-muted')}>
            {fmt(row.original.scheduledFor)}
            {row.original.overdue && <span className="block text-caption">Overdue</span>}
          </span>
        ),
      },
      {
        id: 'inspected',
        header: 'Inspection Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmt(row.original.inspectedAt)}</span>,
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="inspection" status={row.original.status} /> },
      {
        id: 'recommendation',
        header: 'Recommendation',
        cell: ({ row }) =>
          row.original.recommendation && row.original.status === 'SUBMITTED' ? (
            <StatusBadge kind="recommendation" status={row.original.recommendation} />
          ) : (
            <span className="text-caption text-text-subtle">—</span>
          ),
      },
      {
        id: 'desk',
        header: 'Current Desk',
        cell: ({ row }) => <span className="whitespace-nowrap text-small">{stageName(row.original.application.currentStageCode)}</span>,
      },
    ],
    []
  );

  const active = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by inspection ID, application number, owner or inspector"
          placeholder="Search application, inspection ID, owner…"
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Inspector" className={selectClass} value={filters.inspectorId} onChange={(e) => update({ inspectorId: e.target.value })}>
          <option value="">All inspectors</option>
          {inspectors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select aria-label="Status" className={selectClass} value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Recommendation"
          className={selectClass}
          value={filters.recommendation}
          onChange={(e) => update({ recommendation: e.target.value })}
        >
          <option value="">All recommendations</option>
          {RECOMMENDATIONS.map((r) => (
            <option key={r} value={r}>
              {RECOMMENDATION_LABEL[r]}
            </option>
          ))}
          <option value="NONE">None yet</option>
        </select>
        <label className="flex items-center gap-1.5 text-caption text-text-muted">
          Scheduled from
          <Input type="date" className="w-36" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-caption text-text-muted">
          to
          <Input type="date" className="w-36" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
        </label>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setFilters(EMPTY_INSPECTION_FILTERS);
              setPage(1);
            }}
          >
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {data.total} {data.total === 1 ? 'inspection' : 'inspections'}
        </Badge>
      </div>

      <DataTable
        columns={columns}
        data={data.rows}
        loading={loading}
        emptyTitle={active ? 'Nothing matches those filters' : 'No site inspections yet'}
        emptyDescription={
          active ? 'Try widening the filters.' : 'Inspections are booked from an application’s Site Inspection tab, at the TPA desk.'
        }
      />

      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={loading}
        noun="inspection"
      />
    </div>
  );
}
