import { KEY } from '../core/keys';
import type { Mat4 } from '../core/mat4';
import { type Vec3, ONE3, ZERO3, add, cross, dot, normalize, scale, sub, withAxis } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import { type GizmoFrame, GizmoKind } from '../render/wire/gizmo';
import type { GuideLine } from '../render/wire/axis-guide';
import type { ViewBasis } from '../world/camera-math';
import { moved, resized, snap, turned, turnedBy } from '../world/transform-ops';
import { DEG_PER_RAD, type ScreenPoint, snapTurn } from './gizmo-math';
import { TURN_SNAP_DEG } from './gizmo-drag';

/**
 * Pure parts of the keyboard Move, Rotate and Size (key-transform.ts runs them):
 * the axis lock, the typed amount, snapping and the edit itself. The edit goes
 * through the handles' own operations (transform-ops `moved`, `turned`,
 * `resized`), so groups, pivots and keys behave as they do for the handles.
 */

/** The world axes, by index (0 X, 1 Y, 2 Z). */
export const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const AXIS_LETTERS = ['X', 'Y', 'Z'] as const;
/** Ctrl/Cmd: Size snaps to steps of this factor (Move snaps to the grid step, Rotate to TURN_SNAP_DEG). */
export const SIZE_SNAP = 0.1;
/** A typed amount keeps this many characters at most. */
const MAX_TYPED = 9;
const POINT = '.';
const MINUS = '-';
const DIGIT = /^[0-9]$/;
/** Keys that type a point: the point itself, and the comma some keypads send. */
const POINT_KEYS: ReadonlySet<string> = new Set([POINT, ',']);
/** Below this |cos| between an axis and the eye a turn reads the pointer's travel instead of its sweep (as the flat rings do). */
export const EDGE_ON = 0.5;
/** A plane seen this close to edge-on gives no usable point. */
const PLANE_EPS = 1e-4;

/** What a keyboard transform is held to: free, one axis, or (`plane`) the plane without that axis. */
export interface AxisLock {
  readonly axis: number | null;
  readonly plane: boolean;
}

export const FREE_LOCK: AxisLock = { axis: null, plane: false };

/** X, Y or Z pressed (`plane`: with Shift): that lock, or free again when it is the lock already. */
export const toggledLock = (lock: AxisLock, axis: number, plane: boolean): AxisLock =>
  (lock.axis === axis && lock.plane === plane ? FREE_LOCK : { axis, plane });

/** Rotate has no plane: turning in the plane without X is turning about X. */
export const lockFor = (job: GizmoKind, lock: AxisLock): AxisLock => (job === GizmoKind.Rotate && lock.plane ? { axis: lock.axis, plane: false } : lock);

/** The other two axes of a plane lock. */
const planeAxes = (axis: number): number[] => [0, 1, 2].filter((i) => i !== axis);

/** "Z", or the plane's two letters ("XY" for Shift+Z), or "" when free. */
export function lockName(lock: AxisLock): string {
  if (lock.axis === null) return '';
  return lock.plane ? planeAxes(lock.axis).map((i) => AXIS_LETTERS[i]).join('') : AXIS_LETTERS[lock.axis];
}

/**
 * The typed amount after a key: digits and one point add on, minus flips the sign
 * wherever it is typed, Backspace takes the last character back. Null: not a typing key.
 */
export function typedAfter(text: string, key: string): string | null {
  if (key === KEY.Backspace) return text === MINUS ? '' : text.slice(0, -1);
  if (key === MINUS) return text.startsWith(MINUS) ? text.slice(1) : MINUS + text;
  if (text.length >= MAX_TYPED) return DIGIT.test(key) || POINT_KEYS.has(key) ? text : null;
  if (DIGIT.test(key)) return text + key;
  if (POINT_KEYS.has(key)) return text.includes(POINT) ? text : text + POINT;
  return null;
}

/** The number typed so far, or null while there is none ("", "-", "."). */
export function typedValue(text: string): number | null {
  const v = Number(text);
  return /[0-9]/.test(text) && Number.isFinite(v) ? v : null;
}

/** The axis a typed distance moves along: the locked one; with a plane its first axis, with none X. */
export const typedAxis = (lock: AxisLock): number => (lock.axis === null ? 0 : lock.plane ? planeAxes(lock.axis)[0] : lock.axis);

/** A move offset rounded to the grid step: along a locked axis its length, otherwise each part. */
export function snappedMove(delta: Vec3, lock: AxisLock, step: number): Vec3 {
  if (lock.axis !== null && !lock.plane) return withAxis(ZERO3, lock.axis, snap(delta[lock.axis], step));
  return [snap(delta[0], step), snap(delta[1], step), snap(delta[2], step)];
}

/** A turn snapped to whole TURN_SNAP_DEG: one object about one of its axes lands on whole angles, as the rings do. */
export function snappedTurn(start: readonly SceneObject[], lock: AxisLock, degrees: number): number {
  const from = start.length === 1 && lock.axis !== null ? start[0].transform.rotation[lock.axis] : 0;
  return snapTurn(from, degrees, TURN_SNAP_DEG);
}

export const snappedFactor = (k: number): number => Math.max(SIZE_SNAP, snap(k, SIZE_SNAP));

