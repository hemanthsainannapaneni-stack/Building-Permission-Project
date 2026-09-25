import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, CircleDot } from 'lucide-react';
import { getPublicApplicationStatus, type PublicApplicationStatus } from '@/server/public-portal/status';
import { sampleApplications } from '@/server/public-portal/samples';
import { pageRateLimit, param } from '@/server/public-portal/guard';
import { fmtDay, fmtInstant, fmtInstantTime } from '@/features/public-portal/format';
import { Facts, LoadFailedNotice, LookupForm, NotFoundNotice, PageFrame, Panel, StatusPill, ThrottledNotice, type Tone } from '@/features/public-portal/primitives';
import { SampleApplications } from '@/features/public-portal/samples';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Application Status' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, Tone> = { NOT_SUBMITTED: 'neutral', UNDER_PROCESS: 'info', WITH_APPLICANT: 'warning', APPROVED: 'success', NOT_APPROVED: 'danger', CLOSED: 'neutral' };

export default async function ApplicationStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = param(sp.ref);
  const mobile = param(sp.mobile);

  let record: PublicApplicationStatus | null = null;
  let state: 'idle' | 'found' | 'missing' | 'throttled' | 'error' = 'idle';
  let retryAfter = 60;

  if (ref) {
    const limit = await pageRateLimit('publicVerify');
    if (!limit.ok) {
      state = 'throttled';
      retryAfter = limit.retryAfterSeconds;
    } else {
      try {
        record = await getPublicApplicationStatus(ref, { mobile });
        state = record ? 'found' : 'missing';
      } catch (error) {
        console.error('[public/status] lookup failed', error);
        state = 'error';
      }
    }
  }

  const samples = state === 'idle' ? await sampleApplications({ take: 4 }).catch(() => []) : [];

  return (
    <PageFrame
      title="Search Your Application Status"
      intro="Enter the application number, or the proceeding number once a permission has been issued. Only public information is shown."
      crumbs={[{ label: 'Citizen Service' }]}
    >
      <Panel title="Find an application">
        <LookupForm
          action="/public/status"
          submitLabel="Search status"
          fields={[
            { name: 'ref', label: 'Application number or reference number', placeholder: 'e.g. the number on your acknowledgement', defaultValue: ref, required: true, hint: 'The complete number, exactly as printed.' },
            { name: 'mobile', label: 'Applicant’s mobile number (optional)', placeholder: 'Last 4 digits or full number', defaultValue: mobile, inputMode: 'numeric', maxLength: 10, hint: 'Adds the applicant’s name to the result.' },
          ]}
        />
      </Panel>

      {state === 'idle' && <SampleApplications items={samples} path="/public/status" />}
      {state === 'missing' && <NotFoundNotice what="application" hint="Check the number and try again. Draft applications and numbers that do not exist look the same from here." />}
      {state === 'throttled' && <ThrottledNotice seconds={retryAfter} />}
      {state === 'error' && <LoadFailedNotice retryHref={`/public/status?ref=${encodeURIComponent(ref)}`} />}

      {record && <StatusResult r={record} />}
    </PageFrame>
  );
}

function StatusResult({ r }: { r: PublicApplicationStatus }) {
  const tone = TONE[r.status] ?? 'info';
  return (
    <div className="space-y-6" aria-live="polite">
      <Panel
        id="result"
        title={`Application ${r.applicationNumber}`}
        description={r.permissionType}
        actions={<StatusPill tone={tone}>{r.statusLabel}</StatusPill>}
      >
        <Facts
          columns={3}
          items={[
            { label: 'Application number', value: <span className="font-mono">{r.applicationNumber}</span> },
            { label: 'Application type', value: r.permissionType },
            { label: 'Applicant', value: r.applicantName },
            { label: 'Application date', value: fmtInstant(r.submittedOn) === '—' ? 'Not yet submitted' : fmtInstant(r.submittedOn) },
            { label: 'Current status', value: r.statusLabel },
            { label: 'Current stage / desk', value: `${r.stage} — ${r.desk}` },
            { label: 'Shortfall', value: r.shortfall.label },
            { label: 'Payment status', value: r.paymentStatusLabel },
            { label: 'Approval status', value: r.approvalStatusLabel },
            { label: 'Proceeding (BPO) number', value: r.proceedingNumber ? <span className="font-mono">{r.proceedingNumber}</span> : 'Not yet issued' },
            { label: 'BPO status', value: r.bpoStatus === 'Issued' && r.bpoValidUntil ? `Issued · valid until ${fmtDay(r.bpoValidUntil)}` : r.bpoStatus },
            { label: 'Last updated', value: fmtInstantTime(r.lastUpdated) },
          ]}
        />
        {!r.mobileVerified && (
          <p className="mt-4 text-small text-text-muted">
            The applicant’s name is masked. Add the applicant’s mobile number to the search to see it.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3 border-t border-border/70 pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/public/pay-fees?ref=${encodeURIComponent(r.applicationNumber)}`}>Fees and payments</Link>
          </Button>
          {r.proceedingNumber && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/verify-order/${encodeURIComponent(r.proceedingNumber)}`}>Verify this permission</Link>
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Public timeline" description="When each step happened. Who took it, and what they wrote, is not shown.">
        <ol className="relative space-y-4 border-l-2 border-border pl-6">
          {r.timeline.map((t, i) => {
            const last = i === r.timeline.length - 1;
            const Icon = last ? CircleDot : CheckCircle2;
            return (
              <li key={`${t.at}-${t.label}`} className="relative">
                <span className={`absolute -left-[2.05rem] top-0.5 grid size-5 place-items-center rounded-full bg-surface ${last ? 'text-primary' : 'text-success'}`}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <p className="font-medium text-text">{t.label}</p>
                <p className="text-small text-text-muted">
                  <time dateTime={t.at}>{fmtInstantTime(t.at)}</time>
                </p>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
