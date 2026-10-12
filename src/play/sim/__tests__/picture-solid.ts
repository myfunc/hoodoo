import { inCut, radiusAt } from '../../../assets/lathe';
import { headSdf } from '../../../assets/lathe-head';
import { latheProfile } from '../../../assets/lathe.profiles';
import { invert, transformPoint } from '../../../core/mat4';
import type { Vec3 } from '../../../core/vec3';
import { ShapeKind } from '../../../model/scene.enums';
import type { SceneObject } from '../../../model/scene.types';
import { objectMatrix } from '../../../world/bounds';

/**
 * What the picture shows as solid, on the CPU: the ray tracer's inside tests
 * (render/gpu/glsl 30-shapes, 35-terrain, 36-lathe) in the object's unit box.
 * Collision tests check the player against this, not against the bodies.
 * Stones are left out (their surface is the noise texture's).
 */

/** Terrain heights under this are holes in the picture (TERRAIN_CLIP). */
const TERRAIN_CLIP = 0.004;

/** A terrain's height at unit x, z: bilinear between the samples, as the texture is read. */
export function terrainHeight(o: SceneObject, x: number, z: number): number {
  const t = o.terrain;
  if (!t) return 0;
  const n = t.resolution;
  const gx = Math.min(n - 1, Math.max(0, (x * 0.5 + 0.5) * (n - 1)));
  const gz = Math.min(n - 1, Math.max(0, (z * 0.5 + 0.5) * (n - 1)));
  const [x0, z0] = [Math.min(n - 2, Math.floor(gx)), Math.min(n - 2, Math.floor(gz))];
  const [fx, fz] = [gx - x0, gz - z0];
  const h = (i: number, j: number) => t.heights[j * n + i];
  return (h(x0, z0) * (1 - fx) + h(x0 + 1, z0) * fx) * (1 - fz) + (h(x0, z0 + 1) * (1 - fx) + h(x0 + 1, z0 + 1) * fx) * fz;
}

/** Whether a point of the object's unit box is inside what the picture shows. */
export function insideUnit(o: SceneObject, [x, y, z]: Vec3): boolean {
  const inBox = Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1;
  switch (o.kind) {
    case ShapeKind.Sphere: return x * x + y * y + z * z < 1;
    case ShapeKind.Cube: return Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(z) < 1;
    case ShapeKind.Cylinder: return Math.abs(y) < 1 && x * x + z * z < 1;
    case ShapeKind.Cone: return Math.abs(y) < 1 && Math.hypot(x, z) < (1 - y) / 2;
    case ShapeKind.Pyramid: return y > -1 && 2 * Math.abs(x) + y < 1 && 2 * Math.abs(z) + y < 1;
    case ShapeKind.Torus: return Math.hypot(Math.hypot(x, z) - (1 - o.shapeParam), y) < o.shapeParam;
    case ShapeKind.Lathe: {
      if (!inBox) return false;
      const p = latheProfile(o.shapeParam);
      const q: Vec3 = [x * p.aspect, y, z * p.aspect];
      const r = radiusAt(p.segments, y);
      if (r > 0 && Math.hypot(q[0], q[2]) < r && !(p.cut && inCut(p.cut, q))) return true;
      if (p.blocks.some((b) => [0, 1, 2].every((i) => Math.abs(q[i] - b.center[i]) < b.half[i]))) return true;
      return !!p.head && headSdf(p.head, q) < 0;
    }
    case ShapeKind.Terrain:
    case ShapeKind.Lattice: {
      if (!inBox) return false;
      const h = terrainHeight(o, x, z);
      if (h < TERRAIN_CLIP) return false;
      return o.kind === ShapeKind.Lattice ? Math.abs(y) < h : y < h * 2 - 1;
    }
    default: return false;
  }
}

/** Whether a world point is inside what the picture shows of `o`. */
export const insidePicture = (o: SceneObject, p: Vec3): boolean => insideUnit(o, transformPoint(invert(objectMatrix(o)), p));

/** Points of a box: its corners, edge middles, face centres and centre, drawn in by `shrink`. */
export function boxPoints(center: Vec3, half: Vec3, shrink = 1): Vec3[] {
  const out: Vec3[] = [];
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) out.push([center[0] + i * half[0] * shrink, center[1] + j * half[1] * shrink, center[2] + k * half[2] * shrink]);
  return out;
}
