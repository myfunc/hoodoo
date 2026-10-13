import { type Vec3, add, scale } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import { nearestWire } from '../render/wire/picking';
import { GizmoKind, type GizmoPart, nearestRingPoint } from '../render/wire/gizmo';
import { GIZMO } from '../render/wire/wire.constants';
import type { Frame, GizmoHandles, SegmentIndex } from '../render/wire/wireframe';
import { type ViewBasis, rayAt } from '../world/camera-math';
import { type RayHit, raycast } from '../world/raycast';
import { PARALLEL_EPS } from './input.constants';

/** What picking needs of a view cell: its projection and the wires drawn in it. */
export interface PickView {
  readonly basis: ViewBasis;
  readonly frame: Frame;
  readonly segments: SegmentIndex;
}

/**
 * Where on the way from the cursor to a nearby wire the ray probes look for that
 * wire's object (0 is the cursor, 1 the wire, past 1 just beyond it).
 */
const WIRE_PROBES = [0.25, 0.5, 0.75, 1, 1.25] as const;

export function ndcAt(frame: Frame, x: number, y: number): [number, number] {
  return [((x - frame.x) / frame.w) * 2 - 1, 1 - ((y - frame.y) / frame.h) * 2];
}

/** The ray through a scene-window point. */
export function viewRay(v: Pick<PickView, 'basis' | 'frame'>, x: number, y: number): { origin: Vec3; dir: Vec3 } {
  const [nx, ny] = ndcAt(v.frame, x, y);
  return rayAt(v.basis, nx, ny);
}

/** The nearest solid surface under a point (infinite planes are picked by their wires). */
function surfaceAt(scene: Scene, v: PickView, x: number, y: number): RayHit | null {
  const ray = viewRay(v, x, y);
  return raycast(scene, ray.origin, ray.dir, { includePlanes: false, includeLights: true });
}

/**
 * The object under a click. A solid surface under the cursor wins over a wire
 * merely passing nearby, so the planet inside a thin ring picks the planet. A
 * nearby wire still wins when its own object shows in front between the cursor
 * and that wire (clicking just beside a thin tube). With nothing solid under the
 * cursor the nearest wire picks, as Bryce selects by wireframe.
 */
export function pickObject(scene: Scene, v: PickView, x: number, y: number, radius: number): ObjectId | null {
  const hit = surfaceAt(scene, v, x, y);
  const wire = nearestWire(v.segments, x, y, radius);
  if (!hit) return wire?.id ?? null;
  if (!wire || wire.id === hit.id) return hit.id;
  const shows = WIRE_PROBES.some((k) => surfaceAt(scene, v, x + (wire.x - x) * k, y + (wire.y - y) * k)?.id === wire.id);
  return shows ? wire.id : hit.id;
}

/** Where the ray through a point meets the level plane y = height, or null when it never does. */
export function groundPoint(v: Pick<PickView, 'basis' | 'frame'>, x: number, y: number, height: number): Vec3 | null {
  const ray = viewRay(v, x, y);
  if (Math.abs(ray.dir[1]) < PARALLEL_EPS) return null;
  const t = (height - ray.origin[1]) / ray.dir[1];
  if (t <= 0) return null;
  return add(ray.origin, scale(ray.dir, t));
}

/** Pick Focus: the nearest surface point under a point, planes included; null for the sky. */
export function surfacePoint(scene: Scene, v: Pick<PickView, 'basis' | 'frame'>, x: number, y: number): Vec3 | null {
  const ray = viewRay(v, x, y);
  const hit = raycast(scene, ray.origin, ray.dir, { includePlanes: true, includeLights: false });
  return hit && Number.isFinite(hit.t) ? hit.point : null;
}

/**
 * The handle under a point, or null. The nearest handle within its reach wins
 * (never less than `radius`), over the long rings; rings count only while they
 * show (`near`) and the look lets them be grabbed, within the larger of
 * `ringRadius` and the look's own reach.
 */
export function gizmoPartAt(g: GizmoHandles | null, x: number, y: number, radius: number, ringRadius: number, near: boolean): GizmoPart | null {
  if (!g) return null;
  let found: GizmoPart | null = null;
  let foundD = Infinity;
  for (const grip of g.grips) {
    if (grip.reach <= 0) continue;
    const d = Math.hypot(grip.at[0] - x, grip.at[1] - y);
    if (d <= Math.max(grip.reach, radius) && d < foundD) {
      found = grip.part;
      foundD = d;
    }
  }
  if (found) return found;
  // The line out to a handle takes it too: a press a little short of the tip still moves.
  for (const grip of g.grips) {
    if (grip.reach <= 0 || grip.detached || grip.part.axis < 0) continue;
    const len = Math.hypot(grip.at[0] - g.origin[0], grip.at[1] - g.origin[1]);
    if (len <= GIZMO.shaftStartPx) continue;
    const k = GIZMO.shaftStartPx / len;
    const from: [number, number] = [g.origin[0] + (grip.at[0] - g.origin[0]) * k, g.origin[1] + (grip.at[1] - g.origin[1]) * k];
    const d = segmentDistance(from, grip.at, x, y);
    if (d <= GIZMO.shaftReachPx && d < foundD) {
      found = grip.part;
      foundD = d;
    }
  }
  if (found || !near || g.ringReach <= 0) return found;
  let best: GizmoPart | null = null;
  let bestD = Math.max(g.ringReach, ringRadius);
  g.rings.forEach((r, axis) => {
    const d = r ? nearestRingPoint(r, x, y).distance : Infinity;
    if (d <= bestD) {
      bestD = d;
      best = { kind: GizmoKind.Rotate, axis };
    }
  });
  return best;
}

/** Distance from a point to the segment a-b, pixels. */
function segmentDistance(a: readonly [number, number], b: readonly [number, number], x: number, y: number): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

/** The pointer is close enough to the handles (or, in a look with a band, to a ring) for the rotate rings to show. */
export function nearGizmo(g: GizmoHandles | null, x: number, y: number): boolean {
  if (!g) return false;
  if (g.nearBand > 0) return g.rings.some((r) => r !== null && nearestRingPoint(r, x, y).distance <= g.nearBand);
  return Math.hypot(g.origin[0] - x, g.origin[1] - y) <= g.ringRadius + GIZMO.ringNearPx;
}
