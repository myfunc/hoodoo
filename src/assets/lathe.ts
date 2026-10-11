import type { Vec3 } from '../core/vec3';

/**
 * Turned solids: an outline spun about the Y axis, with optional extras that a
 * lathe alone cannot make — cuts (a rook's crenellations, a bishop's slit),
 * blocks joined on (a king's cross) and a carved head (a knight). Specs are
 * written in any real unit (the chess set is in millimetres) and compiled into
 * the object's unit space, which the ray tracer, picking and wireframe share.
 */

/** A point of an outline: radius and height; a third entry marks a sharp corner. */
export type OutlinePoint = readonly [r: number, y: number] | readonly [r: number, y: number, corner: true];
export type Point2 = readonly [number, number];
/** A half-space dot([x, y, z], n) < d, as [nx, ny, nz, d]. */
export type Plane = readonly [number, number, number, number];

export interface LatheCut {
  /** The cut is where every plane holds (a convex region); at most CUT_PLANES. */
  readonly planes: readonly Plane[];
  /** Copies turned evenly about Y: crenellations, crown points; 1 for one cut. */
  readonly copies: number;
}

/** A box joined to the solid: centre and half-extents. */
export interface LatheBlock {
  readonly center: Vec3;
  readonly half: Vec3;
}

/** A head carved from a side view, facing +X (the knight). */
export interface CarvedHead {
  readonly outline: readonly Point2[];
  /** Half-thickness across Z: base + perX·x + perY·y, kept within [min, max]. */
  readonly thickness: { readonly base: number; readonly perX: number; readonly perY: number; readonly min: number; readonly max: number };
  /** Edge rounding in half-thicknesses: 0 flat sides and sharp edges, 1 round edges, above 1 domed sides. */
  readonly round: number;
  /** A groove between the ears: above `from`, `half` either side of the middle. */
  readonly earGap: { readonly from: number; readonly half: number };
  /** Hollows on both sides, [x, y, radius]: eyes, nostrils. */
  readonly dents: readonly (readonly [number, number, number])[];
}

export interface LatheSpec {
  readonly name: string;
  /** From the axis at the bottom to the axis at the top; heights never go down. */
  readonly outline: readonly OutlinePoint[];
  readonly cut?: LatheCut;
  readonly blocks?: readonly LatheBlock[];
  readonly head?: CarvedHead;
}

/** One cone frustum of the outline, with the shading normals at its ends (unit space). */
export interface LatheSegment {
  readonly r0: number;
  readonly y0: number;
  readonly r1: number;
  readonly y1: number;
  readonly n0: Point2;
  readonly n1: Point2;
}

export interface CompiledHead {
  readonly outline: readonly Point2[];
  /** Half-thickness: base + perX·x + perY·y within [min, max], in unit space. */
  readonly thickness: CarvedHead['thickness'];
  readonly round: number;
  readonly earGap: CarvedHead['earGap'];
  /** Centres on the +Z side (mirrored to -Z) and radius. */
  readonly dents: readonly (readonly [number, number, number, number])[];
  /** Bounds of the outline: [xMin, yMin, xMax, yMax]. */
  readonly box: readonly [number, number, number, number];
}

/**
 * A profile in the object's unit space, scaled uniformly so its height spans -1..1
 * (the "profile space"). The object's unit box squeezes X and Z by `aspect`.
 */
export interface LatheProfileData {
  readonly name: string;
  /** Widest radius over half the height: profile x = unit x · aspect. */
  readonly aspect: number;
  /** Half-extents in the authoring unit: the object's size at scale 1. */
  readonly halfSize: Vec3;
  readonly segments: readonly LatheSegment[];
  readonly cut: LatheCut | null;
  readonly blocks: readonly LatheBlock[];
  readonly head: CompiledHead | null;
  /** Heights of the outline's corners, for the wireframe's rings. */
  readonly rings: readonly number[];
  /** Lowest height the cuts reach into the solid, and the blocks' lowest; Infinity without them. */
  readonly cutFloor: number;
  readonly blockFloor: number;
}

