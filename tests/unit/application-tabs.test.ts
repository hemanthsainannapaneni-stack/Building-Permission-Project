import { describe, expect, it } from 'vitest';
import { APPLICATION_TABS, isTabKey, resolveTabKey, visibleTabs } from '@/features/applications/application-tabs';
import { CAPABILITIES } from '@/lib/constants';

/** The application's LTP tab — renamed from "professional" when the module became the LTP module. */
describe('application tabs: the LTP tab', () => {
  it('is keyed "ltp" and shown to those who may view a change of LTP', () => {
    expect(APPLICATION_TABS.some((t) => t.key === 'ltp' && t.label === 'LTP')).toBe(true);
    expect(visibleTabs([CAPABILITIES.LTP_CHANGE_VIEW]).some((t) => t.key === 'ltp')).toBe(true);
    expect(visibleTabs([]).some((t) => t.key === 'ltp')).toBe(false);
  });

  it('still opens from a link made before the rename', () => {
    expect(resolveTabKey('professional')).toBe('ltp');
    expect(isTabKey(resolveTabKey('professional'))).toBe(true);
  });

  it('leaves every other tab key alone', () => {
    for (const t of APPLICATION_TABS) expect(resolveTabKey(t.key)).toBe(t.key);
    expect(resolveTabKey('')).toBe('');
    expect(resolveTabKey('no-such-tab')).toBe('no-such-tab');
    expect(isTabKey('professional')).toBe(false); // the old key is an alias, not a tab
  });
});
