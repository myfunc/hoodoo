import { Logger } from '../core/log';
import { ScrollPreference } from '../world/world.enums';

/** Settings that outlive a session: what scrolling does, whether the start window opens, preview features. */
export interface Prefs {
  readonly scroll: ScrollPreference;
  readonly showStart: boolean;
  /** Preview: nested groups and the scene list as a tree. */
  readonly objectTree: boolean;
}

/** Preview features, switched on for one visit with `?flags=<name>[,<name>]` in the address. */
export enum Feature {
  ObjectTree = 'tree',
}

const KEY = 'hoodoo.prefs.v1';
const DEFAULTS: Prefs = { scroll: ScrollPreference.Auto, showStart: true, objectTree: false };
const FLAGS_PARAM = 'flags';
const SCROLLS: ReadonlySet<unknown> = new Set(Object.values(ScrollPreference));
const logger = Logger.create('Prefs');

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    return {
      scroll: SCROLLS.has(raw.scroll) ? (raw.scroll as ScrollPreference) : DEFAULTS.scroll,
      showStart: typeof raw.showStart === 'boolean' ? raw.showStart : DEFAULTS.showStart,
      objectTree: typeof raw.objectTree === 'boolean' ? raw.objectTree : DEFAULTS.objectTree,
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

/** Whether the address asks for a preview feature. */
export function featureInUrl(feature: Feature, search = location.search): boolean {
  const flags = new URLSearchParams(search).get(FLAGS_PARAM) ?? '';
  return flags.split(',').map((f) => f.trim()).includes(feature);
}
