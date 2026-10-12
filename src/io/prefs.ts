import { Logger } from '../core/log';
import { type EditorState, INITIAL_EDITOR, RENDER_SAMPLE_CHOICES } from '../world/editor-store';
import { Feature, type FeatureFlags, PREVIEW_FEATURES } from '../world/preview-features';
import { DEFAULT_SETTINGS, type Settings, settingsFrom } from '../world/settings';
import { toolPlacesFrom } from '../world/tool-places';
import { ScrollPreference } from '../world/world.enums';
import { SITE_DEFAULTS } from './site-defaults';

/** Editor state kept as you left it between visits; the Settings window shows it too. */
export const REMEMBERED = ['scroll', 'renderSamples', 'sidePanel', 'liveRender', 'leftPanel', 'toolPlaces'] as const;
export type Remembered = Pick<EditorState, (typeof REMEMBERED)[number]>;

/** Settings that outlive a session: the Settings window's (world/settings.ts), the remembered editor state, preview features. */
export interface Prefs extends Settings, Remembered {
  /** Preview features switched on in the Settings window. */
  readonly features: readonly Feature[];
}

const KEY = 'hoodoo.prefs.v1';
/** Marks an exported settings file (Settings › Export…). */
const EXPORT_KIND = 'hoodoo-settings';
const EXPORT_INDENT = 2;
const DEFAULTS: Prefs = { ...DEFAULT_SETTINGS, ...rememberedOf(INITIAL_EDITOR), features: [] };
const FLAGS_PARAM = 'flags';
const SCROLLS: ReadonlySet<unknown> = new Set(Object.values(ScrollPreference));
const SAMPLES: ReadonlySet<unknown> = new Set(RENDER_SAMPLE_CHOICES);
const KNOWN: ReadonlySet<unknown> = new Set(PREVIEW_FEATURES.map((f) => f.id));
const logger = Logger.create('Prefs');

/** The part of the editor state that is remembered. */
export function rememberedOf(s: Remembered): Remembered {
  return { scroll: s.scroll, renderSamples: s.renderSamples, sidePanel: s.sidePanel, liveRender: s.liveRender, leftPanel: s.leftPanel, toolPlaces: s.toolPlaces };
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Stored features: known ids only; 0.6.1 kept the Object Tree as `objectTree: true`. */
function featuresOf(raw: Record<string, unknown>): Feature[] {
  if (Array.isArray(raw.features)) return [...new Set(raw.features.filter((f): f is Feature => KNOWN.has(f)))];
  return raw.objectTree === true ? [Feature.ObjectTree] : [];
}

/** Prefs from stored or exported values; anything missing or invalid falls back to Hoodoo's defaults. */
export function prefsFrom(raw: Record<string, unknown>): Prefs {
  return {
    ...settingsFrom(raw),
    scroll: SCROLLS.has(raw.scroll) ? (raw.scroll as ScrollPreference) : DEFAULTS.scroll,
    renderSamples: SAMPLES.has(raw.renderSamples) ? (raw.renderSamples as number) : DEFAULTS.renderSamples,
    sidePanel: flag(raw.sidePanel, DEFAULTS.sidePanel),
    leftPanel: flag(raw.leftPanel, DEFAULTS.leftPanel),
    toolPlaces: toolPlacesFrom(raw.toolPlaces),
    liveRender: flag(raw.liveRender, DEFAULTS.liveRender),
    features: featuresOf(raw),
  };
}

/** What a visitor who never changed anything gets: Hoodoo's defaults under the site defaults. */
export const defaultPrefs = (): Prefs => prefsFrom(SITE_DEFAULTS);

/** The stored choices as written: only what differs from the defaults. */
function storedRaw(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
}

export function loadPrefs(): Prefs {
  try {
    return prefsFrom({ ...SITE_DEFAULTS, ...storedRaw() });
  } catch (error) {
    logger.warn('prefs unreadable, using defaults', {}, error);
    return defaultPrefs();
  }
}

/**
 * Stores a change. Only values that differ from the defaults are kept, so a
 * new site default still reaches everyone who never touched that setting.
 */
export function savePrefs(patch: Partial<Prefs>): void {
  try {
    const base = defaultPrefs() as unknown as Record<string, unknown>;
    const next = Object.entries({ ...storedRaw(), ...patch }).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base[k]));
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(next)));
  } catch (error) {
    logger.warn('prefs not saved', {}, error);
  }
}

/** Every setting as a file to keep, share, or apply for everyone (tools/apply-settings.mjs). */
export function exportPrefs(version: string, now = new Date()): string {
  return JSON.stringify({ kind: EXPORT_KIND, version, exported: now.toISOString(), prefs: loadPrefs() }, null, EXPORT_INDENT);
}

/** Stores the settings of an exported file; false when the text is not one. */
export function importPrefs(text: string): boolean {
  try {
    const data = JSON.parse(text) as Record<string, unknown> | null;
    if (data?.kind !== EXPORT_KIND || typeof data.prefs !== 'object' || data.prefs === null) return false;
    savePrefs(prefsFrom({ ...SITE_DEFAULTS, ...(data.prefs as Record<string, unknown>) }));
    return true;
  } catch (error) {
    logger.warn('settings file unreadable', {}, error);
    return false;
  }
}

/** Remembers one feature switch; the others keep what was stored (a `?flags=` visit stays a visit). */
export function saveFeature(feature: Feature, on: boolean): void {
  const rest = loadPrefs().features.filter((f) => f !== feature);
  savePrefs({ features: on ? [...rest, feature] : rest });
}

/** Whether the address asks for a preview feature. */
export function featureInUrl(feature: Feature, search = location.search): boolean {
  const flags = new URLSearchParams(search).get(FLAGS_PARAM) ?? '';
  return flags.split(',').map((f) => f.trim()).includes(feature);
}

/** The features a visit starts with: the stored ones plus those in the address. */
export function startFeatures(prefs: Prefs, search = location.search): FeatureFlags {
  const on = PREVIEW_FEATURES.filter((f) => prefs.features.includes(f.id) || featureInUrl(f.id, search));
  return Object.fromEntries(on.map((f) => [f.id, true]));
}
