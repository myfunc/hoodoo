import { type Vec3, add, cross, dot, length, normalize, scale, sub } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene } from '../../model/scene.types';
import { worldBox } from '../../world/bounds';
import { type RayHit, type RaycastOptions, raycast } from '../../world/raycast';
import { isDecal } from './tools/decal';

/**
 * Helpers for where the Tool Gun's aim lands: the surface's normal there, found
 * from two more rays a hair to the side and above (the tracer gives points
 * only), and the decals lying on an object.
 */

/** How far apart the extra rays meet the surface, of the hit's distance. */
const NUDGE = 1e-3;
/** A decal counts as on an object when its centre is within the object's box grown by this. */
const ON = 0.05;
const MIN = 1e-9;
const UP: Vec3 = [0, 1, 0];
const SIDE: Vec3 = [1, 0, 0];
const PARALLEL = 0.99;

/** The surface's normal at a hit, turned toward the eye; nothing when the extra rays miss the same object. */
export function normalAt(scene: Scene, eye: Vec3, aim: Vec3, hit: RayHit, opts: RaycastOptions): { normal?: Vec3 } {
  const along = normalize(aim);
  const side = normalize(cross(Math.abs(dot(along, UP)) > PARALLEL ? SIDE : UP, along));
  const up = cross(along, side);
  const nudge = hit.t * NUDGE;
  const a = raycast(scene, eye, normalize(add(along, scale(side, NUDGE))), opts);
  const b = raycast(scene, eye, normalize(add(along, scale(up, NUDGE))), opts);
  if (!a || !b || a.id !== hit.id || b.id !== hit.id || nudge < MIN) return {};
  const n = cross(sub(a.point, hit.point), sub(b.point, hit.point));
  if (length(n) < MIN) return {};
  const unit = normalize(n);
  return { normal: dot(unit, along) > 0 ? scale(unit, -1) : unit };
}

/** The decals on an object: in its group, or with their centre on its box. */
export function decalsOn(scene: Scene, id: ObjectId): Set<ObjectId> {
  const o = scene.objects.find((x) => x.id === id);
  const out = new Set<ObjectId>();
  if (!o) return out;
  const box = worldBox(o);
  for (const d of scene.objects) {
    if (!isDecal(d) || d.id === id) continue;
    const p = d.transform.position;
    const near = p.every((v, i) => v >= box.min[i] - ON && v <= box.max[i] + ON);
    if ((o.groupId && d.groupId === o.groupId) || near) out.add(d.id);
  }
  return out;
}
