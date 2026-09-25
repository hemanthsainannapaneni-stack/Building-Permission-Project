import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import { ROLES } from '../../../src/lib/constants';
import type { AuthUser } from '../../../src/server/auth/context';
import { env } from '../../../src/server/config/env';
import {
  DEFAULT_PROFESSIONAL_VALIDITY_YEARS,
  MOBILE_PATTERN,
  PROFESSIONAL_VALIDITY_SETTING,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
  dayOf,
  latestProfessionalDocuments,
  type ProfessionalDocument,
  type ProfessionalDocumentKind,
} from '../../../src/lib/professional-registration';
import { professionalDraftSchema } from '../../../src/lib/schemas/professional-registration';
import { outwardAction } from '../../../src/server/services/outward';
import { settingNumber } from '../../../src/server/services/settings';
import {
  checkProfessionalDocument,
  createProfessionalDraft,
  decideProfessionalRegistration,
  expireLapsedProfessionalRegistrations,
  raiseProfessionalShortfall,
  renewProfessionalRegistration,
  respondProfessionalShortfall,
  submitProfessionalRegistration,
  takeUpProfessionalRegistration,
  updateProfessionalDraft,
  verifyProfessionalRegistration,
  withProfessionalClock,
} from '../../../src/server/services/professional-registrations';

/**
 * PHASE 12 — PROFESSIONAL REGISTRATION, ON TOP OF THE DEMO.
 *
 * Two parts, each idempotent on its own:
 *
 * 1. EVERY LTP ACCOUNT that holds a licence is registered as an LTP and LINKED
 *    to that account — the register describes the person the users table
 *    already holds; it never copies them. Without this, no file could be
 *    changed to another professional (that now requires the register).
 * 2. FICTIONAL PROFESSIONALS — architects, engineers, structural engineers, a
 *    town planner — in every status and every register, none with a portal
 *    account. The structural engineers are what the LTP step offers.
 *
 * Every step goes through the REAL service as a real account holding the
 * step's capability (TPA registers, Planning Officer verifies each document
 * and the registration, ZJD decides), with the service's clock set to each
 * step's date (`withProfessionalClock`) so a registration approved years ago
 * carries that year's number and dates. The audit trail is not back-dated.
 *
 * All names, licence numbers, phones and emails are FICTIONAL; emails are on
 * example.com. Documents are labelled demo placeholders (DEMO_MODE only).
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-professionals', correlationId: 'phase12' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;
const DAY = 86_400_000;

type Target =
  | 'DRAFT'
  | 'PENDING'
  | 'IN_PROCESS'
  | 'SHORTFALL'
  | 'VERIFIED'
  | 'APPROVED'
  | 'APPROVED_AFTER_SHORTFALL'
  | 'REJECTED'
  | 'RENEWAL_DUE'
  | 'EXPIRED'
  | 'RENEWED'
  | 'RENEWAL_IN_PROCESS';

type Spec = {
  target: Target;
  approvedDaysAgo?: number;
  /** Days from today to the (first) registration's expiry. */
  expiresInDays?: number;
  /** Days from today to the licence's own expiry (default: five years on). */
  licenceEndsInDays?: number;
  p: Record<string, string>;
};

