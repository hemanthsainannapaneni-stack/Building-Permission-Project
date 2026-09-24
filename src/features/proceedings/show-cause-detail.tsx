'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gavel, Info, MessageSquareReply, SearchCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/features/applications/api';
import {
  SHOW_CAUSE_DECISIONS,
  SHOW_CAUSE_DECISION_LABEL,
  SHOW_CAUSE_DECISION_MEANING,
  SHOW_CAUSE_STATUS_LABEL,
  responseDueLabel,
  type ShowCauseDecision,
  type ShowCauseStatus,
} from '@/lib/show-cause';
import { OUTWARD_MODE_LABEL, OUTWARD_STATUS_LABEL, type OutwardMode, type OutwardStatus } from '@/lib/outward';
import { AttachmentList, DocLink, HistoryCard, Item, Prose, fmtDate, postForm, reportError } from './shared';
import type { ShowCauseDetail } from './types';

const EVENT_LABEL: Record<string, string> = {
  ISSUED: 'Notice issued',
  DISPATCHED: 'Dispatched from Outward',
  RESPONDED: 'Applicant responded',
  TAKEN_UP: 'Taken up for review',
  DECIDED: 'Decided',
};
const statusLabel = (s: string) => SHOW_CAUSE_STATUS_LABEL[s as ShowCauseStatus] ?? s;

