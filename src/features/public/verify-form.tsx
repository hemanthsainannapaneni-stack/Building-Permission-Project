'use client';

import * as React from 'react';
import { Search, ShieldCheck, ShieldAlert, ShieldX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The public verification form.
 *
 * ── Written for somebody who is not a user of this system ───────────────
 *
 * The reader is a bank clerk, a buyer's advocate, a neighbour or a contractor.
 * They have a piece of paper and one question: is this real. So the page says
 * yes or no in the first line, in words, and puts the particulars underneath
 * for the person who wants to check them against the document in their hand.
 *
 * ── It never explains why something was not found ───────────────────────
 *
 * "No record matches that reference" is the only negative answer, whether the
 * reference does not exist, was mistyped, or belongs to an application that is
 * not public. Distinguishing those would answer a question this page is not
 * willing to answer.
 */

type Record = {
  applicationNumber: string;
  permissionType: string;
  submittedOn: string | null;
  status: string;
  statusLabel: string;
  approvedOn: string | null;
  proceedingNumber: string | null;
  orderStatus: string | null;
  orderStatusLabel: string | null;
  validUntil: string | null;
  ownerName: string | null;
  locality: string | null;
  isRevoked: boolean;
};

type Result = { found: boolean; record: Record | null; reason: string | null };

export function VerifyForm({ initialReference = '' }: { initialReference?: string }) {
  const [reference, setReference] = React.useState(initialReference);
  const [result, setResult] = React.useState<Result | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const lookup = React.useCallback(async (ref: string) => {
    const trimmed = ref.trim();
    if (!trimmed) return;

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/public/verify?ref=${encodeURIComponent(trimmed)}`);

      if (response.status === 429) {
        setError('Too many lookups from this connection. Please wait a minute and try again.');
        setResult(null);
        return;
      }

      if (!response.ok) throw new Error('lookup failed');
      setResult((await response.json()) as Result);
    } catch {
      setError('The verification service could not be reached. Please try again shortly.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // A link printed on an order arrives with the code in the path. Somebody who
  // followed it has already asked their question; making them press a button
  // to repeat it would be pure ceremony.
  React.useEffect(() => {
    if (initialReference) void lookup(initialReference);
  }, [initialReference, lookup]);

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(reference);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
            aria-hidden
          />
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Application number or proceeding number"
            aria-label="Application number or proceeding number"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="primary" loading={loading} disabled={!reference.trim()}>
          Verify
        </Button>
      </form>

      {error && (
        <p className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}

      {loading && !result && (
        <p className="flex items-center gap-2 text-small text-text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking the register…
        </p>
      )}

      {result && !loading && <Answer result={result} />}
    </div>
  );
}

function Answer({ result }: { result: Result }) {
  if (!result.found || !result.record) {
    return (
      <div className="rounded border border-border bg-surface-sunk p-4">
        <p className="flex items-center gap-2 font-medium text-text">
          <ShieldX className="size-5 text-text-muted" aria-hidden />
          No record matches that reference
        </p>
        <p className="mt-1.5 text-small text-text-muted">
          Check the number against the document you are holding. Only applications filed through
          this system can be verified here.
        </p>
      </div>
    );
  }

  const r = result.record;
  const granted = r.status === 'APPROVED' && r.proceedingNumber && !r.isRevoked;

  return (
    <div
      className={cn(
        'rounded border p-4',
        r.isRevoked
          ? 'border-danger/40 bg-danger-bg/40'
          : granted
            ? 'border-success/40 bg-success-bg/40'
            : 'border-border bg-surface-sunk'
      )}
    >
      <p className="flex items-center gap-2 text-body font-medium text-text">
        {r.isRevoked ? (
          <ShieldAlert className="size-5 text-danger" aria-hidden />
        ) : granted ? (
          <ShieldCheck className="size-5 text-success" aria-hidden />
        ) : (
          <ShieldAlert className="size-5 text-text-muted" aria-hidden />
        )}
        {r.isRevoked
          ? 'This permission has been revoked'
          : granted
            ? 'A building permission has been granted for this application'
            : 'This application exists and has not been decided'}
      </p>

      <dl className="mt-3.5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Application number" value={r.applicationNumber} />
        <Fact label="Permission type" value={r.permissionType} />
        <Fact label="Submitted on" value={date(r.submittedOn)} />
        <Fact
          label="Current status"
          value={<Badge tone={granted ? 'success' : 'info'}>{r.statusLabel}</Badge>}
        />

        {r.proceedingNumber && (
          <>
            <Fact label="Proceeding number" value={r.proceedingNumber} />
            <Fact label="Approved on" value={date(r.approvedOn)} />
            <Fact
              label="Permission status"
              value={
                <Badge tone={r.isRevoked ? 'danger' : 'success'}>
                  {r.isRevoked ? 'Revoked' : (r.orderStatusLabel ?? '—')}
                </Badge>
              }
            />
            <Fact label="Valid until" value={date(r.validUntil)} />
            {r.ownerName && <Fact label="Owner" value={r.ownerName} />}
            {r.locality && <Fact label="Locality" value={r.locality} />}
          </>
        )}
      </dl>

      {!granted && !r.isRevoked && (
        <p className="mt-3.5 border-t border-border pt-3 text-caption text-text-muted">
          No building permission has been issued for this application. Anything presented as a
          permission for it should not be relied on.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-text">{value}</dd>
    </div>
  );
}

const date = (value: string | null): string =>
  value
    ? new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';
