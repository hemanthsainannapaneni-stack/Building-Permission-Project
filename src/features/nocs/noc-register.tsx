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
import { NOC_STATUSES, NOC_STATUS_LABEL } from '@/lib/noc';
import { cn } from '@/lib/utils';
import type { NocFilters, NocListPayload, NocRow } from './types';

export const EMPTY_NOC_FILTERS: NocFilters = { q: '', nocTypeId: '', status: '', desk: '', authority: '' };

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const selectClass =
  'h-9 rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** Within thirty days of lapsing — worth a second look, not an error. */
const expiringSoon = (row: NocRow) =>
  row.status === 'VERIFIED' && row.expiryDate && new Date(row.expiryDate).getTime() - Date.now() < 30 * 86_400_000;

/**
 * The NOC register, across applications, within the caller's scope. Filters
 * narrow only; the server merges scope into every query.
 */
export function NocRegister({
  initial,
  initialFilters = EMPTY_NOC_FILTERS,
}: {
  initial: NocListPayload;
  initialFilters?: NocFilters;
}) {
  const [data, setData] = React.useState(initial);
  const [filters, setFilters] = React.useState<NocFilters>(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [authority, setAuthority] = React.useState(initialFilters.authority);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const types = initial.meta?.types ?? [];
  const desks = initial.meta?.desks ?? [];

  const update = (next: Partial<NocFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };

  // Debounced free-text fields.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search && f.authority === authority ? f : { ...f, q: search, authority }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search, authority]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const next = await api.get<NocListPayload>(`/api/nocs?${params}`);
      setData((d) => ({ ...next, summary: d.summary, meta: d.meta }));
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'The register could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const first = React.useRef(true);
  // The server rendered the first page with `initialFilters` already applied.
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [load]);

  const columns = React.useMemo<ColumnDef<NocRow, unknown>[]>(
    () => [
      {
        id: 'noc',
        header: 'NOC Number',
        cell: ({ row }) => (
          <div>
            <Link href={`/nocs/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
              {row.original.nocNumber}
            </Link>
            {row.original.referenceNumber && (
              <p className="whitespace-nowrap text-caption text-text-muted">No. {row.original.referenceNumber}</p>
            )}
          </div>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <div>
            <Link
              href={`/applications/${row.original.application.id}?tab=nocs`}
              className="whitespace-nowrap text-text hover:underline"
            >
              {row.original.application.applicationNumber}
            </Link>
            <p className="max-w-[12rem] truncate text-caption text-text-muted">{row.original.application.owner || '—'}</p>
          </div>
        ),
      },
      { id: 'type', header: 'NOC Type', cell: ({ row }) => <span className="whitespace-nowrap">{row.original.nocType.name}</span> },
      {
        id: 'authority',
        header: 'Authority',
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate text-small" title={row.original.authority}>
            {row.original.authority || '—'}
          </span>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="noc" status={row.original.status} /> },
      {
        id: 'applied',
        header: 'Applied Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmt(row.original.appliedDate)}</span>,
      },
      {
        id: 'issued',
        header: 'Issued Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmt(row.original.issuedDate)}</span>,
      },
      {
        id: 'expiry',
        header: 'Expiry',
        cell: ({ row }) => (
          <span
            className={cn(
              'whitespace-nowrap tabular-nums',
              row.original.status === 'EXPIRED' ? 'font-medium text-danger' : expiringSoon(row.original) ? 'font-medium text-warning' : 'text-text-muted'
            )}
          >
            {fmt(row.original.expiryDate)}
            {expiringSoon(row.original) && <span className="block text-caption">Expires soon</span>}
          </span>
        ),
      },
      {
        id: 'desk',
        header: 'Current Desk',
        cell: ({ row }) => <span className="whitespace-nowrap text-small">{row.original.application.currentDesk}</span>,
      },
    ],
    []
  );

  const active = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by NOC number, application number, reference or owner"
          placeholder="Search NOC, application, owner…"
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="NOC type" className={selectClass} value={filters.nocTypeId} onChange={(e) => update({ nocTypeId: e.target.value })}>
          <option value="">All NOC types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Status" className={selectClass} value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="OUTSTANDING">Pending (not yet verified)</option>
          {NOC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {NOC_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Current desk" className={selectClass} value={filters.desk} onChange={(e) => update({ desk: e.target.value })}>
          <option value="">All desks</option>
          {desks.map((d) => (
            <option key={d.code} value={d.code}>
              {d.label}
            </option>
          ))}
        </select>
        <Input
          aria-label="Authority"
          placeholder="Authority…"
          className="w-44"
          value={authority}
          onChange={(e) => setAuthority(e.target.value)}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setAuthority('');
              setFilters(EMPTY_NOC_FILTERS);
              setPage(1);
            }}
          >
            <RotateCcw /> Reset
          </Button>
        )}
        <Badge tone="outline" className="ml-auto">
          {data.total} {data.total === 1 ? 'NOC' : 'NOCs'}
        </Badge>
      </div>

      <DataTable
        columns={columns}
        data={data.rows}
        loading={loading}
        emptyTitle={active ? 'Nothing matches those filters' : 'No NOCs yet'}
        emptyDescription={
          active ? 'Try widening the filters.' : 'NOCs are opened from an application’s NOCs tab, by the reviewing desk or the applicant.'
        }
      />

      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={loading}
        noun="NOC"
      />
    </div>
  );
}
