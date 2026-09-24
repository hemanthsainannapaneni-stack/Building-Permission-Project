import 'server-only';
import { prisma } from '@/server/db/prisma';
import { claimPending, markProcessed, markFailed } from '@/server/events/outbox';
import { settingString } from '@/server/services/settings';
import { markNotified } from '@/server/shortfalls/engine';
import {
  getSmsProvider,
  getEmailProvider,
  getInAppProvider,
  type ProviderSendOutcome,
} from './providers';
import { isKnownEvent, isMandatory, resolveRecipients } from './recipients';
import {
  enrichTemplatePayload,
  getCanonicalEventCode,
  linkFor,
  render,
  templatesFor,
} from './templates';
import { CHANNELS, type Channel, type Recipient } from './types';

/** Same event, same person, same channel, within a minute: send once. */
const DEDUPE_WINDOW_MS = 60_000;

export type DispatchReport = {
  events: number;
  sent: number;
  failed: number;
  skipped: number;
  errored: number;
};

export async function dispatchOutbox(batchSize = 25): Promise<DispatchReport> {
  const events = await claimPending(batchSize);
  const report: DispatchReport = { events: events.length, sent: 0, failed: 0, skipped: 0, errored: 0 };

  for (const event of events) {
    try {
      const outcome = await dispatchEvent({
        eventCode: event.eventCode,
        applicationId: event.applicationId,
        payload: (event.payload ?? {}) as Record<string, unknown>,
      });

      report.sent += outcome.sent;
      report.failed += outcome.failed;
      report.skipped += outcome.skipped;

      await markProcessed(event.id);
    } catch (error) {
      report.errored += 1;
      await markFailed(event.id, error instanceof Error ? error.message : String(error));
      console.error(`[notifications] ${event.eventCode} could not be dispatched`, error);
    }
  }

  return report;
}

export type EventOutcome = { sent: number; failed: number; skipped: number };

/**
 * Delivers one event to everybody who should hear about it.
 */
