'use client';

import * as React from 'react';
import {
  FilePlus2,
  PencilLine,
  Send,
  Trash2,
  Upload,
  ScanSearch,
  CircleCheck,
  CircleX,
  Banknote,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  TriangleAlert,
  MessageSquare,
  Gavel,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from './types';

/**
 * The application timeline.
 *
 * Newest first, because "what happened to my application" is nearly always
 * really "what happened to it last". The full history is below, in order, for
 * the times it is not.
 *
 * Every event type this component knows how to draw is listed in ICONS — and
 * that list deliberately includes types no phase emits yet. Phase 7 will write
 * STAGE_FORWARDED rows into the same table, and when it does they render
 * correctly without this file changing. An unknown type still renders, with a
 * neutral marker: a timeline that silently drops events it does not recognise
 * is worse than one that shows a plain dot.
 */

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  APPLICATION_CREATED: { icon: FilePlus2, tone: 'text-text-muted' },
  APPLICATION_UPDATED: { icon: PencilLine, tone: 'text-text-muted' },
  APPLICATION_SUBMITTED: { icon: Send, tone: 'text-info' },
  APPLICATION_DELETED: { icon: Trash2, tone: 'text-danger' },

  DRAWING_UPLOADED: { icon: Upload, tone: 'text-info' },
  BIM_MODEL_UPLOADED: { icon: Upload, tone: 'text-info' },
  BIM_DECLARED: { icon: CircleCheck, tone: 'text-success' },
  BIM_REVIEWED: { icon: ScanSearch, tone: 'text-info' },
  SCRUTINY_STARTED: { icon: ScanSearch, tone: 'text-info' },
  SCRUTINY_PASSED: { icon: CircleCheck, tone: 'text-success' },
  SCRUTINY_FAILED: { icon: CircleX, tone: 'text-danger' },
  DOCUMENT_UPLOADED: { icon: Upload, tone: 'text-info' },
  DOCUMENTS_COMPLETED: { icon: CircleCheck, tone: 'text-success' },
  FEE_GENERATED: { icon: Banknote, tone: 'text-warning' },
  PAYMENT_SUCCESSFUL: { icon: CreditCard, tone: 'text-success' },
  PAYMENT_FAILED: { icon: CreditCard, tone: 'text-danger' },
  STAGE_FORWARDED: { icon: ArrowRight, tone: 'text-info' },
  STAGE_RETURNED: { icon: ArrowLeft, tone: 'text-warning' },
  SHORTFALL_RAISED: { icon: TriangleAlert, tone: 'text-warning' },
  SHORTFALL_RESPONDED: { icon: MessageSquare, tone: 'text-info' },
  SHORTFALL_RESOLVED: { icon: CircleCheck, tone: 'text-success' },
  APPLICATION_APPROVED: { icon: Gavel, tone: 'text-success' },
  APPLICATION_REJECTED: { icon: Gavel, tone: 'text-danger' },
  APPLICATION_WITHDRAWN: { icon: CircleX, tone: 'text-text-muted' },
};

export function ApplicationTimeline({
  events,
  limit,
}: {
  events: TimelineEvent[];
  /** Show only the most recent n. The Overview tab uses this. */
  limit?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const ordered = React.useMemo(() => [...events].sort((a, b) => b.sequence - a.sequence), [events]);
  const shown = limit && !expanded ? ordered.slice(0, limit) : ordered;
  const hidden = ordered.length - shown.length;

  if (!events.length) {
    return (
      <EmptyState
        icon={Circle}
        title="Nothing has happened yet"
        description="Every step this application takes is recorded here, from the moment it was created."
      />
    );
  }

  return (
    <div>
      <ol className="relative space-y-0">
        {shown.map((event, i) => {
          const meta = ICONS[event.type] ?? { icon: Circle, tone: 'text-text-subtle' };
          const Icon = meta.icon;
          const last = i === shown.length - 1;

          return (
            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* The rail, drawn between markers rather than behind them. */}
              {!last && (
                <span
                  className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-border"
                  aria-hidden
                />
              )}

              <span
                className={cn(
                  'relative z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full border border-border bg-surface',
                  meta.tone
                )}
                aria-hidden
              >
                <Icon className="size-3.5" />
              </span>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-small font-medium text-text">{event.title}</p>
                  <time
                    dateTime={event.occurredAt}
                    title={formatExact(event.occurredAt)}
                    className="shrink-0 text-caption tabular-nums text-text-subtle"
                  >
                    {formatRelative(event.occurredAt)}
                  </time>
                </div>

                {event.description && (
                  <p className="mt-0.5 text-caption text-text-muted">{event.description}</p>
                )}

                <p className="mt-0.5 text-caption text-text-subtle">
                  {event.actorName}
                  {event.actorRoleKey && event.actorRoleKey !== 'SYSTEM' && (
                    <span> · {event.actorRoleKey.replace(/_/g, ' ')}</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 rounded text-caption font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Show {hidden} earlier {hidden === 1 ? 'event' : 'events'}
        </button>
      )}
    </div>
  );
}

function formatRelative(value: string): string {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatExact(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
