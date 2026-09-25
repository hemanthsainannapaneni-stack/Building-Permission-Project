import type { PrismaClient } from '@prisma/client';
import { RBAC_MATRIX } from '../../../src/lib/rbac-matrix';
import { ROLES } from '../../../src/lib/constants';
import type { AuthUser } from '../../../src/server/auth/context';
import { env } from '../../../src/server/config/env';
import {
  DEFAULT_DEVELOPER_VALIDITY_YEARS,
  DEVELOPER_VALIDITY_SETTING,
  dayOf,
  requiredDeveloperDocuments,
  type DeveloperDocumentKind,
} from '../../../src/lib/developer-registration';
import { developerDraftSchema } from '../../../src/lib/schemas/developer-registration';
import { outwardAction } from '../../../src/server/services/outward';
import { settingNumber } from '../../../src/server/services/settings';
import {
  createDeveloperDraft,
  decideDeveloperRegistration,
  expireLapsedDeveloperRegistrations,
  raiseDeveloperShortfall,
  renewDeveloperRegistration,
  respondDeveloperShortfall,
  submitDeveloperRegistration,
  takeUpDeveloperRegistration,
  verifyDeveloperRegistration,
  withDeveloperClock,
} from '../../../src/server/services/developer-registrations';

/**
 * PHASE 11 — DEVELOPER REGISTRATION, ON TOP OF THE DEMO.
 *
 * An add-on in the shape of `./occupancy`: run at the end of `index.ts`, and by
 * `scripts/seed-developers.ts` against an existing database.
 *
 * Every step goes through the REAL service as a real account holding the
 * step's capability — the TPA desk registers, submits and records answers, the
 * Planning Officer takes up, raises shortfalls and verifies, the ZJD decides.
 * Letters for approvals are dispatched through the real Outward service.
 *
 * A registration approved "three years ago" is walked with the service's
 * clock set to each step's date (`withDeveloperClock`), so it carries that
 * year's numbers, dates, events and validity — computed by the service, not
 * written by the seed. The audit trail is NOT back-dated: it records,
 * truthfully, that this seed wrote the rows today. Expiry is then applied by
 * the real sweep, today.
 *
 * Every developer, person, PAN, GSTIN, CIN, RERA number, phone and email here
 * is FICTIONAL. PANs are drawn from the ZZZ series so they cannot be mistaken
 * for issued ones; emails are on example.com. Documents are labelled demo
 * placeholders (DEMO_MODE only). Idempotent: if any developer registration
 * exists, nothing is created.
 */

const META = { ip: '127.0.0.1', userAgent: 'seed-developers', correlationId: 'phase11' };
const MATRIX = RBAC_MATRIX as unknown as Record<string, readonly string[]>;

type Target =
  | 'DRAFT'
  | 'SUBMITTED'
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
  /** For approved ones: days ago the registration was approved. */
  approvedDaysAgo?: number;
  /** For renewal-due, expired and renewal ones: days from today to the (first) registration's expiry. */
  expiresInDays?: number;
  p: Record<string, string>;
};

