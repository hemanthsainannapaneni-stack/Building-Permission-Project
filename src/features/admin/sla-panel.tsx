'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

export type SlaRuleRow = {
  id: string;
  days: number;
  calendar: string;
  warnAtPercent: number;
  escalateToRoleKey: string | null;
  pauseOnShortfall: boolean;
  isActive: boolean;
  workflowStageId: string;
  applicationTypeId: string | null;
  stage: { id: string; code: string; name: string; sequence: number };
  applicationType: { id: string; name: string } | null;
};

export type SlaStage = { id: string; code: string; name: string };
export type SlaAppType = { id: string; name: string };

const schema = z.object({
  workflowStageId: z.string().min(1, 'Stage is required'),
  applicationTypeId: z.string().nullable().optional(),
  days: z.coerce.number().int().min(1, 'Must be at least 1 day'),
  calendar: z.string(),
  warnAtPercent: z.coerce.number().int().min(1).max(100),
  escalateToRoleKey: z.string().nullable().optional(),
  pauseOnShortfall: z.boolean().default(true),
});

async function apiFetch(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function SlaDialog({ open, onClose, onSaved, editing, stages, appTypes }: {
  open: boolean; onClose: () => void; onSaved: () => void;
  editing: SlaRuleRow | null; stages: SlaStage[]; appTypes: SlaAppType[];
}) {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema) });
  React.useEffect(() => {
    if (open) reset(editing
      ? { workflowStageId: editing.workflowStageId, applicationTypeId: editing.applicationTypeId ?? '', days: editing.days, calendar: editing.calendar, warnAtPercent: editing.warnAtPercent, escalateToRoleKey: editing.escalateToRoleKey ?? '', pauseOnShortfall: editing.pauseOnShortfall }
      : { workflowStageId: '', applicationTypeId: '', days: 10, calendar: 'WORKING_DAYS', warnAtPercent: 70, escalateToRoleKey: '', pauseOnShortfall: true }
    );
  }, [open, editing, reset]);

  async function onSubmit(values: z.infer<typeof schema>) {
    try {
      const payload = { ...values, applicationTypeId: values.applicationTypeId || null, escalateToRoleKey: values.escalateToRoleKey || null };
      if (editing) await apiFetch(`/api/admin/sla/${editing.id}`, 'PATCH', payload);
      else await apiFetch('/api/admin/sla', 'POST', payload);
      toast.success(editing ? 'SLA rule updated.' : 'SLA rule created.');
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit SLA Rule' : 'New SLA Rule'}</DialogTitle>
            <DialogDescription>Configure service-level agreement for a workflow stage.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Stage" error={errors.workflowStageId?.message?.toString()}>
              <Select onValueChange={(v) => setValue('workflowStageId', v)} defaultValue={editing?.workflowStageId ?? ''} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="Select stage…" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Application Type">
              <Select onValueChange={(v) => setValue('applicationTypeId', v || null)} defaultValue={editing?.applicationTypeId ?? ''}>
                <SelectTrigger><SelectValue placeholder="All types (global)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All application types</SelectItem>
                  {appTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Days" error={errors.days?.message?.toString()}>
                <Input {...register('days')} type="number" min={1} />
              </Field>
              <Field label="Calendar">
                <Select onValueChange={(v) => setValue('calendar', v)} defaultValue={editing?.calendar ?? 'WORKING_DAYS'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WORKING_DAYS">Working days</SelectItem>
                    <SelectItem value="CALENDAR">Calendar days</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Warn at (% elapsed)" error={errors.warnAtPercent?.message?.toString()}>
              <Input {...register('warnAtPercent')} type="number" min={1} max={100} />
            </Field>
            <Field label="Escalate to role key">
              <Input {...register('escalateToRoleKey')} placeholder="e.g. ZJD (optional)" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SlaPanel({ initialRules, stages, appTypes }: { initialRules: SlaRuleRow[]; stages: SlaStage[]; appTypes: SlaAppType[] }) {
  const router = useRouter();
  const [data, setData] = React.useState(initialRules);
  const [dialog, setDialog] = React.useState<'create' | SlaRuleRow | null>(null);

  async function reload() { const d = await apiFetch('/api/admin/sla', 'GET'); setData(d); router.refresh(); }
  async function remove(row: SlaRuleRow) {
    if (!confirm(`Delete SLA rule for "${row.stage.name}"?`)) return;
    try { await apiFetch(`/api/admin/sla/${row.id}`, 'DELETE'); toast.success('SLA rule deleted.'); reload(); }
    catch (e) { toast.error('Cannot delete', { description: (e as Error).message }); }
  }

  const columns: ColumnDef<SlaRuleRow, unknown>[] = [
    { id: 'stage', header: 'Stage', cell: ({ row }) => <span className="font-medium">{row.original.stage.name}</span> },
    { id: 'appType', header: 'App Type', cell: ({ row }) => <span className="text-text-muted">{row.original.applicationType?.name ?? 'All types'}</span> },
    { id: 'days', header: 'SLA', cell: ({ row }) => <span className="tabular-nums">{row.original.days} {row.original.calendar === 'WORKING_DAYS' ? 'working' : 'calendar'} days</span> },
    { id: 'warn', header: 'Warn at', cell: ({ row }) => <span className="tabular-nums">{row.original.warnAtPercent}%</span> },
    { id: 'escalate', header: 'Escalate to', cell: ({ row }) => <span className="text-text-muted font-mono">{row.original.escalateToRoleKey ?? '—'}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <Badge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setDialog(row.original)}><Pencil className="size-3.5" /></Button>
          <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove(row.original)}><Trash2 className="size-3.5" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setDialog('create')}><Plus className="size-3.5" /> New SLA Rule</Button>
      </div>
      <DataTable columns={columns} data={data} emptyTitle="No SLA rules" emptyDescription="Add SLA rules to track stage turnaround times." />
      <SlaDialog
        open={dialog !== null}
        editing={dialog !== null && dialog !== 'create' ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); reload(); }}
        stages={stages}
        appTypes={appTypes}
      />
    </div>
  );
}