export const CUT_PLANES = 4;
/** Longest piece of a curve before it is split, in authoring units. */
const MAX_STEP = 3.4;
const MAX_SUBDIV = 4;
/** Adjacent pieces turning more than this keep separate normals (a crease). */
const CREASE_COS = Math.cos((38 * Math.PI) / 180);
const DEG = Math.PI / 180;
const CENTRIPETAL = 0.25;
const TINY = 1e-9;

/** Points along a circle, from one angle to another in degrees (0 = outward, 90 = up). */
export function arc(cx: number, cy: number, radius: number, fromDeg: number, toDeg: number, steps: number): OutlinePoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (fromDeg + ((toDeg - fromDeg) * i) / steps) * DEG;
    return [Math.max(0, cx + Math.cos(a) * radius), cy + Math.sin(a) * radius] as const;
  });
}

/** The outline scaled by k about the origin (one base shape for every piece). */
export const scaled = (pts: readonly OutlinePoint[], k: number, dy = 0): OutlinePoint[] =>
  pts.map((p) => (p.length === 3 ? [p[0] * k, p[1] * k + dy, true] as const : [p[0] * k, p[1] * k + dy] as const));

const isCorner = (p: OutlinePoint): boolean => p.length === 3;
const xy = (p: OutlinePoint): Point2 => [p[0], p[1]];

/** Centripetal Catmull-Rom between b and c (Barry–Goldman), at u in 0..1. */
function catmull(a: Point2, b: Point2, c: Point2, d: Point2, u: number): Point2 {
  const knot = (p: Point2, q: Point2) => Math.max(Math.hypot(q[0] - p[0], q[1] - p[1]) ** (CENTRIPETAL * 2), TINY);
  const t1 = knot(a, b);
  const t2 = t1 + knot(b, c);
  const t3 = t2 + knot(c, d);
  const t = t1 + (t2 - t1) * u;
  const lerp = (p: Point2, q: Point2, t0: number, tq: number): Point2 => {
    const w = (t - t0) / (tq - t0);
    return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w];
  };
  const a1 = lerp(a, b, 0, t1);
  const a2 = lerp(b, c, t1, t2);
  const a3 = lerp(c, d, t2, t3);
  return lerp(lerp(a1, a2, 0, t2), lerp(a2, a3, t1, t3), t1, t2);
}

/** The outline as a dense polyline: smooth through plain points, sharp at corners; heights kept from going down. */
export function tessellate(outline: readonly OutlinePoint[]): { points: Point2[]; corners: Set<number> } {
  const points: Point2[] = [[outline[0][0], outline[0][1]]];
  const corners = new Set<number>([0]);
  for (let i = 0; i < outline.length - 1; i++) {
    const b = outline[i];
    const c = outline[i + 1];
    // A corner ends the curve: its neighbour across it does not bend this piece.
    const a = i > 0 && !isCorner(b) ? outline[i - 1] : b;
    const d = i + 2 < outline.length && !isCorner(c) ? outline[i + 2] : c;
    const len = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const steps = Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(len / MAX_STEP)));
    for (let s = 1; s <= steps; s++) {
      const p = s === steps ? ([c[0], c[1]] as Point2) : catmull(xy(a), xy(b), xy(c), xy(d), s / steps);
      const prev = points[points.length - 1];
      points.push([Math.max(0, p[0]), Math.max(prev[1], p[1])]);
    }
    if (isCorner(c)) corners.add(points.length - 1);
  }
  corners.add(points.length - 1);
  return { points, corners };
}

const outward = (a: Point2, b: Point2): Point2 => {
  const dr = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dr, dy) || 1;
  return [dy / l, -dr / l];
};

