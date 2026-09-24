import 'server-only';
import { prisma, type Db, type Tx } from '@/server/db/prisma';
import { emit, EVENTS } from '@/server/events/outbox';

/**
 * The SLA clock.
 *
 * ── OVERDUE is a notification, not a verdict ─────────────────────────────
 *
 * Passing a due date has no legal effect in this system: nothing is deemed
 * approved, nothing escalates automatically, no officer's action is refused
 * (docs/07-subsystems.md R.1.1). The clock exists so that a supervisor can see
 * which files are waiting and so the officer holding one gets told. Every
 * function here is therefore side-effect-free with respect to the workflow —
 * `sweep()` writes statuses and outbox rows, and touches nothing else.
 *
 * ── Why the clock pauses ─────────────────────────────────────────────────
 *
 * A blocking shortfall parks the file with the applicant. Counting that time
 * against the officer would make the SLA a measure of how slow applicants are,
 * which is exactly the number a department does not need. `pausedMs`
 * accumulates the parked time and the due date is pushed out by it on resume,
 * so the figure means "working days this desk has held the file".
 */

const DAY_MS = 86_400_000;

// ── Working-day arithmetic ───────────────────────────────────────────────

/** Local-midnight key, so a date compares equal regardless of the time on it. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/**
 * Adds `days` to `start`, skipping weekends and holidays when the calendar
 * says to.
 *
 * The end of the last working day, not the start: a two-day SLA starting on a
 * Monday morning is due at the END of Tuesday, and a due date of Tuesday
 * 00:00 would report a file overdue while the officer still had a full day.
 */
export function addSlaDays(
  start: Date,
  days: number,
  calendar: 'CALENDAR_DAYS' | 'WORKING_DAYS',
  holidays: Set<string> = new Set()
): Date {
  const due = new Date(start);

  if (calendar === 'CALENDAR_DAYS') {
    due.setDate(due.getDate() + days);
  } else {
    let remaining = Math.max(0, days);
    while (remaining > 0) {
      due.setDate(due.getDate() + 1);
      if (!isWeekend(due) && !holidays.has(dayKey(due))) remaining -= 1;
    }
  }

  due.setHours(23, 59, 59, 999);
  return due;
}

/**
 * Holidays that could fall inside a window starting now.
 *
 * Zone-specific rows apply to that zone; rows with no zone apply everywhere.
 * The window is generous (the SLA in days, doubled, plus a fortnight) because
 * a holiday inside the window pushes the due date further out, which can pull
 * another holiday into range.
 */
async function holidaysFor(db: Db, from: Date, days: number, zoneId: string | null): Promise<Set<string>> {
  const until = new Date(from.getTime() + (days * 2 + 14) * DAY_MS);

  const rows = await db.holiday.findMany({
    where: {
      date: { gte: new Date(from.getTime() - DAY_MS), lte: until },
      OR: [{ zoneId: null }, ...(zoneId ? [{ zoneId }] : [])],
    },
    select: { date: true },
  });

  return new Set(rows.map((r) => dayKey(r.date)));
}

// ── The rule that applies ────────────────────────────────────────────────

export type ResolvedSlaRule = {
  ruleId: string | null;
  days: number;
  calendar: 'CALENDAR_DAYS' | 'WORKING_DAYS';
  warnAtPercent: number;
  pauseOnShortfall: boolean;
};

/**
 * The SLA for one stage, most specific first.
 *
 * A rule naming this application type beats the stage's general rule. With no
 * rule at all the stage's own `slaDays` applies, and a stage with no days
 * configured has no clock — which is correct for the LTP-side stages, where
 * the department is not the one being measured.
 */
