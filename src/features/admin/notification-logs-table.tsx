'use client';

import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  MessageSquare,
  Mail,
  Bell,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/empty-state';
import Link from 'next/link';

export type LogItem = {
  id: string;
  channel: string;
  eventCode: string;
  recipient: string;
  recipientName: string;
  subject: string;
  body: string;
  status: string;
  provider: string;
  providerRef: string;
  errorMessage: string;
  sentAt: string | null;
  createdAt: string;
  applicationId: string | null;
  applicationNumber: string;
  templateId: string | null;
  templateName: string;
  /** Null on a channel that cannot report a read receipt — email and SMS. */
  isRead: boolean | null;
  readAt: string | null;
};

export function NotificationLogsTable({
  initialLogs,
  total,
  page,
  pageSize,
  totalPages,
  stats,
}: {
  initialLogs: LogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentChannel = searchParams.get('channel') || 'ALL';
  const currentStatus = searchParams.get('status') || 'ALL';
  const currentQuery = searchParams.get('q') || '';

  const [searchTerm, setSearchTerm] = React.useState(currentQuery);
  const [selectedLog, setSelectedLog] = React.useState<LogItem | null>(null);

  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === 'ALL' || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchTerm.trim() || null });
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'SMS':
        return <MessageSquare className="size-3.5 text-blue-600 dark:text-blue-400" />;
      case 'EMAIL':
        return <Mail className="size-3.5 text-purple-600 dark:text-purple-400" />;
      default:
        return <Bell className="size-3.5 text-primary" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
        return (
          <Badge tone="success" className="gap-1">
            <CheckCircle2 className="size-3" />
            SENT
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge tone="danger" className="gap-1">
            <XCircle className="size-3" />
            FAILED
          </Badge>
        );
      case 'SKIPPED':
        return (
          <Badge tone="warning" className="gap-1">
            <Ban className="size-3" />
            SKIPPED
          </Badge>
        );
      default:
        return (
          <Badge tone="neutral" className="gap-1">
            <Clock className="size-3" />
            QUEUED
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Card className="p-3.5">
          <p className="text-caption text-text-muted">Total Dispatched</p>
          <p className="mt-1 text-display font-bold tabular-nums text-text">{total}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-caption text-text-muted">Successful (SENT)</p>
          <p className="mt-1 text-display font-bold tabular-nums text-success">{stats.SENT ?? 0}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-caption text-text-muted">Failed Deliveries</p>
          <p className="mt-1 text-display font-bold tabular-nums text-danger">{stats.FAILED ?? 0}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-caption text-text-muted">Skipped / Filtered</p>
          <p className="mt-1 text-display font-bold tabular-nums text-warning">{stats.SKIPPED ?? 0}</p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Channel selector */}
          <div className="flex items-center rounded-lg border border-border bg-surface-sunk p-0.5 text-caption">
            {['ALL', 'SMS', 'EMAIL', 'IN_APP'].map((ch) => (
              <button
                key={ch}
                onClick={() => updateFilters({ channel: ch })}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  currentChannel === ch
                    ? 'bg-surface text-primary shadow-subtle'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {ch === 'ALL' ? 'All Channels' : ch}
              </button>
            ))}
          </div>

          {/* Status selector */}
          <div className="flex items-center rounded-lg border border-border bg-surface-sunk p-0.5 text-caption">
            {['ALL', 'SENT', 'FAILED', 'SKIPPED'].map((st) => (
              <button
                key={st}
                onClick={() => updateFilters({ status: st })}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  currentStatus === st
                    ? 'bg-surface text-primary shadow-subtle'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {st === 'ALL' ? 'All Statuses' : st}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search recipient or message..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 text-small h-8"
          />
        </form>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Channel</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Read</TableHead>
                <TableHead className="w-10 text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-40 text-center">
                    <EmptyState
                      icon={MessageSquare}
                      title="No logs found"
                      description="No notification delivery records match your filter criteria."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                initialLogs.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-surface-sunk/50">
                    <TableCell>
                      <div className="flex items-center gap-1 font-medium">
                        {getChannelIcon(log.channel)}
                        <span className="text-caption font-semibold">{log.channel}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-small text-text">
                      <span className="block max-w-[12rem] truncate font-medium">
                        {log.recipientName || '—'}
                      </span>
                      <span
                        className="block max-w-[12rem] truncate font-mono text-caption text-text-muted"
                        title={log.recipient}
                      >
                        {log.recipient}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge tone="outline" className="font-mono text-caption">
                        {log.eventCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-small">
                      {log.applicationId ? (
                        <Link
                          href={`/applications/${log.applicationId}`}
                          className="whitespace-nowrap text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {log.applicationNumber || 'Open'}
                        </Link>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-[10rem] truncate text-caption text-text-muted"
                      title={log.templateName}
                    >
                      {log.templateName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-caption text-text-muted">
                      {stamp(log.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-caption text-text-muted">
                      {log.sentAt ? (
                        <span className="flex flex-col">
                          <span>{stamp(log.sentAt)}</span>
                          {/* A mock provider did not send anything to anybody.
                              Saying "Sent" without saying so would be the one
                              claim a delivery register must never make. */}
                          {/mock|console/i.test(log.provider) && (
                            <span className="text-warning">simulated</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-caption">
                      {log.isRead === null ? (
                        <span className="text-text-subtle" title="This channel has no read receipt">
                          n/a
                        </span>
                      ) : log.isRead ? (
                        <span className="text-success">{log.readAt ? stamp(log.readAt) : 'Read'}</span>
                      ) : (
                        <span className="text-text-muted">Unread</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setSelectedLog(log)}
                        title="View Full Details"
                      >
                        <Eye className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-small">
            <span className="text-caption text-text-muted">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} records
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <span className="text-caption font-medium px-2">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Message Inspection Dialog / Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                {getChannelIcon(selectedLog.channel)}
                <h3 className="text-body font-bold text-text">Notification Log Details</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedLog(null)}>
                ✕
              </Button>
            </div>

            <div className="mt-4 space-y-3 text-small">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/80 bg-surface-sunk p-3">
                <div>
                  <span className="text-caption uppercase text-text-muted">Channel</span>
                  <p className="font-semibold text-text">{selectedLog.channel}</p>
                </div>
                <div>
                  <span className="text-caption uppercase text-text-muted">Status</span>
                  <div>{getStatusBadge(selectedLog.status)}</div>
                </div>
                <div>
                  <span className="text-caption uppercase text-text-muted">Recipient</span>
                  <p className="font-mono font-medium text-text">{selectedLog.recipient}</p>
                </div>
                <div>
                  <span className="text-caption uppercase text-text-muted">Provider</span>
                  <p className="font-mono text-text">{selectedLog.provider || 'system'}</p>
                </div>
              </div>

              <div>
                <span className="text-caption uppercase text-text-muted">Event Code</span>
                <p className="font-mono font-medium text-text">{selectedLog.eventCode}</p>
              </div>

              {selectedLog.subject && (
                <div>
                  <span className="text-caption uppercase text-text-muted">Subject</span>
                  <p className="font-medium text-text">{selectedLog.subject}</p>
                </div>
              )}

              <div>
                <span className="text-caption uppercase text-text-muted">Dispatched Message Body</span>
                <div className="mt-1 rounded-lg border border-border bg-surface-sunk p-3 text-small font-sans whitespace-pre-wrap leading-relaxed text-text">
                  {selectedLog.body}
                </div>
              </div>

              {selectedLog.errorMessage && (
                <div>
                  <span className="text-caption uppercase text-danger font-semibold">Error / Failure Reason</span>
                  <div className="mt-1 rounded-lg border border-danger/30 bg-danger-bg/30 p-2.5 text-caption font-mono text-danger">
                    {selectedLog.errorMessage}
                  </div>
                </div>
              )}

              <div className="text-right pt-2 border-t border-border">
                <span className="text-caption text-text-muted">
                  Logged on {new Date(selectedLog.createdAt).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One timestamp format across the register, so columns compare by eye. */
const stamp = (value: string): string =>
  new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
