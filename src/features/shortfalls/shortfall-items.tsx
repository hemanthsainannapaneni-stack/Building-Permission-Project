'use client';

import * as React from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  CircleDot,
  FileUp,
  Paperclip,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoney } from '@/lib/fees';
import { itemStatusLabel } from '@/lib/shortfalls';
import { cn } from '@/lib/utils';
import type { ShortfallItem, UploadedAttachment } from './types';

/**
 * THE ITEM WORKSPACE — a shortfall, line by line.
 *
 * ── Why the items are a workspace and not a list ─────────────────────────
 *
 * A shortfall letter with six deficiencies is six separate conversations that
 * happen to share an envelope. The applicant answers them one at a time, over
 * days, as each document arrives; the officer accepts four and sends two back.
 * A single response box against the whole letter forces both sides to write
 * prose that maps their six answers onto six requests, and then to read each
 * other's prose to work out which is which.
 *
 * So each line carries its own answer, its own attachment and its own verdict,
 * and the covering response the shortfall has always had stays where it is —
 * as the covering note, which is what it was always for.
 *
 * ── Whose move it is decides what a row shows ────────────────────────────
 *
 * The same row is a form for the applicant, a decision for the officer, and a
 * record for anybody else. Nobody is shown a control they cannot use.
 */

export type ItemDraft = { response: string; remarks: string; attachments: UploadedAttachment[] };
export type DecisionDraft = { decision: 'ACCEPTED' | 'REJECTED' | null; remarks: string };

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  PENDING: 'warning',
  RESPONDED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WAIVED: 'neutral',
};

export function ShortfallItems({
  items,
  mode,
  drafts,
  onDraftChange,
  decisions,
  onDecisionChange,
  onUpload,
  uploading,
}: {
  items: ShortfallItem[];
  /** `respond` for the applicant's turn, `review` for the officer's. */
  mode: 'respond' | 'review' | 'read';
  drafts: Record<string, ItemDraft>;
  onDraftChange: (itemId: string, next: Partial<ItemDraft>) => void;
  decisions: Record<string, DecisionDraft>;
  onDecisionChange: (itemId: string, next: Partial<DecisionDraft>) => void;
  onUpload: (itemId: string, file: File) => void;
  uploading: string | null;
}) {
  // Open by default when there is something to do, closed when the screen is a
  // record: six collapsed rows is a summary, six open ones is the work.
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(mode === 'read' ? [] : items.filter((i) => !i.isResolved).map((i) => i.id))
  );

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!items.length) {
    return (
      <p className="rounded border border-dashed border-border px-3 py-6 text-center text-small text-text-muted">
        This shortfall lists no individual items — read the description above for what is required.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          mode={mode}
          open={expanded.has(item.id)}
          onToggle={() => toggle(item.id)}
          draft={drafts[item.id] ?? { response: '', remarks: '', attachments: [] }}
          onDraftChange={(next) => onDraftChange(item.id, next)}
          decision={decisions[item.id] ?? { decision: null, remarks: '' }}
          onDecisionChange={(next) => onDecisionChange(item.id, next)}
          onUpload={(file) => onUpload(item.id, file)}
          uploading={uploading === item.id}
        />
      ))}
    </ul>
  );
}

