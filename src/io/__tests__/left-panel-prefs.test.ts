import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolId } from '../../world/tool-places';
import { loadPrefs, savePrefs } from '../prefs';

const KEY = 'hoodoo.prefs.v1';

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  return data;
}

describe('the left panel in prefs', () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts with the Render page docked and open under open camera controls', () => {
    const p = loadPrefs();
    expect(p.toolPlaces[ToolId.RenderOptions]).toEqual({ docked: true, open: true });
    expect(p.controlsOpen).toBe(true);
  });

  it('keeps the Render page docked beside windows moved before, and drops the old floating Render Options place', () => {
    data.set(KEY, JSON.stringify({ toolPlaces: { 'render-options': { docked: false, open: true, x: 40, y: 60 }, attributes: { docked: true, open: true } } }));
    expect(loadPrefs().toolPlaces).toEqual({ [ToolId.RenderOptions]: { docked: true, open: true }, [ToolId.Attributes]: { docked: true, open: true } });
  });

  it('remembers a closed Render page and folded controls', () => {
    savePrefs({ controlsOpen: false, toolPlaces: { [ToolId.RenderOptions]: { docked: true, open: false } } });
    const p = loadPrefs();
    expect(p.controlsOpen).toBe(false);
    expect(p.toolPlaces[ToolId.RenderOptions]).toEqual({ docked: true, open: false });
  });
});
