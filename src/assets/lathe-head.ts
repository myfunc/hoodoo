import type { Vec3 } from '../core/vec3';
import { type Point2, catmull } from './spline';

/**
 * A head carved from a side view, facing +X (the knight): the side view is cut
 * straight through a block as wide as `width`, then each edge is bevelled back
 * like a carver's chisel would — flat cheek planes, a flat face, a mane ridge
 * where the bevel meets itself. The shader (36-lathe.glsl) and picking share
 * the distance function below, in the profile's unit space.
 */

/** A value over the side view: base + perX·x + perY·y, kept within [min, max]. */
export interface SideField {
  readonly base: number;
  readonly perX: number;
  readonly perY: number;
  readonly min: number;
  readonly max: number;
}

/** A point of the side view, x forward and y up; a third entry marks a sharp corner. */
export type ViewPoint = readonly [x: number, y: number] | readonly [x: number, y: number, corner: true];

export interface CarvedHead {
  /** The side view, a closed loop. */
  readonly outline: readonly ViewPoint[];
  /** Half the width across Z. */
  readonly width: SideField;
  /** How much the edges are cut back at the outline; as much as the width makes a ridge. */
  readonly bevel: SideField;
  /** The bevel runs bevel / slope in from the outline: 1 is 45°, less is a flatter chamfer. */
  readonly slope: number;
  /** Creases between the planes blend over this distance; 0 keeps them sharp. */
  readonly soft: number;
  /** Above `from` only the ears stand: a gap `half` either side of the middle, each ear `thick` across. */
  readonly ears: { readonly from: number; readonly half: number; readonly thick: number };
  /** Hollows on both sides, [x, y, radius, depth]: eyes, nostrils. */
  readonly dents: readonly (readonly [number, number, number, number])[];
  /** Grooves on both sides from one point to another, [x0, y0, x1, y1, radius, depth]: a closed mouth. */
  readonly grooves?: readonly (readonly [number, number, number, number, number, number])[];
}

/** Edges of the side view in groups: a group far from a point is skipped whole. */
export interface HeadChunk {
  readonly center: Point2;
  readonly radius: number;
}

export interface CompiledHead {
  /** The side view as a dense polygon, unit space. */
  readonly outline: readonly Point2[];
  /** Outward unit normal at each point, shared by the edges either side: shading stays smooth along the outline. */
  readonly normals: readonly Point2[];
  readonly width: SideField;
  readonly bevel: SideField;
  readonly slope: number;
  readonly soft: number;
  readonly ears: CarvedHead['ears'];
  /** Centres on the +Z side (mirrored to -Z) and radius. */
  readonly dents: readonly (readonly [number, number, number, number])[];
  /** Ends on the +Z side (mirrored to -Z) and radius: [start, end, radius]. */
  readonly grooves: readonly (readonly [Vec3, Vec3, number])[];
  /** Bounds of the outline: [xMin, yMin, xMax, yMax]. */
  readonly box: readonly [number, number, number, number];
  readonly chunks: readonly HeadChunk[];
}

/** Edges per chunk: keep in sync with LATHE_HEAD_CHUNK in 36-lathe.glsl. */
export const HEAD_CHUNK = 8;
/** Longest piece of the side view's curve, in authoring units. */
const HEAD_STEP = 1.6;
const HEAD_SUBDIV = 6;
/** The width's ceiling blends over this many times `soft`: a gentle turn, not a crease. */
const WIDTH_BLEND = 4;
const DENT_SEARCH = 40;
/** Each ear thins this much per unit of height, from both sides: keep in sync with 36-lathe.glsl. */
export const EAR_TAPER = 0.3;
const TINY = 1e-9;

const isCorner = (p: ViewPoint): boolean => p.length === 3;
const xy = (p: ViewPoint): Point2 => [p[0], p[1]];

const areaOf = (pts: readonly Point2[]): number =>
  pts.reduce((sum, p, i) => sum + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);

/**
 * The closed side view made smooth through plain points and sharp at corners,
 * turned counter-clockwise; `corners` marks the points that stay sharp.
 */
export function smoothLoop(authored: readonly ViewPoint[]): { points: Point2[]; corners: boolean[] } {
  const pts = areaOf(authored.map(xy)) < 0 ? [...authored].reverse() : authored;
  const n = pts.length;
  const points: Point2[] = [];
  const corners: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const [b, c] = [pts[i], pts[(i + 1) % n]];
    const a = isCorner(b) ? b : pts[(i + n - 1) % n];
    const d = isCorner(c) ? c : pts[(i + 2) % n];
    const steps = Math.min(HEAD_SUBDIV, Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / HEAD_STEP)));
    for (let s = 0; s < steps; s++) {
      const p = s === 0 ? xy(b) : catmull(xy(a), xy(b), xy(c), xy(d), s / steps);
      const last = points[points.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= TINY) continue;
      points.push(p);
      corners.push(s === 0 && isCorner(b));
    }
  }
  return { points, corners };
}

