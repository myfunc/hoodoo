import type { Vec3 } from '../../core/vec3';
import { type ShapeSpec, ShapeType } from './shapes';

/**
 * READ ME — a game prop's body (io/source/static-prop.ts): its collision
 * model's convex pieces as convex hulls, stretched by how much the object is
 * scaled along its own axes, so a prop resized in Garry's Mod mode collides
 * as it looks. A prop without a collision model gets a box of its picture's bounds.
 */

const XYZ = 3;

export function propShapes(hulls: readonly Float32Array[], scale: Vec3, bounds: { readonly min: Vec3; readonly max: Vec3 }): ShapeSpec[] {
  if (!hulls.length) {
    const half = bounds.max.map((v, i) => ((v - bounds.min[i]) / 2) * scale[i]) as unknown as Vec3;
    const offset = bounds.max.map((v, i) => ((v + bounds.min[i]) / 2) * scale[i]) as unknown as Vec3;
    return [{ type: ShapeType.Box, half, offset }];
  }
  return hulls.map((h) => {
    const points = new Float32Array(h.length);
    for (let k = 0; k < h.length; k++) points[k] = h[k] * scale[k % XYZ];
    return { type: ShapeType.Hull, points };
  });
}