export async function resolveSlaRule(
  db: Db,
  stage: { id: string; slaDays: number },
  applicationTypeId: string
): Promise<ResolvedSlaRule | null> {
  const rules = await db.slaRule.findMany({
    where: {
      workflowStageId: stage.id,
      isActive: true,
      OR: [{ applicationTypeId }, { applicationTypeId: null }],
    },
    orderBy: { applicationTypeId: { sort: 'asc', nulls: 'last' } },
    take: 1,
  });

  const rule = rules[0];
  if (rule) {
    return {
      ruleId: rule.id,
      days: rule.days,
      calendar: rule.calendar as 'CALENDAR_DAYS' | 'WORKING_DAYS',
      warnAtPercent: rule.warnAtPercent,
      pauseOnShortfall: rule.pauseOnShortfall,
    };
  }

  if (stage.slaDays > 0) {
    return {
      ruleId: null,
      days: stage.slaDays,
      calendar: 'WORKING_DAYS',
      warnAtPercent: 70,
      pauseOnShortfall: true,
    };
  }

  return null;
}

// ── Clock control ────────────────────────────────────────────────────────

export type SlaSnapshot = { dueAt: Date; status: 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'PAUSED' | 'COMPLETED' };

/**
 * Starts the clock on a freshly created task.
 *
 * Returns null when the stage has no SLA — the caller then leaves
 * `applications.slaDueAt` null rather than inventing a date, so a screen never
 * shows a deadline that nothing is measuring.
 */
export async function startSla(
  tx: Tx,
  input: {
    taskId: string;
    stage: { id: string; slaDays: number };
    applicationTypeId: string;
    zoneId: string | null;
    now: Date;
    /**
     * Time this desk had left when the file was parked. Present only on the
     * task that RESUMES a stage, and it is what makes "pause" mean something:
     * an officer who had two days left when the shortfall was raised has two
     * days left when the answer comes back, however long the applicant took.
     */
    carryOverMs?: number;
  }
): Promise<SlaSnapshot | null> {
  const rule = await resolveSlaRule(tx, input.stage, input.applicationTypeId);
  if (!rule) return null;

  const dueAt =
    input.carryOverMs !== undefined && input.carryOverMs > 0
      ? new Date(input.now.getTime() + input.carryOverMs)
      : addSlaDays(input.now, rule.days, rule.calendar, await holidaysFor(tx, input.now, rule.days, input.zoneId));

  const instance = await tx.slaInstance.create({
    data: {
      taskId: input.taskId,
      ruleId: rule.ruleId,
      startedAt: input.now,
      dueAt,
      status: 'ON_TRACK',
    },
  });

  return { dueAt: instance.dueAt, status: deriveStatus(instance, rule.warnAtPercent, input.now) };
}

/** Stops the clock when the task completes. Idempotent. */
export async function stopSla(tx: Tx, taskId: string, now: Date) {
  await tx.slaInstance.updateMany({
    where: { taskId, completedAt: null },
    data: { completedAt: now, status: 'COMPLETED', pausedAt: null },
  });
}

/** Parks the clock while the file is with the applicant. */
export async function pauseSla(tx: Tx, taskId: string, now: Date) {
  await tx.slaInstance.updateMany({
    where: { taskId, completedAt: null, pausedAt: null },
    data: { pausedAt: now, status: 'PAUSED' },
  });
}

/**
 * How much of a paused clock is left, and closes it out.
 *
 * A parked file leaves its officer's task COMPLETED — the file is genuinely
 * not at that desk while the applicant holds it, and the `one_open_task` index
 * means it cannot be at two desks at once. So "resume" cannot mean reopening
 * the old task; it means starting the new one with the time that was left.
 *
 * Returns null when there was no clock to carry, which is the ordinary case
 * for stages with no SLA configured.
 */
export async function carryOverPausedSla(
  tx: Tx,
  input: { instanceId: string; stageId: string; now: Date }
): Promise<number | null> {
  const paused = await tx.slaInstance.findFirst({
    where: {
      completedAt: null,
      pausedAt: { not: null },
      task: { instanceId: input.instanceId, stageId: input.stageId },
    },
    orderBy: { pausedAt: 'desc' },
    select: { id: true, dueAt: true, pausedAt: true, pausedMs: true },
  });

  if (!paused || !paused.pausedAt) return null;

  const remaining = paused.dueAt.getTime() - paused.pausedAt.getTime();
  const parkedMs = Math.max(0, input.now.getTime() - paused.pausedAt.getTime());

  await tx.slaInstance.update({
    where: { id: paused.id },
    data: {
      completedAt: input.now,
      status: 'COMPLETED',
      pausedAt: null,
      pausedMs: paused.pausedMs + parkedMs,
    },
  });

  // A clock that had already run out carries nothing forward rather than a
  // negative window — the resumed task is due immediately, which is true.
  return Math.max(0, remaining);
}

