import { type Mat4, invert, multiply } from '../../core/mat4';
import type { Vec3 } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject, Transform } from '../../model/scene.types';
import { objectMatrix } from '../../world/bounds';
import { MAX_OBJECTS, TEXEL_FLOATS } from './render.constants';

/** Rows of one object's motion: a 3×4 affine map, one vec4 a row (GameMotion in game-taa.glsl). */
export const MOTION_ROWS = 3;
export const MOTION_FLOATS = MAX_OBJECTS * MOTION_ROWS * TEXEL_FLOATS;
const IDENTITY_ROWS = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]] as const;

const sameVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const sameTransform = (a: Transform, b: Transform): boolean =>
  a === b || (sameVec(a.position, b.position) && sameVec(a.rotation, b.rotation) && sameVec(a.size, b.size));

/**
 * Where each traced object's points were a frame ago: for the object in row i (packedObjects
 * order) the map from its world position now to its world position then, so the temporal
 * upscale follows moving objects (a flying plane, a thrown prop) instead of smearing them.
 * Objects that did not move, or were not there, keep the identity. Null when nothing moved.
 */
export function motionRows(prev: readonly SceneObject[], now: readonly SceneObject[]): Float32Array | null {
  const before = new Map<ObjectId, SceneObject>(prev.map((o) => [o.id, o]));
  const out = new Float32Array(MOTION_FLOATS);
  let moved = false;
  now.forEach((o, i) => {
    const p = before.get(o.id);
    const m: Mat4 | null = p && !sameTransform(p.transform, o.transform) ? multiply(objectMatrix(p), invert(objectMatrix(o))) : null;
    for (let r = 0; r < MOTION_ROWS; r++) {
      const at = (i * MOTION_ROWS + r) * TEXEL_FLOATS;
      if (m) out.set([m[r], m[TEXEL_FLOATS + r], m[2 * TEXEL_FLOATS + r], m[3 * TEXEL_FLOATS + r]], at);
      else out.set(IDENTITY_ROWS[r], at);
    }
    moved ||= m !== null;
  });
  return moved ? out : null;
}
