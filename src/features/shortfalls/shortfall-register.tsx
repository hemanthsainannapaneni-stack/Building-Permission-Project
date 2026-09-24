'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import { stageName } from '@/lib/workflow';
import { SHORTFALL_FILTERS, SHORTFALL_FILTER_META, kindLabel } from '@/lib/shortfalls';
import { cn } from '@/lib/utils';
import { ShortfallFilterBar, EMPTY_FILTERS } from './shortfall-filters';
import type { ShortfallFilters, ShortfallListPayload, ShortfallRow } from './types';

/**
 * The shortfall register, across applications.
 *
 * ── One list, two readers ────────────────────────────────────────────────
 *
 * An LTP sees everything asked of them, across every file they have filed. An
 * officer sees everything asked within their jurisdiction. It is the same
 * query with a different scope — and the same screen, because the questions
 * are the same shape: what is outstanding, whose move is it, and how long has
 * it been sitting there.
 *
 * The columns that change are the ones about people: the applicant does not
 * need to be told the applicant's name, so Owner is dropped for them and the
 * space goes to the columns they do read.
 *
 * ── Fourteen columns is a lot, and they are not all equal ────────────────
 *
 * The identifying columns come first, the counts in the middle, and the two
 * that answer "should I look at this now" — Status and SLA — at the right,
 * where the eye lands last. Items collapse to one cell reading "2 / 5"
 * rather than three columns of small numbers, because the question is always
 * "how much is left", never "how many were there".
 */
export function ShortfallRegister({ initial }: { initial: ShortfallListPayload }) {
  const [data, setData] = React.useState(initial);
  const [filters, setFilters] = React.useState<ShortfallFilters>(EMPTY_FILTERS);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  const isApplicant = data.isApplicant;

  const update = React.useCallback((next: Partial<ShortfallFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }, []);

  const reset = React.useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), summary: 'true' });

      // Only what is actually set. An empty parameter reaching the server is
      // an empty parameter the server has to decide how to ignore.
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }

      setData(await api.get<ShortfallListPayload>(`/api/shortfalls?${params}`));
    } catch (error) {
      toast.error(
        error instanceof ApiCallError ? error.message : 'The register could not be loaded.'
      );
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

  const columns = React.useMemo<ColumnDef<ShortfallRow, unknown>[]>(() => {
    const cols: ColumnDef<ShortfallRow, unknown>[] = [
      {
        id: 'shortfall',
        header: 'Shortfall',
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/shortfalls/${row.original.id}`}
              className="whitespace-nowrap font-medium text-primary hover:underline"
            >
              {row.original.shortfallNumber}
            </Link>
            <p className="truncate text-caption text-text-muted">{row.original.title}</p>
          </div>
        ),
      },
      {
        id: 'application',
        header: 'Application',
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/applications/${row.original.application.id}`}
              className="whitespace-nowrap text-text hover:underline"
            >
              {row.original.application.applicationNumber}
            </Link>
            <p className="truncate text-caption text-text-muted">
              {row.original.application.zone}
            </p>
          </div>
        ),
      },
    ];

    // The owner, and the LTP who filed for them. Different people on most
    // files, and an officer chasing a response needs to know which is which.
    if (!isApplicant) {
      cols.push({
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-text">{row.original.application.applicantName}</p>
            {row.original.application.ltpName && (
              <p className="truncate text-caption text-text-muted">
                via {row.original.application.ltpName}
              </p>
            )}
          </div>
        ),
      });
    }

    cols.push(
      {
        id: 'type',
        header: 'Permission type',
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="truncate text-small text-text">{row.original.application.type}</span>
            <Badge tone="outline">{kindLabel(row.original.kind)}</Badge>
          </div>
        ),
      },
      {
        id: 'raisedBy',
        header: 'Raised by',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-text">{row.original.raisedByName || '—'}</p>
            <p className="truncate text-caption text-text-muted">
              {stageName(row.original.raisedAtStageCode)}
            </p>
          </div>
        ),
      },
      {
        id: 'raised',
        header: 'Raised',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-text-muted">
            {new Date(row.original.raisedAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: '2-digit',
            })}
          </span>
        ),
      },
      {
        id: 'desk',
        header: 'Current desk',
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="truncate text-small text-text">
              {stageName(row.original.application.currentStageCode)}
            </span>
            {row.original.mode === 'REPORTED' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge tone="info">Reported</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Recorded and carried forward — the application moved on, but this still blocks
                  approval until it is settled.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        id: 'due',
        header: 'Response due',
        cell: ({ row }) => {
          const overdue = row.original.sla.state === 'OVERDUE';
          return (
            <span
              className={cn(
                'whitespace-nowrap tabular-nums',
                overdue ? 'font-medium text-danger' : 'text-text-muted'
              )}
            >
              {row.original.dueDate
                ? new Date(row.original.dueDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: '2-digit',
                  })
                : '—'}
            </span>
          );
        },
      },
      {
        id: 'cycle',
        header: 'Cycle',
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Badge tone={row.original.cycle > 1 ? 'warning' : 'outline'}>
                  {row.original.cycle}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {row.original.attempts === 0
                ? 'Asked once. No response yet.'
                : `${row.original.attempts} ${row.original.attempts === 1 ? 'response' : 'responses'} on record.`}
            </TooltipContent>
          </Tooltip>
        ),
      },
      {
        id: 'items',
        header: 'Items',
        cell: ({ row }) => {
          const { resolvedItems, itemCount, pendingItems, mandatoryPendingItems } = row.original;

          if (itemCount === 0) {
            return <span className="text-caption text-text-subtle">None listed</span>;
          }

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex flex-col items-start gap-0.5">
                  <span
                    className={cn(
                      'tabular-nums',
                      pendingItems === 0 ? 'text-success' : 'text-text'
                    )}
                  >
                    {resolvedItems} / {itemCount}
                  </span>
                  {pendingItems > 0 && (
                    <span className="text-caption text-text-muted">{pendingItems} pending</span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {resolvedItems} resolved, {pendingItems} pending
                {mandatoryPendingItems > 0
                  ? ` — ${mandatoryPendingItems} of them mandatory, which blocks approval.`
                  : '.'}
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge kind="shortfall" status={row.original.status} />,
      },
      {
        id: 'sla',
        header: 'SLA',
        cell: ({ row }) => <SlaCell sla={row.original.sla} />,
      },
      {
        id: 'action',
        header: '',
        cell: ({ row }) => {
          const act = actionable(row.original, isApplicant);
          return (
            <Button size="sm" variant={act ? 'primary' : 'ghost'} asChild>
              <Link href={`/shortfalls/${row.original.id}`}>
                {act ? (isApplicant ? 'Respond' : 'Review') : 'Open'}
              </Link>
            </Button>
          );
        },
      }
    );

    return cols;
  }, [isApplicant]);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {SHORTFALL_FILTER_META.map((meta) => {
          const count = data.counts?.[meta.key] ?? 0;
          const active = filters.filter === meta.key;

          return (
            <Tooltip key={meta.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => update({ filter: meta.key })}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-2 rounded border px-3 py-1.5 text-small transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    active
                      ? 'border-primary bg-primary text-primary-text'
                      : 'border-border-strong bg-surface text-text hover:bg-surface-sunk'
                  )}
                >
                  {meta.label}
                  <span
                    className={cn(
                      'tabular-nums',
                      active ? 'text-primary-text/80' : 'text-text-muted'
                    )}
                  >
                    {count}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{meta.description}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <ShortfallFilterBar
        filters={filters}
        onChange={update}
        onReset={reset}
        disabled={loading}
        showOwner={!isApplicant}
      />

      <DataTable
        columns={columns}
        data={data.rows}
        loading={loading}
        emptyTitle={
          filters.filter === SHORTFALL_FILTERS.OPEN
            ? 'Nothing outstanding'
            : 'Nothing matches those filters'
        }
        emptyDescription={
          filters.filter === SHORTFALL_FILTERS.OPEN
            ? isApplicant
              ? 'The department has not asked you for anything.'
              : 'No shortfall in your jurisdiction is waiting to be settled.'
            : SHORTFALL_FILTER_META.find((f) => f.key === filters.filter)?.description
        }
      />

      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={loading}
        noun="shortfall"
      />
    </div>
  );
}

