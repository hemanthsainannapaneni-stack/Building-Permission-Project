'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileBadge2, FileText, Info, Lightbulb, Plus } from 'lucide-react';
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
import { stageName } from '@/lib/workflow';
import { cn } from '@/lib/utils';
import { NocActionButtons } from './noc-dialogs';
import type { ApplicationNocsPayload, AvailableNocType, TabNoc } from './types';

export const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * The application's NOCs tab.
 *
 * Opens with the four figures the brief asks for — Required, Received,
 * Verified, Pending — then one card per NOC with the moves the SERVER says the
 * caller may make. The client decides nothing about who may act: the payload
 * carries `officerMoves` / `applicantMoves`, computed by the same rules the
 * POST re-checks.
 */
export function NocTab({ initial }: { initial: ApplicationNocsPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial);

  const reload = async () => {
    setData(await api.get<ApplicationNocsPayload>(`/api/applications/${data.application.id}/nocs`));
    router.refresh();
  };

  const { tally, permissions } = data;
  const canOpen = (permissions.isDesk || permissions.isApplicant) && data.available.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile label="Required" value={tally.required} hint={tally.undetermined ? `${tally.undetermined} not yet determined` : `${tally.notRequired} ruled out`} tone="warning" />
        <Tile label="Received" value={tally.received} hint="Awaiting verification" tone="purple" />
        <Tile label="Verified" value={tally.verified} tone="success" />
        <Tile label="Pending" value={tally.pending} hint="Not yet verified" tone={tally.pending ? 'danger' : 'neutral'} />
      </div>

      {permissions.deskReason && !permissions.isDesk && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunk px-3 py-2 text-small text-text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          {permissions.deskReason}
        </p>
      )}

      {data.nocs.length === 0 && !canOpen && (
        <EmptyState
          icon={FileBadge2}
          title="No NOCs on this application"
          description="A NOC is opened by the reviewing desk when the file needs one, or declared by the applicant."
        />
      )}

      {data.nocs.map((noc) => (
        <NocCard key={noc.id} noc={noc} demoDocumentAllowed={permissions.demoDocumentAllowed} onChanged={reload} />
      ))}

      {canOpen && <OpenNocCard data={data} onOpened={reload} />}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone: 'warning' | 'purple' | 'success' | 'danger' | 'neutral' }) {
  const ring: Record<typeof tone, string> = {
    warning: 'border-l-warning',
    purple: 'border-l-purple',
    success: 'border-l-success',
    danger: 'border-l-danger',
    neutral: 'border-l-border-strong',
  };
  return (
    <div className={cn('rounded-lg border border-border border-l-4 bg-surface px-3.5 py-2.5 shadow-subtle', ring[tone])}>
      <p className="text-caption font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      {hint && <p className="text-caption text-text-muted">{hint}</p>}
    </div>
  );
}

