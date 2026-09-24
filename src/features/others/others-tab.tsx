'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Car,
  CircleCheck,
  Landmark,
  MessageSquare,
  Save,
  Sun,
  Trees,
  Umbrella,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { api, ApiCallError } from '@/features/applications/api';
import type { OthersPayload, OthersRecord, SupportingDocument } from './types';

/**
 * THE "OTHERS" TAB — the six undertakings that belong to no other tab.
 *
 * Mortgage, car insurance, solar, rainwater harvesting, greening and the
 * special remarks. What they have in common is procedural rather than
 * topical: each is a condition that travels with the permission and is
 * checked at occupancy rather than at sanction.
 *
 * ── Required / proposed / provided ───────────────────────────────────────
 *
 * Three of the six carry that triple and the screen keeps all three visible,
 * because the GAP between them is the whole content of the tab:
 *
 *   required, not proposed           → a shortfall waiting to be raised
 *   required, proposed, not provided → the normal state before occupancy
 *   not required, proposed           → voluntary, and worth saying so
 *
 * A single yes/no would make the first two indistinguishable — the difference
 * between a file that needs an officer and one that does not. So each card
 * says in a sentence where it actually stands, above the switches.
 *
 * ── Saving ───────────────────────────────────────────────────────────────
 *
 * One card at a time. The PATCH is partial, so saving solar cannot disturb the
 * mortgage particulars — which matters on a file two people are working on.
 */