const PROFESSIONALS: Spec[] = [
  {
    target: 'APPROVED',
    approvedDaysAgo: 200,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Dr. Srinivas Murthy',
      licenceNo: 'SE/SCE/2012/0321',
      registrationBody: 'State Council of Engineers',
      qualification: 'Ph.D (Structural Engineering)',
      experienceYears: '19',
      organization: 'Murthy Structural Consultants',
      address: 'D.No 6-3-12, Bank Street, Arundelpet',
      district: 'Guntur',
      pincode: '522002',
      mobile: '9000012101',
      email: 'srinivas.murthy.se@example.com',
    },
  },
  {
    target: 'APPROVED',
    approvedDaysAgo: 500,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Kavitha Rao',
      licenceNo: 'SE/SCE/2015/0458',
      registrationBody: 'State Council of Engineers',
      qualification: 'M.Tech (Structures)',
      experienceYears: '11',
      organization: 'Sthira Structures',
      address: 'Plot 22, Housing Board Road, Patamata',
      district: 'Krishna',
      pincode: '520010',
      mobile: '9000012102',
      email: 'kavitha.rao.structures@example.com',
    },
  },
  {
    target: 'APPROVED',
    approvedDaysAgo: 40,
    licenceEndsInDays: 150,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Deepa Iyer',
      licenceNo: 'SE/SCE/2019/0702',
      registrationBody: 'State Council of Engineers',
      qualification: 'M.E (Structural Engineering)',
      experienceYears: '6',
      address: 'Flat 304, Lakeview Colony, Seethammadhara',
      district: 'Visakhapatnam',
      pincode: '530013',
      mobile: '9000012103',
      email: 'deepa.iyer.se@example.com',
    },
  },
  {
    target: 'RENEWAL_DUE',
    expiresInDays: 30,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Prakash Naidu',
      licenceNo: 'SE/SCE/2010/0133',
      registrationBody: 'State Council of Engineers',
      qualification: 'M.Tech (Structures)',
      experienceYears: '22',
      organization: 'Naidu & Associates',
      address: 'D.No 11-2-7, Station Road, Santhapet',
      district: 'Nellore',
      pincode: '524001',
      mobile: '9000012104',
      email: 'prakash.naidu.se@example.com',
    },
  },
  {
    target: 'EXPIRED',
    expiresInDays: -20,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Gopal Reddy',
      licenceNo: 'SE/SCE/2008/0087',
      registrationBody: 'State Council of Engineers',
      qualification: 'B.E (Civil), M.Tech (Structures)',
      experienceYears: '25',
      address: 'D.No 2-45, Gandhi Nagar',
      district: 'Kurnool',
      pincode: '518001',
      mobile: '9000012105',
      email: 'gopal.reddy.se@example.com',
    },
  },
  {
    target: 'RENEWAL_IN_PROCESS',
    expiresInDays: 45,
    p: {
      professionalType: 'STRUCTURAL_ENGINEER',
      name: 'Nirmala Prasad',
      licenceNo: 'SE/SCE/2013/0266',
      registrationBody: 'State Council of Engineers',
      qualification: 'M.Tech (Structures)',
      experienceYears: '14',
      organization: 'Prasad Design Engineers',
      address: 'MVP Colony, Sector 4',
      district: 'Visakhapatnam',
      pincode: '530017',
      mobile: '9000012106',
      email: 'nirmala.prasad.se@example.com',
    },
  },
  {
    target: 'APPROVED',
    approvedDaysAgo: 100,
    p: {
      professionalType: 'ARCHITECT',
      name: 'Aruna Menon',
      licenceNo: 'CA/2011/51234',
      registrationBody: 'Council of Architecture',
      qualification: 'B.Arch',
      experienceYears: '13',
      organization: 'Aakriti Architects',
      address: 'D.No 4-18, Temple Street, Lakshmipuram',
      district: 'Guntur',
      pincode: '522007',
      mobile: '9000012107',
      email: 'aruna.menon.arch@example.com',
    },
  },
  {
    target: 'RENEWED',
    expiresInDays: 50,
    p: {
      professionalType: 'ENGINEER',
      name: 'Vikram Acharya',
      licenceNo: 'ENG/SCE/2012/1190',
      registrationBody: 'State Council of Engineers',
      qualification: 'B.Tech (Civil)',
      experienceYears: '15',
      organization: 'Meridian Planners',
      address: 'D.No 8-2, Canal Road, Gunadala',
      district: 'Krishna',
      pincode: '520004',
      mobile: '9000012108',
      email: 'vikram.acharya.eng@example.com',
    },
  },
  {
    target: 'APPROVED_AFTER_SHORTFALL',
    approvedDaysAgo: 60,
    p: {
      professionalType: 'ENGINEER',
      name: 'Rajesh Bhat',
      licenceNo: 'ENG/SCE/2017/2214',
      registrationBody: 'State Council of Engineers',
      qualification: 'B.E (Civil)',
      experienceYears: '8',
      address: 'Sai Enclave, Tadikonda Road',
      district: 'Guntur',
      pincode: '522236',
      mobile: '9000012109',
      email: 'rajesh.bhat.eng@example.com',
    },
  },
  {
    target: 'SHORTFALL',
    p: {
      professionalType: 'ENGINEER',
      name: 'Harish Babu',
      licenceNo: 'ENG/SCE/2020/3051',
      registrationBody: 'State Council of Engineers',
      qualification: 'B.Tech (Civil)',
      experienceYears: '4',
      address: 'D.No 1-9, School Street, Vidya Nagar',
      district: 'Kurnool',
      pincode: '518002',
      mobile: '9000012110',
      email: 'harish.babu.eng@example.com',
    },
  },
  {
    target: 'IN_PROCESS',
    p: {
      professionalType: 'ARCHITECT',
      name: 'Sunitha Pillai',
      licenceNo: 'CA/2016/70411',
      registrationBody: 'Council of Architecture',
      qualification: 'M.Arch (Urban Design)',
      experienceYears: '9',
      organization: 'Prabhava Design Collective',
      address: 'Rushikonda Beach Road',
      district: 'Visakhapatnam',
      pincode: '530045',
      mobile: '9000012111',
      email: 'sunitha.pillai.arch@example.com',
    },
  },
  {
    target: 'PENDING',
    p: {
      professionalType: 'TOWN_PLANNER',
      name: 'Chandra Sastry',
      licenceNo: 'ITPI/AM/2009/4412',
      registrationBody: 'Institute of Town Planners',
      qualification: 'M.Plan',
      experienceYears: '16',
      address: 'D.No 5-7, Nehru Street, Brodipet',
      district: 'Guntur',
      pincode: '522002',
      mobile: '9000012112',
      email: 'chandra.sastry.planner@example.com',
    },
  },
  {
    target: 'VERIFIED',
    p: {
      professionalType: 'ENGINEER',
      name: 'Mahesh Varma',
      licenceNo: 'ENG/SCE/2014/1733',
      registrationBody: 'State Council of Engineers',
      qualification: 'B.E (Civil)',
      experienceYears: '10',
      organization: 'BluePrint Engineering',
      address: 'Magunta Layout, 3rd Cross',
      district: 'Nellore',
      pincode: '524003',
      mobile: '9000012113',
      email: 'mahesh.varma.eng@example.com',
    },
  },
  {
    target: 'REJECTED',
    p: {
      professionalType: 'ARCHITECT',
      name: 'Sandeep Mohan',
      licenceNo: 'CA/2022/88120',
      registrationBody: 'Council of Architecture',
      qualification: 'B.Arch',
      experienceYears: '1',
      address: 'Balaji Nagar, Main Road',
      district: 'Nellore',
      pincode: '524002',
      mobile: '9000012114',
      email: 'sandeep.mohan.arch@example.com',
    },
  },
  {
    target: 'DRAFT',
    p: {
      professionalType: 'ARCHITECT',
      name: 'Swathi Nair',
      licenceNo: 'CA/2021/84407',
      registrationBody: 'Council of Architecture',
      qualification: 'B.Arch',
      experienceYears: '3',
      address: 'Shanti Nagar, 2nd Line',
      district: 'Anantapur',
      pincode: '515001',
      mobile: '9000012115',
      email: 'swathi.nair.arch@example.com',
    },
  },
];

