import 'server-only';
import { prisma } from '@/server/db/prisma';
import { settingString } from '@/server/services/settings';
import { env } from '@/server/config/env';
import { stageLabel } from '@/lib/status';
import { formatMoney } from '@/lib/fees';
import type { Channel, Rendered } from './types';

/**
 * Event aliases mapping prompt/canonical variations to database template codes.
 */
export const EVENT_ALIASES: Record<string, string> = {
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESSFUL',
  DOCUMENTS_COMPLETE: 'DOCUMENTS_COMPLETED',
  SLA_BREACHED: 'SLA_OVERDUE',
};

export function getCanonicalEventCode(eventCode: string): string {
  return EVENT_ALIASES[eventCode] ?? eventCode;
}

/** Values available to every template, whatever the event. */
async function ambient(): Promise<Record<string, string>> {
  const [orgName, orgShortName] = await Promise.all([
    settingString('org_name', 'Directorate of Town and Country Planning'),
    settingString('org_short_name', 'DTCP'),
  ]);

  return { orgName, orgShortName, appUrl: env.appUrl };
}

export type RenderResult = Rendered & { missing: string[] };

/**
 * Fills `{{name}}` placeholders from the payload.
 *
 * Supports all required template variables:
 * - {{applicationNumber}}
 * - {{applicantName}}
 * - {{status}}
 * - {{currentStage}}
 * - {{shortfallReason}}
 * - {{amount}}
 * - {{approvalDate}}
 * - {{orgName}}, {{orgShortName}}, {{link}}, {{recipientName}}, etc.
 */
export function fill(
  text: string,
  values: Record<string, unknown>
): { text: string; missing: string[] } {
  const missing: string[] = [];

  const filled = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];

    if (value === undefined || value === null || value === '') {
      missing.push(key);
      return '';
    }

    return String(value);
  });

  return { text: filled.replace(/[ \t]{2,}/g, ' ').trim(), missing: [...new Set(missing)] };
}

export type TemplateRow = {
  id: string;
  subject: string;
  body: string;
  providerTemplateId: string;
};

/** Default fallback templates if custom DB template is not found */
/** Events that can be rendered without a database template. */
export const hasFallbackTemplate = (eventCode: string): boolean =>
  eventCode in DEFAULT_FALLBACK_TEMPLATES;

