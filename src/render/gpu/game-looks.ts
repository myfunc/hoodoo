import type { Rgb } from '../../core/color';

/** The game renderer's looks: how Play's picture is graded (game-composite.glsl). */
export enum GameLook {
  /** Clean filmic: the ACES curve, a little bloom, sharp. */
  Filmic = 'filmic',
  /** Vaporwave: a magenta and cyan grade, strong pink bloom, faint scanlines. */
  Neon = 'neon',
  /** Toon: banded light and ink outlines over the traced reflections. */
  Ink = 'ink',
  /** Dreamy: soft focus, lifted pastel shadows, long light shafts. */
  Dream = 'dream',
  /** A 1990s slide-film postcard: deep colour, red halation round the highlights, a dark lens edge. */
  Postcard = 'postcard',
}

/** The look Play draws with. The others stay one word away (or `?look=<name>` on the URL). */
export const GAME_LOOK: GameLook = GameLook.Postcard;

export enum ToneCurve {
  /** ACES (Narkowicz's fit) on linearised light: filmic toe and shoulder. */
  Filmic = 0,
  /** The tracer's own colours up to a knee, then a soft roll-off: the Bryce palette kept. */
  Shoulder = 1,
}

export interface BloomLook {
  /** Brightest channel where bloom starts, and the width of its soft knee. */
  readonly threshold: number;
  readonly knee: number;
  /** Colour times strength added to the picture. */
  readonly tint: Rgb;
  /** How much of each smaller level an up step adds: wider glow toward 1. */
  readonly spread: number;
}

export interface ShaftLook {
  /** Colour times strength. */
  readonly tint: Rgb;
  /** Fade per step, share of the way to the sun walked, tightness of the glow round the sun. */
  readonly decay: number;
  readonly reach: number;
  readonly focus: number;
  /** Brightness under which the sky near the sun gives no shafts. */
  readonly threshold: number;
}

export interface InkLook {
  readonly color: Rgb;
  readonly strength: number;
  /** Relative depth jump drawn as an edge, and the normal cosine under which a fold is drawn. */
  readonly depth: number;
  readonly crease: number;
}

/** A three-colour ramp the picture's brightness is mapped through, mixed in by `amount`. */
export interface GradientMap {
  readonly amount: number;
  readonly lo: Rgb;
  readonly mid: Rgb;
  readonly hi: Rgb;
}

export interface Look {
  readonly label: string;
  /** Mirror and glass bounces the tracer follows (4–5). */
  readonly bounces: number;
  /** Diffuse light in bands (0: smooth). */
  readonly toonBands: number;
  readonly exposure: number;
  readonly curve: ToneCurve;
  /** S-curve power about mid-grey (1: none) and saturation (1: as traced). */
  readonly contrast: number;
  readonly saturation: number;
  readonly lift: Rgb;
  readonly gamma: Rgb;
  readonly gain: Rgb;
  /** Added to the shadows and to the highlights (split toning). */
  readonly shadowTint: Rgb;
  readonly highlightTint: Rgb;
  readonly bloom: BloomLook;
  /** The wide bloom again in this colour: film's red glow round bright things. */
  readonly halation: Rgb;
  readonly shafts: ShaftLook | null;
  /** Chromatic fringe in output pixels at the corners; vignette 0..1; soft focus 0..1; sharpening. */
  readonly fringe: number;
  readonly vignette: number;
  readonly soften: number;
  readonly sharpen: number;
  readonly scanlines: number;
  readonly map: GradientMap | null;
  readonly ink: InkLook | null;
}

const NEUTRAL: Rgb = [1, 1, 1];
const NONE: Rgb = [0, 0, 0];