const DEVELOPERS: Spec[] = [
  {
    target: 'APPROVED',
    approvedDaysAgo: 240,
    p: {
      developerType: 'PRIVATE_LIMITED',
      developerName: 'Sri Sai Constructions',
      organization: 'Sri Sai Constructions Private Limited',
      authorizedPerson: 'Venkat Reddy',
      authorizedDesignation: 'Managing Director',
      address: 'D.No 12-4-88, Main Road, Brodipet',
      district: 'Guntur',
      pincode: '522002',
      mobile: '9000011001',
      email: 'office.srisaiconstructions@example.com',
      pan: 'ZZZCS1101A',
      gstin: '37ZZZCS1101A1Z4',
      incorporationNo: 'U45200AP2011PTC074411',
      incorporationDate: '2011-06-14',
      reraNo: 'AP-RERA-P-2019-0418',
      experienceYears: '14',
      projectsCompleted: '22',
      registrationInfo: 'Residential apartments and gated villas in Guntur and Mangalagiri.',
    },
  },
  {
    target: 'APPROVED',
    approvedDaysAgo: 420,
    p: {
      developerType: 'LLP',
      developerName: 'Amaravati Infra Developers',
      organization: 'Amaravati Infra Developers LLP',
      authorizedPerson: 'Lakshmi Prasad',
      authorizedDesignation: 'Designated Partner',
      address: 'Plot 7, Sai Enclave, Tadikonda Road',
      district: 'Guntur',
      pincode: '522236',
      mobile: '9000011002',
      email: 'contact.amaravatiinfra@example.com',
      pan: 'ZZZFA2202B',
      gstin: '37ZZZFA2202B1ZK',
      incorporationNo: 'AAK-4417',
      incorporationDate: '2017-02-03',
      experienceYears: '8',
      projectsCompleted: '9',
    },
  },
  {
    target: 'APPROVED_AFTER_SHORTFALL',
    approvedDaysAgo: 75,
    p: {
      developerType: 'COOPERATIVE_SOCIETY',
      developerName: 'Sarovar Housing',
      organization: 'Sarovar Employees Housing Co-operative Society Ltd',
      authorizedPerson: 'Padma Sastry',
      authorizedDesignation: 'Secretary',
      address: 'Sarovar Enclave, Canal Road, Patamata',
      district: 'Krishna',
      pincode: '520010',
      mobile: '9000011003',
      email: 'secretary.sarovarhousing@example.com',
      pan: 'ZZZAS3303C',
      incorporationNo: 'TCS/KRI/HSG/1998/0231',
      incorporationDate: '1998-11-20',
      experienceYears: '26',
      projectsCompleted: '4',
      registrationInfo: 'Builds for its own members only.',
    },
  },
  {
    target: 'RENEWAL_DUE',
    expiresInDays: 45,
    p: {
      developerType: 'PARTNERSHIP',
      developerName: 'Krishna Riverside Builders',
      organization: 'Krishna Riverside Builders',
      authorizedPerson: 'Suresh Naidu',
      authorizedDesignation: 'Managing Partner',
      address: '4th Line, Gunadala',
      district: 'Krishna',
      pincode: '520004',
      mobile: '9000011004',
      email: 'accounts.krishnariverside@example.com',
      pan: 'ZZZFK4404D',
      gstin: '37ZZZFK4404D1ZP',
      incorporationNo: 'RF/VJA/2012/0917',
      incorporationDate: '2012-08-01',
      experienceYears: '12',
      projectsCompleted: '15',
    },
  },
  {
    target: 'EXPIRED',
    expiresInDays: -26,
    p: {
      developerType: 'PRIVATE_LIMITED',
      developerName: 'Vasavi Homes',
      organization: 'Vasavi Homes Private Limited',
      authorizedPerson: 'Ramesh Gupta',
      authorizedDesignation: 'Director',
      address: 'Vasavi Township, Ring Road Service Lane, Nellore Rural',
      district: 'Nellore',
      pincode: '524004',
      mobile: '9000011005',
      email: 'info.vasavihomes@example.com',
      pan: 'ZZZCV5505E',
      gstin: '37ZZZCV5505E1Z9',
      incorporationNo: 'U70102AP2014PTC095130',
      incorporationDate: '2014-03-10',
      experienceYears: '10',
      projectsCompleted: '7',
    },
  },
  {
    target: 'RENEWED',
    expiresInDays: 60,
    p: {
      developerType: 'PRIVATE_LIMITED',
      developerName: 'Green Meadows Estates',
      organization: 'Green Meadows Estates Private Limited',
      authorizedPerson: 'Anitha Menon',
      authorizedDesignation: 'Whole-time Director',
      address: 'Green Meadows, MVP Colony',
      district: 'Visakhapatnam',
      pincode: '530017',
      mobile: '9000011006',
      email: 'legal.greenmeadows@example.com',
      pan: 'ZZZCG6606F',
      gstin: '37ZZZCG6606F1ZC',
      incorporationNo: 'U45201AP2009PTC063310',
      incorporationDate: '2009-09-25',
      reraNo: 'AP-RERA-P-2018-0122',
      experienceYears: '16',
      projectsCompleted: '31',
    },
  },
  {
    target: 'RENEWAL_IN_PROCESS',
    expiresInDays: 30,
    p: {
      developerType: 'PUBLIC_LIMITED',
      developerName: 'Coastal Heights Realty',
      organization: 'Coastal Heights Realty Limited',
      authorizedPerson: 'Harish Pillai',
      authorizedDesignation: 'Company Secretary',
      address: 'Coastal Heights, Rushikonda',
      district: 'Visakhapatnam',
      pincode: '530045',
      mobile: '9000011007',
      email: 'cs.coastalheights@example.com',
      pan: 'ZZZCC7707G',
      gstin: '37ZZZCC7707G1ZF',
      incorporationNo: 'L45200AP2005PLC047712',
      incorporationDate: '2005-01-18',
      reraNo: 'AP-RERA-P-2017-0065',
      experienceYears: '20',
      projectsCompleted: '40',
    },
  },
  {
    target: 'SHORTFALL',
    p: {
      developerType: 'PROPRIETORSHIP',
      developerName: 'Nandi Developers',
      organization: 'Nandi Developers',
      authorizedPerson: 'Gopal Rao',
      authorizedDesignation: 'Proprietor',
      address: 'Nandi Layout, Vidya Nagar',
      district: 'Kurnool',
      pincode: '518002',
      mobile: '9000011008',
      email: 'nandidevelopers@example.com',
      pan: 'ZZZPR8808H',
      incorporationNo: 'UDYAM-AP-14-0031187',
      experienceYears: '6',
      projectsCompleted: '5',
    },
  },
  {
    target: 'IN_PROCESS',
    p: {
      developerType: 'PRIVATE_LIMITED',
      developerName: 'Pearl City Projects',
      organization: 'Pearl City Projects Private Limited',
      authorizedPerson: 'Kiran Varma',
      authorizedDesignation: 'Director',
      address: 'Pearl City Layout, Magunta Layout',
      district: 'Nellore',
      pincode: '524003',
      mobile: '9000011009',
      email: 'projects.pearlcity@example.com',
      pan: 'ZZZCP9909J',
      gstin: '37ZZZCP9909J1Z2',
      incorporationNo: 'U45309AP2019PTC112874',
      incorporationDate: '2019-07-08',
      experienceYears: '5',
      projectsCompleted: '3',
    },
  },
  {
    target: 'SUBMITTED',
    p: {
      developerType: 'LLP',
      developerName: 'Sunrise Township Developers',
      organization: 'Sunrise Township Developers LLP',
      authorizedPerson: 'Swathi Chowdary',
      authorizedDesignation: 'Designated Partner',
      address: 'Sunrise Estates, Rapthadu Road',
      district: 'Anantapur',
      pincode: '515001',
      mobile: '9000011010',
      email: 'partners.sunrisetownship@example.com',
      pan: 'ZZZFS1011K',
      incorporationNo: 'ABB-2290',
      incorporationDate: '2021-10-12',
      experienceYears: '3',
      projectsCompleted: '1',
    },
  },
  {
    target: 'VERIFIED',
    p: {
      developerType: 'PARTNERSHIP',
      developerName: 'Lakeview Constructions',
      organization: 'Lakeview Constructions',
      authorizedPerson: 'Murali Bhat',
      authorizedDesignation: 'Partner',
      address: 'Lakeview Colony, Seethammadhara',
      district: 'Visakhapatnam',
      pincode: '530013',
      mobile: '9000011011',
      email: 'lakeviewconstructions@example.com',
      pan: 'ZZZFL1112L',
      gstin: '37ZZZFL1112L1ZH',
      incorporationNo: 'RF/VSP/2015/1204',
      incorporationDate: '2015-05-19',
      experienceYears: '9',
      projectsCompleted: '11',
    },
  },
  {
    target: 'DRAFT',
    p: {
      developerType: 'INDIVIDUAL',
      developerName: 'Ravi Kumar Reddy',
      authorizedPerson: 'Ravi Kumar Reddy',
      address: 'D.No 3-15, Temple Street, Ashok Nagar',
      district: 'Anantapur',
      pincode: '515004',
      mobile: '9000011012',
      email: 'ravikumar.reddy@example.com',
      pan: 'ZZZPR1213M',
      experienceYears: '4',
      projectsCompleted: '2',
    },
  },
  {
    target: 'REJECTED',
    p: {
      developerType: 'PRIVATE_LIMITED',
      developerName: 'Skyline Promoters',
      organization: 'Skyline Promoters Private Limited',
      authorizedPerson: 'Sandeep Singh',
      authorizedDesignation: 'Director',
      address: 'Station Road, Santhapet',
      district: 'Nellore',
      pincode: '524001',
      mobile: '9000011013',
      email: 'skylinepromoters@example.com',
      pan: 'ZZZCS1314N',
      incorporationNo: 'U70100AP2023PTC131907',
      incorporationDate: '2023-12-04',
      experienceYears: '1',
      projectsCompleted: '0',
    },
  },
];

