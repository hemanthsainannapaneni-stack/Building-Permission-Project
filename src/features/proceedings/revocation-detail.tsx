'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gavel, SearchCheck, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
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
import { REVOCATION_DECISION_LABEL, REVOCATION_STATUS_LABEL, type RevocationDecision, type RevocationStatus } from '@/lib/revocation';
import { SHOW_CAUSE_DECISION_LABEL, type ShowCauseDecision } from '@/lib/show-cause';
import { OUTWARD_STATUS_LABEL, type OutwardStatus } from '@/lib/outward';
import { DocLink, HistoryCard, Item, Prose, fmtDate, fmtDateTime, reportError } from './shared';
import type { RevocationDetail } from './types';

const EVENT_LABEL: Record<string, string> = {
  INITIATED: 'Initiated',
  TAKEN_UP: 'Taken up for review',
  REVOKED: 'Permission revoked',
  REJECTED: 'Proposal rejected',
};
const statusLabel = (s: string) => REVOCATION_STATUS_LABEL[s as RevocationStatus] ?? s;

/** One revocation proceeding, with the approval it proceeds against shown intact. */
export function RevocationDetailView({ initial }: { initial: RevocationDetail }) {
  const router = useRouter();
  const [rev, setRev] = React.useState(initial);
  const [open, setOpen] = React.useState<'takeUp' | 'decide' | null>(null);
  const reload = async () => {
    setOpen(null);
    setRev(await api.get<RevocationDetail>(`/api/revocations/${rev.id}`));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Revocation proceeding <StatusBadge kind="revocation" status={rev.status} />
            </CardTitle>
            <CardDescription>
              <Link href={`/applications/${rev.application.id}?tab=proceedings`} className="text-primary hover:underline">
                {rev.application.applicationNumber}
              </Link>{' '}
              · {rev.application.owner || 'Owner not recorded'} · Application status:{' '}
              <StatusBadge status={rev.application.status} />
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {rev.permissions.takeUp && (
              <Button variant="secondary" onClick={() => setOpen('takeUp')}>
                <SearchCheck className="size-4" /> Take up for review
              </Button>
            )}
            {rev.permissions.decide && (
              <Button variant="primary" onClick={() => setOpen('decide')}>
                <Gavel className="size-4" /> Decide
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Revocation number">{rev.revocationNumber}</Item>
            <Item label="BPO / Proceeding">{rev.orderNumber || '—'}</Item>
            <Item label="Show cause">
              {rev.showCause ? (
                <Link href={`/show-cause/${rev.showCause.id}`} className="text-primary hover:underline">
                  {rev.showCause.noticeNumber}
                  {rev.showCause.decision ? ` · ${SHOW_CAUSE_DECISION_LABEL[rev.showCause.decision as ShowCauseDecision]}` : ''}
                </Link>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Initiated by">
              {rev.initiatedByName} ({rev.initiatedByRoleKey})
            </Item>
            <Item label="Date">{fmtDate(rev.initiatedAt)}</Item>
            <Item label="Reviewer">{rev.reviewerName ? `${rev.reviewerName} (${rev.reviewerRoleKey})` : '—'}</Item>
            <Item label="Decision">{rev.decision ? statusLabel(rev.decision) : '—'}</Item>
            <Item label="Decided by">{rev.decidedByName ? `${rev.decidedByName} (${rev.decidedByRoleKey})` : '—'}</Item>
            <Item label="Decision date">{fmtDate(rev.decidedAt)}</Item>
            <Item label="Revocation order">
              {rev.revocationOrderNumber ? (
                <DocLink href={`/api/revocations/${rev.id}/order`}>{rev.revocationOrderNumber} (demo)</DocLink>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Outward">
              {rev.outward ? (
                <Link href={`/outward/${rev.outward.id}`} className="text-primary hover:underline">
                  {rev.outward.outwardNumber} · {OUTWARD_STATUS_LABEL[rev.outward.status as OutwardStatus] ?? rev.outward.status}
                </Link>
              ) : (
                '—'
              )}
            </Item>
          </dl>
          <Prose label="Reason">{rev.reason}</Prose>
          <Prose label="Grounds">
            <ol className="list-decimal space-y-0.5 pl-5">
              {rev.grounds.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ol>
          </Prose>
          {rev.decisionRemarks && <Prose label="Decision remarks">{rev.decisionRemarks}</Prose>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> The approval, as recorded
          </CardTitle>
          <CardDescription>
            Revocation does not remove the approval. The approving workflow step, the approval date and the order stay on the record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rev.approval ? (
            <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Approved by">
                {rev.approval.actorName} ({rev.approval.actorRoleKey})
              </Item>
              <Item label="Approved on">{fmtDateTime(rev.approval.occurredAt)}</Item>
              <Item label="Workflow step">#{rev.approval.sequence}</Item>
              <Item label="Order">
                {rev.application.orderNumber || '—'}
                {rev.application.orderRevoked && <span className="ml-1 text-caption text-danger">· marked revoked</span>}
              </Item>
              {rev.approval.remarks && (
                <Item label="Approval remarks" wide>
                  {rev.approval.remarks}
                </Item>
              )}
            </dl>
          ) : (
            <p className="text-small text-text-muted">No approval step is recorded on this file.</p>
          )}
        </CardContent>
      </Card>

      <HistoryCard events={rev.events} label={EVENT_LABEL} statusLabel={statusLabel} />

      {open === 'takeUp' && <TakeUpDialog rev={rev} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'decide' && <DecideDialog rev={rev} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function TakeUpDialog({ rev, onClose, onDone }: { rev: RevocationDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/revocations/${rev.id}/take-up`, { remarks, expectedStatus: rev.status });
      toast.success(`${rev.revocationNumber} is under your review`);
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
          <DialogTitle>Take up {rev.revocationNumber}</DialogTitle>
          <DialogDescription>Recorded on the file’s workflow history. The permission stands until you decide.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Remarks" htmlFor="rev-takeup" hint="Optional.">
            <Textarea id="rev-takeup" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
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

function DecideDialog({ rev, onClose, onDone }: { rev: RevocationDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [decision, setDecision] = React.useState<RevocationDecision>('REJECTED');
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/revocations/${rev.id}/decide`, { decision, remarks, expectedStatus: rev.status });
      toast.success(decision === 'REVOKED' ? 'Permission revoked. The order is in Outward.' : 'Proposal rejected. The permission stands.');
      await onDone();
    } catch (error) {
      reportError(error, 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Decide {rev.revocationNumber}</DialogTitle>
          <DialogDescription>
            Revoking moves the application to Proceeding revoked, marks the order revoked and sends a revocation order to Outward. The approval
            history is kept.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <fieldset className="space-y-2">
            {(['REJECTED', 'REVOKED'] as const).map((d) => (
              <label key={d} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-small has-[:checked]:border-primary">
                <input type="radio" name="rev-decision" checked={decision === d} onChange={() => setDecision(d)} />
                {REVOCATION_DECISION_LABEL[d]}
              </label>
            ))}
          </fieldset>
          <Field label="Remarks" htmlFor="rev-remarks" required hint="The reasons for the decision. Printed on the order when revoked.">
            <Textarea id="rev-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={decision === 'REVOKED' ? 'destructive' : 'primary'} onClick={submit} loading={busy} disabled={busy || remarks.trim().length < 5}>
            {decision === 'REVOKED' ? 'Revoke permission' : 'Reject proposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
