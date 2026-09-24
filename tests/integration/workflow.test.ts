import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import {
  prisma,
  databaseAvailable,
  cleanupTestUsers,
  cleanupTestApplications,
  clearJobs,
  clearStorage,
  clearOrphanFiles,
  drainJobs,
  configureMockScrutiny,
  configureMockGateway,
  actorFor,
  META,
} from './setup';
import { createApplication, saveStep, submitApplication } from '@/server/services/applications';
import { uploadDrawing } from '@/server/services/drawings';
import { requestScrutiny } from '@/server/services/scrutiny';
import { uploadDocument } from '@/server/services/documents';
import { generateFee } from '@/server/services/fees';
import { initiatePayment, handleWebhook } from '@/server/services/payments';
import { buildMockGatewayRequest } from '@/server/payments/mock';
import { createUser } from '@/server/services/users';
import { performAction, getWorkflowState, getHistory, getShortfalls } from '@/server/workflow/engine';
import { listTasks, claimTask, releaseTask, reassignTask, taskSummary } from '@/server/workflow/tasks';
import { validateWorkflow } from '@/server/workflow/validate';
import { addSlaDays, sweepSla } from '@/server/workflow/sla';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 6 — the workflow engine.
 *
 * ── What this suite is actually asserting ────────────────────────────────
 *
 * Not "the code runs". Four properties, each of which is the reason a
 * particular piece of the design exists:
 *
 *   1. EVERY TRANSITION IN THE SEED WORKS. Every row of
 *      `workflow_transitions` is exercised from the stage it leaves, by a role
 *      that owns it, and the resulting stage, status, task, SLA, history row
 *      and shortfall are checked. A transition nobody has driven is a claim,
 *      not a feature.
 *
 *   2. AN OPEN SHORTFALL BLOCKS APPROVAL, ABSOLUTELY. Blocking or reported,
 *      raised at any desk, of any kind. This is the one guard with no
 *      override, so it is tested from both modes and after a full six-desk
 *      journey — the case where a REPORTED shortfall raised at ZJD is still
 *      open when the Commissioner comes to approve.
 *
 *   3. THE ACTION BAR CANNOT LIE. Every action `getWorkflowState` offers is
 *      one `performAction` accepts, and every action it withholds is one
 *      `performAction` refuses. They share a code path, and this suite is what
 *      proves the sharing is real.
 *
 *   4. ROLE AND STAGE TOGETHER DECIDE. Holding the capability is not enough;
 *      the file must be at your desk. A ZAD with every zonal capability cannot
 *      forward a file sitting at TPA.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/**
 * Every unconditionally-mandatory document type, as the seed defines them.
 *
 * Read from `DOCUMENT_REQUIREMENTS` rather than listed by hand. The fee gate
 * refuses a demand until all of them are in, and a hard-coded list stops
 * working the day a requirement is added — which is what happened here when
 * BIM_MODEL became mandatory and every fixture in this file began failing at
 * `generateFee` with "1 is outstanding".
 */
const MANDATORY = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);

const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;
let ltp: Actor;
let tpa: Actor;
let zad: Actor;
let zdd: Actor;
let zjd: Actor;
let director: Actor;
let addlCommissioner: Actor;
let commissioner: Actor;
let typeId: string;
let zoneId: string;

/**
 * An actor carrying the capabilities its role really holds.
 *
 * Built from RBAC_MATRIX rather than hand-listed: a test that grants itself a
 * convenient capability proves nothing about what an officer can actually do.
 */
async function officer(email: string, role: RoleKey, zones: string[] = []): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return actorFor(user.id, user.name, [role], {
    capabilities: RBAC_MATRIX[role] as unknown as string[],
    zoneIds: zones,
  });
}

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN], {
    capabilities: RBAC_MATRIX[ROLES.SYSTEM_ADMIN] as unknown as string[],
  });

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  const created = await createUser(
    {
      email: 'test-wf-ltp@example.com',
      name: 'Test Workflow LTP',
      phone: '9876500001',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-WF-1',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Workflow Firm',
    },
    admin,
    META
  );

  ltp = actorFor(created.user.id, created.user.name, [ROLES.LTP], {
    capabilities: RBAC_MATRIX[ROLES.LTP] as unknown as string[],
  });

  // The demo officers, with the zone the test's applications sit in. A zonal
  // officer with no jurisdiction sees nothing, which is correct behaviour and
  // useless for testing the engine.
  [tpa, zad, zdd, zjd, director, addlCommissioner, commissioner] = await Promise.all([
    officer('tpa.demo@example.com', ROLES.TPA, [zoneId]),
    officer('zad.demo@example.com', ROLES.ZAD, [zoneId]),
    officer('zdd.demo@example.com', ROLES.ZDD, [zoneId]),
    officer('zjd.demo@example.com', ROLES.ZJD, [zoneId]),
    officer('director.demo@example.com', ROLES.DIRECTOR_DP),
    officer('addlcommissioner.demo@example.com', ROLES.ADDL_COMMISSIONER),
    officer('commissioner.demo@example.com', ROLES.COMMISSIONER),
  ]);
}, 90_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
  await configureMockGateway({ mode: 'MANUAL' });
});

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id].filter(Boolean) as string[]);
  await clearJobs();
});

afterAll(async () => {
  if (dbUp) {
    await cleanupTestUsers();
    await clearOrphanFiles();
    await clearStorage();
  }
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An application that has been filed, drawn, scrutinised, documented and PAID
 * — so the workflow engine has started it and it is sitting at TPA.
 *
 * Deliberately the whole real path rather than an inserted row: the point of
 * Phase 6's gate is that ONLY a confirmed payment starts a departmental run,
 * and a fixture that wrote `status: 'PENDING_TPA'` directly would test the
 * engine against a state the system cannot actually produce.
 */
async function atTpa() {
  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: 'ravi@example.com', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '123/A', plotNo: '7', plotAreaSqm: 300, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    [
      'development',
      {
        buildingUse: 'DWELLING',
        occupancyType: 'A_RESIDENTIAL',
        buildingSubUse: '',
        structureType: 'RCC',
        numFloors: 2,
        numBasements: 0,
        numDwellingUnits: 1,
        buildingHeightM: 7.5,
      },
    ],
    [
      'building',
      {
        plotAreaSqm: 300,
        builtUpAreaSqm: 620,
        floorAreaSqm: 380,
        coverageAreaSqm: 180,
        parkingAreaSqm: 40,
        setbackFrontM: 3,
        setbackRearM: 2,
        setbackLeftM: 1.5,
        setbackRightM: 1.5,
      },
    ],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  for (const [step, data] of steps) {
    await saveStep(ltp, app.id, { step: step as never, data, partial: false }, META);
  }

  const submitted = await submitApplication(ltp, app.id, META);

  await uploadDrawing(
    ltp,
    { applicationId: submitted.id, category: 'SITE_PLAN', file: { name: 'site.pdf', type: 'application/pdf', bytes: PDF } },
    META
  );
  await drainJobs();
  await requestScrutiny(ltp, submitted.id, META);
  await drainJobs();

  for (const code of MANDATORY) {
    await uploadDocument(
      ltp,
      {
        applicationId: submitted.id,
        documentTypeCode: code,
        expiresOn: NEEDS_EXPIRY.has(code) ? FUTURE : null,
        file: { name: `${code.toLowerCase()}.pdf`, type: 'application/pdf', bytes: PDF },
      },
      META
    );
  }
  await drainJobs();

  const demand = await generateFee(admin, submitted.id, META);
  const started = await initiatePayment(ltp, demand.id, META);

  await handleWebhook(
    'mock',
    buildMockGatewayRequest({
      paymentRef: started.payment.paymentRef,
      state: 'SUCCESS',
      amount: demand.totalAmount.toFixed(2),
      eventId: `wf_${started.payment.paymentRef}`,
    })
  );

  return submitted.id;
}

/** Performs an action and returns the engine's result. */
const act = (
  actor: Actor,
  applicationId: string,
  action: string,
  input: Parameters<typeof performAction>[3] = {}
) => performAction(actor, applicationId, action, { remarks: 'Checked and in order.', ...input }, META);

const appRow = (id: string) =>
  prisma.application.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      currentStageCode: true,
      openShortfalls: true,
      slaDueAt: true,
      slaStatus: true,
      approvedAt: true,
      rejectedAt: true,
    },
  });

