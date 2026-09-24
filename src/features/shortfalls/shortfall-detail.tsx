'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CircleCheck,
  Clock,
  FileText,
  FileUp,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { StatusBadge } from '@/components/common/status-badge';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import { stageName } from '@/lib/workflow';
import { formatMoney } from '@/lib/fees';
import { KIND_META, dueLabel, isShortfallOpen, kindLabel, turnOf } from '@/lib/shortfalls';
import { cn } from '@/lib/utils';
import { ShortfallItems, type DecisionDraft, type ItemDraft } from './shortfall-items';
import { ShortfallCycles } from './shortfall-cycles';
import type { ShortfallActionResult, ShortfallDetail as Detail, UploadedAttachment } from './types';

/**
 * One shortfall, end to end: what was asked, item by item; what has been said
 * about it, cycle by cycle; and the one thing the reader can do next.
 *
 * ── The screen is built around whose move it is ──────────────────────────
 *
 * An applicant sees the required action, the items as a form, the demand if
 * there is one, and a response box. An officer sees the same history and an
 * accept / reject pair, per item and over the whole letter. Neither sees the
 * other's controls, because a form you cannot submit is worse than no form.
 *
 * ── A fee shortfall shows the money and its state ────────────────────────
 *
 * The demand, what is outstanding, and a link to pay it. The officer's Accept
 * is refused by the server until the ledger says it is paid, so the screen
 * says so first rather than letting somebody discover it in an error toast.
 */
