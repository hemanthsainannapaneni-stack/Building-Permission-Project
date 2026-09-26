import type { Metadata } from 'next';
import { Users, Shield, Building2, Database } from 'lucide-react';
import { prisma } from '@/server/db/prisma';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { KpiCard } from '@/components/common/kpi-card';
import { Panel, StatRow } from '@/features/dashboard/panels';

export const metadata: Metadata = { title: 'System Overview' };
export const dynamic = 'force-dynamic';

export type SystemCounts = {
  users: number;
  activeUsers: number;
  inactiveUsers: number;
  roles: number;
  permissions: number;
  zones: number;
  offices: number;
  applicationTypes: number;
  settings: number;
  documentTypes: number;
  auditEvents: number;
  notificationsSent: number;
  workflowPublished: boolean;
  workflowName: string;
  failedJobs: number;
  unprocessedEvents: number;
  // Registers
  applications: number;
  developers: number;
  professionals: number;
  payments: number;
  documents: number;
  shortfalls: number;
  showCause: number;
  outward: number;
  occupancy: number;
};

async function systemCounts(): Promise<SystemCounts> {
  const [
    users,
    activeUsers,
    roles,
    permissions,
    zones,
    offices,
    applicationTypes,
    settings,
    documentTypes,
    auditEvents,
    notificationsSent,
    workflow,
    failedJobs,
    unprocessedEvents,
    applications,
    developers,
    professionals,
    payments,
    documents,
    shortfalls,
    showCause,
    outward,
    occupancy,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.role.count({ where: { deletedAt: null } }),
    prisma.permission.count(),
    prisma.zone.count({ where: { deletedAt: null } }),
    prisma.office.count({ where: { deletedAt: null } }),
    prisma.applicationType.count({ where: { deletedAt: null } }),
    prisma.systemSetting.count(),
    prisma.documentType.count({ where: { deletedAt: null } }),
    prisma.auditLog.count(),
    prisma.notificationLog.count({ where: { status: { in: ['SENT', 'DELIVERED'] } } }),
    prisma.workflow.findFirst({
      where: { isPublished: true },
      select: { name: true, code: true, version: true },
      orderBy: { version: 'desc' },
    }),
    prisma.job.count({ where: { status: 'DEAD' } }),
    prisma.outboxEvent.count({ where: { processed: false } }),
    prisma.application.count(),
    prisma.developerRegistration.count(),
    prisma.professionalRegistration.count(),
    prisma.payment.count(),
    prisma.applicationDocument.count(),
    prisma.shortfall.count(),
    prisma.showCauseNotice.count(),
    prisma.outwardEntry.count(),
    prisma.occupancyApplication.count(),
  ]);

  return {
    users,
    activeUsers,
    inactiveUsers: users - activeUsers,
    roles,
    permissions,
    zones,
    offices,
    applicationTypes,
    settings,
    documentTypes,
    auditEvents,
    notificationsSent,
    workflowPublished: Boolean(workflow),
    workflowName: workflow ? `${workflow.name} · v${workflow.version}` : 'None published',
    failedJobs,
    unprocessedEvents,
    applications,
    developers,
    professionals,
    payments,
    documents,
    shortfalls,
    showCause,
    outward,
    occupancy,
  };
}

export default async function SettingsOverviewPage() {
  await requirePageCapability(CAPABILITIES.SETTINGS_MANAGE);
  const counts = await systemCounts();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Users"
          value={counts.users}
          hint={`${counts.activeUsers} active`}
          href="/admin/settings/users"
          icon={Users}
        />
        <KpiCard
          label="Roles & permissions"
          value={`${counts.roles} / ${counts.permissions}`}
          href="/admin/settings/roles"
          icon={Shield}
        />
        <KpiCard
          label="Zones & offices"
          value={`${counts.zones} / ${counts.offices}`}
          href="/admin/settings/organisation"
          icon={Building2}
        />
        <KpiCard
          label="Settings"
          value={counts.settings}
          href="/admin/settings/system"
          icon={Database}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="System configuration & health">
          <StatRow
            label="Workflow"
            value={counts.workflowPublished ? 'Published' : 'Not published'}
            tone={counts.workflowPublished ? 'success' : 'danger'}
            hint={counts.workflowName}
            href="/admin/settings/workflows"
          />
          <StatRow
            label="Failed background jobs"
            value={counts.failedJobs}
            tone={counts.failedJobs ? 'danger' : 'neutral'}
          />
          <StatRow
            label="Unprocessed outbox events"
            value={counts.unprocessedEvents}
            tone={counts.unprocessedEvents > 20 ? 'warning' : 'neutral'}
          />
          <StatRow label="Notifications sent" value={counts.notificationsSent} />
          <StatRow label="Document types configured" value={counts.documentTypes} href="/admin/settings/document-types" />
          <StatRow label="Application types" value={counts.applicationTypes} href="/admin/settings/system" />
          <StatRow label="NOC types configured" value="Active" href="/admin/settings/noc-types" />
          <StatRow label="Checklists configured" value="Active" href="/admin/settings/checklists" />
        </Panel>

        <Panel title="Registers & logs">
          <StatRow label="Applications" value={counts.applications} href="/applications" />
          <StatRow label="Developers" value={counts.developers} href="/developers" />
          <StatRow label="Professionals (LTP)" value={counts.professionals} href="/ltp" />
          <StatRow label="Payments" value={counts.payments} href="/payments" />
          <StatRow label="Documents" value={counts.documents} href="/documents" />
          <StatRow label="Shortfalls" value={counts.shortfalls} href="/shortfalls" />
          <StatRow label="Show Cause Notices" value={counts.showCause} href="/show-cause" />
          <StatRow label="Outward Register" value={counts.outward} href="/outward" />
          <StatRow label="Occupancy" value={counts.occupancy} href="/occupancy" />
          <StatRow label="Audit events" value={counts.auditEvents} />
        </Panel>
      </div>
    </div>
  );
}
