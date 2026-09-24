import Link from 'next/link';
import { AlertTriangle, ClipboardCheck, Clock, FileBadge2 } from 'lucide-react';
import {
  Icon3DStack,
  Icon3DActivity,
  Icon3DShieldCheck,
  Icon3DCircleSlash,
  Icon3DAlertOctagon,
  Icon3DHourglass,
  Icon3DTimer,
  Icon3DGauge,
  Icon3DCoins,
  Icon3DLandmark,
  Icon3DCircleDollar,
  Icon3DTrendingUp,
  Icon3DFileEdit,
} from '@/components/ui/icons-3d';
import { KpiCard } from '@/components/common/kpi-card';
import { Badge } from '@/components/ui/badge';
import { statusMeta } from '@/lib/status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import { formatMoney, formatMoneyCompact } from '@/lib/utils';
import type { ConsolidatedView, DashboardData, ActivityEntry } from '@/server/services/analytics';
import { BarList, DonutChart, ProgressBar, TrendChart, type Slice, type Tone } from './charts';
import { ActivityFeed, Panel, SectionHeading, StatRow, WorkloadTable } from './panels';
import {
  AccountsPanel,
  ApplicantSidePanel,
  DeskConsolidation,
  FilersPanel,
  PipelineStrip,
} from './consolidated';

/**
 * The dashboards.
 *
 * ── Every figure on every one of these is a database count ───────────────
 *
 * There is no constant in this file that a user could mistake for data. The
 * `DashboardData` these components render comes from
 * `src/server/services/analytics.ts`, which is scoped to the signed-in user, so
 * the total an LTP sees counts their own files and the total a Commissioner
 * sees counts the city — and both agree with the register the tile links to,
 * because both are the same query.
 *
 * ── Why the dashboards differ by role ────────────────────────────────────
 *
 * A Commissioner opening a queue of eleven thousand scanned documents learns
 * nothing; a TPA looking at a citywide approval-rate trend learns nothing
 * either. Each audience gets the figures that change what they do next, in the
 * order they would ask for them, and the shared panels keep them recognisably
 * the same product.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shared pieces
// ═══════════════════════════════════════════════════════════════════════════

/** The status donut, grouped into the vocabulary a person actually uses. */
function statusSlices(data: DashboardData): Slice[] {
  const b = data.applications.byBucket;
  return [
    { key: 'draft', label: 'Draft', value: b.draft ?? 0, tone: 'neutral' },
    {
      key: 'preparing',
      label: 'Preparing (drawings, documents)',
      value:
        (b.scrutinyFailed ?? 0) + (b.scrutinyPassed ?? 0) + (b.documentsPending ?? 0),
      tone: 'purple',
    },
    { key: 'payment', label: 'Awaiting payment', value: b.paymentPending ?? 0, tone: 'warning' },
    { key: 'review', label: 'Under departmental review', value: b.underReview ?? 0, tone: 'info' },
    { key: 'shortfall', label: 'With the applicant (shortfall)', value: b.shortfall ?? 0, tone: 'danger' },
    { key: 'approved', label: 'Approved', value: data.applications.approved, tone: 'success' },
    { key: 'rejected', label: 'Rejected', value: data.applications.rejected, tone: 'danger' },
  ];
}

/** Where the files physically are, desk by desk. */
function stageRows(data: DashboardData) {
  const TONE_BY_STAGE: Record<string, Tone> = {
    LTP_DRAFT: 'neutral',
    LTP_DRAWING: 'neutral',
    LTP_DOCUMENTS: 'neutral',
    LTP_PAYMENT: 'warning',
    LTP_SHORTFALL_ACTION: 'danger',
    TPA_REVIEW: 'info',
    ZAD_ZDD_REVIEW: 'info',
    ZJD_REVIEW: 'info',
    DIRECTOR_DP_REVIEW: 'primary',
    ADDL_COMMISSIONER_REVIEW: 'primary',
    COMMISSIONER_REVIEW: 'primary',
    CLOSED_APPROVED: 'success',
    CLOSED_REJECTED: 'danger',
  };

  return data.applications.byStage.map((s) => ({
    key: s.code,
    label: s.label,
    value: s.count,
    tone: TONE_BY_STAGE[s.code] ?? 'neutral',
  }));
}

