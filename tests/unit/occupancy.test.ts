import { describe, it, expect } from 'vitest';
import {
  AS_BUILT_PARAMETERS,
  NEXT_STEPS,
  OCCUPANCY_REGISTER_STATES,
  OCCUPANCY_STATUSES,
  OCCUPANCY_STEP_ACTION,
  OCCUPANCY_STEP_CAPABILITY,
  STEP_FROM,
  compareAsBuilt,
  completionDateProblem,
  demoAsBuilt,
  deviationsOf,
  missingOccupancyDocuments,
  occupancyBlocker,
  statusAfterInspection,
  type AsBuiltFigures,
} from '@/lib/occupancy';
import { statusMeta } from '@/lib/status';
import { ACTIONS, EFFECTS, GUARDS } from '@/lib/workflow';
import { CAPABILITIES, ROLES } from '@/lib/constants';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import { transitionsOf } from '../../prisma/seed/workflow/builder';
import { BBAS_STANDARD } from '../../prisma/seed/workflow/bbas-standard';
import { inspectOccupancySchema, shortfallOccupancySchema, submitOccupancySchema } from '@/lib/schemas/occupancy';

/**
 * Phase 10 — occupancy. The state machine, the rule that nothing is applied
 * for before approval, an issued proceeding and commenced work, the as-built
 * comparison, and the workflow rows and grants that record each step.
 */

const NOW = new Date('2026-09-24T10:00:00Z');
const OK = {
  applicationStatus: 'APPROVED',
  order: { status: 'ISSUED', revokedAt: null },
  commencementDate: '2026-06-01',
  requiresCommencement: true,
  openOccupancyNumber: null,
  certificateIssued: false,
  now: NOW,
};

describe('no occupancy before the permission, the proceeding and the work', () => {
  it.each(['SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'PROCEEDING_REVOKED', 'WITHDRAWN'])('refuses a %s file', (status) => {
    expect(occupancyBlocker({ ...OK, applicationStatus: status })).toMatch(/approved/);
  });
  it('refuses until the BPO is issued, and after it is revoked', () => {
    expect(occupancyBlocker({ ...OK, order: null })).toMatch(/not been issued/);
    expect(occupancyBlocker({ ...OK, order: { status: 'APPROVED', revokedAt: null } })).toMatch(/not been issued/);
    expect(occupancyBlocker({ ...OK, order: { status: 'ISSUED', revokedAt: NOW } })).toMatch(/not been issued/);
  });
  it('requires work initiated where the workflow requires it', () => {
    expect(occupancyBlocker({ ...OK, commencementDate: null })).toMatch(/Commencement/);
    expect(occupancyBlocker({ ...OK, commencementDate: '2026-10-01' })).toMatch(/not commenced/);
    expect(occupancyBlocker({ ...OK, commencementDate: null, requiresCommencement: false })).toBeNull();
  });
  it('refuses a second application, and one after a certificate', () => {
    expect(occupancyBlocker({ ...OK, openOccupancyNumber: 'OCC/2026/000001' })).toMatch(/still open/);
    expect(occupancyBlocker({ ...OK, certificateIssued: true })).toMatch(/already been issued/);
  });
  it('allows an approved, issued, commenced file', () => {
    expect(occupancyBlocker(OK)).toBeNull();
  });
  it('completion date: after commencement, not in the future', () => {
    expect(completionDateProblem('2026-05-01', '2026-06-01', NOW)).toMatch(/precede/);
    expect(completionDateProblem('2026-10-01', '2026-06-01', NOW)).toMatch(/future/);
    expect(completionDateProblem('2026-09-20', '2026-06-01', NOW)).toBeNull();
  });
});

describe('state machine', () => {
  it('each step starts from exactly one status and every open status has a next step', () => {
    for (const s of OCCUPANCY_STATUSES) {
      const open = !['CERTIFICATE_ISSUED', 'REJECTED'].includes(s);
      expect(NEXT_STEPS[s].length > 0).toBe(open);
      for (const step of NEXT_STEPS[s]) expect(STEP_FROM[step as keyof typeof STEP_FROM]).toBe(s);
    }
  });
  it('the inspection recommendation routes the application', () => {
    expect(statusAfterInspection('RECOMMENDED')).toBe('INSPECTION_COMPLETED');
    expect(statusAfterInspection('REJECT')).toBe('INSPECTION_COMPLETED');
    expect(statusAfterInspection('SHORTFALL')).toBe('SHORTFALL');
  });
  it('every register state has a badge', () => {
    for (const s of OCCUPANCY_REGISTER_STATES) expect(statusMeta('occupancy', s).label).not.toBe(s);
  });
});

describe('approved vs as built', () => {
  const approved: AsBuiltFigures = {
    plotAreaSqm: 300,
    builtUpAreaSqm: 480,
    coveragePercent: 55,
    fsi: 1.6,
    heightM: 12,
    floors: 4,
    setbackMinM: 2,
    parkingAreaSqm: 60,
  };
  it('as approved is within tolerance everywhere', () => {
    expect(deviationsOf(compareAsBuilt(approved, approved))).toEqual([]);
  });
  it('flags more than sanctioned, and less setback or parking', () => {
    const rows = compareAsBuilt(approved, { ...approved, builtUpAreaSqm: 520, floors: 5, setbackMinM: 1.5, parkingAreaSqm: 50 });
    expect(deviationsOf(rows).map((r) => r.key).sort()).toEqual(['builtUpAreaSqm', 'floors', 'parkingAreaSqm', 'setbackMinM']);
  });
  it('does not flag building less, or leaving more open', () => {
    expect(deviationsOf(compareAsBuilt(approved, { ...approved, builtUpAreaSqm: 450, setbackMinM: 2.5 }))).toEqual([]);
  });
  it('an unrecorded figure is not a deviation', () => {
    expect(compareAsBuilt(approved, {}).every((r) => r.verdict === 'NOT_RECORDED')).toBe(true);
  });
  it('demo figures: compliant stays within, deviation does not, and both are repeatable', () => {
    expect(deviationsOf(compareAsBuilt(approved, demoAsBuilt(approved, 'x', 'COMPLIANT')))).toEqual([]);
    expect(deviationsOf(compareAsBuilt(approved, demoAsBuilt(approved, 'x', 'DEVIATION'))).length).toBeGreaterThan(0);
    expect(demoAsBuilt(approved, 'seed', 'COMPLIANT')).toEqual(demoAsBuilt(approved, 'seed', 'COMPLIANT'));
  });
  it('compares the eight parameters', () => {
    expect(AS_BUILT_PARAMETERS.map((p) => p.label)).toEqual([
      'Plot area', 'Built-up area', 'Coverage', 'FSI', 'Height', 'Floors', 'Setbacks (least of four)', 'Parking',
    ]);
  });
});

