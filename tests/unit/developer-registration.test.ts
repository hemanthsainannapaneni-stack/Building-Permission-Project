import { describe, expect, it } from 'vitest';
import {
  DEVELOPER_NEXT_STEPS,
  DEVELOPER_STATUSES,
  DEVELOPER_STEP_CAPABILITY,
  DEVELOPER_STEP_FROM,
  computeValidity,
  isLapsed,
  latestDocuments,
  particularsProblems,
  renewalBlocker,
  requiredDeveloperDocuments,
  type DeveloperDocument,
} from '@/lib/developer-registration';
import { developerDraftSchema } from '@/lib/schemas/developer-registration';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { CAPABILITIES, ROLES } from '@/lib/constants';

const iso = (d: Date) => d.toISOString().slice(0, 10);

const VALID = {
  developerType: 'PRIVATE_LIMITED',
  developerName: 'Test Builders',
  organization: 'Test Builders Private Limited',
  authorizedPerson: 'A Director',
  address: 'D.No 1-2-3, Main Road, Guntur',
  pincode: '522002',
  mobile: '9000011001',
  email: 'office@example.com',
  pan: 'ZZZCT1234A',
  gstin: '37ZZZCT1234A1Z5',
};

describe('validity', () => {
  it('runs a first registration from the day of issue, for the configured years, less a day', () => {
    const v = computeValidity(new Date('2026-09-25T10:30:00Z'), 3, 90);
    expect(iso(v.issueDate)).toBe('2026-09-25');
    expect(iso(v.validFrom)).toBe('2026-09-25');
    expect(iso(v.validTo)).toBe('2029-09-24');
    expect(iso(v.renewalDueDate)).toBe('2029-06-26');
    expect(v.validityYears).toBe(3);
  });

  it('holds 29 February to the end of February in a common year', () => {
    const v = computeValidity(new Date('2028-02-29T00:00:00Z'), 1, 0);
    expect(iso(v.validTo)).toBe('2029-02-27');
  });

  it('continues a renewal from the day after a still-valid predecessor ends', () => {
    const v = computeValidity(new Date('2026-09-25T00:00:00Z'), 3, 90, new Date('2026-11-30T00:00:00Z'));
    expect(iso(v.issueDate)).toBe('2026-09-25');
    expect(iso(v.validFrom)).toBe('2026-12-01');
    expect(iso(v.validTo)).toBe('2029-11-30');
  });

  it('runs a renewal of a lapsed registration from the day of issue', () => {
    const v = computeValidity(new Date('2026-09-25T00:00:00Z'), 3, 90, new Date('2026-08-01T00:00:00Z'));
    expect(iso(v.validFrom)).toBe('2026-09-25');
  });

  it('counts a registration as lapsed only after its last valid day', () => {
    expect(isLapsed('2026-09-25T00:00:00Z', new Date('2026-09-25T23:00:00Z'))).toBe(false);
    expect(isLapsed('2026-09-24T00:00:00Z', new Date('2026-09-25T00:10:00Z'))).toBe(true);
    expect(isLapsed(null, new Date())).toBe(false);
  });
});

describe('particulars', () => {
  it('accepts a complete, consistent set', () => {
    expect(particularsProblems(VALID)).toEqual({});
  });

  it('checks PAN form and that the PAN belongs to the developer type', () => {
    expect(particularsProblems({ ...VALID, pan: 'ABC123' }).pan).toMatch(/five letters/);
    // P = individual — not a company's PAN.
    expect(particularsProblems({ ...VALID, pan: 'ZZZPT1234A', gstin: '' }).pan).toMatch(/fourth letter P/);
    expect(particularsProblems({ ...VALID, developerType: 'INDIVIDUAL', organization: '', pan: 'ZZZPT1234A', gstin: '' })).toEqual({});
  });

  it('requires the GSTIN to carry the same PAN', () => {
    expect(particularsProblems({ ...VALID, gstin: '37ZZZCX9999A1Z5' }).gstin).toMatch(/same PAN/);
    expect(particularsProblems({ ...VALID, gstin: '37ZZZ' }).gstin).toMatch(/fifteen/);
  });

  it('requires an organisation for every type but an individual', () => {
    expect(particularsProblems({ ...VALID, organization: '' }).organization).toBeTruthy();
  });

  it('checks mobile, email and PIN code', () => {
    const p = particularsProblems({ ...VALID, mobile: '12345', email: 'nope', pincode: '0123' });
    expect(Object.keys(p).sort()).toEqual(['email', 'mobile', 'pincode']);
  });

  it('lets a draft be saved incomplete but upper-cases PAN and GSTIN', () => {
    const d = developerDraftSchema.parse({ developerType: 'LLP', developerName: 'Draft Co', pan: 'zzzfa1234b', gstin: '' });
    expect(d.pan).toBe('ZZZFA1234B');
    expect(d.experienceYears).toBeNull();
    expect(developerDraftSchema.safeParse({ developerType: 'LLP', developerName: 'X', experienceYears: '-2' }).success).toBe(false);
  });
});

