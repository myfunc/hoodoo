import type { Rgb } from '../core/color';
import { type Lab, oklabInGamut, oklabToRgb, rgbToOklab } from '../core/oklab';
import type { Sky } from '../model/scene.types';

/**
 * A whole sky from one colour. The base is the dome's colour; a mood says where
 * every other sky colour sits from it in OKLCH (lightness, chroma, hue), so the
 * set stays in one family whatever the base is. Lightness targets are written for
 * a mid base (REFERENCE_L) and follow a lighter or darker base part of the way.
 */

/** The sky colours a mood sets; `cloud` is the cloud colour. */
export type SkySlot = 'skyColor' | 'horizonColor' | 'hazeColor' | 'fogColor' | 'sunColor' | 'ambientColor' | 'cloud';

export const SKY_SLOTS: readonly SkySlot[] = ['skyColor', 'horizonColor', 'sunColor', 'ambientColor', 'hazeColor', 'fogColor', 'cloud'];

export type SkyColors = Record<SkySlot, Rgb>;

export enum SkyMood {
  Calm = 'calm',
  Dusk = 'dusk',
  Pastel = 'pastel',
  Deep = 'deep',
  Split = 'split',
  Mono = 'mono',
}

/** Where one colour sits from the base: hue turn in degrees, lightness 0..1 for a mid base, chroma as a share of the base's. */
interface Place {
  readonly turn: number;
  readonly light: number;
  readonly chroma: number;
  /** A ceiling on chroma, for lights that should stay near white. */
  readonly maxChroma?: number;
}

/** The base colour itself, unchanged. */
const BASE: Place = { turn: 0, light: Number.NaN, chroma: 1 };

const SUN_CHROMA = 0.07;
const CLOUD_CHROMA = 0.04;

export const MOODS: readonly { mood: SkyMood; label: string; hint: string; places: Record<SkySlot, Place> }[] = [
  {
    mood: SkyMood.Calm, label: 'Calm', hint: 'Near hues, bright horizon',
    places: {
      skyColor: BASE,
      horizonColor: { turn: 15, light: 0.9, chroma: 0.35 },
      hazeColor: { turn: 15, light: 0.92, chroma: 0.3 },
      fogColor: { turn: 15, light: 0.84, chroma: 0.3 },
      sunColor: { turn: 40, light: 0.97, chroma: 1, maxChroma: SUN_CHROMA },
      ambientColor: { turn: 0, light: 0.6, chroma: 0.3 },
      cloud: { turn: 15, light: 0.97, chroma: 1, maxChroma: CLOUD_CHROMA },
    },
  },
  {
    mood: SkyMood.Dusk, label: 'Dusk', hint: 'Dark dome, opposite horizon',
    places: {
      skyColor: { turn: 0, light: 0.35, chroma: 1.1 },
      horizonColor: { turn: 150, light: 0.76, chroma: 0.9 },
      hazeColor: { turn: 150, light: 0.78, chroma: 0.7 },
      fogColor: { turn: 150, light: 0.62, chroma: 0.6 },
      sunColor: { turn: 165, light: 0.92, chroma: 0.6 },
      ambientColor: { turn: 60, light: 0.42, chroma: 0.5 },
      cloud: { turn: 150, light: 0.84, chroma: 0.45 },
    },
  },
  {
    mood: SkyMood.Pastel, label: 'Pastel', hint: 'Light and soft',
    places: {
      skyColor: { turn: 0, light: 0.8, chroma: 0.45 },
      horizonColor: { turn: 30, light: 0.93, chroma: 0.3 },
      hazeColor: { turn: 30, light: 0.94, chroma: 0.22 },
      fogColor: { turn: 30, light: 0.88, chroma: 0.22 },
      sunColor: { turn: 50, light: 0.98, chroma: 1, maxChroma: SUN_CHROMA },
      ambientColor: { turn: 0, light: 0.75, chroma: 0.25 },
      cloud: { turn: 30, light: 0.98, chroma: 1, maxChroma: CLOUD_CHROMA },
    },
  },
  {
    mood: SkyMood.Deep, label: 'Deep', hint: 'Rich and dark',
    places: {
      skyColor: { turn: 0, light: 0.24, chroma: 1.2 },
      horizonColor: { turn: -20, light: 0.52, chroma: 0.9 },
      hazeColor: { turn: -20, light: 0.54, chroma: 0.8 },
      fogColor: { turn: -20, light: 0.42, chroma: 0.7 },
      sunColor: { turn: 180, light: 0.86, chroma: 0.6 },
      ambientColor: { turn: 0, light: 0.32, chroma: 0.6 },
      cloud: { turn: -20, light: 0.62, chroma: 0.5 },
    },
  },
  {
    mood: SkyMood.Split, label: 'Split', hint: 'Horizon and sun split',
    places: {
      skyColor: BASE,
      horizonColor: { turn: 150, light: 0.82, chroma: 0.6 },
      hazeColor: { turn: 150, light: 0.84, chroma: 0.5 },
      fogColor: { turn: 150, light: 0.7, chroma: 0.5 },
      sunColor: { turn: 210, light: 0.93, chroma: 0.45 },
      ambientColor: { turn: 0, light: 0.48, chroma: 0.4 },
      cloud: { turn: 180, light: 0.92, chroma: 0.2 },
    },
  },
  {
    mood: SkyMood.Mono, label: 'Mono', hint: 'One hue, many lights',
    places: {
      skyColor: BASE,
      horizonColor: { turn: 0, light: 0.85, chroma: 0.5 },
      hazeColor: { turn: 0, light: 0.87, chroma: 0.45 },
      fogColor: { turn: 0, light: 0.75, chroma: 0.45 },
      sunColor: { turn: 0, light: 0.96, chroma: 0.15 },
      ambientColor: { turn: 0, light: 0.5, chroma: 0.4 },
      cloud: { turn: 0, light: 0.95, chroma: 0.15 },
    },
  },
];

