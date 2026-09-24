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
  actorFor,
  META,
} from './setup';
import { createApplication, saveStep, submitApplication } from '@/server/services/applications';
import { uploadDrawing } from '@/server/services/drawings';
import { requestScrutiny, getScrutiny, applyOutcome } from '@/server/services/scrutiny';
import { ensureReport } from '@/server/services/scrutiny-report';
import { createUser } from '@/server/services/users';
import { __setScrutinyProviderForTests } from '@/server/scrutiny';
import { storage } from '@/server/storage';
import { ROLES } from '@/lib/constants';
import type {
  ScrutinyAck,
  ScrutinyOutcome,
  ScrutinyProvider,
  ScrutinySubmission,
} from '@/server/scrutiny/types';

/**
 * Phase 3 — scrutiny, and the correction loop it exists to drive.
 *
 * The journey this suite proves end to end:
 *
 *   upload → scrutiny → FAIL → report → re-upload → V2 → scrutiny → …
 *   → V3 → scrutiny → PASS → documents unlock
 *
 * And the two properties that make it trustworthy:
 *
 *   · The application STAYS THE SAME APPLICATION throughout. A failure is a
 *     correction cycle, not a rejection, and nobody starts again.
 *   · An engine ERROR is never a verdict. A drawing that was never judged must
 *     not end up marked as failing.
 */

const dbUp = await databaseAvailable();

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');

let ltp: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let layoutTypeId: string;
let zoneId: string;

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  const a = await createUser(
    {
      email: 'test-scrut-a@example.com',
      name: 'Test Scrutiny LTP',
      phone: '9876543210',
      designation: 'Architect',
      employeeCode: '',
      roleKey: ROLES.LTP,
      zoneIds: [],
      ltpLicenceNo: 'TEST-SCRUT-A',
      ltpLicenceClass: 'CLASS_I',
      firmName: 'Scrutiny Firm',
    },
    admin,
    META
  );
  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  layoutTypeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'LAYOUT_APPROVAL' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;
}, 60_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny();
});