/**
 * Where a clock stands right now.
 *
 * DUE_SOON begins at `warnAtPercent` of the elapsed window, so a 5-day SLA at
 * 70% warns on day 4 rather than at some fixed number of hours — a warning
 * threshold that does not scale with the window is either noise on the long
 * stages or useless on the short ones.
 */
export function deriveStatus(
  instance: { startedAt: Date; dueAt: Date; pausedAt: Date | null; completedAt: Date | null },
  warnAtPercent: number,
  now: Date
): SlaSnapshot['status'] {
  if (instance.completedAt) return 'COMPLETED';
  if (instance.pausedAt) return 'PAUSED';
  if (now.getTime() > instance.dueAt.getTime()) return 'OVERDUE';

  const window = instance.dueAt.getTime() - instance.startedAt.getTime();
  if (window <= 0) return 'ON_TRACK';

  const elapsed = (now.getTime() - instance.startedAt.getTime()) / window;
  return elapsed >= warnAtPercent / 100 ? 'DUE_SOON' : 'ON_TRACK';
}

// ── The sweep ────────────────────────────────────────────────────────────

export type SlaSweepReport = { examined: number; dueSoon: number; overdue: number; notified: number };

/**
 * Re-derives every live clock and notifies once per transition into a worse
 * state.
 *
 * `notifiedAt` is what stops a nightly job from sending the same "overdue"
 * message every night for a fortnight. A file that stays overdue is visible on
 * the queue and on the report; it does not need to be announced again.
 */
export async function sweepSla(now: Date = new Date()): Promise<SlaSweepReport> {
  const live = await prisma.slaInstance.findMany({
    where: { completedAt: null, pausedAt: null },
    include: {
      task: {
        select: {
          id: true,
          assignedRoleKey: true,
          assignedUserId: true,
          stage: { select: { code: true, name: true } },
          instance: {
            select: {
              applicationId: true,
              application: { select: { applicationNumber: true, ltpUserId: true } },
            },
          },
        },
      },
    },
  });

  const report: SlaSweepReport = { examined: live.length, dueSoon: 0, overdue: 0, notified: 0 };

  for (const instance of live) {
    const warnAt = instance.ruleId
      ? ((await prisma.slaRule.findUnique({ where: { id: instance.ruleId }, select: { warnAtPercent: true } }))
          ?.warnAtPercent ?? 70)
      : 70;

    const status = deriveStatus(instance, warnAt, now);
    if (status === 'DUE_SOON') report.dueSoon += 1;
    if (status === 'OVERDUE') report.overdue += 1;

    const changed = status !== instance.status;
    const overdueDays =
      status === 'OVERDUE' ? Math.max(1, Math.ceil((now.getTime() - instance.dueAt.getTime()) / DAY_MS)) : 0;

    if (!changed && instance.overdueDays === overdueDays) continue;

    await prisma.$transaction(async (tx) => {
      await tx.slaInstance.update({
        where: { id: instance.id },
        data: {
          status,
          overdueDays,
          ...(status === 'OVERDUE' && !instance.overdueAt ? { overdueAt: now } : {}),
          ...(changed && (status === 'DUE_SOON' || status === 'OVERDUE') ? { notifiedAt: now } : {}),
        },
      });

      // The application carries the denormalised copy the register renders.
      await tx.application.update({
        where: { id: instance.task.instance.applicationId },
        data: { slaStatus: status, slaDueAt: instance.dueAt },
      });

      if (changed && (status === 'DUE_SOON' || status === 'OVERDUE')) {
        await emit(tx, {
          eventCode: status === 'OVERDUE' ? EVENTS.SLA_OVERDUE : EVENTS.SLA_DUE_SOON,
          applicationId: instance.task.instance.applicationId,
          payload: {
            applicationNumber: instance.task.instance.application.applicationNumber,
            stageCode: instance.task.stage.code,
            stageName: instance.task.stage.name,
            assignedRoleKey: instance.task.assignedRoleKey,
            assignedUserId: instance.task.assignedUserId,
            dueAt: instance.dueAt.toISOString(),
            overdueDays,
          },
        });
        report.notified += 1;
      }
    });
  }

  return report;
}

