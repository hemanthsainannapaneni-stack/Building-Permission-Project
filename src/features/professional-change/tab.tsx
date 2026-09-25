'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Info, UserRoundCog } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { REQUIRED_AT_REQUEST, type ProfessionalChangeDocumentKind } from '@/lib/professional-change';
import { dayValue, fmtDate, fmtShort, postForm, reportError, selectClass } from '@/features/proceedings/shared';
import { EngagementHistory } from './parts';
import { DocumentInputs } from './detail';
import type { ApplicationProfessionalPayload } from './types';

/**
 * The application's Technical Professional tab: who holds the file, everyone
 * who has held it, and the change requests made on it.
 */
export function ProfessionalTab({ initial }: { initial: ApplicationProfessionalPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const active = data.engagements.find((e) => e.status === 'ACTIVE');
  const offer = data.permissions.request;

  const reload = async () => {
    setOpen(false);
    setData(await api.get<ApplicationProfessionalPayload>(`/api/applications/${data.application.id}/professional-change`));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserRoundCog className="size-4" /> Technical professional
            </CardTitle>
            <CardDescription>The professional who holds this file now, and may submit drawings on it.</CardDescription>
          </div>
          {offer.offered &&
            (offer.available ? (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Register change of professional
              </Button>
            ) : (
              <p className="flex max-w-sm items-start gap-1.5 text-caption text-text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" /> {offer.reason}
              </p>
            ))}
        </CardHeader>
        <CardContent>
          {active ? (
            <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-caption text-text-muted">Name</dt>
                <dd className="font-medium text-text">{active.name}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">Licence</dt>
                <dd className="text-text">
                  {active.snapshot.licenceNo || '—'} {active.snapshot.licenceClass ? `· ${active.snapshot.licenceClass}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">Firm</dt>
                <dd className="text-text">{active.snapshot.firmName || '—'}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">Holding the file since</dt>
                <dd className="text-text">{fmtDate(active.engagedFrom)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-small text-text-muted">No professional is recorded on this file.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change requests</CardTitle>
          <CardDescription>Request → Verification → Review → Approval or rejection. Each step is recorded on the file’s workflow history.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.requests.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-small">
                <thead>
                  <tr className="border-b border-border text-left text-caption text-text-muted">
                    <th className="py-1.5 pr-3 font-medium">Request</th>
                    <th className="py-1.5 pr-3 font-medium">Current → proposed</th>
                    <th className="py-1.5 pr-3 font-medium">Request date</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Current desk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link href={`/professional-changes/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.requestNumber}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.currentProfessional} → {r.proposedProfessional}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmtShort(r.requestDate)}</td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge kind="professionalChange" status={r.status} />
                      </td>
                      <td className="py-1.5 pr-3">{r.currentDesk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-small text-text-muted">No change of professional has been requested on this file.</p>
          )}
        </CardContent>
      </Card>

      <EngagementHistory engagements={data.engagements} />

      {open && <RequestDialog data={data} currentName={active?.name ?? ''} onClose={() => setOpen(false)} onDone={reload} />}
    </div>
  );
}

function RequestDialog({
  data,
  currentName,
  onClose,
  onDone,
}: {
  data: ApplicationProfessionalPayload;
  currentName: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [proposed, setProposed] = React.useState('');
  const [requestDate, setRequestDate] = React.useState(dayValue(0));
  const [reason, setReason] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<ProfessionalChangeDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<ProfessionalChangeDocumentKind[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const haveRequired = REQUIRED_AT_REQUEST.every((k) => files[k] || demo.includes(k));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('proposedProfessionalId', proposed);
      form.set('requestDate', requestDate);
      form.set('reason', reason);
      for (const [kind, file] of Object.entries(files)) if (file) form.set(`doc_${kind}`, file);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      const result = await postForm<{ message: string }>(`/api/applications/${data.application.id}/professional-change`, form);
      toast.success('Change of professional registered', { description: result.message });
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The request could not be registered.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Register change of professional — {data.application.applicationNumber}</DialogTitle>
          <DialogDescription>
            On receipt of the owner’s letter. {currentName ? `${currentName} continues to hold the file` : 'The current professional continues'} until the request is
            approved; the file itself does not move.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current professional" htmlFor="pc-current">
              <Input id="pc-current" value={currentName} disabled />
            </Field>
            <Field label="Proposed professional" htmlFor="pc-proposed" required error={errors.proposedProfessionalId}>
              <select id="pc-proposed" className={`${selectClass} w-full`} value={proposed} onChange={(e) => setProposed(e.target.value)}>
                <option value="">{data.professionals.length ? 'Choose from the professional register…' : 'No professional in the register is approved and in force'}</option>
                {data.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.registrationNumber} · {p.typeLabel} · licence {p.licenceNo}
                    {p.firmName ? ` (${p.firmName})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Owner" htmlFor="pc-owner">
              <Input id="pc-owner" value={data.application.owner} disabled />
            </Field>
            <Field label="Request date" htmlFor="pc-date" required error={errors.requestDate} hint="The date on the owner’s letter.">
              <Input id="pc-date" type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="pc-reason" required error={errors.reason} hint="Why the owner wants the change, as the letter states it.">
            <Textarea id="pc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DocumentInputs
            files={files}
            setFiles={setFiles}
            demoAllowed={data.permissions.demoDocumentAllowed}
            demo={demo}
            setDemo={setDemo}
            demoLabel="Demo placeholder"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || !proposed || reason.trim().length < 10 || !haveRequired}>
            Register request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
