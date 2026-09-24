import { describe, it, expect } from 'vitest';
import { formatNumber, DEFAULT_NUMBER_FORMAT } from '@/server/services/numbering';

/**
 * The number FORMATTER, in isolation.
 *
 * Concurrency and gap-freedom are properties of the database and are tested
 * against a real one in tests/integration/applications.test.ts. What is
 * testable in isolation is the rendering — including the tokens an
 * administrator can put in the `application_number_format` setting, which is
 * free text and therefore worth pinning down.
 */

describe('formatNumber', () => {
  it('renders the default format', () => {
    expect(formatNumber(DEFAULT_NUMBER_FORMAT, { prefix: 'BP', year: 2026, seq: 1 })).toBe(
      'BP/2026/000001'
    );
  });

  it('zero-pads to the requested width', () => {
    expect(formatNumber('{prefix}/{year}/{seq:6}', { prefix: 'BP', year: 2026, seq: 42 })).toBe(
      'BP/2026/000042'
    );
    expect(formatNumber('{seq:3}', { prefix: 'X', year: 2026, seq: 7 })).toBe('007');
  });

  it('does not truncate a sequence wider than its padding', () => {
    // Five million applications is not a realistic year, but silently emitting
    // a shorter, colliding number would be a far worse failure than a longer
    // one.
    expect(formatNumber('{seq:6}', { prefix: 'BP', year: 2026, seq: 1_234_567 })).toBe('1234567');
  });

  it('renders an unpadded sequence', () => {
    expect(formatNumber('{prefix}-{seq}', { prefix: 'LP', year: 2026, seq: 9 })).toBe('LP-9');
  });

  it('honours a different arrangement of the same tokens', () => {
    expect(formatNumber('{year}/{prefix}/{seq:4}', { prefix: 'LP', year: 2027, seq: 12 })).toBe(
      '2027/LP/0012'
    );
  });

  it('replaces every occurrence of a repeated token', () => {
    expect(formatNumber('{prefix}{prefix}/{seq:2}', { prefix: 'A', year: 2026, seq: 3 })).toBe(
      'AA/03'
    );
  });

  it('leaves unknown tokens alone rather than emitting undefined', () => {
    // A typo in the setting should be visible in the output, not silently
    // swallowed into a number that looks plausible.
    expect(formatNumber('{prefix}/{zone}/{seq:4}', { prefix: 'BP', year: 2026, seq: 1 })).toBe(
      'BP/{zone}/0001'
    );
  });

  it('produces a distinct series for each prefix', () => {
    const building = formatNumber(DEFAULT_NUMBER_FORMAT, { prefix: 'BP', year: 2026, seq: 1 });
    const layout = formatNumber(DEFAULT_NUMBER_FORMAT, { prefix: 'LP', year: 2026, seq: 1 });

    expect(building).not.toBe(layout);
    expect(building.startsWith('BP/')).toBe(true);
    expect(layout.startsWith('LP/')).toBe(true);
  });

  it('restarts numbering each year, in the rendered value', () => {
    expect(formatNumber(DEFAULT_NUMBER_FORMAT, { prefix: 'BP', year: 2026, seq: 1 })).toBe(
      'BP/2026/000001'
    );
    expect(formatNumber(DEFAULT_NUMBER_FORMAT, { prefix: 'BP', year: 2027, seq: 1 })).toBe(
      'BP/2027/000001'
    );
  });
});