// ── Actors ──────────────────────────────────────────────────────────────────

async function actorFor(prisma: PrismaClient, roleKey: string, preferEmail: string): Promise<AuthUser> {
  const candidates = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: roleKey } } } },
    include: { roles: { include: { role: true } }, jurisdictions: true },
  });
  // The plain demo account for the role, else whoever holds the fewest roles.
  const u = candidates.find((c) => c.email === preferEmail) ?? candidates.sort((a, b) => a.roles.length - b.roles.length)[0];
  if (!u) throw new Error(`No active ${roleKey} account to act as. Run the core seed first.`);
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
    sessionId: 'seed-developers',
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
/** 10:30 IST on the day `daysAgo` before today. */
function daysAgo(n: number) {
  const d = dayOf(new Date(Date.now() - n * DAY));
  return new Date(d.getTime() + 5 * 3_600_000);
}
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The approval date that makes a registration end `expiresInDays` from today, under the settings in force. */
function approvalFor(expiresInDays: number, years: number) {
  const target = dayOf(daysAgo(-expiresInDays));
  const t = plus(target, 1);
  t.setUTCFullYear(t.getUTCFullYear() - years);
  return new Date(t.getTime() + 5 * 3_600_000);
}

// ── The seed ────────────────────────────────────────────────────────────────