export const LOOKS: Readonly<Record<GameLook, Look>> = {
  [GameLook.Filmic]: {
    label: 'Clean filmic', bounces: 5, toonBands: 0,
    exposure: 1.08, curve: ToneCurve.Filmic, contrast: 1.05, saturation: 1.08,
    lift: NONE, gamma: NEUTRAL, gain: NEUTRAL, shadowTint: [0, 0.004, 0.012], highlightTint: [0.012, 0.006, 0],
    bloom: { threshold: 1.05, knee: 0.35, tint: [0.1, 0.1, 0.1], spread: 0.75 }, halation: NONE,
    shafts: { tint: [0.35, 0.3, 0.24], decay: 0.965, reach: 0.85, focus: 9, threshold: 0.6 },
    fringe: 0, vignette: 0.18, soften: 0, sharpen: 0.25, scanlines: 0, map: null, ink: null,
  },
  [GameLook.Neon]: {
    label: 'Vapor neon', bounces: 5, toonBands: 0,
    exposure: 1.0, curve: ToneCurve.Shoulder, contrast: 1.18, saturation: 1.3,
    lift: [0.03, 0.0, 0.07], gamma: [1, 0.96, 1.04], gain: [1.05, 0.95, 1.05],
    shadowTint: [0.04, 0, 0.1], highlightTint: [0.05, 0, 0.03],
    bloom: { threshold: 1.0, knee: 0.4, tint: [0.5, 0.15, 0.45], spread: 0.85 }, halation: NONE,
    shafts: { tint: [0.5, 0.2, 0.6], decay: 0.97, reach: 0.9, focus: 7, threshold: 0.6 },
    fringe: 2.5, vignette: 0.35, soften: 0, sharpen: 0.15, scanlines: 0.04,
    map: { amount: 0.16, lo: [0.06, 0.02, 0.22], mid: [0.8, 0.18, 0.6], hi: [1, 0.86, 0.8] }, ink: null,
  },
  [GameLook.Ink]: {
    label: 'Toon ink', bounces: 5, toonBands: 3,
    exposure: 1.02, curve: ToneCurve.Shoulder, contrast: 1.08, saturation: 1.2,
    lift: [0.02, 0.02, 0.03], gamma: NEUTRAL, gain: NEUTRAL, shadowTint: [0, 0, 0.02], highlightTint: [0.01, 0.01, 0],
    bloom: { threshold: 1.1, knee: 0.3, tint: [0.08, 0.08, 0.08], spread: 0.7 }, halation: NONE,
    shafts: null,
    fringe: 0, vignette: 0.1, soften: 0, sharpen: 0, scanlines: 0, map: null,
    ink: { color: [0.05, 0.04, 0.07], strength: 0.9, depth: 0.04, crease: 0.6 },
  },
  [GameLook.Dream]: {
    label: 'Dreamy haze', bounces: 4, toonBands: 0,
    exposure: 1.05, curve: ToneCurve.Shoulder, contrast: 0.92, saturation: 0.9,
    lift: [0.05, 0.04, 0.06], gamma: [1.04, 1.02, 0.98], gain: [1.02, 1, 0.97],
    shadowTint: [0.02, 0, 0.03], highlightTint: [0.03, 0.02, 0],
    bloom: { threshold: 0.2, knee: 0.5, tint: [0.1, 0.09, 0.08], spread: 0.85 }, halation: NONE,
    shafts: { tint: [1.2, 0.95, 0.7], decay: 0.98, reach: 1, focus: 3, threshold: 0.35 },
    fringe: 0.6, vignette: 0.25, soften: 0.3, sharpen: 0, scanlines: 0, map: null, ink: null,
  },
  [GameLook.Postcard]: {
    label: 'Slide postcard', bounces: 5, toonBands: 0,
    exposure: 1.08, curve: ToneCurve.Filmic, contrast: 1.12, saturation: 1.22,
    lift: [0.0, 0.0, 0.012], gamma: [1, 1, 1.03], gain: [1.03, 1, 0.95],
    shadowTint: [0, 0.008, 0.02], highlightTint: [0.02, 0.008, 0],
    bloom: { threshold: 0.95, knee: 0.4, tint: [0.1, 0.09, 0.08], spread: 0.8 }, halation: [0.3, 0.06, 0.015],
    shafts: { tint: [0.45, 0.32, 0.2], decay: 0.968, reach: 0.9, focus: 8, threshold: 0.6 },
    fringe: 1.2, vignette: 0.38, soften: 0, sharpen: 0.3, scanlines: 0, map: null, ink: null,
  },
};

const LOOK_FLAG = 'look';

/** The look named by `?look=` on the URL (to compare them), else `GAME_LOOK`. */
export function lookFrom(search: string, fallback: GameLook = GAME_LOOK): GameLook {
  const name = new URLSearchParams(search).get(LOOK_FLAG);
  return (Object.values(GameLook) as string[]).includes(name ?? '') ? (name as GameLook) : fallback;
}
