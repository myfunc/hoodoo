import { type LatheProfileData, radiusAt } from '../../assets/lathe';
import type { Vec3 } from '../../core/vec3';

/** A Lathe object's lattice in unit space: rings at the outline's corners, meridians along it, its blocks and the head's side view. */

const RING_SEGMENTS = 24;
const MERIDIANS = 8;
/** Rings closer than this (unit space) to the last one drawn are skipped: the lattice stays readable. */
const RING_GAP = 0.04;
const BOX_CORNERS = 8;
/** Every this many points of the head's side view, a line across it. */
const HEAD_RUNG = 4;

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
  const head = p.head;
  if (head) {
    const t = head.thickness;
    const half = (x: number, y: number) => Math.min(t.max, Math.max(t.min, t.base + t.perX * x + t.perY * y));
    head.outline.forEach(([x, y], i) => {
      const [nx, ny] = head.outline[(i + 1) % head.outline.length];
      for (const side of [-1, 1]) out.push(at(x, y, side * half(x, y)), at(nx, ny, side * half(nx, ny)));
      if (i % HEAD_RUNG === 0) out.push(at(x, y, -half(x, y)), at(x, y, half(x, y)));
    });
  }
  return out;
}
