import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFESSIONAL_TYPES,
  PROFESSIONAL_NEXT_STEPS,
  PROFESSIONAL_STATUSES,
  PROFESSIONAL_STEP_CAPABILITY,
  PROFESSIONAL_STEP_FROM,
  computeProfessionalValidity,
  isAvailableForApplications,
  professionalProblems,
  professionalRenewalBlocker,
  typeOption,
  unverifiedRequired,
  type ProfessionalDocument,
} from '@/lib/professional-registration';
import { ltpStepSchema } from '@/lib/schemas/applications';
import { professionalTypeSchema } from '@/lib/schemas/professional-registration';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { CAPABILITIES, ROLES } from '@/lib/constants';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOW = new Date('2026-09-25T10:00:00Z');
const TYPES = DEFAULT_PROFESSIONAL_TYPES.map((t) => typeOption({ ...t, isActive: true }));
const VALID = {
  professionalType: 'ARCHITECT',
  name: 'Test Architect',
  licenceNo: 'CA/2020/12345',
  registrationBody: 'Council of Architecture',
  qualification: 'B.Arch',
  address: 'D.No 1-2-3, Main Road, Guntur',
  pincode: '522002',
  mobile: '9000011001',
  email: 'a@example.com',
  licenceValidTo: '2030-03-31',
  consentGiven: true,
};

describe('validity — configurable, never past the licence', () => {
  it('runs the configured years from issue', () => {
    const v = computeProfessionalValidity(NOW, 3, 60, '2035-01-01');
    expect([iso(v.validFrom), iso(v.validTo), iso(v.renewalDueDate)]).toEqual([
      '2026-09-25',
      '2029-09-24',
      '2029-07-26',
    ]);
    expect(v.cappedByLicence).toBe(false);
  });
  it('ends with the licence when the licence ends first', () => {
    const v = computeProfessionalValidity(NOW, 3, 60, '2027-03-31');
    expect(iso(v.validTo)).toBe('2027-03-31');
    expect(v.cappedByLicence).toBe(true);
  });
  it('never puts the renewal date before the start', () => {
    const v = computeProfessionalValidity(NOW, 3, 60, '2026-10-10');
    expect(iso(v.renewalDueDate)).toBe('2026-09-25');
  });
  it('continues a renewal from the day after a valid predecessor ends', () => {
    const v = computeProfessionalValidity(NOW, 3, 60, '2035-01-01', '2026-11-30');
    expect([iso(v.validFrom), iso(v.validTo)]).toEqual(['2026-12-01', '2029-11-30']);
  });
  it('knows who applications may name', () => {
    expect(
      isAvailableForApplications(
        { status: 'APPROVED', isCurrent: true, validTo: '2027-01-01' },
        NOW
      )
    ).toBe(true);
    expect(
      isAvailableForApplications(
        { status: 'APPROVED', isCurrent: false, validTo: '2027-01-01' },
        NOW
      )
    ).toBe(false);
    expect(
      isAvailableForApplications(
        { status: 'APPROVED', isCurrent: true, validTo: '2026-09-24' },
        NOW
      )
    ).toBe(false);
    expect(
      isAvailableForApplications({ status: 'VERIFIED', isCurrent: true, validTo: null }, NOW)
    ).toBe(false);
  });
});

describe('particulars', () => {
  it('accepts a complete set', () => expect(professionalProblems(VALID, TYPES, NOW)).toEqual({}));
  it('requires consent, the licence validity, and refuses a lapsed licence', () => {
    expect(
      professionalProblems({ ...VALID, consentGiven: false }, TYPES, NOW).consentGiven
    ).toBeTruthy();
    expect(
      professionalProblems({ ...VALID, licenceValidTo: null }, TYPES, NOW).licenceValidTo
    ).toBeTruthy();
    expect(
      professionalProblems({ ...VALID, licenceValidTo: '2026-09-24' }, TYPES, NOW).licenceValidTo
    ).toMatch(/lapsed/);
  });
  it('refuses an unknown or retired type', () => {
    expect(
      professionalProblems({ ...VALID, professionalType: 'WIZARD' }, TYPES, NOW).professionalType
    ).toBeTruthy();
    const retired = TYPES.map((t) => (t.code === 'ARCHITECT' ? { ...t, isActive: false } : t));
    expect(professionalProblems(VALID, retired, NOW).professionalType).toMatch(/no longer/);
  });
});

