import type { PrismaClient } from '@prisma/client';

/**
 * THE WORKFLOW SEEDER, AS A MECHANISM.
 *
 * BBAS runs more than one approval chain. `bp-standard.ts` holds the
 * six-desk hierarchy the system shipped with; `bbas-standard.ts` holds the
 * four-desk chain the BBAS manuals describe. Both are DATA — the same shape,
 * seeded by the same code — and this file is the code.
 *
 * The split matters beyond tidiness. A second workflow written as a second
 * copy of the seeder would drift: one would learn about a new guard, publish
 * differently, or retire transitions in a way the other did not, and the claim
 * that routing lives entirely in `workflow_transitions` would quietly stop
 * being true for one of them. There is one seeder, so there is one behaviour.
 *
 * Nothing here says which stage follows which. That is in the definitions.
 */

// ═══════════════════════════════════════════════════════════════════════════
// The shape of a workflow
// ═══════════════════════════════════════════════════════════════════════════

export type StageSeed = {
  code: string;
  name: string;
  type: 'LTP_ACTION' | 'REVIEW' | 'APPROVAL' | 'TERMINAL';
  sequence: number;
  ownerRoleKeys: string[];
  entryStatus: string;
  workingStatus?: string;
  slaDays?: number;
  /**
   * Role told when this stage's clock goes overdue.
   *
   * Notification only. Nothing is reassigned, nothing is decided and nothing
   * is deemed approved — passing an SLA has no legal effect in this system
   * (docs R.1.1). Naming a role simply means somebody senior finds out, which
   * is the whole of what "escalation" means here.
   */
  escalateToRoleKey?: string;
  isEntry?: boolean;
  isTerminal?: boolean;
  allowReassign?: boolean;
  description: string;
};

export type TransitionSeed = {
  from: string;
  action: string;
  /** Null applies whatever the current status is. */
  fromStatus?: string | null;
  /** Null when an effect chooses — RETURN_TO_ORIGIN resumes the parked stage. */
  to: string | null;
  toStatus: string;
  allowedRoleKeys?: string[];
  guards?: string[];
  effects?: Array<Record<string, unknown>>;
  notify?: string;
  sla?: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'NONE';
};

export type AssignmentSeed = {
  stage: string;
  roleKey: string;
  strategy: 'ROLE_QUEUE' | 'LEAST_LOADED';
  priority: number;
  notes: string;
};

export type WorkflowDefinition = {
  code: string;
  version: number;
  name: string;
  description: string;
  stages: StageSeed[];
  /** The review desks in order. Drives FORWARD and RETURN. */
  pipeline: readonly string[];
  /** The status a file takes while parked, per raising stage and shortfall kind. */
  parkedStatus: Record<string, Record<string, string>>;
  /** Built by `transitionsFor`, which is given the helpers bound to this definition. */
  transitions: (h: TransitionHelpers) => TransitionSeed[];
  assignments: AssignmentSeed[];
};

// ═══════════════════════════════════════════════════════════════════════════
// The helpers a definition writes its transitions with
// ═══════════════════════════════════════════════════════════════════════════

export type TransitionHelpers = {
  /** Entry status of a stage, by code. */
  entryStatus: (stage: string) => string;
  /** Working status of a stage, falling back to its entry status. */
  workingStatus: (stage: string) => string;
  /** A blocking shortfall: park the file with the applicant, pause the clock. */
  park: (
    from: string,
    kind: string,
    action: string,
    extra?: Array<Record<string, unknown>>
  ) => TransitionSeed;
  /** A reported shortfall: record it, and move on regardless. */
  report: (
    from: string,
    kind: string,
    action: string,
    extra?: Array<Record<string, unknown>>,
    toStatusOverride?: string
  ) => TransitionSeed;
  /** Send it on to the next desk in the pipeline. */
  forward: (from: string) => TransitionSeed;
  /** Send it back one desk. */
  returnBack: (from: string) => TransitionSeed;
  /** Accept or reject the applicant's answer, from the desk that raised it. */
  shortfallVerdict: (stage: string) => TransitionSeed[];
  /** Close a shortfall that travelled here rather than parking the file. */
  closeReported: (stage: string) => TransitionSeed;
};

