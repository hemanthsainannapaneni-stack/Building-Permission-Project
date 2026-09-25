'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus2, Gavel, SearchCheck, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  PROFESSIONAL_CHANGE_DECISION_LABEL,
  PROFESSIONAL_CHANGE_DOCUMENTS,
  PROFESSIONAL_CHANGE_DOCUMENT_LABEL,
  PROFESSIONAL_CHANGE_STATUS_LABEL,
  RELEASE_DOCUMENTS,
  REQUIRED_AT_REQUEST,
  type ProfessionalChangeDecision,
  type ProfessionalChangeDocumentKind,
  type ProfessionalChangeStatus,
} from '@/lib/professional-change';
import { DocLink, HistoryCard, Item, Prose, fmtDate, postForm, reportError } from '@/features/proceedings/shared';
import type { Offer } from '@/features/proceedings/types';
import { EngagementHistory, ProfessionalComparison } from './parts';
import type { ProfessionalChangeDetail } from './types';

const EVENT_LABEL: Record<string, string> = {
  REQUESTED: 'Request created',
  DOCUMENTS_ADDED: 'Documents added',
  VERIFIED: 'Verified',
  REVIEWED: 'Reviewed',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PROFESSIONAL_CHANGED: 'LTP changed · drawing rights transferred',
};
const statusLabel = (s: string) => PROFESSIONAL_CHANGE_STATUS_LABEL[s as ProfessionalChangeStatus] ?? s;

type Step = 'verify' | 'review' | 'decide';

