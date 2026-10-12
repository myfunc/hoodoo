import type { Vec3 } from '../../../core/vec3';
import type { Sky } from '../../../model/scene.types';
import { skyUniforms } from '../../../render/gpu/scene-packer';
import type { VmLighting } from './vm-gpu';
import { MAX_LIGHTS } from './vm-shaders';

/**
 * The light on the hands, Source's way: an ambient cube sampled where the
 * player stands (here from the scene's sky — sky above, horizon around,
 * light bounced off the ground below) and the sun as a directional light,
 * dimmed when the player stands in shadow. World axes are Hoodoo's (Y up).
 */

const LIGHT = {
  /** Linear strengths, set by eye against the scene picture. */
  sky: 0.35,
  horizon: 0.3,
  ground: 0.12,
  sun: 1.4,
  /** What still reaches the hands in shadow. */
  shade: 0.15,
} as const;
const GAMMA = 2.2;
const CUBE_FACES = 6;
const AXES = 3;
const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

const linear = (c: Vec3, k: number): Vec3 => [c[0] ** GAMMA * k, c[1] ** GAMMA * k, c[2] ** GAMMA * k];

export interface LightInput {
  readonly sky: Sky;
  /** The view's axes in world space. */
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  /** Whether the sun reaches the eye (a ray toward the sun hits nothing). */
  readonly sunlit: boolean;
}

export function handsLighting(i: LightInput): VmLighting {
  const { sky } = i;
  const ambient = new Float32Array(CUBE_FACES * AXES);
  const put = (face: number, c: Vec3) => ambient.set(c, face * AXES);
  const horizon = linear(sky.horizonColor, LIGHT.horizon);
  put(FACE.px, horizon);
  put(FACE.nx, horizon);
  put(FACE.pz, horizon);
  put(FACE.nz, horizon);
  put(FACE.py, linear(sky.skyColor, LIGHT.sky));
  put(FACE.ny, linear(sky.ambientColor, LIGHT.ground));
  const u = skyUniforms(sky);
  const up = sky.sunAltitude > 0;
  const lightDir = new Float32Array(MAX_LIGHTS * AXES);
  const lightColor = new Float32Array(MAX_LIGHTS * AXES);
  lightDir.set(u.sunDir, 0);
  lightColor.set(up ? linear(sky.sunColor, LIGHT.sun * (i.sunlit ? 1 : LIGHT.shade)) : [0, 0, 0], 0);
  // View space (x right, y up, z back) to world, column-major.
  const back: Vec3 = [-i.forward[0], -i.forward[1], -i.forward[2]];
  const viewToWorld = Float32Array.from([...i.right, ...i.up, ...back]);
  return { ambient, lightDir, lightColor, viewToWorld };
}
