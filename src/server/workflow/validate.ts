import 'server-only';
import type { Db } from '@/server/db/prisma';
import { isKnownGuard } from './guards';
import { isKnownEffect } from './effects';

/**
 * The graph validator — docs/03-workflow.md G.4.
 *
 * A configurable engine is a footgun unless somebody checks the configuration,
 * and the moment to check it is BEFORE it is published, not when a file
 * reaches a stage with no way out at four o'clock on a Friday.
 *
 * Every rule here describes a way a workflow can be wrong that the engine
 * cannot recover from at runtime:
 *
 *   · a file that arrives somewhere it can never leave
 *   · two rows that both match, so routing depends on row order
 *   · a guard or effect name the engine does not implement
 *   · a role granted an action at a desk it does not work at
 *   · no way to reach an ending at all
 *
 * The seed runs this before it publishes, and the admin workflow editor calls
 * the same function — one implementation, so a workflow that the seed accepts
 * and the editor rejects is not a state this system can reach.
 */

export type ValidationIssue = { rule: string; severity: 'ERROR' | 'WARNING'; message: string };

export type ValidationReport = {
  valid: boolean;
  issues: ValidationIssue[];
  stages: number;
  transitions: number;
  /** Stages the engine can actually reach from the entry stage. */
  reachable: string[];
};

