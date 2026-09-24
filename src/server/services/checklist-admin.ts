import 'server-only';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { audit } from './audit';
import { badRequest, notFound } from '@/server/http/errors';
import type { AuthUser } from '@/server/auth/context';

type Meta = { ip?: string; userAgent?: string; correlationId?: string };

/**
 * The checklist definitions, as administration.
 *
 * This screen exists because the wording is not final. The BBAS manuals
 * describe the 19-point and 27-point checklists but do not reproduce their
 * questions as text, so the rows are seeded with provisional sentences marked
 * as such. When the official text arrives somebody types it in here and clears
 * the provisional flag — no migration, no deployment, no code.
 *
 * Editing is deliberately narrow. An administrator may change what a question
 * SAYS and how it BEHAVES; they may not create or delete questions, because
 * the checklists are statutory and their length is not an administrator's
 * decision. That is also why `itemNumber` is not editable: officers, letters
 * and shortfall items refer to "question 14", and renumbering would break
 * every one of those references retrospectively.
 */

export const CHECKLIST_KINDS = ['APPLICATION', 'SITE_INSPECTION'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const RESPONSE_TYPES = ['YES_NO', 'YES_NO_NA', 'TEXT', 'NUMBER', 'MEASUREMENT'] as const;

const SELECT = {
  id: true,
  kind: true,
  itemNumber: true,
  question: true,
  description: true,
  responseType: true,
  category: true,
  helpText: true,
  isMandatory: true,
  requiresDocument: true,
  affectsRisk: true,
  displayOrder: true,
  isActive: true,
  isProvisional: true,
  source: true,
  updatedAt: true,
} as const;

export async function listChecklistItems(kind?: string) {
  return prisma.checklistItemDefinition.findMany({
    where: kind ? { kind } : {},
    orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { itemNumber: 'asc' }],
    select: SELECT,
  });
}

export const updateChecklistItemSchema = z.object({
  question: z.string().min(5).max(500).optional(),
  description: z.string().max(2000).optional(),
  responseType: z.enum(RESPONSE_TYPES).optional(),
  category: z.string().max(100).optional(),
  helpText: z.string().max(2000).optional(),
  isMandatory: z.boolean().optional(),
  requiresDocument: z.boolean().optional(),
  affectsRisk: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  /**
   * Cleared by the person who types in the official wording.
   *
   * One-way on purpose: a question marked official cannot be marked
   * provisional again from here. Going back would mean the wording on screen
   * had stopped being the statutory text while still being presented as a
   * statutory question, and nothing in this screen is worth that risk. The
   * seed also refuses to touch a row once the flag is cleared, so re-running
   * it cannot undo the correction.
   */
  isProvisional: z.literal(false).optional(),
  source: z.string().max(500).optional(),
});

export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

export async function updateChecklistItem(
  id: string,
  input: UpdateChecklistItemInput,
  actor: AuthUser,
  meta: Meta = {}
) {
  const before = await prisma.checklistItemDefinition.findUnique({ where: { id }, select: SELECT });
  if (!before) throw notFound('That checklist question does not exist.');

  if (Object.keys(input).length === 0) {
    throw badRequest('Nothing to change.');
  }

  // Clearing the provisional flag is a claim that the wording on the row is
  // the official one, so it has to be accompanied by wording.
  if (input.isProvisional === false && !input.question && before.isProvisional) {
    const unchanged = before.question.trim();
    if (!unchanged) throw badRequest('Enter the official wording before marking it official.');
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.checklistItemDefinition.update({
      where: { id },
      data: {
        ...input,
        // Editing a provisional row's wording without explicitly marking it
        // official leaves the flag alone: a better placeholder is still a
        // placeholder, and only a deliberate act should remove the warning the
        // interface shows beside it.
        ...(input.source === undefined && input.isProvisional === false
          ? { source: 'Official BBAS wording entered by an administrator.' }
          : {}),
      },
      select: SELECT,
    });

    await audit(tx, {
      actor,
      action: 'CHECKLIST_ITEM_UPDATED',
      entityType: 'ChecklistItemDefinition',
      entityId: id,
      before,
      after,
      remarks: `${before.kind} question ${before.itemNumber}`,
      ...meta,
    });

    return after;
  });
}

/** Counts for the screen's header, per checklist. */
export async function checklistSummary() {
  const rows = await prisma.checklistItemDefinition.groupBy({
    by: ['kind', 'isActive', 'isProvisional'],
    _count: { _all: true },
  });

  const summary: Record<string, { total: number; active: number; provisional: number }> = {};
  for (const kind of CHECKLIST_KINDS) {
    summary[kind] = { total: 0, active: 0, provisional: 0 };
  }

  for (const row of rows) {
    const entry = summary[row.kind];
    if (!entry) continue;
    entry.total += row._count._all;
    if (row.isActive) entry.active += row._count._all;
    if (row.isProvisional) entry.provisional += row._count._all;
  }

  return summary;
}
