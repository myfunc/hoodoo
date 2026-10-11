import { Studio } from '../../model/scene.enums';

/**
 * How each studio renders (the uStyle uniform). Hoodoo 2 is Bryce 2: a point sun
 * with hard shadows and highlights that clip. Hoodoo 3D gives the sun and lamps
 * a size, so shadows soften as samples add up, and rolls highlights off.
 */
export type RenderStyle = readonly [sunRadius: number, lightRadius: number, rolloff: number, unused: number];

export const RENDER_STYLES: Readonly<Record<Studio, RenderStyle>> = {
  [Studio.Two]: [0, 0, 0, 0],
  [Studio.ThreeD]: [0.045, 0.35, 0.25, 0],
};
