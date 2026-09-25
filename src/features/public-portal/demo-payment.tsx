'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtRupees } from './format';
import { describeFailure, postPublic } from './client';

type Demand = { demandNumber: string; label: string; balance: number };
type Result = { paymentRef: string; status: string; statusLabel: string; amount: number; receiptNumber: string | null; message: string };

const OUTCOMES = [
  { value: 'SUCCESS', label: 'Payment successful' },
  { value: 'FAILED', label: 'Payment declined' },
  { value: 'CANCELLED', label: 'Payer cancels' },
] as const;

/**
 * The demonstration payment of an application's fee.
 *
 * It calls `/api/public/pay`, which runs the ordinary payment service against
 * the demo gateway. The three outcomes are the ones the demo gateway page
 * offers — success, declined, cancelled — so a demonstration can show the
 * failed path as easily as the happy one. Nothing here can name an amount: the
 * server pays the demand's own balance.
 */
export function DemoPayment({ applicationNumber, demands, defaultMobile }: { applicationNumber: string; demands: Demand[]; defaultMobile: string }) {
  const router = useRouter();
  const [demand, setDemand] = React.useState(demands[0]?.demandNumber ?? '');
  const [mobile, setMobile] = React.useState(defaultMobile);
  const [outcome, setOutcome] = React.useState<(typeof OUTCOMES)[number]['value']>('SUCCESS');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<Result | null>(null);

  const chosen = demands.find((d) => d.demandNumber === demand);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      const res = await postPublic<Result>('/api/public/pay', { applicationNumber, demandNumber: demand, mobile: mobile.trim(), outcome });
      setResult(res);
      router.refresh();
    } catch (err) {
      const f = describeFailure(err);
      setError(f.message);
      setFields(f.fields);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const ok = result.status === 'SUCCESS';
    const Icon = ok ? CheckCircle2 : XCircle;
    return (
      <div role="status" className={`rounded-xl border p-5 ${ok ? 'border-success/30 bg-success-bg' : 'border-warning/40 bg-warning-bg'}`}>
        <p className="flex items-center gap-2 text-lg font-semibold text-text">
          <Icon className={`size-5 ${ok ? 'text-success' : 'text-warning'}`} aria-hidden /> {result.statusLabel}
        </p>
        <p className="mt-1 text-small font-medium text-text">{result.message}</p>
        <dl className="mt-4 grid gap-3 text-body sm:grid-cols-3">
          <div>
            <dt className="text-caption text-text-muted">Payment reference</dt>
            <dd className="font-mono font-medium">{result.paymentRef}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">Amount</dt>
            <dd className="font-medium">{fmtRupees(result.amount)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">Receipt</dt>
            <dd className="font-mono font-medium">{result.receiptNumber ?? '—'}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" onClick={() => setResult(null)}>
            Make another demo payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-bg px-3 py-2 text-small font-medium text-text">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        Demo payment only — no real transaction will be processed.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dp-demand" required>
            Demand to pay
          </Label>
          <select
            id="dp-demand"
            value={demand}
            onChange={(e) => setDemand(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {demands.map((d) => (
              <option key={d.demandNumber} value={d.demandNumber}>
                {d.label} — {fmtRupees(d.balance)} due
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-mobile" required>
            Applicant’s mobile number
          </Label>
          <Input id="dp-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" maxLength={10} placeholder="Last 4 digits or full number" invalid={Boolean(fields.mobile)} aria-describedby={fields.mobile ? 'dp-mobile-error' : 'dp-mobile-hint'} autoComplete="off" />
          {fields.mobile ? (
            <p id="dp-mobile-error" role="alert" className="text-caption text-danger">
              {fields.mobile}
            </p>
          ) : (
            <p id="dp-mobile-hint" className="text-caption text-text-muted">
              Proves you hold the application. Demo control only.
            </p>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-small font-medium text-text">What should the demo gateway do?</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {OUTCOMES.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-body">
              <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="size-4 accent-[rgb(var(--primary))]" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" loading={busy} disabled={!chosen || mobile.trim().length === 0}>
        Make demo payment{chosen ? ` of ${fmtRupees(chosen.balance)}` : ''}
      </Button>
    </form>
  );
}
