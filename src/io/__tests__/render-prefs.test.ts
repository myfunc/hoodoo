import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW_CUSTOM, RenderPreset, ShadowQuality } from '../../world/render-setup';
import { exportPrefs, importPrefs, loadPrefs, savePrefs } from '../prefs';

const KEY = 'hoodoo.prefs.v1';

describe('render prefs', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keep the live depth and the Render View choices, and only what differs from the defaults', () => {
    const custom = { ...DEFAULT_VIEW_CUSTOM, bounces: 14, shadows: ShadowQuality.High };
    savePrefs({ ...loadPrefs(), liveBounces: 9, renderViewPreset: RenderPreset.Custom, renderViewCustom: custom });
    expect(loadPrefs()).toMatchObject({ liveBounces: 9, renderViewPreset: RenderPreset.Custom, renderViewCustom: custom });
    savePrefs({ renderViewCustom: DEFAULT_VIEW_CUSTOM });
    const stored = JSON.parse(data.get(KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.renderViewCustom).toBeUndefined();
    expect(stored.liveBounces).toBe(9);
  });

  it('travel in an exported settings file', () => {
    savePrefs({ liveBounces: 2, renderViewPreset: RenderPreset.Draft });
    const text = exportPrefs('test');
    data.clear();
    expect(loadPrefs().liveBounces).toBe(4);
    expect(importPrefs(text)).toBe(true);
    expect(loadPrefs()).toMatchObject({ liveBounces: 2, renderViewPreset: RenderPreset.Draft });
  });
});
