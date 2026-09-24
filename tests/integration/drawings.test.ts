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
import {
  uploadDrawing,
  listDrawings,
  downloadDrawingVersion,
  activeVersions,
} from '@/server/services/drawings';
import { requestScrutiny } from '@/server/services/scrutiny';
import { createUser } from '@/server/services/users';
import { storage } from '@/server/storage';
import { ROLES } from '@/lib/constants';

/**
 * Phase 3 — drawing upload, validation and versioning.
 *
 * The property this suite exists to hold down:
 *
 *   A DRAWING IS NEVER OVERWRITTEN.
 *
 * Every correction creates a new version and supersedes the last, and the
 * superseded one stays downloadable — because a scrutiny report that judged V1
 * is meaningless if V1 no longer exists.
 */

const dbUp = await databaseAvailable();

// Real file headers. A fake constant here would make the validation tests
// green against a validator that does not work.
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const DWG = Buffer.from(`AC1027${'\0'.repeat(64)}`, 'latin1');
const PE_BINARY = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let ltp: ReturnType<typeof actorFor>;
let otherLtp: ReturnType<typeof actorFor>;
let admin: ReturnType<typeof actorFor>;
let typeId: string;
let zoneId: string;

beforeAll(async () => {
  if (!dbUp) return;

  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin.demo@example.com' },
  });
  admin = actorFor(adminUser.id, adminUser.name, [ROLES.SYSTEM_ADMIN]);

  const base = {
    phone: '9876543210',
    designation: 'Architect',
    employeeCode: '',
    roleKey: ROLES.LTP,
    zoneIds: [],
    ltpLicenceClass: 'CLASS_I',
  };

  const a = await createUser(
    { ...base, email: 'test-draw-a@example.com', name: 'Test Draw A', ltpLicenceNo: 'TEST-DRAW-A', firmName: 'A' },
    admin,
    META
  );
  const b = await createUser(
    { ...base, email: 'test-draw-b@example.com', name: 'Test Draw B', ltpLicenceNo: 'TEST-DRAW-B', firmName: 'B' },
    admin,
    META
  );

  ltp = actorFor(a.user.id, a.user.name, [ROLES.LTP]);
  otherLtp = actorFor(b.user.id, b.user.name, [ROLES.LTP]);

  typeId = (await prisma.applicationType.findFirstOrThrow({ where: { code: 'RESIDENTIAL_BUILDING' } })).id;
  zoneId = (await prisma.zone.findFirstOrThrow({ where: { isActive: true } })).id;
}, 60_000);

beforeEach(async () => {
  if (!dbUp) return;
  await configureMockScrutiny();
});

