'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import {
  OUTWARD_ACTION_LABEL,
  OUTWARD_DOCUMENT_LABEL,
  OUTWARD_MODES,
  OUTWARD_MODE_LABEL,
  OUTWARD_STATUS_LABEL,
  type OutwardAction,
  type OutwardDocumentType,
  type OutwardMode,
  type OutwardStatus,
} from '@/lib/outward';
import { DocLink, HistoryCard, Item, Prose, dayValue, fmtDate, reportError, selectClass } from './shared';
import type { OutwardDetail } from './types';

const EVENT_LABEL: Record<string, string> = { CREATED: 'Created', ...OUTWARD_ACTION_LABEL };
const statusLabel = (s: string) => OUTWARD_STATUS_LABEL[s as OutwardStatus] ?? s;

/** One outward entry: the document, where it went, and what became of it. */
export function OutwardDetailView({ initial }: { initial: OutwardDetail }) {
  const router = useRouter();
  const [row, setRow] = React.useState(initial);
  const [action, setAction] = React.useState<OutwardAction | null>(null);
  const reload = async () => {
    setAction(null);
    setRow(await api.get<OutwardDetail>(`/api/outward/${row.id}`));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {OUTWARD_DOCUMENT_LABEL[row.documentType as OutwardDocumentType] ?? row.documentType}
              <StatusBadge kind="outward" status={row.status} />
            </CardTitle>
            <CardDescription>
              {row.application ? (
                <Link href={`/applications/${row.application.id}?tab=proceedings`} className="text-primary hover:underline">
                  {row.application.applicationNumber}
                </Link>
              ) : (
                'No application'
              )}{' '}
              · {row.subject || '—'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a href={`/api/outward/${row.id}/document`} target="_blank" rel="noreferrer">
                Preview
              </a>
            </Button>
            {(row.permissions.moves as OutwardAction[]).map((m) => (
              <Button
                key={m}
                variant={m === 'DISPATCH' || m === 'RECORD_ACKNOWLEDGEMENT' ? 'primary' : m === 'CANCEL' ? 'destructive' : 'secondary'}
                onClick={() => setAction(m)}
              >
                {OUTWARD_ACTION_LABEL[m]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Outward number">{row.outwardNumber}</Item>
            <Item label="Document reference">
              {row.sourceLink ? (
                <Link href={row.sourceLink} className="text-primary hover:underline">
                  {row.documentReference}
                </Link>
              ) : (
                row.documentReference || '—'
              )}
            </Item>
            <Item label="Document">
              <DocLink href={`/api/outward/${row.id}/document`}>Preview (demo)</DocLink>
            </Item>
            <Item label="Recipient">{row.recipient}</Item>
            <Item label="Address">{row.address || '—'}</Item>
            <Item label="Assigned date">{fmtDate(row.assignedDate)}</Item>
            <Item label="Dispatch date">{fmtDate(row.dispatchDate)}</Item>
            <Item label="Mode">{row.mode ? OUTWARD_MODE_LABEL[row.mode as OutwardMode] ?? row.mode : '—'}</Item>
            <Item label="Tracking number">{row.trackingNumber || '—'}</Item>
            <Item label="Delivery status">{row.deliveryStatus}</Item>
            <Item label="Delivered">{fmtDate(row.deliveredAt)}</Item>
            <Item label="Acknowledgement">
              {row.acknowledgementDate ? `${fmtDate(row.acknowledgementDate)} — ${row.acknowledgement}` : '—'}
            </Item>
            {row.returnedAt && (
              <Item label="Returned">
                {fmtDate(row.returnedAt)} — {row.returnReason}
              </Item>
            )}
            <Item label="Created by">{row.createdByName || '—'}</Item>
          </dl>
          {row.remarks && <Prose label="Remarks">{row.remarks}</Prose>}
        </CardContent>
      </Card>

      <HistoryCard events={row.events} label={EVENT_LABEL} statusLabel={statusLabel} />

      {action && <OutwardActionDialog row={row} action={action} onClose={() => setAction(null)} onDone={reload} />}
    </div>
  );
}

function OutwardActionDialog({
  row,
  action,
  onClose,
  onDone,
}: {
  row: OutwardDetail;
  action: OutwardAction;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [f, setF] = React.useState({
    mode: 'SPEED_POST' as OutwardMode,
    dispatchDate: dayValue(0),
    trackingNumber: '',
    deliveredAt: dayValue(0),
    acknowledgement: '',
    acknowledgementDate: dayValue(0),
    returnReason: '',
    remarks: '',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/api/outward/${row.id}/actions`, {
        action,
        ...(action === 'DISPATCH' ? { mode: f.mode, dispatchDate: f.dispatchDate, trackingNumber: f.trackingNumber } : {}),
        ...(action === 'RECORD_DELIVERY' ? { deliveredAt: f.deliveredAt } : {}),
        ...(action === 'RECORD_ACKNOWLEDGEMENT' ? { acknowledgement: f.acknowledgement, acknowledgementDate: f.acknowledgementDate } : {}),
        ...(action === 'RECORD_RETURN' ? { returnReason: f.returnReason } : {}),
        remarks: f.remarks,
        expectedStatus: row.status,
      });
      toast.success(`${row.outwardNumber}: ${OUTWARD_ACTION_LABEL[action]}`);
      await onDone();
    } catch (error) {
      setErrors(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {OUTWARD_ACTION_LABEL[action]} — {row.outwardNumber}
          </DialogTitle>
          <DialogDescription>
            {row.documentReference || row.documentType} to {row.recipient}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {action === 'DISPATCH' && (
            <>
              <Field label="Mode" htmlFor="ow-mode" required error={errors.mode}>
                <select id="ow-mode" className={`${selectClass} w-full`} value={f.mode} onChange={set('mode')}>
                  {OUTWARD_MODES.map((m) => (
                    <option key={m} value={m}>
                      {OUTWARD_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Dispatch date" htmlFor="ow-date" required error={errors.dispatchDate}>
                  <Input id="ow-date" type="date" value={f.dispatchDate} onChange={set('dispatchDate')} />
                </Field>
                <Field label="Tracking number" htmlFor="ow-track" error={errors.trackingNumber}>
                  <Input id="ow-track" value={f.trackingNumber} onChange={set('trackingNumber')} />
                </Field>
              </div>
            </>
          )}
          {action === 'RECORD_DELIVERY' && (
            <Field label="Delivered on" htmlFor="ow-del" required error={errors.deliveredAt}>
              <Input id="ow-del" type="date" value={f.deliveredAt} onChange={set('deliveredAt')} />
            </Field>
          )}
          {action === 'RECORD_ACKNOWLEDGEMENT' && (
            <>
              <Field label="Acknowledgement" htmlFor="ow-ack" required error={errors.acknowledgement} hint="Who acknowledged it, and how.">
                <Input id="ow-ack" value={f.acknowledgement} onChange={set('acknowledgement')} placeholder="Acknowledgement card signed by the owner" />
              </Field>
              <Field label="Acknowledgement date" htmlFor="ow-ackd" required error={errors.acknowledgementDate}>
                <Input id="ow-ackd" type="date" value={f.acknowledgementDate} onChange={set('acknowledgementDate')} />
              </Field>
            </>
          )}
          {action === 'RECORD_RETURN' && (
            <Field label="Why it came back" htmlFor="ow-ret" required error={errors.returnReason}>
              <Textarea id="ow-ret" rows={2} value={f.returnReason} onChange={set('returnReason')} />
            </Field>
          )}
          <Field label="Remarks" htmlFor="ow-rem" required={action === 'CANCEL'} error={errors.remarks}>
            <Textarea id="ow-rem" rows={2} value={f.remarks} onChange={set('remarks')} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={action === 'CANCEL' ? 'destructive' : 'primary'} onClick={submit} loading={busy}>
            {OUTWARD_ACTION_LABEL[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
