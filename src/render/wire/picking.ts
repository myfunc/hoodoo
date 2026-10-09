import type { ObjectId } from '../../model/scene.ids';
import type { SegmentIndex } from './wireframe';

function segmentDistance(px: number, py: number, s: Float32Array, i: number): number {
  const ax = s[i], ay = s[i + 1], bx = s[i + 2], by = s[i + 3];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Bryce picking: the object whose wire passes nearest the cursor, within `radius` pixels. */
export function pickWire(index: SegmentIndex, x: number, y: number, radius: number, skip?: (id: ObjectId) => boolean): ObjectId | null {
  let best: ObjectId | null = null;
  let bestD = radius;
  for (const [id, segs] of index) {
    if (skip?.(id)) continue;
    for (let i = 0; i < segs.length; i += 4) {
      const d = segmentDistance(x, y, segs, i);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
  }
  return best;
}

/** Objects with any wire segment inside a screen rectangle (box select). */
export function pickRect(index: SegmentIndex, x0: number, y0: number, x1: number, y1: number): ObjectId[] {
  const [lx, hx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ly, hy] = [Math.min(y0, y1), Math.max(y0, y1)];
  const out: ObjectId[] = [];
  for (const [id, segs] of index) {
    for (let i = 0; i < segs.length; i += 2) {
      if (segs[i] >= lx && segs[i] <= hx && segs[i + 1] >= ly && segs[i + 1] <= hy) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}
