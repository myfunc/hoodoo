import { type Vec3, ZERO3, add, dot, scale, sub } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import { EVEN_AXIS, type GizmoFrame } from '../render/wire/gizmo';
import { moved, resized } from '../world/transform-ops';

/** Pure drag math of the selection's handles (gizmo.ts draws them, gizmo-drag.ts applies them). */
export type ScreenPoint = readonly [number, number];

/** The smallest share a resize drag shrinks to: past the centre the selection would turn inside out. */
export const MIN_FACTOR = 0.02;
export const DEG_PER_RAD = 180 / Math.PI;
const TURN = Math.PI * 2;

/**
 * A resize handle's factor: how far out along the handle's screen direction the
 * pointer is now, over how far it was at the press. Dragging a cube twice as
 * far from the centre doubles the size; past the centre it stops at MIN_FACTOR.
 */
export function stretchFactor(origin: ScreenPoint, handle: ScreenPoint, press: ScreenPoint, now: ScreenPoint): number {
  const dx = handle[0] - origin[0];
  const dy = handle[1] - origin[1];
  const along = (p: ScreenPoint) => (p[0] - origin[0]) * dx + (p[1] - origin[1]) * dy;
  const from = along(press);
  if (from <= 0) return 1;
  return Math.max(MIN_FACTOR, along(now) / from);
}

/** A move tip's travel: how far the pointer went along the tip's screen direction, in axis lengths. */
export function slideAlong(origin: ScreenPoint, tip: ScreenPoint, press: ScreenPoint, now: ScreenPoint): number {
  const dx = tip[0] - origin[0];
  const dy = tip[1] - origin[1];
  const len2 = dx * dx + dy * dy;
  return len2 > 0 ? ((now[0] - press[0]) * dx + (now[1] - press[1]) * dy) / len2 : 0;
}

/** The angle (radians) the pointer swept about `origin` from `prev` to `now`, the short way, in screen terms (y down). */
export function sweep(origin: ScreenPoint, prev: ScreenPoint, now: ScreenPoint): number {
  const a = Math.atan2(prev[1] - origin[1], prev[0] - origin[0]);
  const b = Math.atan2(now[1] - origin[1], now[0] - origin[0]);
  const d = b - a;
  return d > Math.PI ? d - TURN : d <= -Math.PI ? d + TURN : d;
}

/** +1 when a ring's points run the way screen angles grow (clockwise on screen), -1 the other way. */
export function winding(ring: Float32Array, origin: ScreenPoint): number {
  let area = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += (ring[i * 2] - origin[0]) * (ring[j * 2 + 1] - origin[1]) - (ring[j * 2] - origin[0]) * (ring[i * 2 + 1] - origin[1]);
  }
  return area >= 0 ? 1 : -1;
}

/**
 * A turn read along the ring's screen tangent at the grabbed point, for rings
 * seen nearly edge-on: one ring radius of travel along the ring is one radian.
 */
export function tangentTurn(ring: Float32Array, index: number, radiusPx: number, press: ScreenPoint, now: ScreenPoint): number {
  const n = ring.length / 2;
  const a = ((index - 1) % n + n) % n;
  const b = (index + 1) % n;
  const tx = ring[b * 2] - ring[a * 2];
  const ty = ring[b * 2 + 1] - ring[a * 2 + 1];
  const len = Math.hypot(tx, ty);
  if (len === 0 || radiusPx <= 0) return 0;
  return ((now[0] - press[0]) * tx + (now[1] - press[1]) * ty) / len / radiusPx;
}

/** A turn by `raw` degrees snapped so that `start + turn` lands on a whole `step`. */
export const snapTurn = (start: number, raw: number, step: number): number => Math.round((start + raw) / step) * step - start;

/** What Alt keeps still: the face opposite a size handle, or the base under the even square. */
export function anchorOf(frame: GizmoFrame, axis: number): Vec3 {
  if (axis === EVEN_AXIS) return frame.base;
  return sub(frame.pivot, scale(frame.sizeAxes[axis], frame.extents[axis]));
}

/** The slide that brings `anchor` back where it was after resizing by `factor` about the pivot along the size axes. */
export function anchorShift(frame: GizmoFrame, anchor: Vec3, factor: Vec3): Vec3 {
  const d = sub(anchor, frame.pivot);
  const after = frame.sizeAxes.reduce((acc, axis, i) => add(acc, scale(axis, factor[i] * dot(axis, d))), ZERO3);
  return sub(d, after);
}

/** Resize as the Edit palette does (transform-ops `resized`); with an anchor the selection slides so that point stays put. */
export function resizedFrom(objs: readonly SceneObject[], frame: GizmoFrame, factor: Vec3, anchor: Vec3 | null): Map<ObjectId, SceneObject> {
  const next = resized(objs, factor);
  if (!anchor) return next;
  const shift = anchorShift(frame, anchor, factor);
  return new Map([...next].map(([id, o]) => [id, moved(o, shift, false)]));
}