function helpersFor(def: Omit<WorkflowDefinition, 'transitions'>): TransitionHelpers {
  const entry: Record<string, string> = Object.fromEntries(
    def.stages.map((s) => [s.code, s.entryStatus])
  );
  const working: Record<string, string> = Object.fromEntries(
    def.stages.map((s) => [s.code, s.workingStatus ?? s.entryStatus])
  );

  const entryStatus = (stage: string) => {
    const status = entry[stage];
    if (!status) throw new Error(`${def.code}: no stage "${stage}"`);
    return status;
  };

  const workingStatus = (stage: string) => {
    const status = working[stage];
    if (!status) throw new Error(`${def.code}: no stage "${stage}"`);
    return status;
  };

  const nextAfter = (from: string) => {
    const i = def.pipeline.indexOf(from);
    const next = i >= 0 ? def.pipeline[i + 1] : undefined;
    if (!next) throw new Error(`${def.code}: "${from}" has no next desk in the pipeline`);
    return next;
  };

  const previousBefore = (from: string) => {
    const i = def.pipeline.indexOf(from);
    const previous = i > 0 ? def.pipeline[i - 1] : undefined;
    if (!previous) throw new Error(`${def.code}: "${from}" has no previous desk in the pipeline`);
    return previous;
  };

  return {
    entryStatus,
    workingStatus,

    park: (from, kind, action, extra = []) => ({
      from,
      action,
      to: 'LTP_SHORTFALL_ACTION',
      toStatus: def.parkedStatus[from]?.[kind] ?? 'RETURNED_TO_APPLICANT',
      guards: ['has_remarks'],
      effects: [{ type: 'RAISE_SHORTFALL', kind, mode: 'BLOCKING' }, ...extra],
      // No `notify`: the shortfall engine emits SHORTFALL_RAISED itself,
      // carrying the shortfall id the dispatcher needs in order to record that
      // somebody was actually told. A second event here would announce one
      // decision twice.
      notify: '',
      sla: 'PAUSE',
    }),

    report: (from, kind, action, extra = [], toStatusOverride) => {
      const next = nextAfter(from);
      return {
        from,
        action,
        to: next,
        toStatus: toStatusOverride ?? entryStatus(next),
        guards: ['has_remarks'],
        effects: [{ type: 'RAISE_SHORTFALL', kind, mode: 'REPORTED' }, ...extra],
        // The shortfall engine announces the shortfall; this announces the
        // movement, which is a different fact for a different reader — the next
        // desk needs to know the file has arrived.
        notify: 'APPLICATION_FORWARDED',
        // The clock keeps running. That is the whole difference from `park`:
        // the department has not stopped work, so it is still measuring itself.
        sla: 'START',
      };
    },

    forward: (from) => {
      const next = nextAfter(from);
      return {
        from,
        action: 'FORWARD',
        to: next,
        toStatus: entryStatus(next),
        guards: ['has_remarks'],
        notify: 'APPLICATION_FORWARDED',
        sla: 'START',
      };
    },

    returnBack: (from) => {
      const previous = previousBefore(from);
      return {
        from,
        action: 'RETURN_TO_PREVIOUS',
        to: previous,
        toStatus: entryStatus(previous),
        guards: ['has_remarks'],
        notify: 'APPLICATION_RETURNED',
        sla: 'START',
      };
    },

    shortfallVerdict: (stage) => [
      {
        from: stage,
        action: 'ACCEPT_RESOLUTION',
        fromStatus: 'SHORTFALL_RESPONDED',
        // Same stage: the officer keeps the file they are already holding, and
        // their SLA — resumed when the answer arrived — keeps running.
        to: stage,
        toStatus: workingStatus(stage),
        guards: ['shortfall_awaiting_review', 'has_remarks'],
        effects: [{ type: 'RESOLVE_SHORTFALL' }],
        notify: '',
        sla: 'NONE',
      },
      {
        from: stage,
        action: 'REJECT_RESOLUTION',
        fromStatus: 'SHORTFALL_RESPONDED',
        to: 'LTP_SHORTFALL_ACTION',
        toStatus: 'RETURNED_TO_APPLICANT',
        guards: ['shortfall_awaiting_review', 'has_remarks'],
        effects: [{ type: 'REJECT_RESOLUTION' }],
        notify: '',
        sla: 'PAUSE',
      },
    ],

    closeReported: (stage) => ({
      from: stage,
      action: 'RESOLVE_REPORTED_SHORTFALL',
      fromStatus: null,
      // Same stage: settling a shortfall is not a movement, and the officer
      // keeps the file and the clock they already had.
      to: stage,
      toStatus: workingStatus(stage),
      guards: ['reported_shortfall_open', 'has_remarks'],
      effects: [{ type: 'RESOLVE_SHORTFALL', mode: 'REPORTED' }],
      notify: '',
      sla: 'NONE',
    }),
  };
}