afterEach(async () => {
  if (!dbUp) return;
  // Always restore the real driver, so one test's stub cannot leak.
  __setScrutinyProviderForTests(null);
  await cleanupTestApplications([ltp?.id].filter(Boolean) as string[]);
  await clearJobs();
  // The gate is on by default; a test that turned it off must not leave it off.
  await prisma.applicationType.update({ where: { id: typeId }, data: { requiresScrutiny: true } });
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

async function filedApplication(applicationTypeId = typeId) {
  const app = await createApplication(ltp, { applicationTypeId }, META);

  const steps: Array<[string, Record<string, unknown>]> = [
    ['applicant', { name: 'Ravi Kumar', phone: '9876543210', address: '12 Main Road, Hyderabad', fatherName: '', email: '', aadhaarLast4: '', panMasked: '' }],
    ['owner', { ownerSameAsApplicant: true, ownerName: '', ownerPhone: '', ownerAddress: '' }],
    ['property', { district: 'Hyderabad', mandal: '', village: '', localityName: 'Banjara Hills', wardNo: '' }],
    ['location', { zoneId, streetName: 'Road No 12', doorNo: '', pincode: '500034', boundaryNorth: '', boundarySouth: '', boundaryEast: '', boundaryWest: '' }],
    ['survey', { surveyNumbers: '123/A', plotNo: '7', plotAreaSqm: 300, roadWidthM: 9, layoutName: '', lpNumber: '', landUseZone: '', tenureType: '' }],
    ['development', { buildingUse: 'DWELLING', occupancyType: 'A_RESIDENTIAL', buildingSubUse: '', structureType: 'RCC', numFloors: 2, numBasements: 0, numDwellingUnits: 1, buildingHeightM: 7.5 }],
    ['building', { plotAreaSqm: 300, builtUpAreaSqm: 400, floorAreaSqm: 380, coverageAreaSqm: 180, parkingAreaSqm: 40, setbackFrontM: 3, setbackRearM: 2, setbackLeftM: 1.5, setbackRightM: 1.5 }],
    ['ltp', { declarationAccepted: true, remarks: '' }],
  ];

  for (const [step, data] of steps) {
    await saveStep(ltp, app.id, { step: step as never, data, partial: false }, META);
  }
  return submitApplication(ltp, app.id, META);
}

/** Uploads a version and clears it through the scan job. */
async function uploadVersion(applicationId: string, drawingId?: string, remarks?: string) {
  const result = await uploadDrawing(
    ltp,
    {
      applicationId,
      category: 'SITE_PLAN',
      drawingId,
      remarks,
      file: { name: 'site-plan.pdf', type: 'application/pdf', bytes: PDF },
    },
    META
  );
  await drainJobs();
  return result;
}

/** Runs scrutiny to completion, the way the worker would. */
async function scrutinise(applicationId: string) {
  const res = await requestScrutiny(ltp, applicationId, META);
  await drainJobs();
  return res;
}

const statusOf = async (id: string) =>
  (await prisma.application.findUniqueOrThrow({ where: { id } })).status;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Requesting a run
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('requestScrutiny', () => {
  it('queues one request per active drawing and marks the application in progress', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    // Deliberately not drained, so the in-flight state is observable.
    const res = await requestScrutiny(ltp, app.id, META);

    expect(res.requested).toBe(1);
    expect(res.engineDriver).toBe('mock');
    expect(res.isDemo).toBe(true);
    expect(await statusOf(app.id)).toBe('SCRUTINY_IN_PROGRESS');

    const requests = await prisma.scrutinyRequest.findMany({
      where: { drawingVersion: { drawing: { applicationId: app.id } } },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('QUEUED');
    // Provenance, recorded forever.
    expect(requests[0]!.engineDriver).toBe('mock');
  }, 30_000);

  it('checks every sheet, not just one', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await uploadDrawing(
      ltp,
      { applicationId: app.id, category: 'FLOOR_PLAN', file: { name: 'floor.pdf', type: 'application/pdf', bytes: PDF } },
      META
    );
    await drainJobs();

    const res = await requestScrutiny(ltp, app.id, META);
    expect(res.requested).toBe(2);
  }, 30_000);

  it('refuses a second run while one is already in flight', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await requestScrutiny(ltp, app.id, META);

    // A double-clicked button must not queue two sets of engine runs.
    await expect(requestScrutiny(ltp, app.id, META)).rejects.toThrow(/already running/i);
  }, 30_000);

  it('counts attempts per drawing version', async () => {
    const app = await filedApplication();
    const { drawingId } = await uploadVersion(app.id);

    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);
    // Re-running the SAME version, unchanged.
    await scrutinise(app.id);

    const requests = await prisma.scrutinyRequest.findMany({
      where: { drawingVersion: { drawingId } },
      orderBy: { attempt: 'asc' },
    });

    expect(requests.map((r) => r.attempt)).toEqual([1, 2]);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Failure
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('scrutiny failure', () => {
  it('fails the application and records the findings', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    expect(await statusOf(app.id)).toBe('SCRUTINY_FAILED');

    const view = await getScrutiny(ltp, app.id);
    const result = view.current[0]!.result!;

    expect(result.outcome).toBe('FAIL');
    expect(result.issues.length).toBeGreaterThan(0);
    // The tally is what the UI shows first: "18 of 21 checks passed".
    expect(result.checksRun).toBeGreaterThan(0);
    expect(result.checksPassed).toBeLessThan(result.checksRun);
  }, 30_000);

  it('raises at least one blocking issue on a failure', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    const view = await getScrutiny(ltp, app.id);
    const issues = view.current[0]!.result!.issues;

    // A FAIL with only advisories would be incoherent.
    expect(issues.some((i) => i.severity === 'CRITICAL' || i.severity === 'MAJOR')).toBe(true);
  }, 30_000);

  it('sorts issues worst-first, so the thing to fix is at the top', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    const rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2, INFO: 3 } as Record<string, number>;
    const issues = (await getScrutiny(ltp, app.id)).current[0]!.result!.issues;

    for (let i = 1; i < issues.length; i += 1) {
      expect(rank[issues[i]!.severity]!).toBeGreaterThanOrEqual(rank[issues[i - 1]!.severity]!);
    }
  }, 30_000);

  it('links each issue to its rule, so a remedy can be shown', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    const issues = (await getScrutiny(ltp, app.id)).current[0]!.result!.issues;

    for (const issue of issues) {
      expect(issue.rule, `issue ${issue.ruleCode} has no catalogue entry`).not.toBeNull();
      // A finding an applicant cannot act on wastes a correction cycle.
      expect(issue.rule!.remedy.length).toBeGreaterThan(0);
      // And no invented statutory citation — Rule 6.
      expect(issue.rule!.reference).toBe('');
    }
  }, 30_000);

  it('generates a watermarked report for the failure', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    const view = await getScrutiny(ltp, app.id);
    const result = view.current[0]!.result!;

    // The RENDER_SCRUTINY_REPORT job runs as part of drainJobs.
    expect(result.report).not.toBeNull();
    expect(result.report!.isDemo).toBe(true);

    const report = await prisma.scrutinyReport.findUniqueOrThrow({
      where: { scrutinyResultId: result.id },
    });
    const html = (await storage.get(report.storageKey)).toString('utf8');

    // A mock PASS printed on letterhead is exactly the artefact that gets
    // mistaken for an approval, so the watermark is asserted, not assumed.
    expect(html).toContain('DEMO SCRUTINY — NOT A COMPLIANCE CERTIFICATE');
    expect(html).toContain('FAILED');
    expect(html).toContain('mock');
  }, 30_000);

  it('records the failure on the timeline', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_FAIL' });
    await scrutinise(app.id);

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'SCRUTINY_FAILED' },
    });
    expect(events).toHaveLength(1);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The correction loop
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('failure → re-upload → pass', () => {
  it('runs the full V1 fail → V2 fail → V3 pass journey on ONE application', async () => {
    const app = await filedApplication();
    // The documented demo ladder: passes from version 3.
    await configureMockScrutiny({ mode: 'VERSION_LADDER', passFromVersion: 3 });

    // ── V1 ──
    const { drawingId } = await uploadVersion(app.id, undefined, 'Initial submission');
    expect(await statusOf(app.id)).toBe('DRAWING_UPLOADED');
    await scrutinise(app.id);
    expect(await statusOf(app.id)).toBe('SCRUTINY_FAILED');

    // ── V2 ──
    await uploadVersion(app.id, drawingId, 'Corrected setbacks');
    // Uploading a correction reopens the drawing stage.
    expect(await statusOf(app.id)).toBe('DRAWING_UPLOADED');
    await scrutinise(app.id);
    expect(await statusOf(app.id)).toBe('SCRUTINY_FAILED');

    // ── V3 ──
    await uploadVersion(app.id, drawingId, 'Corrected parking and height');
    await scrutinise(app.id);
    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');

    // ── The same application throughout ──
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.id).toBe(app.id);
    expect(after.applicationNumber).toBe(app.applicationNumber);

    // ── And the whole history survives ──
    const versions = await prisma.drawingVersion.findMany({
      where: { drawingId },
      orderBy: { versionNo: 'asc' },
      include: { scrutinyRequests: { include: { result: true } } },
    });

    expect(versions).toHaveLength(3);
    expect(versions[0]!.scrutinyRequests[0]!.result!.outcome).toBe('FAIL');
    expect(versions[1]!.scrutinyRequests[0]!.result!.outcome).toBe('FAIL');
    expect(versions[2]!.scrutinyRequests[0]!.result!.outcome).toBe('PASS');

    // Only the last is active; the failed ones are kept, not deleted.
    expect(versions.filter((v) => v.isActive)).toHaveLength(1);
    expect(versions[2]!.isActive).toBe(true);
  }, 60_000);

  it('keeps a report for every attempt, including the failed ones', async () => {
    const app = await filedApplication();
    await configureMockScrutiny({ mode: 'VERSION_LADDER', passFromVersion: 3 });

    const { drawingId } = await uploadVersion(app.id);
    await scrutinise(app.id);
    await uploadVersion(app.id, drawingId);
    await scrutinise(app.id);
    await uploadVersion(app.id, drawingId);
    await scrutinise(app.id);

    const reports = await prisma.scrutinyReport.findMany({
      where: { result: { request: { drawingVersion: { drawingId } } } },
    });

    // Three runs, three reports — the evidence that the corrections happened.
    expect(reports).toHaveLength(3);
  }, 60_000);

  it('shows the correction history, newest run first', async () => {
    const app = await filedApplication();
    await configureMockScrutiny({ mode: 'VERSION_LADDER', passFromVersion: 2 });

    const { drawingId } = await uploadVersion(app.id);
    await scrutinise(app.id);
    await uploadVersion(app.id, drawingId);
    await scrutinise(app.id);

    const view = await getScrutiny(ltp, app.id);

    expect(view.history).toHaveLength(2);
    // Current shows only the runs that decide the present status.
    expect(view.current).toHaveLength(1);
    expect(view.current[0]!.drawingVersion.versionNo).toBe(2);
    expect(view.current[0]!.result!.outcome).toBe('PASS');
  }, 60_000);

  it('produces the same result for the same application and version', async () => {
    // Determinism is what makes the demo reproducible and this suite stable.
    const app = await filedApplication();
    await configureMockScrutiny({ mode: 'VERSION_LADDER', passFromVersion: 3 });

    await uploadVersion(app.id);
    await scrutinise(app.id);
    const first = (await getScrutiny(ltp, app.id)).current[0]!.result!;

    await scrutinise(app.id); // Same version, run again.
    const second = (await getScrutiny(ltp, app.id)).current[0]!.result!;

    expect(second.issues.map((i) => i.ruleCode)).toEqual(first.issues.map((i) => i.ruleCode));
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The pass gate
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('pass gate', () => {
  it('sets SCRUTINY_PASSED and closes the drawing stage', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');

    const { canUploadDrawing, hasScrutinyPassed } = await import('@/lib/drawings');
    expect(hasScrutinyPassed('SCRUTINY_PASSED')).toBe(true);
    // The approved drawing is the record now.
    expect(canUploadDrawing('SCRUTINY_PASSED')).toBe(false);
  }, 30_000);

  it('passes with advisories outstanding, because they do not block', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    const result = (await getScrutiny(ltp, app.id)).current[0]!.result!;

    expect(result.outcome).toBe('PASS');
    expect(result.criticalCount).toBe(0);
    expect(result.majorCount).toBe(0);
    // Any issues present are advisory only.
    for (const issue of result.issues) {
      expect(['MINOR', 'INFO']).toContain(issue.severity);
    }
  }, 30_000);

  it('produces a passing report that still says it is a demo', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    const result = (await getScrutiny(ltp, app.id)).current[0]!.result!;
    const report = await ensureReport(result.id);
    const html = (await storage.get(report.storageKey)).toString('utf8');

    expect(html).toContain('PASSED');
    // A passing mock report is the one most likely to be mistaken for an
    // approval, so this assertion matters most here.
    expect(html).toContain('DEMO SCRUTINY — NOT A COMPLIANCE CERTIFICATE');
    expect(html).toContain('carries no statutory weight');
  }, 30_000);

  it('records the pass on the timeline and emits a notification event', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'SCRUTINY_PASSED' },
    });
    expect(events).toHaveLength(1);

    const outbox = await prisma.outboxEvent.findMany({
      where: { applicationId: app.id, eventCode: 'SCRUTINY_PASSED' },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. State transitions
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('application state transitions', () => {
  it('walks SUBMITTED → DRAWING_UPLOADED → SCRUTINY_IN_PROGRESS → outcome', async () => {
    const app = await filedApplication();
    expect(app.status).toBe('SUBMITTED');

    await uploadVersion(app.id);
    expect(await statusOf(app.id)).toBe('DRAWING_UPLOADED');

    await requestScrutiny(ltp, app.id, META);
    expect(await statusOf(app.id)).toBe('SCRUTINY_IN_PROGRESS');

    await drainJobs();
    expect(['SCRUTINY_PASSED', 'SCRUTINY_FAILED']).toContain(await statusOf(app.id));
  }, 30_000);

  it('fails the set if ANY sheet fails', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id); // Site plan, V1.

    // A second sheet, taken straight to V3 so the ladder passes it while the
    // first sheet is still at V1 and fails.
    const floor = await uploadDrawing(
      ltp,
      { applicationId: app.id, category: 'FLOOR_PLAN', file: { name: 'floor.pdf', type: 'application/pdf', bytes: PDF } },
      META
    );
    await drainJobs();
    await uploadVersion(app.id, floor.drawingId);
    await uploadVersion(app.id, floor.drawingId);

    await configureMockScrutiny({ mode: 'VERSION_LADDER', passFromVersion: 3 });
    await scrutinise(app.id);

    const view = await getScrutiny(ltp, app.id);
    const outcomes = view.current.map((r) => r.result?.outcome);

    expect(outcomes).toContain('FAIL'); // The V1 site plan.
    expect(outcomes).toContain('PASS'); // The V3 floor plan.
    // One failure fails the set.
    expect(await statusOf(app.id)).toBe('SCRUTINY_FAILED');
  }, 60_000);

  it('does NOT fail the application when the engine itself breaks', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    // An engine that always throws. Its failures are transport failures, and
    // the drawing is never judged.
    __setScrutinyProviderForTests({
      name: 'broken',
      configured: true,
      isDemo: true,
      async submit(): Promise<ScrutinyAck> {
        throw new Error('Engine unreachable');
      },
    });

    await requestScrutiny(ltp, app.id, META);
    await drainJobs();

    const request = await prisma.scrutinyRequest.findFirstOrThrow({
      where: { drawingVersion: { drawing: { applicationId: app.id } } },
    });

    expect(request.status).toBe('ERRORED');
    expect(request.errorMessage).toMatch(/unreachable/i);

    // SCRUTINY_FAILED would tell the applicant to correct a drawing that may
    // be perfectly correct. The application returns to the drawing stage.
    const status = await statusOf(app.id);
    expect(status).not.toBe('SCRUTINY_FAILED');
    expect(status).toBe('DRAWING_UPLOADED');
  }, 60_000);

  it('lets the LTP retry after an engine error', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    let calls = 0;
    __setScrutinyProviderForTests({
      name: 'flaky',
      configured: true,
      isDemo: true,
      async submit(): Promise<ScrutinyAck> {
        calls += 1;
        throw new Error('Engine unreachable');
      },
    });

    await requestScrutiny(ltp, app.id, META);
    await drainJobs();
    expect(calls).toBeGreaterThan(0);
    expect(await statusOf(app.id)).toBe('DRAWING_UPLOADED');

    // Back to a working engine, and the same application carries on.
    __setScrutinyProviderForTests(null);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');
  }, 60_000);

  it('skips the engine entirely when the type does not require scrutiny', async () => {
    // F.8: the gate is configuration, not a code path.
    await prisma.applicationType.update({
      where: { id: layoutTypeId },
      data: { requiresScrutiny: false },
    });

    try {
      const app = await filedApplication(layoutTypeId);
      await uploadVersion(app.id);

      const res = await requestScrutiny(ltp, app.id, META);

      expect(res.skipped).toBe(true);
      expect(res.requested).toBe(0);
      // The drawing is still versioned and stored — it simply is not
      // machine-checked, and the file moves straight to documents.
      expect(await statusOf(app.id)).toBe('DOCUMENT_UPLOAD_PENDING');
      expect(await prisma.scrutinyRequest.count({
        where: { drawingVersion: { drawing: { applicationId: app.id } } },
      })).toBe(0);
    } finally {
      await prisma.applicationType.update({
        where: { id: layoutTypeId },
        data: { requiresScrutiny: true },
      });
    }
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Independence from the mock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * docs/07-subsystems.md P.7 requires this to be TESTED rather than asserted:
 * the same path runs against the mock and against a stub speaking the HTTP
 * provider's contract, and the resulting application state must be identical.
 *
 * If any service, guard, route or component ever learns which driver is live,
 * this test fails.
 */
describe.runIf(dbUp)('provider independence', () => {
  /** A stub engine that is emphatically not the mock. */
  function stubProvider(outcome: 'PASS' | 'FAIL'): ScrutinyProvider {
    return {
      name: 'stub-http',
      configured: true,
      isDemo: false,
      async submit(input: ScrutinySubmission): Promise<ScrutinyAck> {
        const result: ScrutinyOutcome = {
          externalRef: `stub-${input.requestId}`,
          outcome,
          summary: `Stub engine says ${outcome}.`,
          checksRun: 5,
          checksPassed: outcome === 'PASS' ? 5 : 3,
          issues:
            outcome === 'FAIL'
              ? [
                  {
                    ruleCode: 'SETBACK_FRONT',
                    severity: 'MAJOR',
                    title: 'Front setback',
                    description: 'Stub finding.',
                  },
                  {
                    ruleCode: 'NORTH_POINT',
                    severity: 'MINOR',
                    title: 'North point',
                    description: 'Stub advisory.',
                  },
                ]
              : [],
          raw: { stub: true },
        };
        return { kind: 'terminal', outcome: result };
      },
    };
  }

  it('reaches the same PASS state through a non-mock driver', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    __setScrutinyProviderForTests(stubProvider('PASS'));
    await scrutinise(app.id);

    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');

    const request = await prisma.scrutinyRequest.findFirstOrThrow({
      where: { drawingVersion: { drawing: { applicationId: app.id } } },
    });
    // Provenance records the real driver, not the default.
    expect(request.engineDriver).toBe('stub-http');
  }, 60_000);

  it('reaches the same FAIL state through a non-mock driver', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    __setScrutinyProviderForTests(stubProvider('FAIL'));
    await scrutinise(app.id);

    expect(await statusOf(app.id)).toBe('SCRUTINY_FAILED');

    const result = (await getScrutiny(ltp, app.id)).current[0]!.result!;
    expect(result.checksRun).toBe(5);
    expect(result.checksPassed).toBe(3);
    expect(result.issues).toHaveLength(2);
    // Issues from any driver resolve against the same rule catalogue.
    expect(result.issues[0]!.rule?.remedy.length).toBeGreaterThan(0);
  }, 60_000);

  it('does NOT watermark a report from a real engine', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    __setScrutinyProviderForTests({ ...stubProvider('PASS'), name: 'http' });
    await scrutinise(app.id);

    const result = (await getScrutiny(ltp, app.id)).current[0]!.result!;
    const report = await ensureReport(result.id);
    const html = (await storage.get(report.storageKey)).toString('utf8');

    expect(report.isDemo).toBe(false);
    expect(html).not.toContain('DEMO SCRUTINY');
    expect(html).not.toContain('carries no statutory weight');
  }, 60_000);

  it('handles a PENDING provider by polling until the answer arrives', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);

    let polls = 0;
    __setScrutinyProviderForTests({
      name: 'polled',
      configured: true,
      isDemo: false,
      async submit(input): Promise<ScrutinyAck> {
        return { kind: 'pending', externalRef: `polled-${input.requestId}`, retryAfterMs: 0 };
      },
      async poll(_ref, input): Promise<ScrutinyOutcome | null> {
        polls += 1;
        // Not ready the first time — the worker must come back.
        if (polls < 2) return null;
        return {
          externalRef: `polled-${input.requestId}`,
          outcome: 'PASS',
          summary: 'Polled engine says PASS.',
          checksRun: 4,
          checksPassed: 4,
          issues: [],
          raw: {},
        };
      },
    });

    await requestScrutiny(ltp, app.id, META);
    await drainJobs();

    expect(polls).toBeGreaterThanOrEqual(2);
    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Idempotence
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('applyOutcome', () => {
  it('ignores a duplicate outcome for the same request', async () => {
    const app = await filedApplication();
    await uploadVersion(app.id);
    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await scrutinise(app.id);

    const request = await prisma.scrutinyRequest.findFirstOrThrow({
      where: { drawingVersion: { drawing: { applicationId: app.id } } },
    });

    // A duplicate callback, a retried job, a poll racing a callback — all
    // land here, and the second must be a no-op rather than a second result.
    const second = await applyOutcome(request.id, {
      externalRef: 'duplicate',
      outcome: 'FAIL',
      summary: 'Should be ignored.',
      checksRun: 1,
      checksPassed: 0,
      issues: [],
      raw: {},
    });

    expect(second.applied).toBe(false);

    const results = await prisma.scrutinyResult.findMany({
      where: { scrutinyRequestId: request.id },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('PASS');
    // And the duplicate did not drag the application backwards.
    expect(await statusOf(app.id)).toBe('SCRUTINY_PASSED');
  }, 30_000);
});