/** One change of technical professional request. */
export function ProfessionalChangeDetailView({ initial }: { initial: ProfessionalChangeDetail }) {
  const router = useRouter();
  const [req, setReq] = React.useState(initial);
  const [open, setOpen] = React.useState<Step | 'documents' | null>(null);
  const reload = async () => {
    setOpen(null);
    setReq(await api.get<ProfessionalChangeDetail>(`/api/professional-changes/${req.id}`));
    router.refresh();
  };

  const byKind = new Map<string, number[]>();
  req.documents.forEach((d, i) => byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), i]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Change of LTP <StatusBadge kind="professionalChange" status={req.status} />
            </CardTitle>
            <CardDescription>
              <Link href={`/applications/${req.application.id}?tab=ltp`} className="text-primary hover:underline">
                {req.application.applicationNumber}
              </Link>{' '}
              · File at {req.application.fileDesk} · <StatusBadge status={req.application.status} />
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {req.permissions.addDocuments && (
              <Button variant="ghost" onClick={() => setOpen('documents')}>
                <FilePlus2 className="size-4" /> Add documents
              </Button>
            )}
            <StepButton offer={req.permissions.verify} icon={<ShieldCheck className="size-4" />} label="Verify" onClick={() => setOpen('verify')} />
            <StepButton offer={req.permissions.review} icon={<SearchCheck className="size-4" />} label="Review" onClick={() => setOpen('review')} />
            <StepButton offer={req.permissions.decide} icon={<Gavel className="size-4" />} label="Decide" primary onClick={() => setOpen('decide')} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Request number">{req.requestNumber}</Item>
            <Item label="Owner">{req.ownerName || '—'}</Item>
            <Item label="Request date">{fmtDate(req.requestDate)}</Item>
            <Item label="Current desk">{req.currentDesk}</Item>
            <Item label="Registered by">
              {req.requestedByName} ({req.requestedByRoleKey}) · file at {req.requestedStageName}
            </Item>
            <Item label="Registered on">{fmtDate(req.requestedAt)}</Item>
            <Item label="Verified by">{req.verifiedByName ? `${req.verifiedByName} (${req.verifiedByRoleKey}) · ${fmtDate(req.verifiedAt)}` : '—'}</Item>
            <Item label="Reviewed by">{req.reviewedByName ? `${req.reviewedByName} (${req.reviewedByRoleKey}) · ${fmtDate(req.reviewedAt)}` : '—'}</Item>
            <Item label="Decided by">{req.decidedByName ? `${req.decidedByName} (${req.decidedByRoleKey}) · ${fmtDate(req.decidedAt)}` : '—'}</Item>
          </dl>
          <Prose label="Reason">{req.reason}</Prose>
          {req.verificationRemarks && <Prose label="Verification remarks">{req.verificationRemarks}</Prose>}
          {req.reviewRemarks && <Prose label="Review remarks">{req.reviewRemarks}</Prose>}
          {req.decisionRemarks && <Prose label={`Decision — ${statusLabel(req.decision)}`}>{req.decisionRemarks}</Prose>}
        </CardContent>
      </Card>

      <ProfessionalComparison
        current={req.currentSnapshot}
        proposed={req.proposedSnapshot}
        on={req.requestDate}
        approved={req.status === 'APPROVED'}
      />

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Required to register: {REQUIRED_AT_REQUEST.map((k) => PROFESSIONAL_CHANGE_DOCUMENT_LABEL[k]).join(', ')}. Required to verify: one of{' '}
            {RELEASE_DOCUMENTS.map((k) => PROFESSIONAL_CHANGE_DOCUMENT_LABEL[k]).join(' or ')}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2">
            {PROFESSIONAL_CHANGE_DOCUMENTS.map((kind) => {
              const indexes = byKind.get(kind) ?? [];
              return (
                <div key={kind} className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-0">
                  <dt className="text-text-muted">{PROFESSIONAL_CHANGE_DOCUMENT_LABEL[kind]}</dt>
                  <dd className="text-right">
                    {indexes.length ? (
                      indexes.map((i) => (
                        <div key={i}>
                          <DocLink href={`/api/professional-changes/${req.id}/document?index=${i}`}>
                            {req.documents[i]!.isDemo ? 'Demo placeholder' : req.documents[i]!.fileName}
                          </DocLink>
                        </div>
                      ))
                    ) : (
                      <span className="text-text-muted">Not provided</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardContent>
      </Card>

      <EngagementHistory engagements={req.engagements} />

      <HistoryCard events={req.events} label={EVENT_LABEL} statusLabel={statusLabel} />

      {(open === 'verify' || open === 'review') && <StepDialog req={req} step={open} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'decide' && <DecideDialog req={req} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'documents' && <AddDocumentsDialog req={req} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function StepButton({ offer, icon, label, primary, onClick }: { offer: Offer; icon: React.ReactNode; label: string; primary?: boolean; onClick: () => void }) {
  if (!offer.offered) return null;
  if (offer.available) {
    return (
      <Button variant={primary ? 'primary' : 'secondary'} onClick={onClick}>
        {icon} {label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="secondary" disabled>
            {icon} {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{offer.reason}</TooltipContent>
    </Tooltip>
  );
}

const STEP_COPY: Record<'verify' | 'review', { title: string; description: string; done: string; hint: string }> = {
  verify: {
    title: 'Verify',
    description: 'Confirms the documents are in order. The request goes to the reviewing desk. Recorded on the file’s workflow history.',
    done: 'Verified — sent for review',
    hint: 'What you checked, and anything the reviewer should know.',
  },
  review: {
    title: 'Review',
    description: 'Records your review and sends the request to the deciding desk. Recorded on the file’s workflow history.',
    done: 'Reviewed — sent for decision',
    hint: 'Your recommendation, and why.',
  },
};

function StepDialog({ req, step, onClose, onDone }: { req: ProfessionalChangeDetail; step: 'verify' | 'review'; onClose: () => void; onDone: () => Promise<void> }) {
  const copy = STEP_COPY[step];
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/professional-changes/${req.id}/${step}`, { remarks, expectedStatus: req.status });
      toast.success(copy.done);
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
          <DialogTitle>
            {copy.title} {req.requestNumber}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Remarks" htmlFor="pc-step" required hint={copy.hint}>
            <Textarea id="pc-step" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || remarks.trim().length < 5}>
            {copy.title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ req, onClose, onDone }: { req: ProfessionalChangeDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [decision, setDecision] = React.useState<ProfessionalChangeDecision>('APPROVED');
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/professional-changes/${req.id}/decide`, { decision, remarks, expectedStatus: req.status });
      toast.success(
        decision === 'APPROVED'
          ? `${req.proposedSnapshot.name} now holds the file and its drawing rights.`
          : 'Request rejected. The current LTP continues.'
      );
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
          <DialogTitle>Decide {req.requestNumber}</DialogTitle>
          <DialogDescription>
            Approving makes {req.proposedSnapshot.name} the file’s LTP and moves drawing submission rights to them.{' '}
            {req.currentSnapshot.name} stays in the file’s LTP history.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <fieldset className="space-y-2">
            {(['APPROVED', 'REJECTED'] as const).map((d) => (
              <label key={d} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-small has-[:checked]:border-primary">
                <input type="radio" name="pc-decision" checked={decision === d} onChange={() => setDecision(d)} />
                {PROFESSIONAL_CHANGE_DECISION_LABEL[d]}
              </label>
            ))}
          </fieldset>
          <Field label="Remarks" htmlFor="pc-decide" required hint="The reasons for the decision.">
            <Textarea id="pc-decide" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={decision === 'REJECTED' ? 'destructive' : 'primary'} onClick={submit} loading={busy} disabled={busy || remarks.trim().length < 5}>
            {decision === 'APPROVED' ? 'Approve change' : 'Reject request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-kind file inputs, or demo placeholders. Shared with the request dialog. */
export function DocumentInputs({
  files,
  setFiles,
  demoAllowed,
  demo,
  setDemo,
  demoLabel,
}: {
  files: Partial<Record<ProfessionalChangeDocumentKind, File>>;
  setFiles: (next: Partial<Record<ProfessionalChangeDocumentKind, File>>) => void;
  demoAllowed: boolean;
  demo: ProfessionalChangeDocumentKind[];
  setDemo: (next: ProfessionalChangeDocumentKind[]) => void;
  demoLabel: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-caption text-text-muted">PDF or image, 10 MB each.</p>
      {PROFESSIONAL_CHANGE_DOCUMENTS.map((kind) => (
        <div key={kind} className="grid items-center gap-1 sm:grid-cols-[13rem_1fr]">
          <label htmlFor={`pc-doc-${kind}`} className="text-small text-text">
            {PROFESSIONAL_CHANGE_DOCUMENT_LABEL[kind]}
            {REQUIRED_AT_REQUEST.includes(kind) && <span className="text-danger"> *</span>}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`pc-doc-${kind}`}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="block max-w-[14rem] text-small"
              onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })}
            />
            {demoAllowed && !files[kind] && (
              <label className="flex items-center gap-1.5 text-caption text-text-muted">
                <Checkbox
                  checked={demo.includes(kind)}
                  onChange={(e) => setDemo(e.target.checked ? [...demo, kind] : demo.filter((k) => k !== kind))}
                />
                {demoLabel}
              </label>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddDocumentsDialog({ req, onClose, onDone }: { req: ProfessionalChangeDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [files, setFiles] = React.useState<Partial<Record<ProfessionalChangeDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<ProfessionalChangeDocumentKind[]>([]);
  const [busy, setBusy] = React.useState(false);
  const count = Object.values(files).filter(Boolean).length + demo.length;
  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      for (const [kind, file] of Object.entries(files)) if (file) form.set(`doc_${kind}`, file);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      form.set('expectedStatus', req.status);
      await postForm(`/api/professional-changes/${req.id}/documents`, form);
      toast.success('Documents added to the request');
      await onDone();
    } catch (error) {
      reportError(error, 'The documents could not be added.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add documents to {req.requestNumber}</DialogTitle>
          <DialogDescription>Documents that arrived after the request — the outgoing LTP’s NOC, for instance. The request stays where it is.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <DocumentInputs files={files} setFiles={setFiles} demoAllowed={req.permissions.demoDocumentAllowed} demo={demo} setDemo={setDemo} demoLabel="Demo placeholder" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || count === 0}>
            Add {count || ''} document{count === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
