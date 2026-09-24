'use client';

import * as React from 'react';
import { AlertTriangle, BadgeCheck, Ban, CircleSlash, FileWarning, ShieldPlus } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import {
  NOC_ACTION_LABEL,
  NOC_ACTION_RESULT,
  NOC_STATUS_LABEL,
  REMARKS_REQUIRED,
  type ApplicantAction,
  type NocAction,
  type OfficerAction,
} from '@/lib/noc';
import type { NocRecord } from './types';

const OFFICER_ICON: Record<OfficerAction, React.ComponentType<{ className?: string }>> = {
  VERIFY: BadgeCheck,
  REJECT: Ban,
  SHORTFALL: FileWarning,
  MARK_NOT_REQUIRED: CircleSlash,
  MARK_REQUIRED: ShieldPlus,
};

const OFFICER_COPY: Record<OfficerAction, string> = {
  VERIFY:
    'You confirm the certificate is genuine, issued by the right authority, for this site and this proposal, and valid. Your name and desk are recorded against it.',
  REJECT: 'The certificate is not acceptable as submitted. The applicant sees your reason and must obtain a fresh one.',
  SHORTFALL: 'Something is missing or wrong. The applicant sees what you ask for and re-submits.',
  MARK_NOT_REQUIRED: 'This NOC is not needed for this file. Say why — it is the record of that decision.',
  MARK_REQUIRED: 'This NOC is needed for this file. The applicant is asked to obtain it.',
};

export const isOfficerAction = (a: NocAction): a is OfficerAction =>
  a === 'VERIFY' || a === 'REJECT' || a === 'SHORTFALL' || a === 'MARK_NOT_REQUIRED' || a === 'MARK_REQUIRED';

export const buttonVariantFor = (a: NocAction) =>
  a === 'VERIFY' || a === 'RECORD_RECEIPT' || a === 'MARK_REQUIRED'
    ? ('primary' as const)
    : a === 'REJECT'
      ? ('destructive' as const)
      : ('secondary' as const);

