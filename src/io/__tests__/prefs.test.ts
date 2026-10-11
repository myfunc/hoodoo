import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feature, PREVIEW_FEATURES } from '../../world/preview-features';
import { INITIAL_EDITOR } from '../../world/editor-store';
import { DEFAULT_SETTINGS, MessageTime, OrbitSpeed, SNAP_GRID_STEPS, WalkSpeed } from '../../world/settings';
import { LiveQuality, ScrollPreference } from '../../world/world.enums';
import { featureInUrl, loadPrefs, rememberedOf, saveFeature, savePrefs, startFeatures } from '../prefs';

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

describe('settings', () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('start from the defaults: live quality Fast, the editor as it opens', () => {
    expect(loadPrefs()).toMatchObject({ ...DEFAULT_SETTINGS, ...rememberedOf(INITIAL_EDITOR) });
    expect(loadPrefs().liveQuality).toBe(LiveQuality.Fast);
  });

  it('persist orbit speed and snap grid and reject unsupported stored values', () => {
    for (const orbitSpeed of Object.values(OrbitSpeed)) {
      for (const snapGrid of SNAP_GRID_STEPS) {
        savePrefs({ orbitSpeed, snapGrid });
        expect(loadPrefs()).toMatchObject({ orbitSpeed, snapGrid });
      }
    }
    data.set(KEY, JSON.stringify({ orbitSpeed: 'turbo', snapGrid: 0 }));
    expect(loadPrefs()).toMatchObject({ orbitSpeed: OrbitSpeed.Normal, snapGrid: 0.5 });
    data.set(KEY, JSON.stringify({ orbitSpeed: 2, snapGrid: '0.5' }));
    expect(loadPrefs()).toMatchObject({ orbitSpeed: OrbitSpeed.Normal, snapGrid: 0.5 });
  });

  it('keep what was saved and drop values that are not allowed', () => {
    savePrefs({ liveQuality: LiveQuality.Detailed, walkSpeed: WalkSpeed.Fast, autosave: false, renderSamples: 64, sidePanel: false });
    expect(loadPrefs()).toMatchObject({ liveQuality: LiveQuality.Detailed, walkSpeed: WalkSpeed.Fast, autosave: false, renderSamples: 64, sidePanel: false });
    data.set(KEY, JSON.stringify({ liveQuality: 'ultra', walkSpeed: 3, autosave: 'no', renderSamples: 5, messageTime: MessageTime.Long, scroll: ScrollPreference.Wheel, showStart: false }));
    expect(loadPrefs()).toMatchObject({
      liveQuality: LiveQuality.Fast, walkSpeed: WalkSpeed.Normal, autosave: true, renderSamples: INITIAL_EDITOR.renderSamples,
      messageTime: MessageTime.Long, scroll: ScrollPreference.Wheel, showStart: false,
    });
  });
});