// ── Actors and dates ────────────────────────────────────────────────────────

async function actorFor(
  prisma: PrismaClient,
  roleKey: string,
  preferEmail: string
): Promise<AuthUser> {
  const candidates = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: roleKey } } } },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });
  // The plain demo account for the role, else the one holding the fewest roles — never the all-roles admin.
  const u =
    candidates.find((c) => c.email === preferEmail) ??
    candidates.sort((a, b) => a.roles.length - b.roles.length)[0];
  if (!u) throw new Error(`No active ${roleKey} account to act as. Run the core seed first.`);
  const roleKeys = u.roles.map((r) => r.role.key);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleKeys: roleKeys as never,
    roleNames: u.roles.map((r) => r.role.name),
    capabilities: [...new Set(roleKeys.flatMap((k) => MATRIX[k] ?? []))],
    zoneIds: [
      ...new Set([
        ...(u.primaryZoneId ? [u.primaryZoneId] : []),
        ...u.jurisdictions.map((j) => j.zoneId),
      ]),
    ],
    officeId: u.officeId ?? null,
    sessionId: 'seed-professionals',
  };
}

function daysAgo(n: number) {
  return new Date(dayOf(new Date(Date.now() - n * DAY)).getTime() + 5 * 3_600_000);
}
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function approvalFor(expiresInDays: number, years: number) {
  const t = plus(dayOf(daysAgo(-expiresInDays)), 1);
  t.setUTCFullYear(t.getUTCFullYear() - years);
  return new Date(t.getTime() + 5 * 3_600_000);
}