describe('documents', () => {
  const doc = (
    kind: ProfessionalDocument['kind'],
    status: ProfessionalDocument['status']
  ): ProfessionalDocument => ({
    kind,
    status,
    fileObjectId: null,
    fileName: kind,
    mimeType: 'application/pdf',
    sizeBytes: 0,
    isDemo: true,
    addedAt: '',
    addedByName: '',
    round: 1,
    verifyRemarks: '',
    verifiedByName: '',
    verifiedAt: null,
  });
  it('counts only the latest version of each required document', () => {
    const docs = [
      doc('LICENCE_CERTIFICATE', 'VERIFIED'),
      doc('QUALIFICATION_CERTIFICATE', 'VERIFIED'),
      doc('ID_PROOF', 'VERIFIED'),
      doc('ADDRESS_PROOF', 'VERIFIED'),
      doc('CONSENT_LETTER', 'VERIFIED'),
    ];
    expect(unverifiedRequired(docs)).toEqual([]);
    expect(unverifiedRequired([...docs, doc('ID_PROOF', 'UPLOADED')])).toEqual(['ID_PROOF']);
    expect(unverifiedRequired(docs.slice(1))).toEqual(['LICENCE_CERTIFICATE']);
  });
});

describe('state machine and grants', () => {
  it('names a next step for every open status and none for a closed one', () => {
    for (const s of PROFESSIONAL_STATUSES)
      expect(PROFESSIONAL_NEXT_STEPS[s].length === 0).toBe(
        ['APPROVED', 'REJECTED', 'EXPIRED'].includes(s)
      );
    for (const s of PROFESSIONAL_STATUSES)
      for (const step of PROFESSIONAL_NEXT_STEPS[s])
        expect(PROFESSIONAL_STEP_FROM[step as keyof typeof PROFESSIONAL_STEP_FROM]).toBe(s);
  });
  it('gives each act to one desk, and none to the LTP, the administrator or the viewer', () => {
    const holders = (cap: string) =>
      Object.entries(RBAC_MATRIX)
        .filter(([, c]) => (c as string[]).includes(cap))
        .map(([r]) => r);
    expect(holders(CAPABILITIES.PROFESSIONAL_REG_REGISTER)).toEqual([ROLES.TPA]);
    expect(holders(CAPABILITIES.PROFESSIONAL_REG_VERIFY)).toEqual([ROLES.PLANNING_OFFICER]);
    expect(holders(CAPABILITIES.PROFESSIONAL_REG_DECIDE)).toEqual([ROLES.ZJD]);
    for (const cap of new Set(Object.values(PROFESSIONAL_STEP_CAPABILITY))) {
      for (const r of [ROLES.LTP, ROLES.SYSTEM_ADMIN, ROLES.VIEWER])
        expect(holders(cap)).not.toContain(r);
    }
    expect(holders(CAPABILITIES.PROFESSIONAL_REG_VIEW)).not.toContain(ROLES.LTP);
  });
  it('renews only in the window, once, from the current approved or expired registration', () => {
    const base = {
      status: 'APPROVED',
      isCurrent: true,
      renewalDueDate: '2026-09-01',
      openRenewalNumber: null,
      now: NOW,
    };
    expect(professionalRenewalBlocker(base)).toBeNull();
    expect(professionalRenewalBlocker({ ...base, renewalDueDate: '2026-12-01' })).toMatch(
      /opens on/
    );
    expect(professionalRenewalBlocker({ ...base, openRenewalNumber: 'PRA/2026/000001' })).toMatch(
      /under way/
    );
    expect(professionalRenewalBlocker({ ...base, status: 'VERIFIED' })).toBeTruthy();
  });
});

describe('configuration and applications', () => {
  it('seeds the four named types plus one more, each with its own prefix', () => {
    const codes = DEFAULT_PROFESSIONAL_TYPES.map((t) => t.code);
    for (const c of ['ARCHITECT', 'ENGINEER', 'STRUCTURAL_ENGINEER', 'LTP'])
      expect(codes).toContain(c);
    expect(new Set(DEFAULT_PROFESSIONAL_TYPES.map((t) => t.metadata.prefix)).size).toBe(
      codes.length
    );
    expect(TYPES.filter((t) => t.structural).map((t) => t.code)).toEqual(['STRUCTURAL_ENGINEER']);
  });
  it('validates a new type', () => {
    expect(
      professionalTypeSchema.safeParse({
        code: 'landscape_architect',
        label: 'Landscape Architect',
        prefix: 'lar',
      }).success
    ).toBe(true);
    expect(
      professionalTypeSchema.safeParse({ code: '1BAD', label: 'X', prefix: 'TOOLONG' }).success
    ).toBe(false);
  });
  it('lets the LTP step name register entries by id only — and leave them out', () => {
    expect(ltpStepSchema.parse({ declarationAccepted: true }).professionalRegistrationId).toBe('');
    expect(
      ltpStepSchema.safeParse({
        declarationAccepted: true,
        structuralEngineerRegistrationId: 'Mr Somebody',
      }).success
    ).toBe(false);
  });
});