function ItemRow({
  item,
  mode,
  open,
  onToggle,
  draft,
  onDraftChange,
  decision,
  onDecisionChange,
  onUpload,
  uploading,
}: {
  item: ShortfallItem;
  mode: 'respond' | 'review' | 'read';
  open: boolean;
  onToggle: () => void;
  draft: ItemDraft;
  onDraftChange: (next: Partial<ItemDraft>) => void;
  decision: DecisionDraft;
  onDecisionChange: (next: Partial<DecisionDraft>) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const latest = item.latestResponse;
  const settled = item.isResolved;

  // A settled line is never a form again. The officer took it; re-opening it
  // would be a second decision on the same item with no record of the first.
  const canRespond = mode === 'respond' && !settled;
  const canReview = mode === 'review' && !settled;

  return (
    <li
      className={cn(
        'rounded border transition-colors',
        settled ? 'border-border bg-surface-sunk/50' : 'border-border-strong bg-surface'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="mt-0.5 shrink-0" aria-hidden>
          {settled ? (
            <CircleCheck className="size-4 text-success" />
          ) : (
            <CircleDot className="size-4 text-text-subtle" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-medium tabular-nums text-text-muted">
              Item {item.itemNo}
            </span>
            {item.category && <Badge tone="outline">{item.category}</Badge>}
            {!item.isMandatory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge tone="neutral">Not mandatory</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Approval is not blocked by this line. Every other item is.
                </TooltipContent>
              </Tooltip>
            )}
            <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
              {itemStatusLabel(item.status)}
            </Badge>
            {item.amount && (
              <span className="tabular-nums text-small text-text">
                {formatMoney(Number(item.amount))}
              </span>
            )}
          </span>

          <span
            className={cn(
              'mt-1 block text-small',
              settled ? 'text-text-muted' : 'font-medium text-text'
            )}
          >
            {item.description}
          </span>
        </span>

        <ChevronDown
          className={cn(
            'mt-1 size-4 shrink-0 text-text-subtle transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label="Required action" value={item.requiredAction} />
            <Fact label="Document required" value={item.requiredDocument} />
            {item.remarks && <Fact label="Remarks" value={item.remarks} className="sm:col-span-2" />}
          </dl>

          {/* ── What has been said about this line already ──────────────── */}
          {latest && (
            <div className="rounded border border-border bg-surface-sunk p-2.5">
              <p className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                <span className="font-medium">Response — cycle {latest.attemptNo}</span>
                <span>
                  {latest.respondedByName} · {new Date(latest.respondedAt).toLocaleDateString()}
                </span>
                {latest.decision === 'ACCEPTED' && <Badge tone="success">Accepted</Badge>}
                {latest.decision === 'REJECTED' && <Badge tone="danger">Rejected</Badge>}
                {!latest.decision && <Badge tone="info">Awaiting a decision</Badge>}
              </p>

              <p className="mt-1.5 text-small text-text">{latest.response}</p>

              {latest.applicantRemarks && (
                <p className="mt-1 text-caption text-text-muted">
                  Applicant remarks: {latest.applicantRemarks}
                </p>
              )}

              {latest.attachments.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {latest.attachments.map((attachment, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-caption text-text-muted">
                      <Paperclip className="size-3" aria-hidden />
                      {attachment.name ?? 'Attachment'}
                    </li>
                  ))}
                </ul>
              )}

              {latest.reviewedAt && (
                <p className="mt-2 border-t border-border pt-1.5 text-caption text-text-muted">
                  <span className="font-medium">{latest.reviewedByName || 'Reviewer'}</span> ·{' '}
                  {new Date(latest.reviewedAt).toLocaleDateString()}
                  {latest.reviewRemarks ? ` — ${latest.reviewRemarks}` : ''}
                </p>
              )}
            </div>
          )}

          {/* Everything before the latest, when there is a history worth reading. */}
          {item.responses.length > 1 && (
            <details className="text-caption text-text-muted">
              <summary className="cursor-pointer select-none hover:text-text">
                {item.responses.length - 1} earlier{' '}
                {item.responses.length === 2 ? 'response' : 'responses'} on this item
              </summary>
              <ol className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3">
                {item.responses.slice(0, -1).map((response) => (
                  <li key={response.id}>
                    <span className="font-medium">Cycle {response.attemptNo}</span> ·{' '}
                    {new Date(response.respondedAt).toLocaleDateString()}
                    {response.decision === 'REJECTED' && ' · not accepted'}
                    {response.decision === 'ACCEPTED' && ' · accepted'}
                    <p className="text-text">{response.response}</p>
                    {response.reviewRemarks && <p>{response.reviewRemarks}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}

          {/* ── The applicant's turn ───────────────────────────────────── */}
          {canRespond && (
            <div className="space-y-2 rounded border border-primary/30 bg-primary-bg/30 p-2.5">
              <label
                className="block text-caption font-medium text-text"
                htmlFor={`item-response-${item.id}`}
              >
                Your response to item {item.itemNo}
              </label>
              <Textarea
                id={`item-response-${item.id}`}
                rows={2}
                value={draft.response}
                maxLength={2000}
                onChange={(e) => onDraftChange({ response: e.target.value })}
                placeholder={item.requiredAction || 'What have you done about this item?'}
              />

              <Textarea
                aria-label={`Remarks on item ${item.itemNo}`}
                rows={1}
                value={draft.remarks}
                maxLength={1000}
                onChange={(e) => onDraftChange({ remarks: e.target.value })}
                placeholder="Anything else the officer should know (optional)"
              />

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <FileUp />
                  Attach
                </Button>

                {draft.attachments.map((attachment) => (
                  <span
                    key={attachment.fileObjectId}
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-caption"
                  >
                    <Paperclip className="size-3 text-text-muted" aria-hidden />
                    <span className="max-w-[10rem] truncate">{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() =>
                        onDraftChange({
                          attachments: draft.attachments.filter(
                            (a) => a.fileObjectId !== attachment.fileObjectId
                          ),
                        })
                      }
                      className="text-text-subtle hover:text-text"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── The officer's turn ─────────────────────────────────────── */}
          {canReview && (
            <div className="space-y-2 rounded border border-border-strong bg-surface-sunk p-2.5">
              <p className="text-caption font-medium text-text">Your decision on item {item.itemNo}</p>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={decision.decision === 'ACCEPTED' ? 'primary' : 'secondary'}
                  aria-pressed={decision.decision === 'ACCEPTED'}
                  onClick={() =>
                    onDecisionChange({
                      decision: decision.decision === 'ACCEPTED' ? null : 'ACCEPTED',
                    })
                  }
                >
                  <CheckCircle2 />
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={decision.decision === 'REJECTED' ? 'destructive' : 'secondary'}
                  aria-pressed={decision.decision === 'REJECTED'}
                  onClick={() =>
                    onDecisionChange({
                      decision: decision.decision === 'REJECTED' ? null : 'REJECTED',
                    })
                  }
                >
                  <Ban />
                  Reject
                </Button>
              </div>

              {decision.decision && (
                <Textarea
                  aria-label={`Remarks on item ${item.itemNo}`}
                  rows={2}
                  value={decision.remarks}
                  maxLength={2000}
                  onChange={(e) => onDecisionChange({ remarks: e.target.value })}
                  placeholder={
                    decision.decision === 'REJECTED'
                      ? 'Say what is still wrong with it — the applicant fixes this line and no other.'
                      : 'Why it was accepted (optional — the covering remarks apply otherwise)'
                  }
                />
              )}

              {!latest && (
                <p className="text-caption text-text-muted">
                  Nothing has been submitted against this item. Rejecting it records that it was
                  not answered.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-small text-text">{value || <span className="text-text-subtle">—</span>}</dd>
    </div>
  );
}
