'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
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
  OUTWARD_DOCUMENT_LABEL,
  OUTWARD_DOCUMENT_TYPES,
  OUTWARD_MODE_LABEL,
  OUTWARD_STATUSES,
  OUTWARD_STATUS_LABEL,
  SYSTEM_GENERATED_TYPES,
  type OutwardDocumentType,
  type OutwardMode,
} from '@/lib/outward';
import { DocLink, fmtShort, reportError, selectClass, useRegister } from './shared';
import type { OutwardRow, Paged } from './types';

export type OutwardFilters = { q: string; status: string; documentType: string };
export const EMPTY_OUTWARD_FILTERS: OutwardFilters = { q: '', status: '', documentType: '' };

const docLabel = (t: string) => OUTWARD_DOCUMENT_LABEL[t as OutwardDocumentType] ?? t;
const modeLabel = (m: string) => (m ? OUTWARD_MODE_LABEL[m as OutwardMode] ?? m : '—');

/** The Outward register — every document that left, or is about to leave, the office. */
export function OutwardRegister({
  initial,
  initialFilters = EMPTY_OUTWARD_FILTERS,
  canManage,
}: {
  initial: Paged<OutwardRow>;
  initialFilters?: OutwardFilters;
  canManage: boolean;
}) {
  const router = useRouter();
  const r = useRegister<OutwardRow, OutwardFilters>('/api/outward', initial, initialFilters);
  const [creating, setCreating] = React.useState(false);

  const columns = React.useMemo<ColumnDef<OutwardRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Outward Number',
        cell: ({ row }) => (
          <Link href={`/outward/${row.original.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.original.outwardNumber}
          </Link>
        ),
      },
      {
        id: 'file',
        header: 'Application / File',
        cell: ({ row }) =>
          row.original.application ? (
            <Link href={`/applications/${row.original.application.id}?tab=proceedings`} className="whitespace-nowrap text-text hover:underline">
              {row.original.application.applicationNumber}
            </Link>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'type',
        header: 'Document Type',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {docLabel(row.original.documentType)}
            {row.original.documentReference && <span className="block text-caption text-text-muted">{row.original.documentReference}</span>}
          </span>
        ),
      },
      {
        id: 'recipient',
        header: 'Recipient',
        cell: ({ row }) => (
          <span className="block max-w-[12rem] truncate text-small" title={row.original.address}>
            {row.original.recipient}
          </span>
        ),
      },
      {
        id: 'assigned',
        header: 'Assigned Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.assignedDate)}</span>,
      },
      {
        id: 'dispatch',
        header: 'Dispatch Date',
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-text-muted">{fmtShort(row.original.dispatchDate)}</span>,
      },
      {
        id: 'mode',
        header: 'Mode',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-small">
            {modeLabel(row.original.mode)}
            {row.original.trackingNumber && <span className="block text-caption text-text-muted">{row.original.trackingNumber}</span>}
          </span>
        ),
      },
      {
        id: 'delivery',
        header: 'Delivery Status',
        cell: ({ row }) => <span className="whitespace-nowrap text-small">{row.original.deliveryStatus}</span>,
      },
      {
        id: 'ack',
        header: 'Acknowledgement',
        cell: ({ row }) =>
          row.original.acknowledgementDate ? (
            <span className="block max-w-[12rem] text-small" title={row.original.acknowledgement}>
              {fmtShort(row.original.acknowledgementDate)}
              <span className="block truncate text-caption text-text-muted">{row.original.acknowledgement}</span>
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge kind="outward" status={row.original.status} /> },
      {
        id: 'doc',
        header: 'Document',
        cell: ({ row }) => <DocLink href={`/api/outward/${row.original.id}/document`}>Preview</DocLink>,
      },
    ],
    []
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search by outward number, document reference, recipient, tracking or application"
          placeholder="Search outward, reference, recipient…"
          className="w-64"
          value={r.search}
          onChange={(e) => r.setSearch(e.target.value)}
        />
        <select aria-label="Document type" className={selectClass} value={r.filters.documentType} onChange={(e) => r.update({ documentType: e.target.value })}>
          <option value="">All documents</option>
          {OUTWARD_DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {OUTWARD_DOCUMENT_LABEL[t]}
            </option>
          ))}
        </select>
        <select aria-label="Status" className={selectClass} value={r.filters.status} onChange={(e) => r.update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="PENDING">Not yet dispatched</option>
          {OUTWARD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OUTWARD_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {r.active && (
          <Button variant="ghost" size="sm" onClick={r.reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="outline">
            {r.data.total} {r.data.total === 1 ? 'entry' : 'entries'}
          </Badge>
          {canManage && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus /> Create
            </Button>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={r.data.rows}
        loading={r.loading}
        emptyTitle={r.active ? 'Nothing matches those filters' : 'Nothing in Outward yet'}
        emptyDescription={r.active ? 'Try widening the filters.' : 'Show cause notices and revocation orders arrive here when they are generated.'}
      />
      <Pagination
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        totalPages={r.data.totalPages}
        onPageChange={r.setPage}
        disabled={r.loading}
        noun="entry"
      />
      {creating && (
        <CreateOutwardDialog
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            router.push(`/outward/${id}`);
          }}
        />
      )}
    </div>
  );
}

const MANUAL_TYPES = OUTWARD_DOCUMENT_TYPES.filter((t) => !(SYSTEM_GENERATED_TYPES as readonly string[]).includes(t));

/** Enter a document by hand. Notices and orders are never entered here — they arrive on their own. */
export function CreateOutwardDialog({
  onClose,
  onDone,
  application = '',
}: {
  onClose: () => void;
  onDone: (id: string) => void;
  application?: string;
}) {
  const [form, setForm] = React.useState({
    application,
    documentType: 'BPO' as string,
    documentReference: '',
    subject: '',
    recipient: '',
    address: '',
    remarks: '',
    readyForDispatch: true,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const row = await api.post<{ id: string; outwardNumber: string }>('/api/outward', form);
      toast.success(`${row.outwardNumber} created`);
      onDone(row.id);
    } catch (error) {
      setErrors(reportError(error, 'The entry could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create outward entry</DialogTitle>
          <DialogDescription>
            A BPO, a letter or another document leaving the office. The recipient and address default to the file’s owner.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Document type" htmlFor="ow-type" required error={errors.documentType}>
              <select id="ow-type" className={`${selectClass} w-full`} value={form.documentType} onChange={set('documentType')}>
                {MANUAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OUTWARD_DOCUMENT_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Application number"
              htmlFor="ow-app"
              required={form.documentType !== 'OTHER'}
              error={errors.application}
              hint={form.documentType === 'OTHER' ? 'Optional for Other.' : undefined}
            >
              <Input id="ow-app" value={form.application} onChange={set('application')} placeholder="BP/2026/000001" />
            </Field>
          </div>
          <Field
            label="Document reference"
            htmlFor="ow-ref"
            error={errors.documentReference}
            hint={form.documentType === 'BPO' ? 'Left blank, the file’s BPO number is used.' : 'The number printed on the document.'}
          >
            <Input id="ow-ref" value={form.documentReference} onChange={set('documentReference')} />
          </Field>
          <Field label="Subject" htmlFor="ow-subject">
            <Input id="ow-subject" value={form.subject} onChange={set('subject')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recipient" htmlFor="ow-rec" error={errors.recipient}>
              <Input id="ow-rec" value={form.recipient} onChange={set('recipient')} placeholder="Defaults to the owner" />
            </Field>
            <Field label="Address" htmlFor="ow-addr">
              <Input id="ow-addr" value={form.address} onChange={set('address')} placeholder="Defaults to the owner’s" />
            </Field>
          </div>
          <Field label="Remarks" htmlFor="ow-remarks">
            <Textarea id="ow-remarks" rows={2} value={form.remarks} onChange={set('remarks')} />
          </Field>
          <label className="flex items-center gap-2 text-small">
            <Checkbox checked={form.readyForDispatch} onChange={(e) => setForm((f) => ({ ...f, readyForDispatch: e.target.checked }))} />
            Ready for dispatch now (otherwise saved as Draft)
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