/** A counter-clockwise edge's outward normal, from point a to point b. */
const edgeNormal = (a: Point2, b: Point2): Point2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / l, (a[0] - b[0]) / l];
};

/** Corners carry their outward bisector at this length: shorter than a normal, so they can be told apart. */
export const CORNER_MARK = 0.5;
const isMarked = (n: Point2): boolean => Math.hypot(n[0], n[1]) < (1 + CORNER_MARK) / 2;

/**
 * Outward normals at the points of a counter-clockwise polygon: the two edges' averaged,
 * unit length; at a corner the outward bisector at CORNER_MARK length (each edge then keeps
 * its own normal, and the bisector signs the distance to the corner point itself).
 */
export function pointNormals(poly: readonly Point2[], corners: readonly boolean[]): Point2[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const [prev, next] = [poly[(i + n - 1) % n], poly[(i + 1) % n]];
    if (corners[i]) {
      const la = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1;
      const lb = Math.hypot(next[0] - p[0], next[1] - p[1]) || 1;
      const ta: Point2 = [(p[0] - prev[0]) / la, (p[1] - prev[1]) / la];
      const tb: Point2 = [(next[0] - p[0]) / lb, (next[1] - p[1]) / lb];
      // Out of a convex corner along ta - tb, out of a concave one the other way.
      const turn = ta[0] * tb[1] - ta[1] * tb[0] >= 0 ? 1 : -1;
      const m: Point2 = [turn * (ta[0] - tb[0]), turn * (ta[1] - tb[1])];
      const l = Math.hypot(m[0], m[1]) || 1;
      return [(m[0] / l) * CORNER_MARK, (m[1] / l) * CORNER_MARK];
    }
    const [a, b] = [edgeNormal(prev, p), edgeNormal(p, next)];
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  });
}

export const fieldAt = (f: SideField, x: number, y: number): number => Math.min(f.max, Math.max(f.min, f.base + f.perX * x + f.perY * y));

/** Polynomial smooth maximum and minimum over k (k = 0 is the plain one). */
export function smax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}
const smin = (a: number, b: number, k: number): number => -smax(-a, -b, k);

/**
 * Signed distance to the counter-clockwise side view, negative inside. Each edge between
 * smooth points bends off its chord by a small cubic sag, so the surface's normal turns
 * evenly from one point's normal to the next: a smooth curve, not flat facets. At a corner
 * each edge keeps its own normal and the two meet sharp; nearest a point, the plain distance.
 */
export function outlineDistance(poly: readonly Point2[], normals: readonly Point2[], x: number, y: number): number {
  let best = Infinity;
  let value = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    // The edge runs from point j to point i; u goes from i (0) to j (1).
    const [bx, by] = poly[i];
    const [ex, ey] = [poly[j][0] - bx, poly[j][1] - by];
    const len2 = ex * ex + ey * ey;
    const u = Math.min(1, Math.max(0, ((x - bx) * ex + (y - by) * ey) / len2));
    const [rx, ry] = [x - bx - ex * u, y - by - ey * u];
    const dd = rx * rx + ry * ry;
    if (dd >= best) continue;
    best = dd;
    if (u <= 0 || u >= 1) {
      const n = u <= 0 ? normals[i] : normals[j];
      value = (rx * n[0] + ry * n[1] < 0 ? -1 : 1) * Math.sqrt(dd);
      continue;
    }
    const own = edgeNormal(poly[j], poly[i]);
    const turn = (n: Point2): number => (isMarked(n) ? 0 : Math.atan2(own[0] * n[1] - own[1] * n[0], own[0] * n[0] + own[1] * n[1]));
    const s = 1 - u;
    const sag = -Math.sqrt(len2) * (turn(normals[j]) * s * (1 - s) * (1 - s) + turn(normals[i]) * s * s * (s - 1));
    value = rx * own[0] + ry * own[1] - sag;
  }
  return value;
}

/** The head's width at (x, y): the field, its ceiling blended over `soft`. */
export const widthAt = (h: Pick<CompiledHead, 'width' | 'soft'>, x: number, y: number): number =>
  Math.max(h.width.min, smin(h.width.base + h.width.perX * x + h.width.perY * y, h.width.max, h.soft * WIDTH_BLEND));

/** The bevel at (x, y): the field, and on the ears its smallest, eased in over `soft`. */
export function bevelAt(h: Pick<CompiledHead, 'bevel' | 'ears' | 'soft'>, x: number, y: number): number {
  const b = fieldAt(h.bevel, x, y);
  const k = Math.max(h.soft, TINY);
  const t = Math.min(1, Math.max(0, (y - h.ears.from + k) / (2 * k)));
  return b + (h.bevel.min - b) * t * t * (3 - 2 * t);
}

