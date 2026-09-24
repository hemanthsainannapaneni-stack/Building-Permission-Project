import 'server-only';
import type { Prisma, ApplicationStatus } from '@prisma/client';
import { prisma, type Tx } from '@/server/db/prisma';
import { can, type AuthUser } from '@/server/auth/context';
import { assertApplicationAccess } from '@/server/auth/scope';
import { audit } from '@/server/services/audit';
import { recordEvent, EVENT_TYPES } from '@/server/services/timeline';
import { emit, EVENTS } from '@/server/events/outbox';
import { conflict, forbidden, guardFailed, staleWrite } from '@/server/http/errors';
import { CAPABILITIES, CLOSED_SHORTFALL_STATUSES } from '@/lib/constants';
import { ACTIONS, stageName, type EffectSpec } from '@/lib/workflow';
import { SHOW_CAUSE_DECISION_LABEL, type ShowCauseDecision } from '@/lib/show-cause';
import { evaluateGuards, isApplicabilityGuard, type GuardEvaluation } from './guards';
import { applyEffects, type EffectContext } from './effects';
import { resolveAssignment } from './assignment';
import { carryOverPausedSla, describeSlaClock, pauseSla, startSla, stopSla, type SlaClock } from './sla';

/**
 * THE WORKFLOW ENGINE.
 *
 * ── The contract, in one line ────────────────────────────────────────────
 *
 *   (current stage, current status, actor role, action)
 *        → (next stage, next status, task, SLA, notification, audit)
 *
 * and the arrow is a row in `workflow_transitions`, not a branch in this file.
 *
 * ── What this file is not allowed to know ────────────────────────────────
 *
 * Search it for `TPA`, `ZJD`, `COMMISSIONER` or any other stage. There are
 * none, and that is the property worth protecting: the engine cannot know that
 * ZJD may report a fee shortfall and forward, or that the Additional
 * Commissioner's action set is still provisional, because those are rows an
 * administrator edits. The consequence is that adding "the Additional
 * Commissioner may now also raise a technical shortfall" is a seed change and
 * a migration of data — never a deployment of new logic, and never a new page.
 *
 * The three things the engine DOES know, because they are structural rather
 * than departmental:
 *
 *   1. A file sits at exactly one stage and has exactly one open task.
 *   2. An action is permitted when a transition exists for it, the actor holds
 *      a role the transition allows and the capability the action requires,
 *      and every guard passes.
 *   3. Anything a transition changes is changed in ONE transaction with the
 *      history row that records it.
 *
 * ── Availability is computed once, and used twice ────────────────────────
 *
 * `availableActions()` and `performAction()` run the same resolution and the
 * same guards. The action bar therefore cannot offer a button the POST would
 * refuse, and cannot hide one it would accept. That is what §43's "no fake
 * buttons" costs: one shared code path, and no second opinion anywhere in the
 * UI about what an officer may do.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

const STAGE_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  sequence: true,
  ownerRoleKeys: true,
  entryStatus: true,
  workingStatus: true,
  slaDays: true,
  isTerminal: true,
  isEntry: true,
  allowReassign: true,
} satisfies Prisma.WorkflowStageSelect;

type StageRow = Prisma.WorkflowStageGetPayload<{ select: typeof STAGE_SELECT }>;

const TRANSITION_SELECT = {
  id: true,
  fromStatus: true,
  toStageId: true,
  toStatus: true,
  allowedRoleKeys: true,
  guards: true,
  effects: true,
  notifyEvent: true,
  slaBehavior: true,
  priority: true,
  fromStage: { select: STAGE_SELECT },
  toStage: { select: STAGE_SELECT },
  action: {
    select: {
      id: true,
      code: true,
      label: true,
      kind: true,
      intent: true,
      capabilityKey: true,
      requiresRemarks: true,
      requiresAttachment: true,
      confirmText: true,
      displayOrder: true,
    },
  },
} satisfies Prisma.WorkflowTransitionSelect;

type TransitionRow = Prisma.WorkflowTransitionGetPayload<{ select: typeof TRANSITION_SELECT }>;

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  status: true,
  applicationTypeId: true,
  zoneId: true,
  ltpUserId: true,
  openShortfalls: true,
  currentStageCode: true,
  applicationType: { select: { id: true, name: true, workflowId: true } },
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

export type ActionInput = {
  remarks?: string;
  attachments?: Array<Record<string, unknown>>;
  shortfall?: EffectContext['input']['shortfall'];
  shortfallId?: string;
  /** Per-item answers and verdicts, for the transitions that record them. */
  shortfallItems?: EffectContext['input']['shortfallItems'];
  shortfallDecisions?: EffectContext['input']['shortfallDecisions'];
  /** A show cause notice's or a revocation's particulars — see the SHOW_CAUSE and REVOCATION effects. */
  proceeding?: Record<string, unknown>;
  /**
   * The history sequence the client rendered. A mismatch means somebody else
   * acted on this file in the meantime and the officer is looking at a stale
   * screen — see the 409 in `performAction`.
   */
  expectedSequence?: number;
};

export type Meta = { ip: string; userAgent: string; correlationId?: string };

