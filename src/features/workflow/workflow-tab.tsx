'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Clock,
  Hand,
  History,
  Lock,
  TriangleAlert,
  User,
  Users,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import { priorityLabel, slaLabel, stageName, daysBetween } from '@/lib/workflow';
import { SlaPanel } from './sla-panel';
import { isShortfallOpen } from '@/lib/shortfalls';
import { statusMeta } from '@/lib/status';
import { cn } from '@/lib/utils';
import { ActionModal, type ActionSubmission } from './action-modal';
import { ShortfallPanel } from './shortfall-panel';
import type { ActionOption, ActionResult, HistoryEntry, Shortfall, WorkflowState } from './types';

/**
 * The Workflow tab — where the file is, who has it, and what happens next.
 *
 * ── The action bar renders the server's answer and nothing else ──────────
 *
 * Every button here came from `GET /api/workflow/applications/:id/actions`,
 * including whether it is enabled and the sentence explaining why it is not.
 * This component does not know that a Commissioner may approve or that a TPA
 * may not; it knows how to draw a list. That is what makes the buttons
 * trustworthy — there is no second opinion in the client that could disagree
 * with the engine.
 *
 * ── A disabled action still says what it is waiting for ──────────────────
 *
 * "Approve — 2 shortfalls are still open" is information. A hidden button is a
 * mystery, and a greyed-out one with no reason is worse: it teaches people to
 * ring the office rather than read the screen.
 */
