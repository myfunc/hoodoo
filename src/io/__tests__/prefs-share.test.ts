import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feature } from '../../world/preview-features';
import { LiveQuality } from '../../world/world.enums';
import { defaultPrefs, exportPrefs, importPrefs, loadPrefs, savePrefs } from '../prefs';

const KEY = 'hoodoo.prefs.v1';

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  return data;
}

describe('sharing settings', () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('store only what differs from the defaults, so new site defaults still reach untouched settings', () => {
    savePrefs({ ...loadPrefs(), liveQuality: LiveQuality.Detailed });
    expect(JSON.parse(data.get(KEY)!)).toEqual({ liveQuality: LiveQuality.Detailed });
    savePrefs({ liveQuality: defaultPrefs().liveQuality });
    expect(JSON.parse(data.get(KEY)!)).toEqual({});
  });

  it('export every setting and import it back in another browser', () => {
    savePrefs({ liveQuality: LiveQuality.Full, features: [Feature.ObjectTree] });
    const file = exportPrefs('0.10.0', new Date('2026-10-11T12:00:00Z'));
    const parsed = JSON.parse(file);
    expect(parsed).toMatchObject({ kind: 'hoodoo-settings', version: '0.10.0', exported: '2026-10-11T12:00:00.000Z' });
    expect(parsed.prefs).toEqual(loadPrefs());
    data.clear();
    expect(importPrefs(file)).toBe(true);
    expect(loadPrefs()).toEqual(parsed.prefs);
  });

  it('refuse files that are not exported settings and keep the stored ones', () => {
    savePrefs({ liveQuality: LiveQuality.Full });
    const before = data.get(KEY);
    expect(importPrefs('{"kind":"other","prefs":{}}')).toBe(false);
    expect(importPrefs('not json')).toBe(false);
    expect(importPrefs('null')).toBe(false);
    expect(data.get(KEY)).toBe(before);
  });

  it('drop invalid values from an imported file', () => {
    expect(importPrefs(JSON.stringify({ kind: 'hoodoo-settings', prefs: { liveQuality: 'turbo', sidePanel: false } }))).toBe(true);
    expect(loadPrefs().liveQuality).toBe(defaultPrefs().liveQuality);
    expect(loadPrefs().sidePanel).toBe(false);
  });
});