const TREND_SERIES = [
  { key: 'created', label: 'Started', tone: 'neutral' as Tone },
  { key: 'submitted', label: 'Filed', tone: 'info' as Tone },
  { key: 'approved', label: 'Approved', tone: 'success' as Tone },
  { key: 'rejected', label: 'Rejected', tone: 'danger' as Tone },
];

/** Fees and payments, in the four figures a reader asks for in order. */
function MoneyPanels({ data }: { data: DashboardData }) {
  const { finance } = data;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="Fees and collection"
        action={{ href: '/payments', label: 'Payments register' }}
      >
        <ProgressBar
          value={finance.collected}
          total={finance.generated}
          tone="success"
          label="Collected against demands raised"
          valueLabel={`${formatMoney(finance.collected)} of ${formatMoney(finance.generated)}`}
        />

        <div className="mt-3">
          <StatRow
            label="Demands issued"
            value={finance.demandsIssued}
            hint={finance.shortfallDemands ? `${finance.shortfallDemands} raised by a shortfall` : undefined}
          />
          <StatRow
            label="Outstanding"
            value={formatMoney(finance.outstanding)}
            tone={finance.outstanding > 0 ? 'warning' : 'neutral'}
          />
          <StatRow label="Receipts issued" value={finance.receipts} />
        </div>
      </Panel>

      <Panel title="Payment attempts">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-semibold leading-none tabular-nums text-text">
            {finance.payments.successRate}%
          </span>
          <span className="text-small text-text-muted">settlement success rate</span>
        </div>

        <div className="mt-3">
          <StatRow label="Settled" value={finance.payments.successful} tone="success" />
          <StatRow label="Declined" value={finance.payments.failed} tone={finance.payments.failed ? 'danger' : 'neutral'} />
          <StatRow
            label="In flight"
            value={finance.payments.pending}
            tone={finance.payments.pending ? 'info' : 'neutral'}
          />
          <StatRow
            label="Cancelled or timed out"
            value={finance.payments.cancelled}
          />
        </div>
      </Panel>
    </div>
  );
}

/** Scrutiny and shortfalls, side by side — the two sources of rework. */
function QualityPanels({ data }: { data: DashboardData }) {
  const { scrutiny, shortfalls } = data;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Automated scrutiny">
        <DonutChart
          totalLabel="Runs"
          slices={[
            { key: 'pass', label: 'Passed', value: scrutiny.passed, tone: 'success' },
            { key: 'fail', label: 'Failed', value: scrutiny.failed, tone: 'danger' },
            { key: 'running', label: 'Queued or running', value: scrutiny.running, tone: 'info' },
            { key: 'errored', label: 'Errored', value: scrutiny.errored, tone: 'warning' },
          ]}
          height={168}
        />

        <div className="mt-3">
          <StatRow
            label="Awaiting a corrected drawing"
            value={scrutiny.awaitingCorrection}
            tone={scrutiny.awaitingCorrection ? 'warning' : 'neutral'}
            href="/applications?bucket=scrutinyFailed"
          />
          <StatRow
            label="Critical findings"
            value={scrutiny.issues.critical}
            tone={scrutiny.issues.critical ? 'danger' : 'neutral'}
          />
          <StatRow label="Major findings" value={scrutiny.issues.major} />
        </div>
      </Panel>

      <Panel
        title="Shortfalls"
        action={{ href: '/shortfalls', label: 'Shortfall register' }}
      >
        <BarList
          emptyLabel="No open shortfalls."
          rows={[
            { key: 'DOCUMENT', label: 'Document', value: shortfalls.byKind.DOCUMENT ?? 0, tone: 'info' },
            { key: 'FEE', label: 'Fee', value: shortfalls.byKind.FEE ?? 0, tone: 'warning' },
            { key: 'TECHNICAL', label: 'Technical', value: shortfalls.byKind.TECHNICAL ?? 0, tone: 'purple' },
            { key: 'CLARIFICATION', label: 'Clarification', value: shortfalls.byKind.CLARIFICATION ?? 0, tone: 'neutral' },
            { key: 'OTHER', label: 'Other', value: shortfalls.byKind.OTHER ?? 0, tone: 'neutral' },
          ]}
        />

        <div className="mt-3">
          <StatRow label="Open" value={shortfalls.open} tone={shortfalls.open ? 'warning' : 'neutral'} />
          <StatRow label="Resolved" value={shortfalls.resolved} tone="success" />
          <StatRow
            label="Blocking / reported"
            value={`${shortfalls.byMode.blocking} / ${shortfalls.byMode.reported}`}
          />
          <StatRow
            label="Awaiting an officer's verdict"
            value={shortfalls.awaitingReview}
            tone={shortfalls.awaitingReview ? 'info' : 'neutral'}
          />
          <StatRow
            label="Pending notification"
            value={shortfalls.neverNotified}
            tone={shortfalls.neverNotified ? 'danger' : 'neutral'}
          />
        </div>
      </Panel>
    </div>
  );
}

