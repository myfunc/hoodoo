import { KEY } from '../../core/keys';
import { type Remembered, rememberedOf } from '../../io/prefs';
import { type EditorState, type EditorStore, INITIAL_EDITOR, RENDER_SAMPLE_CHOICES } from '../../world/editor-store';
import type { FeatureFlags } from '../../world/preview-features';
import { DEFAULT_SETTINGS, MessageTime, OrbitSpeed, SNAP_GRID_STEPS, type Settings, WalkSpeed, changeSetting } from '../../world/settings';
import { LiveQuality, ScrollPreference } from '../../world/world.enums';
import { Button } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import { PREVIEW_NOTE, previewFeatureRows } from './preview-features';
import { type RowView, type SettingOption, type SettingRow, settingRow } from './setting-row';
import './settings-window.css';

export enum SettingsSection {
  General = 'general',
  Interface = 'interface',
  Navigation = 'navigation',
  Render = 'render',
  PreviewFeatures = 'preview',
}

const SHOW_SKIP = [{ value: true, label: 'Show' }, { value: false, label: 'Skip' }] as const;
const SHOWN_HIDDEN = [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }] as const;

/** A row of a personal setting (world/settings.ts). */
function setting<K extends keyof Settings>(key: K, label: string, about: string, options: readonly SettingOption<Settings[K]>[]): SettingRow<Settings[K]> {
  return { label, about, options, get: (s) => s.settings[key], set: (editor, v) => changeSetting(editor, key, v) };
}

/** A row of editor state that is remembered between visits (io/prefs.ts). */
function remembered<K extends keyof Remembered>(key: K, label: string, about: string, options: readonly SettingOption<Remembered[K]>[]): SettingRow<Remembered[K]> {
  return { label, about, options, get: (s) => s[key], set: (editor, v) => editor.update({ [key]: v }) };
}

interface Section {
  readonly id: SettingsSection;
  readonly name: string;
  readonly note?: string;
  readonly rows: (editor: EditorStore) => RowView[];
}

const SECTIONS: readonly Section[] = [
  {
    id: SettingsSection.General, name: 'General',
    rows: (e) => [
      settingRow(setting('showStart', 'Start window', 'New scene, your scenes and examples when Hoodoo opens', SHOW_SKIP), e),
      settingRow(setting('splash', 'Welcome splash', 'The welcome clip plays while the ray tracer starts', SHOW_SKIP), e),
      settingRow(setting('autosave', 'Autosave', 'The scene is kept in this browser for the next visit', [
        { value: true, label: 'On' },
        { value: false, label: 'Off', about: 'Nothing is kept: the next visit opens the demo' },
      ]), e),
    ],
  },
  {
    id: SettingsSection.Interface, name: 'Interface',
    rows: (e) => [
      settingRow(remembered('sidePanel', 'Scene panel', 'Attributes, scene list, snapshots, history (Tab)', SHOWN_HIDDEN), e),
      settingRow(setting('hintLine', 'Hint line', 'Help for the control under the pointer, lower left', SHOWN_HIDDEN), e),
      settingRow(setting('snapGrid', 'Snap grid', 'Move step when grid snapping is on', SNAP_GRID_STEPS.map((value) => ({ value, label: String(value) }))), e),
      settingRow(setting('messageTime', 'Messages', 'How long notes such as “Copied” stay on screen', [
        { value: MessageTime.Short, label: 'Short' },
        { value: MessageTime.Normal, label: 'Normal' },
        { value: MessageTime.Long, label: 'Long' },
      ]), e),
    ],
  },
  {
    id: SettingsSection.Navigation, name: 'Navigation',
    rows: (e) => [
      settingRow(remembered('scroll', 'Scroll gestures', '', [
        { value: ScrollPreference.Auto, label: 'Detect', about: 'Guessed per swipe: a wheel zooms, a trackpad orbits' },
        { value: ScrollPreference.Wheel, label: 'Wheel', about: 'Scrolling always zooms, like a mouse wheel' },
        { value: ScrollPreference.Trackpad, label: 'Trackpad', about: 'Two fingers orbit, Shift pans, a pinch zooms' },
      ]), e),
      settingRow(setting('orbitSpeed', 'Orbit speed', 'How fast a drag turns the camera', [
        { value: OrbitSpeed.Slow, label: 'Slow' },
        { value: OrbitSpeed.Normal, label: 'Normal' },
        { value: OrbitSpeed.Fast, label: 'Fast' },
      ]), e),
      settingRow(setting('walkSpeed', 'Walk speed', 'W A S D walk and right-drag fly; Shift is faster', [
        { value: WalkSpeed.Slow, label: 'Slow' },
        { value: WalkSpeed.Normal, label: 'Normal' },
        { value: WalkSpeed.Fast, label: 'Fast' },
      ]), e),
    ],
  },
  {
    id: SettingsSection.Render, name: 'Render',
    rows: (e) => [
      settingRow(remembered('liveRender', 'Live preview', '', [
        { value: true, label: 'On', about: 'The scene renders itself while you edit (P)' },
        { value: false, label: 'Off', about: 'Classic Bryce: render with the big ball or Cmd/Ctrl+R' },
      ]), e),
      settingRow(setting('liveQuality', 'Live quality', '', [
        { value: LiveQuality.Fast, label: 'Fast', about: 'While you move: one reflection, hard shadows, 60 fps' },
        { value: LiveQuality.Full, label: 'Full', about: 'While you move: the finished look, grainier, 60 fps' },
        { value: LiveQuality.Detailed, label: 'Detailed', about: 'While you move or play: glass and mirrors deep, ~30 fps' },
      ]), e),
      settingRow(remembered('renderSamples', 'Rays per pixel', 'Anti-aliasing of Render and of copies; more is smoother', RENDER_SAMPLE_CHOICES.map((n) => ({ value: n, label: String(n) }))), e),
    ],
  },
  { id: SettingsSection.PreviewFeatures, name: 'Preview Features', note: PREVIEW_NOTE, rows: (e) => previewFeatureRows().map((row) => settingRow(row, e)) },
];