/** Resolves a definition's transitions against its own stages and pipeline. */
export function transitionsOf(def: WorkflowDefinition): TransitionSeed[] {
  return def.transitions(helpersFor(def));
}

// ═══════════════════════════════════════════════════════════════════════════
// Seeding one workflow
// ═══════════════════════════════════════════════════════════════════════════

export type BuildResult = {
  code: string;
  stages: number;
  transitions: number;
  retired: number;
  slaRules: number;
  assignments: number;
  published: boolean;
  issues: Array<{ rule: string; severity: string; message: string }>;
};

export async function buildWorkflow(
  prisma: PrismaClient,
  def: WorkflowDefinition
): Promise<BuildResult> {
  const workflow = await prisma.workflow.upsert({
    where: { code_version: { code: def.code, version: def.version } },
    create: {
      code: def.code,
      version: def.version,
      name: def.name,
      description: def.description,
    },
    update: { name: def.name, description: def.description },
  });

  // ── Stages ──────────────────────────────────────────────────────────────
  const stageIds = new Map<string, string>();

  for (const stage of def.stages) {
    const row = await prisma.workflowStage.upsert({
      where: { workflowId_code: { workflowId: workflow.id, code: stage.code } },
      create: {
        workflowId: workflow.id,
        code: stage.code,
        name: stage.name,
        type: stage.type,
        sequence: stage.sequence,
        ownerRoleKeys: stage.ownerRoleKeys,
        entryStatus: stage.entryStatus as never,
        workingStatus: (stage.workingStatus ?? null) as never,
        slaDays: stage.slaDays ?? 0,
        isEntry: stage.isEntry ?? false,
        isTerminal: stage.isTerminal ?? false,
        allowReassign: stage.allowReassign ?? true,
        description: stage.description,
      },
      update: {
        name: stage.name,
        type: stage.type,
        sequence: stage.sequence,
        ownerRoleKeys: stage.ownerRoleKeys,
        entryStatus: stage.entryStatus as never,
        workingStatus: (stage.workingStatus ?? null) as never,
        slaDays: stage.slaDays ?? 0,
        isEntry: stage.isEntry ?? false,
        isTerminal: stage.isTerminal ?? false,
        allowReassign: stage.allowReassign ?? true,
        description: stage.description,
        isActive: true,
      },
    });
    stageIds.set(stage.code, row.id);
  }

  // ── Transitions ─────────────────────────────────────────────────────────
  //
  // Rows not in this seed are DEACTIVATED rather than deleted: a running
  // instance may have taken one, and its history row names it. Deleting the
  // row would leave that history referring to something that no longer exists.
  const transitions = transitionsOf(def);
  const seededTransitionIds: string[] = [];

  for (const t of transitions) {
    const fromStageId = stageIds.get(t.from);
    if (!fromStageId) {
      throw new Error(`${def.code}: unknown stage "${t.from}" in a transition`);
    }

    const action = await prisma.workflowAction.findUnique({
      where: { code: t.action },
      select: { id: true },
    });
    if (!action) {
      throw new Error(`${def.code}: unknown action "${t.action}" in a transition from ${t.from}`);
    }

    const data = {
      workflowId: workflow.id,
      fromStageId,
      actionId: action.id,
      fromStatus: (t.fromStatus ?? null) as never,
      toStageId: t.to ? (stageIds.get(t.to) ?? null) : null,
      toStatus: t.toStatus as never,
      allowedRoleKeys: t.allowedRoleKeys ?? [],
      guards: t.guards ?? [],
      effects: (t.effects ?? []) as never,
      notifyEvent: t.notify ?? '',
      slaBehavior: t.sla ?? 'NONE',
      isActive: true,
    };

    // `findFirst` then create/update rather than `upsert`: `fromStatus` is
    // nullable and Prisma refuses a null inside a composite unique key, which
    // is exactly the shape every "applies to any status" row has.
    const existing = await prisma.workflowTransition.findFirst({
      where: {
        workflowId: workflow.id,
        fromStageId,
        actionId: action.id,
        fromStatus: (t.fromStatus ?? null) as never,
      },
      select: { id: true },
    });

    const row = existing
      ? await prisma.workflowTransition.update({ where: { id: existing.id }, data })
      : await prisma.workflowTransition.create({ data });

    seededTransitionIds.push(row.id);
  }

  const { count: retired } = await prisma.workflowTransition.updateMany({
    where: { workflowId: workflow.id, id: { notIn: seededTransitionIds }, isActive: true },
    data: { isActive: false },
  });

  // ── SLA rules ───────────────────────────────────────────────────────────
  let slaRules = 0;
  for (const stage of def.stages) {
    if (!stage.slaDays) continue;
    const stageId = stageIds.get(stage.code)!;

    // Same nullable-composite-key limitation as the transitions above: the
    // general rule for a stage has no application type, so it is matched by
    // hand rather than through the unique key.
    const existing = await prisma.slaRule.findFirst({
      where: { workflowStageId: stageId, applicationTypeId: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.slaRule.update({
        where: { id: existing.id },
        data: {
          days: stage.slaDays,
          isActive: true,
          escalateToRoleKey: stage.escalateToRoleKey ?? null,
        },
      });
    } else {
      await prisma.slaRule.create({
        data: {
          workflowStageId: stageId,
          days: stage.slaDays,
          calendar: 'WORKING_DAYS',
          warnAtPercent: 70,
          pauseOnShortfall: true,
          escalateToRoleKey: stage.escalateToRoleKey ?? null,
        },
      });
    }
    slaRules += 1;
  }

  // ── Assignment rules ────────────────────────────────────────────────────
  for (const rule of def.assignments) {
    const stageId = stageIds.get(rule.stage);
    if (!stageId) continue;

    // The unique key includes a nullable zone, so the "every zone" rule is
    // matched by hand — `upsert` cannot express a NULL in a composite key.
    const existing = await prisma.workflowAssignment.findFirst({
      where: { stageId, roleKey: rule.roleKey, zoneId: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.workflowAssignment.update({
        where: { id: existing.id },
        data: { strategy: rule.strategy, priority: rule.priority, notes: rule.notes, isActive: true },
      });
    } else {
      await prisma.workflowAssignment.create({
        data: {
          workflowId: workflow.id,
          stageId,
          roleKey: rule.roleKey,
          strategy: rule.strategy,
          priority: rule.priority,
          notes: rule.notes,
        },
      });
    }
  }

  // ── Validate, then publish ──────────────────────────────────────────────
  //
  // The seed publishes ONLY a workflow that validates. A graph with a dead end
  // or an unknown guard stays unpublished, and `startWorkflow` refuses to route
  // applications through an unpublished workflow — so the failure is a clear
  // refusal at the gate rather than a file stuck at a desk with no way out.
  const { validateWorkflow } = await import('../../../src/server/workflow/validate');
  const report = await validateWorkflow(prisma, workflow.id);

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: report.valid
      ? { isPublished: true, publishedAt: new Date() }
      : { isPublished: false },
  });

  return {
    code: def.code,
    stages: def.stages.length,
    transitions: transitions.length,
    retired,
    slaRules,
    assignments: def.assignments.length,
    published: report.valid,
    issues: report.issues,
  };
}
