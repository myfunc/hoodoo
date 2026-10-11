import type { ObjectId } from '../../model/scene.ids';
import type { KeyRef } from '../../world/animation/key-selection';
import type { KeyHandle } from './motion-paths';
import type { SegmentIndex } from './wireframe';

/** The point of segment `i` nearest to (px, py). */
function nearestOnSegment(px: number, py: number, s: Float32Array, i: number): [number, number] {
  const ax = s[i], ay = s[i + 1], bx = s[i + 2], by = s[i + 3];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return [ax + dx * t, ay + dy * t];
}

/** A wire near the cursor: its object and the nearest point of the wire on screen. */
export interface WireHit {
  readonly id: ObjectId;
  readonly x: number;
  readonly y: number;
}

/** Bryce picking: the wire passing nearest the cursor, within `radius` pixels. */
export function nearestWire(index: SegmentIndex, x: number, y: number, radius: number): WireHit | null {
  let best: WireHit | null = null;
  let bestD = radius;
  for (const [id, segs] of index) {
    for (let i = 0; i < segs.length; i += 4) {
      const [nx, ny] = nearestOnSegment(x, y, segs, i);
      const d = Math.hypot(x - nx, y - ny);
      if (d < bestD) {
        bestD = d;
        best = { id, x: nx, y: ny };
      }
    }
  }
  return best;
}

export const pickWire = (index: SegmentIndex, x: number, y: number, radius: number): ObjectId | null => nearestWire(index, x, y, radius)?.id ?? null;

/** The key square nearest the cursor within `radius`; later squares (drawn on top) win ties. */
export function pickKeyHandle(keys: readonly KeyHandle[], x: number, y: number, radius: number): KeyHandle | null {
  let best: KeyHandle | null = null;
  let bestD = radius;
  for (const k of keys) {
    const d = Math.hypot(k.x - x, k.y - y);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

export const keyRefOf = (h: KeyHandle): KeyRef => ({ track: h.track, id: h.id, time: h.time });

/** Key squares inside a screen rectangle (box select). */
export function keysInRect(keys: readonly KeyHandle[], x0: number, y0: number, x1: number, y1: number): KeyRef[] {
  const [lx, hx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ly, hy] = [Math.min(y0, y1), Math.max(y0, y1)];
  return keys.filter((k) => k.x >= lx && k.x <= hx && k.y >= ly && k.y <= hy).map(keyRefOf);
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
