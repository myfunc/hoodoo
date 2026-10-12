import { type LatheProfileData, radiusAt } from '../../assets/lathe';
import { type CompiledHead, headSdf } from '../../assets/lathe-head';
import type { Vec3 } from '../../core/vec3';
import { contour } from './contour';

/** A Lathe object's lattice in unit space: rings at the outline's corners, meridians along it, its blocks and the head's side view. */

const RING_SEGMENTS = 24;
const MERIDIANS = 8;
/** Rings closer than this (unit space) to the last one drawn are skipped: the lattice stays readable. */
const RING_GAP = 0.04;
const BOX_CORNERS = 8;
/** The head's slices: the middle, through each ear, near each side (a fraction of the widest half-width), and this many levels. */
const HEAD_SIDE = 0.8;
const HEAD_LEVELS = 9;
/** Contour cells per unit of profile space. */
const HEAD_CELLS = 48;

export function latheLines(p: LatheProfileData): Vec3[] {
  const out: Vec3[] = [];
  const k = 1 / p.aspect;
  // Profile space has true proportions; the unit box is X and Z divided by the aspect.
  const at = (x: number, y: number, z: number): Vec3 => [x * k, y, z * k];
  let last = -Infinity;
  for (const y of [...p.rings].sort((a, b) => a - b)) {
    const r = radiusAt(p.segments, y);
    if (r <= 0 || y - last < RING_GAP) continue;
    last = y;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      out.push(at(Math.cos(a0) * r, y, Math.sin(a0) * r), at(Math.cos(a1) * r, y, Math.sin(a1) * r));
    }
  }
  for (let m = 0; m < MERIDIANS; m++) {
    const a = (m / MERIDIANS) * Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    for (const g of p.segments) out.push(at(c * g.r0, g.y0, s * g.r0), at(c * g.r1, g.y1, s * g.r1));
  }
  for (const b of p.blocks) {
    const corner = (i: number): Vec3 => at(b.center[0] + (i & 1 ? b.half[0] : -b.half[0]), b.center[1] + (i & 2 ? b.half[1] : -b.half[1]), b.center[2] + (i & 4 ? b.half[2] : -b.half[2]));
    for (let i = 0; i < BOX_CORNERS; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push(corner(i), corner(i | bit));
  }
  if (p.head) headLines(p.head, at, out);
  return out;
}

/** Slices are traced once a head (marching squares over its distance function). */
const headCache = new WeakMap<CompiledHead, readonly (readonly [Vec3, Vec3])[]>();

/** The carved head as slices of its own surface: upright ones across its width, level ones up its height. */
function headSlices(head: CompiledHead): readonly (readonly [Vec3, Vec3])[] {
  const cached = headCache.get(head);
  if (cached) return cached;
  const [x0, y0, x1, y1] = head.box;
  const w = head.width.max;
  const cells = (a: number, b: number): number => Math.max(1, Math.ceil((b - a) * HEAD_CELLS));
  const out: (readonly [Vec3, Vec3])[] = [];
  const ear = head.ears.half + head.ears.thick / 2;
  for (const z of [0, ear, -ear, HEAD_SIDE * w, -HEAD_SIDE * w]) {
    for (const [a, b] of contour((x, y) => headSdf(head, [x, y, z]), [x0, y0], [x1, y1], [cells(x0, x1), cells(y0, y1)])) {
      out.push([[a[0], a[1], z], [b[0], b[1], z]]);
    }
  }
  for (let l = 1; l < HEAD_LEVELS; l++) {
    const y = y0 + ((y1 - y0) * l) / HEAD_LEVELS;
    for (const [a, b] of contour((x, z) => headSdf(head, [x, y, z]), [x0, -w], [x1, w], [cells(x0, x1), cells(-w, w)])) {
      out.push([[a[0], y, a[1]], [b[0], y, b[1]]]);
    }
  }
  headCache.set(head, out);
  return out;
}

function headLines(head: CompiledHead, at: (x: number, y: number, z: number) => Vec3, out: Vec3[]): void {
  for (const [a, b] of headSlices(head)) out.push(at(a[0], a[1], a[2]), at(b[0], b[1], b[2]));
}