type Actors = { tpa: AuthUser; po: AuthUser; zjd: AuthUser };

/**
 * One registration's walk, each step at its own date. `decidedAt` is when the
 * decision falls (for the terminal and approved scenarios); in-flight ones
 * start `startDaysAgo` days back.
 */
async function walk(prisma: PrismaClient, a: Actors, spec: Spec, decidedAt: Date | null, log: (s: string) => void) {
  const p = spec.p;
  const kinds: DeveloperDocumentKind[] = [
    ...requiredDeveloperDocuments(p.developerType!, p.gstin ?? ''),
    ...(Number(p.projectsCompleted ?? 0) > 0 ? (['EXPERIENCE_CERTIFICATE'] as const) : []),
    ...(p.reraNo ? (['RERA_CERTIFICATE'] as const) : []),
  ];
  const input = developerDraftSchema.parse({ ...p, demoDocuments: true, demoKinds: kinds.join(',') });
  const start = decidedAt ? plus(decidedAt, -21) : daysAgo(IN_FLIGHT_START[spec.target] ?? 5);
  const at = <T>(offset: number, fn: () => Promise<T>) => withDeveloperClock(plus(start, offset), fn);
  const shortfall = spec.target === 'SHORTFALL' || spec.target === 'APPROVED_AFTER_SHORTFALL';

  const draft = await at(0, () => createDeveloperDraft(a.tpa, input, META));
  const id = draft.id;
  const say = (s: string) => log(`${draft.applicationNumber}  ${(p.organization || p.developerName)!.padEnd(52)} ${s}`);
  if (spec.target === 'DRAFT') return say('draft');

  await at(1, () => submitDeveloperRegistration(a.tpa, id, { remarks: 'Application received at the inward counter with the documents listed.' }, META));
  if (spec.target === 'SUBMITTED') return say('submitted');
  await at(5, () => takeUpDeveloperRegistration(a.po, id, { remarks: '' }, META));
  if (spec.target === 'IN_PROCESS') return say('in process');

  if (shortfall) {
    await at(9, () =>
      raiseDeveloperShortfall(
        a.po,
        id,
        {
          items:
            spec.target === 'SHORTFALL'
              ? ['Udyam registration certificate is not self-attested', 'Address proof is older than three months — furnish a current utility bill']
              : ['Resolution of the managing committee authorising the Secretary is not enclosed'],
          remarks: 'Documents do not fully establish the particulars claimed.',
        },
        META
      )
    );
    if (spec.target === 'SHORTFALL') return say('shortfall');
    await at(15, () =>
      respondDeveloperShortfall(
        a.tpa,
        id,
        { remarks: 'Society furnished the managing committee resolution, signed by the President.', demoDocuments: true, demoKinds: 'AUTHORIZATION_LETTER' },
        META
      )
    );
  }

  const reject = spec.target === 'REJECTED';
  await at(18, () =>
    verifyDeveloperRegistration(
      a.po,
      id,
      reject
        ? { outcome: 'RECOMMEND_REJECTION', remarks: 'Company incorporated under a year ago; no completed project to show. The experience claimed is of a director in another firm and cannot be credited to the company.' }
        : { outcome: 'RECOMMEND_APPROVAL', remarks: 'PAN, constitution and authorisation verified against originals. Address confirmed.' },
      META
    )
  );
  if (spec.target === 'VERIFIED') return say('verified — awaiting decision');
  if (reject) {
    await at(21, () => decideDeveloperRegistration(a.zjd, id, { decision: 'REJECTED', remarks: 'Rejected on the verifying desk’s findings. May apply afresh with completed-project credentials.' }, META));
    return say('rejected');
  }

  await at(21, () => decideDeveloperRegistration(a.zjd, id, { decision: 'APPROVED', remarks: 'Registered. Particulars and documents in order.' }, META));
  const row = await prisma.developerRegistration.findUniqueOrThrow({ where: { id }, select: { registrationNumber: true, validTo: true, outwardEntryId: true } });
  // The letter went out, where enough time has passed for it to.
  const sent = plus(decidedAt!, 2);
  const acknowledged = plus(decidedAt!, 7);
  if (row.outwardEntryId && acknowledged.getTime() <= Date.now()) {
    const blank = { trackingNumber: '', deliveredAt: null, acknowledgement: '', acknowledgementDate: null, dispatchDate: null, returnReason: '', remarks: '' };
    await outwardAction(a.zjd, row.outwardEntryId, { ...blank, action: 'DISPATCH', mode: 'BY_HAND', dispatchDate: ymd(sent) } as never, META);
    await outwardAction(a.zjd, row.outwardEntryId, { ...blank, action: 'RECORD_ACKNOWLEDGEMENT', acknowledgement: `Signed receipt — ${p.authorizedPerson}`, acknowledgementDate: ymd(acknowledged) } as never, META);
  }
  say(`approved ${ymd(decidedAt!)} — ${row.registrationNumber}, valid to ${ymd(row.validTo!)}`);
  return id;
}

