'use client';

import * as React from 'react';
import { FileText, History } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import type { Attachment, HistoryEvent, Paged } from './types';

export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtShort = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

export const fmtDateTime = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const selectClass =
  'h-9 rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export const dayValue = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="whitespace-pre-line text-text">{children}</dd>
    </div>
  );
}

export function Prose({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface-sunk px-3 py-2 text-small">
      <p className="mb-0.5 text-caption font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <div className="whitespace-pre-line text-text">{children}</div>
    </div>
  );
}

/** A document link that opens in a new tab. */
export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
      <FileText className="size-3.5" />
      {children}
    </a>
  );
}

export function AttachmentList({ items, hrefFor }: { items: Attachment[]; hrefFor: (index: number) => string }) {
  if (!items.length) return <span className="text-text-muted">None</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((d, i) => (
        <li key={`${d.fileName}-${i}`}>
          <DocLink href={hrefFor(i)}>{d.isDemo ? `${d.fileName} (demo placeholder)` : d.fileName}</DocLink>
        </li>
      ))}
    </ul>
  );
}

/** Every move on the record, newest first. */
export function HistoryCard({
  events,
  label,
  statusLabel,
}: {
  events: HistoryEvent[];
  label: Record<string, string>;
  statusLabel: (s: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" /> History
        </CardTitle>
        <CardDescription>Every move, newest first. The audit log carries the same entries.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <p className="text-small font-medium text-text">
                {label[e.action] ?? e.action}
                <span className="font-normal text-text-muted">
                  {' '}
                  — {e.fromStatus ? `${statusLabel(e.fromStatus)} → ` : ''}
                  {statusLabel(e.toStatus)}
                </span>
              </p>
              <p className="text-caption text-text-muted">
                {e.actorName}
                {e.actorRoleKey && e.actorRoleKey !== 'SYSTEM' ? ` (${e.actorRoleKey})` : ''}
                {e.stageName ? ` · at ${e.stageName}` : ''} · {fmtDateTime(e.occurredAt)}
              </p>
              {e.remarks && <p className="mt-0.5 text-small text-text">{e.remarks}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Turns an API failure into a toast, and returns field errors for the form. */
export function reportError(error: unknown, fallback = 'That did not work.'): Record<string, string> {
  const details = error instanceof ApiCallError ? error.details ?? [] : [];
  toast.error(error instanceof ApiCallError ? error.message : error instanceof Error ? error.message : fallback, {
    description: details.length ? details.map((d) => d.message).join(' ') : undefined,
  });
  return Object.fromEntries(details.map((d) => [d.path, d.message]));
}

/** POSTs multipart and throws an ApiCallError-shaped Error with field details. */
export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiCallError(body?.error ?? 'The request failed.', {
      status: res.status,
      code: body?.code,
      details: body?.details,
    });
  }
  return body as T;
}

/**
 * Filter + paging state for a register whose first page the server rendered.
 * Filters only narrow; the server merges scope into every query.
 */
export function useRegister<Row, F extends Record<string, string>>(
  endpoint: string,
  initial: Paged<Row>,
  initialFilters: F
) {
  const [data, setData] = React.useState(initial);
  const [filters, setFilters] = React.useState<F>(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q ?? '');
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

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
      setData(await api.get<Paged<Row>>(`${endpoint}?${params}`));
    } catch (error) {
      reportError(error, 'The register could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, filters, page]);

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [load]);

  return {
    data,
    filters,
    loading,
    search,
    setSearch,
    setPage,
    reload: load,
    update: (next: Partial<F>) => {
      setFilters((f) => ({ ...f, ...next }));
      setPage(1);
    },
    reset: () => {
      setSearch('');
      setFilters(initialFilters);
      setPage(1);
    },
    active: Object.values(filters).some(Boolean),
  };
}
