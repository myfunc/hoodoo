import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Family } from '../../model/scene.enums';
import { Tone, currentTone, setTone } from '../../render/tone';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { exportPrefs, importPrefs, loadPrefs, savePrefs } from '../../io/prefs';
import { EditorStore } from '../../world/editor-store';
import { DEFAULT_SETTINGS, ThemeMode, changeSetting, settingsFrom } from '../../world/settings';
import { LIGHT_SURFACES, installSurfaces } from '../kit/texture';
import { applyTone, familyInk, installTheme, onThemeChange, setDarkVariant, toneOf } from '../theme';
import { DARK_LOOKS, DARK_VARIANT, DarkVariant } from '../theme-variants';

// The stone tiles need a real canvas; here it is enough to know which set was asked for.
vi.mock('../kit/texture', async (original) => ({ ...(await original<typeof import('../kit/texture')>()), installSurfaces: vi.fn() }));

/** The bits of <html> and <meta name="theme-color"> the theme writes. */
function fakePage() {
  const vars = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => vars.set(k, v) } };
  const meta = { content: '', setAttribute(_: string, v: string) { this.content = v; } };
  return { vars, root, meta, target: { root: root as unknown as HTMLElement, titleBar: meta as unknown as HTMLMetaElement } };
}

/** A media query whose answer the test sets. */
function fakeSystem(dark: boolean) {
  const listeners: (() => void)[] = [];
  const query = { matches: dark, addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
  return { query: query as unknown as MediaQueryList, flip(next: boolean) { query.matches = next; listeners.forEach((fn) => fn()); } };
}

describe('theme', () => {
  afterEach(() => { setTone(Tone.Light); vi.mocked(installSurfaces).mockClear(); });

  it('Light and Dark are what they say; System follows the system', () => {
    expect(toneOf(ThemeMode.Light, true)).toBe(Tone.Light);
    expect(toneOf(ThemeMode.Dark, false)).toBe(Tone.Dark);
    expect(toneOf(ThemeMode.System, false)).toBe(Tone.Light);
    expect(toneOf(ThemeMode.System, true)).toBe(Tone.Dark);
  });

  it('dark marks the page, paints the dark look and turns the painters dark; light undoes it all', () => {
    const page = fakePage();
    applyTone(page.target, Tone.Dark);
    expect(page.root.dataset).toEqual({ theme: 'dark', variant: DARK_VARIANT });
    expect(installSurfaces).toHaveBeenLastCalledWith(page.target.root, DARK_LOOKS[DARK_VARIANT].surfaces);
    expect(page.meta.content).toBe(DARK_LOOKS[DARK_VARIANT].titleBar);
    expect(currentTone()).toBe(Tone.Dark);
    expect(page.vars.get(`--family-${Family.Blue}`)).toBe(FAMILY_COLORS[Family.Blue]);
    const darkBlue = FAMILY_COLORS[Family.Blue];

    applyTone(page.target, Tone.Light);
    expect(page.root.dataset).toEqual({ theme: 'light' });
    expect(installSurfaces).toHaveBeenLastCalledWith(page.target.root, LIGHT_SURFACES);
    expect(page.meta.content).toBe('#9c9b96');
    expect(currentTone()).toBe(Tone.Light);
    expect(page.vars.get(`--family-${Family.Blue}`)).not.toBe(darkBlue);
    expect(familyInk(Family.Blue)).toBe(`var(--family-${Family.Blue})`);
  });

  it('switches live with the setting, and on System with the system', () => {
    const page = fakePage();
    const system = fakeSystem(true);
    const editor = new EditorStore();
    installTheme(editor, page.target, system.query);
    expect(page.root.dataset.theme).toBe('dark');

    changeSetting(editor, 'theme', ThemeMode.Light);
    expect(page.root.dataset.theme).toBe('light');
    changeSetting(editor, 'theme', ThemeMode.System);
    expect(page.root.dataset.theme).toBe('dark');
    system.flip(false);
    expect(page.root.dataset.theme).toBe('light');
    system.flip(true);
    expect(page.root.dataset.theme).toBe('dark');

    changeSetting(editor, 'theme', ThemeMode.Light);
    system.flip(false);
    system.flip(true);
    expect(page.root.dataset.theme).toBe('light');
  });

  it('another dark look shows at once while dark, and is kept for the next dark', () => {
    const page = fakePage();
    applyTone(page.target, Tone.Dark);
    setDarkVariant(page.target, DarkVariant.Walnut);
    expect(page.root.dataset.variant).toBe(DarkVariant.Walnut);
    expect(installSurfaces).toHaveBeenLastCalledWith(page.target.root, DARK_LOOKS[DarkVariant.Walnut].surfaces);
    applyTone(page.target, Tone.Light);
    setDarkVariant(page.target, DarkVariant.Graphite);
    expect(page.root.dataset.variant).toBeUndefined();
    applyTone(page.target, Tone.Dark);
    expect(page.root.dataset.variant).toBe(DarkVariant.Graphite);
    setDarkVariant(page.target, DARK_VARIANT);
  });

  it('tells the painters each time a theme or a dark look is shown', () => {
    const page = fakePage();
    let shown = 0;
    const stop = onThemeChange(() => { shown++; });
    applyTone(page.target, Tone.Dark);
    setDarkVariant(page.target, DarkVariant.Midnight);
    applyTone(page.target, Tone.Light);
    setDarkVariant(page.target, DARK_VARIANT);
    stop();
    applyTone(page.target, Tone.Dark);
    expect(shown).toBe(3);
  });

  it('every dark look has its four stone tiles', () => {
    for (const v of Object.values(DarkVariant)) expect(Object.keys(DARK_LOOKS[v].surfaces).sort()).toEqual(Object.keys(LIGHT_SURFACES).sort());
  });
});

describe('theme setting', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts dark, and an unknown stored value falls back to dark', () => {
    expect(DEFAULT_SETTINGS.theme).toBe(ThemeMode.Dark);
    expect(settingsFrom({ theme: 'sepia' }).theme).toBe(ThemeMode.Dark);
    expect(settingsFrom({ theme: ThemeMode.System }).theme).toBe(ThemeMode.System);
  });

  it('is remembered between visits and travels in an exported settings file', () => {
    expect(loadPrefs().theme).toBe(ThemeMode.Dark);
    savePrefs({ theme: ThemeMode.Light });
    expect(loadPrefs().theme).toBe(ThemeMode.Light);
    const file = exportPrefs('test');
    savePrefs({ theme: ThemeMode.Dark });
    expect(loadPrefs().theme).toBe(ThemeMode.Dark);
    expect(importPrefs(file)).toBe(true);
    expect(loadPrefs().theme).toBe(ThemeMode.Light);
  });
});
