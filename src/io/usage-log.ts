import { Logger } from '../core/log';

const KEY = 'hoodoo.usage.v1';
const logger = Logger.create('UsageLog');

/**
 * What the editor is used for, counted in this browser only: never sent anywhere,
 * read through Help › Usage Log… (a file) or `__hoodoo.usage()`.
 */
export interface UsageLog {
  readonly kind: 'hoodoo-usage';
  /** When counting began here (ISO date). */
  readonly since: string;
  sessions: number;
  /** Commands run, by name; `byKey` counts the share run from a shortcut. */
  readonly actions: Record<string, number>;
  readonly byKey: Record<string, number>;
  /** Presses in each place of the window: "Region › control". */
  readonly clicks: Record<string, number>;
  /** Keys pressed outside Play and text fields, with their modifiers. */
  readonly keys: Record<string, number>;
  /** Minutes the window was in front, in each state (picture mode, panels, Play). */
  readonly minutes: Record<string, number>;
}

export const emptyUsage = (now: Date): UsageLog => ({
  kind: 'hoodoo-usage', since: now.toISOString(), sessions: 0, actions: {}, byKey: {}, clicks: {}, keys: {}, minutes: {},
});

/** Adds `by` to the count of `name` in `table`. */
export function bump(table: Record<string, number>, name: string, by = 1): void {
  table[name] = (table[name] ?? 0) + by;
}

const isTable = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' && v !== null && Object.values(v).every((n) => typeof n === 'number');

/** A stored log, or a new one when there is none or it does not read. */
export function usageFrom(raw: string | null, now: Date): UsageLog {
  if (!raw) return emptyUsage(now);
  try {
    const r = JSON.parse(raw) as Partial<UsageLog>;
    const fresh = emptyUsage(now);
    const table = (v: unknown) => (isTable(v) ? { ...v } : {});
    return {
      ...fresh,
      since: typeof r.since === 'string' ? r.since : fresh.since,
      sessions: typeof r.sessions === 'number' ? r.sessions : 0,
      actions: table(r.actions), byKey: table(r.byKey), clicks: table(r.clicks), keys: table(r.keys), minutes: table(r.minutes),
    };
  } catch (error) {
    logger.warn('usage log unreadable, counting anew', {}, error);
    return emptyUsage(now);
  }
}

export const loadUsage = (now = new Date()): UsageLog => usageFrom(localStorage.getItem(KEY), now);

export function saveUsage(log: UsageLog): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch (error) {
    logger.warn('usage log not saved', {}, error);
  }
}
