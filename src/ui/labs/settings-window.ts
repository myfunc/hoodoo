import { KEY } from '../../core/keys';
import { downloadBlob } from '../../io/download';
import { type Remembered, defaultPrefs, exportPrefs, importPrefs, rememberedOf } from '../../io/prefs';
import { type EditorState, type EditorStore, RENDER_SAMPLE_CHOICES } from '../../world/editor-store';
import type { FeatureFlags } from '../../world/preview-features';
import { DEFAULT_SETTINGS, MessageTime, OrbitSpeed, SNAP_GRID_STEPS, type Settings, ThemeMode, WalkSpeed, changeSetting } from '../../world/settings';
import { LiveQuality, ScrollPreference } from '../../world/world.enums';
import { Button } from '../kit/controls';
import { showToast } from '../panels/toast';
import { APP_VERSION } from '../strings';
import { Dialog, DialogStyle } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import { PREVIEW_NOTE, previewFeatureRows } from './preview-features';
import { type SceneDepth, finalDepthRow, liveDepthRow } from './reflection-rows';
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
  /** `depth`: the open scene's final-render depth (Render reflections), when the window can change it. */
  readonly rows: (editor: EditorStore, depth?: SceneDepth) => RowView[];
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
      settingRow(setting('theme', 'Theme', '', [
        { value: ThemeMode.Light, label: 'Light', about: 'Bryce’s light stone chrome' },
        { value: ThemeMode.Dark, label: 'Dark', about: 'Dark stone chrome, the same icons and labs' },
        { value: ThemeMode.System, label: 'System', about: 'Light or dark as the system is set' },
      ]), e),
      settingRow(remembered('leftPanel', 'Left panel', 'Camera controls, render balls, docked windows (Shift+Tab)', SHOWN_HIDDEN), e),
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
    rows: (e, depth) => [
      settingRow(remembered('liveRender', 'Live preview', '', [
        { value: true, label: 'On', about: 'The scene renders itself while you edit (P)' },
        { value: false, label: 'Off', about: 'Classic Bryce: render with the big ball or Cmd/Ctrl+R' },
      ]), e),
      settingRow(setting('liveQuality', 'Live quality', '', [
        { value: LiveQuality.Fast, label: 'Fast', about: 'While you move: one reflection, hard shadows, 60 fps' },
        { value: LiveQuality.Full, label: 'Full', about: 'While you move: the finished look, grainier, 60 fps' },
        { value: LiveQuality.Detailed, label: 'Detailed', about: 'While you move or play: glass and mirrors deep, ~30 fps' },
      ]), e),
      liveDepthRow(e),
      settingRow(remembered('renderSamples', 'Rays per pixel', 'Anti-aliasing of Render and of copies; more is smoother', RENDER_SAMPLE_CHOICES.map((n) => ({ value: n, label: String(n) }))), e),
      ...(depth ? [finalDepthRow(e, depth)] : []),
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
const SETTINGS_FILE = 'hoodoo-settings.json';

/** Hoodoo's defaults under the site defaults (io/site-defaults.ts), as Reset to Defaults sets them. */
function defaultsSnapshot(): Snapshot {
  const d = defaultPrefs();
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, d[k as keyof Settings]])) as unknown as Settings;
  return { ...rememberedOf(d), settings, features: Object.fromEntries(d.features.map((f) => [f, true])) };
}

/** Downloads every setting as a file (and copies it) to keep, share or apply for everyone. */
function exportSettings(): void {
  const text = exportPrefs(APP_VERSION);
  downloadBlob(new Blob([text], { type: 'application/json' }), SETTINGS_FILE);
  navigator.clipboard?.writeText(text).catch(() => undefined);
  showToast(`Settings saved as ${SETTINGS_FILE} and copied`);
}

/** Reads an exported settings file and starts again with it. */
function importSettings(): void {
  const input = el('input', { attrs: { type: 'file', accept: '.json,application/json' } }) as HTMLInputElement;
  input.addEventListener('change', () => {
    void input.files?.[0]?.text().then((text) => {
      if (!importPrefs(text)) { showToast('Not a Hoodoo settings file'); return; }
      showToast('Settings imported · reloading');
      location.reload();
    });
  });
  input.click();
}

/**
 * App menu › Settings… (Cmd/Ctrl+,): sections on the left, one row per setting
 * on the right. A choice acts at once and is remembered (app/bootstrap.ts);
 * OK keeps the choices, Cancel puts back what they were when the window opened,
 * Reset to Defaults sets every section's defaults (preview features off).
 */
export function openSettings(editor: EditorStore, first = SettingsSection.General, depth?: SceneDepth): void {
  const before = snapshotOf(editor.state);
  const depthBefore = depth?.get();
  const nav = el('div', { cls: 'settings-nav', attrs: { role: 'tablist' } });
  const pane = el('div', { cls: 'settings-pane' });
  let views: RowView[] = [];
  const tabs = new Map<SettingsSection, HTMLElement>();
  const show = (section: Section) => {
    for (const [id, tab] of tabs) tab.classList.toggle('is-on', id === section.id);
    views = section.rows(editor, depth);
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
  const reset = new Button({ label: 'Reset to Defaults', title: 'Every setting back to how Hoodoo comes (Cancel undoes it)', onClick: () => editor.update(defaultsSnapshot()) });
  const exporter = new Button({ label: 'Export…', title: 'Save every setting as a file to keep or share', onClick: exportSettings });
  const importer = new Button({ label: 'Import…', title: 'Load a settings file saved with Export (reloads)', onClick: importSettings });
  new Dialog({
    title: 'Settings', style: DialogStyle.Stone, cls: 'settings-window',
    body: el('div', { cls: 'settings-body' }, [nav, pane]),
    footer: el('div', { cls: 'settings-footer' }, [reset.el, exporter.el, importer.el, el('span', { cls: 'settings-hint', text: 'Changes apply at once; Cancel puts them back' })]),
    onOk: stop,
    onCancel: () => { stop(); editor.update(before); if (depth && depthBefore !== undefined) depth.set(depthBefore); },
  }).open();
}
