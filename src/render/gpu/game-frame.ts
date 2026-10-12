import { type Vec3, dot } from '../../core/vec3';
import type { ViewBasis } from '../../world/camera-math';
import { HALTON_X, HALTON_Y, halton } from './halton';
import { MOTION_SCALE, type MotionTuning } from './motion-scale';

/** Game renderer tuning (game-renderer.ts, measured in docs/rendering.md). */
export const GAME = {
  /** The first frames trace about this many pixels; then the fence decides (GAME_PACE). */
  startPixels: 600000,
  /** Sub-pixel jitter phases (Halton 2, 3) before the pattern repeats. */
  jitterPhases: 8,
  /** Frames to keep refining once nothing changes; then the loop rests. */
  settleFrames: 32,
  /** How many frames the temporal average holds: at rest, and while the camera moves fast. */
  restWeight: 12,
  movingWeight: 5,
  /** Bloom: levels of halving below the picture. */
  bloomLevels: 6,
  /** Light shafts are gathered at the size of this bloom level (0: half the view). */
  shaftLevel: 1,
  /** How far outside the screen (UV) the sun may be and still cast shafts, and the facing that fades them in. */
  sunMargin: 0.6,
  sunFacing: 0.25,
} as const;

/** This frame's sample position inside its traced pixel, 0..1 (Halton 2, 3; never the centre twice). */
export function jitterAt(frame: number): [number, number] {
  const i = (frame % GAME.jitterPhases) + 1;
  return [halton(i, HALTON_X), halton(i, HALTON_Y)];
}

/** World size of one of `height` traced rows at a distance of 1; 0 for orthographic views (no level of detail). */
export function pixelAngle(b: ViewBasis, height: number): number {
  return b.ortho || height <= 0 ? 0 : (2 * b.halfHeight) / height;
}

/** A camera for game-taa.glsl: rows position, forward, right, up (vec4 each), and tan(fov/2) or half height, aspect, ortho. */
export interface CameraRows {
  readonly rows: Float32Array;
  readonly extra: readonly [number, number, number];
}

const ROW = 4;
const ROWS = 4;

export function cameraRows(b: ViewBasis): CameraRows {
  const rows = new Float32Array(ROW * ROWS);
  [b.origin, b.forward, b.right, b.up].forEach((v, i) => rows.set([v[0], v[1], v[2], 0], i * ROW));
  return { rows, extra: [b.halfHeight, b.aspect, b.ortho ? 1 : 0] };
}

/** Where a light in direction `dir` sits on screen, and how strongly it casts shafts (0 behind the camera or far off screen). */
export interface SunSpot {
  readonly uv: readonly [number, number];
  readonly strength: number;
}

const NO_SUN: SunSpot = { uv: [0.5, 0.5], strength: 0 };

export function sunOnScreen(b: ViewBasis, dir: Vec3): SunSpot {
  const z = dot(dir, b.forward);
  if (b.ortho || z <= 0) return NO_SUN;
  const x = dot(dir, b.right) / (z * b.halfHeight * b.aspect);
  const y = dot(dir, b.up) / (z * b.halfHeight);
  const uv: [number, number] = [x * 0.5 + 0.5, y * 0.5 + 0.5];
  const outside = Math.max(0, Math.abs(uv[0] - 0.5) - 0.5, Math.abs(uv[1] - 0.5) - 0.5);
  const onScreen = Math.max(0, 1 - outside / GAME.sunMargin);
  return { uv, strength: onScreen * Math.min(1, z / GAME.sunFacing) };
}

/** Sizes of the bloom levels below a `width`×`height` picture: each half the last, at least one pixel. */
export function bloomSizes(width: number, height: number, levels: number = GAME.bloomLevels): [number, number][] {
  const out: [number, number][] = [];
  let w = width;
  let h = height;
  for (let i = 0; i < levels; i++) {
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
    out.push([w, h]);
  }
  return out;
}

/** Total weight of the bloom after its up steps (1 + s + s² + …, one term a level): soft focus divides by it to see an average. */
export function bloomWeight(spread: number, levels: number = GAME.bloomLevels): number {
  let w = 0;
  for (let i = 0; i < levels; i++) w += spread ** i;
  return w;
}

/**
 * The game renderer's size control goes by the fence alone: a frame the GPU has not finished
 * by the next animation frame was too big. (Timer queries on ANGLE over Metal also count the
 * compositor's work during Play and read two to three times high.) A step up is tried after
 * two calm seconds, and one that fails waits up to a minute before the next try.
 */
export const GAME_PACE: MotionTuning = { ...MOTION_SCALE, upFrames: 120, maxHold: 3600 };

/** The first trace size for a `width`×`height` view: about `GAME.startPixels`, at most the view's own. */
export function startScale(width: number, height: number): number {
  return Math.min(1, Math.sqrt(GAME.startPixels / Math.max(1, width * height)));
}