/** The desk's decision on one NOC. */
export function OfficerActionDialog({
  noc,
  action,
  onClose,
  onDone,
}: {
  noc: NocRecord;
  action: OfficerAction;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const needsRemarks = REMARKS_REQUIRED.has(action);
  const problems = action === 'VERIFY' ? noc.verificationProblems : [];
  const Icon = OFFICER_ICON[action];

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/nocs/${noc.id}/actions`, { action, remarks, expectedStatus: noc.status });
      toast.success(`${noc.nocType.name}: ${NOC_STATUS_LABEL[NOC_ACTION_RESULT[action]]}`, { description: noc.nocNumber });
      await onDone();
    } catch (error) {
      const detail =
        error instanceof ApiCallError && error.details?.length
          ? error.details.map((d) => d.message).join(' ')
          : undefined;
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.', { description: detail });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {NOC_ACTION_LABEL[action]} — {noc.nocType.name}
          </DialogTitle>
          <DialogDescription>
            {noc.nocNumber}
            {noc.referenceNumber ? ` · NOC No. ${noc.referenceNumber}` : ''} · {noc.authority || 'Authority not recorded'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-small text-text">{OFFICER_COPY[action]}</p>
          {problems.length > 0 && (
            <div className="flex items-start gap-2 rounded border border-danger/30 bg-danger-bg px-3 py-2.5 text-small">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <ul className="list-disc space-y-0.5 pl-4 text-text">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <Field
            label="Remarks"
            htmlFor="noc-remarks"
            required={needsRemarks}
            hint={needsRemarks ? 'The applicant sees this.' : 'Optional. Recorded with the decision.'}
          >
            <Textarea id="noc-remarks" rows={3} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={buttonVariantFor(action)}
            onClick={submit}
            loading={busy}
            disabled={busy || problems.length > 0 || (needsRemarks && !remarks.trim())}
          >
            <Icon className="size-4" />
            {NOC_ACTION_LABEL[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const dayValue = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** The applicant's record: the application to the authority, or the certificate received. */
export function ApplicantRecordDialog({
  noc,
  action,
  demoDocumentAllowed,
  onClose,
  onDone,
}: {
  noc: NocRecord;
  action: ApplicantAction;
  demoDocumentAllowed: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const receipt = action === 'RECORD_RECEIPT';
  const [authority, setAuthority] = React.useState(noc.authority);
  const [applicationReference, setApplicationReference] = React.useState(noc.applicationReference);
  const [appliedDate, setAppliedDate] = React.useState(dayValue(noc.appliedDate));
  const [referenceNumber, setReferenceNumber] = React.useState(noc.referenceNumber);
  const [issuedDate, setIssuedDate] = React.useState(dayValue(noc.issuedDate));
  const [expiryDate, setExpiryDate] = React.useState(dayValue(noc.expiryDate));
  const [remarks, setRemarks] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [demoDocument, setDemoDocument] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('action', action);
      form.set('authority', authority);
      form.set('applicationReference', applicationReference);
      form.set('appliedDate', appliedDate);
      form.set('remarks', remarks);
      form.set('expectedStatus', noc.status);
      if (receipt) {
        form.set('referenceNumber', referenceNumber);
        form.set('issuedDate', issuedDate);
        form.set('expiryDate', expiryDate);
        if (file) form.set('file', file);
        else if (demoDocument) form.set('demoDocument', 'true');
      }
      const res = await fetch(`/api/nocs/${noc.id}/applicant`, { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const details = (body?.details ?? []) as Array<{ path: string; message: string }>;
        setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
        throw new Error(body?.error ?? 'The NOC could not be updated.');
      }
      toast.success(`${noc.nocType.name}: ${receipt ? 'certificate recorded' : 'application recorded'}`, {
        description: noc.nocNumber,
      });
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The NOC could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {NOC_ACTION_LABEL[action]} — {noc.nocType.name}
          </DialogTitle>
          <DialogDescription>
            {receipt
              ? 'Enter the particulars exactly as printed on the certificate, and attach a copy.'
              : 'Record the application you made to the issuing authority.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {noc.remarks && (noc.status === 'SHORTFALL' || noc.status === 'REJECTED') && (
            <div className="rounded border border-warning/30 bg-warning-bg px-3 py-2 text-small text-text">
              <span className="font-medium">The department asked:</span> {noc.remarks}
            </div>
          )}
          <Field label="Issuing authority" htmlFor="noc-authority" error={errors.authority}>
            <Input id="noc-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Application reference"
              htmlFor="noc-appref"
              required={!receipt}
              error={errors.applicationReference}
              hint="The number the authority gave your application."
            >
              <Input id="noc-appref" value={applicationReference} onChange={(e) => setApplicationReference(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Applied on" htmlFor="noc-applied" required={!receipt} error={errors.appliedDate}>
              <Input id="noc-applied" type="date" max={today} value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
            </Field>
          </div>
          {receipt && (
            <>
              <Field label="NOC number" htmlFor="noc-ref" required error={errors.referenceNumber} hint="As printed on the certificate.">
                <Input id="noc-ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} maxLength={120} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date of issue" htmlFor="noc-issued" required error={errors.issuedDate}>
                  <Input id="noc-issued" type="date" max={today} value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
                </Field>
                <Field
                  label="Valid until"
                  htmlFor="noc-expiry"
                  required={noc.nocType.requiresExpiry}
                  error={errors.expiryDate}
                >
                  <Input id="noc-expiry" type="date" min={today} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                </Field>
              </div>
              <Field
                label="Certificate"
                htmlFor="noc-file"
                required={!noc.hasDocument}
                error={errors.file}
                hint={noc.hasDocument ? `Currently attached: ${noc.fileName}. Choose a file only to replace it.` : 'PDF, PNG or JPG, up to 10 MB.'}
              >
                <Input
                  id="noc-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={demoDocument}
                />
              </Field>
              {demoDocumentAllowed && !file && (
                <label className="flex items-start gap-2 text-small text-text-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={demoDocument}
                    onChange={(e) => setDemoDocument(e.target.checked)}
                  />
                  <span>
                    Use a <span className="font-medium text-text">DEMO placeholder certificate</span> instead of a file —
                    demonstration environment only, stamped DEMO wherever it is shown.
                  </span>
                </label>
              )}
            </>
          )}
          <Field label="Remarks" htmlFor="noc-app-remarks" hint="Optional. The desk sees this.">
            <Textarea id="noc-app-remarks" rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy}>
            {NOC_ACTION_LABEL[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One button per move the server said is open, and the dialog it opens. */
export function NocActionButtons({
  noc,
  officerMoves,
  applicantMoves,
  demoDocumentAllowed,
  onDone,
  size = 'sm',
}: {
  noc: NocRecord;
  officerMoves: NocAction[];
  applicantMoves: NocAction[];
  demoDocumentAllowed: boolean;
  onDone: () => void | Promise<void>;
  size?: 'xs' | 'sm';
}) {
  const [open, setOpen] = React.useState<NocAction | null>(null);
  const moves = [...applicantMoves, ...officerMoves];
  if (!moves.length) return null;

  const close = () => setOpen(null);
  const done = async () => {
    setOpen(null);
    await onDone();
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {moves.map((m) => (
          <Button key={m} size={size} variant={buttonVariantFor(m)} onClick={() => setOpen(m)}>
            {NOC_ACTION_LABEL[m]}
          </Button>
        ))}
      </div>
      {open && isOfficerAction(open) && <OfficerActionDialog noc={noc} action={open} onClose={close} onDone={done} />}
      {open && !isOfficerAction(open) && (
        <ApplicantRecordDialog
          noc={noc}
          action={open as ApplicantAction}
          demoDocumentAllowed={demoDocumentAllowed}
          onClose={close}
          onDone={done}
        />
      )}
    </>
  );
}
