import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, databaseAvailable, actorFor, clearStorage, META } from './setup';
import { seedRbac } from '../../prisma/seed/01-rbac';
import { seedSettings } from '../../prisma/seed/04-settings';
import { invalidateSettingsCache } from '@/server/services/settings';
import {
  createDeveloperDraft,
  decideDeveloperRegistration,
  developerRegisterSummary,
  expireLapsedDeveloperRegistrations,
  getDeveloperRegistration,
  listDeveloperRegistrations,
  raiseDeveloperShortfall,
  readDeveloperDocument,
  renewDeveloperRegistration,
  respondDeveloperShortfall,
  submitDeveloperRegistration,
  takeUpDeveloperRegistration,
  updateDeveloperDraft,
  verifyDeveloperRegistration,
  type DeveloperUploads,
} from '@/server/services/developer-registrations';
import { developerDraftSchema } from '@/lib/schemas/developer-registration';
import { isApiError } from '@/server/http/errors';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { ROLES } from '@/lib/constants';

/**
 * Phase 11 — developer registration, end to end, through the real services:
 *
 *   draft → documents → submit → take up → shortfall → answer → verify
 *   → approve (number, validity, Outward) → expiry → renewal
 *
 * with the refusals along the way: the wrong desk, a step out of order, a
 * missing document, a duplicate PAN, an early renewal, and a race.
 */

const dbUp = await databaseAvailable();
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const pdf = (name: string) => ({ name, type: 'application/pdf', bytes: PDF });
const MARK = 'test-dev';
const MATRIX = RBAC_MATRIX as unknown as Record<string, string[]>;

async function user(roleKey: string, email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return actorFor(u.id, u.name, [roleKey], { capabilities: MATRIX[roleKey] });
}