/** Everything the window can change, to put back on Cancel. */
interface Snapshot extends Remembered {
  readonly settings: Settings;
  readonly features: FeatureFlags;
}

const snapshotOf = (s: EditorState): Snapshot => ({ ...rememberedOf(s), settings: s.settings, features: s.features });
const DEFAULTS: Snapshot = { ...rememberedOf(INITIAL_EDITOR), settings: DEFAULT_SETTINGS, features: {} };

/**
 * App menu › Settings… (Cmd/Ctrl+,): sections on the left, one row per setting
 * on the right. A choice acts at once and is remembered (app/bootstrap.ts);
 * OK keeps the choices, Cancel puts back what they were when the window opened,
 * Reset to Defaults sets every section's defaults (preview features off).
 */
export function openSettings(editor: EditorStore, first = SettingsSection.General): void {
  const before = snapshotOf(editor.state);
  const nav = el('div', { cls: 'settings-nav', attrs: { role: 'tablist' } });
  const pane = el('div', { cls: 'settings-pane' });
  let views: RowView[] = [];
  const tabs = new Map<SettingsSection, HTMLElement>();
  const show = (section: Section) => {
    for (const [id, tab] of tabs) tab.classList.toggle('is-on', id === section.id);
    views = section.rows(editor);
    clearChildren(pane);
    pane.append(el('div', { cls: 'settings-title', text: section.name }));
    if (section.note) pane.append(el('div', { cls: 'settings-note', text: section.note }));
    pane.append(el('div', { cls: 'settings-rows' }, views.map((v) => v.el)));
  };
  for (const section of SECTIONS) {
    const tab = el('div', { cls: 'settings-tab', text: section.name, attrs: { role: 'tab', tabindex: '0' } });
    tab.addEventListener('click', () => show(section));
    tab.addEventListener('keydown', (e) => { if (e.key === KEY.Enter || e.key === KEY.Space) { e.preventDefault(); e.stopPropagation(); show(section); } });
    tabs.set(section.id, tab);
    nav.append(tab);
  }
  show(SECTIONS.find((s) => s.id === first) ?? SECTIONS[0]);
  const stop = editor.events.on('changed', ({ state }) => { for (const v of views) v.sync(state); });
  const reset = new Button({ label: 'Reset to Defaults', title: 'Every setting back to how Hoodoo comes (Cancel undoes it)', onClick: () => editor.update(DEFAULTS) });
  new Dialog({
    title: 'Settings', style: DialogStyle.Stone, cls: 'settings-window',
    body: el('div', { cls: 'settings-body' }, [nav, pane]),
    footer: el('div', { cls: 'settings-footer' }, [reset.el, el('span', { cls: 'settings-hint', text: 'Changes apply at once; Cancel puts them back' })]),
    onOk: stop,
    onCancel: () => { stop(); editor.update(before); },
  }).open();
}