/**
 * The response clock, as a word and a bar.
 *
 * The bar is the honest part: "8 days left" says nothing about whether that is
 * most of the period or the last of it, and a shortfall given three days is a
 * different situation from one given thirty.
 */
function SlaCell({ sla }: { sla: ShortfallRow['sla'] }) {
  if (sla.state === 'STOPPED') {
    return <span className="text-caption text-text-subtle">—</span>;
  }

  if (sla.state === 'NO_CLOCK') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-caption text-text-subtle">No clock</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          No response period was set on this shortfall. Passing a date has no legal effect here —
          the file simply stays pending.
        </TooltipContent>
      </Tooltip>
    );
  }

  const tone =
    sla.state === 'OVERDUE'
      ? { text: 'text-danger', bar: 'bg-danger' }
      : sla.state === 'DUE_SOON'
        ? { text: 'text-warning', bar: 'bg-warning' }
        : { text: 'text-success', bar: 'bg-success' };

  return (
    <div className="min-w-[5.5rem] space-y-1">
      <span className={cn('whitespace-nowrap text-caption font-medium tabular-nums', tone.text)}>
        {sla.label}
      </span>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-surface-sunk"
        role="presentation"
      >
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${sla.percent ?? 0}%` }} />
      </div>
    </div>
  );
}

/** True when this row is waiting on the person looking at it. */
const actionable = (row: ShortfallRow, isApplicant: boolean): boolean =>
  isApplicant ? row.turn === 'APPLICANT' : row.turn === 'OFFICER';
