'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Textarea } from '@/components/ui/textarea';

// ── Types ─────────────────────────────────────────────────────────────────

export type PermissionRow = { id: string; key: string; module: string; name: string; description: string };
export type RoleRow = {
  id: string; key: string; name: string; description: string; isSystem: boolean; rank: number;
  permissions: Array<{ permission: { id: string; key: string; module: string; name: string } }>;
  _count: { users: number };
};

// ── Schemas ────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  key: z.string().min(2).max(50),
  name: z.string().min(2).max(100),
  description: z.string().default(''),
  permissionKeys: z.array(z.string()).default([]),
});

/**
 * Two types, because `.default()` makes them genuinely different: the form
 * holds what the user has typed (where `description` may still be absent), and
 * the submit handler receives what the schema produced (where it never is).
 * Collapsing them is what made `zodResolver` refuse to type-check here.
 */
type RoleFormValues = z.input<typeof roleSchema>;
type RoleInput = z.output<typeof roleSchema>;

// ── Utilities ─────────────────────────────────────────────────────────────

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

// ── Permission matrix inside dialog ──────────────────────────────────────

function PermissionMatrix({ permissions, selected, onChange }: {
  permissions: PermissionRow[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const byModule = React.useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const p of permissions) {
      map.set(p.module, [...(map.get(p.module) ?? []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permissions]);

  function toggle(key: string) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  function toggleModule(modulePerms: PermissionRow[]) {
    const moduleKeys = modulePerms.map((p) => p.key);
    const allSelected = moduleKeys.every((k) => selected.includes(k));
    if (allSelected) onChange(selected.filter((k) => !moduleKeys.includes(k)));
    else onChange([...new Set([...selected, ...moduleKeys])]);
  }

  return (
    <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
      {byModule.map(([module, perms]) => {
        const moduleKeys = perms.map((p) => p.key);
        const allSelected = moduleKeys.every((k) => selected.includes(k));
        const someSelected = moduleKeys.some((k) => selected.includes(k));
        return (
          <div key={module}>
            <div className="flex items-center gap-2 pb-1 border-b border-border">
              <Checkbox
                id={`module-${module}`}
                checked={allSelected}
                data-indeterminate={someSelected && !allSelected ? true : undefined}
                onChange={() => toggleModule(perms)}
              />
              <label htmlFor={`module-${module}`} className="text-caption font-semibold uppercase tracking-wide text-text-subtle cursor-pointer">{module}</label>
            </div>
            <div className="pt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {perms.sort((a, b) => a.key.localeCompare(b.key)).map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Checkbox
                    id={`perm-${p.key}`}
                    checked={selected.includes(p.key)}
                    onChange={() => toggle(p.key)}
                  />
                  <span className="text-sm font-mono text-text-subtle">{p.key}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Role dialog ───────────────────────────────────────────────────────────

function RoleDialog({ open, onClose, onSaved, editing, permissions }: {
  open: boolean; onClose: () => void; onSaved: () => void;
  editing: RoleRow | null; permissions: PermissionRow[];
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting }, reset } = useForm<RoleFormValues, unknown, RoleInput>({
    resolver: zodResolver(roleSchema),
  });
  const selectedPerms = watch('permissionKeys') ?? [];

  React.useEffect(() => {
    if (open) {
      reset({
        key: editing?.key ?? '',
        name: editing?.name ?? '',
        description: editing?.description ?? '',
        permissionKeys: editing?.permissions.map((rp) => rp.permission.key) ?? [],
      });
    }
  }, [open, editing, reset]);

  async function onSubmit(values: RoleInput) {
    try {
      if (editing) {
        await apiFetch(`/api/admin/roles/${editing.id}`, 'PATCH', { name: values.name, description: values.description });
        await apiFetch(`/api/admin/roles/${editing.id}/permissions`, 'POST', { permissionKeys: values.permissionKeys });
      } else {
        await apiFetch('/api/admin/roles', 'POST', values);
      }
      toast.success(editing ? 'Role updated.' : 'Role created.');
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New Role'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the role name, description, and its permission set.' : 'Create a new role and assign its permissions.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Key" error={errors.key?.message?.toString()}>
                <Input {...register('key')} placeholder="e.g. FIELD_INSPECTOR" disabled={!!editing} className="uppercase" />
              </Field>
              <Field label="Display Name" error={errors.name?.message?.toString()}>
                <Input {...register('name')} placeholder="e.g. Field Inspector" />
              </Field>
            </div>
            <Field label="Description">
              <Textarea {...register('description')} placeholder="What does this role do?" rows={2} />
            </Field>
            <div>
              <p className="text-sm font-medium text-text mb-2">Permissions</p>
              <PermissionMatrix
                permissions={permissions}
                selected={selectedPerms}
                onChange={(keys) => setValue('permissionKeys', keys)}
              />
              <p className="mt-1 text-caption text-text-subtle">{selectedPerms.length} of {permissions.length} permissions selected</p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>Save role</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Root component ─────────────────────────────────────────────────────────

export function RoleEditor({ initialRoles, permissions }: { initialRoles: RoleRow[]; permissions: PermissionRow[] }) {
  const router = useRouter();
  const [roles, setRoles] = React.useState(initialRoles);
  const [dialog, setDialog] = React.useState<'create' | RoleRow | null>(null);

  async function reload() {
    const data = await apiFetch('/api/admin/roles', 'GET');
    setRoles(data.roles);
    router.refresh();
  }

  async function remove(role: RoleRow) {
    if (role.isSystem) { toast.error('System roles cannot be deleted.'); return; }
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try { await apiFetch(`/api/admin/roles/${role.id}`, 'DELETE'); toast.success('Role deleted.'); reload(); }
    catch (e) { toast.error('Cannot delete', { description: (e as Error).message }); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setDialog('create')}><Plus className="size-4" /> New Role</Button>
      </div>

      {roles.map((role) => {
        const byModule = new Map<string, string[]>();
        for (const { permission } of role.permissions) {
          const list = byModule.get(permission.module) ?? [];
          list.push(permission.key);
          byModule.set(permission.module, list);
        }

        return (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle>{role.name}</CardTitle>
                    {role.isSystem && <Badge tone="warning" className="text-[10px]">SYSTEM</Badge>}
                  </div>
                  <CardDescription>{role.description}</CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="outline" className="font-mono">{role.key}</Badge>
                  <Badge tone="info">{role._count.users} {role._count.users === 1 ? 'user' : 'users'}</Badge>
                  <Badge tone="neutral">{role.permissions.length} capabilities</Badge>
                  <Button size="xs" variant="secondary" onClick={() => setDialog(role)}><Pencil className="size-3" /> Edit</Button>
                  {!role.isSystem && (
                    <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove(role)}><Trash2 className="size-3" /></Button>
                  )}
                </div>
              </div>
            </CardHeader>
            {role.permissions.length > 0 && (
              <CardContent className="space-y-3">
                {[...byModule.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([module, keys]) => (
                  <div key={module}>
                    <p className="pb-1 text-caption font-semibold uppercase tracking-wide text-text-subtle">{module}</p>
                    <div className="flex flex-wrap gap-1">
                      {keys.sort().map((key) => (
                        <Badge key={key} tone="outline" className="font-mono text-[10px]">{key}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}

      <RoleDialog
        open={dialog !== null}
        editing={dialog !== null && dialog !== 'create' ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); reload(); }}
        permissions={permissions}
      />
    </div>
  );
}