const DEFAULT_FALLBACK_TEMPLATES: Record<string, Record<Channel, { subject: string; body: string }>> = {
  APPLICATION_CREATED: {
    IN_APP: {
      subject: 'Application {{applicationNumber}} created',
      body: 'Application {{applicationNumber}} has been initiated for {{applicantName}}.',
    },
    EMAIL: {
      subject: 'Application Initiated — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nYour application {{applicationNumber}} has been created.\nStage: {{currentStage}}.\nStatus: {{status}}.\n\nLink: {{link}}\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Application {{applicationNumber}} created. Track status at {{link}} - {{orgShortName}}',
    },
  },
  APPLICATION_SUBMITTED: {
    IN_APP: {
      subject: 'Application {{applicationNumber}} submitted',
      body: 'Application {{applicationNumber}} has been submitted for scrutiny and review.',
    },
    EMAIL: {
      subject: 'Application Submitted — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nApplication {{applicationNumber}} has been successfully submitted to {{orgName}}.\n\nStatus: {{status}}\nLink: {{link}}',
    },
    SMS: {
      subject: '',
      body: 'Application {{applicationNumber}} submitted successfully. - {{orgShortName}}',
    },
  },
  PAYMENT_PENDING: {
    IN_APP: {
      subject: 'Payment pending for {{applicationNumber}}',
      body: 'A fee of {{amount}} is pending for application {{applicationNumber}}.',
    },
    EMAIL: {
      subject: 'Payment Pending — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nA payment of {{amount}} is pending for application {{applicationNumber}}.\n\nPlease pay here: {{link}}\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Payment of {{amount}} is pending for app {{applicationNumber}}. Pay at {{link}} - {{orgShortName}}',
    },
  },
  SHORTFALL_RAISED: {
    IN_APP: {
      subject: 'Shortfall raised on {{applicationNumber}}',
      body: 'A shortfall has been raised: {{shortfallReason}} on {{applicationNumber}}.',
    },
    EMAIL: {
      subject: 'Action Required: Shortfall on {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nA shortfall was raised on application {{applicationNumber}}.\nReason: {{shortfallReason}}\n\nRespond here: {{link}}\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Shortfall raised on {{applicationNumber}}: {{shortfallReason}}. Respond: {{link}} - {{orgShortName}}',
    },
  },
  SHORTFALL_RESOLVED: {
    IN_APP: {
      subject: 'Shortfall resolved on {{applicationNumber}}',
      body: 'Shortfall on application {{applicationNumber}} has been resolved and approved.',
    },
    EMAIL: {
      subject: 'Shortfall Resolved — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nThe shortfall for application {{applicationNumber}} has been reviewed and accepted.\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Shortfall on {{applicationNumber}} is resolved. Application advances. - {{orgShortName}}',
    },
  },
  APPLICATION_APPROVED: {
    IN_APP: {
      subject: 'Application {{applicationNumber}} Approved',
      body: 'Building permission granted on {{approvalDate}} for application {{applicationNumber}}.',
    },
    EMAIL: {
      subject: 'Building Permission Granted — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nWe are pleased to inform that application {{applicationNumber}} was APPROVED on {{approvalDate}}.\n\nDownload Order: {{link}}\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Application {{applicationNumber}} is APPROVED on {{approvalDate}}. Download order at {{link}} - {{orgShortName}}',
    },
  },
  APPLICATION_REJECTED: {
    IN_APP: {
      subject: 'Application {{applicationNumber}} Rejected',
      body: 'Application {{applicationNumber}} has been refused permission.',
    },
    EMAIL: {
      subject: 'Application Status — {{applicationNumber}}',
      body: 'Dear {{recipientName}},\n\nApplication {{applicationNumber}} has been rejected.\n\nView details: {{link}}\n\n{{orgName}}',
    },
    SMS: {
      subject: '',
      body: 'Application {{applicationNumber}} was rejected. Details at {{link}} - {{orgShortName}}',
    },
  },
  SLA_BREACHED: {
    IN_APP: {
      subject: 'SLA Overdue — {{applicationNumber}}',
      body: 'Application {{applicationNumber}} has exceeded the SLA turnaround time for stage {{currentStage}}.',
    },
    EMAIL: {
      subject: 'SLA Overdue Alert: {{applicationNumber}}',
      body: 'Application {{applicationNumber}} is overdue at stage {{currentStage}}.\n\nLink: {{link}}',
    },
    SMS: {
      subject: '',
      body: 'Overdue alert: Application {{applicationNumber}} SLA breached at {{currentStage}}. - {{orgShortName}}',
    },
  },
};

/** Every active template for an event, keyed by channel. One query per event. */
export async function templatesFor(
  eventCode: string,
  locale = 'en'
): Promise<Map<Channel, TemplateRow>> {
  const canonicalCode = getCanonicalEventCode(eventCode);

  const rows = await prisma.notificationTemplate.findMany({
    where: {
      eventCode: { in: [eventCode, canonicalCode] },
      locale,
      isActive: true,
    },
    select: { id: true, channel: true, subject: true, body: true, providerTemplateId: true },
  });

  const map = new Map<Channel, TemplateRow>();
  for (const row of rows) {
    map.set(row.channel as Channel, {
      id: row.id,
      subject: row.subject,
      body: row.body,
      providerTemplateId: row.providerTemplateId,
    });
  }

  // If missing channels, check fallback defaults
  const fallback = DEFAULT_FALLBACK_TEMPLATES[eventCode] || DEFAULT_FALLBACK_TEMPLATES[canonicalCode];
  if (fallback) {
    for (const ch of ['IN_APP', 'EMAIL', 'SMS'] as Channel[]) {
      if (!map.has(ch) && fallback[ch]) {
        map.set(ch, {
          id: `fallback-${eventCode}-${ch}`,
          subject: fallback[ch].subject,
          body: fallback[ch].body,
          providerTemplateId: 'DLT_DEFAULT',
        });
      }
    }
  }

  return map;
}