/** Segments with smooth normals: averaged at a joint unless it is a corner or a crease. */
function segmentsOf(points: readonly Point2[], corners: ReadonlySet<number>): LatheSegment[] {
  const flat: Point2[] = [];
  for (let i = 0; i < points.length - 1; i++) flat.push(outward(points[i], points[i + 1]));
  const joint = (i: number, own: Point2, other: Point2 | undefined): Point2 => {
    if (!other || corners.has(i) || own[0] * other[0] + own[1] * other[1] < CREASE_COS) return own;
    const sum: Point2 = [own[0] + other[0], own[1] + other[1]];
    const l = Math.hypot(sum[0], sum[1]) || 1;
    return [sum[0] / l, sum[1] / l];
  };
  const out: LatheSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    out.push({ r0: a[0], y0: a[1], r1: b[0], y1: b[1], n0: joint(i, flat[i], flat[i - 1]), n1: joint(i + 1, flat[i], flat[i + 1]) });
  }
  return out;
}

const headThickness = (h: CarvedHead, x: number, y: number): number =>
  Math.min(h.thickness.max, Math.max(h.thickness.min, h.thickness.base + h.thickness.perX * x + h.thickness.perY * y));

/** Compiles a spec into profile space: height -1..1 about the middle, uniform scale. */
export function compileProfile(spec: LatheSpec): LatheProfileData {
  const { points, corners } = tessellate(spec.outline);
  const ys = [...points.map((p) => p[1])];
  const radii = [...points.map((p) => p[0])];
  for (const b of spec.blocks ?? []) {
    ys.push(b.center[1] - b.half[1], b.center[1] + b.half[1]);
    radii.push(Math.hypot(Math.abs(b.center[0]) + b.half[0], Math.abs(b.center[2]) + b.half[2]));
  }
  const head = spec.head;
  if (head) {
    for (const [x, y] of head.outline) {
      ys.push(y);
      radii.push(Math.hypot(x, headThickness(head, x, y)));
    }
  }
  const yMin = Math.min(...ys);
  const half = (Math.max(...ys) - yMin) / 2;
  const cy = yMin + half;
  const rMax = Math.max(...radii);
  const k = 1 / half;
  const at = (r: number, y: number): Point2 => [r * k, (y - cy) * k];
  const unitPoints = points.map((p) => at(p[0], p[1]));
  const profile: LatheProfileData = {
    name: spec.name,
    aspect: rMax * k,
    halfSize: [rMax, half, rMax],
    segments: segmentsOf(unitPoints, corners),
    cut: spec.cut ? { copies: spec.cut.copies, planes: spec.cut.planes.map(([x, y, z, d]) => [x, y, z, (d - y * cy) * k] as const) } : null,
    blocks: (spec.blocks ?? []).map((b) => ({ center: [b.center[0] * k, (b.center[1] - cy) * k, b.center[2] * k], half: [b.half[0] * k, b.half[1] * k, b.half[2] * k] })),
    head: head ? compileHead(head, cy, k) : null,
    rings: [...corners].map((i) => unitPoints[i][1]),
    cutFloor: Infinity,
    blockFloor: Infinity,
  };
  return {
    ...profile,
    cutFloor: profile.cut ? cutFloorOf(profile.segments, profile.cut) : Infinity,
    blockFloor: Math.min(...profile.blocks.map((b) => b.center[1] - b.half[1])),
  };
}

const FLOOR_ANGLES = 120;
const FLOOR_RADII = 12;
const FLOOR_HEIGHTS = 400;

/** The lowest height where a cut takes something away, found by sampling the solid. */
function cutFloorOf(segments: readonly LatheSegment[], cut: LatheCut): number {
  const y0 = segments[0].y0;
  const y1 = segments[segments.length - 1].y1;
  for (let k = 0; k <= FLOOR_HEIGHTS; k++) {
    const y = y0 + ((y1 - y0) * k) / FLOOR_HEIGHTS;
    const r = radiusAt(segments, y);
    for (let i = 1; r > 0 && i <= FLOOR_RADII; i++) {
      for (let a = 0; a < FLOOR_ANGLES; a++) {
        const ang = (a / FLOOR_ANGLES) * Math.PI * 2;
        if (inCut(cut, [Math.cos(ang) * r * (i / FLOOR_RADII), y, Math.sin(ang) * r * (i / FLOOR_RADII)])) return y - (y1 - y0) / FLOOR_HEIGHTS;
      }
    }
  }
  return Infinity;
}