describe('documents (demo rule)', () => {
  it('requires constitution and authorisation from an organisation, and the GST certificate when a GSTIN is given', () => {
    expect(requiredDeveloperDocuments('INDIVIDUAL', '')).toEqual(['PAN_CARD', 'ADDRESS_PROOF']);
    expect(requiredDeveloperDocuments('PRIVATE_LIMITED', '37ZZZCT1234A1Z5').sort()).toEqual(
      ['ADDRESS_PROOF', 'AUTHORIZATION_LETTER', 'GST_CERTIFICATE', 'INCORPORATION_PROOF', 'PAN_CARD'].sort()
    );
  });

  it('reads the latest document of each kind', () => {
    const d = (kind: DeveloperDocument['kind'], fileName: string, round: number): DeveloperDocument => ({
      kind,
      fileName,
      round,
      fileObjectId: null,
      mimeType: 'application/pdf',
      sizeBytes: 0,
      isDemo: true,
      addedAt: '',
      addedByName: '',
    });
    const latest = latestDocuments([d('PAN_CARD', 'a', 1), d('ADDRESS_PROOF', 'b', 1), d('ADDRESS_PROOF', 'c', 2)]);
    expect(latest.get('ADDRESS_PROOF')?.doc.fileName).toBe('c');
    expect(latest.get('ADDRESS_PROOF')?.index).toBe(2);
    expect(latest.size).toBe(2);
  });
});

describe('state machine', () => {
  it('names a next step for every open status and none for a closed one', () => {
    for (const s of DEVELOPER_STATUSES) {
      const closed = s === 'APPROVED' || s === 'REJECTED' || s === 'EXPIRED';
      expect(DEVELOPER_NEXT_STEPS[s].length === 0).toBe(closed);
    }
  });

  it('starts every next step from the status that lists it', () => {
    for (const s of DEVELOPER_STATUSES) {
      for (const step of DEVELOPER_NEXT_STEPS[s]) expect(DEVELOPER_STEP_FROM[step as keyof typeof DEVELOPER_STEP_FROM]).toBe(s);
    }
  });
});

describe('renewal', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  const base = { status: 'APPROVED', isCurrent: true, renewalDueDate: '2026-09-01T00:00:00Z', openRenewalNumber: null, now };
  it('opens once renewal is due, or after expiry', () => {
    expect(renewalBlocker(base)).toBeNull();
    expect(renewalBlocker({ ...base, status: 'EXPIRED', renewalDueDate: '2027-01-01T00:00:00Z' })).toBeNull();
  });
  it('refuses before the window, while a renewal is open, and on a superseded or unapproved registration', () => {
    expect(renewalBlocker({ ...base, renewalDueDate: '2026-12-01T00:00:00Z' })).toMatch(/opens on 2026-12-01/);
    expect(renewalBlocker({ ...base, openRenewalNumber: 'DRA/2026/000009' })).toMatch(/already under way/);
    expect(renewalBlocker({ ...base, isCurrent: false })).toMatch(/later registration/);
    expect(renewalBlocker({ ...base, status: 'REJECTED' })).toMatch(/approved or expired/);
  });
});

describe('grants', () => {
  const holders = (cap: string) => Object.entries(RBAC_MATRIX).filter(([, caps]) => (caps as string[]).includes(cap)).map(([role]) => role).sort();

  it('gives each step to one desk, and no step to the LTP, the administrator or the viewer', () => {
    expect(holders(CAPABILITIES.DEVELOPER_REGISTER)).toEqual([ROLES.TPA]);
    expect(holders(CAPABILITIES.DEVELOPER_VERIFY)).toEqual([ROLES.PLANNING_OFFICER]);
    expect(holders(CAPABILITIES.DEVELOPER_DECIDE)).toEqual([ROLES.ZJD]);
    for (const cap of new Set(Object.values(DEVELOPER_STEP_CAPABILITY))) {
      expect(holders(cap)).not.toContain(ROLES.LTP);
      expect(holders(cap)).not.toContain(ROLES.SYSTEM_ADMIN);
      expect(holders(cap)).not.toContain(ROLES.VIEWER);
    }
  });

  it('lets every desk, the administrator and the viewer read the register, but not the LTP', () => {
    const view = holders(CAPABILITIES.DEVELOPER_VIEW);
    for (const r of [ROLES.TPA, ROLES.PLANNING_OFFICER, ROLES.ZDD, ROLES.ZJD, ROLES.COMMISSIONER, ROLES.SYSTEM_ADMIN, ROLES.VIEWER]) expect(view).toContain(r);
    expect(view).not.toContain(ROLES.LTP);
  });
});
