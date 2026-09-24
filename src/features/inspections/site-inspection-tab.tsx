'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarPlus, Camera, ClipboardCheck, FileSignature, Info, MapPin } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import {
  PHOTO_CATEGORY_LABEL,
  SIGNATURE_METHOD_LABEL,
  formatCoordinates,
  type PhotoCategory,
  type SignatureMethod,
} from '@/lib/site-inspection';
import type { ApplicationInspectionsPayload, InspectionRound } from './types';

const fmt = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * The application's SITE INSPECTION tab.
 *
 * A summary of every round — status, inspector, date, recommendation,
 * photographs, questions, signature — and, at the TPA desk, the form that
 * books the visit. The report itself is worked on its own page.
 */
export function SiteInspectionTab({ initial }: { initial: ApplicationInspectionsPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);

  const reload = async () => {
    setData(await api.get<ApplicationInspectionsPayload>(`/api/applications/${data.application.id}/site-inspection`));
    router.refresh();
  };

  const latest = data.rounds[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-small">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-text">
          <span className="font-semibold">{data.provisional.label}.</span> {data.provisional.note} Coordinates and
          signatures on this tab are demonstrations.
        </p>
      </div>

      {latest ? <RoundSummary round={latest} current /> : null}

      {data.canSchedule && <ScheduleCard data={data} onScheduled={reload} />}

      {!data.canSchedule && data.scheduleBlockedReason && !latest && (
        <p className="text-small text-text-muted">{data.scheduleBlockedReason}</p>
      )}

      {!latest && !data.canSchedule && (
        <EmptyState
          icon={MapPin}
          title="No site inspection yet"
          description="The TPA books the visit from this tab while the file is at the TPA desk."
        />
      )}

      {data.rounds.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier rounds</CardTitle>
            <CardDescription>A re-inspection is a new report. Earlier reports stay exactly as they were signed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.rounds.slice(1).map((r) => (
              <RoundSummary key={r.id} round={r} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RoundSummary({ round, current = false }: { round: InspectionRound; current?: boolean }) {
  const t = round.tally;
  const body = (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <Item label="Inspection status">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge kind="inspection" status={round.status} />
        </div>
      </Item>
      <Item label="Inspector">{round.inspectorName}</Item>
      <Item label="Date">
        Scheduled {fmt(round.scheduledFor)}
        <p className="text-caption text-text-muted">Inspected {round.inspectedAt ? fmt(round.inspectedAt) : '— not yet'}</p>
      </Item>
      <Item label="Recommendation">
        {round.recommendation && round.status === 'SUBMITTED' ? (
          <StatusBadge kind="recommendation" status={round.recommendation} />
        ) : round.recommendation ? (
          <span className="text-caption text-text-muted">Draft: {round.recommendation.toLowerCase()}</span>
        ) : (
          '—'
        )}
      </Item>
      <Item label="Photos">
        <span className="inline-flex items-center gap-1.5">
          <Camera className="size-3.5 text-text-muted" /> {round.photoCount}
        </span>
        {round.photoCategories.length > 0 && (
          <p className="text-caption text-text-muted">
            {round.photoCategories.map((c) => PHOTO_CATEGORY_LABEL[c as PhotoCategory] ?? c).join(', ')}
          </p>
        )}
      </Item>
      <Item label="Questions">
        <span className="inline-flex items-center gap-1.5">
          <ClipboardCheck className="size-3.5 text-text-muted" /> {t.answered}/{t.total} answered
        </span>
        <p className="text-caption text-text-muted">
          {t.satisfactory} satisfactory · {t.shortfall} shortfall · {t.objection} objection · {t.na} n/a
        </p>
      </Item>
      <Item label="Signature">
        {round.signedAt ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <FileSignature className="size-3.5 text-success" /> {round.signedByName}
            </span>
            <p className="text-caption text-text-muted">
              {SIGNATURE_METHOD_LABEL[round.signatureMethod as SignatureMethod] ?? round.signatureMethod} · {fmt(round.signedAt)}
            </p>
          </>
        ) : (
          <span className="text-text-muted">Not signed</span>
        )}
      </Item>
      <Item label="Location">
        <span className="font-mono text-caption">{formatCoordinates(round.latitude, round.longitude)}</span>
        <p className="text-caption text-text-muted">Demo coordinates</p>
      </Item>
    </div>
  );

  if (!current) {
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <Link href={`/inspections/${round.id}`} className="font-medium text-primary hover:underline">
            {round.inspectionNumber} · Round {round.round}
          </Link>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            Site inspection {round.inspectionNumber}
            {round.round > 1 && <Badge tone="outline" className="ml-2">Round {round.round}</Badge>}
          </CardTitle>
          <CardDescription>{round.siteAddress || '—'}</CardDescription>
        </div>
        <Button asChild variant={round.status === 'SUBMITTED' ? 'secondary' : 'primary'} size="sm">
          <Link href={`/inspections/${round.id}`}>
            {round.status === 'SUBMITTED' ? 'Open report' : 'Open inspection'} <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-caption uppercase tracking-wide text-text-subtle">{label}</p>
      <div className="mt-0.5 text-small text-text">{children}</div>
    </div>
  );
}

function ScheduleCard({
  data,
  onScheduled,
}: {
  data: ApplicationInspectionsPayload;
  onScheduled: () => Promise<void>;
}) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [inspectorId, setInspectorId] = React.useState(data.candidates[0]?.id ?? '');
  const [date, setDate] = React.useState(iso(tomorrow));
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<{ inspectionNumber: string; workflow: { message: string } }>(
        `/api/applications/${data.application.id}/site-inspection`,
        { inspectorId, scheduledFor: `${date}T10:00:00`, remarks, expectedSequence: data.expectedSequence }
      );
      toast.success(`${res.inspectionNumber} scheduled`, { description: res.workflow.message });
      await onScheduled();
    } catch (error) {
      if (error instanceof ApiCallError) {
        setErrors(error.fieldErrors());
        toast.error(error.message);
      } else toast.error('The inspection could not be scheduled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="size-4" aria-hidden />
          {data.rounds.length ? 'Schedule a re-inspection' : 'Schedule site inspection'}
        </CardTitle>
        <CardDescription>
          Books the visit, moves the file to the Site inspection desk and hands it to the inspector. The 27
          questions are copied onto the report as they read today.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Field label="Inspector" htmlFor="sInspector" required error={errors.inspectorId}>
          <select
            id="sInspector"
            className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text"
            value={inspectorId}
            onChange={(e) => setInspectorId(e.target.value)}
          >
            {data.candidates.length === 0 && <option value="">No TPA in this zone</option>}
            {data.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.designation ? ` — ${c.designation}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date of visit" htmlFor="sDate" required error={errors.scheduledFor}>
          <Input id="sDate" type="date" min={iso(today)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Remarks" htmlFor="sRemarks" hint="Optional — access, contact on site.">
          <Textarea id="sRemarks" rows={1} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between gap-3 md:col-span-3">
          <p className="text-caption text-text-muted">
            Site location (demo): <span className="font-mono">{formatCoordinates(data.demoLocation.latitude, data.demoLocation.longitude)}</span>
          </p>
          <Button variant="primary" loading={busy} disabled={!inspectorId || !date} onClick={() => void submit()}>
            <CalendarPlus /> Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