type Actors = { tpa: AuthUser; po: AuthUser; zjd: AuthUser };

const EXTRA: ProfessionalDocumentKind[] = ['PHOTOGRAPH', 'EXPERIENCE_CERTIFICATE'];

/** The verifying desk checks every latest document, except those named. */
async function verifyDocuments(
  prisma: PrismaClient,
  a: Actors,
  id: string,
  except: ProfessionalDocumentKind[] = [],
  limit = Infinity
) {
  const row = await prisma.professionalRegistration.findUniqueOrThrow({
    where: { id },
    select: { documents: true },
  });
  let n = 0;
  for (const { doc, index } of latestProfessionalDocuments(
    row.documents as unknown as ProfessionalDocument[]
  ).values()) {
    if (except.includes(doc.kind) || doc.status === 'VERIFIED' || n >= limit) continue;
    await checkProfessionalDocument(a.po, id, { index, decision: 'VERIFIED', remarks: '' }, META);
    n += 1;
  }
}

/** One registration's walk, each step at its own date. */
async function walk(
  prisma: PrismaClient,
  a: Actors,
  spec: Spec & { userId?: string },
  decidedAt: Date | null,
  log: (s: string) => void
) {
  const p = spec.p;
  const start = decidedAt ? plus(decidedAt, -21) : daysAgo(IN_FLIGHT_START[spec.target] ?? 5);
  const licenceEnds =
    spec.licenceEndsInDays != null
      ? daysAgo(-spec.licenceEndsInDays)
      : plus(start, 5 * 366 + 3 * 366);
  const input = professionalDraftSchema.parse({
    ...p,
    userId: spec.userId ?? '',
    licenceValidTo: p.licenceValidTo ?? ymd(licenceEnds),
    consentGiven: 'true',
    demoDocuments: true,
    demoKinds: [...REQUIRED_PROFESSIONAL_DOCUMENTS, ...EXTRA].join(','),
  });
  const at = <T>(offset: number, fn: () => Promise<T>) =>
    withProfessionalClock(plus(start, offset), fn);
  const shortfall = spec.target === 'SHORTFALL' || spec.target === 'APPROVED_AFTER_SHORTFALL';

  const draft = await at(0, () => createProfessionalDraft(a.tpa, input, META));
  const id = draft.id;
  const say = (s: string) =>
    log(
      `${draft.applicationNumber}  ${`${p.name} (${(p.professionalType ?? '').toLowerCase().replace(/_/g, ' ')})`.padEnd(52)} ${s}`
    );
  if (spec.target === 'DRAFT') {
    say('draft');
    return id;
  }

  await at(1, () =>
    submitProfessionalRegistration(
      a.tpa,
      id,
      { remarks: 'Application received at the inward counter with the documents listed.' },
      META
    )
  );
  if (spec.target === 'PENDING') {
    say('pending');
    return id;
  }
  await at(4, () => takeUpProfessionalRegistration(a.po, id, { remarks: '' }, META));
  if (spec.target === 'IN_PROCESS') {
    await at(5, () => verifyDocuments(prisma, a, id, [], 3));
    say('in process — 3 documents verified so far');
    return id;
  }

  if (shortfall) {
    await at(6, () => verifyDocuments(prisma, a, id, ['QUALIFICATION_CERTIFICATE']));
    const row = await prisma.professionalRegistration.findUniqueOrThrow({
      where: { id },
      select: { documents: true },
    });
    const q = latestProfessionalDocuments(row.documents as unknown as ProfessionalDocument[]).get(
      'QUALIFICATION_CERTIFICATE'
    )!;
    await at(6, () =>
      checkProfessionalDocument(
        a.po,
        id,
        {
          index: q.index,
          decision: 'REJECTED',
          remarks: 'Copy illegible; university seal not visible.',
        },
        META
      )
    );
    await at(7, () =>
      raiseProfessionalShortfall(
        a.po,
        id,
        {
          items: [
            'Degree certificate: furnish a legible attested copy showing the university seal',
          ],
          remarks: 'One document could not be verified.',
        },
        META
      )
    );
    if (spec.target === 'SHORTFALL') {
      say('shortfall');
      return id;
    }
    await at(13, () =>
      respondProfessionalShortfall(
        a.tpa,
        id,
        {
          remarks: 'Attested copy of the degree certificate furnished, seal legible.',
          demoDocuments: true,
          demoKinds: 'QUALIFICATION_CERTIFICATE',
        },
        META
      )
    );
  }
  await at(16, () => verifyDocuments(prisma, a, id));

  const reject = spec.target === 'REJECTED';
  await at(18, () =>
    verifyProfessionalRegistration(
      a.po,
      id,
      reject
        ? {
            outcome: 'RECOMMEND_REJECTION',
            remarks:
              'The Council’s register shows the licence under suspension pending an inquiry; it cannot be registered while suspended.',
          }
        : {
            outcome: 'RECOMMEND_APPROVAL',
            remarks:
              'Licence confirmed with the registration body; qualification and identity verified against originals.',
          },
      META
    )
  );
  if (spec.target === 'VERIFIED') {
    say('verified — awaiting decision');
    return id;
  }
  if (reject) {
    await at(21, () =>
      decideProfessionalRegistration(
        a.zjd,
        id,
        {
          decision: 'REJECTED',
          remarks:
            'Rejected while the licence is suspended. May apply again once the Council lifts it.',
        },
        META
      )
    );
    {
      say('rejected');
      return id;
    }
  }

  await at(21, () =>
    decideProfessionalRegistration(
      a.zjd,
      id,
      { decision: 'APPROVED', remarks: 'Registered. Particulars and documents in order.' },
      META
    )
  );
  const row = await prisma.professionalRegistration.findUniqueOrThrow({
    where: { id },
    select: {
      registrationNumber: true,
      validTo: true,
      outwardEntryId: true,
      cappedByLicence: true,
    },
  });
  const sent = plus(decidedAt!, 2);
  const acknowledged = plus(decidedAt!, 7);
  if (row.outwardEntryId && acknowledged.getTime() <= Date.now()) {
    const blank = {
      trackingNumber: '',
      deliveredAt: null,
      acknowledgement: '',
      acknowledgementDate: null,
      dispatchDate: null,
      returnReason: '',
      remarks: '',
    };
    await outwardAction(
      a.zjd,
      row.outwardEntryId,
      { ...blank, action: 'DISPATCH', mode: 'BY_HAND', dispatchDate: ymd(sent) } as never,
      META
    );
    await outwardAction(
      a.zjd,
      row.outwardEntryId,
      {
        ...blank,
        action: 'RECORD_ACKNOWLEDGEMENT',
        acknowledgement: `Signed receipt — ${p.name}`,
        acknowledgementDate: ymd(acknowledged),
      } as never,
      META
    );
  }
  say(
    `approved ${ymd(decidedAt!)} — ${row.registrationNumber}, valid to ${ymd(row.validTo!)}${row.cappedByLicence ? ' (ends with the licence)' : ''}`
  );
  return id;
}

