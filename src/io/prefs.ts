import { Logger } from '../core/log';
import { Feature, type FeatureFlags, PREVIEW_FEATURES } from '../world/preview-features';
import { ScrollPreference } from '../world/world.enums';

/** Settings that outlive a session: what scrolling does, whether the start window opens, preview features. */
export interface Prefs {
  readonly scroll: ScrollPreference;
  readonly showStart: boolean;
  /** Preview features switched on in the Preview Features window. */
  readonly features: readonly Feature[];
}

const KEY = 'hoodoo.prefs.v1';
const DEFAULTS: Prefs = { scroll: ScrollPreference.Auto, showStart: true, features: [] };
const FLAGS_PARAM = 'flags';
const SCROLLS: ReadonlySet<unknown> = new Set(Object.values(ScrollPreference));
const KNOWN: ReadonlySet<unknown> = new Set(PREVIEW_FEATURES.map((f) => f.id));
const logger = Logger.create('Prefs');

/** Stored features: known ids only; 0.6.1 kept the Object Tree as `objectTree: true`. */
function featuresOf(raw: Record<string, unknown>): Feature[] {
  if (Array.isArray(raw.features)) return [...new Set(raw.features.filter((f): f is Feature => KNOWN.has(f)))];
  return raw.objectTree === true ? [Feature.ObjectTree] : [];
}

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return {
      scroll: SCROLLS.has(raw.scroll) ? (raw.scroll as ScrollPreference) : DEFAULTS.scroll,
      showStart: typeof raw.showStart === 'boolean' ? raw.showStart : DEFAULTS.showStart,
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
