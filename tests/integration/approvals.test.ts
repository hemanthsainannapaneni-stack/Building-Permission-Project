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
import { performAction } from '@/server/workflow/engine';
import { advanceOrder, getApprovalOrder } from '@/server/services/approval-orders';
import { renderApprovalOrder, storeApprovalOrderPdf } from '@/server/services/approval-order-pdf';
import { findPublicRecord, PUBLIC_STATUS } from '@/server/services/public-verification';
import { approvalSummary } from '@/server/services/analytics';
import { dispatchOutbox } from '@/server/notifications/dispatcher';
import { EVENTS } from '@/server/events/outbox';
import { ORDER_STATUS } from '@/lib/approval-orders';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES, type RoleKey } from '@/lib/constants';
import { ACTIONS } from '@/lib/workflow';
import { DOCUMENT_REQUIREMENTS } from '../../prisma/seed/07-documents';

/**
 * Phase 3 — approval, the permission order, notification and public verification.
 *
 * ── The chain this suite exists to prove ─────────────────────────────────
 *
 *   APPROVE  →  order drafted  →  rendered  →  approved  →  issued
 *                                                   │
 *                                    notification ──┴──  public verification
 *
 * Every link is driven through the real services. Nothing is inserted, and no
 * status is written by hand except in the one test that deliberately corrupts
 * a row to check a guard catches it.
 *
 * ── And the two properties that are really about safety ──────────────────
 *
 *   · An order NEVER runs ahead of its approval, and never reaches ISSUED
 *     without passing through a person's decision.
 *   · Public verification returns a whitelist. The test asserts what is
 *     ABSENT as hard as what is present, because a leak here reaches
 *     somebody with no account at all.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

const MANDATORY_DOCS = DOCUMENT_REQUIREMENTS.filter(
  (rule) => rule.isMandatory && rule.applicationTypeCode === null && !rule.condition
).map((rule) => rule.documentTypeCode);

const NEEDS_EXPIRY = new Set(['ENCUMBRANCE_CERTIFICATE', 'LTP_LICENCE_COPY']);

type Actor = ReturnType<typeof actorFor>;

let admin: Actor;
let ltp: Actor;
let approver: Actor;
let typeId: string;
let zoneId: string;

async function officer(email: string, role: RoleKey, zones: string[] = []): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return actorFor(user.id, user.name, [role], {
    capabilities: RBAC_MATRIX[role] as unknown as string[],
    zoneIds: zones,
  });
}

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN], {
    capabilities: RBAC_MATRIX[ROLES.SYSTEM_ADMIN] as unknown as string[],
  });

  typeId = (await prisma.applicationType.findFirstOrThrow({
    where: { code: 'RESIDENTIAL_BUILDING' },
  })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;

  const created = await createUser(
    {
      email: 'test-bpo-ltp@example.com',
      name: 'Test BPO LTP',
      phone: '9876500021',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-BPO-1',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'BPO Firm',
    },
    admin,
    META
  );

  ltp = actorFor(created.user.id, created.user.name, [ROLES.LTP], {
    capabilities: RBAC_MATRIX[ROLES.LTP] as unknown as string[],
  });

  // The ZJD is the apex desk of BBAS_STANDARD and owns the only APPROVE
  // transition in it. The demo administrator is seeded with every role, which
  // is what lets one actor walk the whole chain — TPA forward, Planning
  // Officer forward, ZDD forward, ZJD approve — without the test having to
  // know which desks the chain visits.
  approver = await officer('admin.demo@example.com', ROLES.SYSTEM_ADMIN, [zoneId]);

  const everyRole = await prisma.role.findMany({ select: { key: true } });
  const everyCapability = [
    ...new Set(everyRole.flatMap((r) => (RBAC_MATRIX[r.key as RoleKey] as unknown as string[]) ?? [])),
  ];

  approver = actorFor(approver.id, approver.name, everyRole.map((r) => r.key) as RoleKey[], {
    capabilities: everyCapability,
    zoneIds: [zoneId],
  });
}, 120_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny({ passFromVersion: 1 });
  await configureMockGateway({ mode: 'MANUAL' });

  // ── Each test starts with an empty outbox and no recent deliveries ────
  //
  // Two reasons, both of which produced a test that failed for the wrong
  // reason before this was added:
  //
  //   · `dispatchOutbox` claims the OLDEST events first, so a backlog from an
  //     earlier test is dispatched instead of the event under test.
  //   · The dispatcher de-duplicates on event + channel + recipient within
  //     sixty seconds, WITHOUT regard to the application. Two tests issuing an
  //     order to the same LTP inside a minute means the second is correctly
  //     suppressed — correct in production, and indistinguishable here from
  //     "the applicant was never told".
  //
  // Outbox rows also survive the deletion of their application (the column
  // carries no foreign key), so clearing them is the only way to be sure.
  await prisma.outboxEvent.deleteMany({});
  await prisma.notificationLog.deleteMany({});
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
 * Drains the outbox completely.
 *
 * `dispatchOutbox` claims the OLDEST batch first, and the fixture generates a
 * couple of dozen events before the one a test cares about. A single call with
 * a fixed batch size therefore dispatches the backlog and stops short of the
 * event under test — which fails as "the applicant was not told" and means
 * nothing of the sort.
 */