/** Days back an in-flight application was opened. */
const IN_FLIGHT_START: Partial<Record<Target, number>> = { DRAFT: 3, SUBMITTED: 6, IN_PROCESS: 12, SHORTFALL: 20, VERIFIED: 24 };

async function renew(a: Actors, predecessorId: string, spec: Spec, log: (s: string) => void) {
  const target = spec.target;
  const name = `${spec.p.organization || spec.p.developerName} — renewal`;
  // Inside the renewal window: it opened `window` days before expiry.
  const start = daysAgo(target === 'RENEWED' ? 25 : 12);
  const at = <T>(offset: number, fn: () => Promise<T>) => withDeveloperClock(plus(start, offset), fn);
  const r = await at(0, () => renewDeveloperRegistration(a.tpa, predecessorId, { remarks: 'Renewal application received with updated authorisation.' }, META));
  await at(1, () => submitDeveloperRegistration(a.tpa, r.id, { remarks: '' }, META));
  await at(5, () => takeUpDeveloperRegistration(a.po, r.id, { remarks: '' }, META));
  if (target === 'RENEWED') {
    await at(15, () => verifyDeveloperRegistration(a.po, r.id, { outcome: 'RECOMMEND_APPROVAL', remarks: 'No change in constitution. GST and RERA registrations current.' }, META));
    await at(17, () => decideDeveloperRegistration(a.zjd, r.id, { decision: 'APPROVED', remarks: 'Renewed.' }, META));
    log(`${r.applicationNumber}  ${name.padEnd(52)} approved ${ymd(plus(start, 17))}, continuing the registration`);
  } else {
    log(`${r.applicationNumber}  ${name.padEnd(52)} in process`);
  }
}

