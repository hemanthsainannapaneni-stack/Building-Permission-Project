'use client';

import { AlertTriangle, ArrowUpRight, PauseCircle, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SlaClockView } from './types';

/**
 * The service-standard clock on the open task.
 *
 * ── It says what the number MEANS, not just what it is ──────────────────
 *
 * "3 days left" is the least useful half of the answer. Three days of a
 * five-day standard is different from three days of a thirty-day one, and an
 * officer deciding what to pick up next needs the proportion. So the panel
 * carries the start, the standard, the due date, what has elapsed and what
 * remains, with a bar for the shape of it.
 *
 * ── Overdue is a statement, never an accusation and never an action ─────
 *
 * Passing a due date has NO legal effect in this system. Nothing is deemed
 * approved, nothing is reassigned, no officer's action is refused. The clock
 * exists so a supervisor can see which files are waiting and so the officer
 * holding one is told. The panel is worded to match: it reports elapsed time
 * and names who was notified, and it never says a rule was broken.
 *
 * ── Paused time is excluded, and the panel says so ──────────────────────
 *
 * A blocking shortfall parks the file with the applicant, and that time is not
 * counted against the desk. A paused clock showing a frozen figure with no
 * explanation looks like a bug, so the pause is labelled.
 */
export function SlaPanel({ sla }: { sla: SlaClockView | null }) {
  if (!sla) {
    return (
      <div className="rounded border border-dashed border-border px-3 py-2.5 text-caption text-text-muted">
        No service standard applies to this stage, so no clock is running on it.
      </div>
    );
  }

  const tone = sla.isOverdue
    ? { text: 'text-danger', bar: 'bg-danger', border: 'border-danger/40', bg: 'bg-danger-bg/40' }
    : sla.isPaused
      ? { text: 'text-text-muted', bar: 'bg-neutral', border: 'border-border', bg: 'bg-surface-sunk' }
      : sla.isDueSoon
        ? { text: 'text-warning', bar: 'bg-warning', border: 'border-warning/40', bg: 'bg-warning-bg/40' }
        : { text: 'text-success', bar: 'bg-success', border: 'border-border', bg: 'bg-surface-sunk' };

  return (
    <div className={cn('space-y-3 rounded border p-3', tone.border, tone.bg)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-small font-medium text-text">
          <Timer className={cn('size-4', tone.text)} aria-hidden />
          Service standard
          {sla.targetDays != null && (
            <span className="font-normal text-text-muted">
              {sla.targetDays} {sla.calendar === 'WORKING_DAYS' ? 'working days' : 'days'}
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {sla.isPaused && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Badge tone="neutral">
                    <PauseCircle className="size-3" aria-hidden /> Paused
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                The file is with the applicant on a blocking shortfall. That time is not counted
                against this desk.
              </TooltipContent>
            </Tooltip>
          )}

          {sla.isOverdue && (
            <Badge tone="danger">
              <AlertTriangle className="size-3" aria-hidden />
              {sla.overdueDays > 0
                ? `${sla.overdueDays} ${sla.overdueDays === 1 ? 'day' : 'days'} over`
                : 'Past due'}
            </Badge>
          )}

          {sla.isDueSoon && !sla.isOverdue && <Badge tone="warning">Due soon</Badge>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Stage start" value={date(sla.startedAt)} />
        <Fact label="Due date" value={date(sla.dueAt)} />
        <Fact label="Days elapsed" value={`${sla.elapsedDays}`} />
        <Fact
          label="Remaining"
          value={
            <span className={tone.text}>
              {sla.remainingDays >= 0
                ? `${sla.remainingDays} ${sla.remainingDays === 1 ? 'day' : 'days'}`
                : `${Math.abs(sla.remainingDays)} over`}
            </span>
          }
        />
      </dl>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface" role="presentation">
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${sla.percent}%` }} />
      </div>

      {sla.isOverdue && (
        <p className="flex items-start gap-1.5 border-t border-border pt-2 text-caption text-text-muted">
          <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          {sla.escalatesTo ? (
            <span>
              Reported to <span className="font-medium">{role(sla.escalatesTo)}</span>. Passing this
              date has no effect on the application — it is not approved, refused or reassigned
              because of it.
            </span>
          ) : (
            <span>
              No escalation role is configured for this stage. Passing this date has no effect on
              the application.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small tabular-nums text-text">{value}</dd>
    </div>
  );
}

const date = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

const role = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
