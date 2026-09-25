import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicFeeRecord, type PublicFeeRecord } from '@/server/public-portal/status';
import { sampleApplications } from '@/server/public-portal/samples';
import { pageRateLimit, param } from '@/server/public-portal/guard';
import { DemoPayment } from '@/features/public-portal/demo-payment';
import { fmtDay, fmtInstantTime, fmtRupees } from '@/features/public-portal/format';
import { DemoBanner, Facts, LoadFailedNotice, LookupForm, NotFoundNotice, Notice, PageFrame, Panel, StatusPill, TableFrame, Td, Th, ThrottledNotice, type Tone } from '@/features/public-portal/primitives';
import { SampleApplications } from '@/features/public-portal/samples';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Pay Your Fees' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, Tone> = { NO_DEMAND: 'neutral', PAYMENT_DUE: 'warning', PART_PAID: 'warning', PAID: 'success', WAIVED: 'neutral' };
const ATTEMPT_TONE: Record<string, Tone> = { SUCCESS: 'success', FAILED: 'danger', CANCELLED: 'neutral', TIMEOUT: 'neutral', REFUNDED: 'info', PENDING: 'warning', PROCESSING: 'info', INITIATED: 'info' };

export default async function PayFeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = param(sp.ref);
  const mobile = param(sp.mobile);

  let record: PublicFeeRecord | null = null;
  let state: 'idle' | 'found' | 'missing' | 'throttled' | 'error' = 'idle';
  let retryAfter = 60;

  if (ref) {
    const limit = await pageRateLimit('publicVerify');
    if (!limit.ok) {
      state = 'throttled';
      retryAfter = limit.retryAfterSeconds;
    } else {
      try {
        record = await getPublicFeeRecord(ref, { mobile });
        state = record ? 'found' : 'missing';
      } catch (error) {
        console.error('[public/pay-fees] lookup failed', error);
        state = 'error';
      }
    }
  }
  const samples = state === 'idle' ? await sampleApplications({ payable: true, take: 4 }).catch(() => []) : [];

  return (
    <PageFrame
      title="Pay Your Fees"
      intro="Look up the fee demand and payment record for an application, and make a demonstration payment."
      crumbs={[{ label: 'Citizen Service' }]}
    >
      <DemoBanner>Demo payment only — no real transaction will be processed. Nirman uses a demonstration payment gateway; nothing here is connected to a bank, CFMS or a real payment service.</DemoBanner>

      <Panel title="Find the fee record">
        <LookupForm
          action="/public/pay-fees"
          submitLabel="Look up fees"
          fields={[
            { name: 'ref', label: 'Application number, demand number or payment reference', defaultValue: ref, required: true, placeholder: 'The complete number, exactly as printed' },
            { name: 'mobile', label: 'Applicant’s mobile number', defaultValue: mobile, inputMode: 'numeric', maxLength: 10, placeholder: 'Last 4 digits or full number', hint: 'Shows the applicant’s name, and is needed to make a demo payment.' },
          ]}
        />
      </Panel>

      {state === 'idle' && <SampleApplications items={samples} path="/public/pay-fees" />}
      {state === 'missing' && <NotFoundNotice what="fee record" hint="Check the number and try again. The search matches a complete application, demand or payment number." />}
      {state === 'throttled' && <ThrottledNotice seconds={retryAfter} />}
      {state === 'error' && <LoadFailedNotice retryHref={`/public/pay-fees?ref=${encodeURIComponent(ref)}`} />}

      {record && <FeeResult r={record} mobile={mobile} />}
    </PageFrame>
  );
}

