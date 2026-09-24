import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { ActivityEntry, WorkloadRow } from '@/server/services/analytics';

/**
 * The parts every dashboard is assembled from.
 *
 * They exist so that the seven dashboards in this product are seven
 * ARRANGEMENTS of the same components rather than seven designs. A Commissioner
 * who has learned to read the panel headings on their own screen can read a
 * TPA's, and a change to how a section header looks is one edit.
 */

/** A titled block with an optional "see everything" link in the corner. */
export function Panel({
  title,
  description,
  action,
  icon: Icon,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  /** A quiet glyph beside the title. Decoration, so it is hidden from readers. */
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('font-inter', className)}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-1.5 text-small font-bold text-text">
            {Icon && <Icon className="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />}
            {title}
          </CardTitle>
          {description && <CardDescription className="text-caption text-text-muted mt-0.5">{description}</CardDescription>}
        </div>
        {action && (
          <Link
            href={action.href}
            className="flex shrink-0 items-center gap-1 rounded text-caption font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {action.label}
            <ArrowRight className="size-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

/**
 * A group heading between rows of tiles.
 */
export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-1.5 shadow-sm">
      <h2 className="text-sm font-extrabold tracking-tight uppercase text-text-muted">{title}</h2>
      {hint && <p className="text-caption text-text-subtle">{hint}</p>}
    </div>
  );
}

/** A compact label/value row — the shape used inside most panels. */
export function StatRow({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  href?: string;
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-small text-text-muted">{label}</p>
        {hint && <p className="truncate text-caption text-text-subtle">{hint}</p>}
      </div>
      <span
        className={cn(
          'shrink-0 text-small font-medium tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
          tone === 'info' && 'text-info',
          (!tone || tone === 'neutral') && 'text-text'
        )}
      >
        {value}
      </span>
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded hover:bg-surface-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {body}
    </Link>
  ) : (
    body
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Activity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What has happened lately, newest first.
 *
 * Reads `application_events` — the human-readable narrative — rather than the
 * audit log. The audit trail is for an auditor reconstructing who changed
 * what; this is the story an officer wants when they open the system in the
 * morning, and the two are deliberately different tables.
 */
export function ActivityFeed({
  entries,
  emptyMessage = 'Nothing has happened yet.',
}: {
  entries: ActivityEntry[];
  emptyMessage?: string;
}) {
  if (!entries.length) {
    return <p className="py-6 text-center text-small text-text-subtle">{emptyMessage}</p>;
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-2.5 last:pb-0">
          {/* The rail, drawn per item and stopped on the last one so the line
              ends at the final event rather than trailing into the padding. */}
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/40" aria-hidden />
            {index < entries.length - 1 && (
              <span className="w-px flex-1 bg-border/50" aria-hidden />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link
                href={`/applications/${entry.applicationId}`}
                className="text-small font-medium tabular-nums text-text hover:text-primary hover:underline"
              >
                {entry.applicationNumber}
              </Link>
              <span className="text-caption text-text-subtle">
                {formatRelativeTime(entry.occurredAt)}
              </span>
            </div>
            <p className="mt-0.5 text-small text-text">{entry.title}</p>
            {entry.description && (
              <p className="mt-0.5 line-clamp-2 text-caption text-text-muted">{entry.description}</p>
            )}
            {entry.actorName && (
              <p className="mt-0.5 text-caption text-text-subtle">{entry.actorName}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Workload
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Who is holding how much.
 *
 * Unclaimed work gets its own row rather than being left out, because "eleven
 * files nobody has picked up" is the most actionable line on the table and
 * hiding it would make a busy desk look idle.
 */
export function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-small text-text-subtle">No open work.</p>;
  }

  const max = Math.max(...rows.map((r) => r.open));

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.userId ?? row.name}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn('truncate text-small', row.userId ? 'text-text' : 'italic text-text-muted')}>
                {row.name}
              </span>
              <span className="shrink-0 text-caption uppercase tracking-wide text-text-subtle">
                {row.roleKey}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {row.overdue > 0 && <Badge tone="danger">{row.overdue} overdue</Badge>}
              <span className="text-small font-medium tabular-nums text-text">{row.open}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-surface-sunk">
            <div
              className={cn('h-full rounded-sm', row.userId ? 'bg-primary' : 'bg-border-strong')}
              style={{ width: `${Math.max(2, (row.open / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