async function drainOutbox(maxPasses = 20): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const pending = await prisma.outboxEvent.count({ where: { processed: false } });
    if (pending === 0) return;
    await dispatchOutbox(100);
  }
}

/** A paid application sitting at the first departmental desk. */
async function atDesk() {
  const app = await createApplication(ltp, { applicationTypeId: typeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Anita Rao', phone: '9876543210', address: '4 Lake Road, Hyderabad', fatherName: '', email: 'anita@example.com', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Jubilee Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 45', doorNo: '8-2-120', pincode: '500033', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '221/B', plotNo: '14', plotAreaSqm: 400, roadWidthM: 12, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    ['development', { buildingUse: 'DWELLING', occupancyType: 'A_RESIDENTIAL', buildingSubUse: '', structureType: 'RCC', numFloors: 3, numBasements: 0, numDwellingUnits: 2, buildingHeightM: 11 }],
    ['building', { plotAreaSqm: 400, builtUpAreaSqm: 700, floorAreaSqm: 600, coverageAreaSqm: 200, parkingAreaSqm: 60, setbackFrontM: 3, setbackRearM: 2, setbackLeftM: 1.5, setbackRightM: 1.5 }],
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

  for (const code of MANDATORY_DOCS) {
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
      eventId: `bpo_${started.payment.paymentRef}`,
    })
  );

  return submitted.id;
}

/**
 * Walks a paid file to APPROVED, whatever chain it is on.
 *
 * Forwards until an APPROVE transition is available rather than naming desks:
 * the workflow is configuration, and a test that listed its stages would break
 * every time somebody edited the chain — which is exactly what Phase 1 did.
 */
