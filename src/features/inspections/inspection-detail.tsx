'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  CircleCheck,
  FileSignature,
  Info,
  Lock,
  MapPin,
  Save,
  ShieldCheck,
  ShieldX,
  Trash2,
  CalendarClock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/common/status-badge';
import { toast } from '@/components/ui/toast';
import { stageName } from '@/lib/workflow';
import { cn } from '@/lib/utils';
import { allowedResponses, responseLabel } from '@/lib/checklist';
import {
  DEMO_ESIGN_OTP,
  DEMO_SIGNATURE_DISCLAIMER,
  DEMO_TOKEN_PIN,
  PHOTO_BEARING,
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABEL,
  QUESTION_STATUSES,
  QUESTION_STATUS_LABEL,
  QUESTION_STATUS_TONE,
  RECOMMENDATIONS,
  RECOMMENDATION_LABEL,
  RECOMMENDATION_OUTCOME,
  REQUIRED_PHOTO_CATEGORIES,
  SIGNATURE_METHODS,
  SIGNATURE_METHOD_LABEL,
  formatCoordinates,
  inspectionReadiness,
  offsetCoordinates,
  questionTally,
  type PhotoCategory,
  type QuestionStatus,
  type Recommendation,
  type SignatureMethod,
} from '@/lib/site-inspection';
import { api, ApiCallError } from '@/features/applications/api';
import { SiteMap } from './site-map';
import type { InspectionDetail, InspectionPhoto, InspectionResponse } from './types';

/**
 * ONE SITE INSPECTION REPORT — the inspector's working surface, and after
 * signature, the locked record everybody above reads.
 *
 * The readiness list at the top is `inspectionReadiness()` — the SAME function
 * the server runs inside the signing transaction — computed over what is on
 * screen. A report this screen calls ready cannot be refused for a reason the
 * screen did not show.
 */

type Draft = {
  inspectedAt: string;
  latitude: string;
  longitude: string;
  generalObservation: string;
  recommendation: string;
  recommendationRemarks: string;
  responses: Record<string, Pick<InspectionResponse, 'response' | 'observation' | 'remarks' | 'status'>>;
};

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** ISO → the value a datetime-local input wants, in local time. */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

function draftFrom(data: InspectionDetail): Draft {
  return {
    inspectedAt: toLocalInput(data.inspectedAt),
    latitude: data.latitude == null ? '' : String(data.latitude),
    longitude: data.longitude == null ? '' : String(data.longitude),
    generalObservation: data.generalObservation,
    recommendation: data.recommendation,
    recommendationRemarks: data.recommendationRemarks,
    responses: Object.fromEntries(
      data.responses.map((r) => [
        r.itemId,
        { response: r.response, observation: r.observation, remarks: r.remarks, status: r.status },
      ])
    ),
  };
}