function NocCard({ noc, demoDocumentAllowed, onChanged }: { noc: TabNoc; demoDocumentAllowed: boolean; onChanged: () => Promise<void> }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {noc.nocType.name}
            <StatusBadge kind="noc" status={noc.status} />
            {noc.isRequired === null && <Badge tone="outline">Requirement not yet determined</Badge>}
          </CardTitle>
          <CardDescription>
            <Link href={`/nocs/${noc.id}`} className="font-medium text-primary hover:underline">
              {noc.nocNumber}
            </Link>{' '}
            · {noc.authority || 'Authority not recorded'}
          </CardDescription>
        </div>
        <NocActionButtons
          noc={noc}
          officerMoves={noc.officerMoves}
          applicantMoves={noc.applicantMoves}
          demoDocumentAllowed={demoDocumentAllowed}
          onDone={onChanged}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-x-6 gap-y-2.5 text-small sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Required">{noc.isRequired === null ? 'To be determined' : noc.isRequired ? 'Yes' : 'No'}</Item>
          <Item label="Application reference">{noc.applicationReference || '—'}</Item>
          <Item label="Applied">{fmtDate(noc.appliedDate)}</Item>
          <Item label="NOC number">{noc.referenceNumber || '—'}</Item>
          <Item label="Issued">{fmtDate(noc.issuedDate)}</Item>
          <Item label="Expiry">{fmtDate(noc.expiryDate)}</Item>
          <Item label="Document">
            {noc.hasDocument ? (
              <a href={`/api/nocs/${noc.id}/document`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="size-3.5" />
                {noc.isDemoDocument ? 'Demo placeholder' : noc.fileName || 'Certificate'}
              </a>
            ) : (
              '—'
            )}
          </Item>
          <Item label="Verified">
            {noc.verifiedAt ? (
              <>
                {noc.verifiedByName}
                <span className="block text-caption text-text-muted">
                  {noc.verifiedByRoleKey} · {fmtDate(noc.verifiedAt)}
                </span>
              </>
            ) : (
              '—'
            )}
          </Item>
        </dl>

        {noc.remarks && (
          <p className="rounded border border-border bg-surface-sunk px-3 py-2 text-small">
            <span className="font-medium">Department{noc.reviewedStageCode ? ` (${stageName(noc.reviewedStageCode)})` : ''}:</span> {noc.remarks}
          </p>
        )}
        {noc.applicantRemarks && (
          <p className="rounded border border-border bg-surface-sunk px-3 py-2 text-small">
            <span className="font-medium">Applicant:</span> {noc.applicantRemarks}
          </p>
        )}
        {noc.officerMoves.includes('VERIFY') && noc.verificationProblems.length > 0 && (
          <p className="text-caption text-danger">Cannot be verified yet: {noc.verificationProblems.join(' ')}</p>
        )}
        <Link href={`/nocs/${noc.id}`} className="inline-flex items-center gap-1 text-small text-primary hover:underline">
          Full history <ArrowRight className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

/** Open a NOC on this file: decided by the desk, or declared by the applicant. */
function OpenNocCard({ data, onOpened }: { data: ApplicationNocsPayload; onOpened: () => Promise<void> }) {
  const asDesk = data.permissions.isDesk;
  const [typeId, setTypeId] = React.useState(data.available[0]?.id ?? '');
  const type: AvailableNocType | undefined = data.available.find((t) => t.id === typeId);
  const [authority, setAuthority] = React.useState(type?.authority ?? '');
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState<'' | 'required' | 'not'>('');

  React.useEffect(() => setAuthority(type?.authority ?? ''), [type?.authority]);

  async function open(required: boolean) {
    setBusy(required ? 'required' : 'not');
    try {
      await api.post(`/api/applications/${data.application.id}/nocs`, {
        nocTypeId: typeId,
        required: asDesk ? required : undefined,
        authority,
        remarks,
      });
      toast.success(`${type?.name ?? 'NOC'} opened`);
      setRemarks('');
      await onOpened();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'The NOC could not be opened.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" /> {asDesk ? 'Add a NOC requirement' : 'Declare a NOC'}
        </CardTitle>
        <CardDescription>
          {asDesk
            ? 'Record whether this file needs the NOC. Nothing decides this automatically — it is your determination, and it is recorded against your desk.'
            : 'Tell the department about a NOC this proposal needs, or one you already hold. The reviewing desk determines whether it is required.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="NOC" htmlFor="open-noc-type">
            <select
              id="open-noc-type"
              className="h-9 w-full rounded border border-border-strong bg-surface px-2 text-small text-text"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {data.available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Issuing authority" htmlFor="open-noc-authority">
            <Input id="open-noc-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} />
          </Field>
        </div>
        {type && type.suggestedBy.length > 0 && (
          <p className="flex items-start gap-2 rounded border border-info/30 bg-info-bg px-3 py-2 text-small text-text">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-info" />
            The applicant answered YES to checklist question{type.suggestedBy.length > 1 ? 's' : ''}{' '}
            {type.suggestedBy.join(', ')}, which concern{type.suggestedBy.length > 1 ? '' : 's'} this NOC. A hint only — the determination is the desk’s.
          </p>
        )}
        <Field label="Remarks" htmlFor="open-noc-remarks" hint={asDesk ? 'Required when marking Not Required.' : 'Optional.'}>
          <Textarea id="open-noc-remarks" rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {asDesk ? (
            <>
              <Button variant="primary" onClick={() => open(true)} loading={busy === 'required'} disabled={!!busy || !typeId}>
                Mark Required
              </Button>
              <Button onClick={() => open(false)} loading={busy === 'not'} disabled={!!busy || !typeId || !remarks.trim()}>
                Mark Not Required
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => open(true)} loading={busy === 'required'} disabled={!!busy || !typeId}>
              Declare NOC
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