async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isApiError(error)) return { status: error.status, code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const draft = (over: Record<string, string> = {}) =>
  developerDraftSchema.parse({
    developerType: 'PRIVATE_LIMITED',
    developerName: 'Test Dev Builders',
    organization: 'Test Dev Builders Private Limited',
    authorizedPerson: 'Test Director',
    authorizedDesignation: 'Director',
    address: 'D.No 9-9-9, Test Street, Guntur',
    district: 'Guntur',
    pincode: '522002',
    mobile: '9000019001',
    email: `${MARK}-a@example.com`,
    pan: 'ZZZCT9001A',
    gstin: '37ZZZCT9001A1Z5',
    incorporationNo: 'U45200AP2020PTC000001',
    experienceYears: '5',
    ...over,
  });

const ALL_DOCS: DeveloperUploads = {
  PAN_CARD: pdf('pan.pdf'),
  INCORPORATION_PROOF: pdf('coi.pdf'),
  AUTHORIZATION_LETTER: pdf('resolution.pdf'),
  ADDRESS_PROOF: pdf('address.pdf'),
  GST_CERTIFICATE: pdf('gst.pdf'),
};

async function cleanup() {
  const rows = await prisma.developerRegistration.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  await prisma.outwardEntry.deleteMany({ where: { sourceType: 'DeveloperRegistration', sourceId: { in: ids } } });
  await prisma.developerRegistration.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!dbUp)('developer registration', () => {
  let tpa: Awaited<ReturnType<typeof user>>;
  let po: Awaited<ReturnType<typeof user>>;
  let zjd: Awaited<ReturnType<typeof user>>;
  let ltp: Awaited<ReturnType<typeof user>>;
  let viewer: Awaited<ReturnType<typeof user>>;
  let appSeqBefore: Array<{ scope: string; current: number }>;

  beforeAll(async () => {
    await seedRbac(prisma);
    await seedSettings(prisma);
    await prisma.systemSetting.update({ where: { key: 'developer_registration_validity_years' }, data: { value: '3' } });
    await prisma.systemSetting.update({ where: { key: 'developer_renewal_window_days' }, data: { value: '90' } });
    invalidateSettingsCache();
    await cleanup();
    tpa = await user(ROLES.TPA, 'tpa.demo@example.com');
    po = await user(ROLES.PLANNING_OFFICER, 'po.demo@example.com');
    zjd = await user(ROLES.ZJD, 'zjd.demo@example.com');
    ltp = await user(ROLES.LTP, 'ltp.demo@example.com');
    viewer = await user(ROLES.VIEWER, 'viewer.demo@example.com');
    appSeqBefore = await prisma.numberSequence.findMany({ where: { scope: { startsWith: 'application:' } }, select: { scope: true, current: true } });
  });

  afterAll(async () => {
    await cleanup();
    await clearStorage();
  });

  let first: { id: string; applicationNumber: string };

  it('opens a draft with its own reference, and files its documents outside any application', async () => {
    // Opened without the address proof.
    const { ADDRESS_PROOF: _skip, ...partial } = ALL_DOCS;
    first = await createDeveloperDraft(tpa, { ...draft(), uploads: partial }, META);
    expect(first.applicationNumber).toMatch(/^DRA\/\d{4}\/\d{6}$/);
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe('DRAFT');
    expect(row.lineageId).toBe(row.id);
    const docs = row.documents as Array<{ kind: string; fileObjectId: string }>;
    expect(docs.map((d) => d.kind).sort()).toEqual(['AUTHORIZATION_LETTER', 'GST_CERTIFICATE', 'INCORPORATION_PROOF', 'PAN_CARD']);
    const files = await prisma.fileObject.findMany({ where: { id: { in: docs.map((d) => d.fileObjectId) } } });
    expect(files).toHaveLength(4);
    for (const f of files) expect(f.storageKey).toMatch(new RegExp(`^developer-registrations/${row.id}/developers/`));
  });

  it('refuses the wrong desk and an incomplete submission', async () => {
    expect((await refusal(() => createDeveloperDraft(ltp, draft(), META))).status).toBe(403);
    expect((await refusal(() => createDeveloperDraft(po, draft(), META))).status).toBe(403);
    const r = await refusal(() => submitDeveloperRegistration(tpa, first.id, { remarks: '' }, META));
    expect(r.status).toBe(422);
    expect(r.message).toMatch(/proof of address/i);
    const view = await getDeveloperRegistration(tpa, first.id);
    expect(view.permissions.submit).toMatchObject({ offered: true, available: false });
  });

  it('adds the missing document to the draft, then submits', async () => {
    await updateDeveloperDraft(tpa, first.id, { ...draft({ authorizedPerson: 'Test Managing Director' }), uploads: { ADDRESS_PROOF: pdf('utility-bill.pdf') }, expectedStatus: 'DRAFT' }, META);
    const res = await submitDeveloperRegistration(tpa, first.id, { remarks: 'Received at the counter.' }, META);
    expect(res.status).toBe('SUBMITTED');
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.authorizedPerson).toBe('Test Managing Director');
    expect(row.currentDeskRoleKey).toBe(ROLES.PLANNING_OFFICER);
  });

  it('refuses a step out of order and from the wrong desk', async () => {
    expect((await refusal(() => verifyDeveloperRegistration(po, first.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'too soon' }, META))).status).toBe(409);
    expect((await refusal(() => takeUpDeveloperRegistration(tpa, first.id, { remarks: '' }, META))).status).toBe(403);
    expect((await refusal(() => takeUpDeveloperRegistration(viewer, first.id, { remarks: '' }, META))).status).toBe(403);
    expect((await refusal(() => updateDeveloperDraft(tpa, first.id, { ...draft(), uploads: {} }, META))).status).toBe(409);
  });

  it('lets exactly one of two simultaneous take-ups through', async () => {
    const results = await Promise.allSettled([
      takeUpDeveloperRegistration(po, first.id, { remarks: '' }, META),
      takeUpDeveloperRegistration(po, first.id, { remarks: '' }, META),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isApiError(lost.reason) && lost.reason.status).toBe(409);
  });

  it('raises a shortfall, records the answer as a new round, and verifies', async () => {
    await raiseDeveloperShortfall(po, first.id, { items: ['Board resolution is unsigned'], remarks: 'Resolution needs signature.' }, META);
    expect((await refusal(() => verifyDeveloperRegistration(po, first.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'x x x' }, META))).status).toBe(409);
    await respondDeveloperShortfall(tpa, first.id, { remarks: 'Signed resolution furnished by the developer.', demoDocuments: false, demoKinds: '', uploads: { AUTHORIZATION_LETTER: pdf('resolution-signed.pdf') } }, META);
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe('IN_PROCESS');
    expect(row.round).toBe(2);
    const docs = row.documents as Array<{ kind: string; round: number; fileName: string }>;
    expect(docs.filter((d) => d.kind === 'AUTHORIZATION_LETTER').map((d) => d.round)).toEqual([1, 2]);
    await verifyDeveloperRegistration(po, first.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'All verified against originals.' }, META);
    expect((await refusal(() => decideDeveloperRegistration(po, first.id, { decision: 'APPROVED', remarks: 'not mine' }, META))).status).toBe(403);
  });

  it('approves: registration number, validity from the settings, and a registration letter in Outward', async () => {
    const res = await decideDeveloperRegistration(zjd, first.id, { decision: 'APPROVED', remarks: 'Registered.' }, META);
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.registrationNumber).toMatch(/^DEV\/\d{4}\/\d{6}$/);
    expect('registrationNumber' in res && res.registrationNumber).toBe(row.registrationNumber);
    const today = new Date().toISOString().slice(0, 10);
    expect(row.issueDate!.toISOString().slice(0, 10)).toBe(today);
    expect(row.validFrom!.toISOString().slice(0, 10)).toBe(today);
    const expectedTo = new Date(`${today}T00:00:00Z`);
    expectedTo.setUTCFullYear(expectedTo.getUTCFullYear() + 3);
    expectedTo.setUTCDate(expectedTo.getUTCDate() - 1);
    expect(row.validTo!.toISOString().slice(0, 10)).toBe(expectedTo.toISOString().slice(0, 10));
    expect((row.validTo!.getTime() - row.renewalDueDate!.getTime()) / 86_400_000).toBe(90);
    expect(row.validityYears).toBe(3);
    expect(row.currentDeskRoleKey).toBe('');

    const outward = await prisma.outwardEntry.findUniqueOrThrow({ where: { id: row.outwardEntryId! } });
    expect(outward).toMatchObject({ documentType: 'REGISTRATION_LETTER', documentReference: row.registrationNumber, applicationId: null, status: 'READY_FOR_DISPATCH', sourceType: 'DeveloperRegistration' });
  });

  it('records every move as an event and a hash-chained audit row', async () => {
    const events = await prisma.developerRegistrationEvent.findMany({ where: { registrationId: first.id }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.action)).toEqual(['DRAFT_OPENED', 'DRAFT_UPDATED', 'SUBMITTED', 'TAKEN_UP', 'SHORTFALL_RAISED', 'SHORTFALL_ANSWERED', 'VERIFIED', 'APPROVED']);
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'DeveloperRegistration', entityId: first.id }, orderBy: { seq: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual([
      'DEVELOPER_REGISTRATION_DRAFTED',
      'DEVELOPER_REGISTRATION_DRAFT_UPDATED',
      'DEVELOPER_REGISTRATION_SUBMITTED',
      'DEVELOPER_REGISTRATION_TAKEN_UP',
      'DEVELOPER_REGISTRATION_SHORTFALL_RAISED',
      'DEVELOPER_REGISTRATION_SHORTFALL_ANSWERED',
      'DEVELOPER_REGISTRATION_VERIFIED',
      'DEVELOPER_REGISTRATION_APPROVED',
    ]);
    expect(audits.every((a) => a.rowHash && a.applicationId === null)).toBe(true);
    const roles = Object.fromEntries(audits.map((a) => [a.action, a.actorRoleKey]));
    expect(roles.DEVELOPER_REGISTRATION_TAKEN_UP).toBe(ROLES.PLANNING_OFFICER);
    expect(roles.DEVELOPER_REGISTRATION_APPROVED).toBe(ROLES.ZJD);
  });

  it('serves a stored document back, once scanned', async () => {
    await prisma.fileObject.updateMany({ where: { storageKey: { startsWith: `developer-registrations/${first.id}/` } }, data: { scanStatus: 'CLEAN' } });
    const f = await readDeveloperDocument(viewer, first.id, 0);
    expect(f.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists it in the right registers, and leaves application numbering alone', async () => {
    const inRegister = async (register: 'ALL' | 'APPROVED' | 'PENDING' | 'RENEWAL') =>
      (await listDeveloperRegistrations(viewer, { register, q: 'Test Dev Builders', pageSize: 100 })).rows.some((r) => r.id === first.id);
    expect(await inRegister('ALL')).toBe(true);
    expect(await inRegister('APPROVED')).toBe(true);
    expect(await inRegister('PENDING')).toBe(false);
    expect(await inRegister('RENEWAL')).toBe(false);
    const summary = await developerRegisterSummary(viewer);
    expect(summary.APPROVED).toBeGreaterThanOrEqual(1);
    const after = await prisma.numberSequence.findMany({ where: { scope: { startsWith: 'application:' } }, select: { scope: true, current: true } });
    expect(after).toEqual(appSeqBefore);
  });

  it('refuses a second registration on the same PAN', async () => {
    const dup = await createDeveloperDraft(tpa, { ...draft({ email: `${MARK}-dup@example.com` }), uploads: ALL_DOCS }, META);
    const r = await refusal(() => submitDeveloperRegistration(tpa, dup.id, { remarks: '' }, META));
    expect(r.status).toBe(409);
    expect(r.message).toMatch(/already on DEV\//);
  });

  it('does not open renewal before the window, then renews continuously once due', async () => {
    expect((await refusal(() => renewDeveloperRegistration(tpa, first.id, { remarks: '' }, META))).message).toMatch(/Renewal opens on/);
    // Fixture: bring the renewal window forward, as time would.
    const before = await prisma.developerRegistration.update({ where: { id: first.id }, data: { renewalDueDate: new Date(Date.now() - 86_400_000) } });
    const renewal = await renewDeveloperRegistration(tpa, first.id, { remarks: 'Renewal received.' }, META);
    expect((await refusal(() => renewDeveloperRegistration(tpa, first.id, { remarks: '' }, META))).message).toMatch(/already under way/);

    const r = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: renewal.id } });
    expect(r).toMatchObject({ kind: 'RENEWAL', status: 'DRAFT', isCurrent: false, registrationNumber: before.registrationNumber, lineageId: first.id, renewalOfId: first.id });
    expect((r.documents as Array<{ carriedForward?: boolean }>).every((d) => d.carriedForward)).toBe(true);
    expect((await listDeveloperRegistrations(viewer, { register: 'RENEWAL', pageSize: 100 })).rows.some((x) => x.id === renewal.id)).toBe(true);

    await submitDeveloperRegistration(tpa, renewal.id, { remarks: '' }, META);
    await takeUpDeveloperRegistration(po, renewal.id, { remarks: '' }, META);
    await verifyDeveloperRegistration(po, renewal.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'No change in constitution.' }, META);
    await decideDeveloperRegistration(zjd, renewal.id, { decision: 'APPROVED', remarks: 'Renewed.' }, META);

    const [old, next] = await Promise.all([
      prisma.developerRegistration.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.developerRegistration.findUniqueOrThrow({ where: { id: renewal.id } }),
    ]);
    expect(old.isCurrent).toBe(false);
    expect(old.supersededAt).not.toBeNull();
    expect(old.status).toBe('APPROVED');
    expect(old.validTo).toEqual(before.validTo); // the issued validity is never rewritten
    expect(next.isCurrent).toBe(true);
    expect(next.registrationNumber).toBe(before.registrationNumber);
    expect(next.validFrom!.getTime() - before.validTo!.getTime()).toBe(86_400_000);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: renewal.id, action: 'DEVELOPER_REGISTRATION_RENEWED' } });
    expect(audit).not.toBeNull();
  });

  it('expires a lapsed registration once, with an event and an audit row, and it can then be renewed', async () => {
    const lapsed = await createDeveloperDraft(tpa, { ...draft({ email: `${MARK}-b@example.com`, pan: 'ZZZCT9002B', gstin: '', developerName: 'Test Dev Lapsed' }), uploads: ALL_DOCS }, META);
    await submitDeveloperRegistration(tpa, lapsed.id, { remarks: '' }, META);
    await takeUpDeveloperRegistration(po, lapsed.id, { remarks: '' }, META);
    await verifyDeveloperRegistration(po, lapsed.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'Verified.' }, META);
    await decideDeveloperRegistration(zjd, lapsed.id, { decision: 'APPROVED', remarks: 'Registered.' }, META);
    // Fixture: the validity ended yesterday.
    await prisma.developerRegistration.update({ where: { id: lapsed.id }, data: { validTo: new Date(Date.now() - 86_400_000), renewalDueDate: new Date(Date.now() - 91 * 86_400_000) } });

    const sweep = await expireLapsedDeveloperRegistrations();
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    expect((await expireLapsedDeveloperRegistrations()).expired).toBe(0);
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: lapsed.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.expiredAt).not.toBeNull();
    const ev = await prisma.developerRegistrationEvent.findFirstOrThrow({ where: { registrationId: lapsed.id, action: 'EXPIRED' } });
    expect(ev).toMatchObject({ fromStatus: 'APPROVED', toStatus: 'EXPIRED', actorName: 'System', actorRoleKey: 'SYSTEM' });
    expect(await prisma.auditLog.count({ where: { entityId: lapsed.id, action: 'DEVELOPER_REGISTRATION_EXPIRED' } })).toBe(1);

    for (const register of ['EXPIRED', 'RENEWAL'] as const) {
      expect((await listDeveloperRegistrations(viewer, { register, pageSize: 100 })).rows.some((x) => x.id === lapsed.id)).toBe(true);
    }
    const renewal = await renewDeveloperRegistration(tpa, lapsed.id, { remarks: '' }, META);
    await submitDeveloperRegistration(tpa, renewal.id, { remarks: '' }, META);
    await takeUpDeveloperRegistration(po, renewal.id, { remarks: '' }, META);
    await verifyDeveloperRegistration(po, renewal.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'Verified.' }, META);
    await decideDeveloperRegistration(zjd, renewal.id, { decision: 'APPROVED', remarks: 'Renewed after lapse.' }, META);
    const next = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: renewal.id } });
    // A lapsed registration's renewal runs from the day of issue, not back-to-back.
    expect(next.validFrom!.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('rejects on the verifying desk’s recommendation, without a registration number', async () => {
    const r = await createDeveloperDraft(tpa, { ...draft({ email: `${MARK}-c@example.com`, pan: 'ZZZCT9003C', gstin: '', developerName: 'Test Dev Rejected' }), uploads: ALL_DOCS }, META);
    await submitDeveloperRegistration(tpa, r.id, { remarks: '' }, META);
    await takeUpDeveloperRegistration(po, r.id, { remarks: '' }, META);
    await verifyDeveloperRegistration(po, r.id, { outcome: 'RECOMMEND_REJECTION', remarks: 'No completed projects.' }, META);
    await decideDeveloperRegistration(zjd, r.id, { decision: 'REJECTED', remarks: 'Rejected.' }, META);
    const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'REJECTED', registrationNumber: null, outwardEntryId: null, currentDeskRoleKey: '' });
    expect((await listDeveloperRegistrations(viewer, { register: 'REJECTED', pageSize: 100 })).rows.some((x) => x.id === r.id)).toBe(true);
    expect((await refusal(() => renewDeveloperRegistration(tpa, r.id, { remarks: '' }, META))).status).toBe(409);
  });
});