/** Where the shortfalls were raised — pendency by desk, for a supervisor. */
function ShortfallsByStage({ data }: { data: DashboardData }) {
  return (
    <Panel title="Open shortfalls by desk">
      <BarList
        emptyLabel="Nothing outstanding at any desk."
        rows={data.shortfalls.byStage.map((s) => ({
          key: s.code,
          label: s.label,
          value: s.count,
          tone: 'warning' as Tone,
        }))}
      />
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Super Admin — the whole system
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The System Administrator's view: everything, in one place.
 *
 * Administrative visibility, and nothing more. Seeing every application does
 * not confer the power to decide one — approving still requires the workflow
 * to be at the Commissioner's desk and the action to be recorded with an
 * actor, remarks and an audit row, exactly as it does for the Commissioner.
 */
export function AdminDashboard({
  data,
  consolidated,
  activity,
}: {
  data: DashboardData;
  /** What every other role would see, gathered for the one login that sees all. */
  consolidated: ConsolidatedView;
  activity: ActivityEntry[];
}) {
  const { applications, finance, sla, shortfalls, approvals } = data;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col xl:flex-row gap-6">
        <div className="xl:w-3/4 space-y-5">
          <div className="space-y-1.5">
            <SectionHeading title="Caseload" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Total applications" value={applications.total} icon={Icon3DStack} href="/applications" tone="cyan" />
              <KpiCard
                label="In progress"
                value={applications.inProgress}
                tone="blue"
                icon={Icon3DActivity}
              />
              <KpiCard
                label="Approved"
                value={applications.approved}
                tone="emerald"
                icon={Icon3DShieldCheck}
                href="/applications?bucket=approved"
              />
              <KpiCard
                label="Rejected"
                value={applications.rejected}
                tone="rose"
                icon={Icon3DCircleSlash}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionHeading title="Attention & SLA" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard
                label="Open shortfalls"
                value={shortfalls.open}
                tone="amber"
                hint={shortfalls.overdue ? `${shortfalls.overdue} overdue` : undefined}
                icon={Icon3DAlertOctagon}
                href="/shortfalls"
              />
              <KpiCard
                label="NOCs pending"
                value={data.nocs.pending}
                tone="amber"
                icon={Icon3DFileEdit}
                hint={data.nocs.awaitingVerification ? `${data.nocs.awaitingVerification} awaiting verification` : 'Not yet verified'}
                href="/nocs?status=OUTSTANDING"
              />
              <KpiCard
                label="Overdue tasks"
                value={sla.overdue}
                tone="red"
                icon={Icon3DHourglass}
                href="/tasks?filter=overdue"
              />
              <KpiCard
                label="Due soon"
                value={sla.dueSoon}
                tone="orange"
                icon={Icon3DTimer}
                href="/tasks?filter=due-soon"
              />
              <KpiCard
                label="Average time to decide"
                value={sla.averageDaysToClose === null ? '—' : `${sla.averageDaysToClose} d`}
                tone="indigo"
                icon={Icon3DGauge}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionHeading title="Permissions & Notices" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Approval pending"
                value={approvals.approvalPending}
                tone="amber"
                icon={Icon3DFileEdit}
                hint="At a desk that can approve"
                href="/applications"
              />
              <KpiCard
                label="BPO issued"
                value={approvals.ordersIssued}
                tone="emerald"
                icon={Icon3DShieldCheck}
                hint={
                  approvals.ordersPending
                    ? `${approvals.ordersPending} awaiting issue`
                    : undefined
                }
                href="/applications?bucket=approved"
              />
              <KpiCard
                label="SLA overdue"
                value={sla.overdue}
                tone="red"
                icon={Icon3DHourglass}
                hint={
                  sla.applicationsOverdue
                    ? `${sla.applicationsOverdue} applications affected`
                    : undefined
                }
                href="/tasks?filter=overdue"
              />
              {/* Undispatched OUTBOX rows — people the system has decided
                  something about and not yet told. Not unread inbox items,
                  which measure whether users read their messages. */}
              <KpiCard
                label="Notifications pending"
                value={approvals.notificationsPending}
                tone={approvals.notificationsFailed ? 'rose' : 'blue'}
                icon={Icon3DActivity}
                hint={
                  approvals.notificationsFailed
                    ? `${approvals.notificationsFailed} have failed at least once`
                    : undefined
                }
                href="/admin/settings/notifications"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionHeading title="Revenue & Finance" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Fees generated"
                value={formatMoneyCompact(finance.generated)}
                tone="violet"
                icon={Icon3DCoins}
              />
              <KpiCard
                label="Fees collected"
                value={formatMoneyCompact(finance.collected)}
                tone="green"
                icon={Icon3DLandmark}
                href="/payments"
              />
              <KpiCard
                label="Pending fee"
                value={formatMoneyCompact(finance.outstanding)}
                tone="fuchsia"
                icon={Icon3DCircleDollar}
              />
              <KpiCard
                label="Payment success rate"
                value={`${finance.payments.successRate}%`}
                tone="teal"
                icon={Icon3DTrendingUp}
              />
            </div>
          </div>
        </div>

        <div className="xl:w-1/4 relative min-h-[400px] xl:min-h-0">
          <div className="xl:absolute xl:inset-0 w-full h-full">
            <Panel title="Recent Activity" icon={Clock} className="h-full flex flex-col" bodyClassName="flex-1 overflow-y-auto pr-2 min-h-0">
              <ActivityFeed entries={activity} />
            </Panel>
          </div>
        </div>
      </div>

      <SectionHeading title="Department Review Desks" />

      <PipelineStrip
        applicantSide={consolidated.applicantSide}
        desks={consolidated.desks}
        approved={applications.approved}
        rejected={applications.rejected}
      />

      <DeskConsolidation desks={consolidated.desks} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ApplicantSidePanel applicantSide={consolidated.applicantSide} />
        <Panel title="Officer Workload">
          <WorkloadTable rows={data.workload} />
        </Panel>
      </div>

      <AccountsPanel accounts={consolidated.accounts} />
      <FilersPanel filers={consolidated.filers} />

      <SectionHeading title="Analytics & Trends" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Applications by status"
          action={{ href: '/applications', label: 'Open the register' }}
        >
          <DonutChart slices={statusSlices(data)} total={applications.total} totalLabel="Files" />
        </Panel>

        <Panel title="Applications by stage">
          <BarList rows={stageRows(data)} emptyLabel="No application has reached a stage yet." />
        </Panel>
      </div>

      <Panel title="Volume over time">
        <TrendChart data={data.trend} series={TREND_SERIES} />
      </Panel>

      <MoneyPanels data={data} />
      <QualityPanels data={data} />

      <ShortfallsByStage data={data} />

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Executive — Director, Additional Commissioner, Commissioner
// ═══════════════════════════════════════════════════════════════════════════

export type ExecutiveRole = 'DIRECTOR_DP' | 'ADDL_COMMISSIONER' | 'COMMISSIONER';

const EXECUTIVE_COPY: Record<ExecutiveRole, { desk: string; deskHint: string }> = {
  DIRECTOR_DP: {
    desk: 'At your desk',
    deskHint: 'Files awaiting the Director',
  },
  ADDL_COMMISSIONER: {
    desk: 'At your desk',
    deskHint: 'Files awaiting the Additional Commissioner',
  },
  COMMISSIONER: {
    desk: 'Awaiting your decision',
    deskHint: 'Final approvals pending',
  },
};

/**
 * The senior desks.
 *
 * They share a shape because they ask the same question — what is waiting on
 * me, and how is the department doing — and differ only in the wording of the
 * first tile and in which stage counts as "mine".
 */
export function ExecutiveDashboard({
  data,
  role,
  queue,
}: {
  data: DashboardData;
  role: ExecutiveRole;
  queue: { total: number; mine: number; unclaimed: number; dueSoon: number; overdue: number };
}) {
  const { applications, sla, shortfalls, finance } = data;
  const copy = EXECUTIVE_COPY[role];

  return (
    <div className="space-y-3.5">
      <SectionHeading title="Your desk" />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={copy.desk} value={queue.total} hint={copy.deskHint} icon={Icon3DStack} href="/tasks" />
        <KpiCard
          label="Unclaimed"
          value={queue.unclaimed}
          icon={Icon3DFileEdit}
          href="/tasks?filter=new"
        />
        <KpiCard
          label="Held by you"
          value={queue.mine}
          icon={Icon3DActivity}
          href="/tasks?filter=pending"
        />
        <KpiCard
          label="Overdue"
          value={queue.overdue}
          icon={Icon3DHourglass}
          href="/tasks?filter=overdue"
        />
      </div>

      <SectionHeading title="Department Overview" />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total applications" value={applications.total} icon={Icon3DStack} href="/applications" />
        <KpiCard label="In progress" value={applications.inProgress} icon={Icon3DActivity} />
        <KpiCard
          label="Approved"
          value={applications.approved}
          icon={Icon3DShieldCheck}
          href="/applications?bucket=approved"
        />
        <KpiCard
          label="Average time to decide"
          value={sla.averageDaysToClose === null ? '—' : `${sla.averageDaysToClose} d`}
          icon={Icon3DGauge}
        />
        <KpiCard
          label="NOCs pending"
          value={data.nocs.pending}
          icon={Icon3DFileEdit}
          hint={`${data.nocs.verified} verified`}
          href="/nocs?status=OUTSTANDING"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Applications by status"
          action={{ href: '/applications', label: 'Open the register' }}
        >
          <DonutChart slices={statusSlices(data)} total={applications.total} totalLabel="Files" />
        </Panel>

        <Panel title="Stage-wise pendency">
          <BarList rows={stageRows(data)} emptyLabel="No application is in the pipeline." />
        </Panel>
      </div>

      <Panel title="Approvals over time">
        <TrendChart data={data.trend} series={TREND_SERIES} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Reported shortfalls">
          <StatRow
            label="Open — reported"
            value={shortfalls.byMode.reported}
            tone={shortfalls.byMode.reported ? 'warning' : 'neutral'}
          />
          <StatRow
            label="Open — blocking"
            value={shortfalls.byMode.blocking}
            tone={shortfalls.byMode.blocking ? 'warning' : 'neutral'}
          />
          <StatRow label="Resolved" value={shortfalls.resolved} tone="success" />
          <StatRow
            label="Past due date"
            value={shortfalls.overdue}
            tone={shortfalls.overdue ? 'danger' : 'neutral'}
          />
          <div className="pt-3">
            <BarList
              emptyLabel="Nothing outstanding at any desk."
              rows={shortfalls.byStage.map((s) => ({
                key: s.code,
                label: s.label,
                value: s.count,
                tone: 'warning' as Tone,
              }))}
            />
          </div>
        </Panel>

        <Panel title="Collection">
          <ProgressBar
            value={finance.collected}
            total={finance.generated}
            tone="success"
            label="Collected against demands raised"
            valueLabel={`${formatMoney(finance.collected)} of ${formatMoney(finance.generated)}`}
          />
          <div className="mt-3">
            <StatRow label="Demands issued" value={finance.demandsIssued} />
            <StatRow
              label="Outstanding"
              value={formatMoney(finance.outstanding)}
              tone={finance.outstanding > 0 ? 'warning' : 'neutral'}
            />
            <StatRow label="Payment success rate" value={`${finance.payments.successRate}%`} />
          </div>
        </Panel>
      </div>

      <Panel title="Recent activity" className="!-mt-3.5 bg-gradient-to-b from-blue-50/50 to-transparent border-blue-100 shadow-inner">
        <ActivityFeed entries={data.activity} />
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Officer — TPA, ZAD, ZDD, ZJD
// ═══════════════════════════════════════════════════════════════════════════

export function OfficerDashboard({
  summary,
  data,
  recent,
  roleLabel,
}: {
  summary: { total: number; mine: number; unclaimed: number; dueSoon: number; overdue: number };
  data: DashboardData;
  roleLabel: string;
  recent: Array<{
    id: string;
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    stageCode: string;
    daysPending: number;
    dueAt: string | null;
    slaStatus: string | null;
    unclaimed: boolean;
  }>;
}) {
  const { shortfalls, finance, applications } = data;

  return (
    <div className="space-y-3.5">
      <SectionHeading title={`${roleLabel} Desk Queue`} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="At your desk" value={summary.total} icon={ClipboardCheck} href="/tasks" />
        <KpiCard
          label="Unclaimed"
          value={summary.unclaimed}
          tone={summary.unclaimed ? 'info' : 'neutral'}
          icon={ClipboardCheck}
          href="/tasks?filter=new"
        />
        <KpiCard label="Held by you" value={summary.mine} icon={Clock} href="/tasks?filter=pending" />
        <KpiCard
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue ? 'danger' : 'neutral'}
          icon={AlertTriangle}
          href="/tasks?filter=overdue"
        />
        <KpiCard
          label="NOCs pending"
          value={data.nocs.pending}
          tone={data.nocs.awaitingVerification ? 'info' : 'neutral'}
          icon={FileBadge2}
          hint={`${data.nocs.awaitingVerification} received, awaiting verification`}
          href="/nocs?status=OUTSTANDING"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Waiting longest</CardTitle>
          </CardHeader>
          <CardContent className={recent.length ? 'space-y-1 p-3' : 'p-0'}>
            {recent.length ? (
              recent.map((task) => (
                <Link
                  key={task.id}
                  href={`/applications/${task.applicationId}?tab=workflow`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-sunk"
                >
                  <span className="min-w-0">
                    <span className="font-medium tabular-nums text-text">{task.applicationNumber}</span>
                    <span className="ml-2 text-small text-text-muted">{task.applicantName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-caption">
                    {task.unclaimed && <Badge tone="info">Unclaimed</Badge>}
                    {task.slaStatus && task.slaStatus !== 'ON_TRACK' && (
                      <Badge tone={statusMeta('sla', task.slaStatus).tone}>
                        {statusMeta('sla', task.slaStatus).label}
                      </Badge>
                    )}
                    <span className="tabular-nums text-text-muted">
                      {task.daysPending} {task.daysPending === 1 ? 'day' : 'days'}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <EmptyState
                icon={ClipboardCheck}
                title="Nothing at your desk"
                description="Files arrive here when they reach a stage your role works at."
              />
            )}
          </CardContent>
        </Card>

        <Panel title="Shortfalls" action={{ href: '/shortfalls', label: 'Register' }}>
          <StatRow
            label="Open"
            value={shortfalls.open}
            tone={shortfalls.open ? 'warning' : 'neutral'}
          />
          <StatRow
            label="Awaiting your verdict"
            value={shortfalls.awaitingReview}
            tone={shortfalls.awaitingReview ? 'info' : 'neutral'}
          />
          <StatRow label="Document" value={shortfalls.byKind.DOCUMENT ?? 0} />
          <StatRow label="Fee" value={shortfalls.byKind.FEE ?? 0} />
          <StatRow
            label="Past due"
            value={shortfalls.overdue}
            tone={shortfalls.overdue ? 'danger' : 'neutral'}
          />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Applications in your jurisdiction">
          <BarList rows={stageRows(data)} emptyLabel="Nothing in your jurisdiction yet." />
          <div className="mt-3">
            <StatRow label="Total visible" value={applications.total} href="/applications" />
            <StatRow label="Approved" value={applications.approved} tone="success" />
            <StatRow
              label="Fee outstanding"
              value={formatMoney(finance.outstanding)}
              tone={finance.outstanding > 0 ? 'warning' : 'neutral'}
            />
          </div>
        </Panel>

        <Panel title="Recent activity" className="!-mt-3.5 bg-gradient-to-b from-blue-50/50 to-transparent border-blue-100 shadow-inner">
          <ActivityFeed entries={data.activity} />
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Finance
// ═══════════════════════════════════════════════════════════════════════════

export function FinanceDashboard({ data }: { data: DashboardData }) {
  const { finance, applications } = data;

  const demandSlices: Slice[] = [
    { key: 'PAID', label: 'Paid', value: finance.byDemandStatus.PAID ?? 0, tone: 'success' },
    { key: 'ISSUED', label: 'Issued, unpaid', value: finance.byDemandStatus.ISSUED ?? 0, tone: 'warning' },
    {
      key: 'PARTIALLY_PAID',
      label: 'Partly paid',
      value: finance.byDemandStatus.PARTIALLY_PAID ?? 0,
      tone: 'info',
    },
    { key: 'DRAFT', label: 'Draft', value: finance.byDemandStatus.DRAFT ?? 0, tone: 'neutral' },
    { key: 'CANCELLED', label: 'Cancelled', value: finance.byDemandStatus.CANCELLED ?? 0, tone: 'neutral' },
    { key: 'WAIVED', label: 'Waived', value: finance.byDemandStatus.WAIVED ?? 0, tone: 'purple' },
  ];

  return (
    <div className="space-y-3.5">
      <SectionHeading title="Collection & Demands" />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Demands issued"
          value={finance.demandsIssued}
          hint={finance.shortfallDemands ? `${finance.shortfallDemands} from shortfalls` : undefined}
          icon={Icon3DFileEdit}
        />
        <KpiCard
          label="Total generated"
          value={formatMoneyCompact(finance.generated)}
          hint={formatMoney(finance.generated)}
          icon={Icon3DCoins}
        />
        <KpiCard
          label="Collected"
          value={formatMoneyCompact(finance.collected)}
          hint={`${finance.receipts} receipts`}
          icon={Icon3DLandmark}
          href="/payments"
        />
        <KpiCard
          label="Outstanding"
          value={formatMoneyCompact(finance.outstanding)}
          icon={Icon3DCircleDollar}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Demands by status">
          <DonutChart slices={demandSlices} totalLabel="Demands" />
        </Panel>

        <Panel
          title="Payment attempts"
          action={{ href: '/payments', label: 'Payments register' }}
        >
          <DonutChart
            totalLabel="Attempts"
            slices={[
              { key: 'ok', label: 'Settled', value: finance.payments.successful, tone: 'success' },
              { key: 'fail', label: 'Declined', value: finance.payments.failed, tone: 'danger' },
              { key: 'open', label: 'In flight', value: finance.payments.pending, tone: 'info' },
              {
                key: 'gone',
                label: 'Cancelled or timed out',
                value: finance.payments.cancelled,
                tone: 'neutral',
              },
            ]}
            height={168}
          />
          <div className="mt-3">
            <StatRow
              label="Success rate"
              value={`${finance.payments.successRate}%`}
            />
            <StatRow
              label="Awaiting reconciliation"
              value={finance.payments.pending}
              tone={finance.payments.pending ? 'info' : 'neutral'}
            />
          </div>
        </Panel>
      </div>

      <Panel title="Volume over time">
        <TrendChart data={data.trend} series={TREND_SERIES} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Fee shortfalls">
          <StatRow
            label="Open fee shortfalls"
            value={data.shortfalls.byKind.FEE ?? 0}
            tone={(data.shortfalls.byKind.FEE ?? 0) ? 'warning' : 'neutral'}
          />
          <StatRow label="Supplementary demands raised" value={finance.shortfallDemands} />
          <StatRow label="Applications approved" value={applications.approved} tone="success" />
          <StatRow
            label="Applications awaiting payment"
            value={applications.byBucket.paymentPending ?? 0}
            tone={(applications.byBucket.paymentPending ?? 0) ? 'warning' : 'neutral'}
            href="/applications?bucket=paymentPending"
          />
        </Panel>

        <Panel title="Recent activity" className="!-mt-3.5 bg-gradient-to-b from-blue-50/50 to-transparent border-blue-100 shadow-inner">
          <ActivityFeed entries={data.activity} />
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Viewer / auditor
// ═══════════════════════════════════════════════════════════════════════════

export function ViewerDashboard({ data }: { data: DashboardData }) {
  const { applications, sla, shortfalls, finance } = data;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total applications" value={applications.total} icon={Icon3DStack} href="/applications" />
        <KpiCard label="In progress" value={applications.inProgress} icon={Icon3DActivity} />
        <KpiCard label="Approved" value={applications.approved} icon={Icon3DShieldCheck} />
        <KpiCard
          label="Open shortfalls"
          value={shortfalls.open}
          icon={Icon3DAlertOctagon}
        />
        <KpiCard label="Fees collected" value={formatMoneyCompact(finance.collected)} icon={Icon3DLandmark} />
        <KpiCard
          label="Overdue tasks"
          value={sla.overdue}
          icon={Icon3DHourglass}
        />
        <KpiCard
          label="Average time to decide"
          value={sla.averageDaysToClose === null ? '—' : `${sla.averageDaysToClose} d`}
          icon={Icon3DGauge}
        />
        <KpiCard label="Application types" value={applications.byType.length} icon={Icon3DStack} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Applications by status">
          <DonutChart slices={statusSlices(data)} total={applications.total} totalLabel="Files" />
        </Panel>
        <Panel title="Where the files are">
          <BarList rows={stageRows(data)} emptyLabel="Nothing in the pipeline." />
        </Panel>
      </div>

      <Panel title="Volume over time">
        <TrendChart data={data.trend} series={TREND_SERIES} />
      </Panel>

      <QualityPanels data={data} />

      <Panel title="Recent activity" className="!-mt-3.5 bg-gradient-to-b from-blue-50/50 to-transparent border-blue-100 shadow-inner">
        <ActivityFeed entries={data.activity} />
      </Panel>
    </div>
  );
}

export { MoneyPanels, QualityPanels };
