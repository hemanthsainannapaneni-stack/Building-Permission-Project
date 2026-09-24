'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, MapPin, Landmark, Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

// ── Types ─────────────────────────────────────────────────────────────────

export type DeptRow = { id: string; code: string; name: string; isActive: boolean; _count: { users: number; offices: number } };
export type ZoneRow = { id: string; code: string; name: string; isActive: boolean; _count: { offices: number; applications: number } };
export type OfficeRow = {
  id: string; code: string; name: string; address: string; isActive: boolean;
  departmentId: string | null; zoneId: string | null;
  department: { id: string; name: string } | null;
  zone: { id: string; code: string; name: string } | null;
  _count: { users: number };
};

// ── Schemas ────────────────────────────────────────────────────────────────

const deptSchema = z.object({ code: z.string().min(1, 'Code is required').max(20), name: z.string().min(2, 'Name is required').max(100) });
const zoneSchema = z.object({ code: z.string().min(1, 'Code is required').max(20), name: z.string().min(2, 'Name is required').max(100) });
const officeSchema = z.object({
  code: z.string().min(1, 'Code is required').max(20),
  name: z.string().min(2, 'Name is required').max(100),
  departmentId: z.string().optional().nullable(),
  zoneId: z.string().optional().nullable(),
  address: z.string().optional(),
});

// ── Small shared dialog utilities ─────────────────────────────────────────

async function apiFetch(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPARTMENTS TAB
// ═══════════════════════════════════════════════════════════════════════════

function DeptDialog({ open, onClose, onSaved, editing }: {
  open: boolean; onClose: () => void; onSaved: () => void; editing: DeptRow | null;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(deptSchema) });
  React.useEffect(() => { if (open) reset(editing ? { code: editing.code, name: editing.name } : { code: '', name: '' }); }, [open, editing, reset]);
  async function onSubmit(values: z.infer<typeof deptSchema>) {
    try {
      if (editing) await apiFetch(`/api/admin/organisation/departments/${editing.id}`, 'PATCH', values);
      else await apiFetch('/api/admin/organisation/departments', 'POST', values);
      toast.success(editing ? 'Department updated.' : 'Department created.');
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
  }
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Department' : 'New Department'}</DialogTitle>
            <DialogDescription>Departments group offices and staff.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Code" error={errors.code?.message?.toString()}>
              <Input {...register('code')} placeholder="e.g. TOWN_PLANNING" className="uppercase" />
            </Field>
            <Field label="Name" error={errors.name?.message?.toString()}>
              <Input {...register('name')} placeholder="e.g. Town Planning Department" />
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

function DepartmentsTab({ initial }: { initial: DeptRow[] }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [dialog, setDialog] = React.useState<'create' | DeptRow | null>(null);

  async function reload() { const d = await apiFetch('/api/admin/organisation/departments', 'GET'); setData(d); router.refresh(); }
  async function remove(row: DeptRow) {
    if (!confirm(`Delete department "${row.name}"? This cannot be undone.`)) return;
    try { await apiFetch(`/api/admin/organisation/departments/${row.id}`, 'DELETE'); toast.success('Department deleted.'); reload(); }
    catch (e) { toast.error('Cannot delete', { description: (e as Error).message }); }
  }
  async function toggle(row: DeptRow) {
    try { await apiFetch(`/api/admin/organisation/departments/${row.id}`, 'PATCH', { isActive: !row.isActive }); reload(); }
    catch (e) { toast.error('Could not toggle', { description: (e as Error).message }); }
  }

  const columns: ColumnDef<DeptRow, unknown>[] = [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <Badge tone="outline" className="font-mono">{getValue() as string}</Badge> },
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'offices', header: 'Offices', cell: ({ row }) => <span className="tabular-nums">{row.original._count.offices}</span> },
    { id: 'users', header: 'Staff', cell: ({ row }) => <span className="tabular-nums">{row.original._count.users}</span> },
    {
      id: 'status', header: 'Status',
      cell: ({ row }) => <Badge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => toggle(row.original)} title={row.original.isActive ? 'Deactivate' : 'Activate'}>
            {row.original.isActive ? <ToggleLeft className="size-3.5" /> : <ToggleRight className="size-3.5" />}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDialog(row.original)}><Pencil className="size-3.5" /></Button>
          <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove(row.original)}><Trash2 className="size-3.5" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setDialog('create')}><Plus className="size-3.5" /> New Department</Button>
      </div>
      <DataTable columns={columns} data={data} emptyTitle="No departments" emptyDescription="Create your first department to get started." />
      <DeptDialog
        open={dialog !== null}
        editing={dialog !== null && dialog !== 'create' ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); reload(); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONES TAB
