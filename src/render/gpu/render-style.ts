import type { Sky } from '../../model/scene.types';

/**
 * The uStyle uniform, from the sky's Soft shadows dial. At 0 it is Bryce 2: a point
 * sun with hard shadows and highlights that clip. Turned up, the sun and lamps get
 * a size, so shadows soften as samples add up, and highlights roll off; 100 is the
 * Bryce 3D look.
 */
export type RenderStyle = readonly [sunRadius: number, lightRadius: number, rolloff: number, unused: number];

const SOFT_STYLE: RenderStyle = [0.045, 0.35, 0.25, 0];
const DIAL = 100;

export function renderStyle(sky: Sky): RenderStyle {
  const k = Math.min(1, Math.max(0, sky.softShadows / DIAL));
  return [SOFT_STYLE[0] * k, SOFT_STYLE[1] * k, SOFT_STYLE[2] * k, SOFT_STYLE[3] * k];
}