export function OthersTab({
  initial,
  applicationId,
}: {
  initial: OthersPayload;
  applicationId: string;
}) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [draft, setDraft] = React.useState<Partial<OthersRecord>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    setData(initial);
    setDraft({});
  }, [initial]);

  const value = { ...data.others, ...draft };
  const canEdit = data.canEdit;

  const set = <K extends keyof OthersRecord>(key: K, next: OthersRecord[K]) =>
    setDraft((prev) => ({ ...prev, [key]: next }));

  /** Which of this card's keys are actually dirty. */
  const dirtyIn = (keys: Array<keyof OthersRecord>) =>
    keys.filter((k) => k in draft && draft[k] !== data.others[k]);

  async function save(card: string, keys: Array<keyof OthersRecord>) {
    const dirty = dirtyIn(keys);
    if (!dirty.length) return;

    const payload: Record<string, unknown> = {};
    for (const key of dirty) payload[key] = value[key];

    setBusy(card);
    try {
      const next = await api.patch<OthersPayload>(
        `/api/applications/${applicationId}/others`,
        payload
      );
      setData(next);
      setDraft((prev) => {
        const rest = { ...prev };
        for (const key of dirty) delete rest[key];
        return rest;
      });
      toast.success(`${card} saved`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiCallError ? error.message : 'That did not work. Try again shortly.'
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && data.editBlockedReason && (
        <p className="rounded border border-border bg-surface-sunk/60 px-3 py-2 text-small text-text-muted">
          {data.editBlockedReason}
        </p>
      )}

      {/* ══ Mortgage ═══════════════════════════════════════════════════ */}
      <Block
        icon={Landmark}
        title="Mortgage"
        description="The portion of the building mortgaged to the authority as security, and the registration particulars of the deed."
        busy={busy === 'Mortgage'}
        dirty={
          dirtyIn([
            'mortgageApplicable',
            'mortgageNumber',
            'mortgageDate',
            'mortgageSubRegistrar',
            'mortgagePortion',
            'mortgageAreaSqm',
            'mortgageDocumentId',
          ]).length > 0
        }
        canEdit={canEdit}
        onSave={() =>
          save('Mortgage', [
            'mortgageApplicable',
            'mortgageNumber',
            'mortgageDate',
            'mortgageSubRegistrar',
            'mortgagePortion',
            'mortgageAreaSqm',
            'mortgageDocumentId',
          ])
        }
      >
        <Toggle
          id="mortgageApplicable"
          label="A mortgage applies to this permission"
          checked={value.mortgageApplicable}
          disabled={!canEdit}
          onChange={(v) => set('mortgageApplicable', v)}
        />

        {value.mortgageApplicable && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Mortgage number" htmlFor="mortgageNumber">
              <Input
                value={value.mortgageNumber}
                disabled={!canEdit}
                onChange={(e) => set('mortgageNumber', e.target.value)}
              />
            </Field>
            <Field label="Date" htmlFor="mortgageDate">
              <Input
                type="date"
                value={toDateInput(value.mortgageDate)}
                disabled={!canEdit}
                onChange={(e) => set('mortgageDate', e.target.value || null)}
              />
            </Field>
            <Field label="Sub registrar" htmlFor="mortgageSubRegistrar">
              <Input
                value={value.mortgageSubRegistrar}
                disabled={!canEdit}
                onChange={(e) => set('mortgageSubRegistrar', e.target.value)}
              />
            </Field>
            <Field
              label="Floors / portion handed over"
              htmlFor="mortgagePortion"
              className="sm:col-span-2"
              hint="As written in the deed."
            >
              <Input
                value={value.mortgagePortion}
                disabled={!canEdit}
                onChange={(e) => set('mortgagePortion', e.target.value)}
              />
            </Field>
            <Field label="Area (sq m)" htmlFor="mortgageAreaSqm">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={value.mortgageAreaSqm ?? ''}
                disabled={!canEdit}
                onChange={(e) => set('mortgageAreaSqm', numberOrNull(e.target.value))}
              />
            </Field>
            <DocumentPicker
              id="mortgageDocumentId"
              label="Document"
              documents={data.documents}
              value={value.mortgageDocumentId}
              disabled={!canEdit}
              onChange={(next) => set('mortgageDocumentId', next)}
            />
          </div>
        )}
      </Block>

      {/* ══ Car insurance ══════════════════════════════════════════════ */}
      <Block
        icon={Car}
        title="Car insurance"
        description="The policy quoted on this application, and how long it runs."
        busy={busy === 'Car insurance'}
        dirty={
          dirtyIn([
            'insuranceApplicable',
            'insurancePolicyNumber',
            'insuranceDate',
            'insuranceValidUpto',
            'insuranceDocumentId',
          ]).length > 0
        }
        canEdit={canEdit}
        onSave={() =>
          save('Car insurance', [
            'insuranceApplicable',
            'insurancePolicyNumber',
            'insuranceDate',
            'insuranceValidUpto',
            'insuranceDocumentId',
          ])
        }
      >
        <Toggle
          id="insuranceApplicable"
          label="A policy is on this file"
          checked={value.insuranceApplicable}
          disabled={!canEdit}
          onChange={(v) => set('insuranceApplicable', v)}
        />

        {value.insuranceApplicable && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Policy number" htmlFor="insurancePolicyNumber">
                <Input
                  value={value.insurancePolicyNumber}
                  disabled={!canEdit}
                  onChange={(e) => set('insurancePolicyNumber', e.target.value)}
                />
              </Field>
              <Field label="Date" htmlFor="insuranceDate">
                <Input
                  type="date"
                  value={toDateInput(value.insuranceDate)}
                  disabled={!canEdit}
                  onChange={(e) => set('insuranceDate', e.target.value || null)}
                />
              </Field>
              <Field label="Valid until" htmlFor="insuranceValidUpto">
                <Input
                  type="date"
                  value={toDateInput(value.insuranceValidUpto)}
                  disabled={!canEdit}
                  onChange={(e) => set('insuranceValidUpto', e.target.value || null)}
                />
              </Field>
              <DocumentPicker
                id="insuranceDocumentId"
                label="Document"
                documents={data.documents}
                value={value.insuranceDocumentId}
                disabled={!canEdit}
                onChange={(next) => set('insuranceDocumentId', next)}
              />
            </div>

            {/*
              An expired policy is worth saying out loud. It is the commonest
              defect on this block and the one an officer would otherwise have
              to work out by comparing a date to today's.
            */}
            {isExpired(value.insuranceValidUpto) && (
              <p className="flex items-center gap-2 rounded border border-warning/25 bg-warning-bg px-3 py-2 text-small text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                This policy expired on {formatDate(value.insuranceValidUpto)}.
              </p>
            )}
          </>
        )}
      </Block>

      {/* ══ Solar ══════════════════════════════════════════════════════ */}
      <Block
        icon={Sun}
        title="Solar"
        description="Whether the rules call for a solar installation, whether the proposal includes one, and whether it is in."
        busy={busy === 'Solar'}
        dirty={
          dirtyIn([
            'solarRequired',
            'solarProposed',
            'solarInstalled',
            'solarCapacityKw',
            'solarRemarks',
          ]).length > 0
        }
        canEdit={canEdit}
        onSave={() =>
          save('Solar', [
            'solarRequired',
            'solarProposed',
            'solarInstalled',
            'solarCapacityKw',
            'solarRemarks',
          ])
        }
      >
        <Standing
          required={value.solarRequired}
          proposed={value.solarProposed}
          provided={value.solarInstalled}
          noun="A solar installation"
          providedWord="installed"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            id="solarRequired"
            label="Required"
            checked={value.solarRequired}
            disabled={!canEdit}
            onChange={(v) => set('solarRequired', v)}
          />
          <Toggle
            id="solarProposed"
            label="Proposed"
            checked={value.solarProposed}
            disabled={!canEdit}
            onChange={(v) => set('solarProposed', v)}
          />
          <Toggle
            id="solarInstalled"
            label="Installed"
            checked={value.solarInstalled}
            disabled={!canEdit}
            onChange={(v) => set('solarInstalled', v)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Capacity (kW)" htmlFor="solarCapacityKw">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={value.solarCapacityKw ?? ''}
              disabled={!canEdit}
              onChange={(e) => set('solarCapacityKw', numberOrNull(e.target.value))}
            />
          </Field>
          <Field label="Remarks" htmlFor="solarRemarks" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={value.solarRemarks}
              disabled={!canEdit}
              onChange={(e) => set('solarRemarks', e.target.value)}
            />
          </Field>
        </div>
      </Block>

      {/* ══ Rainwater harvesting ═══════════════════════════════════════ */}
      <Block
        icon={Umbrella}
        title="Rainwater harvesting"
        description="Whether a structure is called for, proposed, and provided."
        busy={busy === 'Rainwater harvesting'}
        dirty={dirtyIn(['rwhRequired', 'rwhProposed', 'rwhProvided', 'rwhRemarks']).length > 0}
        canEdit={canEdit}
        onSave={() =>
          save('Rainwater harvesting', ['rwhRequired', 'rwhProposed', 'rwhProvided', 'rwhRemarks'])
        }
      >
        <Standing
          required={value.rwhRequired}
          proposed={value.rwhProposed}
          provided={value.rwhProvided}
          noun="Rainwater harvesting"
          providedWord="provided"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            id="rwhRequired"
            label="Required"
            checked={value.rwhRequired}
            disabled={!canEdit}
            onChange={(v) => set('rwhRequired', v)}
          />
          <Toggle
            id="rwhProposed"
            label="Proposed"
            checked={value.rwhProposed}
            disabled={!canEdit}
            onChange={(v) => set('rwhProposed', v)}
          />
          <Toggle
            id="rwhProvided"
            label="Provided"
            checked={value.rwhProvided}
            disabled={!canEdit}
            onChange={(v) => set('rwhProvided', v)}
          />
        </div>

        <Field label="Remarks" htmlFor="rwhRemarks">
          <Textarea
            rows={2}
            value={value.rwhRemarks}
            disabled={!canEdit}
            onChange={(e) => set('rwhRemarks', e.target.value)}
          />
        </Field>
      </Block>

      {/* ══ Greening and trees ═════════════════════════════════════════ */}
      <Block
        icon={Trees}
        title="Greening and trees"
        description="The planting called for on this plot, what is proposed, and what is standing."
        busy={busy === 'Greening and trees'}
        dirty={
          dirtyIn([
            'greeningRequired',
            'greeningProposed',
            'greeningProvided',
            'treeCount',
            'greeningRemarks',
          ]).length > 0
        }
        canEdit={canEdit}
        onSave={() =>
          save('Greening and trees', [
            'greeningRequired',
            'greeningProposed',
            'greeningProvided',
            'treeCount',
            'greeningRemarks',
          ])
        }
      >
        <Standing
          required={value.greeningRequired}
          proposed={value.greeningProposed}
          provided={value.greeningProvided}
          noun="Greening"
          providedWord="provided"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            id="greeningRequired"
            label="Required"
            checked={value.greeningRequired}
            disabled={!canEdit}
            onChange={(v) => set('greeningRequired', v)}
          />
          <Toggle
            id="greeningProposed"
            label="Proposed"
            checked={value.greeningProposed}
            disabled={!canEdit}
            onChange={(v) => set('greeningProposed', v)}
          />
          <Toggle
            id="greeningProvided"
            label="Provided"
            checked={value.greeningProvided}
            disabled={!canEdit}
            onChange={(v) => set('greeningProvided', v)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Number of trees"
            htmlFor="treeCount"
            hint="Blank means not counted, which is not the same as none."
          >
            <Input
              type="number"
              min={0}
              step="1"
              value={value.treeCount ?? ''}
              disabled={!canEdit}
              onChange={(e) => set('treeCount', intOrNull(e.target.value))}
            />
          </Field>
          <Field label="Remarks" htmlFor="greeningRemarks" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={value.greeningRemarks}
              disabled={!canEdit}
              onChange={(e) => set('greeningRemarks', e.target.value)}
            />
          </Field>
        </div>
      </Block>

      {/* ══ Special remarks ════════════════════════════════════════════ */}
      <Block
        icon={MessageSquare}
        title="Special remarks"
        description="Anything about this file that belongs on the permission and fits none of the headings above."
        busy={busy === 'Special remarks'}
        dirty={dirtyIn(['specialRemarks']).length > 0}
        canEdit={canEdit}
        onSave={() => save('Special remarks', ['specialRemarks'])}
      >
        <Textarea
          rows={4}
          value={value.specialRemarks}
          disabled={!canEdit}
          placeholder={canEdit ? 'Anything else that should travel with this permission' : ''}
          onChange={(e) => set('specialRemarks', e.target.value)}
        />
      </Block>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Pieces
// ═══════════════════════════════════════════════════════════════════════════

function Block({
  icon: Icon,
  title,
  description,
  children,
  dirty,
  busy,
  canEdit,
  onSave,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
  dirty: boolean;
  busy: boolean;
  canEdit: boolean;
  onSave: () => void;
}) {
  return (
    <Card className={cn(dirty && 'border-primary/40')}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Icon className="size-4 text-text-muted" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>

          {canEdit && dirty && (
            <Button variant="primary" size="sm" onClick={onSave} disabled={busy}>
              <Save className="size-4" aria-hidden />
              Save
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/**
 * Cites a document already on the file.
 *
 * The list is what has ACTUALLY been uploaded, not what is required: a
 * requirement nobody has met is not a document, and letting the mortgage
 * particulars point at one would put a reference on the permission to
 * something that does not exist. When the file carries nothing yet, the
 * control says where to go instead of presenting an empty box.
 */
function DocumentPicker({
  id,
  label,
  documents,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  documents: SupportingDocument[];
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  if (!documents.length) {
    return (
      <Field label={label} htmlFor={id}>
        <p className="text-caption text-text-subtle">
          Nothing uploaded yet. Add it on the Documents tab and it can be cited here.
        </p>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-surface-sunk disabled:opacity-60"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No document cited</option>
        {documents.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-small font-normal">
        {label}
      </Label>
    </div>
  );
}

/**
 * Where this undertaking actually stands, in a sentence.
 *
 * The three switches below state the facts; this states what they MEAN
 * together, which is the thing an officer is reading the tab to find out. A
 * required-and-not-proposed is the one combination that needs somebody to act,
 * so it is the one that is coloured.
 */
function Standing({
  required,
  proposed,
  provided,
  noun,
  providedWord,
}: {
  required: boolean;
  proposed: boolean;
  provided: boolean;
  noun: string;
  providedWord: string;
}) {
  if (required && !proposed) {
    return (
      <p className="flex items-center gap-2 rounded border border-warning/25 bg-warning-bg px-3 py-2 text-small text-warning">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {noun} is required here and the proposal does not include it.
      </p>
    );
  }

  if (provided) {
    return (
      <p className="flex items-center gap-2 rounded border border-success/25 bg-success-bg px-3 py-2 text-small text-success">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        {noun} has been {providedWord}.
      </p>
    );
  }

  if (proposed) {
    return (
      <p className="text-small text-text-muted">
        {noun} is proposed and not yet {providedWord}
        {required ? '' : ' — it is not required here, so this is voluntary'}.
      </p>
    );
  }

  return (
    <p className="text-small text-text-muted">
      {noun} is neither required nor proposed on this application.
    </p>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────

const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

const numberOrNull = (value: string): number | null =>
  value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

const intOrNull = (value: string): number | null => {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
};

const isExpired = (iso: string | null): boolean =>
  Boolean(iso) && new Date(iso as string).getTime() < Date.now();

const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
