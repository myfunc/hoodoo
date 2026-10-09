import { compose, transformPoint } from '../core/mat4';
import { type Vec3, add, length, scale, sub } from '../core/vec3';
import type { SceneObject } from '../model/scene.types';
import { INFINITE_KINDS } from './objects.factory';

export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

const CORNERS: readonly Vec3[] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [x, y, z])));
/** Infinite planes are given a finite extent for framing and wire drawing. */
export const PLANE_EXTENT = 40;

export const objectMatrix = (o: SceneObject) => compose(o.transform.position, o.transform.rotation, o.transform.size);

export function worldBox(o: SceneObject): Box {
  if (INFINITE_KINDS.has(o.kind)) {
    const p = o.transform.position;
    return { min: [p[0] - PLANE_EXTENT, p[1], p[2] - PLANE_EXTENT], max: [p[0] + PLANE_EXTENT, p[1], p[2] + PLANE_EXTENT] };
  }
  const m = objectMatrix(o);
  const pts = CORNERS.map((c) => transformPoint(m, c));
  const min: Vec3 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))];
  const max: Vec3 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))];
  return { min, max };
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((a, b) => ({
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }));
}

export function boxSphere(b: Box): { center: Vec3; radius: number } {
  const center = scale(add(b.min, b.max), 1 / 2);
  return { center, radius: Math.max(length(sub(b.max, center)), 1 / 2) };
}
