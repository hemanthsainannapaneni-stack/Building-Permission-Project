'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, FileCheck2, HardHat, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  COMMENCEMENT_DOCUMENTS,
  COMMENCEMENT_DOCUMENT_LABEL,
  REQUIRED_COMMENCEMENT_DOCUMENTS,
  type CommencementDocumentKind,
} from '@/lib/commencement';
import { cn } from '@/lib/utils';
import { DocLink, Item, Prose, dayValue, fmtDate, postForm, reportError } from '@/features/proceedings/shared';
import type { ApplicationCommencementPayload } from './types';

/**
 * One file after approval: the proceeding it works under, the plan and the
 * scrutiny report that proceeding approved, and the commencement notice.
 * Rendered on the Work Initiated detail page and as the application's tab.
 */
export function CommencementPanel({ initial, showApplicationLink }: { initial: ApplicationCommencementPayload; showApplicationLink?: boolean }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const offer = data.permissions.notify;
  const wc = data.commencement;

  const reload = async () => {
    setOpen(false);
    setData(await api.get<ApplicationCommencementPayload>(`/api/applications/${data.application.id}/work-commencement`));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <HardHat className="size-4" /> Post approval <StatusBadge kind="commencement" status={data.state} />
            </CardTitle>
            <CardDescription>
              {showApplicationLink ? (
                <Link href={`/applications/${data.application.id}?tab=commencement`} className="text-primary hover:underline">
                  {data.application.applicationNumber}
                </Link>
              ) : (
                data.application.applicationNumber
              )}{' '}
              · {data.application.zone || 'No zone'} · <StatusBadge status={data.application.status} />
            </CardDescription>
          </div>
          {offer.offered &&
            (offer.available ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <HardHat className="size-4" /> Notify work commencement
              </Button>
            ) : (
              !wc && (
                <p className="flex max-w-sm items-start gap-1.5 text-caption text-text-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> {offer.reason}
                </p>
              )
            ))}
        </CardHeader>
        <CardContent className="space-y-4">
          <Path data={data} />
          {!offer.offered && !wc && data.blocker && (
            <p className="flex items-start gap-1.5 text-small text-text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {data.blocker}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Application">{data.application.applicationNumber}</Item>
            <Item label="Approved on">{fmtDate(data.application.approvedAt)}</Item>
            <Item label="Owner">{data.owner || '—'}</Item>
            <Item label="LTP">
              {wc?.ltpName || data.ltp.name} · {wc?.ltpLicenceNo || data.ltp.licenceNo || 'no licence'}
              {data.ltp.firmName ? ` · ${data.ltp.firmName}` : ''}
            </Item>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>BPO / Proceeding</CardTitle>
            <CardDescription>The building permission order the work is carried out under.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.order ? (
              <dl className="space-y-2 text-small">
                <Item label="Order number">
                  {data.order.downloadable ? (
                    <DocLink href={`/api/orders/${data.order.id}/pdf`}>{data.order.orderNumber}</DocLink>
                  ) : (
                    data.order.orderNumber
                  )}
                </Item>
                <Item label="Status">{data.order.status === 'ISSUED' ? 'Issued' : data.order.status.toLowerCase()}</Item>
                <Item label="Issued on">{data.order.status === 'ISSUED' ? fmtDate(data.order.issuedAt) : '—'}</Item>
                <Item label="Valid until">{fmtDate(data.order.validUntil)}</Item>
              </dl>
            ) : (
              <p className="text-small text-text-muted">No order has been drawn up for this file.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approved plan</CardTitle>
            <CardDescription>The drawings in force on the file — the plan the permission approved.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.approvedPlan.length ? (
              <ul className="space-y-1.5 text-small">
                {data.approvedPlan.map((v) => (
                  <li key={v.id}>
                    <DocLink href={`/api/drawings/versions/${v.id}/download`}>
                      {v.title} · v{v.versionNo}
                    </DocLink>
                    <span className="block text-caption text-text-muted">{v.fileName}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-text-muted">No drawing is on record.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scrutiny report</CardTitle>
            <CardDescription>The latest automated check of the approved drawing.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.scrutiny ? (
              <dl className="space-y-2 text-small">
                <Item label="Outcome">
                  <StatusBadge kind="outcome" status={data.scrutiny.outcome} />
                </Item>
                <Item label="Checks">
                  {data.scrutiny.checksPassed} of {data.scrutiny.checksRun} passed · {fmtDate(data.scrutiny.evaluatedAt)}
                </Item>
                <Item label="Report">
                  {data.scrutiny.hasReport ? (
                    <DocLink href={`/api/scrutiny/results/${data.scrutiny.id}/report`}>
                      Scrutiny report{data.scrutiny.isDemo ? ' (demo)' : ''}
                    </DocLink>
                  ) : (
                    '—'
                  )}
                </Item>
              </dl>
            ) : (
              <p className="text-small text-text-muted">No scrutiny result is on record.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="size-4" /> Commencement notification
          </CardTitle>
          <CardDescription>
            Given by the file’s technical professional on the owner’s behalf. Recorded as a step on the file’s workflow history; the file stays approved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {wc ? (
            <>
              <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
                <Item label="Notice number">{wc.commencementNumber}</Item>
                <Item label="Commencement date">{fmtDate(wc.commencementDate)}</Item>
                <Item label="Notification date">{fmtDate(wc.notifiedAt)}</Item>
                <Item label="Contractor">
                  {wc.contractor.name}
                  {wc.contractor.licenceNo ? ` · ${wc.contractor.licenceNo}` : ''}
                </Item>
                <Item label="Contractor contact">
                  {[wc.contractor.phone, wc.contractor.address].filter(Boolean).join(' · ') || '—'}
                </Item>
                <Item label="Notified by">
                  {wc.notifiedByName} ({wc.notifiedByRoleKey})
                  {wc.workflowStep ? ` · workflow step #${wc.workflowStep.sequence}` : ''}
                </Item>
                <Item label="Supporting documents" wide>
                  {wc.documents.length ? (
                    <ul className="space-y-0.5">
                      {wc.documents.map((d, i) => (
                        <li key={`${d.kind}-${i}`}>
                          <DocLink href={`/api/applications/${data.application.id}/work-commencement/document?index=${i}`}>
                            {COMMENCEMENT_DOCUMENT_LABEL[d.kind]}
                            {d.isDemo ? ' (demo placeholder)' : ` — ${d.fileName}`}
                          </DocLink>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'None'
                  )}
                </Item>
              </dl>
              {wc.remarks && <Prose label="Remarks">{wc.remarks}</Prose>}
            </>
          ) : (
            <p className="text-small text-text-muted">
              {data.state === 'PROCEEDING_ISSUED'
                ? 'The proceeding is issued. Commencement of work has not been notified yet.'
                : 'Commencement can be notified once the building permission order is issued.'}
            </p>
          )}
        </CardContent>
      </Card>

      {open && <NotifyDialog data={data} onClose={() => setOpen(false)} onDone={reload} />}
    </div>
  );
}

/** Approved → Proceeding issued → Work initiated → Commencement notified. */
function Path({ data }: { data: ApplicationCommencementPayload }) {
  const wc = data.commencement;
  const approved = Boolean(data.application.approvedAt) || data.application.status === 'APPROVED';
  const issued = data.order?.status === 'ISSUED';
  const started = data.state === 'WORK_INITIATED';
  const steps = [
    { label: 'Approved', done: approved, when: data.application.approvedAt },
    { label: 'Proceeding issued', done: issued, when: issued ? data.order!.issuedAt : null },
    { label: 'Work initiated', done: started, when: wc?.commencementDate ?? null, note: wc && !started ? 'scheduled' : '' },
    { label: 'Commencement notified', done: Boolean(wc), when: wc?.notifiedAt ?? null },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={cn('flex items-start gap-2 rounded border px-3 py-2', s.done ? 'border-success/40 bg-success/5' : 'border-border bg-surface-sunk')}
        >
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
              s.done ? 'bg-success text-white' : 'border border-border-strong text-text-muted'
            )}
          >
            {s.done ? <Check className="size-3" /> : i + 1}
          </span>
          <span>
            <span className="block text-small font-medium text-text">{s.label}</span>
            <span className="block text-caption text-text-muted">
              {s.when ? fmtDate(s.when) : '—'}
              {s.note ? ` · ${s.note}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function NotifyDialog({ data, onClose, onDone }: { data: ApplicationCommencementPayload; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = React.useState(dayValue(0));
  const [contractor, setContractor] = React.useState({ name: '', licenceNo: '', phone: '', address: '' });
  const [remarks, setRemarks] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<CommencementDocumentKind, File>>>({});
  const [demo, setDemo] = React.useState<CommencementDocumentKind[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const haveRequired = REQUIRED_COMMENCEMENT_DOCUMENTS.every((k) => files[k] || demo.includes(k));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('commencementDate', date);
      form.set('contractorName', contractor.name);
      form.set('contractorLicenceNo', contractor.licenceNo);
      form.set('contractorPhone', contractor.phone);
      form.set('contractorAddress', contractor.address);
      form.set('remarks', remarks);
      for (const [kind, file] of Object.entries(files)) if (file) form.set(`doc_${kind}`, file);
      if (demo.length) {
        form.set('demoDocuments', 'true');
        form.set('demoKinds', demo.join(','));
      }
      const result = await postForm<{ message: string }>(`/api/applications/${data.application.id}/work-commencement`, form);
      toast.success('Work commencement notified', { description: result.message });
      await onDone();
    } catch (error) {
      setErrors(reportError(error, 'The notice could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notify work commencement — {data.application.applicationNumber}</DialogTitle>
          <DialogDescription>
            Under {data.order?.orderNumber}. The date may be today or a date to come within the permission’s validity; the department and the owner are told
            either way.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Commencement date"
              htmlFor="wc-date"
              required
              error={errors.commencementDate}
              hint={`From ${fmtDate(data.order?.issuedAt)}${data.order?.validUntil ? ` to ${fmtDate(data.order.validUntil)}` : ''}.`}
            >
              <Input id="wc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Owner" htmlFor="wc-owner">
              <Input id="wc-owner" value={data.owner} disabled />
            </Field>
            <Field label="Contractor" htmlFor="wc-contractor" required error={errors.contractorName}>
              <Input id="wc-contractor" value={contractor.name} onChange={(e) => setContractor({ ...contractor, name: e.target.value })} />
            </Field>
            <Field label="Contractor licence / registration" htmlFor="wc-licence">
              <Input id="wc-licence" value={contractor.licenceNo} onChange={(e) => setContractor({ ...contractor, licenceNo: e.target.value })} />
            </Field>
            <Field label="Contractor phone" htmlFor="wc-phone">
              <Input id="wc-phone" value={contractor.phone} onChange={(e) => setContractor({ ...contractor, phone: e.target.value })} />
            </Field>
            <Field label="Contractor address" htmlFor="wc-address">
              <Input id="wc-address" value={contractor.address} onChange={(e) => setContractor({ ...contractor, address: e.target.value })} />
            </Field>
          </div>
          <Field label="Remarks" htmlFor="wc-remarks" hint="Anything the department should know — phasing, site office, hoarding.">
            <Textarea id="wc-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <div className="space-y-2">
            <p className="text-caption text-text-muted">Supporting documents — PDF or image, 10 MB each.</p>
            {COMMENCEMENT_DOCUMENTS.map((kind) => (
              <div key={kind} className="grid items-center gap-1 sm:grid-cols-[13rem_1fr]">
                <label htmlFor={`wc-doc-${kind}`} className="text-small text-text">
                  {COMMENCEMENT_DOCUMENT_LABEL[kind]}
                  {REQUIRED_COMMENCEMENT_DOCUMENTS.includes(kind) && <span className="text-danger"> *</span>}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id={`wc-doc-${kind}`}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="block max-w-[14rem] text-small"
                    onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] })}
                  />
                  {data.permissions.demoDocumentAllowed && !files[kind] && (
                    <label className="flex items-center gap-1.5 text-caption text-text-muted">
                      <Checkbox
                        checked={demo.includes(kind)}
                        onChange={(e) => setDemo(e.target.checked ? [...demo, kind] : demo.filter((k) => k !== kind))}
                      />
                      Demo placeholder
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || contractor.name.trim().length < 2 || !date || !haveRequired}>
            Notify commencement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
