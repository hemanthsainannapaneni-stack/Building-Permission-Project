'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, CalendarClock, Check, CheckCircle2, FilePen, FileSearch, FileWarning, Info, RefreshCw, Send, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/features/applications/api';
import {
  PROFESSIONAL_DOCUMENTS,
  PROFESSIONAL_DOCUMENT_LABEL,
  PROFESSIONAL_KIND_LABEL,
  PROFESSIONAL_STATUS_LABEL,
  VERIFICATION_OUTCOMES,
  VERIFICATION_OUTCOME_LABEL,
  daysUntil,
  latestProfessionalDocuments,
  type ProfessionalDocumentKind,
  type ProfessionalKind,
  type ProfessionalStatus,
  type VerificationOutcome,
} from '@/lib/professional-registration';
import { cn } from '@/lib/utils';
import { DocLink, HistoryCard, Item, Prose, fmtDate, postForm, reportError, selectClass } from '@/features/proceedings/shared';
import type { Offer } from '@/features/proceedings/types';
import type { ProfessionalDetailPayload } from './types';

type Step = 'submit' | 'takeUp' | 'shortfall' | 'respond' | 'verify' | 'approve' | 'reject' | 'renew';

const EVENT_LABEL: Record<string, string> = {
  DRAFT_OPENED: 'Registration application opened',
  DRAFT_UPDATED: 'Draft updated',
  RENEWAL_OPENED: 'Renewal opened',
  SUBMITTED: 'Submitted',
  TAKEN_UP: 'Taken up for scrutiny',
  DOCUMENT_VERIFIED: 'Document verified',
  DOCUMENT_REJECTED: 'Document rejected',
  SHORTFALL_RAISED: 'Shortfall raised',
  SHORTFALL_ANSWERED: 'Shortfall answered',
  VERIFIED: 'Registration verified',
  APPROVED: 'Approved — registration issued',
  REJECTED: 'Rejected',
  EXPIRED: 'Validity lapsed',
  SUPERSEDED: 'Replaced by renewal',
};
const statusLabel = (s: string) => PROFESSIONAL_STATUS_LABEL[s as ProfessionalStatus] ?? s;

/**
 * One professional registration: where it stands, whether applications may
 * name it, its validity, the particulars and licence, each document with its
 * check, the review and decision, the chain of renewals, and every move.
 */