function FeeResult({ r, mobile }: { r: PublicFeeRecord; mobile: string }) {
  const payable = r.demands.filter((d) => d.payBlocker === null && d.balance > 0);
  const blockers = [...new Set(r.demands.filter((d) => d.balance > 0 && d.payBlocker).map((d) => d.payBlocker as string))];

  return (
    <div className="space-y-6" aria-live="polite">
      <Panel
        id="fee-summary"
        title={`Application ${r.applicationNumber}`}
        description={r.permissionType}
        actions={<StatusPill tone={TONE[r.paymentStatus] ?? 'info'}>{r.paymentStatusLabel}</StatusPill>}
      >
        <Facts
          columns={4}
          items={[
            { label: 'Application number', value: <span className="font-mono">{r.applicationNumber}</span> },
            { label: 'Applicant', value: r.applicantName },
            { label: 'Total demanded', value: fmtRupees(r.totalDemanded) },
            { label: 'Paid', value: fmtRupees(r.totalPaid) },
            { label: 'Due amount', value: <span className={r.balance > 0 ? 'text-warning' : undefined}>{fmtRupees(r.balance)}</span> },
            { label: 'Payment status', value: r.paymentStatusLabel },
            { label: 'Last payment reference', value: r.payments[0] ? <span className="font-mono">{r.payments[0].paymentRef}</span> : 'None yet' },
          ]}
        />
        <div className="mt-5 flex flex-wrap gap-3 border-t border-border/70 pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/public/status?ref=${encodeURIComponent(r.applicationNumber)}${mobile ? `&mobile=${encodeURIComponent(mobile)}` : ''}`}>Application status</Link>
          </Button>
        </div>
      </Panel>

      <Panel title="Fee demands">
        {r.demands.length === 0 ? (
          <Notice tone="neutral" title="No fee demand has been raised for this application yet.">
            A demand appears here once the application’s documents are complete and the fee has been calculated.
          </Notice>
        ) : (
          <TableFrame caption="Fee demands for this application">
            <thead>
              <tr>
                <Th>Demand</Th>
                <Th>Fee type</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Due</Th>
                <Th>Status</Th>
                <Th>Issued</Th>
              </tr>
            </thead>
            <tbody>
              {r.demands.map((d) => (
                <tr key={d.demandNumber}>
                  <Td className="font-mono text-small">{d.demandNumber}</Td>
                  <Td>{d.kindLabel}</Td>
                  <Td className="text-right tabular-nums">{fmtRupees(d.totalAmount)}</Td>
                  <Td className="text-right tabular-nums">{fmtRupees(d.paidAmount)}</Td>
                  <Td className="text-right tabular-nums">{fmtRupees(d.balance)}</Td>
                  <Td>
                    <StatusPill tone={d.status === 'PAID' ? 'success' : d.status === 'CANCELLED' || d.status === 'WAIVED' ? 'neutral' : 'warning'}>{d.statusLabel}</StatusPill>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDay(d.issuedOn)}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Panel>

      <Panel title="Payment history">
        {r.payments.length === 0 ? (
          <Notice tone="neutral" title="No payment has been attempted yet.">
            Payments made against this application’s demands are listed here, newest first.
          </Notice>
        ) : (
          <TableFrame caption="Payment attempts for this application">
            <thead>
              <tr>
                <Th>Payment reference</Th>
                <Th>Demand</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Date</Th>
                <Th>Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {r.payments.map((p) => (
                <tr key={p.paymentRef}>
                  <Td className="font-mono text-small">
                    {p.paymentRef}
                    {p.isDemo && <span className="ml-2 rounded bg-warning-bg px-1.5 py-0.5 text-caption font-sans font-semibold text-warning">DEMO</span>}
                  </Td>
                  <Td className="font-mono text-small">{p.demandNumber}</Td>
                  <Td className="text-right tabular-nums">{fmtRupees(p.amount)}</Td>
                  <Td>
                    <StatusPill tone={ATTEMPT_TONE[p.status] ?? 'info'}>{p.statusLabel}</StatusPill>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtInstantTime(p.settledOn ?? p.startedOn)}</Td>
                  <Td className="font-mono text-small">{p.receiptNumber ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Panel>

      <Panel title="Demo payment" description="Pay a demand through the demonstration gateway.">
        {!r.hasBalance ? (
          <Notice tone="info" title="Nothing is due on this application.">
            Every issued demand has been paid, waived or cancelled.
          </Notice>
        ) : !r.demoPaymentAvailable ? (
          <Notice tone="warning" title="Demonstration payment is not available on this deployment.">
            Online payment here uses the demonstration gateway, which is off. Applicants pay from their own workspace’s Payments tab.
          </Notice>
        ) : payable.length === 0 ? (
          <Notice tone="warning" title="A payment cannot be made against this application right now.">
            {blockers.join(' ')}
          </Notice>
        ) : (
          <DemoPayment applicationNumber={r.applicationNumber} defaultMobile={mobile} demands={payable.map((d) => ({ demandNumber: d.demandNumber, label: `${d.kindLabel} ${d.demandNumber}`, balance: d.balance }))} />
        )}
      </Panel>
    </div>
  );
}