const num = (value: string): number | null => {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function InspectionDetailView({ initial }: { initial: InspectionDetail }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(initial));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [signOpen, setSignOpen] = React.useState(false);
  const [photoOpen, setPhotoOpen] = React.useState(false);
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [selectedPhoto, setSelectedPhoto] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const editable = data.permissions.canEdit;
  const locked = !!data.lockedAt;

  const reload = React.useCallback(async () => {
    const next = await api.get<InspectionDetail>(`/api/inspections/${data.id}`);
    setData(next);
    setDraft(draftFrom(next));
    setDirty(false);
    return next;
  }, [data.id]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const editResponse = (itemId: string, patch: Partial<Draft['responses'][string]>) => {
    setDraft((d) => ({ ...d, responses: { ...d.responses, [itemId]: { ...d.responses[itemId]!, ...patch } } }));
    setDirty(true);
  };

  // ── Readiness, computed exactly as the server will ─────────────────────
  const merged = React.useMemo(
    () => data.responses.map((r) => ({ ...r, ...(draft.responses[r.itemId] ?? {}) })),
    [data.responses, draft.responses]
  );
  const issues = React.useMemo(
    () =>
      inspectionReadiness({
        scheduledOn: data.createdAt,
        inspectedAt: fromLocalInput(draft.inspectedAt),
        latitude: num(draft.latitude),
        longitude: num(draft.longitude),
        recommendation: draft.recommendation,
        recommendationRemarks: draft.recommendationRemarks,
        responses: merged,
        photos: data.photos,
      }),
    [data.createdAt, data.photos, draft, merged]
  );
  const tally = React.useMemo(() => questionTally(merged), [merged]);
  const issuePaths = React.useMemo(() => new Set(issues.map((i) => i.path)), [issues]);

  async function saveDraft(quiet = false): Promise<boolean> {
    setSaving(true);
    setFieldErrors({});
    try {
      await api.patch(`/api/inspections/${data.id}`, {
        inspectedAt: fromLocalInput(draft.inspectedAt),
        latitude: num(draft.latitude),
        longitude: num(draft.longitude),
        generalObservation: draft.generalObservation,
        recommendation: draft.recommendation,
        recommendationRemarks: draft.recommendationRemarks,
        responses: data.responses.map((r) => ({ itemId: r.itemId, ...draft.responses[r.itemId]! })),
      });
      await reload();
      if (!quiet) toast.success('Draft saved', { description: data.inspectionNumber });
      return true;
    } catch (error) {
      if (error instanceof ApiCallError) {
        setFieldErrors(error.fieldErrors());
        toast.error(error.message);
      } else toast.error('The draft could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  const grouped = React.useMemo(() => {
    const groups = new Map<string, InspectionResponse[]>();
    for (const r of data.responses) {
      const key = r.category || 'General';
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()];
  }, [data.responses]);

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Application">
            <Link href={`/applications/${data.application.id}?tab=inspection`} className="font-medium text-primary hover:underline">
              {data.application.applicationNumber}
            </Link>
            <p className="text-caption text-text-muted">{data.application.owner || '—'}</p>
          </Fact>
          <Fact label="Inspection ID">
            <span className="font-medium">{data.inspectionNumber}</span>
            <p className="text-caption text-text-muted">Round {data.round}</p>
          </Fact>
          <Fact label="Status">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge kind="inspection" status={data.status} />
              {data.recommendation && <StatusBadge kind="recommendation" status={data.recommendation} />}
            </div>
          </Fact>
          <Fact label="Current desk">{stageName(data.application.currentStageCode)}</Fact>
          <Fact label="Site" className="sm:col-span-2">
            {data.siteAddress || data.application.site || '—'}
            <p className="text-caption text-text-muted">{data.application.zone}</p>
          </Fact>
          <Fact label="Inspector">
            {data.inspectorName}
            <p className="text-caption text-text-muted">Booked by {data.scheduledByName || '—'}</p>
          </Fact>
          <Fact label="Scheduled · Inspected">
            {fmtDate(data.scheduledFor)} · {data.inspectedAt ? fmtDate(data.inspectedAt) : 'not yet'}
          </Fact>
        </CardContent>
        {data.permissions.canReschedule && (
          <CardContent className="flex justify-end border-t border-border pt-3">
            <Button size="sm" variant="secondary" onClick={() => setRescheduleOpen(true)}>
              <CalendarClock /> Reschedule
            </Button>
          </CardContent>
        )}
      </Card>

      {/* ── Signed / locked ─────────────────────────────────────────────── */}
      {locked && <SignaturePanel data={data} />}

      {/* ── Not your report ─────────────────────────────────────────────── */}
      {!locked && !editable && (
        <Notice tone="info" icon={Info}>
          This inspection is assigned to <span className="font-medium">{data.inspectorName}</span>. Only the
          assigned inspector records findings and signs the report; you are seeing it read-only.
        </Notice>
      )}

      {/* ── Readiness ───────────────────────────────────────────────────── */}
      {editable && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {issues.length ? (
                <AlertTriangle className="size-4 text-warning" aria-hidden />
              ) : (
                <CircleCheck className="size-4 text-success" aria-hidden />
              )}
              {issues.length ? `${issues.length} before this can be signed` : 'Ready to sign'}
            </CardTitle>
            <CardDescription>
              {tally.answered}/{tally.total} answered · {tally.satisfactory} satisfactory · {tally.shortfall} shortfall ·{' '}
              {tally.objection} objection · {tally.na} not applicable · {data.photos.length} photographs
            </CardDescription>
          </CardHeader>
          {issues.length > 0 && (
            <CardContent>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {issues.map((i, n) => (
                  <li key={`${i.path}-${n}`} className="flex items-start gap-2 text-small text-text-muted">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                    {i.message}
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── The visit ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4" aria-hidden /> Location and visit
          </CardTitle>
          <CardDescription>
            Coordinates are DEMO values derived from the site&apos;s district — no device GPS is read.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Date and time of inspection" htmlFor="inspectedAt" required error={fieldErrors.inspectedAt}>
              <Input
                id="inspectedAt"
                type="datetime-local"
                value={draft.inspectedAt}
                disabled={!editable}
                max={toLocalInput(new Date().toISOString())}
                onChange={(e) => edit({ inspectedAt: e.target.value })}
                aria-invalid={issuePaths.has('inspectedAt') || undefined}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" htmlFor="lat" required>
                <Input
                  id="lat"
                  inputMode="decimal"
                  value={draft.latitude}
                  disabled={!editable}
                  onChange={(e) => edit({ latitude: e.target.value })}
                />
              </Field>
              <Field label="Longitude" htmlFor="lng" required>
                <Input
                  id="lng"
                  inputMode="decimal"
                  value={draft.longitude}
                  disabled={!editable}
                  onChange={(e) => edit({ longitude: e.target.value })}
                />
              </Field>
            </div>
            <Field label="General observation" htmlFor="general" hint="Site and surrounding conditions, in a few sentences.">
              <Textarea
                id="general"
                rows={4}
                value={draft.generalObservation}
                disabled={!editable}
                onChange={(e) => edit({ generalObservation: e.target.value })}
              />
            </Field>
          </div>
          <SiteMap
            latitude={num(draft.latitude)}
            longitude={num(draft.longitude)}
            photos={data.photos}
            selectedId={selectedPhoto}
            onSelect={setSelectedPhoto}
          />
        </CardContent>
      </Card>

      {/* ── The 27 questions ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Site inspection questions ({data.responses.length})</CardTitle>
          <CardDescription>
            <span className="mr-2 inline-flex">
              <Badge tone="warning">{data.provisional.label}</Badge>
            </span>
            {data.provisional.note}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {grouped.map(([category, rows]) => (
            <section key={category} className="space-y-2">
              <h3 className="text-small font-semibold uppercase tracking-wide text-text-muted">{category}</h3>
              <div className="divide-y divide-border rounded-lg border border-border">
                {rows.map((r) => (
                  <QuestionRow
                    key={r.itemId}
                    row={r}
                    value={draft.responses[r.itemId]!}
                    editable={editable}
                    flagged={issuePaths.has(`responses.${r.itemNumber}`)}
                    onChange={(patch) => editResponse(r.itemId, patch)}
                  />
                ))}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>

      {/* ── Photographs ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" aria-hidden /> Geo-tagged photographs ({data.photos.length})
            </CardTitle>
            <CardDescription>
              Required before signing: {REQUIRED_PHOTO_CATEGORIES.map((c) => PHOTO_CATEGORY_LABEL[c]).join(', ')}.
              Coordinates are demo values.
            </CardDescription>
          </div>
          {editable && (
            <Button size="sm" onClick={() => setPhotoOpen(true)}>
              <Camera /> Add photograph
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {REQUIRED_PHOTO_CATEGORIES.map((c) => {
              const has = data.photos.some((p) => p.category === c);
              return (
                <Badge key={c} tone={has ? 'success' : 'outline'}>
                  {has ? '✓' : '○'} {PHOTO_CATEGORY_LABEL[c]}
                </Badge>
              );
            })}
          </div>
          {data.photos.length === 0 ? (
            <p className="text-small text-text-muted">No photographs yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.photos.map((p) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  inspectionId={data.id}
                  selected={selectedPhoto === p.id}
                  onSelect={() => setSelectedPhoto(p.id)}
                  editable={editable}
                  onRemoved={() => void reload()}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recommendation ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendation</CardTitle>
          <CardDescription>
            The inspector recommends; the deciding desk decides. The recommendation travels with the file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Recommendation">
            {RECOMMENDATIONS.map((rec) => {
              const active = draft.recommendation === rec;
              return (
                <button
                  key={rec}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!editable}
                  onClick={() => edit({ recommendation: rec })}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                    active
                      ? rec === 'RECOMMENDED'
                        ? 'border-success bg-success-bg'
                        : rec === 'SHORTFALL'
                          ? 'border-warning bg-warning-bg'
                          : 'border-danger bg-danger-bg'
                      : 'border-border bg-surface hover:bg-surface-sunk'
                  )}
                >
                  <p className="font-medium text-text">{RECOMMENDATION_LABEL[rec]}</p>
                  <p className="mt-1 text-caption text-text-muted">{RECOMMENDATION_OUTCOME[rec]}</p>
                </button>
              );
            })}
          </div>
          <Field
            label="Remarks"
            htmlFor="recRemarks"
            required
            error={fieldErrors.recommendationRemarks}
            hint="What the recommendation rests on. Required."
          >
            <Textarea
              id="recRemarks"
              rows={3}
              value={draft.recommendationRemarks}
              disabled={!editable}
              onChange={(e) => edit({ recommendationRemarks: e.target.value })}
              aria-invalid={issuePaths.has('recommendationRemarks') || undefined}
            />
          </Field>
        </CardContent>
      </Card>

      {/* ── Save / Sign ─────────────────────────────────────────────────── */}
      {editable && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-surface/95 p-3 shadow-sm backdrop-blur">
          <span className="mr-auto text-caption text-text-muted">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button variant="secondary" loading={saving} disabled={!dirty} onClick={() => void saveDraft()}>
            <Save /> Save Draft
          </Button>
          <Button
            variant="primary"
            disabled={saving || issues.length > 0}
            title={issues.length ? 'Resolve the items listed at the top first.' : undefined}
            onClick={async () => {
              if (dirty && !(await saveDraft(true))) return;
              setSignOpen(true);
            }}
          >
            <FileSignature /> Sign &amp; Submit
          </Button>
        </div>
      )}

      {photoOpen && (
        <AddPhotoDialog
          inspection={data}
          latitude={num(draft.latitude) ?? data.latitude}
          longitude={num(draft.longitude) ?? data.longitude}
          onClose={() => setPhotoOpen(false)}
          onAdded={async () => {
            setPhotoOpen(false);
            // Keep unsaved edits: refresh only the photographs.
            const next = await api.get<InspectionDetail>(`/api/inspections/${data.id}`);
            setData((d) => ({ ...d, photos: next.photos, status: next.status }));
          }}
        />
      )}

      {signOpen && (
        <SignDialog
          inspection={data}
          onClose={() => setSignOpen(false)}
          onSigned={async (message) => {
            setSignOpen(false);
            toast.success('Signed and submitted', { description: message });
            await reload();
            router.refresh();
          }}
        />
      )}

      {rescheduleOpen && (
        <RescheduleDialog
          inspection={data}
          onClose={() => setRescheduleOpen(false)}
          onDone={async () => {
            setRescheduleOpen(false);
            await reload();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

function Fact({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-caption uppercase tracking-wide text-text-subtle">{label}</p>
      <div className="mt-0.5 text-small text-text">{children}</div>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'info' | 'warning' | 'success' | 'danger';
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-info/30 bg-info-bg text-info',
    warning: 'border-warning/30 bg-warning-bg text-warning',
    success: 'border-success/30 bg-success-bg text-success',
    danger: 'border-danger/30 bg-danger-bg text-danger',
  };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-small', tones[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="text-text">{children}</div>
    </div>
  );
}

function QuestionRow({
  row,
  value,
  editable,
  flagged,
  onChange,
}: {
  row: InspectionResponse;
  value: Pick<InspectionResponse, 'response' | 'observation' | 'remarks' | 'status'>;
  editable: boolean;
  flagged: boolean;
  onChange: (patch: Partial<Pick<InspectionResponse, 'response' | 'observation' | 'remarks' | 'status'>>) => void;
}) {
  const choices = allowedResponses(row.responseType);
  const needsObservation = value.status === 'SHORTFALL' || value.status === 'OBJECTION';

  return (
    <div className={cn('grid gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]', flagged && editable && 'bg-warning-bg/40')}>
      <div className="min-w-0">
        <p className="text-small text-text">
          <span className="mr-1.5 font-semibold tabular-nums">{row.itemNumber}.</span>
          {row.question}
          {row.isMandatory && <span className="ml-0.5 text-danger">*</span>}
        </p>
        {row.helpText && <p className="mt-1 text-caption text-text-muted">{row.helpText}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {row.isProvisional && <Badge tone="outline">Provisional wording</Badge>}
          {!editable && <Badge tone={QUESTION_STATUS_TONE[value.status as QuestionStatus] ?? 'neutral'}>{QUESTION_STATUS_LABEL[value.status as QuestionStatus] ?? value.status}</Badge>}
        </div>
      </div>

      {editable ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-caption text-text-muted">Response</span>
            {choices.length ? (
              <div className="flex flex-wrap gap-1">
                {choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChange({ response: value.response === c ? '' : c })}
                    className={cn(
                      'rounded border px-2.5 py-1 text-caption',
                      value.response === c
                        ? 'border-primary bg-primary text-primary-text'
                        : 'border-border-strong bg-surface text-text hover:bg-surface-sunk'
                    )}
                    aria-pressed={value.response === c}
                  >
                    {responseLabel(c)}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                value={value.response}
                inputMode={row.responseType === 'NUMBER' || row.responseType === 'MEASUREMENT' ? 'decimal' : undefined}
                onChange={(e) => onChange({ response: e.target.value })}
                placeholder={row.responseType === 'MEASUREMENT' ? 'e.g. 9.14' : ''}
              />
            )}
          </div>
          <div className="space-y-1">
            <span className="text-caption text-text-muted">Status</span>
            <select
              className="h-8 w-full rounded border border-border-strong bg-surface px-2 text-small text-text"
              value={value.status}
              onChange={(e) => onChange({ status: e.target.value })}
            >
              {QUESTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUESTION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <Textarea
            rows={2}
            className="sm:col-span-1"
            placeholder={needsObservation ? 'Observation (required)' : 'Observation'}
            value={value.observation}
            onChange={(e) => onChange({ observation: e.target.value })}
            aria-invalid={(needsObservation && !value.observation.trim()) || undefined}
          />
          <Textarea
            rows={2}
            placeholder="Remarks"
            value={value.remarks}
            onChange={(e) => onChange({ remarks: e.target.value })}
          />
        </div>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-small sm:grid-cols-[auto_1fr]">
          <dt className="text-text-muted">Response</dt>
          <dd className="text-text">{value.response ? responseLabel(value.response) : '—'}</dd>
          <dt className="text-text-muted">Observation</dt>
          <dd className="text-text">{value.observation || '—'}</dd>
          <dt className="text-text-muted">Remarks</dt>
          <dd className="text-text">{value.remarks || '—'}</dd>
        </dl>
      )}
    </div>
  );
}

function PhotoCard({
  photo,
  inspectionId,
  selected,
  onSelect,
  editable,
  onRemoved,
}: {
  photo: InspectionPhoto;
  inspectionId: string;
  selected: boolean;
  onSelect: () => void;
  editable: boolean;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-lg border bg-surface',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/inspections/photos/${photo.id}`}
          alt={`${PHOTO_CATEGORY_LABEL[photo.category as PhotoCategory] ?? photo.category} view`}
          className="aspect-[4/3] w-full bg-surface-sunk object-cover"
          loading="lazy"
        />
      </button>
      <figcaption className="space-y-1 p-3 text-caption">
        <div className="flex items-center justify-between gap-2">
          <Badge tone="info">{PHOTO_CATEGORY_LABEL[photo.category as PhotoCategory] ?? photo.category}</Badge>
          {!photo.fileObjectId && <Badge tone="outline">Demo placeholder</Badge>}
        </div>
        <p className="font-mono text-text">{formatCoordinates(photo.latitude, photo.longitude)}</p>
        <p className="text-text-muted">
          {fmtDateTime(photo.capturedAt)} · {photo.uploadedByName}
        </p>
        {photo.description && <p className="text-text">{photo.description}</p>}
        {photo.fileName && <p className="truncate text-text-subtle">{photo.fileName}</p>}
        {editable && (
          <Button
            size="xs"
            variant="ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.delete(`/api/inspections/${inspectionId}/photos/${photo.id}`);
                toast.success('Photograph removed');
                onRemoved();
              } catch (error) {
                toast.error(error instanceof ApiCallError ? error.message : 'Could not remove it.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </figcaption>
    </figure>
  );
}

function AddPhotoDialog({
  inspection,
  latitude,
  longitude,
  onClose,
  onAdded,
}: {
  inspection: InspectionDetail;
  latitude: number | null;
  longitude: number | null;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const firstMissing =
    REQUIRED_PHOTO_CATEGORIES.find((c) => !inspection.photos.some((p) => p.category === c)) ?? 'OTHER';
  const [category, setCategory] = React.useState<PhotoCategory>(firstMissing);
  const [file, setFile] = React.useState<File | null>(null);
  const [capturedAt, setCapturedAt] = React.useState(toLocalInput(new Date().toISOString()));
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // A demo position ~12 m from the centre, in the direction of the view.
  const suggested = React.useCallback(
    (cat: PhotoCategory) => {
      if (latitude == null || longitude == null) return { lat: '', lng: '' };
      const bearing = PHOTO_BEARING[cat] ?? (PHOTO_CATEGORIES.indexOf(cat) * 47) % 360;
      const p = offsetCoordinates(latitude, longitude, bearing, 12);
      return { lat: String(p.latitude), lng: String(p.longitude) };
    },
    [latitude, longitude]
  );
  const [coords, setCoords] = React.useState(() => suggested(firstMissing));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const form = new FormData();
      form.set('category', category);
      form.set('latitude', coords.lat);
      form.set('longitude', coords.lng);
      form.set('capturedAt', fromLocalInput(capturedAt) ?? '');
      form.set('description', description);
      if (file) form.set('file', file);
      const res = await fetch(`/api/inspections/${inspection.id}/photos`, { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const details = (body?.details ?? []) as Array<{ path: string; message: string }>;
        setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
        throw new Error(body?.error ?? 'The photograph could not be added.');
      }
      toast.success('Photograph added', { description: PHOTO_CATEGORY_LABEL[category] });
      await onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The photograph could not be added.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a geo-tagged photograph</DialogTitle>
          <DialogDescription>
            Coordinates are DEMO values — suggested from the inspection location, editable, never read from a
            device.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="View" htmlFor="photoCategory" required error={errors.category}>
            <select
              id="photoCategory"
              className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text"
              value={category}
              onChange={(e) => {
                const next = e.target.value as PhotoCategory;
                setCategory(next);
                setCoords(suggested(next));
              }}
            >
              {PHOTO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PHOTO_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Image file"
            htmlFor="photoFile"
            hint="JPG or PNG, up to 8 MB. Leave empty to record a labelled demo placeholder instead."
          >
            <Input
              id="photoFile"
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="pLat" required error={errors.latitude}>
              <Input id="pLat" value={coords.lat} onChange={(e) => setCoords((c) => ({ ...c, lat: e.target.value }))} />
            </Field>
            <Field label="Longitude" htmlFor="pLng" required error={errors.longitude}>
              <Input id="pLng" value={coords.lng} onChange={(e) => setCoords((c) => ({ ...c, lng: e.target.value }))} />
            </Field>
          </div>
          <Field label="Date and time taken" htmlFor="pWhen" required error={errors.capturedAt}>
            <Input id="pWhen" type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="pDesc">
            <Textarea id="pDesc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            <Camera /> {file ? 'Upload photograph' : 'Add demo placeholder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignDialog({
  inspection,
  onClose,
  onSigned,
}: {
  inspection: InspectionDetail;
  onClose: () => void;
  onSigned: (message: string) => void | Promise<void>;
}) {
  const [method, setMethod] = React.useState<SignatureMethod>('AADHAAR_ESIGN_DEMO');
  const [aadhaarLast4, setAadhaarLast4] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [otpSent, setOtpSent] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const [declaration, setDeclaration] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const rec = inspection.recommendation as Recommendation;

  async function sign() {
    setBusy(true);
    setErrors({});
    try {
      const result = await api.post<{ inspectionNumber: string; workflow: { message: string } }>(
        `/api/inspections/${inspection.id}/submit`,
        {
          method,
          ...(method === 'AADHAAR_ESIGN_DEMO' ? { aadhaarLast4, otp } : { pin }),
          declaration,
          expectedSequence: inspection.expectedSequence,
        }
      );
      await onSigned(result.workflow.message);
    } catch (error) {
      if (error instanceof ApiCallError) {
        setErrors(error.fieldErrors());
        toast.error(error.message);
      } else toast.error('The report could not be signed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign &amp; Submit — {inspection.inspectionNumber}</DialogTitle>
          <DialogDescription>{DEMO_SIGNATURE_DISCLAIMER}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-sunk p-3 text-small">
            <p>
              Recommendation: <StatusBadge kind="recommendation" status={rec} />
            </p>
            <p className="mt-1.5 text-caption text-text-muted">{RECOMMENDATION_OUTCOME[rec]}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Signature method">
            {SIGNATURE_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={cn(
                  'rounded-lg border p-3 text-left text-small',
                  method === m ? 'border-primary bg-info-bg' : 'border-border hover:bg-surface-sunk'
                )}
              >
                <p className="font-medium">{SIGNATURE_METHOD_LABEL[m]}</p>
                <p className="text-caption text-text-muted">
                  {m === 'AADHAAR_ESIGN_DEMO' ? `Demo OTP: ${DEMO_ESIGN_OTP}` : `Demo PIN: ${DEMO_TOKEN_PIN}`}
                </p>
              </button>
            ))}
          </div>

          {method === 'AADHAAR_ESIGN_DEMO' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aadhaar — last 4 digits" htmlFor="a4" required error={errors.aadhaarLast4}>
                <Input id="a4" inputMode="numeric" maxLength={4} value={aadhaarLast4} onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="OTP" htmlFor="otp" required error={errors.otp} hint={otpSent ? `Demo OTP "sent": ${DEMO_ESIGN_OTP}` : undefined}>
                <div className="flex gap-2">
                  <Input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                  <Button type="button" size="sm" variant="secondary" disabled={aadhaarLast4.length !== 4} onClick={() => setOtpSent(true)}>
                    Get OTP
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <Field label="Token PIN" htmlFor="pin" required error={errors.pin} hint="No USB token is read — this is a demonstration.">
              <Input id="pin" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}

          <label className="flex items-start gap-2.5 text-small">
            <Checkbox checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} className="mt-0.5" />
            <span>
              I inspected this site in person on {fmtDate(inspection.inspectedAt)}. The answers, observations and
              photographs in this report are what I found. I understand the report is locked once signed.
            </span>
          </label>
          {errors.declaration && <p className="text-caption text-danger">{errors.declaration}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!declaration} onClick={() => void sign()}>
            <FileSignature /> Sign &amp; Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({
  inspection,
  onClose,
  onDone,
}: {
  inspection: InspectionDetail;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [inspectorId, setInspectorId] = React.useState(inspection.inspectorId);
  const [date, setDate] = React.useState(inspection.scheduledFor.slice(0, 10));
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/api/inspections/${inspection.id}/reschedule`, {
        ...(inspectorId !== inspection.inspectorId ? { inspectorId } : {}),
        ...(date !== inspection.scheduledFor.slice(0, 10) ? { scheduledFor: `${date}T10:00:00` } : {}),
        remarks,
      });
      toast.success('Inspection rescheduled');
      await onDone();
    } catch (error) {
      if (error instanceof ApiCallError) {
        setErrors(error.fieldErrors());
        toast.error(error.message);
      } else toast.error('Could not reschedule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule {inspection.inspectionNumber}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Inspector" htmlFor="rInspector" error={errors.inspectorId}>
            <select
              id="rInspector"
              className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small"
              value={inspectorId}
              onChange={(e) => setInspectorId(e.target.value)}
            >
              {inspection.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.designation ? ` — ${c.designation}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date of visit" htmlFor="rDate" error={errors.scheduledFor}>
            <Input id="rDate" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="rWhy" required error={errors.remarks}>
            <Textarea id="rWhy" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!remarks.trim()} onClick={() => void submit()}>
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignaturePanel({ data }: { data: InspectionDetail }) {
  const meta = data.signatureMetadata ?? {};
  const valid = data.signatureValid;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4" aria-hidden /> Signed and locked
        </CardTitle>
        <CardDescription>{String(meta.disclaimer ?? DEMO_SIGNATURE_DISCLAIMER)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Signed by">
          {data.signedByName}
          <p className="text-caption text-text-muted">{data.signedByRoleKey}</p>
        </Fact>
        <Fact label="Method">{SIGNATURE_METHOD_LABEL[data.signatureMethod as SignatureMethod] ?? (data.signatureMethod || '—')}</Fact>
        <Fact label="Signed at">{fmtDateTime(data.signedAt)}</Fact>
        <Fact label="Reference">
          <span className="font-mono text-caption">{data.signatureRef || '—'}</span>
        </Fact>
        <Fact label="Document hash (SHA-256)" className="sm:col-span-2 lg:col-span-3">
          <span className="break-all font-mono text-caption">{data.documentHash || '—'}</span>
        </Fact>
        <Fact label="Integrity">
          {valid === true ? (
            <Badge tone="success">
              <ShieldCheck className="size-3" /> Report unchanged since signing
            </Badge>
          ) : valid === false ? (
            <Badge tone="danger">
              <ShieldX className="size-3" /> Report differs from what was signed
            </Badge>
          ) : (
            '—'
          )}
        </Fact>
        {typeof meta.maskedAadhaar === 'string' && <Fact label="Aadhaar (masked)">{meta.maskedAadhaar}</Fact>}
        {typeof meta.tokenSerial === 'string' && <Fact label="Token serial">{meta.tokenSerial}</Fact>}
        <Fact label="Workflow">
          {data.routedActionCode ? stageName(data.application.currentStageCode) : '—'}
          {data.submitSequence != null && <p className="text-caption text-text-muted">History #{data.submitSequence}</p>}
        </Fact>
        {data.shortfall && (
          <Fact label="Shortfall raised">
            <Link href={`/shortfalls/${data.shortfall.id}`} className="text-primary hover:underline">
              {data.shortfall.shortfallNumber}
            </Link>{' '}
            <StatusBadge kind="shortfall" status={data.shortfall.status} />
          </Fact>
        )}
      </CardContent>
    </Card>
  );
}
