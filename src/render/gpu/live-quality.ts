import { LiveQuality } from '../../world/world.enums';

/** What the live view traces while things move, for one Settings › Live quality choice. */
export interface LiveMode {
  /** Draw moving frames with the interaction variant of the tracer (FAST_PREVIEW in 90-main.glsl). */
  readonly fast: boolean;
  /** Mirror and glass bounces, moving and settled. */
  readonly bounces: number;
  /** While nothing changes between moves, the moving frame keeps averaging rays at its size. */
  readonly refine: boolean;
  /**
   * Camera still and only objects moving: the share of the last moving frame a new one keeps,
   * so the picture averages over frames instead of showing fresh noise each time. 0 never reuses.
   */
  readonly keep: number;
  /** Cost of one moving-frame pixel against one full tracer ray (the first size guess, before timers report). */
  readonly cost: number;
}

/**
 * Fast is 0.6.3: one noiseless reflection, hard shadows. Full is the finished tracer,
 * one ray per change (the 0.6.2 look). Detailed traces glass and mirrors twice as deep
 * and, under a still camera, averages frames, so an edited or animated object shows
 * its finished look within a few frames. All three aim at 60 fps (MOTION_SCALE.frameMs);
 * two rays a frame at 30 fps looked no better and paced worse (docs/rendering.md).
 */
export const LIVE_MODES: Readonly<Record<LiveQuality, LiveMode>> = {
  [LiveQuality.Fast]: { fast: true, bounces: 4, refine: false, keep: 0, cost: 0.8 },
  [LiveQuality.Full]: { fast: false, bounces: 4, refine: true, keep: 0, cost: 1 },
  [LiveQuality.Detailed]: { fast: false, bounces: 8, refine: true, keep: 0.75, cost: 1.3 },
};

/**
 * How many independent rays an average is worth after keeping `keep` of one worth `old`
 * and adding one new ray (variance: (keep² / old + (1 − keep)²)⁻¹). The clamp in
 * temporal.glsl keeps less where things moved, so this is an upper bound there.
 */
export function raysWorth(old: number, keep: number): number {
  if (keep <= 0 || old <= 0) return 1;
  return 1 / ((keep * keep) / old + (1 - keep) * (1 - keep));
}