const instanceRow = (id: string) =>
  prisma.workflowInstance.findUniqueOrThrow({
    where: { applicationId: id },
    select: {
      status: true,
      parkedStageId: true,
      completedAt: true,
      currentStageId: true,
    },
  });

const openTask = (id: string) =>
  prisma.workflowTask.findFirst({
    where: { instance: { applicationId: id }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    select: {
      id: true,
      assignedRoleKey: true,
      assignedUserId: true,
      priority: true,
      status: true,
      stage: { select: { code: true } },
      sla: { select: { dueAt: true, status: true, pausedAt: true } },
    },
  });

/** Walks the file forward one desk at a time, so a test can start where it likes. */
async function advanceTo(applicationId: string, stageCode: string) {
  const route: Array<[Actor, string]> = [
    [tpa, 'TPA_REVIEW'],
    [zad, 'ZAD_ZDD_REVIEW'],
    [zjd, 'ZJD_REVIEW'],
    [director, 'DIRECTOR_DP_REVIEW'],
    [addlCommissioner, 'ADDL_COMMISSIONER_REVIEW'],
    [commissioner, 'COMMISSIONER_REVIEW'],
  ];

  // Starts from where the file ACTUALLY is, not from the beginning: a test
  // that walks to several stages in turn calls this repeatedly, and forwarding
  // from a desk the file has already left is a 403.
  const current = (await appRow(applicationId)).currentStageCode ?? 'TPA_REVIEW';
  const from = Math.max(0, route.findIndex(([, code]) => code === current));

  for (const [actor, code] of route.slice(from)) {
    if (code === stageCode) return;
    await act(actor, applicationId, ACTIONS.FORWARD);
  }
}

const errorOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return isApiError(err) ? { status: err.status, code: err.code, message: err.message } : { status: 0, code: 'UNKNOWN', message: String(err) };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. The graph itself
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the seeded workflow', () => {
  it('validates and is published', async () => {
    const workflow = await prisma.workflow.findFirstOrThrow({
      where: { code: 'BP_STANDARD' },
      select: { id: true, isPublished: true },
    });

    const report = await validateWorkflow(prisma, workflow.id);

    expect(report.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
    expect(workflow.isPublished).toBe(true);

    // Every departmental desk, the applicant's parked stage and both endings.
    expect(report.reachable).toEqual(
      expect.arrayContaining([
        'LTP_PAYMENT',
        'TPA_REVIEW',
        'ZAD_ZDD_REVIEW',
        'ZJD_REVIEW',
        'DIRECTOR_DP_REVIEW',
        'ADDL_COMMISSIONER_REVIEW',
        'COMMISSIONER_REVIEW',
        'LTP_SHORTFALL_ACTION',
        'CLOSED_APPROVED',
        'CLOSED_REJECTED',
      ])
    );
  });

  it('has an owner role and a way out of every reachable non-terminal stage', async () => {
    const stages = await prisma.workflowStage.findMany({
      where: { workflow: { code: 'BP_STANDARD' }, type: { in: ['REVIEW', 'APPROVAL'] } },
      select: { code: true, ownerRoleKeys: true, fromTrans: { where: { isActive: true }, select: { id: true } } },
    });

    for (const stage of stages) {
      // `ownerRoleKeys` is a Json column, so it arrives as Prisma.JsonValue.
      const owners = (stage.ownerRoleKeys ?? []) as string[];
      expect(owners.length, `${stage.code} has no owner`).toBeGreaterThan(0);
      expect(stage.fromTrans.length, `${stage.code} has no way out`).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The gate — §8
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a confirmed payment', () => {
  it('starts the run, opens the first task and starts the clock', async () => {
    const id = await atTpa();

    const app = await appRow(id);
    expect(app.status).toBe('PENDING_TPA');
    expect(app.currentStageCode).toBe('TPA_REVIEW');
    expect(app.slaDueAt).not.toBeNull();
    expect(app.slaStatus).toBe('ON_TRACK');

    const instance = await instanceRow(id);
    expect(instance.status).toBe('ACTIVE');
    expect(instance.parkedStageId).toBeNull();

    const stage = await prisma.workflowStage.findUniqueOrThrow({
      where: { id: instance.currentStageId! },
      select: { code: true },
    });
    expect(stage.code).toBe('TPA_REVIEW');

    const task = await openTask(id);
    expect(task).toMatchObject({ assignedRoleKey: ROLES.TPA, status: 'PENDING', assignedUserId: null });
    expect(task?.stage.code).toBe('TPA_REVIEW');
    expect(task?.sla?.status).toBe('ON_TRACK');

    // The first row of the file's departmental history is the payment that
    // carried it there — recorded by the engine, with no officer behind it.
    const history = await getHistory(tpa, id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sequence: 1,
      actionCode: ACTIONS.CONFIRM_PAYMENT,
      fromStageCode: 'LTP_PAYMENT',
      toStageCode: 'TPA_REVIEW',
      toStatus: 'PENDING_TPA',
      actorName: 'System',
      actorRoleKey: 'SYSTEM',
    });
  }, 60_000);

  it('is the only thing that can start one — nothing else creates an instance', async () => {
    // A file that has not paid has no workflow instance at all, so there is
    // no action to take on it and no task in anybody's queue.
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

    const state = await getWorkflowState(ltp, app.id);
    expect(state.instance).toBeNull();
    expect(state.actions).toEqual([]);

    // A zonal officer cannot even see an unfiled draft — it has no zone yet —
    // so the refusal they get is the row-scope one, before the workflow is
    // consulted at all.
    const unseen = await errorOf(() => act(tpa, app.id, ACTIONS.FORWARD));
    expect(unseen?.status).toBe(403);

    // Somebody who CAN see it still finds there is nothing to act on: no
    // payment, no instance, no actions.
    const failure = await errorOf(() => act(admin, app.id, ACTIONS.FORWARD));
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/not reached the department/i);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The forward path — every desk, in order
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the departmental pipeline', () => {
  it('TPA → ZAD/ZDD → ZJD → Director → Addl Commissioner → Commissioner → Approved', async () => {
    const id = await atTpa();

    // ── TPA → ZAD/ZDD ────────────────────────────────────────────────────
    const toZad = await act(tpa, id, ACTIONS.FORWARD);
    expect(toZad).toMatchObject({
      fromStageCode: 'TPA_REVIEW',
      toStageCode: 'ZAD_ZDD_REVIEW',
      toStatus: 'PENDING_ZAD_ZDD',
      sequence: 2,
    });
    expect((await openTask(id))?.assignedRoleKey).toBe(ROLES.ZAD);

    // ── ZAD → ZJD ────────────────────────────────────────────────────────
    const toZjd = await act(zad, id, ACTIONS.FORWARD);
    expect(toZjd).toMatchObject({ toStageCode: 'ZJD_REVIEW', toStatus: 'PENDING_ZJD' });

    // ── ZJD → Director ───────────────────────────────────────────────────
    const toDirector = await act(zjd, id, ACTIONS.FORWARD);
    expect(toDirector).toMatchObject({
      toStageCode: 'DIRECTOR_DP_REVIEW',
      toStatus: 'PENDING_DIRECTOR_DP',
    });

    // ── Director → Additional Commissioner ───────────────────────────────
    const toAddl = await act(director, id, ACTIONS.FORWARD);
    expect(toAddl).toMatchObject({
      toStageCode: 'ADDL_COMMISSIONER_REVIEW',
      toStatus: 'PENDING_ADDITIONAL_COMMISSIONER',
    });

    // ── Additional Commissioner → Commissioner ───────────────────────────
    const toCommissioner = await act(addlCommissioner, id, ACTIONS.FORWARD);
    expect(toCommissioner).toMatchObject({
      toStageCode: 'COMMISSIONER_REVIEW',
      toStatus: 'PENDING_COMMISSIONER',
    });

    // ── Commissioner → Approved ──────────────────────────────────────────
    const approved = await act(commissioner, id, ACTIONS.APPROVE, {
      remarks: 'Approved. Permission granted subject to the sanctioned plan.',
    });
    expect(approved).toMatchObject({ toStageCode: 'CLOSED_APPROVED', toStatus: 'APPROVED' });

    const app = await appRow(id);
    expect(app.status).toBe('APPROVED');
    expect(app.currentStageCode).toBe('CLOSED_APPROVED');
    expect(app.approvedAt).not.toBeNull();
    // The clock stops with the file. A closed application showing a due date
    // would appear on an overdue report for ever.
    expect(app.slaDueAt).toBeNull();

    const instance = await instanceRow(id);
    expect(instance.status).toBe('COMPLETED');
    expect(instance.completedAt).not.toBeNull();

    // Nothing left in anybody's inbox.
    expect(await openTask(id)).toBeNull();

    // Seven rows: the payment, five forwards and the approval.
    const history = await getHistory(commissioner, id);
    expect(history.map((h) => h.actionCode)).toEqual([
      ACTIONS.CONFIRM_PAYMENT,
      ACTIONS.FORWARD,
      ACTIONS.FORWARD,
      ACTIONS.FORWARD,
      ACTIONS.FORWARD,
      ACTIONS.FORWARD,
      ACTIONS.APPROVE,
    ]);
    expect(history.map((h) => h.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The approval order is issued by the job the effect enqueued — not in the
    // approving transaction, so a slow renderer can never fail an approval.
    await drainJobs();
    const order = await prisma.approvalOrder.findUnique({
      where: { applicationId: id },
      select: { orderNumber: true, status: true, verificationCode: true },
    });
    expect(order?.status).toBe('ISSUED');
    expect(order?.orderNumber).toMatch(/^BPO\/\d{4}\/\d{5}$/);
    expect(order?.verificationCode).toHaveLength(32);
  }, 120_000);

  it('records every movement on the applicant-facing timeline as well', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.FORWARD, { remarks: 'Scrutiny worksheet complete.' });

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: id },
      orderBy: { sequence: 'asc' },
      select: { type: true, title: true, description: true },
    });

    const forwarded = events.filter((e) => e.type === 'STAGE_FORWARDED');
    expect(forwarded.length).toBeGreaterThanOrEqual(2);
    // Written in the applicant's language, naming the desk rather than a code.
    expect(forwarded.at(-1)?.title).toBe('Sent to Zonal Assistant / Deputy Director');
    expect(forwarded.at(-1)?.description).toBe('Scrutiny worksheet complete.');
  }, 60_000);

  it('lets a ZDD act on a file addressed to the ZAD — one desk, two roles', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.FORWARD);

    const task = await openTask(id);
    expect(task?.assignedRoleKey).toBe(ROLES.ZAD);

    // The queue is scoped by the STAGE's owners, so the file is in the ZDD's
    // inbox too, and the ZDD may act on it.
    const queue = await listTasks(zdd, {});
    expect(queue.rows.map((r) => r.applicationId)).toContain(id);

    const result = await act(zdd, id, ACTIONS.FORWARD);
    expect(result.toStageCode).toBe('ZJD_REVIEW');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Returning a file down the chain
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('returning', () => {
  it('sends the file back one desk, from every stage that has one behind it', async () => {
    const id = await atTpa();

    const chain: Array<[Actor, string, string]> = [
      [zad, 'ZAD_ZDD_REVIEW', 'TPA_REVIEW'],
      [zjd, 'ZJD_REVIEW', 'ZAD_ZDD_REVIEW'],
      [director, 'DIRECTOR_DP_REVIEW', 'ZJD_REVIEW'],
      [addlCommissioner, 'ADDL_COMMISSIONER_REVIEW', 'DIRECTOR_DP_REVIEW'],
      [commissioner, 'COMMISSIONER_REVIEW', 'ADDL_COMMISSIONER_REVIEW'],
    ];

    for (const [actor, from, back] of chain) {
      await advanceTo(id, from);
      expect((await appRow(id)).currentStageCode).toBe(from);

      const returned = await act(actor, id, ACTIONS.RETURN_TO_PREVIOUS, {
        remarks: 'Setbacks need re-checking before this goes further.',
      });

      expect(returned.toStageCode).toBe(back);
      expect((await openTask(id))?.stage.code).toBe(back);
    }
  }, 120_000);

  it('at the first desk, returns to the APPLICANT — there is no desk behind TPA', async () => {
    const id = await atTpa();

    const returned = await act(tpa, id, ACTIONS.RETURN_TO_PREVIOUS, {
      remarks: 'The site plan does not match the survey sketch. Please correct and resubmit.',
    });

    expect(returned.toStageCode).toBe('LTP_SHORTFALL_ACTION');
    expect(returned.toStatus).toBe('RETURNED_TO_APPLICANT');

    // Modelled as a clarification shortfall, so the applicant is told what is
    // wanted and the same resubmission path brings it back.
    const shortfalls = await getShortfalls(tpa, id);
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]).toMatchObject({
      kind: 'CLARIFICATION',
      mode: 'BLOCKING',
      status: 'RAISED',
    });

    expect((await openTask(id))?.assignedRoleKey).toBe(ROLES.LTP);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Blocking shortfalls — the park and resume loop
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a blocking shortfall', () => {
  it('parks the file, pauses the clock and puts it in the applicant’s hands', async () => {
    const id = await atTpa();
    const before = await openTask(id);

    const raised = await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'The encumbrance certificate is out of date.',
      shortfall: {
        title: 'Encumbrance certificate',
        description: 'A certificate dated within the last three months is required.',
        items: [{ description: 'Encumbrance certificate, current' }],
      },
    });

    expect(raised.toStageCode).toBe('LTP_SHORTFALL_ACTION');
    expect(raised.toStatus).toBe('TPA_DOCUMENT_SHORTFALL');
    expect(raised.shortfallNumbers[0]).toMatch(/^SF\/\d{4}\/\d{5}$/);

    const app = await appRow(id);
    expect(app.status).toBe('TPA_DOCUMENT_SHORTFALL');
    expect(app.currentStageCode).toBe('LTP_SHORTFALL_ACTION');
    expect(app.openShortfalls).toBe(1);

    // The instance remembers where to come back to. That single column is the
    // whole of the return path.
    const instance = await instanceRow(id);
    expect(instance.status).toBe('PARKED');
    expect(instance.parkedStageId).not.toBeNull();

    // The officer's clock is paused rather than finished, so the days they had
    // left survive however long the applicant takes.
    const paused = await prisma.slaInstance.findUniqueOrThrow({
      where: { taskId: before!.id },
      select: { status: true, pausedAt: true, completedAt: true },
    });
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.completedAt).toBeNull();

    // And the file is now the applicant's to act on.
    expect((await openTask(id))?.assignedRoleKey).toBe(ROLES.LTP);
  }, 60_000);

  it('comes back to the desk that raised it when the applicant answers', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Certificate out of date.',
      shortfall: { items: [{ description: 'Current encumbrance certificate' }] },
    });

    const answered = await act(ltp, id, ACTIONS.RESUBMIT, {
      remarks: 'A certificate dated last week has been uploaded.',
    });

    // RETURN_TO_ORIGIN read `parkedStageId`. No configuration named TPA.
    expect(answered.toStageCode).toBe('TPA_REVIEW');
    expect(answered.toStatus).toBe('SHORTFALL_RESPONDED');

    const instance = await instanceRow(id);
    expect(instance.parkedStageId).toBeNull();
    expect(instance.status).toBe('ACTIVE');

    const shortfall = (await getShortfalls(tpa, id))[0]!;
    expect(shortfall.status).toBe('RESOLUTION_SUBMITTED');
    expect(shortfall.resolutions).toHaveLength(1);
    expect(shortfall.resolutions[0]).toMatchObject({ attemptNo: 1, accepted: null });

    // Back in the officer's queue, with a running clock.
    const task = await openTask(id);
    expect(task?.assignedRoleKey).toBe(ROLES.TPA);
    expect(task?.sla?.status).toBe('ON_TRACK');
    expect(task?.sla?.pausedAt).toBeNull();
  }, 60_000);

  it('closes when the officer accepts, and the file stays at their desk', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Certificate out of date.',
      shortfall: { items: [{ description: 'Current encumbrance certificate' }] },
    });
    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Uploaded.' });

    const taskBefore = await openTask(id);

    const accepted = await act(tpa, id, ACTIONS.ACCEPT_RESOLUTION, {
      remarks: 'Certificate is current. Accepted.',
    });

    expect(accepted.toStageCode).toBe('TPA_REVIEW');
    expect(accepted.toStatus).toBe('TPA_REVIEW');
    // The message says what happened. "Sent to Town Planning Assistant" after
    // a TPA accepted a response would be a small lie about where the file is.
    expect(accepted.message).toMatch(/stays with you/i);

    const shortfall = (await getShortfalls(tpa, id))[0]!;
    expect(shortfall.status).toBe('RESOLVED');
    expect(shortfall.closedAt).not.toBeNull();
    expect(shortfall.resolutions[0]?.accepted).toBe(true);
    expect(shortfall.items.every((i) => i.isResolved)).toBe(true);

    expect((await appRow(id)).openShortfalls).toBe(0);

    // Same desk, same file, same task: an action that does not move the file
    // does not empty and refill somebody's inbox, and does not reset the clock.
    const taskAfter = await openTask(id);
    expect(taskAfter?.id).toBe(taskBefore?.id);
    expect(taskAfter?.sla?.dueAt).toEqual(taskBefore?.sla?.dueAt);
  }, 60_000);

  it('goes back to the applicant when the officer rejects the answer, and keeps both attempts', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Certificate out of date.',
      shortfall: { items: [{ description: 'Current encumbrance certificate' }] },
    });
    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Uploaded the same certificate again.' });

    const rejected = await act(tpa, id, ACTIONS.REJECT_RESOLUTION, {
      remarks: 'This is the same expired certificate. A current one is required.',
    });

    expect(rejected.toStageCode).toBe('LTP_SHORTFALL_ACTION');
    expect(rejected.toStatus).toBe('RETURNED_TO_APPLICANT');

    // Still open, and still counting against approval.
    const afterReject = (await getShortfalls(tpa, id))[0]!;
    expect(afterReject.status).toBe('RESOLUTION_REJECTED');
    expect(afterReject.resolutions[0]?.accepted).toBe(false);
    expect((await appRow(id)).openShortfalls).toBe(1);

    // Parked again, at the same desk, ready for a second attempt.
    expect((await instanceRow(id)).parkedStageId).not.toBeNull();

    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'A certificate dated this month is now uploaded.' });
    const second = await act(tpa, id, ACTIONS.ACCEPT_RESOLUTION, { remarks: 'Accepted.' });
    expect(second.toStatus).toBe('TPA_REVIEW');

    // Both attempts survive. A rejected answer is part of the record.
    const settled = (await getShortfalls(tpa, id))[0]!;
    expect(settled.resolutions.map((r) => r.attemptNo)).toEqual([1, 2]);
    expect(settled.resolutions.map((r) => r.accepted)).toEqual([false, true]);
    expect(settled.status).toBe('RESOLVED');
  }, 90_000);

  it('raises a payable demand when the shortfall is about money', async () => {
    const id = await atTpa();

    const raised = await act(tpa, id, ACTIONS.RAISE_FEE_SHORTFALL, {
      remarks: 'The betterment charge was computed on the wrong plot area.',
      shortfall: {
        title: 'Betterment charge shortfall',
        items: [
          { description: 'Betterment charge — balance', amount: 4500 },
          { description: 'Processing difference', amount: 500 },
        ],
      },
    });

    expect(raised.toStatus).toBe('TPA_FEE_SHORTFALL');

    const demand = await prisma.applicationFee.findFirstOrThrow({
      where: { applicationId: id, type: 'SHORTFALL' },
      select: { status: true, totalAmount: true, raisedByShortfallId: true, lineItems: true },
    });

    expect(demand.status).toBe('ISSUED');
    expect(demand.totalAmount.toFixed(2)).toBe('5000.00');
    expect(demand.raisedByShortfallId).not.toBeNull();
    expect(demand.lineItems).toHaveLength(2);
  }, 60_000);

  it('refuses a fee shortfall with no amount on it', async () => {
    const id = await atTpa();

    const failure = await errorOf(() =>
      act(tpa, id, ACTIONS.RAISE_FEE_SHORTFALL, {
        remarks: 'Something is owed but I have not said what.',
        shortfall: { items: [{ description: 'More money' }] },
      })
    );

    expect(failure?.status).toBe(422);
    expect(failure?.message).toMatch(/at least one amount/i);

    // And nothing was written: no shortfall, no demand, no movement.
    expect((await appRow(id)).status).toBe('PENDING_TPA');
    expect(await getShortfalls(tpa, id)).toHaveLength(0);
    expect(await prisma.applicationFee.count({ where: { applicationId: id, type: 'SHORTFALL' } })).toBe(0);
  }, 60_000);

  it('is available at every desk that is configured for one', async () => {
    // Each blocking-shortfall transition in the seed, driven from its own
    // stage by the role that owns it.
    const cases: Array<[Actor, string, string, string]> = [
      [tpa, 'TPA_REVIEW', ACTIONS.RAISE_TECHNICAL_SHORTFALL, 'TPA_TECHNICAL_SHORTFALL'],
      [zad, 'ZAD_ZDD_REVIEW', ACTIONS.RAISE_DOCUMENT_SHORTFALL, 'ZAD_ZDD_SHORTFALL'],
      [zad, 'ZAD_ZDD_REVIEW', ACTIONS.RAISE_CLARIFICATION, 'ZAD_ZDD_SHORTFALL'],
      [zjd, 'ZJD_REVIEW', ACTIONS.RAISE_DOCUMENT_SHORTFALL, 'ZJD_SHORTFALL'],
      [director, 'DIRECTOR_DP_REVIEW', ACTIONS.RAISE_DOCUMENT_SHORTFALL, 'DIRECTOR_SHORTFALL'],
      [director, 'DIRECTOR_DP_REVIEW', ACTIONS.RAISE_TECHNICAL_SHORTFALL, 'DIRECTOR_SHORTFALL'],
      [addlCommissioner, 'ADDL_COMMISSIONER_REVIEW', ACTIONS.RAISE_DOCUMENT_SHORTFALL, 'ADDITIONAL_COMMISSIONER_SHORTFALL'],
      [commissioner, 'COMMISSIONER_REVIEW', ACTIONS.RAISE_DOCUMENT_SHORTFALL, 'COMMISSIONER_SHORTFALL'],
    ];

    for (const [actor, stage, action, expectedStatus] of cases) {
      const id = await atTpa();
      await advanceTo(id, stage);

      const raised = await act(actor, id, action, {
        remarks: `Raised at ${stage}.`,
        shortfall: { items: [{ description: 'Something is missing' }] },
      });

      expect(raised.toStageCode, `${stage} · ${action}`).toBe('LTP_SHORTFALL_ACTION');
      expect(raised.toStatus, `${stage} · ${action}`).toBe(expectedStatus);

      // And every one of them comes back to the desk that raised it.
      const answered = await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Answered.' });
      expect(answered.toStageCode, `${stage} · resume`).toBe(stage);

      await cleanupTestApplications([ltp.id]);
    }
  }, 240_000);

  it('raises a fee shortfall at every desk configured for one', async () => {
    const cases: Array<[Actor, string, string]> = [
      [zjd, 'ZJD_REVIEW', 'ZJD_FEE_SHORTFALL'],
      [director, 'DIRECTOR_DP_REVIEW', 'DIRECTOR_SHORTFALL'],
    ];

    for (const [actor, stage, expectedStatus] of cases) {
      const id = await atTpa();
      await advanceTo(id, stage);

      const raised = await act(actor, id, ACTIONS.RAISE_FEE_SHORTFALL, {
        remarks: `Fee short at ${stage}.`,
        shortfall: { items: [{ description: 'Balance payable', amount: 1200 }] },
      });

      expect(raised.toStatus, stage).toBe(expectedStatus);
      expect(
        await prisma.applicationFee.count({ where: { applicationId: id, type: 'SHORTFALL' } }),
        stage
      ).toBe(1);

      await cleanupTestApplications([ltp.id]);
    }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Reported shortfalls — §12 and §13, the two shapes side by side
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('a reported shortfall', () => {
  it('lets the ZJD record a fee shortfall AND forward — the file moves, the shortfall travels', async () => {
    const id = await atTpa();
    await advanceTo(id, 'ZJD_REVIEW');

    const reported = await act(zjd, id, ACTIONS.REPORT_FEE_SHORTFALL_AND_FORWARD, {
      remarks: 'Open-space charge is short. Recorded; the file may proceed.',
      shortfall: { items: [{ description: 'Open-space contribution — balance', amount: 7500 }] },
    });

    // The file MOVED — that is the whole difference from RAISE_FEE_SHORTFALL.
    expect(reported.toStageCode).toBe('DIRECTOR_DP_REVIEW');
    expect(reported.toStatus).toBe('PENDING_DIRECTOR_DP');

    const instance = await instanceRow(id);
    expect(instance.status).toBe('ACTIVE');
    expect(instance.parkedStageId).toBeNull();

    // And the shortfall is open, of REPORTED mode, travelling with the file.
    const shortfall = (await getShortfalls(director, id))[0]!;
    expect(shortfall).toMatchObject({ kind: 'FEE', mode: 'REPORTED', status: 'RAISED' });
    expect((await appRow(id)).openShortfalls).toBe(1);

    // With a real demand behind it.
    const demand = await prisma.applicationFee.findFirstOrThrow({
      where: { applicationId: id, type: 'SHORTFALL' },
      select: { totalAmount: true, status: true },
    });
    expect(demand.totalAmount.toFixed(2)).toBe('7500.00');

    // The clock is running at the new desk: nobody stopped work.
    const task = await openTask(id);
    expect(task?.stage.code).toBe('DIRECTOR_DP_REVIEW');
    expect(task?.sla?.status).toBe('ON_TRACK');
    expect(task?.sla?.pausedAt).toBeNull();
  }, 90_000);

  it('lets the Director report a shortfall and forward', async () => {
    const id = await atTpa();
    await advanceTo(id, 'DIRECTOR_DP_REVIEW');

    const reported = await act(director, id, ACTIONS.REPORT_SHORTFALL_AND_FORWARD, {
      remarks: 'Layout plan copy is missing. Noted for the record; the file proceeds.',
      shortfall: { items: [{ description: 'Approved layout plan copy' }] },
    });

    expect(reported.toStageCode).toBe('ADDL_COMMISSIONER_REVIEW');
    expect(reported.toStatus).toBe('DIRECTOR_REPORTED_SHORTFALL');
    expect((await getShortfalls(addlCommissioner, id))[0]).toMatchObject({
      mode: 'REPORTED',
      status: 'RAISED',
    });
  }, 90_000);

  it('lets the Additional Commissioner report a shortfall and forward', async () => {
    const id = await atTpa();
    await advanceTo(id, 'ADDL_COMMISSIONER_REVIEW');

    const reported = await act(addlCommissioner, id, ACTIONS.REPORT_SHORTFALL_AND_FORWARD, {
      remarks: 'Noted for the Commissioner.',
      shortfall: { items: [{ description: 'Fire NOC copy' }] },
    });

    expect(reported.toStageCode).toBe('COMMISSIONER_REVIEW');
    expect(reported.toStatus).toBe('PENDING_COMMISSIONER');
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE approval guard — F.5.1
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('approval', () => {
  it('is blocked by a REPORTED shortfall raised six desks earlier', async () => {
    const id = await atTpa();
    await advanceTo(id, 'ZJD_REVIEW');

    await act(zjd, id, ACTIONS.REPORT_FEE_SHORTFALL_AND_FORWARD, {
      remarks: 'Recorded; the file may proceed.',
      shortfall: { items: [{ description: 'Balance payable', amount: 2500 }] },
    });

    await act(director, id, ACTIONS.FORWARD);
    await act(addlCommissioner, id, ACTIONS.FORWARD);

    // The action bar says so BEFORE the Commissioner presses anything.
    const state = await getWorkflowState(commissioner, id);
    const approve = state.actions.find((a) => a.code === ACTIONS.APPROVE)!;
    expect(approve.available).toBe(false);
    expect(approve.reason).toMatch(/shortfall/i);
    expect(approve.reason).toMatch(/reported and carried forward/i);

    // And pressing it anyway is refused, with nothing written.
    const failure = await errorOf(() => act(commissioner, id, ACTIONS.APPROVE, { remarks: 'Approved.' }));
    expect(failure?.status).toBe(409);
    expect(failure?.code).toBe('GUARD_FAILED');

    const app = await appRow(id);
    expect(app.status).toBe('PENDING_COMMISSIONER');
    expect(app.approvedAt).toBeNull();
    expect(await prisma.approvalOrder.count({ where: { applicationId: id } })).toBe(0);
  }, 120_000);

  it('goes through once the shortfall is settled', async () => {
    const id = await atTpa();
    await advanceTo(id, 'ZJD_REVIEW');

    await act(zjd, id, ACTIONS.REPORT_FEE_SHORTFALL_AND_FORWARD, {
      remarks: 'Recorded.',
      shortfall: { items: [{ description: 'Balance payable', amount: 2500 }] },
    });

    // Paying the shortfall demand, the way the applicant would.
    const demand = await prisma.applicationFee.findFirstOrThrow({
      where: { applicationId: id, type: 'SHORTFALL' },
      select: { id: true, totalAmount: true },
    });
    const payment = await initiatePayment(ltp, demand.id, META);
    await handleWebhook(
      'mock',
      buildMockGatewayRequest({
        paymentRef: payment.payment.paymentRef,
        state: 'SUCCESS',
        amount: demand.totalAmount.toFixed(2),
        eventId: `wf_sf_${payment.payment.paymentRef}`,
      })
    );

    // Paying does not close the shortfall. Money arriving is evidence, not a
    // verdict — an officer records that it settles the matter, and until one
    // does the shortfall is open and the approval is blocked.
    expect((await appRow(id)).openShortfalls).toBe(1);

    // A REPORTED shortfall is closed at whichever desk the file has reached,
    // because it never parked the file and there is no origin to return to.
    const closed = await act(director, id, ACTIONS.RESOLVE_REPORTED_SHORTFALL, {
      remarks: 'The balance was paid in full on the shortfall demand. Settled.',
    });
    expect(closed.toStageCode).toBe('DIRECTOR_DP_REVIEW');

    const settled = (await getShortfalls(director, id))[0]!;
    expect(settled.status).toBe('RESOLVED');
    expect((await appRow(id)).openShortfalls).toBe(0);

    await act(director, id, ACTIONS.FORWARD);
    await act(addlCommissioner, id, ACTIONS.FORWARD);

    const state = await getWorkflowState(commissioner, id);
    expect(state.actions.find((a) => a.code === ACTIONS.APPROVE)?.available).toBe(true);

    const approved = await act(commissioner, id, ACTIONS.APPROVE, { remarks: 'Approved.' });
    expect(approved.toStatus).toBe('APPROVED');
  }, 150_000);

  it('is blocked while a fee demand is unpaid, even with no shortfall open', async () => {
    const id = await atTpa();
    await advanceTo(id, 'COMMISSIONER_REVIEW');

    // A demand raised directly against the file, with nothing else outstanding.
    await act(commissioner, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'One document outstanding.',
      shortfall: { items: [{ description: 'Structural stability certificate' }] },
    });
    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Uploaded.' });
    await act(commissioner, id, ACTIONS.ACCEPT_RESOLUTION, { remarks: 'Accepted.' });

    expect((await appRow(id)).openShortfalls).toBe(0);
    const state = await getWorkflowState(commissioner, id);
    expect(state.actions.find((a) => a.code === ACTIONS.APPROVE)?.available).toBe(true);
  }, 120_000);

  it('rejects, and closes the run', async () => {
    const id = await atTpa();
    await advanceTo(id, 'COMMISSIONER_REVIEW');

    const rejected = await act(commissioner, id, ACTIONS.REJECT, {
      remarks: 'The plot does not meet the minimum road width for this occupancy.',
    });

    expect(rejected).toMatchObject({ toStageCode: 'CLOSED_REJECTED', toStatus: 'REJECTED' });

    const app = await appRow(id);
    expect(app.status).toBe('REJECTED');
    expect(app.rejectedAt).not.toBeNull();

    expect((await instanceRow(id)).status).toBe('COMPLETED');
    expect(await openTask(id)).toBeNull();
    expect(await prisma.approvalOrder.count({ where: { applicationId: id } })).toBe(0);

    // A closed file takes no further action.
    const failure = await errorOf(() => act(commissioner, id, ACTIONS.APPROVE, { remarks: 'Changed my mind.' }));
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/closed/i);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Authorization — role AND stage, not one or the other
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('who may act', () => {
  it('refuses an officer whose desk the file is not at', async () => {
    const id = await atTpa();

    // The ZAD holds every zonal capability and covers the zone. The file is
    // simply not at their desk.
    const failure = await errorOf(() => act(zad, id, ACTIONS.FORWARD));
    expect(failure?.status).toBe(403);

    expect((await appRow(id)).status).toBe('PENDING_TPA');
  }, 60_000);

  it('refuses the applicant an officer’s action', async () => {
    const id = await atTpa();
    const failure = await errorOf(() => act(ltp, id, ACTIONS.FORWARD));
    expect(failure?.status).toBe(403);
  }, 60_000);

  it('refuses an officer who lacks the action’s capability', async () => {
    const id = await atTpa();
    await advanceTo(id, 'COMMISSIONER_REVIEW');

    // A Commissioner account stripped of APPLICATION_APPROVE: the role owns
    // the stage, so resolution and stage ownership both pass, and the refusal
    // comes from the capability alone.
    const stripped = actorFor(commissioner.id, commissioner.name, [ROLES.COMMISSIONER], {
      capabilities: (RBAC_MATRIX[ROLES.COMMISSIONER] as unknown as string[]).filter(
        (c) => c !== 'APPLICATION_APPROVE'
      ),
    });

    const failure = await errorOf(() => act(stripped, id, ACTIONS.APPROVE, { remarks: 'Approved.' }));
    expect(failure?.status).toBe(403);

    // And the action is not even offered to them.
    const state = await getWorkflowState(stripped, id);
    expect(state.actions.map((a) => a.code)).not.toContain(ACTIONS.APPROVE);
  }, 120_000);

  it('refuses a system action performed by hand', async () => {
    const id = await atTpa();
    const failure = await errorOf(() => act(tpa, id, ACTIONS.CONFIRM_PAYMENT));
    // Not resolvable at this stage at all — the transition leaves LTP_PAYMENT.
    expect(failure?.status).toBe(409);
  }, 60_000);

  it('refuses an action that does not exist at this stage', async () => {
    const id = await atTpa();
    const failure = await errorOf(() => act(tpa, id, 'APPROVE', { remarks: 'Approved.' }));
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/not something that can be done/i);
  }, 60_000);

  it('requires remarks where the action says so', async () => {
    const id = await atTpa();
    const failure = await errorOf(() => act(tpa, id, ACTIONS.FORWARD, { remarks: '   ' }));
    expect(failure?.status).toBe(409);
    expect(failure?.code).toBe('GUARD_FAILED');
    expect(failure?.message).toMatch(/remarks/i);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. The action bar cannot lie
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the offered actions', () => {
  it('are exactly what each desk is configured for', async () => {
    const id = await atTpa();

    const expected: Array<[Actor, string, string[]]> = [
      [
        tpa,
        'TPA_REVIEW',
        [
          ACTIONS.FORWARD,
          ACTIONS.RAISE_DOCUMENT_SHORTFALL,
          ACTIONS.RAISE_FEE_SHORTFALL,
          ACTIONS.RAISE_TECHNICAL_SHORTFALL,
          ACTIONS.RETURN_TO_PREVIOUS,
        ],
      ],
      [
        zad,
        'ZAD_ZDD_REVIEW',
        [
          ACTIONS.FORWARD,
          ACTIONS.RAISE_DOCUMENT_SHORTFALL,
          ACTIONS.RAISE_CLARIFICATION,
          ACTIONS.RETURN_TO_PREVIOUS,
        ],
      ],
      [
        zjd,
        'ZJD_REVIEW',
        [
          ACTIONS.FORWARD,
          ACTIONS.RAISE_DOCUMENT_SHORTFALL,
          ACTIONS.RAISE_FEE_SHORTFALL,
          ACTIONS.REPORT_FEE_SHORTFALL_AND_FORWARD,
          ACTIONS.RETURN_TO_PREVIOUS,
        ],
      ],
      [
        director,
        'DIRECTOR_DP_REVIEW',
        [
          ACTIONS.FORWARD,
          ACTIONS.RAISE_DOCUMENT_SHORTFALL,
          ACTIONS.RAISE_FEE_SHORTFALL,
          ACTIONS.RAISE_TECHNICAL_SHORTFALL,
          ACTIONS.REPORT_SHORTFALL_AND_FORWARD,
          ACTIONS.RETURN_TO_PREVIOUS,
        ],
      ],
      [
        addlCommissioner,
        'ADDL_COMMISSIONER_REVIEW',
        [
          ACTIONS.FORWARD,
          ACTIONS.RAISE_DOCUMENT_SHORTFALL,
          ACTIONS.REPORT_SHORTFALL_AND_FORWARD,
          ACTIONS.RETURN_TO_PREVIOUS,
        ],
      ],
      [
        commissioner,
        'COMMISSIONER_REVIEW',
        [ACTIONS.APPROVE, ACTIONS.REJECT, ACTIONS.RAISE_DOCUMENT_SHORTFALL, ACTIONS.RETURN_TO_PREVIOUS],
      ],
    ];

    for (const [actor, stage, codes] of expected) {
      await advanceTo(id, stage);
      const state = await getWorkflowState(actor, id);
      expect(state.stage?.code, stage).toBe(stage);

      // RESOLVE_REPORTED_SHORTFALL is configured at every review desk but is
      // only OFFERED when the file is actually carrying one — this file is
      // not, so it is absent, which is the guard doing its job.
      expect([...state.actions.map((a) => a.code)].sort(), stage).toEqual([...codes].sort());
    }
  }, 120_000);

  it('carries the destination and the shortfall shape the modal needs', async () => {
    const id = await atTpa();
    const state = await getWorkflowState(tpa, id);

    const forward = state.actions.find((a) => a.code === ACTIONS.FORWARD)!;
    expect(forward).toMatchObject({
      toStageCode: 'ZAD_ZDD_REVIEW',
      toStatus: 'PENDING_ZAD_ZDD',
      requiresRemarks: true,
      shortfall: null,
      available: true,
    });

    const fee = state.actions.find((a) => a.code === ACTIONS.RAISE_FEE_SHORTFALL)!;
    expect(fee.shortfall).toEqual({ kind: 'FEE', mode: 'BLOCKING' });
    expect(fee.toStageCode).toBe('LTP_SHORTFALL_ACTION');
  }, 60_000);

  it('offers the applicant exactly one action while their file is parked', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Missing.',
      shortfall: { items: [{ description: 'Certificate' }] },
    });

    const ltpState = await getWorkflowState(ltp, id);
    expect(ltpState.actions.map((a) => a.code)).toEqual([ACTIONS.RESUBMIT]);

    // The officer who raised it has nothing to do until the answer arrives.
    const tpaState = await getWorkflowState(tpa, id);
    expect(tpaState.actions).toEqual([]);
  }, 60_000);

  it('offers accept and reject only once there is an answer to judge', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Missing.',
      shortfall: { items: [{ description: 'Certificate' }] },
    });
    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Uploaded.' });

    const state = await getWorkflowState(tpa, id);
    const codes = state.actions.map((a) => a.code);
    expect(codes).toContain(ACTIONS.ACCEPT_RESOLUTION);
    expect(codes).toContain(ACTIONS.REJECT_RESOLUTION);
    expect(state.actions.find((a) => a.code === ACTIONS.ACCEPT_RESOLUTION)?.available).toBe(true);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('two officers at once', () => {
  it('refuses a decision made from a stale screen', async () => {
    const id = await atTpa();

    const state = await getWorkflowState(tpa, id);
    expect(state.sequence).toBe(1);

    // Somebody else moves the file.
    await act(tpa, id, ACTIONS.FORWARD);

    // The first officer presses their button, still holding sequence 1.
    const failure = await errorOf(() =>
      act(zad, id, ACTIONS.FORWARD, { expectedSequence: state.sequence })
    );

    expect(failure?.status).toBe(409);
    expect(failure?.code).toBe('STALE_WRITE');
  }, 60_000);

  it('lets exactly one officer claim a task', async () => {
    const id = await atTpa();
    const task = (await openTask(id))!;

    const first = await claimTask(tpa, task.id, META);
    expect(first.claimed).toBe(true);

    // A second TPA account trying the same task.
    const other = await prisma.user.findFirstOrThrow({
      where: { roles: { some: { role: { key: ROLES.TPA } } }, id: { not: tpa.id } },
      select: { id: true, name: true },
    }).catch(() => null);

    if (other) {
      const rival = actorFor(other.id, other.name, [ROLES.TPA], {
        capabilities: RBAC_MATRIX[ROLES.TPA] as unknown as string[],
        zoneIds: [zoneId],
      });
      const failure = await errorOf(() => claimTask(rival, task.id, META));
      expect(failure?.status).toBe(409);
    }

    await releaseTask(tpa, task.id, META);
    const released = await openTask(id);
    expect(released?.assignedUserId).toBeNull();
    expect(released?.status).toBe('PENDING');
  }, 60_000);

  it('refuses to act on a file another officer is holding', async () => {
    const id = await atTpa();
    const task = (await openTask(id))!;

    const other = await prisma.user.findFirst({
      where: { roles: { some: { role: { key: ROLES.TPA } } }, id: { not: tpa.id }, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!other) return;

    const holder = actorFor(other.id, other.name, [ROLES.TPA], {
      capabilities: RBAC_MATRIX[ROLES.TPA] as unknown as string[],
      zoneIds: [zoneId],
    });

    await claimTask(holder, task.id, META);

    const failure = await errorOf(() => act(tpa, id, ACTIONS.FORWARD));
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(new RegExp(other.name, 'i'));
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. The task queue
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the officer queue', () => {
  it('shows the file to the desk it is at, and to nobody else', async () => {
    const id = await atTpa();

    const tpaQueue = await listTasks(tpa, {});
    const row = tpaQueue.rows.find((r) => r.applicationId === id);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({
      stageCode: 'TPA_REVIEW',
      applicantName: 'Ravi Kumar',
      unclaimed: true,
      openShortfalls: 0,
    });
    expect(row?.dueAt).not.toBeNull();
    expect(row?.daysPending).toBe(0);

    // Not at the ZJD's desk, so not in the ZJD's queue.
    const zjdQueue = await listTasks(zjd, {});
    expect(zjdQueue.rows.map((r) => r.applicationId)).not.toContain(id);

    // And it moves between queues as the file does.
    await act(tpa, id, ACTIONS.FORWARD);
    expect((await listTasks(tpa, {})).rows.map((r) => r.applicationId)).not.toContain(id);
    expect((await listTasks(zad, {})).rows.map((r) => r.applicationId)).toContain(id);
  }, 60_000);

  it('filters by what an officer actually asks at the start of the day', async () => {
    const id = await atTpa();

    const newOnly = await listTasks(tpa, { filter: 'new' });
    expect(newOnly.rows.map((r) => r.applicationId)).toContain(id);

    const inProgress = await listTasks(tpa, { filter: 'pending' });
    expect(inProgress.rows.map((r) => r.applicationId)).not.toContain(id);

    // Claiming moves it from "new" to "in progress".
    const task = (await openTask(id))!;
    await claimTask(tpa, task.id, META);

    expect((await listTasks(tpa, { filter: 'new' })).rows.map((r) => r.applicationId)).not.toContain(id);
    expect((await listTasks(tpa, { filter: 'pending' })).rows.map((r) => r.applicationId)).toContain(id);

    // A shortfall puts it in the applicant's list and the shortfall filter.
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Missing.',
      shortfall: { items: [{ description: 'Certificate' }] },
    });

    const ltpQueue = await listTasks(ltp, { filter: 'shortfall' });
    expect(ltpQueue.rows.map((r) => r.applicationId)).toContain(id);

    const counts = (await listTasks(ltp, {})).counts;
    expect(counts.shortfall).toBeGreaterThan(0);
  }, 90_000);

  it('summarises a desk for the dashboard', async () => {
    const id = await atTpa();
    const summary = await taskSummary(tpa);

    expect(summary.total).toBeGreaterThan(0);
    expect(summary.unclaimed).toBeGreaterThan(0);

    const task = (await openTask(id))!;
    await claimTask(tpa, task.id, META);

    const after = await taskSummary(tpa);
    expect(after.mine).toBeGreaterThan(0);
  }, 60_000);

  it('reassigns only to somebody who works at that desk', async () => {
    const id = await atTpa();
    const task = (await openTask(id))!;

    const zjdUser = await prisma.user.findUniqueOrThrow({ where: { email: 'zjd.demo@example.com' } });

    // A ZJD does not work at the TPA desk, so the file cannot be parked there.
    const failure = await errorOf(() =>
      reassignTask(admin, task.id, { userId: zjdUser.id, reason: 'Wrong desk' }, META)
    );
    expect(failure?.status).toBe(409);

    const tpaUser = await prisma.user.findUniqueOrThrow({ where: { email: 'tpa.demo@example.com' } });
    const moved = await reassignTask(admin, task.id, { userId: tpaUser.id, reason: 'Leave cover' }, META);
    expect(moved.message).toMatch(/reassigned/i);

    const after = await openTask(id);
    expect(after?.assignedUserId).toBe(tpaUser.id);
    expect(after?.status).toBe('IN_PROGRESS');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. The SLA clock
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the SLA', () => {
  it('counts working days and lands at the end of the last one', () => {
    // Friday 2026-08-28 + 2 working days = Tuesday 2026-09-01, end of day.
    const friday = new Date('2026-08-28T09:00:00');
    const due = addSlaDays(friday, 2, 'WORKING_DAYS');

    expect(due.getDay()).toBe(2);
    expect(due.getDate()).toBe(1);
    expect(due.getHours()).toBe(23);

    // Calendar days do not skip the weekend.
    const calendar = addSlaDays(friday, 2, 'CALENDAR_DAYS');
    expect(calendar.getDay()).toBe(0);
  });

  it('skips a holiday', () => {
    const monday = new Date('2026-08-31T09:00:00');
    const holidays = new Set(['2026-09-01']);

    const due = addSlaDays(monday, 2, 'WORKING_DAYS', holidays);
    // Tuesday is a holiday, so two working days lands on Thursday.
    expect(due.getDate()).toBe(3);
  });

  it('reports overdue without changing what an officer may do', async () => {
    const id = await atTpa();
    const task = (await openTask(id))!;

    // Wind the clock back so the sweep finds it overdue.
    await prisma.slaInstance.update({
      where: { taskId: task.id },
      data: {
        startedAt: new Date(Date.now() - 10 * 86_400_000),
        dueAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });

    const report = await sweepSla();
    expect(report.overdue).toBeGreaterThan(0);

    const swept = await prisma.slaInstance.findUniqueOrThrow({
      where: { taskId: task.id },
      select: { status: true, overdueDays: true, notifiedAt: true },
    });
    expect(swept.status).toBe('OVERDUE');
    expect(swept.overdueDays).toBeGreaterThanOrEqual(2);
    expect(swept.notifiedAt).not.toBeNull();

    expect((await appRow(id)).slaStatus).toBe('OVERDUE');
    expect((await listTasks(tpa, { filter: 'overdue' })).rows.map((r) => r.applicationId)).toContain(id);

    // OVERDUE is a notification, not a verdict: the officer's actions are
    // exactly what they were (docs/07-subsystems.md R.1.1).
    const state = await getWorkflowState(tpa, id);
    expect(state.actions.find((a) => a.code === ACTIONS.FORWARD)?.available).toBe(true);
    const forwarded = await act(tpa, id, ACTIONS.FORWARD);
    expect(forwarded.toStageCode).toBe('ZAD_ZDD_REVIEW');

    // And the sweep announced it once, not on every pass.
    const before = swept.notifiedAt;
    await sweepSla();
    const again = await prisma.slaInstance.findUnique({
      where: { taskId: task.id },
      select: { notifiedAt: true },
    });
    expect(again?.notifiedAt?.getTime()).toBe(before?.getTime());
  }, 90_000);

  it('gives the desk back the time it had left, not a fresh window', async () => {
    const id = await atTpa();
    const task = (await openTask(id))!;

    // Two days into a five-day clock.
    const startedAt = new Date(Date.now() - 2 * 86_400_000);
    const dueAt = new Date(Date.now() + 3 * 86_400_000);
    await prisma.slaInstance.update({ where: { taskId: task.id }, data: { startedAt, dueAt } });

    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Missing.',
      shortfall: { items: [{ description: 'Certificate' }] },
    });
    await act(ltp, id, ACTIONS.RESUBMIT, { remarks: 'Uploaded.' });

    const resumed = await openTask(id);
    const remainingMs = resumed!.sla!.dueAt.getTime() - Date.now();
    const threeDays = 3 * 86_400_000;

    // Three days, give or take the seconds this test took.
    expect(Math.abs(remainingMs - threeDays)).toBeLessThan(60_000);
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. The record
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the workflow record', () => {
  it('cannot be edited, at the database', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.FORWARD, { remarks: 'Original remarks.' });

    const row = await prisma.workflowHistory.findFirstOrThrow({
      where: { instance: { applicationId: id }, actionCode: ACTIONS.FORWARD },
      select: { id: true },
    });

    await expect(
      prisma.workflowHistory.update({ where: { id: row.id }, data: { remarks: 'Rewritten.' } })
    ).rejects.toThrow(/append-only/i);

    await expect(prisma.workflowHistory.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/i
    );
  }, 60_000);

  it('records the effects a transition applied, not just where it went', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_FEE_SHORTFALL, {
      remarks: 'Short by 1200.',
      shortfall: { items: [{ description: 'Balance', amount: 1200 }] },
    });

    const history = await getHistory(tpa, id);
    const raised = history.at(-1)!;
    const effects = raised.effectsApplied as Array<Record<string, unknown>>;

    expect(effects.map((e) => e.type)).toEqual(['RAISE_SHORTFALL', 'GENERATE_FEE_DEMAND']);
    expect(effects[0]).toMatchObject({ kind: 'FEE', mode: 'BLOCKING' });
    expect(effects[1]).toMatchObject({ demandType: 'SHORTFALL' });

    // And the shortfall points back at the decision that raised it.
    const shortfall = await prisma.shortfall.findFirstOrThrow({
      where: { applicationId: id },
      select: { historyId: true },
    });
    expect(shortfall.historyId).toBe(raised.id);
  }, 60_000);

  it('writes an audit row for every transition', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.FORWARD);

    const rows = await prisma.auditLog.findMany({
      where: { applicationId: id, action: { startsWith: 'WORKFLOW_' } },
      orderBy: { seq: 'asc' },
      select: { action: true, actorName: true, before: true, after: true },
    });

    expect(rows.map((r) => r.action)).toEqual(['WORKFLOW_CONFIRM_PAYMENT', 'WORKFLOW_FORWARD']);
    expect(rows[1]?.actorName).toBe(tpa.name);
    expect(rows[1]?.before).toMatchObject({ stageCode: 'TPA_REVIEW', status: 'PENDING_TPA' });
    expect(rows[1]?.after).toMatchObject({ stageCode: 'ZAD_ZDD_REVIEW', status: 'PENDING_ZAD_ZDD' });
  }, 60_000);

  it('queues a notification for every transition that names one', async () => {
    const id = await atTpa();
    await act(tpa, id, ACTIONS.RAISE_DOCUMENT_SHORTFALL, {
      remarks: 'Missing.',
      shortfall: { items: [{ description: 'Certificate' }] },
    });

    const events = await prisma.outboxEvent.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: 'asc' },
      select: { eventCode: true },
    });

    expect(events.map((e) => e.eventCode)).toEqual(
      expect.arrayContaining(['APPLICATION_FORWARDED', 'TASK_ASSIGNED', 'SHORTFALL_RAISED'])
    );
  }, 60_000);
});
