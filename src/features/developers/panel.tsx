'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, CalendarClock, Check, FilePen, FileSearch, FileWarning, Gavel, Info, RefreshCw, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/features/applications/api';
import {
  DEVELOPER_DOCUMENTS,
  DEVELOPER_DOCUMENT_LABEL,
  DEVELOPER_KIND_LABEL,
  DEVELOPER_STATUS_LABEL,
  DEVELOPER_TYPE_LABEL,
  INCORPORATION_LABEL,
  VERIFICATION_OUTCOMES,
  VERIFICATION_OUTCOME_LABEL,
  daysUntil,
  type DeveloperDocumentKind,
  type DeveloperKind,
  type DeveloperStatus,
  type DeveloperType,
  type VerificationOutcome,
} from '@/lib/developer-registration';
import { cn } from '@/lib/utils';
import { DocLink, HistoryCard, Item, Prose, fmtDate, postForm, reportError, selectClass } from '@/features/proceedings/shared';
import type { Offer } from '@/features/proceedings/types';
import type { DeveloperDetailPayload } from './types';

type Step = 'submit' | 'takeUp' | 'shortfall' | 'respond' | 'verify' | 'decide' | 'renew';

const EVENT_LABEL: Record<string, string> = {
  DRAFT_OPENED: 'Registration application opened',
  DRAFT_UPDATED: 'Draft updated',
  RENEWAL_OPENED: 'Renewal opened',
  SUBMITTED: 'Submitted',
  TAKEN_UP: 'Taken up for scrutiny',
  SHORTFALL_RAISED: 'Shortfall raised',
  SHORTFALL_ANSWERED: 'Shortfall answered',
  VERIFIED: 'Documents verified',
  APPROVED: 'Approved — registration issued',
  REJECTED: 'Rejected',
  EXPIRED: 'Validity lapsed',
  SUPERSEDED: 'Replaced by renewal',
};
const statusLabel = (s: string) => DEVELOPER_STATUS_LABEL[s as DeveloperStatus] ?? s;

/**
 * One developer registration: where it stands, its validity, the developer's
 * particulars and documents, the scrutiny and decision, the chain of
 * registrations and renewals, and every move.
 */
