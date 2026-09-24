'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileWarning, Gavel, Info, Lock, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { DEFAULT_RESPONSE_DAYS, SHOW_CAUSE_DECISION_LABEL, responseDueLabel, type ShowCauseDecision } from '@/lib/show-cause';
import { OUTWARD_DOCUMENT_LABEL, type OutwardDocumentType } from '@/lib/outward';
import { dayValue, fmtShort, postForm, reportError } from './shared';
import type { ApplicationProceedingsPayload, Offer } from './types';

/**
 * The application's Proceedings tab: show cause notices, revocation
 * proceedings and what this file has sent through Outward.
 *
 * Every button here is one the WORKFLOW offers this caller at the file's
 * current stage — read from the engine, never decided on this screen.
 */
export function ProceedingsTab({ initial }: { initial: ApplicationProceedingsPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState<'issue' | 'revoke' | null>(null);
  const reload = async () => {
    setOpen(null);
    setData(await api.get<ApplicationProceedingsPayload>(`/api/applications/${data.application.id}/proceedings`));
    router.refresh();
  };
  const p = data.permissions;

  return (
    <div className="space-y-4">
      {data.application.status === 'PROCEEDING_REVOKED' && (
        <p className="flex items-start gap-2 rounded border border-danger/30 bg-danger-bg px-3 py-2.5 text-small">
          <Gavel className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>
            <strong>Proceeding revoked.</strong> The permission {data.application.orderNumber} granted on this file has been revoked. The approval
            and its history remain on the record — see the Workflow tab.
          </span>
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="size-4" /> Show cause notices
            </CardTitle>
            <CardDescription>
              Separate from shortfalls: a notice asks for an explanation, and the desk records its decision on the answer.
            </CardDescription>
          </div>
          <OfferButton offer={p.issueShowCause} label="Issue show cause notice" icon={<Send className="size-4" />} onClick={() => setOpen('issue')} />
        </CardHeader>
        <CardContent>
          {data.showCauses.length === 0 ? (
            <p className="text-small text-text-muted">No show cause notice has been issued on this file.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.showCauses.map((n) => {
                const due = responseDueLabel(n.status, n.responseDueDate);
                return (
                  <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/show-cause/${n.id}`} className="font-medium text-primary hover:underline">
                        {n.noticeNumber}
                      </Link>
                      <p className="max-w-2xl text-small text-text">{n.violation}</p>
                      <p className="text-caption text-text-muted">
                        Issued {fmtShort(n.issuedAt)} by {n.issuedByName} ({n.issuedByRoleKey}) · Response due {fmtShort(n.responseDueDate)}
                        {due ? ` (${due})` : ''} · Current desk: {n.currentDesk}
                        {n.decision ? ` · Decision: ${SHOW_CAUSE_DECISION_LABEL[n.decision as ShowCauseDecision]}` : ''}
                      </p>
                    </div>
                    <StatusBadge kind="showCause" status={n.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {(data.revocations.length > 0 || p.initiateRevocation.offered) && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Gavel className="size-4" /> Revocation proceedings
              </CardTitle>
              <CardDescription>A proposal to revoke the permission. It stands until the revoking authority decides.</CardDescription>
            </div>
            <OfferButton offer={p.initiateRevocation} label="Initiate revocation" icon={<Gavel className="size-4" />} onClick={() => setOpen('revoke')} destructive />
          </CardHeader>
          <CardContent>
            {data.revocations.length === 0 ? (
              <p className="text-small text-text-muted">No revocation proceeding on this file.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.revocations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/revocations/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.revocationNumber}
                      </Link>
                      <p className="max-w-2xl text-small text-text">{r.reason}</p>
                      <p className="text-caption text-text-muted">
                        Initiated {fmtShort(r.initiatedAt)} by {r.initiatedByName}
                        {r.decidedAt ? ` · Decided ${fmtShort(r.decidedAt)}` : ''}
                        {r.revocationOrderNumber ? ` · Order ${r.revocationOrderNumber}` : ''}
                      </p>
                    </div>
                    <StatusBadge kind="revocation" status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {data.outward.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Outward</CardTitle>
            <CardDescription>Documents this file has sent out of the office.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {data.outward.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-small">
                    <Link href={`/outward/${o.id}`} className="font-medium text-primary hover:underline">
                      {o.outwardNumber}
                    </Link>{' '}
                    · {OUTWARD_DOCUMENT_LABEL[o.documentType as OutwardDocumentType] ?? o.documentType} {o.documentReference}
                    <span className="text-text-muted"> · assigned {fmtShort(o.assignedDate)}{o.dispatchDate ? ` · dispatched ${fmtShort(o.dispatchDate)}` : ''}</span>
                  </span>
                  <StatusBadge kind="outward" status={o.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!p.issueShowCause.offered && !p.initiateRevocation.offered && !p.isApplicant && (
        <p className="flex items-start gap-2 text-small text-text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          The workflow does not offer you a show cause or revocation action on this file at its current stage.
        </p>
      )}

      {open === 'issue' && <IssueDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
      {open === 'revoke' && <InitiateDialog data={data} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

/** A workflow-offered action: hidden when not offered, disabled with the guard's reason when blocked. */
function OfferButton({
  offer,
  label,
  icon,
  onClick,
  destructive,
}: {
  offer: Offer;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  if (!offer.offered) return null;
  if (!offer.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button variant="secondary" disabled className="cursor-not-allowed gap-1.5">
              {label} <Lock className="size-3" aria-hidden />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{offer.reason}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button variant={destructive ? 'destructive' : 'primary'} onClick={onClick}>
      {icon} {label}
    </Button>
  );
}

function IssueDialog({ data, onClose, onDone }: { data: ApplicationProceedingsPayload; onClose: () => void; onDone: () => Promise<void> }) {
  const [violation, setViolation] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [due, setDue] = React.useState(dayValue(DEFAULT_RESPONSE_DAYS));
  const [files, setFiles] = React.useState<File[]>([]);
  const [demo, setDemo] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('violation', violation);
      form.set('reason', reason);
      form.set('responseDueDate', due);
      form.set('expectedSequence', String(data.permissions.sequence));
      files.forEach((f) => form.append('files', f));
      if (!files.length && demo) form.set('demoDocument', 'true');
      const result = await postForm<{ message: string }>(`/api/applications/${data.application.id}/show-cause`, form);
      toast.success('Show cause notice issued', { description: result.message });
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The notice could not be issued.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue show cause notice — {data.application.applicationNumber}</DialogTitle>
          <DialogDescription>
            The notice is generated and sent to the Outward register for dispatch. The file does not move and no shortfall is raised.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Violation" htmlFor="sc-violation" required error={errors.violation} hint="What was observed. Printed on the notice.">
            <Textarea id="sc-violation" rows={3} value={violation} onChange={(e) => setViolation(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="sc-reason" required error={errors.reason} hint="Why a notice is being issued.">
            <Textarea id="sc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Response due" htmlFor="sc-due" required error={errors.responseDueDate} hint="Informational. Nothing happens automatically when it passes.">
            <Input id="sc-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Supporting documents" htmlFor="sc-support" hint="Up to five PDF or image files, 10 MB each.">
            <input
              id="sc-support"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              className="block text-small"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
            />
          </Field>
          {data.permissions.demoDocumentAllowed && !files.length && (
            <label className="flex items-center gap-2 text-small">
              <Checkbox checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Attach a labelled demo placeholder instead
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || violation.trim().length < 5 || reason.trim().length < 10}>
            Issue notice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InitiateDialog({ data, onClose, onDone }: { data: ApplicationProceedingsPayload; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = React.useState('');
  const [grounds, setGrounds] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const result = await api.post<{ message: string }>(`/api/applications/${data.application.id}/revocation`, {
        reason,
        grounds: grounds.split('\n').map((g) => g.trim()).filter(Boolean),
      });
      toast.success('Revocation initiated', { description: result.message });
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The revocation could not be initiated.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Initiate revocation — {data.application.orderNumber || data.application.applicationNumber}</DialogTitle>
          <DialogDescription>
            A proposal only. It goes to the revoking authority for review and decision; the permission stands until then.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Reason" htmlFor="rv-reason" required error={errors.reason}>
            <Textarea id="rv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Grounds" htmlFor="rv-grounds" required error={errors.grounds} hint="One per line.">
            <Textarea id="rv-grounds" rows={4} value={grounds} onChange={(e) => setGrounds(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} loading={busy} disabled={busy || reason.trim().length < 10 || !grounds.trim()}>
            Initiate revocation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
