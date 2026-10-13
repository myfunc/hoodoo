import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_EDITOR } from '../../world/editor-store';
import { ALL_PANES, SidePane, growingPane, withPane } from '../../world/side-panes';
import { ToolId } from '../../world/tool-places';
import { loadPrefs, prefsFrom, rememberedOf, savePrefs } from '../prefs';

describe('remembered panels and tool windows', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('start with the left panel shown and every window floating', () => {
    expect(loadPrefs()).toMatchObject({ leftPanel: true, toolPlaces: {} });
    expect(rememberedOf(INITIAL_EDITOR)).toMatchObject({ leftPanel: true, toolPlaces: {} });
  });

  it('keep a hidden left panel and where each window lives between visits', () => {
    const toolPlaces = { [ToolId.Attributes]: { docked: true }, [ToolId.Materials]: { docked: false, x: 200, y: 90 } };
    savePrefs({ ...rememberedOf({ ...INITIAL_EDITOR, leftPanel: false, toolPlaces }) });
    expect(loadPrefs()).toMatchObject({ leftPanel: false, toolPlaces });
  });

  it('read exported settings with broken entries as the defaults', () => {
    expect(prefsFrom({ leftPanel: 'no', toolPlaces: { [ToolId.Attributes]: { docked: 1 } } })).toMatchObject({ leftPanel: true, toolPlaces: {} });
  });

  it('keep which panels of the right column are on; a broken entry stays on', () => {
    const sidePanes = withPane(withPane(ALL_PANES, SidePane.Scene, false), SidePane.History, false);
    savePrefs({ ...rememberedOf({ ...INITIAL_EDITOR, sidePanes }) });
    expect(loadPrefs().sidePanes).toEqual(sidePanes);
    expect(prefsFrom({ sidePanes: { scene: 'no', history: false } }).sidePanes).toEqual(withPane(ALL_PANES, SidePane.History, false));
  });

  it('give the room left over to the scene list, else the snapshots, else nobody', () => {
    expect(growingPane(ALL_PANES)).toBe(SidePane.Scene);
    expect(growingPane(withPane(ALL_PANES, SidePane.Scene, false))).toBe(SidePane.Snapshots);
    expect(growingPane({ ...ALL_PANES, [SidePane.Scene]: false, [SidePane.Snapshots]: false })).toBeNull();
  });
});