export async function dispatchEvent(event: {
  eventCode: string;
  applicationId: string | null;
  payload: Record<string, unknown>;
}): Promise<EventOutcome> {
  const outcome: EventOutcome = { sent: 0, failed: 0, skipped: 0 };
  const canonicalCode = getCanonicalEventCode(event.eventCode);

  if (!isKnownEvent(event.eventCode) && !isKnownEvent(canonicalCode)) {
    await logRow({
      applicationId: event.applicationId,
      eventCode: event.eventCode,
      channel: 'IN_APP',
      recipient: '',
      status: 'SKIPPED',
      error: 'No recipient rule is configured for this event.',
    });
    outcome.skipped += 1;
    return outcome;
  }

  // Enrich payload with application data for all 7 template variables
  const enrichedPayload = await enrichTemplatePayload(event.applicationId, event.payload);

  const [recipients, templates] = await Promise.all([
    resolveRecipients(canonicalCode, event.applicationId, {
      ...enrichedPayload,
      applicationId: event.applicationId,
    }),
    templatesFor(event.eventCode),
  ]);

  if (!recipients.length) {
    await logRow({
      applicationId: event.applicationId,
      eventCode: event.eventCode,
      channel: 'IN_APP',
      recipient: '',
      status: 'SKIPPED',
      error: 'Nobody to tell — no matching recipient was found for this event.',
    });
    outcome.skipped += 1;
    return outcome;
  }

  const link = linkFor(event.eventCode, { ...enrichedPayload, applicationId: event.applicationId });
  const quiet = await quietHours();
  let delivered = 0;

  const smsProvider = getSmsProvider();
  const emailProvider = getEmailProvider();
  const inAppProvider = getInAppProvider();

  for (const recipient of recipients) {
    for (const channel of CHANNELS) {
      const template = templates.get(channel);
      if (!template) continue;

      const decision = await shouldSend(canonicalCode, channel, recipient, quiet);
      if (decision) {
        await logRow({
          applicationId: event.applicationId,
          eventCode: event.eventCode,
          channel,
          templateId: template.id.startsWith('fallback-') ? null : template.id,
          recipientUserId: recipient.userId,
          recipient: addressFor(channel, recipient),
          status: 'SKIPPED',
          error: decision,
        });
        outcome.skipped += 1;
        continue;
      }

      const message = await render(template, {
        ...enrichedPayload,
        applicationId: event.applicationId,
        recipientName: recipient.name,
        link,
      });

      let result: ProviderSendOutcome;

      try {
        if (channel === 'IN_APP') {
          result = await inAppProvider.sendInApp({
            recipient,
            message,
            eventCode: event.eventCode,
            applicationId: event.applicationId,
            link,
          });
        } else if (channel === 'EMAIL') {
          result = emailProvider.configured
            ? await emailProvider.sendEmail({
                recipient,
                message,
                eventCode: event.eventCode,
                applicationId: event.applicationId,
                link,
              })
            : {
                status: 'SKIPPED',
                provider: emailProvider.name,
                providerRef: '',
                error: 'Email provider is not configured.',
              };
        } else {
          result = smsProvider.configured
            ? await smsProvider.sendSms({
                recipient,
                message,
                eventCode: event.eventCode,
                applicationId: event.applicationId,
                link,
              })
            : {
                status: 'SKIPPED',
                provider: smsProvider.name,
                providerRef: '',
                error: 'SMS provider is not configured.',
              };
        }
      } catch (err) {
        result = {
          status: 'FAILED',
          provider: channel === 'IN_APP' ? inAppProvider.name : channel === 'EMAIL' ? emailProvider.name : smsProvider.name,
          providerRef: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await logRow({
        applicationId: event.applicationId,
        eventCode: event.eventCode,
        channel,
        templateId: template.id.startsWith('fallback-') ? null : template.id,
        recipientUserId: recipient.userId,
        recipient: addressFor(channel, recipient),
        subject: message.subject,
        body: message.body,
        status: result.status,
        provider: result.provider,
        providerRef: result.providerRef,
        error:
          result.error ||
          (message.missing.length
            ? `Sent, but these variables were empty: ${message.missing.join(', ')}.`
            : ''),
        sentAt: result.status === 'SENT' ? new Date() : null,
      });

      if (result.status === 'SENT') {
        outcome.sent += 1;
        delivered += 1;
      } else if (result.status === 'FAILED') {
        outcome.failed += 1;
      } else {
        outcome.skipped += 1;
      }
    }
  }

  // Advance shortfall lifecycle if notified
  const shortfallId = String(event.payload.shortfallId ?? '');
  if (delivered > 0 && shortfallId && canonicalCode === 'SHORTFALL_RAISED') {
    try {
      await markNotified(shortfallId);
    } catch {
      // Non-blocking
    }
  }

  return outcome;
}

/**
 * Checks whether this message should leave the building.
 */
async function shouldSend(
  eventCode: string,
  channel: Channel,
  recipient: Recipient,
  quiet: { from: number; to: number } | null
): Promise<string | null> {
  if (recipient.userId && !(recipient.mandatory && isMandatory(eventCode))) {
    const preference = await prisma.notificationPreference.findUnique({
      where: {
        userId_eventCode_channel: { userId: recipient.userId, eventCode, channel },
      },
      select: { enabled: true },
    });

    if (preference && !preference.enabled) {
      return 'The recipient has turned this notification off.';
    }
  }

  const address = addressFor(channel, recipient);
  if (!address && channel !== 'IN_APP') {
    return channel === 'EMAIL' ? 'No email address on file.' : 'No mobile number on file.';
  }

  const recent = await prisma.notificationLog.findFirst({
    where: {
      eventCode,
      channel,
      recipient: address,
      status: { in: ['SENT', 'QUEUED'] },
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });

  if (recent) {
    return 'An identical message was sent to this recipient less than a minute ago.';
  }

  if (channel === 'SMS' && quiet && inQuietHours(quiet)) {
    return `Quiet hours (${quiet.from}:00–${quiet.to}:00). SMS is not sent overnight.`;
  }

  return null;
}

const addressFor = (channel: Channel, recipient: Recipient): string => {
  if (channel === 'EMAIL') return recipient.email.trim();
  if (channel === 'SMS') return recipient.phone.trim();
  return recipient.userId ?? '';
};

async function quietHours(): Promise<{ from: number; to: number } | null> {
  const raw = (await settingString('notifications_quiet_hours', '')).trim();
  if (!raw) return null;

  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(raw);
  if (!match) return null;

  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > 23 || to > 23) return null;

  return { from, to };
}

function inQuietHours(window: { from: number; to: number }, now = new Date()): boolean {
  const hour = now.getHours();
  return window.from > window.to
    ? hour >= window.from || hour < window.to
    : hour >= window.from && hour < window.to;
}

type LogInput = {
  eventCode: string;
  channel: Channel;
  templateId?: string | null;
  recipientUserId?: string | null;
  recipient: string;
  subject?: string;
  body?: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED';
  provider?: string;
  providerRef?: string;
  error?: string;
  sentAt?: Date | null;
  applicationId?: string | null;
};

async function logRow(row: LogInput) {
  try {
    await prisma.notificationLog.create({
      data: {
        eventCode: row.eventCode,
        channel: row.channel,
        templateId: row.templateId ?? null,
        applicationId: row.applicationId ?? null,
        recipientUserId: row.recipientUserId ?? null,
        recipient: row.recipient || (row.recipientUserId ? `user:${row.recipientUserId}` : 'unknown'),
        subject: row.subject ?? '',
        body: row.body ?? '',
        status: row.status,
        provider: row.provider ?? '',
        providerRef: row.providerRef ?? '',
        errorMessage: (row.error ?? '').slice(0, 500),
        sentAt: row.sentAt ?? null,
      },
    });
  } catch (error) {
    console.error('[notifications] Could not write delivery log row', error);
  }
}
