import { describe, expect, it } from 'vitest';
import { EditorStore } from '../editor-store';
import { DEFAULT_SETTINGS, OrbitSpeed, SNAP_GRID_STEPS, changeSetting, onSetting, settingsFrom } from '../settings';
import { LiveQuality } from '../world.enums';

describe('settings', () => {
  it('read stored values one by one, falling back to the default for each broken one', () => {
    expect(settingsFrom({})).toEqual(DEFAULT_SETTINGS);
    expect(settingsFrom({ liveQuality: LiveQuality.Full, hintLine: 'yes', extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, liveQuality: LiveQuality.Full });
  });

  it('validate orbit speed and every snap grid step, preserving old defaults', () => {
    expect(DEFAULT_SETTINGS.orbitSpeed).toBe(OrbitSpeed.Normal);
    expect(DEFAULT_SETTINGS.snapGrid).toBe(0.5);
    for (const snapGrid of SNAP_GRID_STEPS) {
      expect(settingsFrom({ orbitSpeed: OrbitSpeed.Fast, snapGrid })).toMatchObject({ orbitSpeed: OrbitSpeed.Fast, snapGrid });
    }
    for (const snapGrid of [0, -1, 0.3, '0.5', null]) {
      expect(settingsFrom({ orbitSpeed: 'turbo', snapGrid })).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('apply both choices immediately and reset them together', () => {
    const editor = new EditorStore();
    const heard: number[] = [];
    onSetting(editor, 'snapGrid', (value) => heard.push(value));
    changeSetting(editor, 'orbitSpeed', OrbitSpeed.Slow);
    changeSetting(editor, 'snapGrid', 2);
    expect(editor.state.settings).toMatchObject({ orbitSpeed: OrbitSpeed.Slow, snapGrid: 2 });
    editor.update({ settings: DEFAULT_SETTINGS });
    expect(editor.state.settings).toEqual(DEFAULT_SETTINGS);
    expect(heard).toEqual([2, 0.5]);
  });

  it('tell listeners about a change of their setting only', () => {
    const editor = new EditorStore();
    const heard: LiveQuality[] = [];
    const stop = onSetting(editor, 'liveQuality', (q) => heard.push(q));
    changeSetting(editor, 'hintLine', false);
    changeSetting(editor, 'liveQuality', LiveQuality.Detailed);
    changeSetting(editor, 'liveQuality', LiveQuality.Detailed);
    editor.update({ grid: false });
    stop();
    changeSetting(editor, 'liveQuality', LiveQuality.Full);
    expect(heard).toEqual([LiveQuality.Detailed]);
    expect(editor.state.settings).toEqual({ ...DEFAULT_SETTINGS, hintLine: false, liveQuality: LiveQuality.Full });
  });
});
