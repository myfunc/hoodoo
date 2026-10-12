import type { Rgb } from '../core/color';
import type { Sky } from '../model/scene.types';

const sameRgb = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** True when haze and fog already take the horizon's colour (matchHazeToHorizon would change nothing). */
export function hazeMatchesHorizon(sky: Sky): boolean {
  return sameRgb(sky.hazeColor, sky.horizonColor) && sameRgb(sky.fogColor, sky.horizonColor);
}

/**
 * The sky with haze and fog in its horizon colour, everything else as it was. Far ground,
 * sea and the sky just above the horizon then meet in one colour: the tracer veils distant
 * surfaces in haze and fog and fades the farthest into the horizon (atmosphere() in
 * render/gpu/glsl/50-sky.glsl). The same sky comes back when they already match.
 */
export function matchHazeToHorizon(sky: Sky): Sky {
  if (hazeMatchesHorizon(sky)) return sky;
  const h = sky.horizonColor;
  return { ...sky, hazeColor: [h[0], h[1], h[2]], fogColor: [h[0], h[1], h[2]] };
}
