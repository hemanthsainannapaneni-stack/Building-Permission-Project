'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * Checklist configuration.
 *
 * Deliberately a table and a dialog rather than a form builder. The questions
 * are statutory: an administrator changes what one SAYS and how it behaves,
 * and does not add or remove them. Building a form builder for a fixed list of
 * nineteen and twenty-seven items would be a lot of machinery in service of an
 * operation nobody should perform.
 */

export type ChecklistRow = {
  id: string;
  kind: string;
  itemNumber: number;
  question: string;
  description: string;
  responseType: string;
  category: string;
  helpText: string;
  isMandatory: boolean;
  requiresDocument: boolean;
  affectsRisk: boolean;
  displayOrder: number;
  isActive: boolean;
  isProvisional: boolean;
  source: string;
};

const RESPONSE_TYPES = ['YES_NO', 'YES_NO_NA', 'TEXT', 'NUMBER', 'MEASUREMENT'] as const;

const RESPONSE_LABEL: Record<string, string> = {
  YES_NO: 'Yes / No',
  YES_NO_NA: 'Yes / No / NA',
  TEXT: 'Free text',
  NUMBER: 'Number',
  MEASUREMENT: 'Measurement',
};

export function ChecklistPanel({ items }: { items: ChecklistRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ChecklistRow | null>(null);

  const provisional = items.filter((i) => i.isProvisional).length;

  return (
    <div className="space-y-4">
      {provisional > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-bg/40 px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-small text-text">
            <p className="font-semibold">
              {provisional} of {items.length} questions carry provisional wording.
            </p>
            <p className="mt-0.5 text-text-muted">
              The BBAS manuals describe these checklists but do not reproduce the questions as
              text. The wording below was written from the subject areas the manuals name, and is
              not official. Replace it here when the manual figures are available, then mark the
              question official — no deployment is involved.
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="w-36">Category</TableHead>
              <TableHead className="w-32">Response</TableHead>
              <TableHead className="w-44">Flags</TableHead>
              <TableHead className="w-20 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className={cn(!item.isActive && 'opacity-55')}>
                <TableCell className="font-mono text-caption text-text-muted">
                  {item.itemNumber}
                </TableCell>
                <TableCell>
                  <p className="text-small text-text">{item.question}</p>
                  {item.helpText && (
                    <p className="mt-0.5 text-caption text-text-muted">{item.helpText}</p>
                  )}
                </TableCell>
                <TableCell className="text-caption text-text-muted">{item.category}</TableCell>
                <TableCell className="text-caption text-text-muted">
                  {RESPONSE_LABEL[item.responseType] ?? item.responseType}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.isProvisional && <Badge tone="warning">Provisional</Badge>}
                    {!item.isActive && <Badge tone="neutral">Inactive</Badge>}
                    {item.isMandatory && <Badge tone="info">Mandatory</Badge>}
                    {item.requiresDocument && <Badge tone="neutral">Document</Badge>}
                    {item.affectsRisk && <Badge tone="purple">Risk</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(item)}>
                    <Pencil className="size-3.5" />
                    <span className="sr-only">Edit question {item.itemNumber}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function EditDialog({
  item,
  onClose,
  onSaved,
}: {
  item: ChecklistRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<ChecklistRow | null>(item);
  const [markOfficial, setMarkOfficial] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setDraft(item);
    setMarkOfficial(false);
  }, [item]);

  if (!draft) return null;

  const set = <K extends keyof ChecklistRow>(key: K, value: ChecklistRow[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/checklists/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: draft.question,
          description: draft.description,
          responseType: draft.responseType,
          category: draft.category,
          helpText: draft.helpText,
          isMandatory: draft.isMandatory,
          requiresDocument: draft.requiresDocument,
          affectsRisk: draft.affectsRisk,
          displayOrder: draft.displayOrder,
          isActive: draft.isActive,
          ...(markOfficial ? { isProvisional: false as const } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not save the question.');
      toast.success(`Question ${draft.itemNumber} updated.`);
      onSaved();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Question {draft.itemNumber}</DialogTitle>
          <DialogDescription>
            {draft.isProvisional
              ? 'This wording is provisional. Replacing it here is all that is needed — nothing else in the system quotes it.'
              : 'This question carries the official wording.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <Field label="Question">
            <Textarea
              rows={3}
              value={draft.question}
              onChange={(e) => set('question', e.target.value)}
            />
          </Field>

          <Field label="Help text" >
            <Textarea
              rows={2}
              value={draft.helpText}
              onChange={(e) => set('helpText', e.target.value)}
              placeholder="Shown under the question. What the answer should be based on."
            />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Category">
              <Input value={draft.category} onChange={(e) => set('category', e.target.value)} />
            </Field>
            <Field label="Response type">
              <select
                className="h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-body text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={draft.responseType}
                onChange={(e) => set('responseType', e.target.value)}
              >
                {RESPONSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RESPONSE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Order">
              <Input
                type="number"
                value={draft.displayOrder}
                onChange={(e) => set('displayOrder', Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-surface-sunk/40 p-3">
            <Toggle
              id="isActive"
              label="Active"
              description="Inactive questions are kept for the record but not asked."
              checked={draft.isActive}
              onChange={(v) => set('isActive', v)}
            />
            <Toggle
              id="isMandatory"
              label="Mandatory"
              description="The checklist cannot be submitted until this is answered."
              checked={draft.isMandatory}
              onChange={(v) => set('isMandatory', v)}
            />
            <Toggle
              id="requiresDocument"
              label="Expects a supporting document"
              checked={draft.requiresDocument}
              onChange={(v) => set('requiresDocument', v)}
            />
            <Toggle
              id="affectsRisk"
              label="Feeds the risk category"
              checked={draft.affectsRisk}
              onChange={(v) => set('affectsRisk', v)}
            />
          </div>

          {draft.isProvisional && (
            <div className="rounded-lg border border-warning/30 bg-warning-bg/40 p-3">
              <Toggle
                id="markOfficial"
                label="This is the official BBAS wording"
                description="Marks the question official and stops the seed from ever rewriting it. This cannot be undone from here."
                checked={markOfficial}
                onChange={setMarkOfficial}
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-small font-medium text-text">{label}</span>
        {description && <span className="mt-0.5 block text-caption text-text-muted">{description}</span>}
      </span>
    </label>
  );
}
