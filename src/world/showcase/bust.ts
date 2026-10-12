import type { Vec3 } from '../../core/vec3';
import { multiply, rotationEuler } from '../../core/mat4';
import type { SceneObject, TerrainData } from '../../model/scene.types';
import { eulerOf } from '../group-transform';
import { place } from './kit';

/**
 * A classical marble head carved as a Symmetrical Lattice. A face is mirrored
 * left to right, and so is a lattice (solid where |y| < height), so the head is
 * stood on its side: the lattice's grid is the side view (forward and up) and
 * its height is the head's half-width there. The width comes from a sculpted
 * distance field in centimetres: skull, face, jaw, nose, lips, chin, brow, eyes,
 * cheekbones, ears and neck blended together, curls on the hair, a broken edge
 * where the neck was cut from the chest.
 */

/** u across the face (mirrored), v up, w forward; centimetres. */
export type Point = readonly [u: number, v: number, w: number];

interface Part {
  readonly at: Point;
  readonly radii: Point;
  /** How softly it blends in; a cut (`carve`) takes it away instead. */
  readonly blend: number;
  readonly carve?: boolean;
  /** Both sides: mirrored to -u (eyes, cheekbones, ears, nostrils). */
  readonly pair?: boolean;
}

const PARTS: readonly Part[] = [
  { at: [0, 3.8, -2.2], radii: [7.6, 10, 10], blend: 0 },
  { at: [0, -1.6, 2.4], radii: [6.9, 7, 6.4], blend: 2 },
  { at: [0, -6.4, 1.4], radii: [5.8, 3.6, 6], blend: 2 },
  { at: [0, -8.4, 6.2], radii: [2.6, 2.2, 2.4], blend: 1.4 },
  { at: [0, -5.4, 6.6], radii: [3.3, 2.3, 2.6], blend: 1.4 },
  { at: [0, -5.2, 8.6], radii: [2.3, 0.85, 0.9], blend: 0.5 },
  { at: [0, -6.5, 8.3], radii: [2, 0.8, 0.9], blend: 0.5 },
  { at: [0, 2.8, 6.9], radii: [5.6, 1.3, 1.8], blend: 1.2 },
  { at: [4.4, -0.4, 4.6], radii: [2.2, 1.7, 2.6], blend: 2, pair: true },
  { at: [7.1, 0.4, -1.6], radii: [1.2, 3.1, 1.9], blend: 0.6, pair: true },
  { at: [1.25, -3.4, 8.7], radii: [0.95, 0.8, 1.1], blend: 0.5, pair: true },
  { at: [3, 1.2, 8.3], radii: [1.9, 1.3, 1.9], blend: 0.7, carve: true, pair: true },
  { at: [3, 1.1, 6.9], radii: [1.35, 1, 1], blend: 0.3, pair: true },
  { at: [0, -5.95, 9.4], radii: [2.4, 0.16, 1.3], blend: 0.15, carve: true },
];

/** The nose: a cone with round ends from the bridge to the tip, radius at each. */
const NOSE = { from: [0, 1.8, 7.6] as Point, to: [0, -3, 9.6] as Point, r0: 0.9, r1: 1.4, blend: 0.6 };
/** The neck: an upright capsule, flattened across. */
const NECK = { top: [0, -4, -3.4] as Point, bottom: [0, -26, -5.4] as Point, radius: 5.4, across: 0.92, blend: 2.4 };
/** Hair: a shell over the skull above the hairline (forward w → height v), curled. */
const HAIR = {
  shell: 1.2, curl: 1.3, edge: 1.4,
  line: [[-14, -7], [-6, -3], [-1, 1.5], [3, 6.2], [12, 7]] as const,
  /** Two octaves of warped sine lumps: frequency, warp, weight; lumps are rounded by `round`. */
  octaves: [[1.25, 1.2, 1], [2.6, 0.8, 0.3]] as const,
  round: 0.5,
};
/** Where the neck breaks off: a height wavering along w and across u. */
const BREAK = { at: -21, waves: [[0.7, 1.5], [1.9, 0.6]] as const, across: 0.8 };

/** The side view the grid spans (w forward, v up) and the widest half-width it may need. */
const VIEW = { w: [-13.5, 12.5], v: [-24, 15], uMax: 10 } as const;
/** Sphere tracing in from the side: a step is this share of the distance, never less than `minStep`. */
const TRACE = { share: 0.8, minStep: 0.02, refine: 6 };
export const BUST_RESOLUTION = 256;

const smin = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

/** Distance to an ellipsoid, the usual bound (exact on spheres). */
function ellipsoid(u: number, v: number, w: number, c: Point, r: Point): number {
  const x = (u - c[0]) / r[0];
  const y = (v - c[1]) / r[1];
  const z = (w - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z);
  const k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

/** A cone with round ends: radius r0 at a, r1 at b. */
function roundCone(u: number, v: number, w: number, a: Point, b: Point, r0: number, r1: number): number {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pa = [u - a[0], v - a[1], w - a[2]];
  const t = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2])));
  return Math.hypot(pa[0] - ba[0] * t, pa[1] - ba[1] * t, pa[2] - ba[2] * t) - (r0 + (r1 - r0) * t);
}

const lerpLine = (line: readonly (readonly [number, number])[], x: number): number => {
  if (x <= line[0][0]) return line[0][1];
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i];
    const [x0, y0] = line[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return line[line.length - 1][1];
};

function curls(u: number, v: number, w: number): number {
  let sum = 0;
  for (const [f, warp, weight] of HAIR.octaves) {
    const a = Math.sin(f * u + warp * Math.sin(f * v / 2));
    const b = Math.sin(f * v + warp * Math.sin(f * w / 2));
    const c = Math.sin(f * w + warp * Math.sin(f * u / 2));
    sum += weight * Math.max(0, a * b * c) ** HAIR.round;
  }
  return sum;
}