export function DeveloperPanel({ initial }: { initial: DeveloperDetailPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState<Step | null>(null);
  const r = data.registration;
  const p = data.permissions;

  const reload = async () => {
    setOpen(null);
    setData(await api.get<DeveloperDetailPayload>(`/api/developers/${r.id}`));
    router.refresh();
  };

  const buttons: Array<{ step: Step; offer: Offer; label: string; icon: React.ReactNode; primary?: boolean }> = [
    { step: 'submit', offer: p.submit, label: 'Submit', icon: <Send className="size-4" />, primary: true },
    { step: 'takeUp', offer: p.takeUp, label: 'Take up', icon: <FileSearch className="size-4" />, primary: true },
    { step: 'verify', offer: p.verify, label: 'Verify', icon: <BadgeCheck className="size-4" />, primary: true },
    { step: 'shortfall', offer: p.shortfall, label: 'Raise shortfall', icon: <FileWarning className="size-4" /> },
    { step: 'respond', offer: p.respond, label: 'Record answer', icon: <Send className="size-4" />, primary: true },
    { step: 'decide', offer: p.decide, label: 'Decide', icon: <Gavel className="size-4" />, primary: true },
    { step: 'renew', offer: p.renew, label: 'Renew', icon: <RefreshCw className="size-4" />, primary: true },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {r.organization || r.developerName} <StatusBadge kind="developer" status={r.status} />
              <Badge tone="outline">{DEVELOPER_KIND_LABEL[r.kind as DeveloperKind] ?? r.kind}</Badge>
              {r.round > 1 && <Badge tone="outline">Round {r.round}</Badge>}
              {!r.isCurrent && r.supersededAt && <Badge tone="neutral">Superseded</Badge>}
            </CardTitle>
            <CardDescription>
              {r.applicationNumber}
              {r.registrationNumber ? ` · ${r.registrationNumber}` : ''} · {DEVELOPER_TYPE_LABEL[r.developerType as DeveloperType] ?? r.developerType}
              {r.currentDesk !== 'Closed' ? ` · next: ${r.currentDesk}` : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.edit.offered && (
              <Button variant="secondary" asChild>
                <Link href={`/developers/${r.id}/edit`}>
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
          <Path status={r.status} kind={r.kind} />
          {data.submitBlocker && (
            <p className="flex items-start gap-1.5 text-small text-text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {data.submitBlocker}
            </p>
          )}
          {data.openRenewal && (
            <p className="flex items-start gap-1.5 text-small text-text-muted">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0" /> Renewal{' '}
              <Link href={`/developers/${data.openRenewal.id}`} className="text-primary hover:underline">
                {data.openRenewal.applicationNumber}
              </Link>{' '}
              is under way.
            </p>
          )}
          {p.renew.offered && !p.renew.available && p.renew.reason && (
            <p className="flex items-start gap-1.5 text-small text-text-muted">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0" /> {p.renew.reason}
            </p>
          )}
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
            <Item label="Developer type">{DEVELOPER_TYPE_LABEL[r.developerType as DeveloperType] ?? r.developerType}</Item>
            <Item label="Developer name">{r.developerName}</Item>
            <Item label="Organisation">{r.organization || '—'}</Item>
            <Item label="Authorised person">{[r.authorizedPerson, r.authorizedDesignation].filter(Boolean).join(', ') || '—'}</Item>
            <Item label="Address" wide>
              {[r.address, r.district, r.pincode].filter(Boolean).join(', ') || '—'}
            </Item>
            <Item label="Mobile">{r.mobile || '—'}</Item>
            <Item label="Email">{r.email || '—'}</Item>
            <Item label="PAN">
              <span className="font-mono">{r.pan || '—'}</span>
            </Item>
            <Item label="GSTIN">
              <span className="font-mono">{r.gstin || '—'}</span>
            </Item>
            <Item label={INCORPORATION_LABEL[r.developerType as DeveloperType] ?? 'Registration number'}>
              {r.incorporationNo || '—'}
              {r.incorporationDate ? ` · ${fmtDate(r.incorporationDate)}` : ''}
            </Item>
            <Item label="RERA registration">{r.reraNo || '—'}</Item>
            <Item label="Experience">
              {r.experienceYears != null ? `${r.experienceYears} years` : '—'}
              {r.projectsCompleted != null ? ` · ${r.projectsCompleted} projects` : ''}
            </Item>
          </dl>
          {r.registrationInfo && (
            <div className="mt-3">
              <Prose label="Other registration information">{r.registrationInfo}</Prose>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supporting documents</CardTitle>
          <CardDescription>The latest of each kind first; earlier versions stay on record.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-1.5 text-small sm:grid-cols-2">
          {DEVELOPER_DOCUMENTS.map((kind) => {
            const idx = r.documents.map((d, i) => (d.kind === kind ? i : -1)).filter((i) => i >= 0).reverse();
            if (!idx.length && !data.requiredDocuments.includes(kind)) return null;
            return (
              <div key={kind} className="flex items-start justify-between gap-3 border-b border-border py-1.5">
                <span className="text-text-muted">
                  {DEVELOPER_DOCUMENT_LABEL[kind as DeveloperDocumentKind]}
                  {data.requiredDocuments.includes(kind) && <span className="text-danger"> *</span>}
                </span>
                <span className="text-right">
                  {idx.length ? (
                    idx.map((i, n) => {
                      const d = r.documents[i]!;
                      return (
                        <span key={i} className={cn('block', n > 0 && 'text-caption opacity-70')}>
                          <DocLink href={`/api/developers/${r.id}/document?index=${i}`}>
                            {d.isDemo ? 'Demo placeholder' : d.fileName}
                            {d.carriedForward ? ' (carried forward)' : d.round > 1 ? ` (round ${d.round})` : ''}
                          </DocLink>
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-danger">Not provided</span>
                  )}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

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
            <CardDescription>Every application under {r.registrationNumber ?? 'this developer'}, oldest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-small">
            {data.chain.map((c) => (
              <p key={c.id} className={cn(c.id === r.id && 'font-medium')}>
                <Link href={`/developers/${c.id}`} className="text-primary hover:underline">
                  {c.applicationNumber}
                </Link>{' '}
                · {DEVELOPER_KIND_LABEL[c.kind as DeveloperKind] ?? c.kind} · <StatusBadge kind="developer" status={c.status} />
                {c.validFrom ? ` · ${fmtDate(c.validFrom)} – ${fmtDate(c.validTo)}` : ''}
                {c.isCurrent ? ' · current' : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <HistoryCard events={data.events} label={EVENT_LABEL} statusLabel={statusLabel} />
      <AuditTrailCard rows={data.auditTrail} />

      {open === 'submit' && <SimpleDialog data={data} step="submit" onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'takeUp' && <SimpleDialog data={data} step="takeUp" onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'shortfall' && <ShortfallDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'respond' && <RespondDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'verify' && <VerifyDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'decide' && <DecideDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'renew' && (
        <RenewDialog
          data={data}
          onClose={() => setOpen(null)}
          onRenewed={(id) => {
            setOpen(null);
            router.push(`/developers/${id}`);
            router.refresh();
          }}
        />
      )}
    </div>
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

/** Registration → Documents → Review → Verification → Approval → Validity. */
function Path({ status, kind }: { status: string; kind: string }) {
  const order = ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'VERIFIED', 'APPROVED'];
  const at = status === 'SHORTFALL' ? 2 : status === 'REJECTED' ? 4 : status === 'EXPIRED' ? 5 : order.indexOf(status);
  const steps = [
    { label: kind === 'RENEWAL' ? 'Renewal' : 'Registration', done: at >= 0 },
    { label: 'Documents', done: at >= 1 },
    { label: 'Review', done: at >= 2 && status !== 'SHORTFALL' },
    { label: 'Verification', done: at >= 3 },
    { label: status === 'REJECTED' ? 'Rejected' : 'Approval', done: at >= 4 },
    { label: status === 'EXPIRED' ? 'Expired' : 'Validity', done: status === 'APPROVED' || status === 'EXPIRED' },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((st, i) => {
        const bad = (st.label === 'Rejected' || st.label === 'Expired') && st.done;
        return (
          <li
            key={st.label}
            className={cn('flex items-center gap-2 rounded border px-2.5 py-2', bad ? 'border-danger/40 bg-danger/5' : st.done ? 'border-success/40 bg-success/5' : 'border-border bg-surface-sunk')}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
                bad ? 'bg-danger text-white' : st.done ? 'bg-success text-white' : 'border border-border-strong text-text-muted'
              )}
            >
              {st.done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className="text-small font-medium text-text">{st.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ValidityCard({ data }: { data: DeveloperDetailPayload }) {
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
          ) : r.status === 'APPROVED' && r.isCurrent ? (
            <Badge tone="success">Valid</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Validity of {r.validityYears} year{r.validityYears === 1 ? '' : 's'} — a demonstration value from the settings in force when approved, not a published period.
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

/**
 * The raw, tamper-evident record — the same `audit_logs` rows every other
 * write in this system produces, hash-chained and never editable. Distinct
 * from the History card above it: that is this registration's own step-by-
 * step story; this is what the platform's audit system independently kept.
 */
function AuditTrailCard({ rows }: { rows: DeveloperDetailPayload['auditTrail'] }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
        <CardDescription>Every write to this registration, in the platform’s hash-chained audit log — append-only, sequence numbers never reused.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-small">
          {rows.map((a) => (
            <li key={a.id} className="border-l-2 border-border pl-3">
              <p className="font-medium text-text">
                #{a.seq} {a.action}
                <span className="font-normal text-text-muted">
                  {' '}
                  — {a.actorName}
                  {a.actorRoleKey && a.actorRoleKey !== 'SYSTEM' ? ` (${a.actorRoleKey})` : ''} · {fmtDate(a.occurredAt)}
                </span>
              </p>
              {a.remarks && <p className="text-text-muted">{a.remarks}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dialogs
// ═══════════════════════════════════════════════════════════════════════════

type DialogProps = { data: DeveloperDetailPayload; onClose: () => void; onDone: () => Promise<void> };

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
      ? { title: `Submit ${r.applicationNumber}`, description: 'The particulars and documents are complete. Submitting sends the application to the verifying desk.', action: 'Submit', url: 'submit' }
      : { title: `Take up ${r.applicationNumber}`, description: 'Marks the application as in process at your desk.', action: 'Take up', url: 'take-up' };
  return (
    <Shell
      title={cfg.title}
      description={cfg.description}
      onClose={onClose}
      busy={busy}
      disabled={false}
      action={cfg.action}
      onSubmit={() => run(() => api.post(`/api/developers/${r.id}/${cfg.url}`, { remarks, expectedStatus: r.status }))}
    >
      <Field label="Remarks" htmlFor="dv-remarks" error={errors.remarks}>
        <Textarea id="dv-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function ShortfallDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const [items, setItems] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Shortfall raised');
  const list = items.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <Shell
      title={`Raise shortfall — ${r.applicationNumber}`}
      description="The application waits on the developer until the register desk records their answer."
      onClose={onClose}
      busy={busy}
      disabled={!list.length || remarks.trim().length < 5}
      action="Raise shortfall"
      onSubmit={() => run(() => api.post(`/api/developers/${r.id}/shortfall`, { items: list, remarks, expectedStatus: r.status }))}
    >
      <Field label="What is missing or wrong — one per line" htmlFor="dv-items" required error={errors.items}>
        <Textarea id="dv-items" rows={4} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'Board resolution is not signed\nAddress proof older than three months'} />
      </Field>
      <Field label="Remarks" htmlFor="dv-sf-remarks" required error={errors.remarks}>
        <Textarea id="dv-sf-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RespondDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<DeveloperDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<DeveloperDocumentKind[]>([]);
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
      return postForm(`/api/developers/${r.id}/respond`, form);
    });
  return (
    <Shell
      title={`Record the developer’s answer — ${r.applicationNumber}`}
      description={
        <>
          The shortfall listed {r.shortfallItems.length} item{r.shortfallItems.length === 1 ? '' : 's'}. The application returns to the verifying desk.
        </>
      }
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 10}
      action="Record answer"
      onSubmit={submit}
      wide
    >
      <ul className="list-disc pl-5 text-small text-text-muted">
        {r.shortfallItems.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <Field label="What the developer supplied or corrected" htmlFor="dv-answer" required error={errors.remarks}>
        <Textarea id="dv-answer" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <p className="text-caption text-text-muted">Fresh documents, if any. PDF or image, 10 MB each.</p>
        {DEVELOPER_DOCUMENTS.map((kind) => (
          <div key={kind} className="grid items-center gap-1 sm:grid-cols-[18rem_1fr]">
            <label htmlFor={`dv-r-${kind}`} className="text-small text-text">
              {DEVELOPER_DOCUMENT_LABEL[kind]}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input id={`dv-r-${kind}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className="block max-w-[14rem] text-small" onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })} />
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
  const [outcome, setOutcome] = React.useState<VerificationOutcome>('RECOMMEND_APPROVAL');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, 'Verified — sent for decision');
  return (
    <Shell
      title={`Verify ${r.applicationNumber}`}
      description="Record what was checked against the originals, and recommend. The deciding desk approves or rejects."
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5}
      action="Verify"
      onSubmit={() => run(() => api.post(`/api/developers/${r.id}/verify`, { outcome, remarks, expectedStatus: r.status }))}
    >
      <Field label="Recommendation" htmlFor="dv-outcome" required error={errors.outcome}>
        <select id="dv-outcome" className={`${selectClass} w-full`} value={outcome} onChange={(e) => setOutcome(e.target.value as VerificationOutcome)}>
          {VERIFICATION_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {VERIFICATION_OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Verification remarks" htmlFor="dv-v-remarks" required error={errors.remarks}>
        <Textarea id="dv-v-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="PAN verified against original; GSTIN active; board resolution dated …" />
      </Field>
    </Shell>
  );
}

function DecideDialog({ data, onClose, onDone }: DialogProps) {
  const r = data.registration;
  const [decision, setDecision] = React.useState<'APPROVED' | 'REJECTED'>(r.verificationOutcome === 'RECOMMEND_REJECTION' ? 'REJECTED' : 'APPROVED');
  const [remarks, setRemarks] = React.useState('');
  const { busy, errors, run } = useSubmit(onDone, decision === 'APPROVED' ? 'Approved — registration issued' : 'Rejected');
  return (
    <Shell
      title={`Decide ${r.applicationNumber}`}
      description={
        <>
          {VERIFICATION_OUTCOME_LABEL[r.verificationOutcome as VerificationOutcome] ?? 'Verified'} by {r.verifiedByName}.{' '}
          {decision === 'APPROVED'
            ? r.kind === 'RENEWAL'
              ? `Approving renews ${r.registrationNumber} and sends the letter to Outward.`
              : 'Approving issues a registration number and validity, and sends the registration letter to Outward.'
            : 'Rejection is final for this application.'}
        </>
      }
      onClose={onClose}
      busy={busy}
      disabled={remarks.trim().length < 5}
      action={decision === 'APPROVED' ? 'Approve' : 'Reject'}
      destructive={decision === 'REJECTED'}
      onSubmit={() => run(() => api.post(`/api/developers/${r.id}/decide`, { decision, remarks, expectedStatus: r.status }))}
    >
      {r.verificationRemarks && <Prose label="Verification remarks">{r.verificationRemarks}</Prose>}
      <Field label="Decision" htmlFor="dv-decision" required>
        <select id="dv-decision" className={`${selectClass} w-full`} value={decision} onChange={(e) => setDecision(e.target.value as 'APPROVED' | 'REJECTED')}>
          <option value="APPROVED">Approve</option>
          <option value="REJECTED">Reject</option>
        </select>
      </Field>
      <Field label="Reasons" htmlFor="dv-d-remarks" required error={errors.remarks}>
        <Textarea id="dv-d-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RenewDialog({ data, onClose, onRenewed }: { data: DeveloperDetailPayload; onClose: () => void; onRenewed: (id: string) => void }) {
  const r = data.registration;
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const renew = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ id: string; applicationNumber: string }>(`/api/developers/${r.id}/renew`, { remarks });
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
      description={`Opens a renewal application as a draft, with the particulars and the latest documents carried forward. ${r.registrationNumber} stays as issued${r.status === 'APPROVED' ? ` and valid until ${fmtDate(r.validTo)}` : ''}; the renewal runs through review like a new registration.`}
      onClose={onClose}
      busy={busy}
      disabled={false}
      action="Open renewal"
      onSubmit={renew}
    >
      <Field label="Remarks" htmlFor="dv-renew">
        <Textarea id="dv-renew" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Renewal application received on …" />
      </Field>
    </Shell>
  );
}