/** Distance to the carved head (a bound, exact on the flat planes); dents left out on request. */
export function headSdf(h: Omit<CompiledHead, 'box' | 'chunks'>, p: Vec3, dents = true): number {
  const [x, y, z] = p;
  const a = outlineDistance(h.outline, h.normals, x, y);
  const side = Math.abs(z) - widthAt(h, x, y);
  const bevel = (h.slope * a + side + bevelAt(h, x, y)) / Math.hypot(h.slope, 1);
  let d = smax(smax(a, side, h.soft), bevel, h.soft);
  // Above the ears' line: a V gap between them, and each ear thinning toward its tip.
  const rise = Math.max(0, y - h.ears.from) * EAR_TAPER;
  d = Math.max(d, -Math.max(Math.abs(z) - h.ears.half - rise, h.ears.from - y));
  d = smax(d, Math.min(y - h.ears.from, Math.abs(z) - h.ears.half - h.ears.thick + rise), h.soft);
  if (!dents) return d;
  for (const [dx, dy, dz, r] of h.dents) d = Math.max(d, r - Math.hypot(x - dx, y - dy, Math.abs(z) - dz));
  for (const [a, b, r] of h.grooves) d = Math.max(d, r - segmentDistance([x, y, Math.abs(z)], a, b));
  return d;
}

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const e: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const u = Math.min(1, Math.max(0, (w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / (e[0] ** 2 + e[1] ** 2 + e[2] ** 2 || 1)));
  return Math.hypot(w[0] - e[0] * u, w[1] - e[1] * u, w[2] - e[2] * u);
}

/** Where the surface is at (x, y) on the +Z side: 0 when (x, y) is outside the head. */
function surfaceZ(h: Omit<CompiledHead, 'box' | 'chunks'>, x: number, y: number): number {
  let [lo, hi] = [0, h.width.max * 2];
  if (headSdf(h, [x, y, lo], false) >= 0) return 0;
  for (let i = 0; i < DENT_SEARCH; i++) {
    const mid = (lo + hi) / 2;
    if (headSdf(h, [x, y, mid], false) < 0) lo = mid; else hi = mid;
  }
  return lo;
}

function chunksOf(poly: readonly Point2[]): HeadChunk[] {
  const out: HeadChunk[] = [];
  for (let c = 0; c < poly.length; c += HEAD_CHUNK) {
    // Edge i runs from point i - 1 to point i, as the shader walks them.
    const pts = Array.from({ length: Math.min(HEAD_CHUNK, poly.length - c) + 1 }, (_, k) => poly[(c + k - 1 + poly.length) % poly.length]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const center: Point2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    out.push({ center, radius: Math.max(...pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]))) });
  }
  return out;
}

const scaleField = (f: SideField, cy: number, k: number): SideField =>
  ({ base: (f.base + f.perY * cy) * k, perX: f.perX, perY: f.perY, min: f.min * k, max: f.max * k });

/** Into the profile's unit space: y about cy, everything scaled by k. */
export function compileHead(h: CarvedHead, cy: number, k: number): CompiledHead {
  const loop = smoothLoop(h.outline);
  const outline = loop.points.map(([x, y]): Point2 => [x * k, (y - cy) * k]);
  const shape = {
    outline,
    normals: pointNormals(outline, loop.corners),
    width: scaleField(h.width, cy, k),
    bevel: scaleField(h.bevel, cy, k),
    slope: h.slope,
    soft: h.soft * k,
    ears: { from: (h.ears.from - cy) * k, half: h.ears.half * k, thick: h.ears.thick * k },
    dents: [],
    grooves: [],
  };
  const dents = h.dents.map(([x, y, r, depth]) => {
    const [ux, uy] = [x * k, (y - cy) * k];
    return [ux, uy, surfaceZ(shape, ux, uy) + (r - depth) * k, r * k] as const;
  });
  // A groove runs level, at the depth of its deeper-set end, so it follows the flat side and runs out over the bevel.
  const grooves = (h.grooves ?? []).map(([x0, y0, x1, y1, r, depth]) => {
    const [a, b]: Point2[] = [[x0 * k, (y0 - cy) * k], [x1 * k, (y1 - cy) * k]];
    const z = Math.max(surfaceZ(shape, a[0], a[1]), surfaceZ(shape, b[0], b[1])) + (r - depth) * k;
    return [[a[0], a[1], z], [b[0], b[1], z], r * k] as const;
  });
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  return { ...shape, dents, grooves, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], chunks: chunksOf(outline) };
}

/** Bounds of a head in the authoring unit, before compiling: heights and widest reach from the axis. */
export function headExtent(h: CarvedHead): { ys: number[]; radii: number[] } {
  const pts = smoothLoop(h.outline).points;
  return { ys: pts.map((p) => p[1]), radii: pts.map(([x, y]) => Math.hypot(x, fieldAt(h.width, x, y))) };
}
