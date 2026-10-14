import { parseKeyValues } from './keyvalues';
import type { KeyValues, SourceFiles } from './source.types';
import { normalizeSourcePath } from './vpk';

/**
 * READ ME — Source's surface properties (scripts/surfaceproperties*.txt): each
 * surface ("concrete", "wood_box", "metal") names the soundscripts a foot, an
 * impact and a scrape on it play. A surface starts from "default", then from its
 * `base` if it has one, and its own keys win; the manifest lists the files, the
 * first definition of a name wins as in the engine.
 */

export interface SurfaceSounds {
  readonly stepLeft: string;
  readonly stepRight: string;
  readonly impactHard: string;
  readonly impactSoft: string;
  readonly scrapeRough: string;
  readonly scrapeSmooth: string;
  readonly bulletImpact: string;
}

const KEYS: Readonly<Record<string, keyof SurfaceSounds>> = {
  stepleft: 'stepLeft', stepright: 'stepRight', impacthard: 'impactHard', impactsoft: 'impactSoft',
  scraperough: 'scrapeRough', scrapesmooth: 'scrapeSmooth', bulletimpact: 'bulletImpact',
};
const DEFAULT = 'default';
const BASE = 'base';
const MANIFEST = 'scripts/surfaceproperties_manifest.txt';
const SINGLE = 'scripts/surfaceproperties.txt';
const MANIFEST_KEY = 'file';
const decoder = new TextDecoder();

type Partial = { -readonly [K in keyof SurfaceSounds]?: string };

/** Every surface's sounds, by lower-case name, from the files' text in manifest order. */
export function parseSurfaceProperties(texts: readonly string[]): Map<string, SurfaceSounds> {
  const own = new Map<string, { base: string | null; sounds: Partial }>();
  for (const text of texts) {
    for (const node of parseKeyValues(text)) {
      const name = node.key.toLowerCase();
      if (node.value !== null || own.has(name)) continue;
      own.set(name, read(node.children));
    }
  }
  const done = new Map<string, Partial>();
  const resolve = (name: string, seen: Set<string>): Partial => {
    const ready = done.get(name);
    if (ready) return ready;
    const s = own.get(name);
    if (!s || seen.has(name)) return {};
    seen.add(name);
    const from = s.base ? resolve(s.base, seen) : name === DEFAULT ? {} : resolve(DEFAULT, seen);
    const out = { ...from, ...s.sounds };
    done.set(name, out);
    return out;
  };
  const result = new Map<string, SurfaceSounds>();
  for (const name of own.keys()) {
    const s = resolve(name, new Set());
    if (Object.values(KEYS).every((k) => s[k])) result.set(name, s as SurfaceSounds);
  }
  return result;
}

/** The game's surfaces from its manifest, or the one file older games have; empty when neither is there. */
export async function loadSurfaceProperties(files: SourceFiles): Promise<Map<string, SurfaceSounds>> {
  const manifest = await files.read(MANIFEST);
  const paths = manifest
    ? parseKeyValues(decoder.decode(manifest)).flatMap((n) => n.children).filter((n) => n.key.toLowerCase() === MANIFEST_KEY && n.value).map((n) => normalizeSourcePath(n.value as string))
    : [SINGLE];
  const texts: string[] = [];
  for (const path of paths) {
    const bytes = await files.read(path);
    if (bytes) texts.push(decoder.decode(bytes));
  }
  return parseSurfaceProperties(texts);
}

function read(children: readonly KeyValues[]): { base: string | null; sounds: Partial } {
  let base: string | null = null;
  const sounds: Partial = {};
  for (const c of children) {
    const key = c.key.toLowerCase();
    if (!c.value) continue;
    if (key === BASE) base = c.value.toLowerCase();
    const k = KEYS[key];
    if (k) sounds[k] = c.value;
  }
  return { base, sounds };
}