/** The base lightness the moods' targets are written for, and how much of a base's difference from it carries over. */
const REFERENCE_L = 0.55;
const LIGHT_FOLLOW = 0.7;
const L_MIN = 0.03;
const L_MAX = 0.99;
const DEG = Math.PI / 180;
const FULL_TURN = 360;
const GAMUT_STEPS = 16;

interface Lch {
  readonly l: number;
  readonly c: number;
  /** Degrees 0..360. */
  readonly h: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function rgbToLch(c: Rgb): Lch {
  const [l, a, b] = rgbToOklab(c);
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) / DEG) % FULL_TURN + FULL_TURN) % FULL_TURN };
}

const labOf = (p: Lch): Lab => [p.l, p.c * Math.cos(p.h * DEG), p.c * Math.sin(p.h * DEG)];

/** The colour at this lightness and hue with as much of the chroma as the screen can show: hue holds, colour fades. */
export function lchToRgb(p: Lch): Rgb {
  if (oklabInGamut(labOf(p))) return oklabToRgb(labOf(p));
  let lo = 0;
  let hi = p.c;
  for (let i = 0; i < GAMUT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (oklabInGamut(labOf({ ...p, c: mid }))) lo = mid;
    else hi = mid;
  }
  return oklabToRgb(labOf({ ...p, c: lo }));
}

/** Every sky colour of `mood`, built from one base colour. */
export function skyColorsFrom(base: Rgb, mood: SkyMood): SkyColors {
  const b = rgbToLch(base);
  const places = (MOODS.find((m) => m.mood === mood) ?? MOODS[0]).places;
  const shift = (b.l - REFERENCE_L) * LIGHT_FOLLOW;
  const out = {} as Record<SkySlot, Rgb>;
  for (const slot of SKY_SLOTS) {
    const p = places[slot];
    if (Number.isNaN(p.light)) {
      out[slot] = base;
      continue;
    }
    const c = Math.min(b.c * p.chroma, p.maxChroma ?? Infinity);
    out[slot] = lchToRgb({ l: clamp(p.light + shift, L_MIN, L_MAX), c, h: b.h + p.turn });
  }
  return out;
}

export function skyColorOf(s: Sky, slot: SkySlot): Rgb {
  return slot === 'cloud' ? s.clouds.color : s[slot];
}

/** The sky with some of its colours replaced. */
export function withSkyColors(s: Sky, colors: Partial<SkyColors>): Sky {
  const { cloud, ...rest } = colors;
  return { ...s, ...rest, clouds: cloud ? { ...s.clouds, color: cloud } : s.clouds };
}


/** The colour turned around the hue circle by `turn` degrees and made lighter or darker by `light` (OKLab lightness). */
export function nudgeColor(c: Rgb, turn: number, light: number): Rgb {
  const p = rgbToLch(c);
  return lchToRgb({ l: clamp(p.l + light, 0, 1), c: p.c, h: p.h + turn });
}