const IN_FLIGHT_START: Partial<Record<Target, number>> = {
  DRAFT: 2,
  PENDING: 5,
  IN_PROCESS: 9,
  SHORTFALL: 16,
  VERIFIED: 22,
  REJECTED: 40,
};

async function renew(
  prisma: PrismaClient,
  a: Actors,
  predecessorId: string,
  spec: Spec,
  log: (s: string) => void
) {
  // Inside the renewal window (it opens `window` days before expiry).
  const start = daysAgo(spec.target === 'RENEWED' ? 9 : 12);
  const at = <T>(offset: number, fn: () => Promise<T>) =>
    withProfessionalClock(plus(start, offset), fn);
  const r = await at(0, () =>
    renewProfessionalRegistration(
      a.tpa,
      predecessorId,
      {
        remarks: 'Renewal application received with the licence renewed by the Council.',
        licenceValidTo: null,
      },
      META
    )
  );
  // Consent is given afresh; the draft is saved with it.
  const draft = await prisma.professionalRegistration.findUniqueOrThrow({ where: { id: r.id } });
  await at(0, () =>
    updateProfessionalDraft(
      a.tpa,
      r.id,
      {
        ...professionalDraftSchema.parse({
          ...spec.p,
          licenceValidTo: ymd(draft.licenceValidTo!),
          consentGiven: 'true',
          demoDocuments: true,
          demoKinds: 'CONSENT_LETTER',
        }),
        expectedStatus: 'DRAFT',
      },
      META
    )
  );
  await at(1, () => submitProfessionalRegistration(a.tpa, r.id, { remarks: '' }, META));
  await at(3, () => takeUpProfessionalRegistration(a.po, r.id, { remarks: '' }, META));
  const name = `${spec.p.name} — renewal`;
  if (spec.target === 'RENEWED') {
    await at(5, () => verifyDocuments(prisma, a, r.id));
    await at(6, () =>
      verifyProfessionalRegistration(
        a.po,
        r.id,
        {
          outcome: 'RECOMMEND_APPROVAL',
          remarks: 'Licence renewed by the Council; no change in particulars.',
        },
        META
      )
    );
    await at(8, () =>
      decideProfessionalRegistration(
        a.zjd,
        r.id,
        { decision: 'APPROVED', remarks: 'Renewed.' },
        META
      )
    );
    log(
      `${r.applicationNumber}  ${name.padEnd(52)} approved ${ymd(plus(start, 8))}, continuing the registration`
    );
  } else {
    log(`${r.applicationNumber}  ${name.padEnd(52)} in process`);
  }
}