describe('workflow configuration', () => {
  const rows = transitionsOf(BBAS_STANDARD).filter((r) => r.effects?.some((e) => e.type === EFFECTS.OCCUPANCY));
  const codes = [...Object.values(OCCUPANCY_STEP_ACTION), ACTIONS.APPROVE_OCCUPANCY, ACTIONS.REJECT_OCCUPANCY];

  it('one row per action, all out of CLOSED_APPROVED from APPROVED, none moving the file', () => {
    expect(rows.map((r) => r.action).sort()).toEqual([...codes].sort());
    for (const r of rows) {
      expect(r.from).toBe('CLOSED_APPROVED');
      expect(r.to).toBe('CLOSED_APPROVED');
      expect(r.fromStatus).toBe('APPROVED');
      expect(r.effects?.[0]?.type).toBe(EFFECTS.KEEP_STATUS);
    }
  });
  it('submission requires the issued proceeding and work initiated', () => {
    const submit = rows.find((r) => r.action === ACTIONS.SUBMIT_OCCUPANCY)!;
    expect(submit.guards).toEqual([GUARDS.PROCEEDING_ISSUED, GUARDS.WORK_INITIATED, GUARDS.NO_OPEN_OCCUPANCY]);
    expect(submit.notify).toBe('OCCUPANCY_SUBMITTED');
  });
  it('every later step is ordered by a status guard', () => {
    const want: Record<string, string> = {
      SCHEDULE_FINAL_INSPECTION: GUARDS.OCCUPANCY_SUBMITTED,
      RECORD_FINAL_INSPECTION: GUARDS.OCCUPANCY_INSPECTION_PENDING,
      RECOMMEND_OCCUPANCY: GUARDS.OCCUPANCY_INSPECTION_COMPLETED,
      RAISE_OCCUPANCY_SHORTFALL: GUARDS.OCCUPANCY_INSPECTION_COMPLETED,
      RESPOND_OCCUPANCY_SHORTFALL: GUARDS.OCCUPANCY_SHORTFALL,
      APPROVE_OCCUPANCY: GUARDS.OCCUPANCY_RECOMMENDED,
      REJECT_OCCUPANCY: GUARDS.OCCUPANCY_RECOMMENDED,
      ISSUE_OCCUPANCY_CERTIFICATE: GUARDS.OCCUPANCY_APPROVED,
    };
    for (const [action, guard] of Object.entries(want)) expect(rows.find((r) => r.action === action)!.guards?.[0]).toBe(guard);
  });
});

describe('grants — one desk per part, no invented role', () => {
  const holders = (cap: string) => Object.entries(RBAC_MATRIX).filter(([, caps]) => caps.includes(cap as never)).map(([r]) => r);
  it('LTP submits, TPA inspects, ZDD reviews, ZJD decides', () => {
    expect(holders(CAPABILITIES.OCCUPANCY_SUBMIT)).toEqual([ROLES.LTP]);
    expect(holders(CAPABILITIES.OCCUPANCY_INSPECT)).toEqual([ROLES.TPA]);
    expect(holders(CAPABILITIES.OCCUPANCY_REVIEW)).toEqual([ROLES.ZDD]);
    expect(holders(CAPABILITIES.OCCUPANCY_DECIDE)).toEqual([ROLES.ZJD]);
  });
  it('every step maps to one of those capabilities', () => {
    for (const cap of Object.values(OCCUPANCY_STEP_CAPABILITY)) expect(Object.values(CAPABILITIES)).toContain(cap);
  });
});

describe('input', () => {
  it('requires the completion letter and the as-built drawing', () => {
    expect(missingOccupancyDocuments(['COMPLETION_LETTER'])).toEqual(['AS_BUILT_DRAWING']);
    expect(missingOccupancyDocuments(['COMPLETION_LETTER', 'AS_BUILT_DRAWING'])).toEqual([]);
  });
  it('parses multipart as-built figures', () => {
    const r = inspectOccupancySchema.parse({
      inspectionDate: '2026-09-20',
      siteCondition: 'Complete, finishes done',
      actualConstruction: 'G+3 residential',
      remarks: 'Inspected',
      recommendation: 'RECOMMENDED',
      asBuilt: JSON.stringify({ builtUpAreaSqm: '481.5', floors: 4 }),
    });
    expect(r.asBuilt).toMatchObject({ builtUpAreaSqm: 481.5, floors: 4 });
  });
  it('rejects an empty shortfall and a missing completion date', () => {
    expect(shortfallOccupancySchema.safeParse({ items: [], remarks: 'Items below' }).success).toBe(false);
    expect(submitOccupancySchema.safeParse({ completionDate: '' }).success).toBe(false);
  });
});
