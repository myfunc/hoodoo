import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feature, PREVIEW_FEATURES } from '../../world/preview-features';
import { featureInUrl, loadPrefs, saveFeature, savePrefs, startFeatures } from '../prefs';

const KEY = 'hoodoo.prefs.v1';

/** A Map-backed localStorage for node. */
function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  return data;
}

describe('preview features', () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('switch on from ?flags= in the address', () => {
    expect(featureInUrl(Feature.ObjectTree, '?flags=tree')).toBe(true);
    expect(featureInUrl(Feature.ObjectTree, '?start=0&flags=other, tree')).toBe(true);
    expect(featureInUrl(Feature.ObjectTree, '?flags=trees')).toBe(false);
    expect(featureInUrl(Feature.ObjectTree, '?tree')).toBe(false);
    expect(featureInUrl(Feature.ObjectTree, '')).toBe(false);
  });

  it('list every feature once, each with a name and a one-line description', () => {
    const ids = PREVIEW_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.values(Feature).sort());
    for (const f of PREVIEW_FEATURES) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.about).not.toMatch(/\n/);
    }
  });

  it('remember one switch at a time and keep the other settings', () => {
    savePrefs({ showStart: false });
    saveFeature(Feature.ObjectTree, true);
    expect(loadPrefs()).toMatchObject({ showStart: false, features: [Feature.ObjectTree] });
    saveFeature(Feature.ObjectTree, true);
    expect(loadPrefs().features).toEqual([Feature.ObjectTree]);
    saveFeature(Feature.ObjectTree, false);
    expect(loadPrefs().features).toEqual([]);
  });

  it('start a visit with the stored features plus those in the address, without storing the address', () => {
    expect(startFeatures(loadPrefs(), '')).toEqual({});
    expect(startFeatures(loadPrefs(), '?flags=tree')).toEqual({ [Feature.ObjectTree]: true });
    expect(loadPrefs().features).toEqual([]);
    saveFeature(Feature.ObjectTree, true);
    expect(startFeatures(loadPrefs(), '')).toEqual({ [Feature.ObjectTree]: true });
  });

  it('read the 0.6.1 Object Tree switch and drop unknown or broken entries', () => {
    data.set(KEY, JSON.stringify({ objectTree: true }));
    expect(loadPrefs().features).toEqual([Feature.ObjectTree]);
    data.set(KEY, JSON.stringify({ features: ['tree', 'nope', 7, 'tree'], objectTree: false }));
    expect(loadPrefs().features).toEqual([Feature.ObjectTree]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    data.set(KEY, '{broken');
    expect(loadPrefs().features).toEqual([]);
  });
});
