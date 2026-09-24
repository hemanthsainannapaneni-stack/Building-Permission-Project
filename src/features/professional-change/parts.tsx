'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, History, PenTool, UserRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { COMPARISON_FIELDS, licenceValidOn, type ProfessionalSnapshot } from '@/lib/professional-change';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/features/proceedings/shared';
import type { Engagement } from './types';

const show = (key: keyof ProfessionalSnapshot, v: ProfessionalSnapshot) => {
  const value = v[key];
  if (key === 'validUpto') return value ? fmtDate(value as string) : 'No expiry recorded';
  return (value as string) || '—';
};

/**
 * Current professional ↓ proposed professional, field by field, as each stood
 * on the day of the request. Differences are marked; identical rows are not.
 */
export function ProfessionalComparison({
  current,
  proposed,
  on,
  approved,
}: {
  current: ProfessionalSnapshot;
  proposed: ProfessionalSnapshot;
  /** The request date — licence validity is judged on it. */
  on: string;
  approved: boolean;
}) {
  const valid = (p: ProfessionalSnapshot) => licenceValidOn(p.validUpto, new Date(on));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4" /> {approved ? 'Previous professional → new professional' : 'Current professional → proposed professional'}
        </CardTitle>
        <CardDescription>
          Particulars as they stood on the day of the request. Rows that differ are marked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stacked summary: who, then who next. */}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <Party label={approved ? 'Previous professional' : 'Current professional'} p={current} valid={valid(current)} tone="muted" />
          <ArrowDown className="mx-auto size-5 text-text-muted sm:-rotate-90" aria-hidden />
          <Party label={approved ? 'New professional (active)' : 'Proposed professional'} p={proposed} valid={valid(proposed)} tone="primary" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-small">
            <thead>
              <tr className="border-b border-border text-left text-caption text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Particular</th>
                <th className="py-1.5 pr-3 font-medium">{approved ? 'Previous' : 'Current'}</th>
                <th className="py-1.5 pr-3 font-medium">{approved ? 'New' : 'Proposed'}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FIELDS.map(({ key, label }) => {
                const a = show(key, current);
                const b = show(key, proposed);
                const differs = a !== b;
                return (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-text-muted">{label}</td>
                    <td className="py-1.5 pr-3 text-text">{a}</td>
                    <td className={cn('py-1.5 pr-3 text-text', differs && 'font-medium')}>
                      {b}
                      {differs && <span className="ml-1.5 text-caption text-primary">changed</span>}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="py-1.5 pr-3 text-text-muted">Licence in force on request date</td>
                <td className="py-1.5 pr-3">{valid(current) ? 'Yes' : <span className="text-danger">No</span>}</td>
                <td className="py-1.5 pr-3">{valid(proposed) ? 'Yes' : <span className="text-danger">No</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Party({ label, p, valid, tone }: { label: string; p: ProfessionalSnapshot; valid: boolean; tone: 'muted' | 'primary' }) {
  return (
    <div className={cn('rounded border px-3 py-2', tone === 'primary' ? 'border-primary/40 bg-primary/5' : 'border-border bg-surface-sunk')}>
      <p className="text-caption font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="font-medium text-text">{p.name || '—'}</p>
      <p className="text-caption text-text-muted">
        {p.licenceNo || 'No licence'} {p.licenceClass ? `· ${p.licenceClass}` : ''} {p.firmName ? `· ${p.firmName}` : ''}
        {!valid && <span className="ml-1 text-danger">· licence not in force</span>}
      </p>
    </div>
  );
}

/** Every professional who has held the file, newest first. Nothing is removed. */
export function EngagementHistory({ engagements }: { engagements: Engagement[] }) {
  const rows = [...engagements].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" /> Professional history
        </CardTitle>
        <CardDescription>
          Every technical professional who has held this file. A replaced professional stays on the record; only the active one may submit drawings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {rows.map((e) => (
            <li key={e.id} className={cn('border-l-2 pl-3', e.status === 'ACTIVE' ? 'border-primary' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{e.name}</span>
                <Badge tone={e.status === 'ACTIVE' ? 'success' : 'neutral'}>{e.status === 'ACTIVE' ? 'Active' : 'Superseded'}</Badge>
                {e.drawingRights ? (
                  <Badge tone="info">
                    <PenTool className="size-3" /> Drawing rights
                  </Badge>
                ) : (
                  <span className="text-caption text-text-muted">No drawing rights</span>
                )}
              </div>
              <p className="text-caption text-text-muted">
                {e.snapshot.licenceNo || 'No licence'}
                {e.snapshot.licenceClass ? ` · ${e.snapshot.licenceClass}` : ''}
                {e.snapshot.firmName ? ` · ${e.snapshot.firmName}` : ''}
              </p>
              <p className="text-small text-text">
                {fmtDate(e.engagedFrom)} — {e.engagedUntil ? fmtDate(e.engagedUntil) : 'present'}
                <span className="text-text-muted">
                  {' · '}
                  {e.source === 'ORIGINAL_FILING' ? 'Filed the application' : 'Engaged by '}
                  {e.broughtInBy && (
                    <Link href={`/professional-changes/${e.broughtInBy.id}`} className="text-primary hover:underline">
                      {e.broughtInBy.requestNumber}
                    </Link>
                  )}
                  {e.endedBy && (
                    <>
                      {' · replaced by '}
                      <Link href={`/professional-changes/${e.endedBy.id}`} className="text-primary hover:underline">
                        {e.endedBy.requestNumber}
                      </Link>
                    </>
                  )}
                </span>
              </p>
              {e.derived && <p className="text-caption text-text-muted">From the filing record — written to the history on the first change.</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