/** One show cause notice: the notice, its dispatch, the answer, the review and the decision. */
export function ShowCauseDetailView({ initial }: { initial: ShowCauseDetail }) {
  const router = useRouter();
  const [sc, setSc] = React.useState(initial);
  const [open, setOpen] = React.useState<'respond' | 'takeUp' | 'decide' | null>(null);
  const reload = async () => {
    setOpen(null);
    setSc(await api.get<ShowCauseDetail>(`/api/show-causes/${sc.id}`));
    router.refresh();
  };
  const p = sc.permissions;
  const due = responseDueLabel(sc.status, sc.responseDueDate);
  const file = (kind: 'supporting' | 'response') => (i: number) => `/api/show-causes/${sc.id}/attachment?kind=${kind}&index=${i}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Show cause notice <StatusBadge kind="showCause" status={sc.status} />
            </CardTitle>
            <CardDescription>
              <Link href={`/applications/${sc.application.id}?tab=proceedings`} className="text-primary hover:underline">
                {sc.application.applicationNumber}
              </Link>{' '}
              · {sc.application.owner || 'Owner not recorded'} · Current desk: {sc.currentDesk}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.respond && (
              <Button variant="primary" onClick={() => setOpen('respond')}>
                <MessageSquareReply className="size-4" /> Respond
              </Button>
            )}
            {p.takeUp && (
              <Button variant="secondary" onClick={() => setOpen('takeUp')}>
                <SearchCheck className="size-4" /> Review show cause submission
              </Button>
            )}
            {p.decide && (
              <Button variant="primary" onClick={() => setOpen('decide')}>
                <Gavel className="size-4" /> Decide
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 rounded border border-info/30 bg-info-bg px-3 py-2 text-small">
            <Info className="mt-0.5 size-4 shrink-0 text-info" />
            A show cause notice is not a shortfall. It asks for an explanation and records the department’s decision on it;
            it never parks the file and never counts against approval as a shortfall does.
          </p>
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Notice number">{sc.noticeNumber}</Item>
            <Item label="Issued by">
              {sc.issuedByName} ({sc.issuedByRoleKey})
            </Item>
            <Item label="Issue date">{fmtDate(sc.issuedAt)}</Item>
            <Item label="Response due">
              {fmtDate(sc.responseDueDate)}
              {due && <span className="ml-1 text-caption text-text-muted">· {due}</span>}
            </Item>
            <Item label="Permission (BPO)">{sc.application.orderNumber || 'Not yet approved'}</Item>
            <Item label="Notice">
              <DocLink href={`/api/show-causes/${sc.id}/notice`}>Preview notice (demo)</DocLink>
            </Item>
            <Item label="Supporting documents">
              <AttachmentList items={sc.supportingDocuments} hrefFor={file('supporting')} />
            </Item>
            <Item label="Outward">
              {sc.outward ? (
                <span>
                  {sc.outward.outwardNumber} · {OUTWARD_STATUS_LABEL[sc.outward.status as OutwardStatus] ?? sc.outward.status}
                  {sc.outward.dispatchDate && (
                    <span className="block text-caption text-text-muted">
                      Dispatched {fmtDate(sc.outward.dispatchDate)}
                      {sc.outward.mode ? ` by ${OUTWARD_MODE_LABEL[sc.outward.mode as OutwardMode] ?? sc.outward.mode}` : ''}
                      {sc.outward.trackingNumber ? ` · ${sc.outward.trackingNumber}` : ''}
                    </span>
                  )}
                  {sc.outward.acknowledgementDate && (
                    <span className="block text-caption text-text-muted">
                      Acknowledged {fmtDate(sc.outward.acknowledgementDate)} — {sc.outward.acknowledgement}
                    </span>
                  )}
                </span>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Site">{sc.application.site || '—'}</Item>
          </dl>
          <Prose label="Violation">{sc.violation}</Prose>
          <Prose label="Reason">{sc.reason}</Prose>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applicant response</CardTitle>
          <CardDescription>
            {sc.respondedAt
              ? `Received ${fmtDate(sc.respondedAt)} from ${sc.respondedByName}.`
              : sc.status === 'ISSUED'
                ? 'The notice has not been dispatched yet. The applicant can answer once it has been sent.'
                : 'Not yet received.'}
          </CardDescription>
        </CardHeader>
        {sc.respondedAt && (
          <CardContent className="space-y-3">
            <Prose label="Response">{sc.responseText}</Prose>
            <dl className="text-small">
              <Item label="Response documents">
                <AttachmentList items={sc.responseDocuments} hrefFor={file('response')} />
              </Item>
            </dl>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review and decision</CardTitle>
          {!p.decide && !p.takeUp && p.decideReason && <CardDescription>{p.decideReason}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Reviewer">{sc.reviewerName ? `${sc.reviewerName} (${sc.reviewerRoleKey})` : '—'}</Item>
            <Item label="Review started">{fmtDate(sc.reviewStartedAt)}</Item>
            <Item label="Decision">{sc.decision ? SHOW_CAUSE_DECISION_LABEL[sc.decision as ShowCauseDecision] : '—'}</Item>
            <Item label="Decided by">{sc.decidedByName ? `${sc.decidedByName} (${sc.decidedByRoleKey})` : '—'}</Item>
            <Item label="Decision date">{fmtDate(sc.decidedAt)}</Item>
            <Item label="Revocation proceeding">
              {sc.revocation ? (
                <Link href={`/revocations/${sc.revocation.id}`} className="text-primary hover:underline">
                  {sc.revocation.revocationNumber} · {sc.revocation.statusLabel}
                </Link>
              ) : (
                '—'
              )}
            </Item>
          </dl>
          {sc.decisionRemarks && <Prose label="Remarks">{sc.decisionRemarks}</Prose>}
        </CardContent>
      </Card>

      <HistoryCard events={sc.events} label={EVENT_LABEL} statusLabel={statusLabel} />

      {open === 'respond' && <RespondDialog sc={sc} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'takeUp' && <TakeUpDialog sc={sc} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'decide' && <DecideDialog sc={sc} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function RespondDialog({ sc, onClose, onDone }: { sc: ShowCauseDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [response, setResponse] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [demo, setDemo] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('response', response);
      form.set('expectedStatus', sc.status);
      files.forEach((f) => form.append('files', f));
      if (!files.length && demo) form.set('demoDocument', 'true');
      await postForm(`/api/show-causes/${sc.id}/respond`, form);
      toast.success(`Response to ${sc.noticeNumber} submitted`);
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The response could not be submitted.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Respond to {sc.noticeNumber}</DialogTitle>
          <DialogDescription>Your written explanation, with any documents that support it. Due {fmtDate(sc.responseDueDate)}.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Response" htmlFor="sc-response" required error={errors.response}>
            <Textarea id="sc-response" rows={6} maxLength={8000} value={response} onChange={(e) => setResponse(e.target.value)} />
          </Field>
          <Field label="Response documents" htmlFor="sc-files" hint="Up to five PDF or image files, 10 MB each." error={errors.file}>
            <input
              id="sc-files"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              className="block text-small"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
            />
          </Field>
          {sc.permissions.demoDocumentAllowed && !files.length && (
            <label className="flex items-center gap-2 text-small">
              <Checkbox checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Attach a labelled demo placeholder instead
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || response.trim().length < 10}>
            Submit response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TakeUpDialog({ sc, onClose, onDone }: { sc: ShowCauseDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/show-causes/${sc.id}/take-up`, { remarks, expectedStatus: sc.status });
      toast.success(`${sc.noticeNumber} is under your review`);
      await onDone();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review show cause submission — {sc.noticeNumber}</DialogTitle>
          <DialogDescription>Records you as the reviewer of the applicant’s response, on the file’s workflow history. The decision follows.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Remarks" htmlFor="sc-takeup" hint="Optional.">
            <Textarea id="sc-takeup" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Take up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ sc, onClose, onDone }: { sc: ShowCauseDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const choices = SHOW_CAUSE_DECISIONS.filter((d) => d !== 'REVOKE_PROCEEDING' || sc.permissions.canReferForRevocation);
  const [decision, setDecision] = React.useState<ShowCauseDecision>('CLOSED_SATISFACTORY');
  const [remarks, setRemarks] = React.useState('');
  const [grounds, setGrounds] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/api/show-causes/${sc.id}/decide`, {
        decision,
        remarks,
        grounds: grounds.split('\n').map((g) => g.trim()).filter(Boolean),
        expectedStatus: sc.status,
      });
      toast.success(`${sc.noticeNumber}: ${SHOW_CAUSE_DECISION_LABEL[decision]}`);
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The decision could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Decide {sc.noticeNumber}</DialogTitle>
          <DialogDescription>Recorded on the file’s workflow history as the Decide show cause action.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-small font-medium">Decision</legend>
            {choices.map((d) => (
              <label key={d} className="flex cursor-pointer items-start gap-2 rounded border border-border px-3 py-2 text-small has-[:checked]:border-primary">
                <input type="radio" name="decision" className="mt-1" checked={decision === d} onChange={() => setDecision(d)} />
                <span>
                  <span className="font-medium">{SHOW_CAUSE_DECISION_LABEL[d]}</span>
                  <span className="block text-caption text-text-muted">{SHOW_CAUSE_DECISION_MEANING[d]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Remarks" htmlFor="sc-remarks" required error={errors.remarks} hint="The reasons for the decision.">
            <Textarea id="sc-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          {decision === 'REVOKE_PROCEEDING' && (
            <Field label="Grounds for revocation" htmlFor="sc-grounds" required error={errors.grounds} hint="One per line. Stated on the revocation proposal.">
              <Textarea id="sc-grounds" rows={3} value={grounds} onChange={(e) => setGrounds(e.target.value)} />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={decision === 'REVOKE_PROCEEDING' ? 'destructive' : 'primary'}
            onClick={submit}
            loading={busy}
            disabled={busy || remarks.trim().length < 5 || (decision === 'REVOKE_PROCEEDING' && !grounds.trim())}
          >
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
