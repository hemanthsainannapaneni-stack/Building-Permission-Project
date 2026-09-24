/**
 * PHASE 8 VERIFICATION — change of technical professional.
 *
 *   npm run tpchange:verify
 *
 * Read-only against the data, except for three refusals it provokes on
 * purpose (each is refused inside its transaction, so nothing is written):
 * verifying a request that lacks the outgoing professional's release, an LTP
 * attempting to verify, and a Planning Officer attempting to decide.
 *
 * Checks, for every request in the database:
 *   · old professional history remains  — the outgoing engagement is kept,
 *     SUPERSEDED, dated, without drawing rights; the request still names them;
 *     the filing declaration is untouched
 *   · new professional becomes active    — ltpUserId, exactly one ACTIVE
 *     engagement, drawing rights, and the drawings service's own scope
 *   · workflow                            — one history row per step, by the
 *     officer the request names, and none of them moved the file
 *   · audit                               — every required action is chained
 */
import { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../src/lib/rbac-matrix';
import type { AuthUser } from '../src/server/auth/context';
import { listDrawings } from '../src/server/services/drawings';
import { decideProfessionalChange, verifyProfessionalChange } from '../src/server/services/professional-changes';

const prisma = new PrismaClient();
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const META = { ip: '127.0.0.1', userAgent: 'verify-professional-change', correlationId: 'phase8-verify' };

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}

async function actorFor(userId: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });
  const roleKeys = u.roles.map((r) => r.role.key);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleKeys: roleKeys as never,
    roleNames: u.roles.map((r) => r.role.name),
    capabilities: [...new Set(roleKeys.flatMap((k) => MATRIX[k] ?? []))],
    zoneIds: [...new Set([...(u.primaryZoneId ? [u.primaryZoneId] : []), ...u.jurisdictions.map((j) => j.zoneId)])],
    officeId: u.officeId ?? null,
    sessionId: 'verify',
  };
}