async function approve(applicationId: string): Promise<boolean> {
  for (let hop = 0; hop < 10; hop += 1) {
    const app = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, workflowInstance: { select: { currentStageId: true } } },
    });

    if (app.status === 'APPROVED') return true;

    const stageId = app.workflowInstance?.currentStageId;
    if (!stageId) return false;

    const canApprove = await prisma.workflowTransition.count({
      where: { fromStageId: stageId, isActive: true, action: { code: ACTIONS.APPROVE } },
    });

    try {
      await performAction(
        approver,
        applicationId,
        canApprove > 0 ? ACTIONS.APPROVE : ACTIONS.FORWARD,
        { remarks: canApprove > 0 ? 'Sanctioned.' : 'Checked and in order.' },
        META
      );
    } catch {
      return false;
    }

    await drainJobs();
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Approval → order
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('approving an application', () => {
  it('drafts an order, renders it and stops short of issuing', async () => {
    const id = await atDesk();
    const approved = await approve(id);
    expect(approved, 'the fixture could not reach an approving desk').toBe(true);

    const order = await getApprovalOrder(approver, id);
    expect(order).not.toBeNull();
    expect(order!.orderNumber).toMatch(/^BPO\/\d{4}\/\d{5}$/);

    // THE property. The job renders and generates; it does not issue. Telling
    // an applicant their permission is ready before a person has looked at it
    // is what this lifecycle exists to prevent.
    expect(order!.status).toBe(ORDER_STATUS.GENERATED);
    expect(order!.hasDocument).toBe(true);
    expect(order!.verificationCode).toHaveLength(32);
    expect(order!.conditions.length).toBeGreaterThan(0);
    expect(order!.validUntil).not.toBeNull();
  }, 240_000);

  it('freezes the building particulars into the snapshot', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    const derived = order!.derived as Record<string, number | null>;

    // 600 floor area over a 400 sq m plot.
    expect(derived.fsi).toBeCloseTo(1.5, 2);
    // 200 covered of 400.
    expect(derived.coveragePercent).toBeCloseTo(50, 2);
    expect(derived.netPlotAreaSqm).toBeCloseTo(400, 2);

    const building = order!.building as Record<string, unknown>;
    expect(Number(building.numFloors)).toBe(3);
    expect(Number(building.buildingHeightM)).toBe(11);
    expect(Number(building.parkingAreaSqm)).toBe(60);
  }, 240_000);

  it('renders a PDF carrying the particulars and the conditions', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    const rendered = await renderApprovalOrder(order!.id);

    expect(rendered.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(rendered.bytes.byteLength).toBeGreaterThan(2000);
    expect(rendered.filename).toMatch(/^building-permission-BPO-\d{4}-\d{5}\.pdf$/);
    expect(rendered.model.snapshot.conditions?.length).toBeGreaterThan(0);
    // Not yet issued, so it must print as provisional.
    expect(rendered.model.isProvisional).toBe(true);
  }, 240_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the order lifecycle', () => {
  it('runs generated → approved → issued, and refuses the shortcut', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);

    // Straight to ISSUED is refused. The signing decision cannot be skipped.
    await expect(
      advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver })
    ).rejects.toThrow();

    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });
    const approvedState = await getApprovalOrder(approver, id);
    expect(approvedState!.status).toBe(ORDER_STATUS.APPROVED);

    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver });
    const issued = await getApprovalOrder(approver, id);
    expect(issued!.status).toBe(ORDER_STATUS.ISSUED);

    // Terminal. An issued order is revoked, never rolled back.
    await expect(
      advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver })
    ).rejects.toThrow();
  }, 240_000);

  it('refuses to issue an order with no rendered document', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });

    // Remove the artefact behind the row, as a storage wipe would.
    await prisma.approvalOrder.update({ where: { id: order!.id }, data: { storageKey: '' } });

    await expect(
      advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver })
    ).rejects.toThrow(/no rendered document/i);
  }, 240_000);

  it('refuses to move an order whose application is no longer approved', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);

    // An order must never outlive the approval it evidences.
    await prisma.application.update({ where: { id }, data: { status: 'REJECTED' } });

    await expect(
      advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver })
    ).rejects.toThrow(/not APPROVED/i);

    await prisma.application.update({ where: { id }, data: { status: 'APPROVED' } });
  }, 240_000);

  it('records every move in the audit trail', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver });

    const trail = await prisma.auditLog.findMany({
      where: { entityType: 'ApprovalOrder', entityId: order!.id },
      orderBy: { seq: 'asc' },
      select: { action: true },
    });

    const actions = trail.map((r) => r.action);
    expect(actions).toContain('APPROVAL_ORDER_DRAFTED');
    expect(actions).toContain('APPROVAL_ORDER_GENERATED');
    expect(actions).toContain('APPROVAL_ORDER_APPROVED');
    expect(actions).toContain('APPROVAL_ORDER_ISSUED');
  }, 240_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Notification
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('issuing notifies the applicant', () => {
  it('emits ORDER_ISSUED only on issue, and delivers it', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);

    // Nothing announced yet: the order exists and is not released.
    expect(
      await prisma.outboxEvent.count({ where: { applicationId: id, eventCode: EVENTS.ORDER_ISSUED } })
    ).toBe(0);

    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver });

    expect(
      await prisma.outboxEvent.count({ where: { applicationId: id, eventCode: EVENTS.ORDER_ISSUED } })
    ).toBe(1);

    await drainOutbox();

    // The LTP was told, in-app, and the log says which application it was about.
    const inApp = await prisma.notification.findFirst({
      where: { applicationId: id, eventCode: EVENTS.ORDER_ISSUED, userId: ltp.id },
      select: { title: true, message: true },
    });
    expect(inApp).not.toBeNull();
    // The order number is in the subject; the body names the application. Both
    // matter, so both are checked against the thing they actually carry.
    expect(inApp!.title).toContain(order!.orderNumber);
    expect(inApp!.message).toContain(order!.applicationNumber);

    const logged = await prisma.notificationLog.findMany({
      where: { applicationId: id, eventCode: EVENTS.ORDER_ISSUED },
      select: { channel: true, status: true, applicationId: true },
    });
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((l) => l.applicationId === id)).toBe(true);
  }, 240_000);

  it('announces arrival at a desk, and names approval where approval is possible', async () => {
    const id = await atDesk();
    await drainJobs();

    const arrival = await prisma.outboxEvent.findMany({
      where: {
        applicationId: id,
        eventCode: { in: [EVENTS.REVIEW_REQUIRED, EVENTS.APPROVAL_REQUIRED, EVENTS.APPLICATION_SUBMITTED] },
      },
      select: { eventCode: true },
    });

    const codes = arrival.map((e) => e.eventCode);
    // Filing is announced as filing, not as a desk-to-desk forward.
    expect(codes).toContain(EVENTS.APPLICATION_SUBMITTED);
    // And the file landing at a reviewing desk is announced as work waiting.
    expect(codes.some((c) => c === EVENTS.REVIEW_REQUIRED || c === EVENTS.APPROVAL_REQUIRED)).toBe(true);
  }, 240_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Public verification
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('public verification', () => {
  it('confirms an issued permission by number and by code', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver });

    const byNumber = await findPublicRecord(order!.applicationNumber);
    const byOrder = await findPublicRecord(order!.orderNumber);
    const byCode = await findPublicRecord(order!.verificationCode);

    for (const record of [byNumber, byOrder, byCode]) {
      expect(record).not.toBeNull();
      expect(record!.status).toBe(PUBLIC_STATUS.APPROVED);
      expect(record!.proceedingNumber).toBe(order!.orderNumber);
      expect(record!.ownerName).toBe('Anita Rao');
      expect(record!.isRevoked).toBe(false);
    }

    // Locality only — enough to confirm the right plot, not enough to find the
    // house. The door number is on the file and must not be here.
    expect(byNumber!.locality).toContain('Jubilee Hills');
    expect(JSON.stringify(byNumber)).not.toContain('8-2-120');
  }, 240_000);

  it('withholds everything about an order that has not been issued', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    expect(order!.status).toBe(ORDER_STATUS.GENERATED);

    const record = await findPublicRecord(order!.applicationNumber);

    // The application is approved and the public may know that. The ORDER is
    // not released, so its number, the owner and the validity stay private —
    // a draft proceeding number quoted to a builder is a proceeding number as
    // far as the builder is concerned.
    expect(record!.status).toBe(PUBLIC_STATUS.APPROVED);
    expect(record!.proceedingNumber).toBeNull();
    expect(record!.ownerName).toBeNull();
    expect(record!.validUntil).toBeNull();
    expect(record!.orderStatus).toBeNull();

    // And the verification code, which is printed on the draft, finds it but
    // still tells a stranger nothing about the order.
    const byCode = await findPublicRecord(order!.verificationCode);
    expect(byCode!.proceedingNumber).toBeNull();
  }, 240_000);

  it('returns only whitelisted fields, and never an internal one', async () => {
    const id = await atDesk();
    const app = await prisma.application.findUniqueOrThrow({
      where: { id },
      select: { applicationNumber: true },
    });

    const record = await findPublicRecord(app.applicationNumber);
    expect(record).not.toBeNull();

    // THE test that matters. The shape is fixed; a column added to
    // `applications` must not appear here by being spread in.
    expect(Object.keys(record!).sort()).toEqual(
      [
        'applicationNumber',
        'approvedOn',
        'isRevoked',
        'locality',
        'orderStatus',
        'orderStatusLabel',
        'ownerName',
        'permissionType',
        'proceedingNumber',
        'status',
        'statusLabel',
        'submittedOn',
        'validUntil',
      ].sort()
    );

    const serialised = JSON.stringify(record);
    for (const leak of ['currentStageCode', 'ltpUserId', 'remarks', 'zoneId', 'id"']) {
      expect(serialised.includes(leak), `leaked ${leak}`).toBe(false);
    }
  }, 240_000);

  it('refuses a reference too short to be real, and finds nothing for a wrong one', async () => {
    // No prefix matching anywhere: a public lookup that accepted one would let
    // somebody enumerate the register.
    expect(await findPublicRecord('BP')).toBeNull();
    expect(await findPublicRecord('')).toBeNull();
    expect(await findPublicRecord('BP/2026')).toBeNull();
    expect(await findPublicRecord('BP/9999/999999')).toBeNull();
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Dashboard
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the dashboard figures', () => {
  it('counts issued orders and the notification backlog from the database', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const before = await approvalSummary(admin);

    const order = await getApprovalOrder(approver, id);
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.APPROVED, actor: approver });
    await advanceOrder({ orderId: order!.id, to: ORDER_STATUS.ISSUED, actor: approver });

    const after = await approvalSummary(admin);
    expect(after.ordersIssued).toBe(before.ordersIssued + 1);

    // The backlog is the OUTBOX, not the inbox: it counts people the system
    // has decided something about and not yet told.
    const outbox = await prisma.outboxEvent.count({ where: { processed: false } });
    expect(after.notificationsPending).toBe(outbox);

    await drainOutbox();
    const drained = await approvalSummary(admin);
    expect(drained.notificationsPending).toBeLessThanOrEqual(after.notificationsPending);
  }, 240_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Storage
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!dbUp)('the stored document', () => {
  it('replaces the artefact on re-render rather than accumulating orphans', async () => {
    const id = await atDesk();
    expect(await approve(id)).toBe(true);

    const order = await getApprovalOrder(approver, id);
    const first = await prisma.approvalOrder.findUniqueOrThrow({
      where: { id: order!.id },
      select: { storageKey: true },
    });

    await storeApprovalOrderPdf(order!.id);

    const second = await prisma.approvalOrder.findUniqueOrThrow({
      where: { id: order!.id },
      select: { storageKey: true },
    });

    expect(second.storageKey).not.toBe('');
    expect(second.storageKey).not.toBe(first.storageKey);
  }, 240_000);
});