/** Is a point (profile space) inside one of the cut's copies? Same rule as the shader. */
export function inCut(cut: LatheCut, p: Vec3): boolean {
  const step = (Math.PI * 2) / cut.copies;
  const ang = step * Math.round(Math.atan2(p[2], p[0]) / step);
  const [c, s] = [Math.cos(ang), Math.sin(ang)];
  const q: Vec3 = [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
  return cut.planes.every(([x, y, z, d]) => x * q[0] + y * q[1] + z * q[2] < d);
}

/** A closed outline made smooth: centripetal Catmull-Rom through every point, `steps` pieces per side. */
function smoothLoop(pts: readonly Point2[], steps: number): Point2[] {
  const n = pts.length;
  const out: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
    for (let s = 0; s < steps; s++) out.push(s === 0 ? b : catmull(a, b, c, d, s / steps));
  }
  return out;
}

/** How far inside the outline a point lies (distance to the nearest side). */
function depthIn(poly: readonly Point2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [ex, ey] = [poly[i][0] - ax, poly[i][1] - ay];
    const u = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - ax - ex * u, y - ay - ey * u));
  }
  return best;
}

/** Where the carved side is at (x, y): the shader's rounding, so a hollow sits on the surface. */
function sideAt(h: CarvedHead, poly: readonly Point2[], x: number, y: number): number {
  const w = headThickness(h, x, y);
  const rr = w * h.round;
  const qx = rr - depthIn(poly, x, y);
  return qx <= 0 ? w : w + (Math.sqrt(Math.max(0, rr * rr - qx * qx)) - rr) / Math.max(h.round, 1);
}

/** Spline pieces per side of the side view; 1 keeps the authored points (2 costs a knight about twice as much). */
const HEAD_SUBDIV = 1;

function compileHead(h: CarvedHead, cy: number, k: number): CompiledHead {
  const smooth = smoothLoop(h.outline, HEAD_SUBDIV);
  const outline = smooth.map(([x, y]): Point2 => [x * k, (y - cy) * k]);
  const t = h.thickness;
  return {
    outline,
    thickness: { base: (t.base + t.perY * cy) * k, perX: t.perX, perY: t.perY, min: t.min * k, max: t.max * k },
    round: h.round,
    earGap: { from: (h.earGap.from - cy) * k, half: h.earGap.half * k },
    dents: h.dents.map(([x, y, r]) => [x * k, (y - cy) * k, sideAt(h, smooth, x, y) * k, r * k] as const),
    box: [Math.min(...outline.map((p) => p[0])), Math.min(...outline.map((p) => p[1])), Math.max(...outline.map((p) => p[0])), Math.max(...outline.map((p) => p[1]))],
  };
}

/** The outline's radius at height y (profile space), or -1 outside its heights. */
export function radiusAt(segments: readonly LatheSegment[], y: number): number {
  for (const s of segments) {
    if (s.y1 > s.y0 && y >= s.y0 && y <= s.y1) return s.r0 + ((s.r1 - s.r0) * (y - s.y0)) / (s.y1 - s.y0);
  }
  return -1;
}

/** Notches about the top, `copies` of them: from `floor` up, `half` wide either side, outside `inner`; `flare` widens them upward (V shapes). */
export function notches(copies: number, floor: number, half: number, inner: number, flare = 0): LatheCut {
  const l = Math.hypot(1, flare);
  return {
    copies,
    planes: [
      [0, -1, 0, -floor],
      [0, -flare / l, 1 / l, (half - floor * flare) / l],
      [0, -flare / l, -1 / l, (half - floor * flare) / l],
      [-1, 0, 0, -inner],
    ],
  };
}

/** A straight slit through a point, across the normal n (in the XY plane), on the +X side of `side`, above `floor`. */
export function slit(center: Point2, n: Point2, half: number, side: number, floor: number): LatheCut {
  const l = Math.hypot(n[0], n[1]);
  const [nx, ny] = [n[0] / l, n[1] / l];
  const d = nx * center[0] + ny * center[1];
  return { copies: 1, planes: [[nx, ny, 0, d + half], [-nx, -ny, 0, half - d], [-1, 0, 0, -side], [0, -1, 0, -floor]] };
}