export function WorkflowTab({
  applicationId,
  initialState,
  initialHistory,
  initialShortfalls,
  canClaim,
  currentUserId,
}: {
  applicationId: string;
  initialState: WorkflowState;
  initialHistory: HistoryEntry[];
  initialShortfalls: Shortfall[];
  canClaim: boolean;
  currentUserId: string;
}) {
  const router = useRouter();

  const [state, setState] = React.useState(initialState);
  const [history, setHistory] = React.useState(initialHistory);
  const [shortfalls, setShortfalls] = React.useState(initialShortfalls);
  const [open, setOpen] = React.useState<ActionOption | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);

  React.useEffect(() => setState(initialState), [initialState]);
  React.useEffect(() => setHistory(initialHistory), [initialHistory]);
  React.useEffect(() => setShortfalls(initialShortfalls), [initialShortfalls]);

  const refresh = React.useCallback(async () => {
    try {
      const [next, entries, sf] = await Promise.all([
        api.get<WorkflowState>(`/api/workflow/applications/${applicationId}/actions`),
        api.get<HistoryEntry[]>(`/api/workflow/applications/${applicationId}/history`),
        api
          .get<Shortfall[]>(`/api/workflow/applications/${applicationId}/shortfalls`)
          .catch(() => shortfalls),
      ]);
      setState(next);
      setHistory(entries);
      setShortfalls(sf);
    } catch {
      // Keep the last good screen. The router refresh below re-renders from
      // the server anyway, and blanking the page on a transient failure would
      // lose the officer their place.
    }
    router.refresh();
  }, [applicationId, router, shortfalls]);

  async function perform(input: ActionSubmission) {
    if (!open) return;
    setSubmitting(true);

    try {
      const result = await api.post<ActionResult>(
        `/api/workflow/applications/${applicationId}/actions/${open.code}`,
        {
          ...input,
          // The sequence this screen was drawn from. If somebody else has acted
          // in the meantime the server refuses, rather than recording a second
          // decision on a stage the file has already left.
          expectedSequence: state.sequence,
        }
      );

      toast.success(result.message, { description: state.application.applicationNumber });
      setOpen(null);
      await refresh();
    } catch (error) {
      const message =
        error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.';

      if (error instanceof ApiCallError && error.code === 'STALE_WRITE') {
        toast.error('This application has moved on', { description: message });
        setOpen(null);
        await refresh();
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function claim(release = false) {
    if (!state.task) return;
    setClaiming(true);
    try {
      const result = await api.post<{ message: string }>(
        `/api/workflow/tasks/${state.task.id}/${release ? 'release' : 'claim'}`
      );
      toast.success(result.message);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.');
    } finally {
      setClaiming(false);
    }
  }

  // ── Not with the department yet ─────────────────────────────────────────
  if (!state.instance) {
    return (
      <EmptyState
        icon={WorkflowIcon}
        title="This application has not reached the department yet"
        description="The departmental review begins when the fee has been paid in full. Everything the applicant does before that is on the other tabs."
      />
    );
  }

  const { stage, task } = state;
  const openShortfalls = shortfalls.filter((s) => isShortfallOpen(s.status));

  /**
   * The desk this file goes to next if it is sent on.
   *
   * Read off the engine's own action list rather than from any table in this
   * component. `getWorkflowState` resolves the available actions from
   * `workflow_transitions`, and each carries the stage it leads to — so this
   * line says "Planning Officer" under BBAS_STANDARD and "ZAD/ZDD" under the
   * extended chain without knowing that either exists. A desk with no onward
   * action, or a terminal one, simply has no next desk to name.
   */
  const onward = state.actions.find((a) => a.kind === 'FORWARD' && a.toStageName);

  return (
    <div className="space-y-5">
      {/* ── Where it is ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {stage ? stageName(stage.code) : 'Closed'}
              <StatusBadge status={state.application.status} />
              {state.instance.status === 'PARKED' && (
                <Badge tone="warning">Waiting on the applicant</Badge>
              )}
              {state.instance.status === 'COMPLETED' && <Badge tone="neutral">Closed</Badge>}
            </CardTitle>
            <CardDescription>
              {stage?.isTerminal
                ? 'This application has been decided. Nothing further happens to it.'
                : task
                  ? `At this desk for ${daysBetween(task.receivedAt)} ${daysBetween(task.receivedAt) === 1 ? 'day' : 'days'}.`
                  : 'No task is open on this application.'}
            </CardDescription>
            {!stage?.isTerminal && onward && (
              <p className="mt-1 flex items-center gap-1.5 text-caption text-text-muted">
                <span>Next desk</span>
                <ArrowRight className="size-3" aria-hidden="true" />
                <span className="font-medium text-text">{onward.toStageName}</span>
              </p>
            )}
          </div>

          {task && (
            <div className="shrink-0 text-right">
              {task.dueAt && (
                <p
                  className={cn(
                    'text-small font-medium tabular-nums',
                    task.slaStatus === 'OVERDUE'
                      ? 'text-danger'
                      : task.slaStatus === 'DUE_SOON'
                        ? 'text-warning'
                        : 'text-text'
                  )}
                >
                  {slaLabel(task.dueAt)}
                </p>
              )}
              {task.slaStatus && (
                <Badge tone={statusMeta('sla', task.slaStatus).tone} className="mt-1">
                  {statusMeta('sla', task.slaStatus).label}
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        {task && (
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small">
              <span className="flex items-center gap-1.5 text-text-muted">
                <Users className="size-4" aria-hidden />
                {task.assignedRoleKey.replace(/_/g, ' ')}
              </span>

              <span className="flex items-center gap-1.5 text-text-muted">
                <User className="size-4" aria-hidden />
                {task.assignedUserId
                  ? task.assignedUserId === currentUserId
                    ? 'You are holding this file'
                    : `With ${task.assignedUserName}`
                  : 'Not claimed by anyone'}
              </span>

              <span className="flex items-center gap-1.5 text-text-muted">
                <Clock className="size-4" aria-hidden />
                Arrived {new Date(task.receivedAt).toLocaleDateString()}
              </span>

              {task.priority > 0 && (
                <Badge tone={priorityLabel(task.priority).tone}>{priorityLabel(task.priority).label}</Badge>
              )}
            </div>

            <SlaPanel sla={task.sla} />

            {canClaim && task.mine && (
              <div className="flex gap-2">
                {task.assignedUserId === currentUserId ? (
                  <Button variant="secondary" size="sm" onClick={() => claim(true)} loading={claiming}>
                    <Hand />
                    Release
                  </Button>
                ) : task.assignedUserId === null ? (
                  <Button variant="secondary" size="sm" onClick={() => claim(false)} loading={claiming}>
                    <Hand />
                    Claim this file
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── The action bar ────────────────────────────────────────────────── */}
      {state.actions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What you can do</CardTitle>
            <CardDescription>
              Every action here is one the workflow permits at this stage, for your role. An action
              that is greyed out says what it is waiting for.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {state.actions.map((action) =>
                action.available ? (
                  <Button
                    key={action.code}
                    variant={
                      action.intent === 'primary'
                        ? 'primary'
                        : action.intent === 'destructive'
                          ? 'destructive'
                          : 'secondary'
                    }
                    onClick={() =>
                      action.inspection
                        ? router.replace(`/applications/${applicationId}?tab=inspection`, { scroll: false })
                        : action.proceeding
                          ? router.replace(`/applications/${applicationId}?tab=proceedings`, { scroll: false })
                          : setOpen(action)
                    }
                  >
                    {action.label}
                    {action.toStageCode && action.kind !== 'REJECT' && <ArrowRight />}
                  </Button>
                ) : (
                  // The tooltip wraps a SPAN: a disabled button receives no
                  // pointer events, so a tooltip on it never fires and the
                  // reason never arrives.
                  <Tooltip key={action.code}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button variant="secondary" disabled className="cursor-not-allowed gap-1.5">
                          {action.label}
                          <Lock className="size-3" aria-hidden />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{action.reason}</TooltipContent>
                  </Tooltip>
                )
              )}
            </div>

            {state.actions.some((a) => !a.available) && (
              <ul className="mt-3 space-y-1">
                {state.actions
                  .filter((a) => !a.available)
                  .map((a) => (
                    <li key={a.code} className="flex items-start gap-2 text-caption text-text-muted">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                      <span>
                        <span className="font-medium text-text">{a.label}</span> — {a.reason}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Shortfalls ────────────────────────────────────────────────────── */}
      {shortfalls.length > 0 && (
        <ShortfallPanel shortfalls={shortfalls} openCount={openShortfalls.length} />
      )}

      {/* ── The movement history ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden />
            Movement history
          </CardTitle>
          <CardDescription>
            Every decision taken on this file, in order. Written once and never edited — the database
            refuses an update to these rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HistoryList entries={history} />
        </CardContent>
      </Card>

      <ActionModal
        action={open}
        applicationNumber={state.application.applicationNumber}
        currentStageCode={stage?.code ?? ''}
        currentStatus={state.application.status}
        submitting={submitting}
        onClose={() => setOpen(null)}
        onSubmit={perform}
      />
    </div>
  );
}

/** The history, newest first — "what happened last" is the usual question. */
function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) {
    return (
      <EmptyState
        icon={History}
        title="Nothing recorded yet"
        description="Each time this file moves, who moved it and why is recorded here."
      />
    );
  }

  const ordered = [...entries].sort((a, b) => b.sequence - a.sequence);

  return (
    <ol className="space-y-0">
      {ordered.map((entry, index) => {
        const effects = Array.isArray(entry.effectsApplied) ? entry.effectsApplied : [];
        const last = index === ordered.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-border" aria-hidden />
            )}

            <span
              className="relative z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted"
              aria-hidden
            >
              <span className="text-caption tabular-nums">{entry.sequence}</span>
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-small font-medium text-text">
                  {entry.actionLabel || entry.actionCode}
                  {entry.toStageCode && entry.toStageCode !== entry.fromStageCode && (
                    <span className="font-normal text-text-muted">
                      {' '}
                      · {stageName(entry.fromStageCode)} → {stageName(entry.toStageCode)}
                    </span>
                  )}
                </p>
                <time
                  className="shrink-0 text-caption tabular-nums text-text-muted"
                  dateTime={entry.occurredAt}
                >
                  {new Date(entry.occurredAt).toLocaleString()}
                </time>
              </div>

              <p className="text-caption text-text-muted">
                {entry.actorName}
                {entry.actorRoleKey && entry.actorRoleKey !== 'SYSTEM'
                  ? ` · ${entry.actorRoleKey.replace(/_/g, ' ')}`
                  : ''}
              </p>

              {entry.remarks && <p className="mt-1 text-small text-text">{entry.remarks}</p>}

              {effects.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {effects.map((effect, i) => (
                    <Badge key={i} tone="outline">
                      {describeEffect(effect)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** An effect, in a few words. The audit row keeps the full payload. */
function describeEffect(effect: Record<string, unknown>): string {
  const type = String(effect.type ?? '');

  switch (type) {
    case 'RAISE_SHORTFALL':
      return `${String(effect.shortfallNumber ?? 'Shortfall')} raised (${String(effect.kind ?? '').toLowerCase()}, ${String(effect.mode ?? '').toLowerCase()})`;
    case 'GENERATE_FEE_DEMAND':
      return `Demand ${String(effect.demandNumber ?? '')} for ${String(effect.total ?? '')}`;
    case 'RECORD_RESOLUTION':
      return 'Response recorded';
    case 'RESOLVE_SHORTFALL':
      return `Settled ${(effect.shortfalls as string[] | undefined)?.join(', ') ?? ''}`;
    case 'REJECT_RESOLUTION':
      return 'Response rejected';
    case 'RETURN_TO_ORIGIN':
      return `Returned to ${stageName(String(effect.toStageCode ?? ''))}`;
    case 'GENERATE_APPROVAL_ORDER':
      return 'Approval order queued';
    case 'CLOSE_WORKFLOW':
      return `Closed — ${String(effect.outcome ?? effect.status ?? '')}`;
    default:
      return type.replace(/_/g, ' ').toLowerCase();
  }
}
