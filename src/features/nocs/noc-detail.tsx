'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, History, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { api } from '@/features/applications/api';
import { NOC_ACTION_LABEL, NOC_STATUS_LABEL, type NocAction, type NocStatus } from '@/lib/noc';
import { NocActionButtons } from './noc-dialogs';
import { fmtDate } from './noc-tab';
import type { NocDetail } from './types';

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Opened',
  EXPIRE: 'Validity ended',
  ...NOC_ACTION_LABEL,
};

/** One NOC: particulars, certificate, the desk's decision and the full history. */
export function NocDetailView({ initial }: { initial: NocDetail }) {
  const router = useRouter();
  const [noc, setNoc] = React.useState(initial);

  const reload = async () => {
    setNoc(await api.get<NocDetail>(`/api/nocs/${noc.id}`));
    router.refresh();
  };

  const { permissions } = noc;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {noc.nocType.name} <StatusBadge kind="noc" status={noc.status} />
            </CardTitle>
            <CardDescription>
              <Link href={`/applications/${noc.application.id}?tab=nocs`} className="text-primary hover:underline">
                {noc.application.applicationNumber}
              </Link>{' '}
              · {noc.application.owner || 'Owner not recorded'} · at {noc.application.currentDesk}
            </CardDescription>
          </div>
          <NocActionButtons
            noc={noc}
            officerMoves={permissions.officerMoves as NocAction[]}
            applicantMoves={permissions.applicantMoves as NocAction[]}
            demoDocumentAllowed={permissions.demoDocumentAllowed}
            onDone={reload}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {permissions.deskReason && (
            <p className="flex items-start gap-2 text-small text-text-muted">
              <Info className="mt-0.5 size-4 shrink-0" /> {permissions.deskReason}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Register number">{noc.nocNumber}</Item>
            <Item label="NOC type">{noc.nocType.name}</Item>
            <Item label="Required">{noc.isRequired === null ? 'To be determined' : noc.isRequired ? 'Yes' : 'No'}</Item>
            <Item label="Authority">{noc.authority || '—'}</Item>
            <Item label="Application reference">{noc.applicationReference || '—'}</Item>
            <Item label="NOC number">{noc.referenceNumber || '—'}</Item>
            <Item label="Applied date">{fmtDate(noc.appliedDate)}</Item>
            <Item label="Issued date">{fmtDate(noc.issuedDate)}</Item>
            <Item label="Expiry date">{fmtDate(noc.expiryDate)}</Item>
            <Item label="Document">
              {noc.hasDocument ? (
                <a
                  href={`/api/nocs/${noc.id}/document`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <FileText className="size-3.5" />
                  {noc.isDemoDocument ? 'Demo placeholder certificate' : noc.fileName}
                </a>
              ) : (
                '—'
              )}
            </Item>
            <Item label="Verified by">
              {noc.verifiedAt ? `${noc.verifiedByName} (${noc.verifiedByRoleKey})` : '—'}
            </Item>
            <Item label="Verified date">{fmtDate(noc.verifiedAt)}</Item>
          </dl>
          {noc.remarks && (
            <p className="rounded border border-border bg-surface-sunk px-3 py-2 text-small">
              <span className="font-medium">Department remarks:</span> {noc.remarks}
            </p>
          )}
          {noc.applicantRemarks && (
            <p className="rounded border border-border bg-surface-sunk px-3 py-2 text-small">
              <span className="font-medium">Applicant remarks:</span> {noc.applicantRemarks}
            </p>
          )}
          {noc.verificationProblems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-caption text-danger">
              {noc.verificationProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" /> History
          </CardTitle>
          <CardDescription>Every move on this NOC, newest first. The audit log carries the same entries.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {noc.events.map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3">
                <p className="text-small font-medium text-text">
                  {EVENT_LABEL[e.action] ?? e.action}
                  <span className="font-normal text-text-muted">
                    {' '}
                    — {e.fromStatus ? `${NOC_STATUS_LABEL[e.fromStatus as NocStatus] ?? e.fromStatus} → ` : ''}
                    {NOC_STATUS_LABEL[e.toStatus as NocStatus] ?? e.toStatus}
                  </span>
                </p>
                <p className="text-caption text-text-muted">
                  {e.actorName}
                  {e.actorRoleKey && e.actorRoleKey !== 'SYSTEM' ? ` (${e.actorRoleKey})` : ''}
                  {e.stageName ? ` · at ${e.stageName}` : ''} ·{' '}
                  {new Date(e.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                {e.remarks && <p className="mt-0.5 text-small text-text">{e.remarks}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
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
