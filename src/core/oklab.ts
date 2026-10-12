import type { Rgb } from './color';

/**
 * OKLab (Björn Ottosson, 2020): a colour space where equal steps look equal, so a
 * blend from chrome grey to gold passes through warm greys rather than a muddy
 * dip. Scene colours are display values (the tracer shades them as they are), so
 * they are decoded from the sRGB curve first and encoded again on the way back.
 */

export type Lab = readonly [number, number, number];

const SRGB_KNEE = 0.04045;
const LINEAR_KNEE = 0.0031308;
const SRGB_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;

const LMS_FROM_RGB = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const;
const LAB_FROM_LMS = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
] as const;
const LMS_FROM_LAB = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
] as const;
const RGB_FROM_LMS = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

type Matrix = readonly (readonly [number, number, number])[];

const apply = (m: Matrix, v: Lab): Lab => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as unknown as Lab;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const decode = (c: number): number => (c <= SRGB_KNEE ? c / SRGB_SLOPE : ((c + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA);
const encode = (c: number): number => (c <= LINEAR_KNEE ? c * SRGB_SLOPE : SRGB_SCALE * c ** (1 / SRGB_GAMMA) - SRGB_OFFSET);

export function rgbToOklab(c: Rgb): Lab {
  const lms = apply(LMS_FROM_RGB, [decode(clamp01(c[0])), decode(clamp01(c[1])), decode(clamp01(c[2]))]);
  return apply(LAB_FROM_LMS, lms.map(Math.cbrt) as unknown as Lab);
}

/** Back to a display colour; what falls outside the gamut is clipped to 0..1. */
export function oklabToRgb(lab: Lab): Rgb {
  const lms = apply(LMS_FROM_LAB, lab).map((x) => x * x * x) as unknown as Lab;
  const rgb = apply(RGB_FROM_LMS, lms);
  return [clamp01(encode(clamp01(rgb[0]))), clamp01(encode(clamp01(rgb[1]))), clamp01(encode(clamp01(rgb[2])))];
}