export function ShortfallDetailView({
  initial,
  viewerIsApplicant,
  canRespond,
  canReview,
  canWithdraw,
}: {
  initial: Detail;
  viewerIsApplicant: boolean;
  canRespond: boolean;
  canReview: boolean;
  canWithdraw: boolean;
}) {
  const router = useRouter();
  const [shortfall, setShortfall] = React.useState(initial);
  const [response, setResponse] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [attachments, setAttachments] = React.useState<UploadedAttachment[]>([]);
  const [itemDrafts, setItemDrafts] = React.useState<Record<string, ItemDraft>>({});
  const [decisions, setDecisions] = React.useState<Record<string, DecisionDraft>>({});
  const [busy, setBusy] = React.useState<'respond' | 'accept' | 'reject' | 'upload' | null>(null);
  const [uploadingItem, setUploadingItem] = React.useState<string | null>(null);
  const [withdrawing, setWithdrawing] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setShortfall(initial), [initial]);

  const open = isShortfallOpen(shortfall.status);
  const turn = turnOf(shortfall.status);
  const overdue = shortfall.sla.state === 'OVERDUE';

  const unpaid = shortfall.demands.filter((d) =>
    ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'].includes(d.status)
  );

  const applicantTurn = open && turn === 'APPLICANT';
  const officerTurn = open && turn === 'OFFICER';

  const itemMode: 'respond' | 'review' | 'read' =
    applicantTurn && canRespond ? 'respond' : officerTurn && canReview ? 'review' : 'read';

  async function refresh() {
    try {
      setShortfall(await api.get<Detail>(`/api/shortfalls/${shortfall.id}`));
    } catch {
      // Keep what is on screen; the router refresh re-renders from the server.
    }
    router.refresh();
  }

  function updateDraft(itemId: string, next: Partial<ItemDraft>) {
    setItemDrafts((current) => ({
      ...current,
      [itemId]: { response: '', remarks: '', attachments: [], ...current[itemId], ...next },
    }));
  }

  function updateDecision(itemId: string, next: Partial<DecisionDraft>) {
    setDecisions((current) => ({
      ...current,
      [itemId]: { decision: null, remarks: '', ...current[itemId], ...next },
    }));
  }

  /** Uploads through the shortfall's own endpoint, scanned like any other file. */
  async function uploadTo(file: File, itemId: string | null) {
    if (itemId) setUploadingItem(itemId);
    else setBusy('upload');

    try {
      const form = new FormData();
      form.append('file', file);

      const result = await fetch(`/api/shortfalls/${shortfall.id}/attachments`, {
        method: 'POST',
        body: form,
      });

      const body = (await result.json()) as UploadedAttachment & { error?: string };
      if (!result.ok) throw new ApiCallError(body.error ?? 'That file could not be attached.');

      if (itemId) {
        updateDraft(itemId, {
          attachments: [...(itemDrafts[itemId]?.attachments ?? []), body],
        });
      } else {
        setAttachments((current) => [...current, body]);
      }

      toast.success('Attached', { description: body.name });
    } catch (error) {
      toast.error(
        error instanceof ApiCallError ? error.message : 'That file could not be attached.'
      );
    } finally {
      setUploadingItem(null);
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function respond() {
    const items = Object.entries(itemDrafts)
      .filter(([, draft]) => draft.response.trim().length > 0)
      .map(([itemId, draft]) => ({
        itemId,
        response: draft.response.trim(),
        applicantRemarks: draft.remarks.trim(),
        attachments: draft.attachments.map((a) => ({
          fileObjectId: a.fileObjectId,
          name: a.name,
          note: '',
        })),
      }));

    // The covering response is what goes to the officer and into the record,
    // so it is required even when every line has been answered. Rather than
    // refuse a filled-in form over an empty summary box, the item answers are
    // folded into one — the applicant has already said it, line by line.
    const covering =
      response.trim() ||
      (items.length
        ? items.map((item, i) => `${i + 1}. ${item.response}`).join('\n')
        : '');

    if (!covering) {
      toast.error('Say what you have done about it — against the items, or in the summary.');
      return;
    }

    setBusy('respond');
    try {
      const result = await api.post<ShortfallActionResult>(
        `/api/shortfalls/${shortfall.id}/respond`,
        {
          response: covering,
          attachments: attachments.map((a) => ({
            fileObjectId: a.fileObjectId,
            name: a.name,
            note: '',
          })),
          items,
        }
      );

      toast.success(result.message, { description: shortfall.shortfallNumber });
      setResponse('');
      setAttachments([]);
      setItemDrafts({});
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function review(accept: boolean) {
    if (!remarks.trim()) {
      toast.error('Say why, in a sentence. Your decision goes on the record either way.');
      return;
    }

    const items = Object.entries(decisions)
      .filter(([, d]) => d.decision !== null)
      .map(([itemId, d]) => ({
        itemId,
        decision: d.decision as 'ACCEPTED' | 'REJECTED',
        remarks: d.remarks.trim(),
      }));

    // Rejecting the letter while every line was ticked Accept is a
    // contradiction the server would happily record. Caught here, where the
    // officer can still see which ticks they meant.
    if (!accept && items.length > 0 && items.every((i) => i.decision === 'ACCEPTED')) {
      toast.error(
        'Every item is marked accepted, so there is nothing to send back. Reject the item that is still wrong, or accept the shortfall.'
      );
      return;
    }

    setBusy(accept ? 'accept' : 'reject');
    try {
      const result = await api.post<ShortfallActionResult>(
        `/api/shortfalls/${shortfall.id}/review`,
        { accept, remarks: remarks.trim(), items }
      );

      toast.success(result.message, {
        description: result.movedTo ? `The file is now at ${stageName(result.movedTo)}.` : undefined,
      });
      setRemarks('');
      setDecisions({});
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(reason: string) {
    try {
      const result = await api.post<ShortfallActionResult>(
        `/api/shortfalls/${shortfall.id}/withdraw`,
        { reason }
      );
      toast.success(result.message);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.');
    }
  }

  const rejectedCount = Object.values(decisions).filter((d) => d.decision === 'REJECTED').length;

  return (
    <div className="space-y-5">
      {/* ── The header: everything a reader needs to place this file ──────── */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {shortfall.title}
              <StatusBadge kind="shortfall" status={shortfall.status} />
              <Badge tone="outline">{kindLabel(shortfall.kind)}</Badge>
              {shortfall.cycle > 1 && <Badge tone="warning">Cycle {shortfall.cycle}</Badge>}
              {shortfall.mode === 'REPORTED' && <Badge tone="info">Travels with the file</Badge>}
            </CardTitle>
            <CardDescription>
              {shortfall.shortfallNumber} · raised at {stageName(shortfall.raisedAtStageCode)} by{' '}
              {shortfall.raisedByName || shortfall.raisedByRoleKey.replace(/_/g, ' ')} on{' '}
              {new Date(shortfall.raisedAt).toLocaleDateString()}
            </CardDescription>
          </div>

          <div className="flex shrink-0 items-start gap-3">
            {shortfall.dueDate && open && (
              <p
                className={cn(
                  'flex items-center gap-1 text-small tabular-nums',
                  overdue ? 'font-medium text-danger' : 'text-text'
                )}
              >
                <Clock className="size-4" aria-hidden />
                {dueLabel(shortfall.dueDate)}
              </p>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" asChild>
                  <a
                    href={`/api/shortfalls/${shortfall.id}/letter`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText />
                    Letter
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Opens the shortfall letter as a PDF — the notice as the applicant receives it.
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Shortfall number" value={shortfall.shortfallNumber} />
            <Fact
              label="Application"
              value={
                <Link
                  href={`/applications/${shortfall.application.id}`}
                  className="text-primary hover:underline"
                >
                  {shortfall.application.applicationNumber}
                </Link>
              }
            />
            <Fact label="Cycle" value={`${shortfall.cycle}`} />
            <Fact label="Current status" value={<StatusBadge kind="shortfall" status={shortfall.status} />} />
            <Fact label="Current desk" value={stageName(shortfall.application.currentStageCode)} />
            <Fact label="Raised by" value={shortfall.raisedByName || '—'} />
            <Fact label="Raised date" value={new Date(shortfall.raisedAt).toLocaleDateString()} />
            <Fact
              label="Due date"
              value={
                shortfall.dueDate ? (
                  <span className={overdue ? 'font-medium text-danger' : undefined}>
                    {new Date(shortfall.dueDate).toLocaleDateString()}
                  </span>
                ) : (
                  'No date set'
                )
              }
            />
          </dl>

          <div className="border-t border-border pt-3">
            <p className="text-caption text-text-muted">What is wrong</p>
            <p className="text-body text-text">{shortfall.description}</p>
          </div>

          {shortfall.requiredAction && (
            <div className="rounded border border-border bg-surface-sunk p-3">
              <p className="text-caption text-text-muted">What is required</p>
              <p className="text-body font-medium text-text">{shortfall.requiredAction}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── The items ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Items
            <Badge tone={shortfall.pendingItems ? 'warning' : 'success'}>
              {shortfall.resolvedItems} of {shortfall.itemCount} resolved
            </Badge>
            {shortfall.mandatoryPendingItems > 0 && (
              <Badge tone="danger">{shortfall.mandatoryPendingItems} mandatory outstanding</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {itemMode === 'respond'
              ? 'Answer each item below. What you write against an item is kept with that item, through every cycle.'
              : itemMode === 'review'
                ? 'Decide each item. Rejecting one sends the whole shortfall back, and the applicant fixes the lines you rejected.'
                : 'Each deficiency, with what was said about it and what was decided.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <ShortfallItems
            items={shortfall.items}
            mode={itemMode}
            drafts={itemDrafts}
            onDraftChange={updateDraft}
            decisions={decisions}
            onDecisionChange={updateDecision}
            onUpload={(itemId, file) => void uploadTo(file, itemId)}
            uploading={uploadingItem}
          />
        </CardContent>
      </Card>

      {/* ── The money ─────────────────────────────────────────────────────── */}
      {shortfall.demands.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional demand</CardTitle>
            <CardDescription>
              {unpaid.length
                ? 'This shortfall cannot be settled until the demand has been paid — the officer’s Accept reads the ledger, not the response.'
                : 'Paid in full.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {shortfall.demands.map((demand) => (
              <div
                key={demand.id}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-border px-3 py-2"
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-text">{demand.demandNumber}</span>
                  <StatusBadge kind="demand" status={demand.status} />
                </span>
                <span className="flex items-baseline gap-4">
                  <span className="tabular-nums text-text">
                    {formatMoney(Number(demand.totalAmount))}
                  </span>
                  {viewerIsApplicant && ['ISSUED', 'PARTIALLY_PAID'].includes(demand.status) && (
                    <Button size="sm" asChild>
                      <Link href={`/applications/${shortfall.application.id}?tab=payments`}>
                        Pay
                        <ArrowRight />
                      </Link>
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Respond ───────────────────────────────────────────────────────── */}
      {applicantTurn && canRespond && (
        <Card>
          <CardHeader>
            <CardTitle>Your response</CardTitle>
            <CardDescription>
              {KIND_META[shortfall.kind]?.asks ?? 'Respond below.'}{' '}
              {shortfall.kind === 'DOCUMENT' &&
                'A document the department will verify should go on the Documents tab of the application; anything else can be attached here.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <Field label="Covering note" htmlFor="shortfall-response">
              <Textarea
                id="shortfall-response"
                rows={3}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                maxLength={4000}
                placeholder={
                  shortfall.itemCount
                    ? 'Optional — your item answers above are sent as the response if you leave this empty.'
                    : 'A certificate dated this month has been uploaded on the Documents tab.'
                }
              />
            </Field>

            <div className="space-y-2">
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadTo(file, null);
                }}
              />

              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'upload'}
                onClick={() => fileInput.current?.click()}
              >
                <FileUp />
                Attach a file
              </Button>

              {attachments.length > 0 && (
                <ul className="space-y-1">
                  {attachments.map((attachment) => (
                    <li
                      key={attachment.fileObjectId}
                      className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-small"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Paperclip className="size-3.5 shrink-0 text-text-muted" aria-hidden />
                        <span className="truncate">{attachment.name}</span>
                        <span className="shrink-0 text-caption text-text-muted">
                          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((a) => a.fileObjectId !== attachment.fileObjectId)
                          )
                        }
                        className="shrink-0 text-text-subtle hover:text-text"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button onClick={respond} loading={busy === 'respond'} variant="primary">
              <Send />
              Submit response
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Decide ────────────────────────────────────────────────────────── */}
      {officerTurn && canReview && (
        <Card>
          <CardHeader>
            <CardTitle>Your decision</CardTitle>
            <CardDescription>
              Accepting settles the shortfall
              {shortfall.mode === 'BLOCKING' ? ' and resumes the review' : ''}. Rejecting sends it
              back to the applicant for another cycle — both attempts stay on the record.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            {unpaid.length > 0 && (
              <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning-bg px-3 py-2 text-small text-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {unpaid.map((d) => d.demandNumber).join(', ')} {unpaid.length === 1 ? 'is' : 'are'}{' '}
                still unpaid. This shortfall cannot be accepted until the payment shows against the
                demand.
              </p>
            )}

            {rejectedCount > 0 && (
              <p className="flex items-start gap-2 rounded border border-border bg-surface-sunk px-3 py-2 text-small text-text-muted">
                <Ban className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                {rejectedCount} {rejectedCount === 1 ? 'item is' : 'items are'} marked for
                rejection. Rejecting the shortfall sends it back with those lines named.
              </p>
            )}

            <Field label="Remarks" htmlFor="review-remarks" required>
              <Textarea
                id="review-remarks"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={4000}
                placeholder="The certificate is current and matches the survey number. Accepted."
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                loading={busy === 'accept'}
                disabled={unpaid.length > 0}
                onClick={() => review(true)}
              >
                <CircleCheck />
                Accept
              </Button>
              <Button
                variant="destructive"
                loading={busy === 'reject'}
                onClick={() => review(false)}
              >
                <X />
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>
              Cycles
              {shortfall.resolutions.length > 0 && (
                <span className="ml-2 text-small font-normal text-text-muted">
                  {shortfall.resolutions.length}{' '}
                  {shortfall.resolutions.length === 1 ? 'response' : 'responses'} on record
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Every attempt, newest first. A rejected response is kept beside the one that replaced
              it — nothing here is ever overwritten.
            </CardDescription>
          </div>

          {canWithdraw && open && (
            <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>
              <Ban />
              Withdraw
            </Button>
          )}
        </CardHeader>

        <CardContent>
          <ShortfallCycles
            resolutions={shortfall.resolutions}
            emptyMessage={
              applicantTurn
                ? 'You have not responded yet.'
                : 'The applicant has not responded yet.'
            }
          />

          {shortfall.closedAt && (
            <p className="mt-3 border-t border-border pt-3 text-caption text-text-muted">
              Closed {new Date(shortfall.closedAt).toLocaleString()}
              {shortfall.closedByName ? ` by ${shortfall.closedByName}` : ''}
              {shortfall.closureRemarks ? ` — ${shortfall.closureRemarks}` : ''}
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title={`Withdraw ${shortfall.shortfallNumber}?`}
        description="Use this when the shortfall should not have been raised. It is not the same as settling it — the record will say it was withdrawn, and nothing will be treated as supplied."
        confirmLabel="Withdraw"
        destructive
        requireReason
        reasonLabel="Why is it being withdrawn?"
        onConfirm={withdraw}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-text">{value}</dd>
    </div>
  );
}
