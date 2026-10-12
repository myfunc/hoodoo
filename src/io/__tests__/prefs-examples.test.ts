import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXAMPLE_LIST } from '../../world/example-list';
import { defaultPrefs, exportPrefs, importPrefs, loadPrefs, savePrefs } from '../prefs';

const KEY = 'hoodoo.prefs.v1';
/** The site's own list, as tools/apply-settings.mjs would write it: two old examples hidden for everyone. */
const SITE_LIST = { order: [], hidden: ['canyon', 'dunes'] };

vi.mock('../site-defaults', () => ({ SITE_DEFAULTS: { examples: { order: [], hidden: ['canyon', 'dunes'] } } }));

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  return data;
}

describe('the examples list in the settings', () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('starts from the site list, and a visitor going back to it stores nothing', () => {
    expect(defaultPrefs().examples).toEqual(SITE_LIST);
    expect(loadPrefs().examples).toEqual(SITE_LIST);
    const mine = { order: ['gambit', 'canyon'], hidden: ['arch'] };
    savePrefs({ examples: mine });
    expect(JSON.parse(data.get(KEY)!)).toEqual({ examples: mine });
    expect(loadPrefs().examples).toEqual(mine);
    savePrefs({ examples: SITE_LIST });
    expect(JSON.parse(data.get(KEY)!)).toEqual({});
  });

  it('keeps showing everything for a visitor who chose so against the site list', () => {
    savePrefs({ examples: DEFAULT_EXAMPLE_LIST });
    expect(loadPrefs().examples).toEqual(DEFAULT_EXAMPLE_LIST);
  });

  it('goes with the exported settings to another browser', () => {
    const mine = { order: ['flight', 'gambit'], hidden: ['waltz'] };
    savePrefs({ examples: mine });
    const file = exportPrefs('0.10.0', new Date('2026-10-11T12:00:00Z'));
    expect(JSON.parse(file).prefs.examples).toEqual(mine);
    data.clear();
    expect(importPrefs(file)).toBe(true);
    expect(loadPrefs().examples).toEqual(mine);
  });

  it('shows every example when the stored list is broken, like any broken setting', () => {
    data.set(KEY, JSON.stringify({ examples: { order: 'canyon', hidden: [] } }));
    expect(loadPrefs().examples).toEqual(DEFAULT_EXAMPLE_LIST);
  });
});