// ═══════════════════════════════════════════════════════════════════════════

function ZoneDialog({ open, onClose, onSaved, editing }: {
  open: boolean; onClose: () => void; onSaved: () => void; editing: ZoneRow | null;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(zoneSchema) });
  React.useEffect(() => { if (open) reset(editing ? { code: editing.code, name: editing.name } : { code: '', name: '' }); }, [open, editing, reset]);
  async function onSubmit(values: z.infer<typeof zoneSchema>) {
    try {
      if (editing) await apiFetch(`/api/admin/organisation/zones/${editing.id}`, 'PATCH', values);
      else await apiFetch('/api/admin/organisation/zones', 'POST', values);
      toast.success(editing ? 'Zone updated.' : 'Zone created.');
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
  }
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Zone' : 'New Zone'}</DialogTitle>
            <DialogDescription>Zones define geographic jurisdiction boundaries.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Code" error={errors.code?.message?.toString()}>
              <Input {...register('code')} placeholder="e.g. NORTH" className="uppercase" />
            </Field>
            <Field label="Name" error={errors.name?.message?.toString()}>
              <Input {...register('name')} placeholder="e.g. North Zone" />
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

function ZonesTab({ initial }: { initial: ZoneRow[] }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [dialog, setDialog] = React.useState<'create' | ZoneRow | null>(null);

  async function reload() { const d = await apiFetch('/api/admin/organisation/zones', 'GET'); setData(d); router.refresh(); }
  async function remove(row: ZoneRow) {
    if (!confirm(`Delete zone "${row.name}"?`)) return;
    try { await apiFetch(`/api/admin/organisation/zones/${row.id}`, 'DELETE'); toast.success('Zone deleted.'); reload(); }
    catch (e) { toast.error('Cannot delete', { description: (e as Error).message }); }
  }
  async function toggle(row: ZoneRow) {
    try { await apiFetch(`/api/admin/organisation/zones/${row.id}`, 'PATCH', { isActive: !row.isActive }); reload(); }
    catch (e) { toast.error('Could not toggle', { description: (e as Error).message }); }
  }

  const columns: ColumnDef<ZoneRow, unknown>[] = [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <Badge tone="outline" className="font-mono">{getValue() as string}</Badge> },
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'offices', header: 'Offices', cell: ({ row }) => <span className="tabular-nums">{row.original._count.offices}</span> },
    { id: 'applications', header: 'Applications', cell: ({ row }) => <span className="tabular-nums">{row.original._count.applications}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <Badge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => toggle(row.original)} title={row.original.isActive ? 'Deactivate' : 'Activate'}>
            {row.original.isActive ? <ToggleLeft className="size-3.5" /> : <ToggleRight className="size-3.5" />}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDialog(row.original)}><Pencil className="size-3.5" /></Button>
          <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove(row.original)}><Trash2 className="size-3.5" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setDialog('create')}><Plus className="size-3.5" /> New Zone</Button>
      </div>
      <DataTable columns={columns} data={data} emptyTitle="No zones" emptyDescription="Create your first zone to get started." />
      <ZoneDialog
        open={dialog !== null}
        editing={dialog !== null && dialog !== 'create' ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); reload(); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OFFICES TAB
// ═══════════════════════════════════════════════════════════════════════════

