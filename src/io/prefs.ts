import { Logger } from '../core/log';
import { ScrollPreference } from '../world/world.enums';

/** Settings that outlive a session: what scrolling does, whether the start window opens. */
export interface Prefs {
  readonly scroll: ScrollPreference;
  readonly showStart: boolean;
}

const KEY = 'hoodoo.prefs.v1';
const DEFAULTS: Prefs = { scroll: ScrollPreference.Auto, showStart: true };
const SCROLLS: ReadonlySet<unknown> = new Set(Object.values(ScrollPreference));
const logger = Logger.create('Prefs');

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    return {
      scroll: SCROLLS.has(raw.scroll) ? (raw.scroll as ScrollPreference) : DEFAULTS.scroll,
      showStart: typeof raw.showStart === 'boolean' ? raw.showStart : DEFAULTS.showStart,
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
