'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldCheck,
  Send,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { api, ApiCallError } from '@/features/applications/api';
import { ORDER_STATUS, orderStatusLabel } from '@/lib/approval-orders';
import { cn } from '@/lib/utils';

/**
 * THE BUILDING PERMISSION ORDER, as the department works it.
 *
 * ── The lifecycle is visible as a line, not hidden in a badge ───────────
 *
 * Draft → Preview → Generated → Approved → Issued is five states, and the
 * question anybody opening this panel has is "where has it got to and what
 * happens next". A status badge answers half of that. The rail answers both,
 * and makes the one remaining step obvious without reading anything.
 *
 * ── Only the next legal step is offered ─────────────────────────────────
 *
 * The buttons come from `nextStates`, which the server computes from the same
 * transition table it enforces. A screen that offered Issue on a draft would
 * be a screen whose only feedback is an error toast.
 */

const RAIL = [
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.PREVIEW,
  ORDER_STATUS.GENERATED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.ISSUED,
] as const;

const ACTION_LABEL: Record<string, string> = {
  DRAFT: 'Return to draft',
  PREVIEW: 'Render a preview',
  GENERATED: 'Generate the final order',
  APPROVED: 'Approve for issue',
  ISSUED: 'Issue to the applicant',
};

export type OrderView = {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  issuedAt: string;
  validUntil: string | null;
  conditions: string[];
  hasDocument: boolean;
  verificationCode: string;
  revokedAt: string | null;
  revokeReason: string;
  applicationNumber: string;
  nextStates: string[];
  derived: Record<string, unknown>;
  building: Record<string, unknown>;
  clearances: Array<Record<string, unknown>>;
  fees: Array<Record<string, unknown>>;
};

export function OrderPanel({
  order,
  canAdvance,
  viewerIsApplicant,
}: {
  order: OrderView | null;
  /** Holds APPLICATION_APPROVE — the sanctioning desk. */
  canAdvance: boolean;
  viewerIsApplicant: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Building permission order</CardTitle>
          <CardDescription>
            No order exists for this application. One is drafted automatically when the application
            is approved.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const issued = order.status === ORDER_STATUS.ISSUED;
  const railIndex = RAIL.indexOf(order.status as (typeof RAIL)[number]);

  // The applicant may download only once it is released. A draft carries the
  // same number and the same particulars as the final, and one in their hands
  // is something that looks exactly like a permission and is not one.
  const canDownload = order.hasDocument && (!viewerIsApplicant || issued);

  async function advance(to: string) {
    setBusy(to);
    try {
      await api.post(`/api/orders/${order!.id}/advance`, { to, remarks: '' });
      toast.success(
        to === ORDER_STATUS.ISSUED
          ? `${order!.orderNumber} issued. The applicant has been told.`
          : `${order!.orderNumber} is now ${orderStatusLabel(to).toLowerCase()}.`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiCallError ? error.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {order.orderNumber}
            <Badge tone={order.revokedAt ? 'danger' : issued ? 'success' : 'warning'}>
              {order.revokedAt ? 'Revoked' : order.statusLabel}
            </Badge>
          </CardTitle>
          <CardDescription>
            {issued
              ? 'Issued. The applicant can download it and the public verification page confirms it.'
              : 'Not yet issued. The applicant cannot see this document.'}
          </CardDescription>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {canDownload && (
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/orders/${order.id}/pdf`} target="_blank" rel="noreferrer">
                <FileText />
                {issued ? 'Order' : 'Draft'}
              </a>
            </Button>
          )}

          {issued && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`/verify-order/${order.verificationCode}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ShieldCheck />
                    Verify
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                The public page printed on the order. It shows only what a stranger may see.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Where it has got to ──────────────────────────────────────── */}
        <ol className="flex flex-wrap items-center gap-1.5">
          {RAIL.map((state, i) => {
            const done = railIndex >= i;
            const current = railIndex === i;
            return (
              <li key={state} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                    current
                      ? 'border-primary bg-primary text-primary-text'
                      : done
                        ? 'border-success/30 bg-success-bg text-success'
                        : 'border-border bg-surface text-text-subtle'
                  )}
                >
                  {orderStatusLabel(state)}
                </span>
                {i < RAIL.length - 1 && (
                  <ArrowRight className="size-3 text-text-subtle" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Proceeding number" value={order.orderNumber} />
          <Fact label="Valid until" value={date(order.validUntil)} />
          <Fact label="Conditions" value={`${order.conditions.length} printed on the order`} />
          <Fact
            label="Clearances"
            value={
              order.clearances.length
                ? `${order.clearances.length} on record`
                : 'None on this application'
            }
          />
          <Fact label="Plot area" value={sqm(order.building.plotAreaSqm)} />
          <Fact label="Built-up area" value={sqm(order.building.builtUpAreaSqm)} />
          <Fact label="FSI" value={numOr(order.derived.fsi, 'Not assessed')} />
          <Fact
            label="Coverage"
            value={
              order.derived.coveragePercent != null
                ? `${Number(order.derived.coveragePercent).toFixed(2)} %`
                : 'Not assessed'
            }
          />
        </dl>

        {order.revokedAt && (
          <p className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-small text-text">
            Revoked on {date(order.revokedAt)}
            {order.revokeReason ? ` — ${order.revokeReason}` : ''}
          </p>
        )}

        {/* ── What happens next ────────────────────────────────────────── */}
        {canAdvance && !order.revokedAt && order.nextStates.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {order.nextStates.map((state) => {
              const isIssue = state === ORDER_STATUS.ISSUED;
              const isBack = RAIL.indexOf(state as (typeof RAIL)[number]) < railIndex;

              return (
                <Button
                  key={state}
                  size="sm"
                  variant={isIssue ? 'primary' : isBack ? 'ghost' : 'secondary'}
                  loading={busy === state}
                  disabled={busy !== null}
                  onClick={() => advance(state)}
                >
                  {isIssue ? <Send /> : isBack ? <RefreshCw /> : <CheckCircle2 />}
                  {ACTION_LABEL[state] ?? orderStatusLabel(state)}
                </Button>
              );
            })}
          </div>
        )}

        {canAdvance && order.status === ORDER_STATUS.APPROVED && (
          <p className="text-caption text-text-muted">
            Issuing releases the order to the applicant and notifies them. It cannot be undone — an
            issued order is revoked, never withdrawn.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-text">{value}</dd>
    </div>
  );
}

const date = (value: string | null): string =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

/** An unmeasured area shows a dash, never a zero that looks like a measurement. */
const sqm = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-IN')} sq m` : '—';
};

const numOr = (v: unknown, fallback: string): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : fallback;
};
