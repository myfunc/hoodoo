import { invert, transformDir, transformPoint } from '../core/mat4';
import { type Vec3, add, dot, scale } from '../core/vec3';
import { ShapeKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Scene, SceneObject } from '../model/scene.types';
import { objectMatrix } from './bounds';
import { INFINITE_KINDS, LIGHT_KINDS } from './objects.factory';
import { sample } from './terrain/heightfield';

export interface RayHit {
  readonly id: ObjectId;
  readonly t: number;
  readonly point: Vec3;
}

const TERRAIN_STEPS = 128;
const BISECT = 8;
const PARALLEL_EPS = 1e-12;

function sphereT(o: Vec3, d: Vec3): number {
  const a = dot(d, d);
  const b = dot(o, d);
  const c = dot(o, o) - 1;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / a;
  const t1 = (-b + s) / a;
  return t0 > 0 ? t0 : t1 > 0 ? t1 : Infinity;
}

function boxSpan(o: Vec3, d: Vec3): [number, number] {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < PARALLEL_EPS) {
      if (Math.abs(o[i]) > 1) return [Infinity, -Infinity];
      continue;
    }
    const a = (-1 - o[i]) / d[i];
    const b = (1 - o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return [t0, t1];
}

function planeT(o: Vec3, d: Vec3, finite: boolean, round: boolean): number {
  if (Math.abs(d[1]) < PARALLEL_EPS) return Infinity;
  const t = -o[1] / d[1];
  if (t <= 0) return Infinity;
  const p = add(o, scale(d, t));
  if (finite && (round ? p[0] * p[0] + p[2] * p[2] > 1 : Math.abs(p[0]) > 1 || Math.abs(p[2]) > 1)) return Infinity;
  return t;
}

function terrainT(obj: SceneObject, o: Vec3, d: Vec3): number {
  const t = obj.terrain;
  if (!t) return Infinity;
  const [a, b] = boxSpan(o, d);
  if (a > b || b < 0) return Infinity;
  const f = { res: t.resolution, h: t.heights };
  const lattice = obj.kind === ShapeKind.Lattice;
  const inside = (p: Vec3) => {
    const h = sample(f, (p[0] + 1) / 2, (p[2] + 1) / 2);
    return lattice ? Math.abs(p[1]) < h : p[1] < h * 2 - 1;
  };
  const start = Math.max(a, 0);
  const dt = (b - start) / TERRAIN_STEPS;
  let prev = start;
  for (let i = 0; i <= TERRAIN_STEPS; i++) {
    const tt = start + dt * i;
    if (inside(add(o, scale(d, tt)))) {
      let lo = prev;
      let hi = tt;
      for (let k = 0; k < BISECT; k++) {
        const mid = (lo + hi) / 2;
        if (inside(add(o, scale(d, mid)))) hi = mid; else lo = mid;
      }
      return hi;
    }
    prev = tt;
  }
  return Infinity;
}

function objectT(obj: SceneObject, origin: Vec3, dir: Vec3): number {
  const inv = invert(objectMatrix(obj));
  const o = transformPoint(inv, origin);
  const d = transformDir(inv, dir);
  switch (obj.kind) {
    case ShapeKind.Sphere:
    case ShapeKind.Stone:
    case ShapeKind.RadialLight:
    case ShapeKind.SpotLight:
      return sphereT(o, d);
    case ShapeKind.Disk: return planeT(o, d, true, true);
    case ShapeKind.Square: return planeT(o, d, true, false);
    case ShapeKind.WaterPlane:
    case ShapeKind.GroundPlane:
    case ShapeKind.CloudPlane:
      return planeT(o, d, false, false);
    case ShapeKind.Terrain:
    case ShapeKind.Lattice:
      return terrainT(obj, o, d);
    default: {
      const [a, b] = boxSpan(o, d);
      if (a > b || b < 0) return Infinity;
      return a > 0 ? a : b;
    }
  }
}

export interface RaycastOptions {
  readonly includePlanes: boolean;
  readonly includeLights: boolean;
  readonly skip?: ReadonlySet<ObjectId>;
}

/** CPU ray cast for picking and Land-on-surface; booleans are ignored. */
export function raycast(scene: Scene, origin: Vec3, dir: Vec3, opts: RaycastOptions): RayHit | null {
  let best: RayHit | null = null;
  for (const obj of scene.objects) {
    if (obj.hidden || opts.skip?.has(obj.id)) continue;
    if (!opts.includePlanes && INFINITE_KINDS.has(obj.kind)) continue;
    if (!opts.includeLights && LIGHT_KINDS.has(obj.kind)) continue;
    const t = objectT(obj, origin, dir);
    if (t < (best?.t ?? Infinity)) best = { id: obj.id, t, point: add(origin, scale(dir, t)) };
  }
  return best;
}
