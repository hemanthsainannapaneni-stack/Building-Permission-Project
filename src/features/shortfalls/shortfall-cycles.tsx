'use client';

import * as React from 'react';
import { MessageSquare, Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ShortfallResolution } from './types';

/**
 * EVERY CYCLE, IN ORDER — and none of them overwritten.
 *
 * ── Why the history is the shape of the argument ─────────────────────────
 *
 * "I sent that weeks ago" is a real conversation, and the record has to be
 * able to answer it from both sides. A shortfall that was answered, rejected,
 * answered again and accepted is FOUR events involving three people, and a
 * screen that shows only the last one makes the applicant's first answer
 * disappear — which is exactly the answer they remember sending.
 *
 * So every attempt stays, numbered, with the verdict that judged it and the
 * lines it covered. Cycle 1 is never edited when cycle 2 arrives.
 *
 * ── The newest cycle reads first ─────────────────────────────────────────
 *
 * Whoever opens this wants to know where it stands, not where it started. The
 * numbering makes the order unambiguous either way, so the display order is
 * free to serve the commoner question.
 */
export function ShortfallCycles({
  resolutions,
  emptyMessage,
}: {
  resolutions: ShortfallResolution[];
  emptyMessage: string;
}) {
  if (!resolutions.length) {
    return <p className="text-small text-text-muted">{emptyMessage}</p>;
  }

  const newestFirst = [...resolutions].sort((a, b) => b.attemptNo - a.attemptNo);

  return (
    <ol className="space-y-3">
      {newestFirst.map((cycle, index) => (
        <li
          key={cycle.id}
          className={cn(
            'rounded border p-3',
            index === 0 ? 'border-border-strong bg-surface' : 'border-border bg-surface-sunk/40'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-small font-medium text-text">
              <MessageSquare className="size-3.5 text-text-muted" aria-hidden />
              Cycle {cycle.attemptNo}
            </span>

            <span className="text-caption text-text-muted">
              {cycle.respondedByName} · {new Date(cycle.respondedAt).toLocaleString()}
            </span>

            {cycle.reviewedAt ? (
              cycle.accepted ? (
                <Badge tone="success">Accepted</Badge>
              ) : (
                <Badge tone="danger">Not accepted</Badge>
              )
            ) : (
              <Badge tone="info">Awaiting a decision</Badge>
            )}
          </div>

          <p className="mt-1.5 text-small text-text">{cycle.response}</p>

          {Array.isArray(cycle.attachments) && cycle.attachments.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {cycle.attachments.map((attachment, i) => (
                <li key={i} className="flex items-center gap-1.5 text-caption text-text-muted">
                  <Paperclip className="size-3" aria-hidden />
                  {attachment.name ?? 'Attachment'}
                </li>
              ))}
            </ul>
          )}

          {/* The lines answered in this cycle, if it was answered line by line. */}
          {cycle.items.length > 0 && (
            <ul className="mt-2.5 space-y-1.5 border-l-2 border-border pl-3">
              {cycle.items.map((item) => (
                <li key={item.itemId} className="text-caption">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium tabular-nums text-text-muted">
                      Item {item.itemNo}
                    </span>
                    <span className="truncate text-text-muted">{item.description}</span>
                    {item.decision === 'ACCEPTED' && <Badge tone="success">Accepted</Badge>}
                    {item.decision === 'REJECTED' && <Badge tone="danger">Rejected</Badge>}
                  </span>

                  <p className="text-text">{item.response}</p>

                  {item.applicantRemarks && (
                    <p className="text-text-muted">Remarks: {item.applicantRemarks}</p>
                  )}

                  {item.attachments.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-text-muted">
                      <Paperclip className="size-3" aria-hidden />
                      {item.attachments.map((a) => a.name ?? 'Attachment').join(', ')}
                    </p>
                  )}

                  {item.reviewRemarks && (
                    <p className="text-text-muted">
                      {item.reviewedByName || 'Reviewer'}: {item.reviewRemarks}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {cycle.reviewedAt && cycle.reviewRemarks && (
            <p className="mt-2 border-t border-border pt-2 text-caption text-text-muted">
              <span className="font-medium">{cycle.reviewedByName || 'Reviewer'}</span> ·{' '}
              {new Date(cycle.reviewedAt).toLocaleString()} — {cycle.reviewRemarks}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