export async function seedDevelopers(prisma: PrismaClient, opts: { apply: boolean; log: (line: string) => void }) {
  const { log } = opts;
  const existing = await prisma.developerRegistration.count();
  if (existing) {
    log(`${existing} developer registration(s) already exist — nothing to do.`);
    return { created: 0 };
  }
  if (!env.demoMode) throw new Error('Developer demo data uses demo placeholder documents and needs DEMO_MODE=true.');
  if (!opts.apply) {
    log(`Would create ${DEVELOPERS.length} fictional developers: ${DEVELOPERS.map((d) => `${d.p.developerName} (${d.target})`).join(', ')}.`);
    log('Run with --apply to create them.');
    return { created: 0 };
  }

  const a: Actors = {
    tpa: await actorFor(prisma, ROLES.TPA, 'tpa.demo@example.com'),
    po: await actorFor(prisma, ROLES.PLANNING_OFFICER, 'po.demo@example.com'),
    zjd: await actorFor(prisma, ROLES.ZJD, 'zjd.demo@example.com'),
  };
  log(`Acting as ${a.tpa.name} (TPA), ${a.po.name} (Planning Officer), ${a.zjd.name} (ZJD).`);
  const years = await settingNumber(DEVELOPER_VALIDITY_SETTING, DEFAULT_DEVELOPER_VALIDITY_YEARS);

  // Every walk and every renewal, in the order they began — so each year's
  // reference numbers run in date order, as a register's would.
  const decided = (s: Spec) =>
    s.expiresInDays != null ? approvalFor(s.expiresInDays, years) : s.approvedDaysAgo != null ? daysAgo(s.approvedDaysAgo) : s.target === 'REJECTED' ? daysAgo(27) : null;
  type Job = { start: Date; run: () => Promise<unknown> };
  const ids = new Map<Spec, string>();
  const jobs: Job[] = DEVELOPERS.map((s) => {
    const d = decided(s);
    return {
      start: d ? plus(d, -21) : daysAgo(IN_FLIGHT_START[s.target] ?? 5),
      run: async () => {
        const id = await walk(prisma, a, s, d, log);
        if (typeof id === 'string') ids.set(s, id);
      },
    };
  });
  for (const s of DEVELOPERS.filter((d) => d.target === 'RENEWED' || d.target === 'RENEWAL_IN_PROCESS')) {
    jobs.push({ start: daysAgo(s.target === 'RENEWED' ? 25 : 12), run: () => renew(a, ids.get(s)!, s, log) });
  }
  jobs.sort((x, y) => x.start.getTime() - y.start.getTime());
  for (const j of jobs) await j.run();

  const swept = await expireLapsedDeveloperRegistrations();
  log(`Expiry sweep: ${swept.expired} registration(s) expired.`);
  const total = await prisma.developerRegistration.count();
  log(`Created ${total} registration rows for ${DEVELOPERS.length} developers.`);
  return { created: total };
}