afterEach(async () => {
  if (!dbUp) return;
  await cleanupTestApplications([ltp?.id, otherLtp?.id].filter(Boolean) as string[]);
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

/** A filed application — the state in which drawings are scrutinised. */
async function filedApplication(actor = ltp) {
  const app = await createApplication(actor, { applicationTypeId: typeId }, META);

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
    await saveStep(actor, app.id, { step: step as never, data, partial: false }, META);
  }
  // Return the SUBMITTED row, not the draft `createApplication` handed back.
  return submitApplication(actor, app.id, META);
}

const upload = (
  actor: ReturnType<typeof actorFor>,
  applicationId: string,
  overrides: Partial<{ name: string; type: string; bytes: Buffer; category: string; drawingId: string; remarks: string }> = {}
) =>
  uploadDrawing(
    actor,
    {
      applicationId,
      category: overrides.category ?? 'SITE_PLAN',
      drawingId: overrides.drawingId,
      remarks: overrides.remarks,
      file: {
        name: overrides.name ?? 'site-plan.pdf',
        type: overrides.type ?? 'application/pdf',
        bytes: overrides.bytes ?? PDF,
      },
    },
    META
  );

// ═══════════════════════════════════════════════════════════════════════════
// 1. Upload
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('uploadDrawing', () => {
  it('stores the file and creates version 1', async () => {
    const app = await filedApplication();
    const { drawingId, version } = await upload(ltp, app.id);

    expect(version.versionNo).toBe(1);
    expect(version.isActive).toBe(true);
    expect(version.file.originalName).toBe('site-plan.pdf');

    const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
    expect(drawing.category).toBe('SITE_PLAN');
    expect(drawing.currentVersionNo).toBe(1);
  }, 30_000);

  it('writes the bytes to private storage under a non-guessable key', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);

    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: version.file.id } });

    // The key contains a long random segment, so the object is unreachable
    // without a database row pointing at it.
    expect(file.storageKey).toContain(`applications/${app.id}/drawings/`);
    expect(file.storageKey).toMatch(/[0-9a-f]{48}\.pdf$/);
    expect(file.storageKey).not.toContain('site-plan');
    expect(await storage.exists(file.storageKey)).toBe(true);
  }, 30_000);

  it('records a checksum of what was actually stored', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);

    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(PDF).digest('hex');

    expect(version.file.checksumSha256).toBe(expected);
  }, 30_000);

  it('derives the discipline from the sheet type rather than asking twice', async () => {
    const app = await filedApplication();
    const a = await upload(ltp, app.id, { category: 'SITE_PLAN' });
    const b = await upload(ltp, app.id, { category: 'STRUCTURAL_DRAWING', name: 'struct.dwg', type: 'image/vnd.dwg', bytes: DWG });

    const site = await prisma.drawing.findUniqueOrThrow({ where: { id: a.drawingId } });
    const struct = await prisma.drawing.findUniqueOrThrow({ where: { id: b.drawingId } });

    expect(site.discipline).toBe('ARCHITECTURAL');
    expect(struct.discipline).toBe('STRUCTURAL');
  }, 30_000);

  it('leaves the file PENDING until the scanner has run', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);

    // The download route refuses PENDING, so an unscanned file cannot be
    // served in the window before the worker gets to it.
    expect(version.file.scanStatus).toBe('PENDING');
    await expect(downloadDrawingVersion(ltp, version.id, META)).rejects.toThrow(/checked for viruses/i);
  }, 30_000);

  it('clears the file once the scan job runs', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);

    await drainJobs();

    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: version.file.id } });
    // SKIPPED, not CLEAN: no scanner is configured, and claiming a check
    // happened would be a lie.
    expect(file.scanStatus).toBe('SKIPPED');

    const download = await downloadDrawingVersion(ltp, version.id, META);
    expect(download.bytes.equals(PDF)).toBe(true);
  }, 30_000);

  it('moves the application to DRAWING_UPLOADED', async () => {
    const app = await filedApplication();
    expect(app.status).toBe('SUBMITTED');

    await upload(ltp, app.id);

    const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe('DRAWING_UPLOADED');
  }, 30_000);

  it('records the upload on the timeline and in the audit trail', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);

    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, type: 'DRAWING_UPLOADED' },
    });
    expect(events).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'DrawingVersion', entityId: version.id, action: 'DRAWING_UPLOADED' },
    });
    expect(audit).not.toBeNull();
    // The checksum in the audit row is what proves, years later, that the
    // bytes served are the bytes that were judged.
    expect((audit!.after as Record<string, unknown>).checksumSha256).toBe(version.file.checksumSha256);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Validation
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('file validation', () => {
  it('refuses an executable renamed to .pdf', async () => {
    const app = await filedApplication();

    await expect(
      upload(ltp, app.id, { name: 'evil.pdf', type: 'application/pdf', bytes: PE_BINARY })
    ).rejects.toThrow(/could not be recognised/i);
  }, 30_000);

  it('refuses a type that is not a drawing', async () => {
    const app = await filedApplication();

    await expect(
      upload(ltp, app.id, { name: 'photo.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })
    ).rejects.toThrow(/\.pdf, \.dwg and \.dxf/i);
  }, 30_000);

  it('refuses an empty file', async () => {
    const app = await filedApplication();
    await expect(upload(ltp, app.id, { bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/i);
  }, 30_000);

  it('refuses a file over the size cap', async () => {
    const app = await filedApplication();
    const { env } = await import('@/server/config/env');

    // A real PDF header followed by padding past the limit.
    const huge = Buffer.concat([PDF, Buffer.alloc(env.maxUploadBytes + 1024, 0x20)]);
    await expect(upload(ltp, app.id, { bytes: huge })).rejects.toThrow(/limit is/i);
  }, 30_000);

  it('writes nothing to storage when validation fails', async () => {
    const app = await filedApplication();
    const before = await prisma.fileObject.count();

    await expect(
      upload(ltp, app.id, { name: 'evil.pdf', type: 'application/pdf', bytes: PE_BINARY })
    ).rejects.toThrow();

    // A rejected file leaves no row and no object to clean up.
    expect(await prisma.fileObject.count()).toBe(before);
    expect(await prisma.drawing.count({ where: { applicationId: app.id } })).toBe(0);
  }, 30_000);

  it('accepts a genuine DWG despite the browser calling it octet-stream', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id, {
      name: 'plan.dwg',
      type: 'application/octet-stream',
      bytes: DWG,
    });

    // The stored MIME is derived from the bytes, not from what was declared.
    expect(version.file.mimeType).toBe('image/vnd.dwg');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Versioning
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('versioning', () => {
  it('creates V2 without touching V1', async () => {
    const app = await filedApplication();
    const first = await upload(ltp, app.id, { remarks: 'Initial' });
    const second = await upload(ltp, app.id, { drawingId: first.drawingId, remarks: 'Corrected setback' });

    expect(second.version.versionNo).toBe(2);

    const versions = await prisma.drawingVersion.findMany({
      where: { drawingId: first.drawingId },
      orderBy: { versionNo: 'asc' },
    });

    expect(versions).toHaveLength(2);
    // V1 survives, with its own file and its own remarks.
    expect(versions[0]!.versionNo).toBe(1);
    expect(versions[0]!.remarks).toBe('Initial');
    expect(versions[0]!.fileObjectId).not.toBe(versions[1]!.fileObjectId);
  }, 30_000);

  it('keeps exactly one active version', async () => {
    const app = await filedApplication();
    const first = await upload(ltp, app.id);
    await upload(ltp, app.id, { drawingId: first.drawingId });
    await upload(ltp, app.id, { drawingId: first.drawingId });

    const active = await prisma.drawingVersion.findMany({
      where: { drawingId: first.drawingId, isActive: true },
    });

    expect(active).toHaveLength(1);
    expect(active[0]!.versionNo).toBe(3);
  }, 30_000);

  it('cannot be made to have two active versions', async () => {
    const app = await filedApplication();
    const first = await upload(ltp, app.id);
    const second = await upload(ltp, app.id, { drawingId: first.drawingId });

    // The partial unique index makes this impossible at the database, not
    // merely avoided in code.
    await expect(
      prisma.drawingVersion.update({
        where: { id: second.version.id },
        data: { isActive: true },
      })
    ).resolves.toBeTruthy(); // Already active — a no-op.

    const v1 = await prisma.drawingVersion.findFirstOrThrow({
      where: { drawingId: first.drawingId, versionNo: 1 },
    });

    await expect(
      prisma.drawingVersion.update({ where: { id: v1.id }, data: { isActive: true } })
    ).rejects.toThrow();
  }, 30_000);

  it('keeps a superseded version downloadable', async () => {
    const app = await filedApplication();
    const first = await upload(ltp, app.id);
    await upload(ltp, app.id, { drawingId: first.drawingId });
    await drainJobs();

    // A report that judged V1 is meaningless if V1 cannot be retrieved.
    const download = await downloadDrawingVersion(ltp, first.version.id, META);
    expect(download.versionNo).toBe(1);
    expect(download.bytes.equals(PDF)).toBe(true);
  }, 30_000);

  it('scrutinises only the active version of each sheet', async () => {
    const app = await filedApplication();
    const first = await upload(ltp, app.id);
    await upload(ltp, app.id, { drawingId: first.drawingId });

    const active = await activeVersions(app.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.versionNo).toBe(2);
  }, 30_000);

  it('versions each sheet independently', async () => {
    const app = await filedApplication();
    const site = await upload(ltp, app.id, { category: 'SITE_PLAN' });
    const floor = await upload(ltp, app.id, { category: 'FLOOR_PLAN', name: 'floor.pdf' });

    await upload(ltp, app.id, { drawingId: site.drawingId });

    const listed = await listDrawings(ltp, app.id);
    const siteSheet = listed.drawings.find((d) => d.id === site.drawingId)!;
    const floorSheet = listed.drawings.find((d) => d.id === floor.drawingId)!;

    expect(siteSheet.currentVersionNo).toBe(2);
    expect(floorSheet.currentVersionNo).toBe(1);
  }, 30_000);

  it('names the uploader on every version', async () => {
    const app = await filedApplication();
    await upload(ltp, app.id);

    const listed = await listDrawings(ltp, app.id);
    // "uploaded by 01a03d94-…" is not an answer anybody can use.
    expect(listed.drawings[0]!.versions[0]!.uploadedByName).toBe('Test Draw A');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Gates
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('upload gates', () => {
  it('allows uploading while the application is still a draft', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    const { version } = await upload(ltp, app.id);

    expect(version.versionNo).toBe(1);
    // A draft stays a draft — the particulars are not filed yet.
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe('DRAFT');
  }, 30_000);

  it('refuses scrutiny while the application is still a draft', async () => {
    const app = await createApplication(ltp, { applicationTypeId: typeId }, META);
    await upload(ltp, app.id);
    await drainJobs();

    // Scrutiny checks the drawing AGAINST the particulars, so running it
    // before they are filed would check against nothing.
    await expect(requestScrutiny(ltp, app.id, META)).rejects.toThrow(/particulars first/i);
  }, 30_000);

  it('refuses a new drawing once scrutiny has passed', async () => {
    const app = await filedApplication();
    await upload(ltp, app.id);
    await drainJobs();

    await configureMockScrutiny({ mode: 'ALWAYS_PASS' });
    await requestScrutiny(ltp, app.id, META);
    await drainJobs();

    const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe('SCRUTINY_PASSED');

    await expect(upload(ltp, app.id)).rejects.toThrow(/part of the record/i);
  }, 30_000);

  it('refuses scrutiny with no drawings uploaded', async () => {
    const app = await filedApplication();
    await expect(requestScrutiny(ltp, app.id, META)).rejects.toThrow(/upload a drawing/i);
  }, 30_000);

  it('refuses scrutiny while a file is still being scanned', async () => {
    const app = await filedApplication();
    await upload(ltp, app.id);
    // Jobs deliberately NOT drained: the file is still PENDING.

    await expect(requestScrutiny(ltp, app.id, META)).rejects.toThrow(/checked for viruses/i);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Authorization
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('authorization', () => {
  it("does not let an LTP upload to another LTP's application", async () => {
    const app = await filedApplication(ltp);

    await expect(upload(otherLtp, app.id)).rejects.toThrow(/could not be found/i);
    expect(await prisma.drawing.count({ where: { applicationId: app.id } })).toBe(0);
  }, 30_000);

  it("does not let an LTP list another LTP's drawings", async () => {
    const app = await filedApplication(ltp);
    await upload(ltp, app.id);

    await expect(listDrawings(otherLtp, app.id)).rejects.toThrow(/could not be found/i);
  }, 30_000);

  it("does not let an LTP download another LTP's drawing", async () => {
    const app = await filedApplication(ltp);
    const { version } = await upload(ltp, app.id);
    await drainJobs();

    // A version id from a client means nothing on its own — scope is applied
    // to the application the version hangs off.
    await expect(downloadDrawingVersion(otherLtp, version.id, META)).rejects.toThrow(
      /could not be found/i
    );
  }, 30_000);

  it("does not let an LTP run scrutiny on another LTP's application", async () => {
    const app = await filedApplication(ltp);
    await upload(ltp, app.id);
    await drainJobs();

    await expect(requestScrutiny(otherLtp, app.id, META)).rejects.toThrow(/could not be found/i);
  }, 30_000);

  it('reports a forbidden drawing exactly as a missing one', async () => {
    const app = await filedApplication(ltp);
    const { version } = await upload(ltp, app.id);
    await drainJobs();

    const forbidden = await downloadDrawingVersion(otherLtp, version.id, META).catch((e) => e);
    const missing = await downloadDrawingVersion(
      otherLtp,
      '00000000-0000-0000-0000-000000000000',
      META
    ).catch((e) => e);

    // Distinguishing them would tell an attacker which drawing ids exist.
    expect(forbidden.status).toBe(missing.status);
    expect(forbidden.message).toBe(missing.message);
  }, 30_000);

  it('treats a malformed id as not found rather than erroring', async () => {
    await expect(downloadDrawingVersion(ltp, 'not-a-uuid', META)).rejects.toThrow(
      /could not be found/i
    );
    await expect(listDrawings(ltp, 'not-a-uuid')).rejects.toThrow(/could not be found/i);
  });

  it('audits every download, before the bytes are returned', async () => {
    const app = await filedApplication();
    const { version } = await upload(ltp, app.id);
    await drainJobs();

    await downloadDrawingVersion(ltp, version.id, META);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'DrawingVersion', entityId: version.id, action: 'DRAWING_DOWNLOADED' },
    });

    // "Who read which applicant's drawing, and when" must always be answerable.
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(ltp.id);
  }, 30_000);

  it('lets a system administrator see any drawing', async () => {
    const app = await filedApplication(ltp);
    await upload(ltp, app.id);

    const listed = await listDrawings(admin, app.id);
    expect(listed.drawings).toHaveLength(1);
  }, 30_000);
});
