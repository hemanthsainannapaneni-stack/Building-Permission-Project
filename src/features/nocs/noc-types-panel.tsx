'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';

export type NocTypeRow = {
  id: string;
  code: string;
  name: string;
  authority: string;
  description: string;
  documentTypeCode: string;
  suggestedByChecklistItems: number[];
  requiresExpiry: boolean;
  isActive: boolean;
  nocCount: number;
};

/** One row per NOC kind: on/off, name, usual authority, whether it carries an expiry. */
export function NocTypesPanel({ initial }: { initial: NocTypeRow[] }) {
  const [rows, setRows] = React.useState(initial);

  const save = async (id: string, patch: Partial<Pick<NocTypeRow, 'name' | 'authority' | 'isActive' | 'requiresExpiry'>>) => {
    try {
      const next = await api.patch<NocTypeRow>(`/api/admin/noc-types/${id}`, patch);
      setRows((r) => r.map((row) => (row.id === id ? { ...row, ...next, nocCount: row.nocCount } : row)));
      toast.success(`${next.name} saved`);
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'Could not save.');
    }
  };

  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <TypeRow key={row.id} row={row} onSave={(patch) => save(row.id, patch)} />
      ))}
    </div>
  );
}

function TypeRow({
  row,
  onSave,
}: {
  row: NocTypeRow;
  onSave: (patch: Partial<Pick<NocTypeRow, 'name' | 'authority' | 'isActive' | 'requiresExpiry'>>) => Promise<void>;
}) {
  const [name, setName] = React.useState(row.name);
  const [authority, setAuthority] = React.useState(row.authority);
  const dirty = name !== row.name || authority !== row.authority;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <Switch checked={row.isActive} onCheckedChange={(v) => onSave({ isActive: v })} aria-label={`${row.name} in use`} />
          <Badge tone={row.isActive ? 'success' : 'outline'}>{row.isActive ? 'In use' : 'Off'}</Badge>
        </div>
        <code className="w-32 text-caption text-text-muted">{row.code}</code>
        <Input className="w-56" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <Input className="min-w-[16rem] flex-1" value={authority} onChange={(e) => setAuthority(e.target.value)} aria-label="Usual authority" placeholder="Usual issuing authority" />
        <label className="flex items-center gap-1.5 text-small text-text-muted">
          <Switch checked={row.requiresExpiry} onCheckedChange={(v) => onSave({ requiresExpiry: v })} aria-label="Carries an expiry date" />
          Expiry date
        </label>
        <span className="text-caption text-text-muted">
          {row.nocCount} on file{row.suggestedByChecklistItems.length ? ` · hint: checklist Q${row.suggestedByChecklistItems.join(', Q')}` : ''}
        </span>
        {dirty && (
          <Button size="sm" variant="primary" onClick={() => onSave({ name, authority })}>
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
