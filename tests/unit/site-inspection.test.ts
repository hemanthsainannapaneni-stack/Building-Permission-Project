import { describe, it, expect } from 'vitest';
import {
  canonicalReport,
  demoSiteLocation,
  distanceMetres,
  inspectionReadiness,
  offsetCoordinates,
  questionTally,
  RECOMMENDATION_ACTION,
  type ReadinessInput,
} from '@/lib/site-inspection';

const NOW = new Date('2026-09-24T12:00:00');

function ready(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    scheduledOn: '2026-09-20T10:00:00',
    inspectedAt: '2026-09-23T11:00:00',
    latitude: 16.3,
    longitude: 80.4,
    recommendation: 'RECOMMENDED',
    recommendationRemarks: 'Site conforms to the layout.',
    responses: Array.from({ length: 27 }, (_, i) => ({
      itemNumber: i + 1,
      responseType: 'YES_NO_NA',
      isMandatory: true,
      response: 'YES',
      observation: '',
      status: 'SATISFACTORY',
    })),
    photos: [{ category: 'NORTH' }, { category: 'SOUTH' }, { category: 'EAST' }, { category: 'WEST' }],
    now: NOW,
    ...overrides,
  };
}

const paths = (input: ReadinessInput) => inspectionReadiness(input).map((i) => i.path);

describe('inspectionReadiness', () => {
  it('passes a complete, consistent report', () => {
    expect(inspectionReadiness(ready())).toEqual([]);
  });

  it('requires the four cardinal photographs', () => {
    expect(paths(ready({ photos: [{ category: 'NORTH' }] }))).toContain('photos');
  });

  it('refuses a visit dated before the booking or in the future', () => {
    expect(paths(ready({ inspectedAt: '2026-09-19T10:00:00' }))).toContain('inspectedAt');
    expect(paths(ready({ inspectedAt: '2026-09-30T10:00:00' }))).toContain('inspectedAt');
    expect(paths(ready({ inspectedAt: null }))).toContain('inspectedAt');
  });

  it('requires remarks with the recommendation', () => {
    expect(paths(ready({ recommendationRemarks: 'ok' }))).toContain('recommendationRemarks');
  });

  it('will not recommend approval over a shortfall, nor a shortfall without one', () => {
    const withShortfall = ready();
    withShortfall.responses[4] = { ...withShortfall.responses[4]!, status: 'SHORTFALL', observation: 'Stones missing.' };
    expect(paths(withShortfall)).toContain('recommendation');
    expect(inspectionReadiness({ ...withShortfall, recommendation: 'SHORTFALL' })).toEqual([]);
    expect(paths(ready({ recommendation: 'SHORTFALL' }))).toContain('recommendation');
    expect(paths(ready({ recommendation: 'REJECT' }))).toContain('recommendation');
  });

  it('requires an observation for every shortfall or objection', () => {
    const r = ready({ recommendation: 'REJECT' });
    r.responses[0] = { ...r.responses[0]!, status: 'OBJECTION', observation: '' };
    expect(paths(r)).toContain('responses.1');
  });

  it('routes each recommendation to its workflow action', () => {
    expect(RECOMMENDATION_ACTION).toEqual({
      RECOMMENDED: 'SUBMIT_SITE_INSPECTION',
      REJECT: 'SUBMIT_SITE_INSPECTION',
      SHORTFALL: 'RAISE_INSPECTION_SHORTFALL',
    });
  });
});

describe('the signed document', () => {
  const base = {
    inspectionNumber: 'SI/2026/000001',
    applicationNumber: 'BP/2026/000042',
    round: 1,
    inspectorName: 'Demo TPA',
    scheduledFor: '2026-09-20T10:00:00Z',
    inspectedAt: '2026-09-23T11:00:00Z',
    latitude: 16.3,
    longitude: 80.4,
    generalObservation: 'Level.',
    recommendation: 'RECOMMENDED',
    recommendationRemarks: 'Fine.',
    responses: [
      { itemNumber: 2, question: 'B', response: 'YES', observation: '', remarks: '', status: 'SATISFACTORY' },
      { itemNumber: 1, question: 'A', response: 'NO', observation: '', remarks: '', status: 'NA' },
    ],
    photos: [
      { id: 'b', category: 'SOUTH', latitude: 16.29, longitude: 80.4, capturedAt: '2026-09-23T11:05:00Z', description: '' },
      { id: 'a', category: 'NORTH', latitude: 16.31, longitude: 80.4, capturedAt: '2026-09-23T11:04:00Z', description: '' },
    ],
  };

  it('serialises the same report identically regardless of row order', () => {
    const shuffled = { ...base, responses: [...base.responses].reverse(), photos: [...base.photos].reverse() };
    expect(canonicalReport(shuffled)).toBe(canonicalReport(base));
  });

  it('changes when any finding changes', () => {
    const edited = { ...base, responses: [{ ...base.responses[0]!, status: 'SHORTFALL' }, base.responses[1]!] };
    expect(canonicalReport(edited)).not.toBe(canonicalReport(base));
  });
});

describe('demo location', () => {
  it('is deterministic and lands within ~7 km of the district centre', () => {
    const a = demoSiteLocation('app-1', 'Guntur');
    expect(demoSiteLocation('app-1', 'guntur')).toEqual(a);
    expect(distanceMetres(a, { latitude: 16.3067, longitude: 80.4365 })).toBeLessThan(7_000);
  });

  it('offsets a photograph by the requested distance', () => {
    const p = offsetCoordinates(16.3, 80.4, 90, 12);
    expect(distanceMetres({ latitude: 16.3, longitude: 80.4 }, p)).toBeCloseTo(12, 0);
  });

  it('tallies question statuses', () => {
    expect(
      questionTally([
        { status: 'SATISFACTORY', response: 'YES' },
        { status: 'SHORTFALL', response: 'NO' },
        { status: 'PENDING', response: '' },
      ])
    ).toMatchObject({ total: 3, answered: 2, satisfactory: 1, shortfall: 1, pending: 1 });
  });
});
