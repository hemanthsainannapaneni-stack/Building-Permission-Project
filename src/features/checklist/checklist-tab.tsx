'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CircleCheck,
  ClipboardList,
  FileText,
  History,
  Info,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/common/empty-state';
import { toast } from '@/components/ui/toast';
import { stageLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import {
  CHECKLIST_STATUS,
  CHECKLIST_STATUS_LABEL,
  CHECKLIST_STATUS_TONE,
  RISK_TONE,
  allowedResponses,
  responseLabel,
  type ChecklistStatus,
} from '@/lib/checklist';
import { api, ApiCallError } from '@/features/applications/api';
import type {
  ChecklistItem,
  ChecklistPayload,
  DraftAnswer,
  DraftReview,
  SupportingDocument,
} from './types';

/**
 * THE 19-POINT APPLICATION CHECKLIST.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUESTIONS ON THIS SCREEN ARE PROVISIONAL DEMO WORDING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Not one of them is quoted from a BBAS manual, because the manuals supplied
 * for this project describe the checklist and name its subject areas without
 * reproducing its questions as text. The screen SAYS SO, on every question
 * that carries the flag and once at the top — a provisional sentence shown as
 * though it were statutory is the failure this banner exists to prevent, and a
 * warning that only lives in a code comment warns nobody.
 *
 * Every question is a row an administrator edits in Settings → Checklists.
 * When the official wording arrives it is typed in there and the flag cleared.
 * Nothing on this screen changes.
 *
 * ── What the screen is arranged around ───────────────────────────────────
 *
 * One question: WHAT IS STILL OUTSTANDING. So the counts come first as
 * numbers, not a bar; the questions group by the category their definition
 * gives them; and the applicant's answer and the desk's finding sit side by
 * side on the same row, because the case that matters is the one where they
 * DIFFER.
 *
 * ── The history is not a detail ──────────────────────────────────────────
 *
 * Under each question is every act on it, oldest first, with the officer and
 * the desk. A ZDD who verifies what the TPA marked a shortfall does not erase
 * the TPA — cannot erase them, there being no update path to that table — and
 * this is where anybody reading the file sees both.
 */
export function ChecklistTab({
  initial,
  applicationId,
}: {
  initial: ChecklistPayload;
  applicationId: string;
}) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [answers, setAnswers] = React.useState<Record<string, DraftAnswer>>({});
  const [reviews, setReviews] = React.useState<Record<string, DraftReview>>({});
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setData(initial);
    setAnswers({});
    setReviews({});
  }, [initial]);

  const { progress, items } = data;

  // Categories in the order the definitions give them, which is the order the
  // administrator set. Not alphabetical: question 1 belongs at the top.
  const categories = React.useMemo(() => {
    const groups: Array<{ name: string; items: ChecklistItem[] }> = [];
    for (const item of items) {
      const name = item.category || 'Other';
      const group = groups.find((g) => g.name === name);
      if (group) group.items.push(item);
      else groups.push({ name, items: [item] });
    }
    return groups;
  }, [items]);

  const provisionalCount = items.filter((i) => i.isProvisional).length;
  const pendingAnswers = Object.keys(answers).length;
  const pendingReviews = Object.keys(reviews).length;

  function draftAnswer(item: ChecklistItem, patch: Partial<DraftAnswer>) {
    setAnswers((prev) => ({
      ...prev,
      [item.id]: {
        response: prev[item.id]?.response ?? item.response,
        applicantRemarks: prev[item.id]?.applicantRemarks ?? item.applicantRemarks,
        ...patch,
      },
    }));
  }

  function draftReview(item: ChecklistItem, patch: Partial<DraftReview>) {
    setReviews((prev) => ({
      ...prev,
      [item.id]: {
        status: prev[item.id]?.status ?? item.status,
        reviewerResponse: prev[item.id]?.reviewerResponse ?? item.reviewerResponse,
        reviewerRemarks: prev[item.id]?.reviewerRemarks ?? item.reviewerRemarks,
        ...patch,
      },
    }));
  }

  async function saveAnswers() {
    const payload = Object.entries(answers).map(([itemId, draft]) => ({
      itemId,
      response: draft.response,
      applicantRemarks: draft.applicantRemarks,
      // Only sent when the picker was actually touched. `undefined` leaves the
      // existing reference alone; `null` is a deliberate clearing.
      ...(draft.documentId !== undefined ? { documentId: draft.documentId } : {}),
    }));
    if (!payload.length) return;

    setBusy(true);
    try {
      const next = await api.patch<ChecklistPayload>(
        `/api/applications/${applicationId}/checklist`,
        { answers: payload }
      );
      setData(next);
      setAnswers({});
      toast.success(payload.length === 1 ? 'Answer saved' : `${payload.length} answers saved`, {
        description: 'Your responses are on the file and visible to the department.',
      });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveReviews() {
    const payload = Object.entries(reviews).map(([itemId, draft]) => ({
      itemId,
      status: draft.status,
      reviewerResponse: draft.reviewerResponse,
      reviewerRemarks: draft.reviewerRemarks,
    }));
    if (!payload.length) return;

    // Caught here as well as on the server, because a round trip to be told
    // "say what is wrong" is a worse way to learn it than the field going red.
    const unexplained = payload.find(
      (p) =>
        (p.status === CHECKLIST_STATUS.SHORTFALL || p.status === CHECKLIST_STATUS.REJECTED) &&
        !p.reviewerRemarks.trim()
    );
    if (unexplained) {
      toast.error('Say what is wrong', {
        description: 'A shortfall or a rejection needs a remark the applicant can act on.',
      });
      return;
    }

    setBusy(true);
    try {
      const next = await api.post<ChecklistPayload>(
        `/api/applications/${applicationId}/checklist/review`,
        { items: payload }
      );
      setData(next);
      setReviews({});
      toast.success(
        payload.length === 1 ? 'Verification recorded' : `${payload.length} verifications recorded`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Progress ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="size-4 text-text-muted" aria-hidden />
                Application checklist
              </CardTitle>
              <CardDescription>
                The {progress.total}-point checklist this application is verified against.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wide text-text-muted">Risk</span>
              <Badge tone={RISK_TONE[data.derivedRisk]}>{data.derivedRisk}</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/*
            Counts, not a percentage. "14 verified, 3 pending, 2 shortfall" is
            something an officer can act on; "74%" is something they then have
            to go and decompose.
          */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Count label="Total" value={progress.total} tone="neutral" />
            <Count label="Verified" value={progress.verified} tone="success" />
            <Count label="Pending" value={progress.pending} tone="neutral" />
            <Count label="Shortfall" value={progress.shortfall} tone="warning" />
            <Count label="Not applicable" value={progress.na} tone="info" />
          </dl>

          {progress.rejected > 0 && (
            <p className="flex items-center gap-2 rounded border border-danger/25 bg-danger-bg px-3 py-2 text-small text-danger">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              {progress.rejected} question{progress.rejected === 1 ? ' has' : 's have'} been
              answered against this proposal.
            </p>
          )}

          {progress.complete && progress.rejected === 0 && (
            <p className="flex items-center gap-2 rounded border border-success/25 bg-success-bg px-3 py-2 text-small text-success">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              Every question has been disposed of. Nothing is outstanding on the checklist.
            </p>
          )}

          {/*
            The provisional-wording notice. It is not a footnote and it is not
            in a tooltip: somebody comparing this screen against the manual
            must be told, before they read a single question, that these
            sentences are this system's and not the manual's.
          */}
          {provisionalCount > 0 && (
            <div className="flex items-start gap-2 rounded border border-warning/25 bg-warning-bg px-3 py-2.5">
              <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="space-y-1 text-small text-warning">
                <p className="font-medium">
                  Provisional demo wording — {provisionalCount} of {progress.total} questions.
                </p>
                <p>
                  The BBAS manuals supplied for this project describe this checklist and name its
                  subject areas, but do not reproduce the questions as text. These sentences were
                  written from those subject areas and are <strong>not</strong> official BBAS
                  wording. An administrator replaces them in Settings → Checklists; no part of the
                  system depends on the sentence.
                </p>
              </div>
            </div>
          )}

          {data.respondBlockedReason && (
            <p className="text-small text-text-muted">{data.respondBlockedReason}</p>
          )}
          {data.reviewBlockedReason && (
            <p className="text-small text-text-muted">{data.reviewBlockedReason}</p>
          )}
        </CardContent>
      </Card>

      {/* ── The questions ─────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No checklist questions are active"
          description="An administrator activates them in Settings → Checklists."
        />
      ) : (
        categories.map((group) => (
          <Card key={group.name}>
            <CardHeader>
              <CardTitle>{group.name}</CardTitle>
              <CardDescription>
                {group.items.length} question{group.items.length === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {group.items.map((item) => (
                <Question
                  key={item.id}
                  item={item}
                  documents={data.documents}
                  canRespond={data.canRespond}
                  canReview={data.canReview}
                  answer={answers[item.id]}
                  review={reviews[item.id]}
                  onAnswer={(patch) => draftAnswer(item, patch)}
                  onReview={(patch) => draftReview(item, patch)}
                  expanded={expanded.has(item.id)}
                  onToggle={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                />
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {/* ── The save bar ──────────────────────────────────────────────── */}
      {(pendingAnswers > 0 || pendingReviews > 0) && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded border border-border-strong bg-surface px-4 py-3 shadow-md">
          <p className="text-small text-text-muted">
            {pendingAnswers > 0 &&
              `${pendingAnswers} answer${pendingAnswers === 1 ? '' : 's'} not yet saved`}
            {pendingAnswers > 0 && pendingReviews > 0 && ' · '}
            {pendingReviews > 0 &&
              `${pendingReviews} verification${pendingReviews === 1 ? '' : 's'} not yet recorded`}
          </p>
          <div className="flex gap-2">
            {pendingAnswers > 0 && (
              <Button variant="primary" onClick={saveAnswers} disabled={busy}>
                <Save className="size-4" aria-hidden />
                Save answers
              </Button>
            )}
            {pendingReviews > 0 && (
              <Button variant="primary" onClick={saveReviews} disabled={busy}>
                <CircleCheck className="size-4" aria-hidden />
                Record verification
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One question
// ═══════════════════════════════════════════════════════════════════════════

function Question({
  item,
  documents,
  canRespond,
  canReview,
  answer,
  review,
  onAnswer,
  onReview,
  expanded,
  onToggle,
}: {
  item: ChecklistItem;
  documents: SupportingDocument[];
  canRespond: boolean;
  canReview: boolean;
  answer: DraftAnswer | undefined;
  review: DraftReview | undefined;
  onAnswer: (patch: Partial<DraftAnswer>) => void;
  onReview: (patch: Partial<DraftReview>) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = (review?.status ?? item.status) as ChecklistStatus;
  const response = answer?.response ?? item.response;
  const choices = allowedResponses(item.responseType);
  const dirty = Boolean(answer || review);

  // `undefined` in the draft means the picker was never touched, which is not
  // the same as clearing it — so the fallback is the saved value, and only an
  // explicit null blanks it.
  const selectedDocument = answer?.documentId !== undefined ? answer.documentId : item.documentId;
  const citedDocument = documents.find((d) => d.id === selectedDocument) ?? null;

  return (
    <div className={cn('space-y-3 px-4 py-4', dirty && 'bg-primary/[0.03]')}>
      {/* ── The question ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface-sunk px-1.5 py-0.5 text-caption font-medium tabular-nums text-text-muted">
              {item.itemNumber}
            </span>
            {item.isMandatory && <Badge tone="outline">Mandatory</Badge>}
            {item.requiresDocument && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge tone="outline" className="gap-1">
                      <FileText className="size-3" aria-hidden />
                      Document
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  The answer is expected to be backed by an uploaded document.
                </TooltipContent>
              </Tooltip>
            )}
            {item.affectsRisk && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge tone="outline" className="gap-1">
                      <AlertTriangle className="size-3" aria-hidden />
                      Risk
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  This answer feeds the application&rsquo;s risk category.
                </TooltipContent>
              </Tooltip>
            )}
            {item.isProvisional && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge tone="warning">Provisional wording</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {item.source ||
                    'Demo wording, not official BBAS text. Editable in Settings → Checklists.'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <p className="text-small text-text">{item.question}</p>
          {item.helpText && <p className="text-caption text-text-muted">{item.helpText}</p>}
        </div>

        <Badge tone={CHECKLIST_STATUS_TONE[status]} className="shrink-0">
          {CHECKLIST_STATUS_LABEL[status]}
        </Badge>
      </div>

      {/* ── The applicant's answer ───────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded border border-border bg-surface-sunk/40 p-3">
          <p className="text-caption uppercase tracking-wide text-text-muted">
            Applicant&rsquo;s response
          </p>

          {canRespond ? (
            <>
              {choices.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {choices.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      size="sm"
                      variant={response === choice ? 'primary' : 'secondary'}
                      onClick={() => onAnswer({ response: response === choice ? '' : choice })}
                    >
                      {responseLabel(choice)}
                    </Button>
                  ))}
                </div>
              ) : (
                <Input
                  value={response}
                  inputMode={
                    item.responseType === 'NUMBER' || item.responseType === 'MEASUREMENT'
                      ? 'decimal'
                      : 'text'
                  }
                  placeholder={
                    item.responseType === 'MEASUREMENT'
                      ? 'The measurement, in the unit the question names'
                      : item.responseType === 'NUMBER'
                        ? 'A number'
                        : 'Your answer'
                  }
                  onChange={(e) => onAnswer({ response: e.target.value })}
                />
              )}

              <Textarea
                rows={2}
                value={answer?.applicantRemarks ?? item.applicantRemarks}
                placeholder="Remarks (optional)"
                onChange={(e) => onAnswer({ applicantRemarks: e.target.value })}
              />

              {/*
                The supporting document, on the questions that call for one.
                The list is the documents ACTUALLY UPLOADED on this file — a
                requirement nobody has met yet is not a document, and citing
                one would let an answer point at something that does not
                exist. When nothing has been uploaded the picker says so and
                names where to go, rather than presenting an empty box.
              */}
              {item.requiresDocument &&
                (documents.length ? (
                  <select
                    aria-label={`Supporting document for question ${item.itemNumber}`}
                    className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    value={selectedDocument ?? ''}
                    onChange={(e) => onAnswer({ documentId: e.target.value || null })}
                  >
                    <option value="">No document cited</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-caption text-text-subtle">
                    Nothing has been uploaded yet. Add it on the Documents tab and it can be cited
                    here.
                  </p>
                ))}
            </>
          ) : (
            <>
              <p className="text-small text-text">
                {response ? (
                  responseLabel(response)
                ) : (
                  <span className="italic text-text-subtle">Not answered</span>
                )}
              </p>
              {item.applicantRemarks && (
                <p className="text-caption text-text-muted">{item.applicantRemarks}</p>
              )}
              {citedDocument && (
                <p className="flex items-center gap-1.5 text-caption text-text-muted">
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                  {citedDocument.name}
                </p>
              )}
            </>
          )}

          {item.respondedByName && (
            <p className="text-caption text-text-subtle">
              {item.respondedByName}
              {item.respondedAt ? ` · ${formatWhen(item.respondedAt)}` : ''}
            </p>
          )}
        </div>

        {/* ── The desk's finding ─────────────────────────────────────── */}
        <div className="space-y-2 rounded border border-border bg-surface-sunk/40 p-3">
          <p className="text-caption uppercase tracking-wide text-text-muted">
            Reviewer&rsquo;s verification
          </p>

          {canReview ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    CHECKLIST_STATUS.VERIFIED,
                    CHECKLIST_STATUS.SHORTFALL,
                    CHECKLIST_STATUS.REJECTED,
                    CHECKLIST_STATUS.NA,
                  ] as ChecklistStatus[]
                ).map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    size="sm"
                    variant={status === choice ? 'primary' : 'secondary'}
                    onClick={() =>
                      onReview({ status: status === choice ? CHECKLIST_STATUS.PENDING : choice })
                    }
                  >
                    {CHECKLIST_STATUS_LABEL[choice]}
                  </Button>
                ))}
              </div>

              <Textarea
                rows={2}
                value={review?.reviewerRemarks ?? item.reviewerRemarks}
                placeholder={
                  status === CHECKLIST_STATUS.SHORTFALL || status === CHECKLIST_STATUS.REJECTED
                    ? 'Say what is wrong — the applicant acts on this'
                    : 'Remarks (optional)'
                }
                invalid={
                  (status === CHECKLIST_STATUS.SHORTFALL || status === CHECKLIST_STATUS.REJECTED) &&
                  !(review?.reviewerRemarks ?? item.reviewerRemarks).trim()
                }
                onChange={(e) => onReview({ reviewerRemarks: e.target.value })}
              />
            </>
          ) : (
            <>
              <p className="text-small text-text">
                {item.reviewerResponse || CHECKLIST_STATUS_LABEL[status]}
              </p>
              {item.reviewerRemarks && (
                <p className="text-caption text-text-muted">{item.reviewerRemarks}</p>
              )}
            </>
          )}

          {item.reviewedByName && (
            <p className="text-caption text-text-subtle">
              {item.reviewedByName}
              {item.reviewedRoleKey ? ` · ${item.reviewedRoleKey}` : ''}
              {item.reviewedStageCode ? ` · ${stageLabel(item.reviewedStageCode)}` : ''}
              {item.reviewedAt ? ` · ${formatWhen(item.reviewedAt)}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* ── The history ──────────────────────────────────────────────── */}
      {item.history.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 text-caption text-text-muted hover:text-text"
          >
            <History className="size-3.5" aria-hidden />
            {expanded ? 'Hide' : 'Show'} the {item.history.length} entr
            {item.history.length === 1 ? 'y' : 'ies'} on this question
          </button>

          {expanded && (
            <ol className="mt-2 space-y-2 border-l-2 border-border pl-3">
              {item.history.map((entry) => (
                <li key={entry.id} className="text-caption">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-text">{entry.actorName || 'Unknown'}</span>
                    {entry.actorRoleKey && (
                      <span className="text-text-muted">· {entry.actorRoleKey}</span>
                    )}
                    {entry.stageCode && (
                      <span className="text-text-muted">· {stageLabel(entry.stageCode)}</span>
                    )}
                    <span className="text-text-subtle">· {formatWhen(entry.recordedAt)}</span>
                  </div>
                  <p className="text-text-muted">
                    {entry.entryType === 'APPLICANT_RESPONSE'
                      ? `Answered ${entry.response ? responseLabel(entry.response) : 'nothing'}`
                      : `Marked ${CHECKLIST_STATUS_LABEL[entry.status as ChecklistStatus] ?? entry.status}`}
                    {entry.remarks ? ` — ${entry.remarks}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'warning' | 'info';
}) {
  const colour = {
    neutral: 'text-text',
    success: 'text-success',
    warning: 'text-warning',
    info: 'text-info',
  }[tone];

  return (
    <div className="rounded border border-border bg-surface-sunk/40 px-3 py-2">
      <dt className="text-caption uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={cn('text-h3 mt-0.5 font-semibold tabular-nums', colour)}>{value}</dd>
    </div>
  );
}

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