/** A size factor per axis: even when free, one axis when locked, the other two with a plane. */
export function factorFor(lock: AxisLock, k: number): Vec3 {
  if (lock.axis === null) return [k, k, k];
  return lock.plane ? withAxis([k, k, k], lock.axis, 1) : withAxis(ONE3, lock.axis, k);
}

/** A rotation by `degrees` about the unit `axis` (right-handed: anticlockwise seen from its tip). */
export function axisTurn(axis: Vec3, degrees: number): Mat4 {
  const a = degrees / DEG_PER_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 - c;
  const [x, y, z] = axis;
  const m = new Float64Array([
    c + x * x * k, y * x * k + z * s, z * x * k - y * s, 0,
    x * y * k - z * s, c + y * y * k, z * y * k + x * s, 0,
    x * z * k + y * s, y * z * k - x * s, c + z * z * k, 0,
    0, 0, 0, 1,
  ]);
  return m;
}

/** From the pivot toward the eye: what an unlocked Rotate turns about, so a typed 90 turns anticlockwise on screen. */
export function towardViewer(basis: ViewBasis, pivot: Vec3): Vec3 {
  return basis.ortho ? scale(basis.forward, -1) : normalize(sub(basis.origin, pivot));
}

/** One step of a keyboard transform: what it does, how it is held and by how much. */
export interface TransformAmount {
  readonly job: GizmoKind;
  readonly lock: AxisLock;
  /** Move: the world offset. */
  readonly delta: Vec3;
  /** Rotate: degrees (about the locked axis, or `view` when free). */
  readonly degrees: number;
  readonly view: Vec3;
  /** Size: the factor. */
  readonly factor: number;
}

/**
 * The selection as it stood at the start, moved, turned or sized. Several objects
 * move, turn and size about the centre of their box, one about its own position
 * and axes, exactly as the handles do; `gridSnap` is the display bar's Snap to Grid.
 */
export function transformed(start: readonly SceneObject[], frame: GizmoFrame, a: TransformAmount, gridSnap: boolean, step: number): Map<ObjectId, SceneObject> {
  if (a.job === GizmoKind.Move) return new Map(start.map((o) => [o.id, moved(o, a.delta, gridSnap, step)]));
  if (a.job === GizmoKind.Resize) return resized(start, factorFor(a.lock, a.factor));
  const lock = lockFor(a.job, a.lock);
  return lock.axis === null ? turnedBy(start, axisTurn(a.view, a.degrees), frame.pivot) : turned(start, lock.axis, a.degrees);
}

/** The axis lines a transform shows through its pivot: the world axes for Move, the handles' size and turn axes otherwise. */
export function guideLines(frame: GizmoFrame, job: GizmoKind, held: AxisLock): GuideLine[] {
  const lock = lockFor(job, held);
  if (lock.axis === null) return [];
  const dirs = job === GizmoKind.Move ? AXES : job === GizmoKind.Rotate ? frame.turnAxes : frame.sizeAxes;
  const axes = lock.plane ? planeAxes(lock.axis) : [lock.axis];
  return axes.map((axis) => ({ axis, dir: dirs[axis] }));
}

/** The objects moved off where they started: false for a transform that ended where it began. */
export function changed(start: readonly SceneObject[], next: ReadonlyMap<ObjectId, SceneObject>): boolean {
  const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  return start.some((o) => {
    const t = next.get(o.id)?.transform;
    return !!t && (!same(t.position, o.transform.position) || !same(t.rotation, o.transform.rotation) || !same(t.size, o.transform.size));
  });
}

/**
 * Which way the pointer turns the selection about `axis`: +1 when a turn the
 * way screen angles grow (clockwise, y down) is a positive turn about it, -1 the
 * other way. Seen edge-on, travel to the right pushes the near side right.
 */
export function turnSense(axis: Vec3, toward: Vec3, right: Vec3): number {
  const facing = dot(axis, toward);
  if (Math.abs(facing) >= EDGE_ON) return facing > 0 ? -1 : 1;
  const near = sub(toward, scale(axis, facing));
  return dot(cross(axis, near), right) >= 0 ? 1 : -1;
}

/** The pointer's offset from where it started, in screen pixels. */
export const travel = (from: ScreenPoint, to: ScreenPoint): ScreenPoint => [to[0] - from[0], to[1] - from[1]];

/** A screen offset turned into a world offset in the plane facing the eye: `pxPerUnit` at the pivot's depth. */
export function viewPlaneDelta(basis: ViewBasis, d: ScreenPoint, pxPerUnit: number): Vec3 {
  return pxPerUnit > 0 ? add(scale(basis.right, d[0] / pxPerUnit), scale(basis.up, -d[1] / pxPerUnit)) : ZERO3;
}

/** Where a ray meets the plane through `point` square to `normal`; null when it runs along it or away. */
export function planeHit(ray: { readonly origin: Vec3; readonly dir: Vec3 }, point: Vec3, normal: Vec3): Vec3 | null {
  const along = dot(ray.dir, normal);
  if (Math.abs(along) < PLANE_EPS) return null;
  const t = dot(sub(point, ray.origin), normal) / along;
  return t > 0 ? add(ray.origin, scale(ray.dir, t)) : null;
}
