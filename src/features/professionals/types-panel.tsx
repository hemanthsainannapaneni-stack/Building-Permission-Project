'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { api } from '@/features/applications/api';
import { reportError } from '@/features/proceedings/shared';
import type { ProfessionalTypeAdminRow } from './types';

type Draft = { code: string; label: string; prefix: string; body: string; canHoldFile: boolean; structural: boolean };
const BLANK: Draft = { code: '', label: '', prefix: '', body: '', canHoldFile: false, structural: false };

/** The professional types: switch on or off, re-label, re-prefix, and add new ones. Every change is audited. */
export function ProfessionalTypesPanel({ initial }: { initial: ProfessionalTypeAdminRow[] }) {
  const [rows, setRows] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>(BLANK);
  const [busy, setBusy] = React.useState<string | null>(null);
  const reload = async () => setRows(await api.get<ProfessionalTypeAdminRow[]>('/api/admin/professional-types'));

  const patch = async (row: ProfessionalTypeAdminRow, change: Partial<Draft & { isActive: boolean }>) => {
    setBusy(row.id);
    try {
      await api.patch(`/api/admin/professional-types/${row.id}`, change);
      toast.success(`${row.label} updated`);
      await reload();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    setBusy('new');
    try {
      await api.post('/api/admin/professional-types', { ...draft, isActive: true });
      toast.success(`${draft.label} added`);
      setDraft(BLANK);
      await reload();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full min-w-[44rem] text-small">
            <thead>
              <tr className="border-b border-border text-left text-caption text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 font-medium">Prefix</th>
                <th className="py-1.5 pr-3 font-medium">Usual registration body</th>
                <th className="py-1.5 pr-3 font-medium">Holds files</th>
                <th className="py-1.5 pr-3 font-medium">Structural</th>
                <th className="py-1.5 pr-3 font-medium">In use</th>
                <th className="py-1.5 pr-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-text">{r.label}</span>
                    <span className="block font-mono text-caption text-text-muted">{r.code}</span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{r.prefix}</td>
                  <td className="py-1.5 pr-3 text-text-muted">{r.body || '—'}</td>
                  <td className="py-1.5 pr-3">
                    <Checkbox aria-label={`${r.label} holds files`} checked={r.canHoldFile} disabled={busy === r.id} onChange={(e) => patch(r, { canHoldFile: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Checkbox aria-label={`${r.label} is structural`} checked={r.structural} disabled={busy === r.id} onChange={(e) => patch(r, { structural: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Button size="sm" variant={r.isActive ? 'secondary' : 'ghost'} disabled={busy === r.id} onClick={() => patch(r, { isActive: !r.isActive })}>
                      {r.isActive ? 'In use — switch off' : 'Off — switch on'}
                    </Button>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge tone="outline">{r.registrations}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add a professional type</CardTitle>
          <CardDescription>A switched-off type keeps its registrations; it simply accepts no new ones.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input aria-label="Code" placeholder="CODE (e.g. LANDSCAPE_ARCHITECT)" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
          <Input aria-label="Name" placeholder="Name" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <Input aria-label="Prefix" placeholder="Number prefix (2–5 letters)" maxLength={5} value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value.toUpperCase() })} />
          <Input aria-label="Usual registration body" placeholder="Usual registration body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <label className="flex items-center gap-2 text-small">
            <Checkbox checked={draft.canHoldFile} onChange={(e) => setDraft({ ...draft, canHoldFile: e.target.checked })} /> May hold files
          </label>
          <label className="flex items-center gap-2 text-small">
            <Checkbox checked={draft.structural} onChange={(e) => setDraft({ ...draft, structural: e.target.checked })} /> Structural engineer
          </label>
          <div className="lg:col-span-2 lg:text-right">
            <Button onClick={add} loading={busy === 'new'} disabled={!draft.code || !draft.label || !draft.prefix || busy !== null}>
              <Plus className="size-4" /> Add type
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
