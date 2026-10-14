import { type Vec3, add, scale, sub } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import { unionBox, worldBox } from '../../world/bounds';
import { LIGHT_KINDS } from '../../world/objects.factory';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { eulerOfQuat, mulQ, quatOfEuler, rotateQ } from '../sim/quat';

/**
 * READ ME — where a spawn lands (docs/sandbox-mode.md, Spawn menu): its build is
 * turned to the player's heading, so it faces them as Garry's Mod's props do, and
 * moved so its box rests on the aimed surface along the surface's normal, a hair
 * off it, so it settles instead of starting inside the floor or the wall. Props
 * go up to the scene's own limit: each picture draws the ones that matter to its
 * camera (render/object-budget.ts).
 */

/** The scene's most: a spawn past it is refused, as Garry's Mod refuses one past its limit. */
export const SPAWN_LIMIT = SCENE_LIMITS.objects;
/** Room between a spawn and what it rests on. */
const SPAWN_GAP = 0.002;

/** The aimed point and the surface's normal there. */
export interface SpawnSpot {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/** Objects the tracer draws: visible, not a trigger zone, not a light. */
export const tracedCount = (scene: Scene): number =>
  scene.objects.filter((o) => !o.hidden && !o.zone && !LIGHT_KINDS.has(o.kind)).length;

/** A build turned by `yaw` degrees about the vertical through the origin, standing on `spot`. */
export function placed(objects: readonly SceneObject[], yaw: number, spot: SpawnSpot): SceneObject[] {
  const turn = quatOfEuler([0, yaw, 0]);
  const turned = objects.map((o) => ({
    ...o,
    transform: { ...o.transform, position: rotateQ(turn, o.transform.position), rotation: eulerOfQuat(mulQ(turn, quatOfEuler(o.transform.rotation)), o.transform.rotation) },
  }));
  const box = unionBox(turned.map(worldBox));
  if (!box) return turned;
  const centre = scale(add(box.min, box.max), 0.5);
  const half = scale(sub(box.max, box.min), 0.5);
  const n = spot.normal;
  // How far the box reaches from its centre against the normal: the centre stands that far out.
  const reach = Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2];
  const shift = sub(add(spot.point, scale(n, reach + SPAWN_GAP)), centre);
  return turned.map((o) => ({ ...o, transform: { ...o.transform, position: add(o.transform.position, shift) } }));
}
