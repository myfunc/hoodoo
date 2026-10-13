import type { SkyPreset } from '../../assets/sky.presets';
import type { Sky } from '../../model/scene.types';
import { MY_SKIES_MAX, type MySkies, SKY_NAME_MAX } from '../sky-presets-store';

/**
 * My skies replaces a sky saved again under the same name, cuts names to
 * SKY_NAME_MAX UTF-16 units and drops the oldest sky past MY_SKIES_MAX. A palette
 * never relies on that: its name already fits (whole characters only), a taken
 * name gets " 2", " 3"… and a full list is not saved to at all.
 */

const FALLBACK = 'Palette sky';
const SPACES = /\s+/g;
const FIRST_COPY = 2;

/** At most `max` UTF-16 units, cut between characters so a surrogate pair is never split. */
function fit(text: string, max: number): string {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trim();
}

/** A name My skies stores unchanged and that no saved sky has. */
export function freePaletteSkyName(list: readonly SkyPreset[], wanted: string): string {
  const base = fit(wanted.replace(SPACES, ' ').trim(), SKY_NAME_MAX) || FALLBACK;
  const taken = new Set(list.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = FIRST_COPY; ; i++) {
    const suffix = ` ${i}`;
    const name = `${fit(base, SKY_NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

export const mySkiesFull = (list: readonly SkyPreset[]): boolean => list.length >= MY_SKIES_MAX;

export type PaletteSkySaved = { readonly saved: true; readonly name: string } | { readonly saved: false; readonly reason: string };

export const FULL_REASON = `My skies is full (${MY_SKIES_MAX}). Delete one under Sky & Fog › My skies to save another.`;
const NOT_ADDED = 'It could not be added to My skies.';

/** Saves beside the skies already there: refused when the list is full, never replacing or dropping one. */
export function savePaletteSky(skies: MySkies, wanted: string, sky: Sky): PaletteSkySaved {
  if (mySkiesFull(skies.all)) return { saved: false, reason: FULL_REASON };
  const before = skies.all.length;
  const name = freePaletteSkyName(skies.all, wanted);
  skies.save(name, sky);
  const kept = skies.all.length === before + 1 && skies.all.some((p) => p.name === name);
  return kept ? { saved: true, name } : { saved: false, reason: NOT_ADDED };
}