/** The sculpture's distance field: negative inside. */
export function bustField(u: number, v: number, w: number): number {
  const au = Math.abs(u);
  const [skull] = PARTS;
  let d = ellipsoid(au, v, w, skull.at, skull.radii);
  for (const p of PARTS.slice(1)) {
    const e = p.pair ? ellipsoid(au, v, w, p.at, p.radii) : ellipsoid(u, v, w, p.at, p.radii);
    d = p.carve ? smax(d, -e, p.blend) : smin(d, e, p.blend);
  }
  d = smin(d, roundCone(u, v, w, NOSE.from, NOSE.to, NOSE.r0, NOSE.r1), NOSE.blend);
  d = smin(d, roundCone(u / NECK.across, v, w, NECK.top, NECK.bottom, NECK.radius, NECK.radius), NECK.blend);
  const hair = ellipsoid(au, v, w, skull.at, [skull.radii[0] + HAIR.shell, skull.radii[1] + HAIR.shell, skull.radii[2] + HAIR.shell]) - HAIR.curl * curls(u, v, w);
  d = smin(d, smax(hair, lerpLine(HAIR.line, w) - v, HAIR.edge), HAIR.edge);
  const broken = BREAK.at + BREAK.waves.reduce((s, [f, a]) => s + a * Math.sin(f * w), 0) + BREAK.across * Math.sin(u);
  return Math.max(d, broken - v);
}

/** Where a ray from a point inside the head along `dir` leaves it (centimetres). */
export function bustSurface(from: Point, dir: Point): Point {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const at = (t: number): Point => [from[0] + (dir[0] * t) / l, from[1] + (dir[1] * t) / l, from[2] + (dir[2] * t) / l];
  let t = 0;
  for (let d = bustField(...at(t)); d < 0; d = bustField(...at(t))) t += Math.max(-d * TRACE.share, TRACE.minStep);
  return at(t);
}

/** The half-width at (v, w): traced in from the side to the outermost solid point. */
function halfWidth(v: number, w: number): number {
  let u: number = VIEW.uMax;
  let prev = u;
  for (let d = bustField(u, v, w); u > 0; d = bustField(u, v, w)) {
    if (d < 0) {
      let [lo, hi] = [u, prev];
      for (let i = 0; i < TRACE.refine; i++) {
        const mid = (lo + hi) / 2;
        if (bustField(mid, v, w) < 0) lo = mid; else hi = mid;
      }
      return lo;
    }
    prev = u;
    u -= Math.max(d * TRACE.share, TRACE.minStep);
  }
  return 0;
}

let cached: { res: number; heights: Float32Array } | null = null;

/** The head's heights, grid x forward and z up, 0..1 of VIEW.uMax (computed once per page). */
export function bustTerrain(res = BUST_RESOLUTION): TerrainData {
  if (cached?.res !== res) {
    const heights = new Float32Array(res * res);
    for (let z = 0; z < res; z++) {
      const v = VIEW.v[0] + ((VIEW.v[1] - VIEW.v[0]) * z) / (res - 1);
      for (let x = 0; x < res; x++) {
        const w = VIEW.w[0] + ((VIEW.w[1] - VIEW.w[0]) * x) / (res - 1);
        heights[z * res + x] = halfWidth(v, w) / VIEW.uMax;
      }
    }
    cached = { res, heights };
  }
  return { resolution: res, heights: new Float32Array(cached.heights) };
}

/** Lattice x → forward, y → across, z → up, as columns of a rotation. */
const STAND_UP = new Float64Array([0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

export interface BustPlacement {
  /** Where the bottom of the neck's middle stands. */
  readonly base: Vec3;
  /** World units per centimetre. */
  readonly scale: number;
  /** Turn and tilt of the head, degrees (X then Y then Z), 0 faces +Z. */
  readonly turn: Vec3;
  readonly material: string;
}

/** A point of the head (centimetres: across, up, forward) in the world. */
export function bustPoint(p: BustPlacement, at: Point): Vec3 {
  const t = rotationEuler(p.turn);
  const k = p.scale;
  const local: Vec3 = [at[0] * k, (at[1] - BREAK.at) * k, at[2] * k];
  const along = (i: number) => p.base[i] + t[i] * local[0] + t[4 + i] * local[1] + t[2 * 4 + i] * local[2];
  return [along(0), along(1), along(2)];
}

/** Euler degrees of something on the head turned `yaw` degrees about the head's up axis from facing forward. */
export function bustFacing(p: BustPlacement, yaw: number): Vec3 {
  return eulerOf(multiply(rotationEuler(p.turn), rotationEuler([0, yaw, 0])), p.turn);
}

/** The head as a lattice object, its neck's break resting on `base`. */
export function marbleBust(p: BustPlacement): SceneObject {
  const k = p.scale;
  const half: Vec3 = [(VIEW.w[1] - VIEW.w[0]) / 2, (VIEW.v[1] - VIEW.v[0]) / 2, 0];
  const centre = bustPoint(p, [0, (VIEW.v[1] + VIEW.v[0]) / 2, (VIEW.w[1] + VIEW.w[0]) / 2]);
  const o = place({ entry: 'lattice', name: 'Marble Head', material: p.material, position: centre, size: [half[0] * k, VIEW.uMax * k, half[1] * k] });
  return { ...o, terrain: bustTerrain(), transform: { ...o.transform, rotation: eulerOf(multiply(rotationEuler(p.turn), STAND_UP), p.turn) } };
}