async function officer(roleKey: string, zoneId: string | null) {
  const u = await prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { key: roleKey } } },
      ...(zoneId ? { OR: [{ primaryZoneId: zoneId }, { jurisdictions: { some: { zoneId } } }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return u ? actorFor(u.id) : null;
}

async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const STEP_ACTIONS: Record<string, string[]> = {
  PENDING_VERIFICATION: ['REQUEST_PROFESSIONAL_CHANGE'],
  UNDER_REVIEW: ['REQUEST_PROFESSIONAL_CHANGE', 'VERIFY_PROFESSIONAL_CHANGE'],
  PENDING_DECISION: ['REQUEST_PROFESSIONAL_CHANGE', 'VERIFY_PROFESSIONAL_CHANGE', 'REVIEW_PROFESSIONAL_CHANGE'],
  APPROVED: ['REQUEST_PROFESSIONAL_CHANGE', 'VERIFY_PROFESSIONAL_CHANGE', 'REVIEW_PROFESSIONAL_CHANGE', 'APPROVE_PROFESSIONAL_CHANGE'],
  REJECTED: ['REQUEST_PROFESSIONAL_CHANGE', 'VERIFY_PROFESSIONAL_CHANGE', 'REVIEW_PROFESSIONAL_CHANGE', 'REJECT_PROFESSIONAL_CHANGE'],
};

const AUDIT_BY_STATUS: Record<string, string[]> = {
  PENDING_VERIFICATION: ['PROFESSIONAL_CHANGE_REQUESTED', 'PROFESSIONAL_CHANGE_DOCUMENTS_ADDED'],
  UNDER_REVIEW: ['PROFESSIONAL_CHANGE_REQUESTED', 'PROFESSIONAL_CHANGE_DOCUMENTS_ADDED', 'PROFESSIONAL_CHANGE_VERIFIED'],
  APPROVED: [
    'PROFESSIONAL_CHANGE_REQUESTED',
    'PROFESSIONAL_CHANGE_DOCUMENTS_ADDED',
    'PROFESSIONAL_CHANGE_VERIFIED',
    'PROFESSIONAL_CHANGE_REVIEWED',
    'PROFESSIONAL_CHANGE_APPROVED',
    'PROFESSIONAL_CHANGED',
    'DRAWING_RIGHTS_TRANSFERRED',
  ],
  REJECTED: [
    'PROFESSIONAL_CHANGE_REQUESTED',
    'PROFESSIONAL_CHANGE_DOCUMENTS_ADDED',
    'PROFESSIONAL_CHANGE_VERIFIED',
    'PROFESSIONAL_CHANGE_REVIEWED',
    'PROFESSIONAL_CHANGE_REJECTED',
  ],
};

async function main() {
  const requests = await prisma.professionalChangeRequest.findMany({
    orderBy: { requestNumber: 'asc' },
    include: { application: { select: { id: true, applicationNumber: true, ltpUserId: true, ltpDeclaration: true, zoneId: true, status: true, currentStageCode: true } } },
  });
  console.log(`\n${requests.length} change of professional request(s)\n`);
  check('demo has one request in each state', ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].every((s) => requests.some((r) => r.status === s)),
    requests.map((r) => r.status).join(', '));

  for (const r of requests) {
    const app = r.application;
    console.log(`\n${r.requestNumber} · ${app.applicationNumber} · ${r.status}`);
    const cur = r.currentSnapshot as { name?: string; userId?: string };
    const prop = r.proposedSnapshot as { name?: string; userId?: string };

    // ── Workflow ────────────────────────────────────────────────────────
    const history = await prisma.workflowHistory.findMany({
      where: { instance: { applicationId: app.id }, actionCode: { contains: 'PROFESSIONAL_CHANGE' } },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, actionCode: true, actorName: true, actorRoleKey: true, fromStageCode: true, toStageCode: true, fromStatus: true, toStatus: true },
    });
    const expected = STEP_ACTIONS[r.status] ?? [];
    check('workflow history has one row per step, in order', JSON.stringify(history.map((h) => h.actionCode)) === JSON.stringify(expected),
      history.map((h) => h.actionCode).join(' → '));
    check('no step moved the file (same stage, same status)', history.every((h) => h.fromStageCode === h.toStageCode && h.fromStatus === h.toStatus));
    check('request row records the workflow sequence', r.requestSequence === history[0]?.sequence);
    const named: Array<[string, string]> = [
      ['REQUEST_PROFESSIONAL_CHANGE', r.requestedByName],
      ['VERIFY_PROFESSIONAL_CHANGE', r.verifiedByName],
      ['REVIEW_PROFESSIONAL_CHANGE', r.reviewedByName],
      ['APPROVE_PROFESSIONAL_CHANGE', r.decidedByName],
      ['REJECT_PROFESSIONAL_CHANGE', r.decidedByName],
    ];
    check('each history row names the officer the request names',
      history.every((h) => named.find(([a]) => a === h.actionCode)?.[1] === h.actorName));
    const roles = history.map((h) => h.actorRoleKey);
    const deskOrder = ['TPA', 'PLANNING_OFFICER', 'ZDD', 'ZJD'].slice(0, roles.length);
    check('steps taken by TPA → Planning Officer → ZDD → ZJD', JSON.stringify(roles) === JSON.stringify(deskOrder), roles.join(' → '));

    // ── Audit ───────────────────────────────────────────────────────────
    const audits = await prisma.auditLog.findMany({ where: { applicationId: app.id, action: { in: [...new Set(Object.values(AUDIT_BY_STATUS).flat())] } }, select: { action: true } });
    const have = new Set(audits.map((a) => a.action));
    const wanted = AUDIT_BY_STATUS[r.status] ?? [];
    check('audit entries recorded', wanted.every((a) => have.has(a)), `missing ${wanted.filter((a) => !have.has(a)).join(', ') || 'none'}`);

    const engagements = await prisma.applicationProfessional.findMany({ where: { applicationId: app.id }, orderBy: { engagedFrom: 'asc' } });

    if (r.status === 'APPROVED') {
      // ── New professional becomes active ─────────────────────────────
      check('file now held by the proposed professional', app.ltpUserId === r.proposedProfessionalId);
      const active = engagements.filter((e) => e.status === 'ACTIVE');
      check('exactly one ACTIVE engagement, for the new professional', active.length === 1 && active[0]!.userId === r.proposedProfessionalId);
      check('new engagement holds drawing rights and names the request', Boolean(active[0]?.drawingRights) && active[0]?.changeRequestId === r.id);

      // ── Old professional history remains ────────────────────────────
      const old = engagements.find((e) => e.userId === r.currentProfessionalId);
      check('old professional kept in history', Boolean(old));
      check('old engagement SUPERSEDED, dated, without drawing rights',
        old?.status === 'SUPERSEDED' && Boolean(old.engagedUntil) && old.drawingRights === false && old.endedByChangeRequestId === r.id);
      check('request still names the old professional', cur.userId === r.currentProfessionalId && Boolean(cur.name));
      const decl = (app.ltpDeclaration ?? {}) as { name?: string };
      check('filing declaration untouched (not rewritten to the new professional)', !decl.name || decl.name !== prop.name, decl.name ?? '(none)');
      const events = await prisma.professionalChangeEvent.findMany({ where: { requestId: r.id }, select: { action: true } });
      check('request history shows Professional Changed', events.some((e) => e.action === 'PROFESSIONAL_CHANGED'));

      // ── Drawing rights, through the drawings service's own scope ────
      const oldLtp = await actorFor(r.currentProfessionalId);
      const newLtp = await actorFor(r.proposedProfessionalId);
      const oldSees = await refused(() => listDrawings(oldLtp, app.id));
      const newSees = await refused(() => listDrawings(newLtp, app.id));
      check('old professional can no longer reach the drawings', Boolean(oldSees), oldSees || 'was allowed');
      check('new professional can reach the drawings', !newSees, newSees);
    } else {
      check('file still held by the current professional', app.ltpUserId === r.currentProfessionalId);
      check('no engagement row points at this undecided/rejected request', !engagements.some((e) => e.changeRequestId === r.id || e.endedByChangeRequestId === r.id));
    }

    // ── Refusals (nothing is written) ─────────────────────────────────
    if (r.status === 'PENDING_VERIFICATION') {
      const po = await officer('PLANNING_OFFICER', app.zoneId);
      const hasRelease = (r.documents as Array<{ kind: string }>).some((d) => d.kind === 'CURRENT_PROFESSIONAL_NOC' || d.kind === 'TERMINATION_LETTER');
      if (po && !hasRelease) {
        const msg = await refused(() => verifyProfessionalChange(po, r.id, { remarks: 'Attempted by the verification script.' }, META));
        check('verification refused without the outgoing professional’s NOC or termination letter', /NOC|termination/i.test(msg), msg);
      }
      const ltp = await actorFor(app.ltpUserId);
      const msg2 = await refused(() => verifyProfessionalChange(ltp, r.id, { remarks: 'Attempted by the verification script.' }, META));
      check('an LTP cannot verify', Boolean(msg2), msg2);
      const after = await prisma.professionalChangeRequest.findUniqueOrThrow({ where: { id: r.id }, select: { status: true } });
      check('refused attempts left the request unchanged', after.status === 'PENDING_VERIFICATION');
    }
    if (r.status === 'UNDER_REVIEW') {
      const po = await officer('PLANNING_OFFICER', app.zoneId);
      if (po) {
        const msg = await refused(() => decideProfessionalChange(po, r.id, { decision: 'APPROVED', remarks: 'Attempted by the verification script.' }, META));
        check('a Planning Officer cannot decide', Boolean(msg), msg);
      }
    }
  }

  // ── Configuration ─────────────────────────────────────────────────────
  const rows = await prisma.workflowTransition.count({
    where: { isActive: true, workflow: { code: 'BBAS_STANDARD', isPublished: true }, action: { code: { contains: 'PROFESSIONAL_CHANGE' } } },
  });
  check('BBAS_STANDARD carries the change of professional transitions', rows >= 35, `${rows} rows`);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
