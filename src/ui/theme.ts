import { Bus } from '../core/bus';
import { Family } from '../model/scene.enums';
import { Tone, currentTone, setTone } from '../render/tone';
import { FAMILY_COLORS } from '../render/wire/wire.constants';
import type { EditorStore } from '../world/editor-store';
import { ThemeMode, onSetting } from '../world/settings';
import { LIGHT_SURFACES, installSurfaces } from './kit/texture';
import { DARK_LOOKS, DARK_VARIANT, type DarkVariant } from './theme-variants';
import './theme.css';
import './theme-dark.css';

/** The browser's title bar over the light stone (as index.html starts it). */
const LIGHT_TITLE_BAR = '#9c9b96';
const PREFERS_DARK = '(prefers-color-scheme: dark)';
const FAMILIES = Object.values(Family).filter((f): f is Family => typeof f === 'number');

/** Light or Dark as chosen, or what the system asks for. */
export const toneOf = (mode: ThemeMode, systemDark: boolean): Tone =>
  mode === ThemeMode.Dark || (mode === ThemeMode.System && systemDark) ? Tone.Dark : Tone.Light;

/** The text colour of an object family in lists: a CSS variable that follows the theme. */
export const familyInk = (f: Family): string => `var(--family-${f})`;

/** What a theme writes on the page: the root's attributes and variables, the title bar's colour. */
export interface ThemeTarget {
  readonly root: HTMLElement;
  readonly titleBar?: HTMLMetaElement | null;
}

let variant: DarkVariant = DARK_VARIANT;
const shown = new Bus<{ theme: Tone }>();

/**
 * Shows `tone` on the page: `data-theme` (and the dark look's `data-variant`) on the
 * root for the styles, the stone tiles of that look, the family colours, the
 * title bar; then the painters' tone (render/tone.ts), which repaints the canvases.
 */
export function applyTone(target: ThemeTarget, tone: Tone): void {
  const { root } = target;
  const dark = tone === Tone.Dark;
  root.dataset.theme = tone;
  if (dark) root.dataset.variant = variant;
  else delete root.dataset.variant;
  installSurfaces(root, dark ? DARK_LOOKS[variant].surfaces : LIGHT_SURFACES);
  target.titleBar?.setAttribute('content', dark ? DARK_LOOKS[variant].titleBar : LIGHT_TITLE_BAR);
  setTone(tone);
  for (const f of FAMILIES) root.style.setProperty(`--family-${f}`, FAMILY_COLORS[f]);
  shown.emit('theme', tone);
}

/**
 * Settings › Interface › Theme: applies the chosen theme now, again whenever the
 * setting changes and, on System, whenever the system's preference does. The
 * choice is a setting, so prefs keep it (app/bootstrap.ts).
 */
export function installTheme(editor: EditorStore, target: ThemeTarget, system: MediaQueryList | null = matchMedia(PREFERS_DARK)): void {
  const apply = () => applyTone(target, toneOf(editor.state.settings.theme, system?.matches ?? false));
  apply();
  onSetting(editor, 'theme', apply);
  system?.addEventListener('change', () => { if (editor.state.settings.theme === ThemeMode.System) apply(); });
}

/** Another dark look, to compare (tools and the browser console: `__hoodoo.darkVariant('walnut')`). */
export function setDarkVariant(target: ThemeTarget, next: DarkVariant): void {
  variant = next;
  if (currentTone() === Tone.Dark) applyTone(target, Tone.Dark);
}

/** Runs `repaint` each time a theme or a dark look is shown (canvases that paint the chrome's colours). */
export const onThemeChange = (repaint: () => void): (() => void) => shown.on('theme', repaint);

/**
 * A colour the stylesheet gives the CSS variable `name` at `el`, or `fallback` where it gives none:
 * a canvas painter reads its surfaces this way so they match the theme's (and the dark look's) chrome.
 */
export function cssColor(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