/** One action, as the action bar renders it. */
export type ActionOption = {
  code: string;
  label: string;
  kind: string;
  intent: string;
  requiresRemarks: boolean;
  requiresAttachment: boolean;
  confirmText: string;
  /** Where the file goes. Empty when an effect decides (the parked stage). */
  toStageCode: string;
  toStageName: string;
  toStatus: string;
  /** Whether every guard passes right now. */
  available: boolean;
  /** The first failing guard's message, in the officer's words. */
  reason: string;
  guards: GuardEvaluation[];
  /** Present when performing it opens a shortfall — drives the modal's fields. */
  shortfall: { kind: string; mode: string } | null;
  /**
   * Present when the action belongs to the site inspection service. The action
   * bar renders these as a pointer to the Site Inspection tab instead of a
   * modal: booking needs an inspector and a date, and submitting needs 27
   * answers, photographs and a signature, none of which the modal can collect.
   * Read from the transition's effects, like `shortfall`, never from its code.
   */
  inspection: { step: string } | null;
  /**
   * Present when the action belongs to the show cause or revocation module.
   * Rendered as a pointer to the Proceedings tab, for the same reason as
   * `inspection`: the notice and the proposal need particulars the modal
   * cannot collect. Read from the transition's effects.
   */
  proceeding: { module: 'SHOW_CAUSE' | 'REVOCATION'; step: string } | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// Capabilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What an action requires of the actor.
 *
 * `workflow_actions.capabilityKey` is authoritative, so granting an action to
 * a different set of roles is configuration. The fallback by KIND exists so
 * that an action added by an administrator who left the field blank is still
 * gated by something sensible rather than by nothing at all — the failure mode
 * of a blank capability must be "restrictive", never "open".
 */
const KIND_CAPABILITY: Record<string, string> = {
  FORWARD: CAPABILITIES.WORKFLOW_FORWARD,
  REPORT_AND_FORWARD: CAPABILITIES.WORKFLOW_FORWARD,
  RETURN: CAPABILITIES.WORKFLOW_RETURN,
  CLARIFY: CAPABILITIES.SHORTFALL_CREATE,
  RESUBMIT: CAPABILITIES.SHORTFALL_RESPOND,
  APPROVE: CAPABILITIES.APPLICATION_APPROVE,
  REJECT: CAPABILITIES.APPLICATION_REJECT,
  SYSTEM: '',
};

export function actionCapability(action: { kind: string; capabilityKey: string }): string {
  return action.capabilityKey || KIND_CAPABILITY[action.kind] || CAPABILITIES.WORKFLOW_FORWARD;
}

// ═══════════════════════════════════════════════════════════════════════════
// Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every transition out of this stage, most specific first.
 *
 * A row naming the current status beats a row that applies to any status —
 * `nulls: 'last'` is what expresses that, and it is the whole of the
 * precedence rule. Two rows that both name the same status cannot exist: the
 * model's unique constraint forbids it, and the partial index added in the
 * phase-6 migration forbids two "any status" rows as well.
 */
async function transitionsFrom(
  db: Tx,
  workflowId: string,
  stageId: string,
  status: string
): Promise<TransitionRow[]> {
  const rows = await db.workflowTransition.findMany({
    where: {
      workflowId,
      fromStageId: stageId,
      isActive: true,
      OR: [{ fromStatus: status as ApplicationStatus }, { fromStatus: null }],
    },
    select: TRANSITION_SELECT,
    orderBy: [{ priority: 'desc' }, { fromStatus: { sort: 'asc', nulls: 'last' } }],
  });

  // One row per action: the status-specific one wins over the catch-all.
  const byAction = new Map<string, TransitionRow>();
  for (const row of rows) {
    const existing = byAction.get(row.action.code);
    if (!existing || (existing.fromStatus === null && row.fromStatus !== null)) {
      byAction.set(row.action.code, row);
    }
  }

  return [...byAction.values()].sort(
    (a, b) => a.action.displayOrder - b.action.displayOrder || a.action.code.localeCompare(b.action.code)
  );
}

/** The roles a transition admits. Empty `allowedRoleKeys` means the stage's own. */
const rolesFor = (transition: TransitionRow): string[] => {
  const allowed = Array.isArray(transition.allowedRoleKeys) ? (transition.allowedRoleKeys as string[]) : [];
  if (allowed.length) return allowed;
  return Array.isArray(transition.fromStage.ownerRoleKeys) ? (transition.fromStage.ownerRoleKeys as string[]) : [];
};

/**
 * Whether the actor may perform this transition AT ALL — role and capability,
 * before any guard is evaluated.
 *
 * Guards answer "is the file ready?"; this answers "is this your decision to
 * make?". They are kept apart because the first is worth showing an officer as
 * a disabled button with a reason, and the second is not: an action belonging
 * to somebody else's desk should not appear on yours at all.
 */
function mayAttempt(user: AuthUser, transition: TransitionRow): boolean {
  const roles = rolesFor(transition);
  if (!roles.some((role) => user.roleKeys.includes(role as never))) return false;

  const capability = actionCapability(transition.action);
  return capability === '' || can(user, capability);
}

const asEffects = (value: unknown): EffectSpec[] =>
  Array.isArray(value) ? (value as EffectSpec[]) : [];

const asGuards = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

/** The inspection step an action performs, read from its effects rather than its name. */
function inspectionShapeOf(transition: TransitionRow): { step: string } | null {
  const link = asEffects(transition.effects).find((e) => e.type === 'LINK_SITE_INSPECTION');
  return link ? { step: String(link.step ?? '') } : null;
}

/** The proceeding an action belongs to, read from its effects rather than its name. */
function proceedingShapeOf(transition: TransitionRow): ActionOption['proceeding'] {
  const e = asEffects(transition.effects).find((x) => x.type === 'SHOW_CAUSE' || x.type === 'REVOCATION');
  return e ? { module: e.type as 'SHOW_CAUSE' | 'REVOCATION', step: String(e.step ?? '') } : null;
}

/** The shortfall an action opens, read from its effects rather than its name. */
function shortfallShapeOf(transition: TransitionRow): { kind: string; mode: string } | null {
  const raise = asEffects(transition.effects).find((e) => e.type === 'RAISE_SHORTFALL');
  if (!raise) return null;
  return { kind: String(raise.kind ?? 'DOCUMENT'), mode: String(raise.mode ?? 'BLOCKING') };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading the current state
// ═══════════════════════════════════════════════════════════════════════════

export type WorkflowState = {
  application: { id: string; applicationNumber: string; status: string };
  /** Null before the file reaches the department — see `startWorkflow`. */
  instance: {
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    parkedStageCode: string | null;
  } | null;
  stage: { code: string; name: string; type: string; sequence: number; isTerminal: boolean } | null;
  task: {
    id: string;
    status: string;
    assignedRoleKey: string;
    assignedUserId: string | null;
    assignedUserName: string;
    receivedAt: Date;
    claimedAt: Date | null;
    priority: number;
    dueAt: Date | null;
    slaStatus: string | null;
    /** The whole clock, for the panel that shows it. Null when untimed. */
    sla: SlaClock | null;
    /** True when this user could claim or act on it. */
    mine: boolean;
  } | null;
  actions: ActionOption[];
  /** The sequence the client must echo back when it acts. */
  sequence: number;
};

/**
 * What the officer's action bar renders, and the only source for it.
 *
 * Read-only: it opens a transaction because the guards take one, and writes
 * nothing inside it.
 */
export async function getWorkflowState(user: AuthUser, applicationId: string): Promise<WorkflowState> {
  await assertApplicationAccess(user, applicationId);

  return prisma.$transaction(async (tx) => {
    const application = await tx.application.findFirstOrThrow({
      where: { id: applicationId, deletedAt: null },
      select: APPLICATION_SELECT,
    });

    const instance = await tx.workflowInstance.findUnique({
      where: { applicationId },
      select: {
        id: true,
        workflowId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        currentStageId: true,
        parkedStageId: true,
      },
    });

    if (!instance) {
      return {
        application: {
          id: application.id,
          applicationNumber: application.applicationNumber,
          status: application.status,
        },
        instance: null,
        stage: null,
        task: null,
        actions: [],
        sequence: 0,
      } satisfies WorkflowState;
    }

    const [stage, parked, task, last] = await Promise.all([
      instance.currentStageId
        ? tx.workflowStage.findUnique({ where: { id: instance.currentStageId }, select: STAGE_SELECT })
        : null,
      instance.parkedStageId
        ? tx.workflowStage.findUnique({ where: { id: instance.parkedStageId }, select: { code: true } })
        : null,
      tx.workflowTask.findFirst({
        where: { instanceId: instance.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        select: {
          id: true,
          status: true,
          assignedRoleKey: true,
          assignedUserId: true,
          receivedAt: true,
          claimedAt: true,
          priority: true,
          assignee: { select: { name: true } },
          stage: { select: { ownerRoleKeys: true } },
          // The whole clock, not just its verdict. A screen that shows only
          // "Overdue" cannot answer the question an officer actually asks —
          // overdue against what, and by how long.
          sla: {
            select: {
              dueAt: true,
              status: true,
              startedAt: true,
              pausedAt: true,
              pausedMs: true,
              overdueDays: true,
              rule: { select: { days: true, calendar: true, escalateToRoleKey: true } },
            },
          },
        },
      }),
      tx.workflowHistory.findFirst({
        where: { instanceId: instance.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
    ]);

    const actions = stage
      ? await buildActions(tx, user, application, instance, stage)
      : [];

    return {
      application: {
        id: application.id,
        applicationNumber: application.applicationNumber,
        status: application.status,
      },
      instance: {
        id: instance.id,
        status: instance.status,
        startedAt: instance.startedAt,
        completedAt: instance.completedAt,
        parkedStageCode: parked?.code ?? null,
      },
      stage: stage
        ? {
            code: stage.code,
            name: stage.name,
            type: stage.type,
            sequence: stage.sequence,
            isTerminal: stage.isTerminal,
          }
        : null,
      task: task
        ? {
            id: task.id,
            status: task.status,
            assignedRoleKey: task.assignedRoleKey,
            assignedUserId: task.assignedUserId,
            assignedUserName: task.assignee?.name ?? '',
            receivedAt: task.receivedAt,
            claimedAt: task.claimedAt,
            priority: task.priority,
            dueAt: task.sla?.dueAt ?? null,
            slaStatus: task.sla?.status ?? null,
            sla: task.sla ? describeSlaClock(task.sla) : null,
            mine:
              Array.isArray(task.stage.ownerRoleKeys) &&
              (task.stage.ownerRoleKeys as string[]).some((role) => user.roleKeys.includes(role as never)),
          }
        : null,
      actions,
      sequence: last?.sequence ?? 0,
    } satisfies WorkflowState;
  });
}

/** Resolves and evaluates every action this user could take at this stage. */
async function buildActions(
  tx: Tx,
  user: AuthUser,
  application: ApplicationRow,
  instance: { id: string; workflowId: string },
  stage: StageRow
): Promise<ActionOption[]> {
  const transitions = await transitionsFrom(tx, instance.workflowId, stage.id, application.status);
  const options: ActionOption[] = [];

  for (const transition of transitions) {
    // A SYSTEM action is raised by the system and never offered to anybody.
    if (transition.action.kind === 'SYSTEM') continue;
    if (!mayAttempt(user, transition)) continue;

    // `has_remarks` is evaluated with empty remarks here on purpose: the modal
    // has not been filled in yet, so the guard reports it as outstanding and
    // the UI turns that into a required field rather than a refusal.
    const guards = await evaluateGuards(asGuards(transition.guards), {
      tx,
      application,
      input: { remarks: '', attachments: [] },
    });

    const failing = guards.filter((g) => !g.passed);

    // An action whose APPLICABILITY guard fails is not offered at all — see
    // isApplicabilityGuard(). Everything else that fails is offered disabled,
    // carrying the reason, so an officer learns what would make it possible.
    if (failing.some((g) => isApplicabilityGuard(g.name))) continue;

    const blocking = failing.filter((g) => g.name !== 'has_remarks' && g.name !== 'has_attachment');

    options.push({
      code: transition.action.code,
      label: transition.action.label,
      kind: transition.action.kind,
      intent: transition.action.intent,
      requiresRemarks: transition.action.requiresRemarks || guards.some((g) => g.name === 'has_remarks'),
      requiresAttachment:
        transition.action.requiresAttachment || guards.some((g) => g.name === 'has_attachment'),
      confirmText: transition.action.confirmText,
      toStageCode: transition.toStage?.code ?? '',
      toStageName: transition.toStage?.name ?? destinationHint(transition),
      toStatus: transition.toStatus,
      available: blocking.length === 0,
      reason: blocking[0]?.message ?? '',
      guards,
      shortfall: shortfallShapeOf(transition),
      inspection: inspectionShapeOf(transition),
      proceeding: proceedingShapeOf(transition),
    });
  }

  return options;
}

/** What to call a destination an effect chooses. */
function destinationHint(transition: TransitionRow): string {
  const effects = asEffects(transition.effects);
  if (effects.some((e) => e.type === 'RETURN_TO_ORIGIN')) return 'Back to the desk that raised it';
  return 'Decided when the action is performed';
}

// ═══════════════════════════════════════════════════════════════════════════
// Performing an action
// ═══════════════════════════════════════════════════════════════════════════

export type ActionResult = {
  applicationId: string;
  applicationNumber: string;
  actionCode: string;
  fromStageCode: string;
  toStageCode: string;
  fromStatus: string;
  toStatus: string;
  sequence: number;
  /** One sentence for the toast, naming what actually happened. */
  message: string;
  taskId: string | null;
  shortfallNumbers: string[];
};

/**
 * The one way an application moves.
 *
 * Everything here happens in a single transaction, opened with a row lock on
 * the workflow instance. Two officers pressing Forward on the same file at the
 * same moment therefore serialise: the second one finds the file has moved and
 * is told so, rather than producing a second history row for a stage the file
 * has already left.
 */
export async function performAction(
  user: AuthUser,
  applicationId: string,
  actionCode: string,
  input: ActionInput,
  meta: Meta
): Promise<ActionResult> {
  await assertApplicationAccess(user, applicationId);

  return prisma.$transaction(
    (tx) => executeForUser(tx, user, applicationId, actionCode, input, meta, new Date()),
    // Guards read the document checklist and the fee ledger; the default 5s
    // is tight for an application with a long requirement list on a cold
    // cache, and a transition timing out mid-way is the one outcome worth
    // spending a few seconds to avoid.
    { timeout: 20_000 }
  );
}

/**
 * `performAction`, inside a transaction the CALLER owns.
 *
 * For a module whose own writes and the file's movement must commit together
 * or not at all — the site inspection service books a visit and moves the file
 * to the inspection desk in one statement of intent, and signs a report and
 * routes it in another. Two transactions would allow a signed, locked report
 * with the file still sitting at the desk, which is exactly the half-state the
 * engine's single transaction exists to rule out.
 *
 * Everything else is identical: the same resolution, the same authorisation,
 * the same guards and effects, the same history, audit and notifications. The
 * caller is responsible only for having checked row scope, which it must do
 * before it writes anything of its own.
 */
export async function performActionInTx(
  tx: Tx,
  user: AuthUser,
  applicationId: string,
  actionCode: string,
  input: ActionInput,
  meta: Meta,
  now: Date = new Date()
): Promise<ActionResult> {
  return executeForUser(tx, user, applicationId, actionCode, input, meta, now);
}

async function executeForUser(
  tx: Tx,
  user: AuthUser,
  applicationId: string,
  actionCode: string,
  input: ActionInput,
  meta: Meta,
  now: Date
): Promise<ActionResult> {
  const { application, instance, stage } = await loadRun(tx, applicationId);
  return execute(tx, {
    user,
    actor: user,
    application,
    instance,
    stage,
    actionCode,
    input,
    meta,
    now,
    system: false,
  });
}

/**
 * A SYSTEM transition raised by a service in response to something that
 * happened outside any desk — the way the payment settlement raises
 * CONFIRM_PAYMENT — recorded as done by the person it happened on behalf of.
 *
 * The applicant answering a show cause notice is the case it exists for. The
 * answer is a step in the workflow's branch and belongs on the file's history,
 * but the applicant owns no desk: making LTP an owner of every desk a file
 * might be at would put officers' tasks in the applicant's queue. So the
 * transition is SYSTEM-kind (never offered in any action bar, no role check),
 * and the CALLER is responsible for having authorised the person — the show
 * cause service checks it is the file's own applicant holding
 * SHOW_CAUSE_RESPOND. Guards still run exactly as for any other transition.
 *
 * Only a SYSTEM-kind action may be raised this way; `execute` refuses any
 * other, so this cannot be used to perform a desk's action without its role.
 */
export async function performSystemActionInTx(
  tx: Tx,
  params: {
    applicationId: string;
    actionCode: string;
    input: ActionInput;
    meta: Meta;
    onBehalfOf: { id: string; name: string; roleKey: string };
    now?: Date;
  }
): Promise<ActionResult> {
  const { application, instance, stage } = await loadRun(tx, params.applicationId);
  return execute(tx, {
    user: null,
    actor: { id: params.onBehalfOf.id, name: params.onBehalfOf.name, roleKeys: [params.onBehalfOf.roleKey] },
    application,
    instance,
    stage,
    actionCode: params.actionCode,
    input: params.input,
    meta: params.meta,
    now: params.now ?? new Date(),
    system: true,
    onBehalfOf: params.onBehalfOf,
  });
}

/** The run, its file and its current stage — read under the instance lock. */
async function loadRun(tx: Tx, applicationId: string) {
  // The lock. Taken before anything is read, so every read below sees a
  // state no other transition can be changing.
  const locked = await tx.workflowInstance.findFirst({
    where: { applicationId },
    select: { id: true },
  });

  if (!locked) {
    throw conflict(
      'This application has not reached the department yet, so there is no action to take on it.'
    );
  }

  const instance = await tx.workflowInstance.findUniqueOrThrow({
    where: { id: locked.id },
    select: {
      id: true,
      workflowId: true,
      workflowVersion: true,
      status: true,
      currentStageId: true,
      parkedStageId: true,
    },
  });

  const application = await tx.application.findFirstOrThrow({
    where: { id: applicationId, deletedAt: null },
    select: APPLICATION_SELECT,
  });

  // A CANCELLED run is over. A COMPLETED one is closed for ordinary work, but
  // its terminal stage may carry POST-DECISION transitions — show cause and
  // revocation out of CLOSED_APPROVED — and those are the only thing it will
  // resolve. Whether any exist is configuration; `execute` refuses with the
  // closed message when none matches.
  if (instance.status === 'CANCELLED') {
    throw conflict('This application is closed. No further action can be taken on it.');
  }

  if (!instance.currentStageId) {
    throw conflict('This application is not at any stage, so there is no action to take.');
  }

  const stage = await tx.workflowStage.findUniqueOrThrow({
    where: { id: instance.currentStageId },
    select: STAGE_SELECT,
  });

  return { application, instance, stage };
}

type ExecuteInput = {
  user: AuthUser | null;
  actor: Pick<AuthUser, 'id' | 'name'> & { roleKeys?: string[] };
  application: ApplicationRow;
  instance: {
    id: string;
    workflowId: string;
    status: string;
    currentStageId: string | null;
    parkedStageId: string | null;
  };
  stage: StageRow;
  actionCode: string;
  input: ActionInput;
  meta: Meta;
  now: Date;
  /** True for a transition the system raises — no role or capability check. */
  system: boolean;
  /**
   * For a system transition raised because of something a PERSON did (the
   * applicant answered a notice): who the record names. Absent, it is "System".
   */
  onBehalfOf?: { id: string; name: string; roleKey: string };
};

/**
 * Resolve → authorise → guard → effect → write. In that order, always.
 *
 * The ordering is the design. Nothing is written until every question has been
 * answered, so a refusal at any point leaves the database exactly as it was —
 * which is what makes it safe for the action bar to ask the same questions
 * speculatively.
 */
async function execute(tx: Tx, params: ExecuteInput): Promise<ActionResult> {
  const { user, actor, application, instance, stage, actionCode, input, meta, now } = params;

  // ── 1. Resolve the transition ───────────────────────────────────────────
  const transitions = await transitionsFrom(tx, instance.workflowId, stage.id, application.status);
  const transition = transitions.find((t) => t.action.code === actionCode);

  if (!transition) {
    if (instance.status === 'COMPLETED') {
      throw conflict('This application is closed. No further action can be taken on it.');
    }
    throw conflict(
      `"${actionCode}" is not something that can be done to this application at ${stageName(stage.code)}.`
    );
  }

  // ── 2. Authorise ────────────────────────────────────────────────────────
  if (params.onBehalfOf && transition.action.kind !== 'SYSTEM') {
    throw forbidden('Only a system action can be raised on somebody’s behalf.');
  }

  if (!params.system) {
    if (!user) throw forbidden('You are not permitted to do this.');

    if (transition.action.kind === 'SYSTEM') {
      throw forbidden('That action is raised by the system and cannot be performed by hand.');
    }

    if (!mayAttempt(user, transition)) {
      throw forbidden(
        `${transition.action.label} at this stage is for ${rolesFor(transition).join(' or ')}.`
      );
    }

  }

  // ── 3. Concurrency ──────────────────────────────────────────────────────
  const last = await tx.workflowHistory.findFirst({
    where: { instanceId: instance.id },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  const currentSequence = last?.sequence ?? 0;

  if (input.expectedSequence !== undefined && input.expectedSequence !== currentSequence) {
    throw staleWrite();
  }

  // ── 4. The open task ────────────────────────────────────────────────────
  const task = await tx.workflowTask.findFirst({
    where: { instanceId: instance.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    select: { id: true, assignedUserId: true, assignee: { select: { name: true } } },
  });

  if (
    !params.system &&
    user &&
    task?.assignedUserId &&
    task.assignedUserId !== user.id &&
    !can(user, CAPABILITIES.WORKFLOW_REASSIGN)
  ) {
    throw conflict(
      `This file is with ${task.assignee?.name ?? 'another officer'}. Ask them to release it, or have it reassigned.`
    );
  }

  // ── 5. Guards ───────────────────────────────────────────────────────────
  const remarks = (input.remarks ?? '').trim();
  const attachments = input.attachments ?? [];

  const guards = await evaluateGuards(asGuards(transition.guards), {
    tx,
    application,
    input: { remarks, attachments },
  });

  const failed = guards.find((g) => !g.passed);
  if (failed) {
    throw guardFailed(failed.message, [{ path: failed.name, message: failed.message }]);
  }

  if (transition.action.requiresRemarks && !remarks) {
    throw guardFailed('Remarks are required for this action.', [
      { path: 'remarks', message: 'Say why, in a sentence.' },
    ]);
  }

  if (transition.action.requiresAttachment && !attachments.length) {
    throw guardFailed('An attachment is required for this action.', [
      { path: 'attachments', message: 'Attach the supporting file.' },
    ]);
  }

  // ── 6. Effects ──────────────────────────────────────────────────────────
  const ctx: EffectContext = {
    tx,
    actor,
    now,
    meta,
    application: {
      id: application.id,
      applicationNumber: application.applicationNumber,
      applicationTypeId: application.applicationTypeId,
      status: application.status,
      zoneId: application.zoneId,
      ltpUserId: application.ltpUserId,
    },
    instance: {
      id: instance.id,
      currentStageId: instance.currentStageId,
      parkedStageId: instance.parkedStageId,
    },
    fromStage: { id: stage.id, code: stage.code, name: stage.name },
    input: {
      remarks,
      attachments,
      shortfall: input.shortfall,
      shortfallId: input.shortfallId,
      shortfallItems: input.shortfallItems,
      shortfallDecisions: input.shortfallDecisions,
      proceeding: input.proceeding,
    },
    sequence: currentSequence + 1,
    actingRoleKey: params.system
      ? (params.onBehalfOf?.roleKey ?? 'SYSTEM')
      : (rolesFor(transition).find((r) => (actor.roleKeys ?? []).includes(r)) ?? actor.roleKeys?.[0] ?? ''),
    toStageId: transition.toStageId,
    toStatus: transition.toStatus,
    parkedStageId: instance.parkedStageId,
    slaBehaviour: null,
    applied: [],
    raisedShortfallIds: [],
    closeAs: null,
  };

  await applyEffects(ctx, asEffects(transition.effects));

  if (!ctx.toStageId) {
    // A transition with no destination and no effect that supplies one is a
    // configuration error. Caught before publishing by the validator; refused
    // here as well, because a file with nowhere to go must not be written.
    throw conflict(
      `${transition.action.label} has no destination configured. An administrator must correct the workflow.`
    );
  }

  const toStage = await tx.workflowStage.findUniqueOrThrow({
    where: { id: ctx.toStageId },
    select: STAGE_SELECT,
  });

  // ── 7. Close the current task ───────────────────────────────────────────
  const slaBehaviour = (ctx.slaBehaviour ?? transition.slaBehavior ?? 'NONE').toUpperCase();

  // An action that does not MOVE the file does not change whose desk it is on.
  // Accepting a shortfall response leaves the officer holding the same file
  // they were already holding, and completing their task to immediately open
  // an identical one would reset the clock, empty and refill their inbox, and
  // tell the queue the file had just arrived. So a same-stage transition keeps
  // the task — which is also what keeps `one_open_task` satisfiable.
  const sameStage = toStage.id === stage.id;

  if (task && !sameStage) {
    await tx.workflowTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        completedById: actor.id,
        actionTaken: transition.action.code,
      },
    });

    // PAUSE leaves the clock stopped-but-unfinished, so the time this desk had
    // left is still readable when the file comes back. Everything else ends it.
    if (slaBehaviour === 'PAUSE') await pauseSla(tx, task.id, now);
    else await stopSla(tx, task.id, now);
  }

  // ── 8. Open the next one ────────────────────────────────────────────────
  let nextTaskId: string | null = task && sameStage ? task.id : null;
  let due: { dueAt: Date; status: string } | null = null;

  if (task && sameStage) {
    // The clock control still applies to the task being kept. No seeded
    // same-stage transition asks for PAUSE or STOP today — they are all NONE —
    // but a configuration that did and was silently ignored would be a clock
    // that reads as running while nobody is working the file.
    if (slaBehaviour === 'PAUSE') await pauseSla(tx, task.id, now);
    else if (slaBehaviour === 'STOP') await stopSla(tx, task.id, now);

    const existing = await tx.slaInstance.findUnique({
      where: { taskId: task.id },
      select: { dueAt: true, status: true },
    });
    if (existing) due = { dueAt: existing.dueAt, status: existing.status };
  }

  if (!toStage.isTerminal && !ctx.closeAs && !sameStage) {
    const assignment = await resolveAssignment(tx, toStage, application);

    const created = await tx.workflowTask.create({
      data: {
        instanceId: instance.id,
        stageId: toStage.id,
        assignedRoleKey: assignment.roleKey,
        assignedUserId: assignment.userId,
        zoneId: assignment.zoneId,
        priority: assignment.priority,
        status: assignment.userId ? 'IN_PROGRESS' : 'PENDING',
        receivedAt: now,
        claimedAt: assignment.userId ? now : null,
      },
      select: { id: true },
    });

    nextTaskId = created.id;

    if (slaBehaviour === 'START' || slaBehaviour === 'RESUME') {
      const carryOverMs =
        slaBehaviour === 'RESUME'
          ? ((await carryOverPausedSla(tx, {
              instanceId: instance.id,
              stageId: toStage.id,
              now,
            })) ?? undefined)
          : undefined;

      const snapshot = await startSla(tx, {
        taskId: created.id,
        stage: toStage,
        applicationTypeId: application.applicationTypeId,
        zoneId: application.zoneId,
        now,
        carryOverMs,
      });

      if (snapshot) due = snapshot;
    }

    const arrival = {
      applicationNumber: application.applicationNumber,
      taskId: created.id,
      stageCode: toStage.code,
      stageName: toStage.name,
      assignedRoleKey: assignment.roleKey,
      assignedUserId: assignment.userId,
      priority: assignment.priority,
      dueAt: due?.dueAt ?? null,
      dueDate: due?.dueAt ?? null,
    };

    await emit(tx, {
      eventCode: EVENTS.TASK_ASSIGNED,
      applicationId: application.id,
      payload: arrival,
    });

    // ── What ARRIVING at this desk means ─────────────────────────────────
    //
    // TASK_ASSIGNED says a row entered a queue. These say what the person is
    // expected to DO about it, and they are separate events because they have
    // separate audiences and separate opt-outs: an officer who mutes the queue
    // digest must still hear that a file is sitting with them awaiting a
    // decision.
    //
    // Which one is decided by the stage's own `type` and by whether an APPROVE
    // transition actually leaves it — read from configuration, never from a
    // list of stage codes. A workflow that gains an approving desk next year
    // announces it without anybody editing this file.
    if (assignment.userId) {
      await emit(tx, {
        eventCode: EVENTS.APPLICATION_ASSIGNED,
        applicationId: application.id,
        payload: arrival,
      });
    }

    if (toStage.type === 'REVIEW' || toStage.type === 'APPROVAL') {
      const canApproveHere = await tx.workflowTransition.count({
        where: {
          fromStageId: toStage.id,
          isActive: true,
          action: { code: ACTIONS.APPROVE },
        },
      });

      await emit(tx, {
        eventCode: canApproveHere > 0 ? EVENTS.APPROVAL_REQUIRED : EVENTS.REVIEW_REQUIRED,
        applicationId: application.id,
        payload: arrival,
      });
    }
  }

  // ── 9. Move the instance and the application ────────────────────────────
  //
  // A post-decision transition — one out of a terminal stage — leaves a closed
  // run closed. Staying at CLOSED_APPROVED (a show cause, a revocation
  // proposal) must not reopen it, and closing it again at CLOSED_REVOKED keeps
  // the completion time the original decision wrote: that time is part of the
  // approval record, and a later proceeding does not rewrite it.
  const wasClosed = instance.status === 'COMPLETED';
  const stayClosed = wasClosed && toStage.isTerminal && !ctx.closeAs;

  await tx.workflowInstance.update({
    where: { id: instance.id },
    data: {
      currentStageId: toStage.id,
      parkedStageId: ctx.parkedStageId,
      parkedAt: ctx.parkedStageId ? (instance.parkedStageId ? undefined : now) : null,
      status: ctx.closeAs ?? (stayClosed ? 'COMPLETED' : ctx.parkedStageId ? 'PARKED' : 'ACTIVE'),
      completedAt: ctx.closeAs ? (wasClosed ? undefined : now) : stayClosed ? undefined : null,
    },
  });

  if (ctx.closeAs) {
    // Nothing may be left open on a closed file — a task in somebody's inbox
    // for an approved application is how an officer wastes an afternoon.
    await tx.workflowTask.updateMany({
      where: { instanceId: instance.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED', completedAt: now },
    });
  }

  // Stamped only when the status actually CHANGES. A show cause issued on an
  // approved file lands on APPROVED again, and must not move `approvedAt`.
  const statusChanged = ctx.toStatus !== application.status;
  const terminalDates = !statusChanged
    ? {}
    : ctx.toStatus === 'APPROVED'
      ? { approvedAt: now, closedAt: now }
      : ctx.toStatus === 'REJECTED'
        ? { rejectedAt: now, closedAt: now }
        : {};

  await tx.application.update({
    where: { id: application.id },
    data: {
      status: ctx.toStatus as ApplicationStatus,
      currentStageId: toStage.id,
      currentStageCode: toStage.code,
      slaDueAt: due?.dueAt ?? (toStage.isTerminal ? null : undefined),
      slaStatus: due ? (due.status as never) : toStage.isTerminal ? null : undefined,
      ...terminalDates,
      updatedAt: now,
    },
  });

  // ── 10. The record ──────────────────────────────────────────────────────
  const sequence = currentSequence + 1;

  const history = await tx.workflowHistory.create({
    data: {
      instanceId: instance.id,
      sequence,
      fromStageCode: stage.code,
      toStageCode: toStage.code,
      fromStatus: application.status,
      toStatus: ctx.toStatus,
      actionCode: transition.action.code,
      actionLabel: transition.action.label,
      actorId: params.system ? (params.onBehalfOf?.id ?? null) : actor.id,
      actorName: params.system ? (params.onBehalfOf?.name ?? 'System') : actor.name,
      actorRoleKey: params.system ? (params.onBehalfOf?.roleKey ?? 'SYSTEM') : (actor.roleKeys?.[0] ?? ''),
      remarks,
      attachments: attachments as never,
      effectsApplied: ctx.applied as never,
      occurredAt: now,
    },
    select: { id: true, sequence: true },
  });

  // Shortfalls point back at the decision that raised them. Written after the
  // history row because it does not exist until now, and a shortfall with no
  // decision behind it is exactly what this link exists to make impossible.
  if (ctx.raisedShortfallIds.length) {
    await tx.shortfall.updateMany({
      where: { id: { in: ctx.raisedShortfallIds } },
      data: { historyId: history.id },
    });
  }

  const shortfalls = ctx.raisedShortfallIds.length
    ? await tx.shortfall.findMany({
        where: { id: { in: ctx.raisedShortfallIds } },
        select: { shortfallNumber: true },
      })
    : [];

  await recordEvent(tx, {
    applicationId: application.id,
    type: timelineType(transition.action.kind, ctx),
    title: timelineTitle(transition, toStage, ctx, sameStage),
    description: remarks,
    actor: params.system ? (params.onBehalfOf ? actor : undefined) : actor,
    metadata: {
      actionCode: transition.action.code,
      fromStageCode: stage.code,
      toStageCode: toStage.code,
      fromStatus: application.status,
      toStatus: ctx.toStatus,
      sequence,
      effects: ctx.applied,
      shortfalls: shortfalls.map((s) => s.shortfallNumber),
    },
    occurredAt: now,
  });

  await audit(tx, {
    actor: params.system
      ? params.onBehalfOf
        ? actor
        : { id: actor.id, name: 'System', roleKeys: ['SYSTEM'] }
      : actor,
    action: `WORKFLOW_${transition.action.code}`,
    entityType: 'WorkflowInstance',
    entityId: instance.id,
    applicationId: application.id,
    before: { stageCode: stage.code, status: application.status, parkedStageId: instance.parkedStageId },
    after: {
      stageCode: toStage.code,
      status: ctx.toStatus,
      parkedStageId: ctx.parkedStageId,
      transitionId: transition.id,
      sequence,
      effects: ctx.applied,
      taskId: nextTaskId,
      dueAt: due?.dueAt ?? null,
    },
    remarks,
    ...meta,
  });

  if (transition.notifyEvent) {
    await emit(tx, {
      eventCode: transition.notifyEvent,
      applicationId: application.id,
      payload: {
        applicationNumber: application.applicationNumber,
        actionCode: transition.action.code,
        actionLabel: transition.action.label,
        fromStageCode: stage.code,
        toStageCode: toStage.code,
        toStatus: ctx.toStatus,
        actorName: params.system ? (params.onBehalfOf?.name ?? 'System') : actor.name,
        remarks,
        ltpUserId: application.ltpUserId,
        shortfalls: shortfalls.map((s) => s.shortfallNumber),
      },
    });
  }

  return {
    applicationId: application.id,
    applicationNumber: application.applicationNumber,
    actionCode: transition.action.code,
    fromStageCode: stage.code,
    toStageCode: toStage.code,
    fromStatus: application.status,
    toStatus: ctx.toStatus,
    sequence,
    message: outcomeMessage(transition, toStage, ctx, sameStage),
    taskId: nextTaskId,
    shortfallNumbers: shortfalls.map((s) => s.shortfallNumber),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Starting the run
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates the instance and performs the system transition out of the entry
 * stage.
 *
 * Called from the payment settlement, INSIDE its transaction — which is what
 * makes "only a confirmed payment can carry a file to the department" true by
 * construction rather than by convention. The money and the movement commit
 * together, and there is no other caller.
 *
 * Returns the resulting application status so the settlement can report what
 * it actually wrote.
 */
export async function startWorkflow(
  tx: Tx,
  input: {
    applicationId: string;
    actionCode: string;
    actor: Pick<AuthUser, 'id' | 'name'>;
    meta: Meta;
    now?: Date;
  }
): Promise<{ status: string; stageCode: string; sequence: number } | null> {
  const now = input.now ?? new Date();

  const application = await tx.application.findFirstOrThrow({
    where: { id: input.applicationId, deletedAt: null },
    select: APPLICATION_SELECT,
  });

  const existing = await tx.workflowInstance.findUnique({
    where: { applicationId: application.id },
    select: { id: true, status: true },
  });

  // Already running. Re-delivering the same webhook must not start a second
  // run, and the `one_active_instance` index would refuse it anyway.
  if (existing) return null;

  const workflowId = application.applicationType.workflowId;

  const workflow = await tx.workflow.findUniqueOrThrow({
    where: { id: workflowId },
    select: { id: true, version: true, isPublished: true, code: true },
  });

  if (!workflow.isPublished) {
    throw conflict(
      `The workflow for ${application.applicationType.name} has not been published. ` +
        'The department must publish it before applications can be routed.'
    );
  }

  const entry = await tx.workflowStage.findFirst({
    where: { workflowId, isEntry: true, isActive: true },
    select: STAGE_SELECT,
  });

  if (!entry) {
    throw conflict('The workflow has no entry stage configured, so this application cannot be routed.');
  }

  const instance = await tx.workflowInstance.create({
    data: {
      applicationId: application.id,
      workflowId,
      workflowVersion: workflow.version,
      currentStageId: entry.id,
      status: 'ACTIVE',
      startedAt: now,
    },
    select: { id: true, workflowId: true, status: true, currentStageId: true, parkedStageId: true },
  });

  const result = await execute(tx, {
    user: null,
    // The FK is not written for a system action (`actorId` is null on the
    // history row); the id is carried only so effects that stamp "who did
    // this" on a shortfall or a demand have something truthful to record.
    actor: { id: application.ltpUserId, name: 'System', roleKeys: ['SYSTEM'] },
    application,
    instance,
    stage: entry,
    actionCode: input.actionCode,
    input: { remarks: '' },
    meta: input.meta,
    now,
    system: true,
  });

  return { status: result.toStatus, stageCode: result.toStageCode, sequence: result.sequence };
}

// ═══════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════

export type HistoryEntry = {
  id: string;
  sequence: number;
  fromStageCode: string;
  toStageCode: string;
  fromStatus: string;
  toStatus: string;
  actionCode: string;
  actionLabel: string;
  actorName: string;
  actorRoleKey: string;
  remarks: string;
  effectsApplied: unknown;
  occurredAt: Date;
};

/** Every movement of one file, oldest first. Append-only at the database. */
export async function getHistory(user: AuthUser, applicationId: string): Promise<HistoryEntry[]> {
  await assertApplicationAccess(user, applicationId);

  const instance = await prisma.workflowInstance.findUnique({
    where: { applicationId },
    select: { id: true },
  });

  if (!instance) return [];

  return prisma.workflowHistory.findMany({
    where: { instanceId: instance.id },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      fromStageCode: true,
      toStageCode: true,
      fromStatus: true,
      toStatus: true,
      actionCode: true,
      actionLabel: true,
      actorName: true,
      actorRoleKey: true,
      remarks: true,
      effectsApplied: true,
      occurredAt: true,
    },
  });
}

/** Open shortfalls on a file, for the review screen and the approval warning. */
export async function getShortfalls(user: AuthUser, applicationId: string) {
  await assertApplicationAccess(user, applicationId);

  return prisma.shortfall.findMany({
    where: { applicationId },
    orderBy: { raisedAt: 'desc' },
    select: {
      id: true,
      shortfallNumber: true,
      kind: true,
      mode: true,
      status: true,
      title: true,
      description: true,
      raisedAtStageCode: true,
      raisedByRoleKey: true,
      raisedAt: true,
      dueDate: true,
      closedAt: true,
      closureRemarks: true,
      items: {
        orderBy: { displayOrder: 'asc' },
        select: { id: true, description: true, amount: true, isResolved: true },
      },
      resolutions: {
        orderBy: { attemptNo: 'asc' },
        select: {
          id: true,
          attemptNo: true,
          response: true,
          respondedAt: true,
          accepted: true,
          reviewedAt: true,
          reviewRemarks: true,
        },
      },
    },
  });
}

/** Count of the shortfalls that block approval. Re-counted, never cached. */
export async function openShortfallCount(applicationId: string): Promise<number> {
  return prisma.shortfall.count({
    where: { applicationId, status: { notIn: [...CLOSED_SHORTFALL_STATUSES] } },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Wording
// ═══════════════════════════════════════════════════════════════════════════

function timelineType(kind: string, ctx: EffectContext): string {
  const proceeding = ctx.applied.find((e) => e.type === 'SHOW_CAUSE' || e.type === 'REVOCATION');
  if (proceeding) {
    if (proceeding.type === 'SHOW_CAUSE') {
      return (
        { ISSUE: 'SHOW_CAUSE_ISSUED', RESPOND: 'SHOW_CAUSE_RESPONDED', REVIEW: 'SHOW_CAUSE_REVIEW_STARTED' }[
          String(proceeding.step)
        ] ?? 'SHOW_CAUSE_DECIDED'
      );
    }
    if (proceeding.step === 'PROPOSE') return 'REVOCATION_INITIATED';
    if (proceeding.step === 'REVIEW') return 'REVOCATION_TAKEN_UP';
    return proceeding.outcome === 'REVOKED' ? 'PROCEEDING_REVOKED' : 'REVOCATION_REJECTED';
  }
  if (ctx.applied.some((e) => e.type === 'RAISE_SHORTFALL')) return EVENT_TYPES.SHORTFALL_RAISED;
  if (ctx.applied.some((e) => e.type === 'RESOLVE_SHORTFALL')) return EVENT_TYPES.SHORTFALL_RESOLVED;
  if (ctx.applied.some((e) => e.type === 'RECORD_RESOLUTION')) return EVENT_TYPES.SHORTFALL_RESPONDED;

  switch (kind) {
    case 'APPROVE':
      return EVENT_TYPES.APPLICATION_APPROVED;
    case 'REJECT':
      return EVENT_TYPES.APPLICATION_REJECTED;
    case 'RETURN':
      return EVENT_TYPES.STAGE_RETURNED;
    default:
      return EVENT_TYPES.STAGE_FORWARDED;
  }
}

/**
 * The timeline line an APPLICANT reads.
 *
 * Written in their language, and about their file — "Sent to the Zonal Joint
 * Director", not "FORWARD: ZAD_ZDD_REVIEW → ZJD_REVIEW". The audit row keeps
 * the codes; this is the story.
 */
function timelineTitle(
  transition: TransitionRow,
  toStage: StageRow,
  ctx: EffectContext,
  sameStage: boolean
): string {
  const raised = ctx.applied.find((e) => e.type === 'RAISE_SHORTFALL');

  const proceeding = proceedingSentence(ctx);
  if (proceeding) return proceeding.title;

  if (raised) {
    const mode = String(raised.mode);
    const kind = String(raised.kind).toLowerCase();
    return mode === 'BLOCKING'
      ? `A ${kind} shortfall was raised — the application is with you`
      : `A ${kind} shortfall was recorded and the application moved on`;
  }

  if (ctx.applied.some((e) => e.type === 'RESOLVE_SHORTFALL')) {
    return 'The shortfall response was accepted';
  }

  const inspection = ctx.applied.find((e) => e.type === 'LINK_SITE_INSPECTION');
  if (inspection?.step === 'SCHEDULE') {
    const on = new Date(String(inspection.scheduledFor)).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `A site inspection was scheduled for ${on}`;
  }
  if (inspection?.step === 'SUBMIT') {
    return `The site inspection was completed — sent to ${toStage.name}`;
  }
  if (ctx.applied.some((e) => e.type === 'REJECT_RESOLUTION')) {
    return 'The shortfall response was not accepted';
  }
  if (ctx.applied.some((e) => e.type === 'RECORD_RESOLUTION')) {
    return 'A response to the shortfall was submitted';
  }

  switch (transition.action.kind) {
    case 'APPROVE':
      return 'Application approved';
    case 'REJECT':
      return 'Application rejected';
    case 'RETURN':
      return `Returned to ${toStage.name}`;
    default:
      return sameStage ? `Noted by ${toStage.name}` : `Sent to ${toStage.name}`;
  }
}

/**
 * The sentence the acting officer sees.
 *
 * Describes what actually happened rather than what the action is called. An
 * action that leaves the file where it is must not report that it was sent
 * somewhere — "Sent to Town Planning Assistant" after a TPA accepted a
 * shortfall response is a small lie, and small lies about where a file is are
 * how somebody ends up ringing the office to ask where their file is.
 */
function outcomeMessage(
  transition: TransitionRow,
  toStage: StageRow,
  ctx: EffectContext,
  sameStage: boolean
): string {
  const raised = ctx.applied.find((e) => e.type === 'RAISE_SHORTFALL');
  const demand = ctx.applied.find((e) => e.type === 'GENERATE_FEE_DEMAND');

  const proceeding = proceedingSentence(ctx);
  if (proceeding) return proceeding.message;

  if (ctx.applied.some((e) => e.type === 'RESOLVE_SHORTFALL')) {
    const settled = ctx.applied.find((e) => e.type === 'RESOLVE_SHORTFALL');
    const numbers = (settled?.shortfalls as string[] | undefined)?.join(', ') ?? '';
    return sameStage
      ? `${numbers} settled. The application stays with you.`
      : `${numbers} settled.`;
  }

  if (ctx.applied.some((e) => e.type === 'REJECT_RESOLUTION')) {
    return 'The response was not accepted. The application has gone back to the applicant for another attempt.';
  }

  if (ctx.applied.some((e) => e.type === 'RECORD_RESOLUTION')) {
    return `Your response has been sent to ${toStage.name}.`;
  }

  const inspection = ctx.applied.find((e) => e.type === 'LINK_SITE_INSPECTION');
  if (inspection?.step === 'SCHEDULE') {
    return `${String(inspection.inspectionNumber)} booked with ${String(inspection.inspectorName)}. The file is at ${toStage.name}.`;
  }
  if (inspection?.step === 'SUBMIT' && !raised) {
    return `${String(inspection.inspectionNumber)} signed and submitted. Sent to ${toStage.name}.`;
  }

  if (raised) {
    const number = String(raised.shortfallNumber ?? '');
    const money = demand ? ` A demand for ${demand.total} was raised as ${demand.demandNumber}.` : '';
    return String(raised.mode) === 'BLOCKING'
      ? `${number} raised. The application has gone back to the applicant.${money}`
      : `${number} recorded. The application has moved to ${toStage.name} and the shortfall travels with it.${money}`;
  }

  switch (transition.action.kind) {
    case 'APPROVE':
      return 'Approved. The approval order is being prepared.';
    case 'REJECT':
      return 'Rejected. The applicant has been notified.';
    case 'RETURN':
      return `Returned to ${toStage.name}.`;
    case 'RESUBMIT':
      return `Your response has been sent to ${toStage.name}.`;
    default:
      return sameStage ? 'Recorded. The application stays with you.' : `Sent to ${toStage.name}.`;
  }
}

/**
 * The timeline line and the toast for a show cause or revocation transition.
 * The effect has already recorded the numbers it allocated in `applied`.
 */
function proceedingSentence(ctx: EffectContext): { title: string; message: string } | null {
  const e = ctx.applied.find((x) => x.type === 'SHOW_CAUSE' || x.type === 'REVOCATION');
  if (!e) return null;
  if (e.type === 'SHOW_CAUSE' && e.step === 'ISSUE') {
    return {
      title: `Show cause notice ${String(e.noticeNumber)} issued`,
      message: `${String(e.noticeNumber)} issued and sent to Outward as ${String(e.outwardNumber)}. The file stays where it is.`,
    };
  }
  if (e.type === 'SHOW_CAUSE' && e.step === 'RESPOND') {
    return {
      title: `Response to show cause ${String(e.noticeNumber)} submitted`,
      message: `Your response to ${String(e.noticeNumber)} has been submitted for review.`,
    };
  }
  if (e.type === 'SHOW_CAUSE' && e.step === 'REVIEW') {
    return {
      title: `Show cause ${String(e.noticeNumber)} response taken up for review`,
      message: `${String(e.noticeNumber)} is under your review.`,
    };
  }
  if (e.type === 'SHOW_CAUSE') {
    const label = SHOW_CAUSE_DECISION_LABEL[e.decision as ShowCauseDecision] ?? String(e.decision);
    return {
      title: `Show cause ${String(e.noticeNumber)} decided — ${label}`,
      message: `${String(e.noticeNumber)}: ${label}.`,
    };
  }
  if (e.step === 'PROPOSE') {
    return {
      title: `Revocation proceeding ${String(e.revocationNumber)} initiated`,
      message: `${String(e.revocationNumber)} proposed. The permission stands until the revoking authority decides.`,
    };
  }
  if (e.step === 'REVIEW') {
    return {
      title: `Revocation proceeding ${String(e.revocationNumber)} taken up for review`,
      message: `${String(e.revocationNumber)} is now under your review.`,
    };
  }
  if (e.outcome === 'REVOKED') {
    return {
      title: `Permission revoked — order ${String(e.revocationOrderNumber)}`,
      message: `Revoked. Order ${String(e.revocationOrderNumber)} sent to Outward as ${String(e.outwardNumber)}. The approval history is unchanged.`,
    };
  }
  return {
    title: `Revocation proposal ${String(e.revocationNumber)} rejected — the permission stands`,
    message: `${String(e.revocationNumber)} rejected. The permission stands.`,
  };
}