// ── Describing a clock, for a screen ─────────────────────────────────────

export type SlaClock = {
  /** When this desk received the file and the clock started. */
  startedAt: Date;
  /** The standard, in days, and the calendar it counts in. */
  targetDays: number | null;
  calendar: string;
  dueAt: Date;
  /** Whole days the desk has actually held it — parked time excluded. */
  elapsedDays: number;
  /** Working days left. Negative once the date has passed. */
  remainingDays: number;
  status: string;
  /** How far through the standard, 0–100. Caps at 100; it never reads 140%. */
  percent: number;
  isPaused: boolean;
  isDueSoon: boolean;
  isOverdue: boolean;
  overdueDays: number;
  /**
   * The role told when this clock goes overdue, if any.
   *
   * Present so a screen can SAY who was told. Escalation here is one
   * notification to one role and nothing else — no reassignment, no automatic
   * action, and above all no deemed approval (docs R.1.1).
   */
  escalatesTo: string | null;
};

/**
 * Turns a stored clock into the numbers a panel shows.
 *
 * ── Elapsed excludes parked time, and that is the point ─────────────────
 *
 * `pausedMs` accumulates the time a blocking shortfall had the file with the
 * applicant. Counting it would make the figure a measure of how slow
 * applicants are, which is exactly the number a department does not need. So
 * "12 days at this desk" means twelve days this desk could have acted.
 *
 * Pure: it reads a row and computes, and writes nothing. `sweep()` remains the
 * only thing that changes a clock's status.
 */
export function describeSlaClock(
  sla: {
    startedAt: Date;
    dueAt: Date;
    status: string;
    pausedAt: Date | null;
    pausedMs: number;
    overdueDays: number;
    rule?: { days: number; calendar: string; escalateToRoleKey: string | null } | null;
  },
  now: Date = new Date()
): SlaClock {
  // A paused clock froze when it was paused. Measuring to `now` would keep
  // counting the applicant's time against the desk, which is the whole thing
  // pausing exists to prevent.
  const effectiveNow = sla.pausedAt ?? now;
  const heldMs = Math.max(0, effectiveNow.getTime() - sla.startedAt.getTime() - sla.pausedMs);

  const elapsedDays = Math.floor(heldMs / DAY_MS);
  const remainingMs = sla.dueAt.getTime() - effectiveNow.getTime();
  const remainingDays = Math.ceil(remainingMs / DAY_MS);

  const spanMs = sla.dueAt.getTime() - sla.startedAt.getTime() - sla.pausedMs;
  const percent = spanMs > 0 ? Math.max(0, Math.min(100, Math.round((heldMs / spanMs) * 100))) : 100;

  return {
    startedAt: sla.startedAt,
    targetDays: sla.rule?.days ?? null,
    calendar: sla.rule?.calendar ?? 'WORKING_DAYS',
    dueAt: sla.dueAt,
    elapsedDays,
    remainingDays,
    status: sla.status,
    percent,
    isPaused: sla.pausedAt != null || sla.status === 'PAUSED',
    isDueSoon: sla.status === 'DUE_SOON',
    isOverdue: sla.status === 'OVERDUE',
    overdueDays: sla.overdueDays,
    escalatesTo: sla.rule?.escalateToRoleKey ?? null,
  };
}
