import { Logger } from '../core/log';
import { type EditorState, INITIAL_EDITOR, RENDER_SAMPLE_CHOICES } from '../world/editor-store';
import { Feature, type FeatureFlags, PREVIEW_FEATURES } from '../world/preview-features';
import { DEFAULT_SETTINGS, type Settings, settingsFrom } from '../world/settings';
import { ScrollPreference } from '../world/world.enums';

/** Editor state kept as you left it between visits; the Settings window shows it too. */
export const REMEMBERED = ['scroll', 'renderSamples', 'sidePanel', 'liveRender'] as const;
export type Remembered = Pick<EditorState, (typeof REMEMBERED)[number]>;

/** Settings that outlive a session: the Settings window's (world/settings.ts), the remembered editor state, preview features. */
export interface Prefs extends Settings, Remembered {
  /** Preview features switched on in the Settings window. */
  readonly features: readonly Feature[];
}

const KEY = 'hoodoo.prefs.v1';
const DEFAULTS: Prefs = { ...DEFAULT_SETTINGS, ...rememberedOf(INITIAL_EDITOR), features: [] };
const FLAGS_PARAM = 'flags';
const SCROLLS: ReadonlySet<unknown> = new Set(Object.values(ScrollPreference));
const SAMPLES: ReadonlySet<unknown> = new Set(RENDER_SAMPLE_CHOICES);
const KNOWN: ReadonlySet<unknown> = new Set(PREVIEW_FEATURES.map((f) => f.id));
const logger = Logger.create('Prefs');

/** The part of the editor state that is remembered. */
export function rememberedOf(s: Remembered): Remembered {
  return { scroll: s.scroll, renderSamples: s.renderSamples, sidePanel: s.sidePanel, liveRender: s.liveRender };
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Stored features: known ids only; 0.6.1 kept the Object Tree as `objectTree: true`. */
function featuresOf(raw: Record<string, unknown>): Feature[] {
  if (Array.isArray(raw.features)) return [...new Set(raw.features.filter((f): f is Feature => KNOWN.has(f)))];
  return raw.objectTree === true ? [Feature.ObjectTree] : [];
}

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return {
      ...settingsFrom(raw),
      scroll: SCROLLS.has(raw.scroll) ? (raw.scroll as ScrollPreference) : DEFAULTS.scroll,
      renderSamples: SAMPLES.has(raw.renderSamples) ? (raw.renderSamples as number) : DEFAULTS.renderSamples,
      sidePanel: flag(raw.sidePanel, DEFAULTS.sidePanel),
      liveRender: flag(raw.liveRender, DEFAULTS.liveRender),
      features: featuresOf(raw),
    };
  } catch (error) {
    logger.warn('prefs unreadable, using defaults', {}, error);
    return DEFAULTS;
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch (error) {
    logger.warn('prefs not saved', {}, error);
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
