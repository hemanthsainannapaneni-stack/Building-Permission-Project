import 'server-only';
import { prisma } from '@/server/db/prisma';

export type LogQuery = {
  channel?: string;
  status?: string;
  eventCode?: string;
  query?: string;
  applicationId?: string;
  page?: number;
  pageSize?: number;
};

export async function listNotificationLogs(params: LogQuery = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, params.pageSize ?? 25));
  const skip = (page - 1) * pageSize;

  const where: {
    channel?: string;
    status?: string;
    eventCode?: string;
    applicationId?: string;
    OR?: Array<{ recipient?: { contains: string }; body?: { contains: string } }>;
  } = {};

  if (params.channel && params.channel !== 'ALL') {
    where.channel = params.channel;
  }

  if (params.status && params.status !== 'ALL') {
    where.status = params.status;
  }

  if (params.eventCode && params.eventCode !== 'ALL') {
    where.eventCode = params.eventCode;
  }

  if (params.query?.trim()) {
    const q = params.query.trim();
    where.OR = [{ recipient: { contains: q } }, { body: { contains: q } }];
  }

  if (params.applicationId) {
    where.applicationId = params.applicationId;
  }

  const [logs, total, stats] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        channel: true,
        eventCode: true,
        recipient: true,
        recipientUserId: true,
        subject: true,
        body: true,
        status: true,
        provider: true,
        providerRef: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        applicationId: true,
        // The template that produced it. Named so an administrator reading a
        // badly-worded message can go and change the thing that wrote it,
        // rather than working backwards from the event code.
        template: { select: { id: true, eventCode: true, channel: true, subject: true } },
        recipientUser: { select: { name: true } },
        application: { select: { applicationNumber: true } },
      },
    }),
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {
    SENT: 0,
    FAILED: 0,
    SKIPPED: 0,
    QUEUED: 0,
  };

  for (const s of stats) {
    statusCounts[s.status] = s._count._all;
  }

  // ── Read receipts, for the in-app rows only ──────────────────────────
  //
  // The in-app provider stores the Notification id it created in
  // `providerRef`, so the read state can be joined on it without carrying a
  // second foreign key. Email and SMS have no read receipt and never will —
  // those rows report `null`, which is the honest answer, rather than `false`,
  // which would claim the recipient had not read something we cannot know.
  const inAppRefs = logs
    .filter((log) => log.channel === 'IN_APP' && log.providerRef)
    .map((log) => log.providerRef);

  const readState = new Map<string, { isRead: boolean; readAt: Date | null }>();

  if (inAppRefs.length) {
    const rows = await prisma.notification.findMany({
      where: { id: { in: inAppRefs } },
      select: { id: true, isRead: true, readAt: true },
    });
    for (const row of rows) readState.set(row.id, { isRead: row.isRead, readAt: row.readAt });
  }

  return {
    logs: logs.map((log) => {
      const read = log.channel === 'IN_APP' ? (readState.get(log.providerRef) ?? null) : null;

      return {
        id: log.id,
        channel: log.channel,
        eventCode: log.eventCode,
        recipient: log.recipient,
        recipientName: log.recipientUser?.name ?? '',
        subject: log.subject,
        body: log.body,
        status: log.status,
        provider: log.provider,
        providerRef: log.providerRef,
        errorMessage: log.errorMessage,
        sentAt: log.sentAt ? log.sentAt.toISOString() : null,
        createdAt: log.createdAt.toISOString(),
        applicationId: log.applicationId,
        applicationNumber: log.application?.applicationNumber ?? '',
        templateId: log.template?.id ?? null,
        /** The template that produced it, named as an administrator sees it. */
        templateName: log.template
          ? `${log.template.eventCode} · ${log.template.channel}`
          : 'Built-in fallback',
        /** Null on a channel that cannot report a read receipt. */
        isRead: read ? read.isRead : null,
        readAt: read?.readAt ? read.readAt.toISOString() : null,
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    stats: statusCounts,
  };
}
