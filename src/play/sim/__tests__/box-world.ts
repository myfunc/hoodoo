import { type Vec3, ZERO3, add, dot, normalize, scale, sub } from '../../../core/vec3';
import type { Trace, Tracer } from '../pmove';

/**
 * An exact little world for movement tests: axis-aligned boxes and solid
 * half-spaces (n·x < d is inside). Sweeps keep `skin` from surfaces the way the
 * physics layer's do.
 */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}
export interface Plane {
  readonly normal: Vec3;
  readonly d: number;
}

const BOX_BODY = 1;
const PLANE_BODY = 2;
const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

interface Hit {
  t: number;
  normal: Vec3;
  solid: boolean;
  body: number;
}

export class BoxWorld implements Tracer {
  traces = 0;
  constructor(readonly boxes: readonly Box[], readonly planes: readonly Plane[], private readonly skin: number) {}

  trace(start: Vec3, end: Vec3, half: Vec3): Trace {
    this.traces++;
    const dir = sub(end, start);
    const hits = [...this.boxes.map((b) => this.boxHit(b, start, dir, half)), ...this.planes.map((p) => this.planeHit(p, start, dir, half))]
      .filter((h): h is Hit => h !== null);
    const hit = hits.find((h) => h.solid) ?? hits.reduce<Hit | null>((a, h) => (!a || h.t < a.t ? h : a), null);
    if (!hit) return { fraction: 1, end, normal: ZERO3, startSolid: false, body: null, point: null };
    if (hit.solid) return { fraction: 0, end: start, normal: hit.normal, startSolid: true, body: hit.body, point: start };
    return { fraction: hit.t, end: add(start, scale(dir, hit.t)), normal: hit.normal, startSolid: false, body: hit.body, point: add(start, scale(dir, hit.t)) };
  }

  /** The box grown by the hull: a ray against it, entering at distance `skin`. */
  private boxHit(b: Box, start: Vec3, dir: Vec3, half: Vec3): Hit | null {
    const inside = [0, 1, 2].every((i) => start[i] > b.min[i] - half[i] && start[i] < b.max[i] + half[i]);
    if (inside) return { t: 0, normal: ZERO3, solid: true, body: BOX_BODY };
    let t0 = -Infinity;
    let t1 = Infinity;
    let normal: Vec3 = ZERO3;
    for (let i = 0; i < 3; i++) {
      const lo = b.min[i] - half[i] - this.skin;
      const hi = b.max[i] + half[i] + this.skin;
      if (Math.abs(dir[i]) < 1e-12) {
        if (start[i] <= lo || start[i] >= hi) return null;
        continue;
      }
      const a = (lo - start[i]) / dir[i];
      const c = (hi - start[i]) / dir[i];
      const enter = Math.min(a, c);
      if (enter > t0) {
        t0 = enter;
        normal = scale(AXES[i], dir[i] > 0 ? -1 : 1);
      }
      t1 = Math.min(t1, Math.max(a, c));
    }
    if (t0 > t1 || t1 < 0 || t0 > 1) return null;
    // Within the skin already: blocked only when moving in.
    if (t0 <= 0) return dot(dir, normal) < 0 ? { t: 0, normal, solid: false, body: BOX_BODY } : null;
    return { t: t0, normal, solid: false, body: BOX_BODY };
  }

  private planeHit(p: Plane, start: Vec3, dir: Vec3, half: Vec3): Hit | null {
    const n = normalize(p.normal);
    const reach = Math.abs(half[0] * n[0]) + Math.abs(half[1] * n[1]) + Math.abs(half[2] * n[2]);
    const s0 = dot(n, start) - p.d - reach;
    if (s0 < 0) return { t: 0, normal: n, solid: true, body: PLANE_BODY };
    const along = dot(n, dir);
    if (s0 <= this.skin) return along < 0 ? { t: 0, normal: n, solid: false, body: PLANE_BODY } : null;
    if (along >= 0) return null;
    const t = (s0 - this.skin) / -along;
    return t <= 1 ? { t, normal: n, solid: false, body: PLANE_BODY } : null;
  }
}

/** Flat ground at y = 0. */
export const GROUND: Plane = { normal: [0, 1, 0], d: 0 };