// ── Part 1: every licensed LTP account, linked ──────────────────────────────

type Job = { start: Date; run: () => Promise<unknown> };

/** One job per licensed LTP account not yet on the register. */
async function ltpAccountJobs(
  prisma: PrismaClient,
  a: Actors,
  log: (s: string) => void
): Promise<Job[]> {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      ltpLicenceNo: { not: null },
      roles: { some: { role: { key: ROLES.LTP } } },
    },
    orderBy: { email: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      firmName: true,
      ltpLicenceNo: true,
      ltpValidUpto: true,
      professionalRegistrations: { select: { id: true } },
    },
  });
  const todo = users.filter((u) => !u.professionalRegistrations.length);
  log(`LTP accounts with a licence: ${users.length}; to register: ${todo.length}.`);
  const jobs: Job[] = [];
  for (const [i, u] of todo.entries()) {
    if (u.ltpValidUpto && u.ltpValidUpto.getTime() < Date.now()) {
      log(
        `  ${u.email}: licence ${u.ltpLicenceNo} lapsed ${ymd(u.ltpValidUpto)} — not registered.`
      );
      continue;
    }
    const decidedAt = daysAgo(300 + i * 25);
    const spec: Spec & { userId: string } = {
      target: 'APPROVED',
      userId: u.id,
      p: {
        professionalType: 'LTP',
        name: u.name,
        licenceNo: u.ltpLicenceNo!,
        registrationBody: 'The Authority (LTP licence)',
        qualification: 'B.Arch',
        experienceYears: String(8 + (i % 7)),
        organization: u.firmName ?? '',
        address: `${u.firmName ?? 'Office'}, Main Road, Brodipet`,
        district: 'Guntur',
        pincode: '522002',
        mobile:
          u.phone && MOBILE_PATTERN.test(u.phone)
            ? u.phone
            : `90000130${String(i).padStart(2, '0')}`,
        email: u.email,
        licenceValidTo: u.ltpValidUpto ? ymd(u.ltpValidUpto) : ymd(daysAgo(-3 * 365)),
      },
    };
    jobs.push({ start: plus(decidedAt, -21), run: () => walk(prisma, a, spec, decidedAt, log) });
  }
  return jobs;
}

