import 'server-only';
import { prisma } from '@/server/db/prisma';
import { audit } from './audit';
import { badRequest, conflict, notFound } from '@/server/http/errors';
import type { AuthUser } from '@/server/auth/context';

type Meta = { ip?: string; userAgent?: string; correlationId?: string };

// Known template variables — used for validation
const KNOWN_VARS = new Set([
  'applicationNumber', 'applicantName', 'status', 'currentStage',
  'shortfallReason', 'amount', 'approvalDate', 'orgName', 'orgShortName',
  'link', 'recipientName', 'demandNumber', 'total',
]);

function validateTemplateBody(body: string): string | null {
  const matches = body.match(/\{\{(\w+)\}\}/g) ?? [];
  const unknown = matches
    .map((m) => m.slice(2, -2))
    .filter((v) => !KNOWN_VARS.has(v));
  if (unknown.length) return `Unknown template variables: ${unknown.join(', ')}`;
  return null;
}

const TEMPLATE_SELECT = {
  id: true,
  eventCode: true,
  channel: true,
  subject: true,
  body: true,
  providerTemplateId: true,
  isActive: true,
  updatedAt: true,
} as const;

export async function listNotificationTemplates() {
  return prisma.notificationTemplate.findMany({
    orderBy: [{ eventCode: 'asc' }, { channel: 'asc' }],
    select: TEMPLATE_SELECT,
  });
}

export async function createNotificationTemplate(
  input: { eventCode: string; channel: string; subject?: string; body: string; providerTemplateId?: string },
  actor: AuthUser,
  meta: Meta = {}
) {
  const err = validateTemplateBody(input.body);
  if (err) throw badRequest(err);

  const clash = await prisma.notificationTemplate.findFirst({
    where: { eventCode: input.eventCode, channel: input.channel, isActive: true },
  });
  if (clash) throw conflict(`An active template for ${input.eventCode}/${input.channel} already exists.`);

  return prisma.$transaction(async (tx) => {
    const tpl = await tx.notificationTemplate.create({
      data: {
        eventCode: input.eventCode,
        channel: input.channel,
        subject: input.subject ?? '',
        body: input.body,
        // The column is NOT NULL with an empty default — "no provider template"
        // is the empty string here, not a null.
        providerTemplateId: input.providerTemplateId ?? '',
        isActive: true,
      },
      select: TEMPLATE_SELECT,
    });
    await audit(tx, { actor, action: 'NOTIFICATION_TEMPLATE_CREATED', entityType: 'NotificationTemplate', entityId: tpl.id, after: { eventCode: tpl.eventCode, channel: tpl.channel }, ...meta });
    return tpl;
  });
}

export async function updateNotificationTemplate(
  id: string,
  input: { subject?: string; body?: string; providerTemplateId?: string; isActive?: boolean },
  actor: AuthUser,
  meta: Meta = {}
) {
  const tpl = await prisma.notificationTemplate.findUnique({ where: { id }, select: TEMPLATE_SELECT });
  if (!tpl) throw notFound('Template not found.');

  if (input.body) {
    const err = validateTemplateBody(input.body);
    if (err) throw badRequest(err);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.notificationTemplate.update({
      where: { id },
      data: {
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.providerTemplateId !== undefined ? { providerTemplateId: input.providerTemplateId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: TEMPLATE_SELECT,
    });
    await audit(tx, { actor, action: 'NOTIFICATION_TEMPLATE_UPDATED', entityType: 'NotificationTemplate', entityId: id, before: tpl, after: updated, ...meta });
    return updated;
  });
}

export async function deleteNotificationTemplate(id: string, actor: AuthUser, meta: Meta = {}) {
  const tpl = await prisma.notificationTemplate.findUnique({ where: { id }, select: { id: true, eventCode: true, channel: true } });
  if (!tpl) throw notFound('Template not found.');

  return prisma.$transaction(async (tx) => {
    await tx.notificationTemplate.update({ where: { id }, data: { isActive: false } });
    await audit(tx, { actor, action: 'NOTIFICATION_TEMPLATE_DELETED', entityType: 'NotificationTemplate', entityId: id, before: tpl, ...meta });
    return { ok: true };
  });
}