export function ProfessionalPanel({ initial }: { initial: ProfessionalDetailPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState<Step | null>(null);
  const r = data.registration;
  const p = data.permissions;

  const reload = async () => {
    setOpen(null);
    setData(await api.get<ProfessionalDetailPayload>(`/api/professionals/${r.id}`));
    router.refresh();
  };

  const pendingDocs = data.unverifiedDocuments.length;
  const verifyOffer: Offer = p.verify;
  const buttons: Array<{ step: Step; offer: Offer; label: string; icon: React.ReactNode; primary?: boolean }> = [
    { step: 'submit', offer: p.submit, label: 'Submit', icon: <Send className="size-4" />, primary: true },
    { step: 'takeUp', offer: p.takeUp, label: 'Take up', icon: <FileSearch className="size-4" />, primary: true },
    { step: 'verify', offer: verifyOffer, label: 'Verify', icon: <BadgeCheck className="size-4" />, primary: true },
    { step: 'shortfall', offer: p.shortfall, label: 'Shortfall', icon: <FileWarning className="size-4" /> },
    { step: 'respond', offer: p.respond, label: 'Record answer', icon: <Send className="size-4" />, primary: true },
    {
      step: 'approve',
      offer: p.decide.offered
        ? r.verificationOutcome === 'RECOMMEND_APPROVAL' && !pendingDocs
          ? p.decide
          : { offered: true, available: false, reason: 'Approval needs every required document verified and a recommendation to approve.' }
        : p.decide,
      label: 'Approve',
      icon: <ThumbsUp className="size-4" />,
      primary: true,
    },
    { step: 'reject', offer: p.decide, label: 'Reject', icon: <ThumbsDown className="size-4" /> },
    { step: 'renew', offer: p.renew, label: 'Renew', icon: <RefreshCw className="size-4" />, primary: true },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {r.name} <StatusBadge kind="professional" status={r.status} />
              <Badge tone="outline">{r.typeLabel}</Badge>
              <Badge tone="outline">{PROFESSIONAL_KIND_LABEL[r.kind as ProfessionalKind] ?? r.kind}</Badge>
              {r.round > 1 && <Badge tone="outline">Round {r.round}</Badge>}
              {!r.isCurrent && r.supersededAt && <Badge tone="neutral">Superseded</Badge>}
              {r.available && (
                <Badge tone="success">
                  <CheckCircle2 className="mr-1 inline size-3" />
                  Available for applications
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {r.applicationNumber}
              {r.registrationNumber ? ` · ${r.registrationNumber}` : ''} · licence {r.licenceNo || '—'}
              {r.currentDesk !== 'Closed' ? ` · next: ${r.currentDesk}` : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.edit.offered && (
              <Button variant="secondary" asChild>
                <Link href={`/professionals/${r.id}/edit`}>
                  <FilePen className="size-4" /> Edit draft
                </Link>
              </Button>
            )}
            {buttons.map((b) => (
              <StepButton key={b.step} {...b} onClick={() => setOpen(b.step)} />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Path status={r.status} kind={r.kind} available={r.available} />
          {data.submitBlocker && <Note icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>{data.submitBlocker}</Note>}
          {r.status === 'IN_PROCESS' && pendingDocs > 0 && (
            <Note icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>
              {pendingDocs} required document{pendingDocs === 1 ? '' : 's'} still to verify before this registration can be recommended for approval.
            </Note>
          )}
          {data.openRenewal && (
            <Note icon={<RefreshCw className="mt-0.5 size-3.5 shrink-0" />}>
              Renewal{' '}
              <Link href={`/professionals/${data.openRenewal.id}`} className="text-primary hover:underline">
                {data.openRenewal.applicationNumber}
              </Link>{' '}
              is under way.
            </Note>
          )}
          {p.renew.offered && !p.renew.available && p.renew.reason && <Note icon={<CalendarClock className="mt-0.5 size-3.5 shrink-0" />}>{p.renew.reason}</Note>}
        </CardContent>
      </Card>

      <ValidityCard data={data} />

      <Card>
        <CardHeader>
          <CardTitle>Particulars</CardTitle>
          <CardDescription>Opened by {r.createdByName} on {fmtDate(r.createdAt)}.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-4">
            <Item label="Professional type">{r.typeLabel}</Item>
            <Item label="Name">{r.name}</Item>
            <Item label="Portal account">{data.account ? `${data.account.name} · ${data.account.email}` : 'None linked'}</Item>
            <Item label="Qualification">{r.qualification || '—'}</Item>
            <Item label="Experience">{r.experienceYears != null ? `${r.experienceYears} years` : '—'}</Item>
            <Item label="Organisation">{r.organization || '—'}</Item>
            <Item label="Mobile">{r.mobile || '—'}</Item>
            <Item label="Email">{r.email || '—'}</Item>
            <Item label="Address" wide>
              {[r.address, r.district, r.pincode].filter(Boolean).join(', ') || '—'}
            </Item>
            <Item label="Licence number">{r.licenceNo || '—'}</Item>
            <Item label="Registration body">{r.registrationBody || '—'}</Item>
            <Item label="Licence valid">
              {r.licenceValidFrom ? `${fmtDate(r.licenceValidFrom)} – ` : 'to '}
              {fmtDate(r.licenceValidTo)}
            </Item>
            <Item label="Named on applications">{data.filesNamed ? `${data.filesNamed} file${data.filesNamed === 1 ? '' : 's'}` : 'None yet'}</Item>
          </dl>
          <div className="mt-3">
            <Prose label={r.consentGiven ? `Consent given${r.consentAt ? ` — ${fmtDate(r.consentAt)}` : ''}` : 'Consent not yet given'}>{r.consentGiven ? r.consentText : data.consentText}</Prose>
          </div>
        </CardContent>
      </Card>

      <DocumentsCard data={data} onChanged={reload} />

      {(r.takenUpAt || r.shortfallRaisedAt || r.verifiedAt || r.decidedAt) && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-small">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Item label="Submitted">{r.submittedAt ? `${fmtDate(r.submittedAt)} · ${r.submittedByName}` : '—'}</Item>
              <Item label="Taken up">{r.takenUpAt ? `${fmtDate(r.takenUpAt)} · ${r.takenUpByName}` : '—'}</Item>
              <Item label="Verified">{r.verifiedAt ? `${fmtDate(r.verifiedAt)} · ${r.verifiedByName}` : '—'}</Item>
              <Item label="Decided">{r.decidedAt ? `${fmtDate(r.decidedAt)} · ${r.decidedByName}` : '—'}</Item>
            </dl>
            {r.shortfallRaisedAt && (
              <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2">
                <p className="font-medium text-text">
                  Shortfall raised by {r.shortfallRaisedByName} · {fmtDate(r.shortfallRaisedAt)}
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {r.shortfallItems.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                {r.shortfallRemarks && <p className="mt-1 text-text-muted">{r.shortfallRemarks}</p>}
                {r.shortfallRespondedAt && (
                  <p className="mt-2">
                    <span className="font-medium">Answered {fmtDate(r.shortfallRespondedAt)}:</span> {r.shortfallResponse}
                  </p>
                )}
              </div>
            )}
            {r.verificationOutcome && (
              <Prose label={VERIFICATION_OUTCOME_LABEL[r.verificationOutcome as VerificationOutcome] ?? r.verificationOutcome}>{r.verificationRemarks}</Prose>
            )}
            {r.decision && <Prose label={r.decision === 'APPROVED' ? 'Approved' : 'Rejected'}>{r.decisionRemarks}</Prose>}
          </CardContent>
        </Card>
      )}

      {data.chain.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Registration and renewals</CardTitle>
            <CardDescription>Every application under {r.registrationNumber ?? 'this professional'}, oldest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-small">
            {data.chain.map((c) => (
              <p key={c.id} className={cn(c.id === r.id && 'font-medium')}>
                <Link href={`/professionals/${c.id}`} className="text-primary hover:underline">
                  {c.applicationNumber}
                </Link>{' '}
                · {PROFESSIONAL_KIND_LABEL[c.kind as ProfessionalKind] ?? c.kind} · <StatusBadge kind="professional" status={c.status} />
                {c.validFrom ? ` · ${fmtDate(c.validFrom)} – ${fmtDate(c.validTo)}` : ''}
                {c.isCurrent ? ' · current' : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <HistoryCard events={data.events} label={EVENT_LABEL} statusLabel={statusLabel} />

      {(open === 'submit' || open === 'takeUp') && <SimpleDialog data={data} step={open} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'shortfall' && <ShortfallDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'respond' && <RespondDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'verify' && <VerifyDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {(open === 'approve' || open === 'reject') && <DecideDialog data={data} decision={open === 'approve' ? 'APPROVED' : 'REJECTED'} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'renew' && (
        <RenewDialog
          data={data}
          onClose={() => setOpen(null)}
          onRenewed={(id) => {
            setOpen(null);
            router.push(`/professionals/${id}`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-small text-text-muted">
      {icon} <span>{children}</span>
    </p>
  );
}

function StepButton({ offer, label, icon, primary, onClick }: { offer: Offer; label: string; icon: React.ReactNode; primary?: boolean; onClick: () => void }) {
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
      <TooltipContent className="max-w-sm">{offer.reason}</TooltipContent>
    </Tooltip>
  );
}

/** Registration → Review → Verification → Approval → Available for applications. */
function Path({ status, kind, available }: { status: string; kind: string; available: boolean }) {
  const order = ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'VERIFIED', 'APPROVED'];
  const at = status === 'SHORTFALL' ? 2 : status === 'REJECTED' || status === 'EXPIRED' ? 4 : order.indexOf(status);
  const steps = [
    { label: kind === 'RENEWAL' ? 'Renewal' : 'Registration', done: at >= 1, bad: false },
    { label: 'Review', done: at >= 2 && status !== 'SHORTFALL', bad: false },
    { label: status === 'SHORTFALL' ? 'Shortfall' : 'Verification', done: at >= 3, bad: status === 'SHORTFALL' },
    { label: status === 'REJECTED' ? 'Rejected' : 'Approval', done: at >= 4, bad: status === 'REJECTED' },
    { label: status === 'EXPIRED' ? 'Expired' : 'Available for applications', done: available || status === 'EXPIRED', bad: status === 'EXPIRED' },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {steps.map((st, i) => (
        <li
          key={st.label}
          className={cn('flex items-center gap-2 rounded border px-2.5 py-2', st.bad ? 'border-danger/40 bg-danger/5' : st.done ? 'border-success/40 bg-success/5' : 'border-border bg-surface-sunk')}
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
              st.bad ? 'bg-danger text-white' : st.done ? 'bg-success text-white' : 'border border-border-strong text-text-muted'
            )}
          >
            {st.bad ? <X className="size-3" /> : st.done ? <Check className="size-3" /> : i + 1}
          </span>
          <span className="text-small font-medium text-text">{st.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ValidityCard({ data }: { data: ProfessionalDetailPayload }) {
  const r = data.registration;
  if (!r.issueDate) return null;
  const left = r.validTo ? daysUntil(r.validTo, new Date()) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarClock className="size-4" /> Registration {r.registrationNumber}
          {r.status === 'EXPIRED' ? (
            <Badge tone="danger">Expired {fmtDate(r.expiredAt ?? r.validTo)}</Badge>
          ) : r.renewalDue ? (
            <Badge tone="warning">Renewal due</Badge>
          ) : r.available ? (
            <Badge tone="success">Valid</Badge>
          ) : null}
          {r.cappedByLicence && <Badge tone="outline">Ends with the licence</Badge>}
        </CardTitle>
        <CardDescription>
          {r.validityYears} year{r.validityYears === 1 ? '' : 's'} from issue — a demonstration setting, not a statutory period — and never past the licence’s own validity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-5">
          <Item label="Issue date">{fmtDate(r.issueDate)}</Item>
          <Item label="Valid from">{fmtDate(r.validFrom)}</Item>
          <Item label="Valid to">
            {fmtDate(r.validTo)}
            {left != null && r.status === 'APPROVED' && <span className="block text-caption text-text-muted">{left >= 0 ? `${left} days left` : `${-left} days ago`}</span>}
          </Item>
          <Item label="Renewal due">{fmtDate(r.renewalDueDate)}</Item>
          <Item label="Registration letter">
            {r.outwardEntryId ? (
              <Link href={`/outward/${r.outwardEntryId}`} className="text-primary hover:underline">
                {r.outwardNumber}
              </Link>
            ) : (
              '—'
            )}
          </Item>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Each document, latest first within its kind, with its check — and the check controls while the file is in process. */
function DocumentsCard({ data, onChanged }: { data: ProfessionalDetailPayload; onChanged: () => Promise<void> }) {
  const r = data.registration;
  const canCheck = data.permissions.checkDocument.offered && data.permissions.checkDocument.available;
  const latest = latestProfessionalDocuments(r.documents);
  const [rejecting, setRejecting] = React.useState<number | null>(null);
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState<number | null>(null);

  const check = async (index: number, decision: 'VERIFIED' | 'REJECTED', why = '') => {
    setBusy(index);
    try {
      await api.post(`/api/professionals/${r.id}/documents`, { index, decision, remarks: why });
      toast.success(decision === 'VERIFIED' ? 'Document verified' : 'Document rejected');
      setRejecting(null);
      setRemarks('');
      await onChanged();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Supporting documents</CardTitle>
        <CardDescription>
          Checked one by one by the verifying desk — Verified or Rejected, with who, when and why — as documents on an application are. Only the latest of each kind counts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-small">
        {PROFESSIONAL_DOCUMENTS.map((kind) => {
          const idx = r.documents.map((d, i) => (d.kind === kind ? i : -1)).filter((i) => i >= 0).reverse();
          const required = data.requiredDocuments.includes(kind);
          if (!idx.length && !required) return null;
          return (
            <div key={kind} className="grid gap-2 border-b border-border py-2 sm:grid-cols-[18rem_1fr]">
              <span className="text-text-muted">
                {PROFESSIONAL_DOCUMENT_LABEL[kind as ProfessionalDocumentKind]}
                {required && <span className="text-danger"> *</span>}
              </span>
              <div className="space-y-1.5">
                {!idx.length && <span className="text-danger">Not provided</span>}
                {idx.map((i, n) => {
                  const d = r.documents[i]!;
                  const isLatest = latest.get(d.kind)?.index === i;
                  return (
                    <div key={i} className={cn('flex flex-wrap items-center gap-2', n > 0 && 'text-caption opacity-70')}>
                      <DocLink href={`/api/professionals/${r.id}/document?index=${i}`}>
                        {d.isDemo ? 'Demo placeholder' : d.fileName}
                        {d.carriedForward ? ' (carried forward)' : d.round > 1 ? ` (round ${d.round})` : ''}
                      </DocLink>
                      <StatusBadge kind="document" status={isLatest || d.status !== 'UPLOADED' ? d.status : 'SUPERSEDED'} />
                      {d.verifiedByName && (
                        <span className="text-caption text-text-muted">
                          {d.verifiedByName} · {fmtDate(d.verifiedAt)}
                          {d.verifyRemarks ? ` — ${d.verifyRemarks}` : ''}
                        </span>
                      )}
                      {canCheck && isLatest && (
                        <span className="ml-auto flex gap-1.5">
                          <Button size="sm" variant="secondary" disabled={busy !== null || d.status === 'VERIFIED'} loading={busy === i && rejecting === null} onClick={() => check(i, 'VERIFIED')}>
                            <Check className="size-3.5" /> Verify
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy !== null || d.status === 'REJECTED'} onClick={() => setRejecting(i)}>
                            <X className="size-3.5" /> Reject
                          </Button>
                        </span>
                      )}
                      {rejecting === i && (
                        <span className="flex w-full flex-wrap items-center gap-2">
                          <Input aria-label="Why the document is rejected" className="max-w-md" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Why it is rejected" />
                          <Button size="sm" variant="destructive" disabled={remarks.trim().length < 5} loading={busy === i} onClick={() => check(i, 'REJECTED', remarks)}>
                            Reject document
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                            Cancel
                          </Button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dialogs
// ═══════════════════════════════════════════════════════════════════════════

type DialogProps = { data: ProfessionalDetailPayload; onClose: () => void; onDone: () => Promise<void> };

function Shell({
  title,
  description,
  onClose,
  busy,
  disabled,
  action,
  onSubmit,
  destructive,
  wide,
  children,
}: {
  title: string;
  description: React.ReactNode;
  onClose: () => void;
  busy: boolean;
  disabled: boolean;
  action: string;
  onSubmit: () => void;
  destructive?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'max-w-3xl' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">{children}</DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onSubmit} loading={busy} disabled={busy || disabled}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useSubmit(onDone: () => Promise<void>, success: string) {
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(success);
      await onDone();
    } catch (error) {
      setErrors(reportError(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, run };
}

function SimpleDialog({ data, step, onClose, onDone }: DialogProps & { step: 'submit' | 'takeUp' }) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, step === 'submit' ? 'Submitted' : 'Taken up for scrutiny');
  const cfg =
    step === 'submit'
      ? { title: `Submit ${r.applicationNumber}`, description: 'The particulars, documents and consent are complete. Submitting puts the application in the Pending register for the verifying desk.', action: 'Submit', url: 'submit' }
      : { title: `Take up ${r.applicationNumber}`, description: 'Marks the application In Process at your desk. You then check each document.', action: 'Take up', url: 'take-up' };
  return (
    <Shell title={cfg.title} description={cfg.description} onClose={onClose} busy={busy} disabled={false} action={cfg.action} onSubmit={() => run(() => api.post(`/api/professionals/${r.id}/${cfg.url}`, { remarks, expectedStatus: r.status }))}>
      <Field label="Remarks" htmlFor="pr-remarks" error={errors.remarks}>
        <Textarea id="pr-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function ShortfallDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const rejected = r.documents
    .filter((d, i) => latestProfessionalDocuments(r.documents).get(d.kind)?.index === i && d.status === 'REJECTED')
    .map((d) => `${PROFESSIONAL_DOCUMENT_LABEL[d.kind]}: ${d.verifyRemarks || 'rejected'}`);
  const [items, setItems] = React.useState(rejected.join('\n'));
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Shortfall raised');
  const list = items.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <Shell
      title={`Shortfall — ${r.applicationNumber}`}
      description="The application waits on the professional until the register desk records their answer. Rejected documents are listed for you."
      onClose={onClose}
      busy={busy}
      disabled={!list.length || remarks.trim().length < 5}
      action="Raise shortfall"
      onSubmit={() => run(() => api.post(`/api/professionals/${r.id}/shortfall`, { items: list, remarks, expectedStatus: r.status }))}
    >
      <Field label="What is missing or wrong — one per line" htmlFor="pr-items" required error={errors.items}>
        <Textarea id="pr-items" rows={4} value={items} onChange={(e) => setItems(e.target.value)} />
      </Field>
      <Field label="Remarks" htmlFor="pr-sf-remarks" required error={errors.remarks}>
        <Textarea id="pr-sf-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RespondDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<ProfessionalDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<ProfessionalDocumentKind[]>([]);
  const { busy, errors, run } = useSubmit(onDone, 'Answer recorded — back in process');
  const submit = () =>
    run(() => {
      const form = new FormData();
      form.set('remarks', remarks);
      form.set('expectedStatus', r.status);
      for (const [k, f] of Object.entries(files)) if (f) form.set(`doc_${k}`, f);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      return postForm(`/api/professionals/${r.id}/respond`, form);
    });
  return (
    <Shell title={`Record the professional’s answer — ${r.applicationNumber}`} description="The application returns to the verifying desk, which checks any fresh documents." onClose={onClose} busy={busy} disabled={remarks.trim().length < 10} action="Record answer" onSubmit={submit} wide>
      <ul className="list-disc pl-5 text-small text-text-muted">
        {r.shortfallItems.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <Field label="What the professional supplied or corrected" htmlFor="pr-answer" required error={errors.remarks}>
        <Textarea id="pr-answer" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <p className="text-caption text-text-muted">Fresh documents, if any. PDF or image, 10 MB each.</p>
        {PROFESSIONAL_DOCUMENTS.map((kind) => (
          <div key={kind} className="grid items-center gap-1 sm:grid-cols-[18rem_1fr]">
            <label htmlFor={`pr-r-${kind}`} className="text-small text-text">
              {PROFESSIONAL_DOCUMENT_LABEL[kind]}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input id={`pr-r-${kind}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className="block max-w-[14rem] text-small" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
              {data.permissions.demoAllowed && !files[kind] && (
                <label className="flex items-center gap-1.5 text-caption text-text-muted">
                  <Checkbox checked={demo.includes(kind)} onChange={(e) => setDemo(e.target.checked ? [...demo, kind] : demo.filter((k) => k !== kind))} />
                  Demo placeholder
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function VerifyDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const pending = data.unverifiedDocuments.length;
  const [outcome, setOutcome] = React.useState<VerificationOutcome>(pending ? 'RECOMMEND_REJECTION' : 'RECOMMEND_APPROVAL');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Verified — sent for decision');
  return (
    <Shell
      title={`Verify ${r.applicationNumber}`}
      description={pending ? `${pending} required document${pending === 1 ? ' is' : 's are'} not verified, so only a recommendation to reject is open.` : 'Every required document is verified. Record what was checked, and recommend.'}
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5 || (outcome === 'RECOMMEND_APPROVAL' && pending > 0)}
      action="Verify"
      onSubmit={() => run(() => api.post(`/api/professionals/${r.id}/verify`, { outcome, remarks, expectedStatus: r.status }))}
    >
      <Field label="Recommendation" htmlFor="pr-outcome" required error={errors.outcome}>
        <select id="pr-outcome" className={`${selectClass} w-full`} value={outcome} onChange={(e) => setOutcome(e.target.value as VerificationOutcome)}>
          {VERIFICATION_OUTCOMES.map((o) => (
            <option key={o} value={o} disabled={o === 'RECOMMEND_APPROVAL' && pending > 0}>
              {VERIFICATION_OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Verification remarks" htmlFor="pr-v-remarks" required error={errors.remarks}>
        <Textarea id="pr-v-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Licence confirmed with the registration body; degree certificate verified against original…" />
      </Field>
    </Shell>
  );
}

function DecideDialog({ data, decision, onClose, onDone }: DialogProps & { decision: 'APPROVED' | 'REJECTED' }) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, decision === 'APPROVED' ? 'Approved — the professional is available for applications' : 'Rejected');
  return (
    <Shell
      title={`${decision === 'APPROVED' ? 'Approve' : 'Reject'} ${r.applicationNumber}`}
      description={
        <>
          {VERIFICATION_OUTCOME_LABEL[r.verificationOutcome as VerificationOutcome] ?? 'Verified'} by {r.verifiedByName}.{' '}
          {decision === 'APPROVED'
            ? r.kind === 'RENEWAL'
              ? `Approving renews ${r.registrationNumber} and sends the letter to Outward.`
              : `Approving issues a ${r.typeLabel.toLowerCase()} registration number and validity, sends the letter to Outward, and makes the professional available for applications.`
            : 'Rejection is final for this application.'}
        </>
      }
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5}
      action={decision === 'APPROVED' ? 'Approve' : 'Reject'}
      destructive={decision === 'REJECTED'}
      onSubmit={() => run(() => api.post(`/api/professionals/${r.id}/decide`, { decision, remarks, expectedStatus: r.status }))}
    >
      {r.verificationRemarks && <Prose label="Verification remarks">{r.verificationRemarks}</Prose>}
      <Field label="Reasons" htmlFor="pr-d-remarks" required error={errors.remarks}>
        <Textarea id="pr-d-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RenewDialog({ data, onClose, onRenewed }: { data: ProfessionalDetailPayload; onClose: () => void; onRenewed: (id: string) => void }) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const [licenceValidTo, setLicenceValidTo] = React.useState(r.licenceValidTo?.slice(0, 10) ?? '');
  const [busy, setBusy] = React.useState(false);
  const renew = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ id: string; applicationNumber: string }>(`/api/professionals/${r.id}/renew`, { remarks, licenceValidTo });
      toast.success(`Renewal ${res.applicationNumber} opened as a draft`);
      onRenewed(res.id);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title={`Renew ${r.registrationNumber}`}
      description={`Opens a renewal as a draft, with the particulars and latest documents carried forward — to be checked afresh — and consent to be given again. ${r.registrationNumber} stays as issued${r.status === 'APPROVED' ? ` until ${fmtDate(r.validTo)}` : ''}.`}
      onClose={onClose}
      busy={busy}
      disabled={false}
      action="Open renewal"
      onSubmit={renew}
    >
      <Field label="Licence valid to" htmlFor="pr-renew-lic" hint="Where the registration body has extended the licence, its new validity.">
        <Input id="pr-renew-lic" type="date" value={licenceValidTo} onChange={(e) => setLicenceValidTo(e.target.value)} />
      </Field>
      <Field label="Remarks" htmlFor="pr-renew">
        <Textarea id="pr-renew" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Renewal application received on …" />
      </Field>
    </Shell>
  );
}