export async function validateWorkflow(db: Db, workflowId: string): Promise<ValidationReport> {
  const [stages, transitions, assignments] = await Promise.all([
    db.workflowStage.findMany({
      where: { workflowId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        ownerRoleKeys: true,
        isEntry: true,
        isTerminal: true,
        isActive: true,
        entryStatus: true,
      },
    }),
    db.workflowTransition.findMany({
      where: { workflowId, isActive: true },
      select: {
        id: true,
        fromStageId: true,
        toStageId: true,
        fromStatus: true,
        toStatus: true,
        allowedRoleKeys: true,
        guards: true,
        effects: true,
        action: { select: { code: true, label: true, kind: true } },
      },
    }),
    db.workflowAssignment.findMany({
      where: { workflowId, isActive: true },
      select: { id: true, stageId: true, roleKey: true, strategy: true, userId: true },
    }),
  ]);

  const issues: ValidationIssue[] = [];
  const byId = new Map(stages.map((s) => [s.id, s]));
  const error = (rule: string, message: string) => issues.push({ rule, severity: 'ERROR', message });
  const warn = (rule: string, message: string) => issues.push({ rule, severity: 'WARNING', message });

  // ── 1. Exactly one entry stage ─────────────────────────────────────────
  const entries = stages.filter((s) => s.isEntry && s.isActive);
  if (entries.length === 0) error('entry-stage', 'No stage is marked as the entry stage.');
  if (entries.length > 1) {
    error('entry-stage', `${entries.length} stages are marked as the entry stage; exactly one may be.`);
  }

  // ── 2. Terminal stages ─────────────────────────────────────────────────
  const terminals = stages.filter((s) => s.isTerminal && s.isActive);
  if (!terminals.some((s) => s.entryStatus === 'APPROVED')) {
    error('terminal-approved', 'No terminal stage produces an APPROVED application.');
  }
  if (!terminals.some((s) => s.entryStatus === 'REJECTED')) {
    error('terminal-rejected', 'No terminal stage produces a REJECTED application.');
  }

  // ── 3. Reachability from the entry stage ───────────────────────────────
  //
  // Computed rather than assumed. A stage nobody can reach is either dead
  // configuration or a routing mistake, and both are worth naming.
  const outbound = new Map<string, typeof transitions>();
  for (const t of transitions) {
    const list = outbound.get(t.fromStageId) ?? [];
    list.push(t);
    outbound.set(t.fromStageId, list);
  }

  const reachable = new Set<string>();
  const entry = entries[0];

  if (entry) {
    const queue = [entry.id];
    reachable.add(entry.id);

    while (queue.length) {
      const current = queue.shift()!;
      for (const t of outbound.get(current) ?? []) {
        // A transition with no destination is routed by an effect —
        // RETURN_TO_ORIGIN goes back to whichever stage parked the file, so
        // every stage that can park one is a possible destination.
        const targets = t.toStageId
          ? [t.toStageId]
          : parkingStages(transitions).filter((id) => id !== current);

        for (const target of targets) {
          if (!reachable.has(target)) {
            reachable.add(target);
            queue.push(target);
          }
        }
      }
    }
  }

  for (const stage of stages) {
    if (!stage.isActive) continue;

    // LTP-side stages describe the applicant phase, which the filing services
    // drive directly; they are catalogue entries, not part of the engine's
    // graph, and are not expected to be reachable from the entry stage.
    if (stage.type === 'LTP_ACTION' && !reachable.has(stage.id)) continue;

    if (!reachable.has(stage.id)) {
      warn('reachable', `${stage.name} (${stage.code}) cannot be reached from the entry stage.`);
      continue;
    }

    if (!stage.isTerminal && !(outbound.get(stage.id) ?? []).length) {
      error(
        'dead-end',
        `${stage.name} (${stage.code}) has no way out: a file that arrives there would stop for good.`
      );
    }
  }

  // ── 4. At least one path to an ending ──────────────────────────────────
  if (entry && !terminals.some((t) => reachable.has(t.id))) {
    error('no-ending', 'No terminal stage can be reached from the entry stage.');
  }

  // ── 5. No ambiguous routing ────────────────────────────────────────────
  //
  // The database refuses exact duplicates. This catches the subtler case the
  // index cannot: a status-specific row AND an any-status row for the same
  // action are both legal, and the engine's precedence rule handles it — but
  // an administrator should be told the general row is being shadowed.
  const seen = new Map<string, number>();
  for (const t of transitions) {
    const key = `${t.fromStageId}|${t.action.code}|${t.fromStatus ?? '*'}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      const [stageId, action] = key.split('|');
      error(
        'ambiguous',
        `${byId.get(stageId!)?.code ?? stageId} has ${count} active transitions for ${action} on the same status.`
      );
    }
  }

  // ── 6. Roles ───────────────────────────────────────────────────────────
  //
  // G.4 rule 5: `allowedRoleKeys` must be a subset of the from-stage's owners.
  // A transition granted to a role that does not work at that desk is either a
  // typo or a privilege escalation, and the two are indistinguishable from the
  // outside — so both are refused.
  for (const t of transitions) {
    const from = byId.get(t.fromStageId);
    if (!from) continue;

    const tAllowed = Array.isArray(t.allowedRoleKeys) ? (t.allowedRoleKeys as string[]) : [];
    const fromOwners = Array.isArray(from.ownerRoleKeys) ? (from.ownerRoleKeys as string[]) : [];

    for (const role of tAllowed) {
      if (!fromOwners.includes(role)) {
        error(
          'role-subset',
          `${t.action.code} out of ${from.code} is granted to ${role}, which does not own that stage.`
        );
      }
    }

    if (!tAllowed.length && !fromOwners.length && t.action.kind !== 'SYSTEM') {
      error(
        'no-actor',
        `${t.action.code} out of ${from.code} names no roles, and the stage has no owner either — nobody could perform it.`
      );
    }
  }

  // ── 7. Guards and effects the engine implements ────────────────────────
  for (const t of transitions) {
    for (const guard of asArray<string>(t.guards)) {
      if (!isKnownGuard(guard)) {
        error('unknown-guard', `${t.action.code} names a guard the engine does not implement: ${guard}.`);
      }
    }

    for (const effect of asArray<{ type?: string }>(t.effects)) {
      const type = String(effect?.type ?? '');
      if (!isKnownEffect(type)) {
        error('unknown-effect', `${t.action.code} names an effect the engine does not implement: ${type}.`);
      }
    }
  }

  // ── 8. RETURN_TO_ORIGIN only leaves an applicant-side stage ────────────
  for (const t of transitions) {
    const returns = asArray<{ type?: string }>(t.effects).some((e) => e?.type === 'RETURN_TO_ORIGIN');
    if (!returns) continue;

    const from = byId.get(t.fromStageId);
    if (from && from.type !== 'LTP_ACTION') {
      error(
        'return-origin',
        `${t.action.code} returns to the parked stage but leaves ${from.code}, which is not an applicant-side stage. Only a parked file has an origin to return to.`
      );
    }
  }

  // ── 9. Transitions with no destination must supply one ─────────────────
  for (const t of transitions) {
    if (t.toStageId) continue;
    const supplies = asArray<{ type?: string }>(t.effects).some((e) => e?.type === 'RETURN_TO_ORIGIN');
    if (!supplies) {
      error(
        'no-destination',
        `${t.action.code} out of ${byId.get(t.fromStageId)?.code} has no destination and no effect that chooses one.`
      );
    }
  }

  // ── 9a. An empty toStatus is only for a transition that keeps the status ──
  for (const t of transitions) {
    if (t.toStatus) continue;
    const keeps = asArray<{ type?: string }>(t.effects).some((e) => e?.type === 'KEEP_STATUS');
    if (!keeps) {
      error(
        'no-status',
        `${t.action.code} out of ${byId.get(t.fromStageId)?.code} names no resulting status and does not keep the current one.`
      );
    }
  }

  // ── 10. Assignment rules address a role the stage owns ─────────────────
  for (const rule of assignments) {
    const stage = byId.get(rule.stageId);
    if (!stage) continue;
    const stageOwners = Array.isArray(stage.ownerRoleKeys) ? (stage.ownerRoleKeys as string[]) : [];
    if (!stageOwners.includes(rule.roleKey)) {
      error(
        'assignment-role',
        `An assignment rule routes ${stage.code} to ${rule.roleKey}, which does not own that stage.`
      );
    }
    if (rule.strategy === 'DIRECT' && !rule.userId) {
      error('assignment-direct', `A DIRECT assignment rule for ${stage.code} names no officer.`);
    }
  }

  // ── 11. Every reachable non-terminal stage can route its work ──────────
  for (const stage of stages) {
    if (!stage.isActive || stage.isTerminal || !reachable.has(stage.id)) continue;
    const stageOwners = Array.isArray(stage.ownerRoleKeys) ? (stage.ownerRoleKeys as string[]) : [];
    if (!stageOwners.length) {
      error('no-owner', `${stage.code} has no owner role, so a task arriving there could not be addressed.`);
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'ERROR'),
    issues,
    stages: stages.length,
    transitions: transitions.length,
    reachable: stages.filter((s) => reachable.has(s.id)).map((s) => s.code),
  };
}

/** Stages a blocking shortfall can park a file at — the possible origins. */
function parkingStages(transitions: Array<{ fromStageId: string; effects: unknown }>): string[] {
  return transitions
    .filter((t) =>
      asArray<{ type?: string; mode?: string }>(t.effects).some(
        (e) => e?.type === 'RAISE_SHORTFALL' && e?.mode === 'BLOCKING'
      )
    )
    .map((t) => t.fromStageId);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
