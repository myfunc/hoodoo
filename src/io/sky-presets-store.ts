import { DEFAULT_SKY, type SkyPreset } from '../assets/sky.presets';
import { Logger } from '../core/log';
import type { Sky } from '../model/scene.types';
import { sky as validSky } from '../world/scene.validate';

/**
 * Skies you saved yourself (Sky & Fog › Save sky): kept in this browser next to the
 * built-in presets. A name saved again replaces the older sky of that name.
 */

const KEY = 'hoodoo.skies.v1';
export const MY_SKIES_MAX = 48;
export const SKY_NAME_MAX = 40;
const logger = Logger.create('MySkies');

/** Where the list lives: localStorage in the browser, anything with the same two calls in tests. */
export interface SkyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, SKY_NAME_MAX);

/** Stored entries that still read as skies; anything else is dropped. */
export function skiesFrom(raw: unknown): SkyPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SkyPreset[] = [];
  for (const e of raw) {
    const r = (e ?? {}) as { name?: unknown; sky?: unknown };
    if (typeof r.name !== 'string' || !cleanName(r.name) || typeof r.sky !== 'object' || !r.sky) continue;
    out.push({ name: cleanName(r.name), sky: validSky(r.sky, DEFAULT_SKY) });
  }
  return out.slice(0, MY_SKIES_MAX);
}

/** The list with `sky` saved under `name` on top. */
export function withSky(list: readonly SkyPreset[], name: string, sky: Sky): SkyPreset[] {
  const n = cleanName(name);
  if (!n) return [...list];
  return [{ name: n, sky }, ...list.filter((p) => p.name !== n)].slice(0, MY_SKIES_MAX);
}

export function withoutSky(list: readonly SkyPreset[], name: string): SkyPreset[] {
  return list.filter((p) => p.name !== name);
}

/** The first "My sky N" not taken yet. */
export function freeSkyName(list: readonly SkyPreset[]): string {
  const taken = new Set(list.map((p) => p.name));
  for (let i = 1; ; i++) if (!taken.has(`My sky ${i}`)) return `My sky ${i}`;
}

export class MySkies {
  private list: SkyPreset[];

  constructor(private readonly storage: SkyStorage = localStorage) {
    this.list = this.read();
  }

  get all(): readonly SkyPreset[] {
    return this.list;
  }

  save(name: string, sky: Sky): void {
    this.write(withSky(this.list, name, sky));
  }

  remove(name: string): void {
    this.write(withoutSky(this.list, name));
  }

  private read(): SkyPreset[] {
    try {
      return skiesFrom(JSON.parse(this.storage.getItem(KEY) ?? '[]'));
    } catch (error) {
      logger.warn('saved skies unreadable, starting empty', {}, error);
      return [];
    }
  }

  private write(list: SkyPreset[]): void {
    this.list = list;
    try {
      this.storage.setItem(KEY, JSON.stringify(list));
    } catch (error) {
      logger.warn('saved skies not stored', { count: list.length }, error);
    }
  }
}
