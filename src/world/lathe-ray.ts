import type { LatheProfileData, Point2 } from '../assets/lathe';
import type { Vec3 } from '../core/vec3';

/**
 * CPU ray test of a Lathe object in its unit space, for picking and Land: the
 * outline's frustums and the joined blocks exactly, the carved head as the
 * extruded side view (its rounding and hollows ignored); cuts are ignored.
 * Like ray-shapes.ts, rays are not normalised and `t` is shared with world space.
 */

const PARALLEL_EPS = 1e-12;
const HEAD_STEPS = 160;
const BISECT = 10;

/** Is (x, y) inside the polygon (even-odd)? */
export function insidePolygon(poly: readonly Point2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smallest positive root of each frustum, or Infinity. */
function outlineT(p: LatheProfileData, o: Vec3, d: Vec3): number {
  let best = Infinity;
  const a = d[0] * d[0] + d[2] * d[2];
  const keep = (t: number, y0: number, y1: number, check: (t: number) => boolean) => {
    const y = o[1] + d[1] * t;
    if (t > 0 && t < best && y >= y0 && y <= y1 && check(t)) best = t;
  };
  for (const s of p.segments) {
    const dy = s.y1 - s.y0;
    if (dy <= 0) {
      if (Math.abs(d[1]) < PARALLEL_EPS) continue;
      const t = (s.y0 - o[1]) / d[1];
      const r = Math.hypot(o[0] + d[0] * t, o[2] + d[2] * t);
      keep(t, s.y0, s.y1, () => r >= Math.min(s.r0, s.r1) && r <= Math.max(s.r0, s.r1));
      continue;
    }
    const k = (s.r1 - s.r0) / dy;
    const q = s.r0 + k * (o[1] - s.y0);
    const sk = k * d[1];
    const A = a - sk * sk;
    const B = o[0] * d[0] + o[2] * d[2] - q * sk;
    const C = o[0] * o[0] + o[2] * o[2] - q * q;
    const above = (t: number) => q + sk * t >= 0;
    if (Math.abs(A) < PARALLEL_EPS) {
      if (Math.abs(B) > PARALLEL_EPS) keep(-C / (2 * B), s.y0, s.y1, above);
      continue;
    }
    const disc = B * B - A * C;
    if (disc < 0) continue;
    const r = Math.sqrt(disc);
    keep((-B - r) / A, s.y0, s.y1, above);
    keep((-B + r) / A, s.y0, s.y1, above);
  }
  return best;
}

/** Entry into an axis-aligned box, or Infinity. */
function boxT(o: Vec3, d: Vec3, c: Vec3, h: Vec3): [number, number] {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < PARALLEL_EPS) {
      if (Math.abs(o[i] - c[i]) > h[i]) return [Infinity, -Infinity];
      continue;
    }
    const a = (c[i] - h[i] - o[i]) / d[i];
    const b = (c[i] + h[i] - o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return [t0, t1];
}

const firstOf = ([t0, t1]: [number, number]): number => (t0 > t1 || t1 <= 0 ? Infinity : t0 > 0 ? t0 : t1);

function headT(p: LatheProfileData, o: Vec3, d: Vec3): number {
  const head = p.head;
  if (!head) return Infinity;
  const [x0, y0, x1, y1] = head.box;
  const w = head.thickness.max;
  const [a, b] = boxT(o, d, [(x0 + x1) / 2, (y0 + y1) / 2, 0], [(x1 - x0) / 2, (y1 - y0) / 2, w]);
  if (a > b || b <= 0) return Infinity;
  const t = head.thickness;
  const inside = (s: number) => {
    const [x, y, z] = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
    const half = Math.min(t.max, Math.max(t.min, t.base + t.perX * x + t.perY * y));
    return Math.abs(z) <= half && insidePolygon(head.outline, x, y);
  };
  const start = Math.max(a, 0);
  const dt = (b - start) / HEAD_STEPS;
  for (let i = 0; i <= HEAD_STEPS; i++) {
    const s = start + dt * i;
    if (!inside(s)) continue;
    let lo = Math.max(start, s - dt);
    let hi = s;
    for (let k = 0; k < BISECT; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }
  return Infinity;
}

/** First `t` ahead on a Lathe object, from a ray in its unit space. */
export function latheT(p: LatheProfileData, origin: Vec3, dir: Vec3): number {
  const k = p.aspect;
  const o: Vec3 = [origin[0] * k, origin[1], origin[2] * k];
  const d: Vec3 = [dir[0] * k, dir[1], dir[2] * k];
  let best = Math.min(outlineT(p, o, d), headT(p, o, d));
  for (const b of p.blocks) best = Math.min(best, firstOf(boxT(o, d, b.center, b.half)));
  return best;
}
