import { type Vec3, add, scale } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import { nearestWire } from '../render/wire/picking';
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

/** The move-handle axis whose tip is under a point, or -1. */
export function gizmoAxisAt(g: GizmoHandles | null, x: number, y: number, radius: number): number {
  if (!g) return -1;
  return g.tips.findIndex((t) => t !== null && Math.hypot(t[0] - x, t[1] - y) <= radius);
}