function OfficeDialog({ open, onClose, onSaved, editing, departments, zones }: {
  open: boolean; onClose: () => void; onSaved: () => void; editing: OfficeRow | null;
  departments: DeptRow[]; zones: ZoneRow[];
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setValue } = useForm({ resolver: zodResolver(officeSchema) });
  React.useEffect(() => {
    if (open) reset(editing
      ? { code: editing.code, name: editing.name, departmentId: editing.departmentId ?? '', zoneId: editing.zoneId ?? '', address: editing.address }
      : { code: '', name: '', departmentId: '', zoneId: '', address: '' }
    );
  }, [open, editing, reset]);

  async function onSubmit(values: z.infer<typeof officeSchema>) {
    try {
      const payload = { ...values, departmentId: values.departmentId || null, zoneId: values.zoneId || null };
      if (editing) await apiFetch(`/api/admin/organisation/offices/${editing.id}`, 'PATCH', payload);
      else await apiFetch('/api/admin/organisation/offices', 'POST', payload);
      toast.success(editing ? 'Office updated.' : 'Office created.');
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Office' : 'New Office'}</DialogTitle>
            <DialogDescription>Offices are physical locations within departments and zones.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Code" error={errors.code?.message?.toString()}>
                <Input {...register('code')} placeholder="e.g. HO_NORTH" className="uppercase" />
              </Field>
              <Field label="Name" error={errors.name?.message?.toString()}>
                <Input {...register('name')} placeholder="e.g. Head Office - North" />
              </Field>
            </div>
            <Field label="Department">
              <Select onValueChange={(v) => setValue('departmentId', v)} defaultValue={editing?.departmentId ?? ''}>
                <SelectTrigger><SelectValue placeholder="Select department…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Zone">
              <Select onValueChange={(v) => setValue('zoneId', v)} defaultValue={editing?.zoneId ?? ''}>
                <SelectTrigger><SelectValue placeholder="Select zone…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.code} — {z.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Address">
              <Input {...register('address')} placeholder="Street address (optional)" />
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

function OfficesTab({ initial, departments, zones }: { initial: OfficeRow[]; departments: DeptRow[]; zones: ZoneRow[] }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [dialog, setDialog] = React.useState<'create' | OfficeRow | null>(null);

  async function reload() { const d = await apiFetch('/api/admin/organisation/offices', 'GET'); setData(d); router.refresh(); }
  async function remove(row: OfficeRow) {
    if (!confirm(`Delete office "${row.name}"?`)) return;
    try { await apiFetch(`/api/admin/organisation/offices/${row.id}`, 'DELETE'); toast.success('Office deleted.'); reload(); }
    catch (e) { toast.error('Cannot delete', { description: (e as Error).message }); }
  }

  const columns: ColumnDef<OfficeRow, unknown>[] = [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <Badge tone="outline" className="font-mono">{getValue() as string}</Badge> },
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'department', header: 'Department', cell: ({ row }) => <span className="text-text-muted">{row.original.department?.name ?? '—'}</span> },
    { id: 'zone', header: 'Zone', cell: ({ row }) => row.original.zone ? <Badge tone="outline" className="font-mono">{row.original.zone.code}</Badge> : <span className="text-text-muted">—</span> },
    { id: 'staff', header: 'Staff', cell: ({ row }) => <span className="tabular-nums">{row.original._count.users}</span> },
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
        <Button variant="primary" size="sm" onClick={() => setDialog('create')}><Plus className="size-3.5" /> New Office</Button>
      </div>
      <DataTable columns={columns} data={data} emptyTitle="No offices" emptyDescription="Create your first office to get started." />
      <OfficeDialog
        open={dialog !== null}
        editing={dialog !== null && dialog !== 'create' ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); reload(); }}
        departments={departments}
        zones={zones}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT PANEL
// ═══════════════════════════════════════════════════════════════════════════

export function OrganisationPanel({ departments, zones, offices }: {
  departments: DeptRow[];
  zones: ZoneRow[];
  offices: OfficeRow[];
}) {
  return (
    <Tabs defaultValue="zones">
      <TabsList>
        <TabsTrigger value="zones"><MapPin className="size-3.5" /> Zones</TabsTrigger>
        <TabsTrigger value="departments"><Building2 className="size-3.5" /> Departments</TabsTrigger>
        <TabsTrigger value="offices"><Landmark className="size-3.5" /> Offices</TabsTrigger>
      </TabsList>
      <TabsContent value="zones" className="mt-4"><ZonesTab initial={zones} /></TabsContent>
      <TabsContent value="departments" className="mt-4"><DepartmentsTab initial={departments} /></TabsContent>
      <TabsContent value="offices" className="mt-4"><OfficesTab initial={offices} departments={departments} zones={zones} /></TabsContent>
    </Tabs>
  );
}
