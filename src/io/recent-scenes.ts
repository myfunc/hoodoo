import { Logger } from '../core/log';
import { deserializeScene } from '../world/scene.serialize';

/** One scene of the start window's "Your scenes": opened from a file, saved, or worked on. */
export interface RecentScene {
  /** Stays the same while the scene is worked on, so autosaves update one entry. */
  readonly id: string;
  readonly name: string;
  /** When it was last opened, saved or changed (ms since 1970). */
  readonly time: number;
  /** A 160×100 JPEG data URL, or null before the first picture. */
  readonly thumb: string | null;
  /** The scene as `.hoodoo` file text. */
  readonly text: string;
}

export interface RecentLimits {
  readonly count: number;
  /** Characters of scene text, thumbnails and names together. */
  readonly budget: number;
}

/** Eight scenes, about 4 MB: the oldest go first. */
export const RECENT_LIMITS: RecentLimits = { count: 8, budget: 4 * 1024 * 1024 };

/** Where the entries live: IndexedDB in the browser, a Map in tests. */
export interface RecentBackend {
  readAll(): Promise<readonly unknown[]>;
  put(entry: RecentScene): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

const MAX_ID = 64;
/** Longer names (file names) are cut to this. */
export const RECENT_NAME_MAX = 120;
const JPEG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
const CURRENT_KEY = 'hoodoo.recent.current.v1';
const DB = { name: 'hoodoo', version: 1, store: 'recent-scenes' } as const;
const logger = Logger.create('RecentScenes');

const sizeOf = (e: RecentScene): number => e.text.length + (e.thumb?.length ?? 0) + e.name.length;

/** The list with `entry` on top: the same id or the same name and content is not kept twice. */
export function withRecent(list: readonly RecentScene[], entry: RecentScene, limits = RECENT_LIMITS): RecentScene[] {
  const rest = list.filter((e) => e.id !== entry.id && !(e.name === entry.name && e.text === entry.text));
  return withinLimits([entry, ...rest], limits);
}

/** The first `count` entries, then the oldest dropped until the rest fit the budget (a scene too big alone is not kept). */
export function withinLimits(list: readonly RecentScene[], limits = RECENT_LIMITS): RecentScene[] {
  const kept: RecentScene[] = [];
  let size = 0;
  for (const e of list.slice(0, limits.count)) {
    size += sizeOf(e);
    if (size > limits.budget) break;
    kept.push(e);
  }
  return kept;
}

/** Whether a stored value is a whole entry whose scene still opens; anything else is dropped. */
export function isRecentScene(raw: unknown): raw is RecentScene {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id || e.id.length > MAX_ID) return false;
  if (typeof e.name !== 'string' || !e.name || e.name.length > RECENT_NAME_MAX) return false;
  if (typeof e.time !== 'number' || !Number.isFinite(e.time) || e.time < 0) return false;
  if (e.thumb !== null && (typeof e.thumb !== 'string' || !JPEG_DATA.test(e.thumb))) return false;
  if (typeof e.text !== 'string') return false;
  try {
    deserializeScene(JSON.parse(e.text));
    return true;
  } catch (error) {
    logger.warn('recent scene does not open, dropped', { name: e.name }, error);
    return false;
  }
}

/** Stored entries as a list: valid ones only, one per id and per name + content, newest first, within the limits. */
export function recentsFrom(raw: readonly unknown[], limits = RECENT_LIMITS): RecentScene[] {
  const sorted = raw.filter(isRecentScene).sort((a, b) => b.time - a.time);
  const same = (a: RecentScene, b: RecentScene) => a.id === b.id || (a.name === b.name && a.text === b.text);
  return withinLimits(sorted.filter((e, i) => sorted.findIndex((x) => same(x, e)) === i), limits);
}

/** The recent scenes, kept in memory and written through to the backend. */
export class RecentScenes {
  private entries: readonly RecentScene[] = [];
  private writes: Promise<void>;
  readonly ready: Promise<void>;

  constructor(private readonly backend: RecentBackend = indexedDbBackend(), private readonly limits = RECENT_LIMITS) {
    this.ready = backend.readAll().then(
      (raw) => {
        // Anything remembered while the store was still loading counts as newer.
        this.entries = recentsFrom([...this.entries, ...raw], limits);
        const keep = new Set(this.entries.map((e) => e.id));
        const dropped = raw.map((e) => (e as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string' && !keep.has(id));
        if (dropped.length) this.write(() => backend.remove(dropped), 'drop unusable entries');
      },
      (error: unknown) => logger.warn('recent scenes unreadable, starting with none', {}, error),
    );
    this.writes = this.ready;
  }

  get list(): readonly RecentScene[] {
    return this.entries;
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  /** Puts the scene on top (a known id keeps its picture when none is given). */
  remember(entry: RecentScene): void {
    const thumb = entry.thumb ?? this.entries.find((e) => e.id === entry.id)?.thumb ?? null;
    this.replace(withRecent(this.entries, { ...entry, thumb }, this.limits));
  }

  /** A new picture for a listed scene; its place in the list stays. */
  setThumb(id: string, thumb: string): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    const next = { ...e, thumb };
    this.entries = this.entries.map((x) => (x === e ? next : x));
    this.write(() => this.backend.put(next), 'picture');
  }

  remove(id: string): void {
    this.replace(this.entries.filter((e) => e.id !== id));
  }

  private replace(next: readonly RecentScene[]): void {
    const before = this.entries;
    this.entries = next;
    const gone = before.filter((e) => !next.some((n) => n.id === e.id)).map((e) => e.id);
    const changed = next.filter((e) => !before.includes(e));
    this.write(async () => {
      if (gone.length) await this.backend.remove(gone);
      for (const e of changed) await this.backend.put(e);
    }, 'update');
  }

  /** Writes one after another, so a later state never lands before an earlier one. */
  private write(step: () => Promise<void>, what: string): void {
    this.writes = this.writes.then(step).catch((error: unknown) => logger.warn('recent scenes not saved', { what }, error));
  }

  /** Resolves once every write so far has landed (tests, page hide). */
  flushed(): Promise<void> {
    return this.writes;
  }
}

/** A random id for a new entry. */
export function newRecentId(): string {
  return crypto.randomUUID();
}

/** The entry the open scene belongs to, kept across reloads with the autosave. */
export interface CurrentScene {
  readonly id: string;
  readonly name: string;
}

export function loadCurrentScene(): CurrentScene | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null') as Record<string, unknown> | null;
    const ok = raw && typeof raw.id === 'string' && raw.id && raw.id.length <= MAX_ID && typeof raw.name === 'string' && raw.name && raw.name.length <= RECENT_NAME_MAX;
    return ok ? { id: raw.id as string, name: raw.name as string } : null;
  } catch (error) {
    logger.warn('current scene record unreadable', {}, error);
    return null;
  }
}

export function saveCurrentScene(current: CurrentScene): void {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(current));
  } catch (error) {
    logger.warn('current scene record not saved', {}, error);
  }
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** One object store keyed by id; the database opens on first use. */
export function indexedDbBackend(): RecentBackend {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(DB.name, DB.version);
      r.onupgradeneeded = () => r.result.createObjectStore(DB.store, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode) => (await open()).transaction(DB.store, mode).objectStore(DB.store);
  return {
    readAll: async () => request((await store('readonly')).getAll()),
    put: async (entry) => { await request((await store('readwrite')).put(entry)); },
    remove: async (ids) => {
      const s = await store('readwrite');
      await Promise.all(ids.map((id) => request(s.delete(id))));
    },
  };
}