/** Enriches payload with application data for all required variables */
export async function enrichTemplatePayload(
  applicationId: string | null,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = { ...payload };

  if (applicationId) {
    try {
      const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
          applicationNumber: true,
          status: true,
          currentStageCode: true,
          submittedAt: true,
          approvedAt: true,
          applicant: { select: { name: true } },
          approvalOrder: { select: { issuedAt: true, orderNumber: true } },
          fees: {
            where: { status: { in: ['ISSUED', 'PART_PAID', 'PENDING'] } },
            orderBy: { issuedAt: 'desc' },
            take: 1,
            select: { totalAmount: true, demandNumber: true },
          },
          shortfalls: {
            where: { status: { in: ['RAISED', 'NOTIFIED', 'ACTION_REQUIRED'] } },
            orderBy: { raisedAt: 'desc' },
            take: 1,
            select: { title: true, description: true },
          },
        },
      });

      if (app) {
        if (!enriched.applicationNumber) enriched.applicationNumber = app.applicationNumber;
        // The desk, in the words the notice should use. `stageName` is what
        // the Phase 3 desk templates interpolate; `currentStage` is the older
        // name and stays for the templates that already use it.
        if (!enriched.stageName) enriched.stageName = stageLabel(app.currentStageCode);
        if (!enriched.applicantName && app.applicant?.name) enriched.applicantName = app.applicant.name;
        if (!enriched.status) enriched.status = app.status;
        if (!enriched.currentStage) enriched.currentStage = stageLabel(app.currentStageCode);
        const appDate = app.approvedAt || app.approvalOrder?.issuedAt;
        if (!enriched.approvalDate && appDate) {
          enriched.approvalDate = new Date(appDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
        }
        if (!enriched.shortfallReason && (app.shortfalls[0]?.title || app.shortfalls[0]?.description)) {
          enriched.shortfallReason = app.shortfalls[0].title || app.shortfalls[0].description;
        }
        if (!enriched.amount && app.fees[0]?.totalAmount) {
          enriched.amount = formatMoney(app.fees[0].totalAmount);
          enriched.total = formatMoney(app.fees[0].totalAmount);
          enriched.demandNumber = app.fees[0].demandNumber;
        }
      }
    } catch {
      // Non-blocking enrichment failure
    }
  }

  // Normalize fallback defaults for core variables if still missing
  if (!enriched.applicationNumber) enriched.applicationNumber = 'APP';
  if (!enriched.applicantName) enriched.applicantName = 'Applicant';
  if (!enriched.status) enriched.status = 'In Progress';
  if (!enriched.currentStage) enriched.currentStage = 'Review';
  if (!enriched.shortfallReason) enriched.shortfallReason = 'Required documentation clarification';
  if (!enriched.amount) enriched.amount = '₹0.00';
  if (!enriched.stageName) enriched.stageName = enriched.currentStage;

  /**
   * The deadline sentence, or an honest silence.
   *
   * A desk notice reading "Due by —" teaches the reader to ignore the line.
   * Where no SLA rule applies to the stage there IS no date, and saying so in
   * a sentence is better than printing a placeholder that looks like data.
   */
  if (!enriched.dueLine) {
    const due = enriched.dueDate ? new Date(String(enriched.dueDate)) : null;
    enriched.dueLine =
      due && !Number.isNaN(due.getTime())
        ? `It is due by ${due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.`
        : 'No service standard applies to this stage.';
  }
  if (!enriched.approvalDate) {
    enriched.approvalDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  return enriched;
}

/** Renders one template against an event payload. */
export async function render(
  template: TemplateRow,
  values: Record<string, unknown>
): Promise<RenderResult> {
  const all = { ...(await ambient()), ...values };

  const subject = fill(template.subject, all);
  const body = fill(template.body, all);

  return {
    subject: subject.text,
    body: body.text,
    providerTemplateId: template.providerTemplateId,
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}

/**
 * The deep link a notification points at.
 */
export function linkFor(eventCode: string, payload: Record<string, unknown>): string {
  const applicationId = String(payload.applicationId ?? '');
  const shortfallId = String(payload.shortfallId ?? '');

  if (eventCode.startsWith('DEVELOPER_REGISTRATION_')) return developerRegistrationLinkFor(payload);
  if (shortfallId) return `${env.appUrl}/shortfalls/${shortfallId}`;
  if (!applicationId) return env.appUrl;

  if (eventCode.startsWith('PAYMENT') || eventCode === 'FEE_GENERATED') {
    return `${env.appUrl}/applications/${applicationId}?tab=payments`;
  }
  if (eventCode.startsWith('SCRUTINY')) {
    return `${env.appUrl}/applications/${applicationId}?tab=scrutiny`;
  }
  if (eventCode.startsWith('TASK') || eventCode.startsWith('APPLICATION_')) {
    return `${env.appUrl}/applications/${applicationId}?tab=workflow`;
  }

  return `${env.appUrl}/applications/${applicationId}`;
}

/** A developer registration's own link, for the events that carry no applicationId. */
export function developerRegistrationLinkFor(payload: Record<string, unknown>): string {
  const id = String(payload.developerRegistrationId ?? '');
  return id ? `${env.appUrl}/developers/${id}` : env.appUrl;
}
