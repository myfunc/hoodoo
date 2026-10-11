import { type Vec3, add, dot, scale } from '../core/vec3';

/**
 * CPU ray tests of the solid primitives, matching the ray tracer's shapes
 * (render/gpu/glsl/30-shapes.glsl) in object space: rays are not normalised,
 * so `t` is shared with world space. Each returns the first `t` ahead of the
 * origin, or Infinity on a miss.
 */

const PARALLEL_EPS = 1e-12;
/** Cone: x² + z² <= k (1 - y)², apex at y = 1, base of radius 1 at y = -1. */
const CONE_K = 0.25;
const TORUS_STEPS = 256;
const TORUS_HIT_EPS = 1e-5;
/** Pyramid sides as dot(n, p) <= 1 (unnormalised): base -1..1 at y = -1, apex at (0, 1, 0). */
const PYRAMID_SIDES: readonly Vec3[] = [[2, 1, 0], [-2, 1, 0], [0, 1, 2], [0, 1, -2]];
const BOX_SIDES: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

interface Span {
  t0: number;
  t1: number;
}

const open = (): Span => ({ t0: -Infinity, t1: Infinity });

const MISS: Span = { t0: Infinity, t1: -Infinity };

/** Keeps the part of the span inside the half-space dot(n, p) <= k. */
function clip(o: Vec3, d: Vec3, n: Vec3, k: number, s: Span): Span {
  const denom = dot(n, d);
  const dist = k - dot(n, o);
  if (Math.abs(denom) < PARALLEL_EPS) return dist < 0 ? MISS : s;
  const t = dist / denom;
  return denom < 0 ? { t0: Math.max(s.t0, t), t1: s.t1 } : { t0: s.t0, t1: Math.min(s.t1, t) };
}

/** Entry, or exit when the origin is inside. */
const firstT = (s: Span): number => (s.t0 > s.t1 || s.t1 <= 0 ? Infinity : s.t0 > 0 ? s.t0 : s.t1);

const slab = (o: Vec3, d: Vec3): Span => clip(o, d, [0, -1, 0], 1, clip(o, d, [0, 1, 0], 1, open()));

export function cubeSpan(o: Vec3, d: Vec3): Span {
  let s = slab(o, d);
  for (const n of BOX_SIDES) s = clip(o, d, n, 1, s);
  return s;
}

export const cubeT = (o: Vec3, d: Vec3): number => firstT(cubeSpan(o, d));

export function cylinderT(o: Vec3, d: Vec3): number {
  const s = slab(o, d);
  const a = d[0] * d[0] + d[2] * d[2];
  const b = o[0] * d[0] + o[2] * d[2];
  const c = o[0] * o[0] + o[2] * o[2] - 1;
  if (a < PARALLEL_EPS) return c > 0 ? Infinity : firstT(s);
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  return firstT({ t0: Math.max(s.t0, (-b - r) / a), t1: Math.min(s.t1, (-b + r) / a) });
}

/** Only the lower nappe (y <= 1) is the solid; a < 0 means the ray passes between nappes. */
export function coneT(o: Vec3, d: Vec3): number {
  const s = slab(o, d);
  const oy = 1 - o[1];
  const a = d[0] * d[0] + d[2] * d[2] - CONE_K * d[1] * d[1];
  const b = o[0] * d[0] + o[2] * d[2] + CONE_K * oy * d[1];
  const c = o[0] * o[0] + o[2] * o[2] - CONE_K * oy * oy;
  const disc = b * b - a * c;
  if (Math.abs(a) < PARALLEL_EPS || disc < 0) return c > 0 ? Infinity : firstT(s);
  const r = Math.sqrt(disc);
  const lo = Math.min((-b - r) / a, (-b + r) / a);
  const hi = Math.max((-b - r) / a, (-b + r) / a);
  if (a > 0) return firstT({ t0: Math.max(s.t0, lo), t1: Math.min(s.t1, hi) });
  return o[1] + d[1] * lo <= 1 ? firstT({ t0: s.t0, t1: Math.min(s.t1, lo) }) : firstT({ t0: Math.max(s.t0, hi), t1: s.t1 });
}

/** Square base -1..1 at y = -1, apex at (0, 1, 0). */
export function pyramidT(o: Vec3, d: Vec3): number {
  let s = clip(o, d, [0, -1, 0], 1, open());
  for (const n of PYRAMID_SIDES) s = clip(o, d, n, 1, s);
  return firstT(s);
}

/** Ring of tube radius `tube` whose outer edge touches the unit box. */
function torusDistance(p: Vec3, tube: number): number {
  return Math.hypot(Math.hypot(p[0], p[2]) - (1 - tube), p[1]) - tube;
}

/** Sphere tracing inside the unit box, like the ray tracer: a thin ring is hit only on its tube. */
export function torusT(o: Vec3, d: Vec3, tube: number): number {
  const box = cubeSpan(o, d);
  if (box.t0 > box.t1 || box.t1 <= 0) return Infinity;
  const len = Math.hypot(d[0], d[1], d[2]);
  let t = Math.max(box.t0, 0);
  for (let i = 0; i < TORUS_STEPS && t <= box.t1; i++) {
    const dist = torusDistance(add(o, scale(d, t)), tube);
    if (dist < TORUS_HIT_EPS) return t;
    t += dist / len;
  }
  return Infinity;
}