// ── The seed ────────────────────────────────────────────────────────────────

export async function seedProfessionals(
  prisma: PrismaClient,
  opts: { apply: boolean; log: (line: string) => void }
) {
  const { log } = opts;
  if (!env.demoMode)
    throw new Error(
      'LTP demo data uses demo placeholder documents and needs DEMO_MODE=true.'
    );
  const types = await prisma.masterData.count({ where: { category: 'PROFESSIONAL_TYPE' } });
  if (!types)
    throw new Error('No LTP types configured. Run `npm run professionals:config` first.');

  const a: Actors = {
    tpa: await actorFor(prisma, ROLES.TPA, 'tpa.demo@example.com'),
    po: await actorFor(prisma, ROLES.PLANNING_OFFICER, 'po.demo@example.com'),
    zjd: await actorFor(prisma, ROLES.ZJD, 'zjd.demo@example.com'),
  };

  const jobs = await ltpAccountJobs(prisma, a, log);
  const linked = jobs.length;

  const fictional = await prisma.professionalRegistration.count({ where: { userId: null } });
  if (fictional) {
    log(
      `${fictional} unlinked LTP registration(s) already exist — fictional LTPs not added again.`
    );
  } else {
    log(
      `${opts.apply ? 'Creating' : 'Would create'} ${PROFESSIONALS.length} fictional LTPs: ${PROFESSIONALS.map((d) => `${d.p.name} (${d.target})`).join(', ')}.`
    );
    const years = await settingNumber(
      PROFESSIONAL_VALIDITY_SETTING,
      DEFAULT_PROFESSIONAL_VALIDITY_YEARS
    );
    const decided = (s: Spec) =>
      s.expiresInDays != null
        ? approvalFor(s.expiresInDays, years)
        : s.approvedDaysAgo != null
          ? daysAgo(s.approvedDaysAgo)
          : s.target === 'REJECTED'
            ? daysAgo(19)
            : null;
    const ids = new Map<Spec, string>();
    for (const s of PROFESSIONALS) {
      const d = decided(s);
      jobs.push({
        start: d ? plus(d, -21) : daysAgo(IN_FLIGHT_START[s.target] ?? 5),
        run: async () => ids.set(s, await walk(prisma, a, s, d, log)),
      });
    }
    for (const s of PROFESSIONALS.filter(
      (d) => d.target === 'RENEWED' || d.target === 'RENEWAL_IN_PROCESS'
    )) {
      jobs.push({
        start: daysAgo(s.target === 'RENEWED' ? 9 : 12),
        run: () => renew(prisma, a, ids.get(s)!, s, log),
      });
    }
  }

  if (!opts.apply) {
    log('Run with --apply to create them.');
    return { created: 0 };
  }
  log(`Acting as ${a.tpa.name} (TPA), ${a.po.name} (Planning Officer), ${a.zjd.name} (ZJD).`);
  // Everything in the order it began, so each year's numbers run in date order.
  jobs.sort((x, y) => x.start.getTime() - y.start.getTime());
  for (const j of jobs) await j.run();

  const swept = await expireLapsedProfessionalRegistrations();
  log(`Expiry sweep: ${swept.expired} registration(s) expired.`);
  const total = await prisma.professionalRegistration.count();
  log(`Registered ${linked} LTP account(s); ${total} registration rows in all.`);
  return { created: total };
}
