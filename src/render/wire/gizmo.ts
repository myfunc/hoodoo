import { rotationEuler, transformDir } from '../../core/mat4';
import { type Vec3, add, cross, dot, normalize, scale, sub } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import { boxSphere, unionBox, worldBox } from '../../world/bounds';
import type { ViewBasis } from '../../world/camera-math';
import { GIZMO, WIRE } from './wire.constants';

/** What a handle does. */
export enum GizmoKind {
  Move = 'move',
  Resize = 'resize',
  Rotate = 'rotate',
}

/** One handle: its kind and axis (0 X, 1 Y, 2 Z; EVEN_AXIS for the even-resize square). */
export interface GizmoPart {
  readonly kind: GizmoKind;
  readonly axis: number;
}

export const EVEN_AXIS = -1;

export const samePart = (a: GizmoPart | null, b: GizmoPart | null): boolean => a === b || (!!a && !!b && a.kind === b.kind && a.axis === b.axis);

/**
 * The axes the handles work along, as the Edit palette's tools read them
 * (transform-ops `resized`, `turned`): one object resizes along its own axes
 * about its position and turns about its Euler axes (Z, then Y turned by Z,
 * then X turned by both); several resize and turn about world axes through
 * the centre of their box.
 */
export interface GizmoFrame {
  readonly centre: Vec3;
  /** The point resizing keeps still. */
  readonly pivot: Vec3;
  readonly sizeAxes: readonly Vec3[];
  /** Half the extent along each size axis. */
  readonly extents: Vec3;
  readonly turnAxes: readonly Vec3[];
  /** Below the pivot on the floor of the box: what an even resize with Alt keeps still. */
  readonly base: Vec3;
}

export interface GizmoHandles {
  readonly origin: readonly [number, number];
  /** Screen end points of the X, Y, Z move axes; null when an axis points at the viewer. */
  readonly tips: readonly ([number, number] | null)[];
  readonly worldOrigin: Vec3;
  readonly worldAxes: readonly Vec3[];
  /** World length of each drawn axis. */
  readonly axisLength: number;
  /** Screen points of the resize cubes along the size axes; null when an axis points at the viewer. */
  readonly cubes: readonly ([number, number] | null)[];
  /** The even-resize square, in the widest gap between the axes. */
  readonly even: readonly [number, number];
  /** Rotate rings as closed screen polylines (x, y pairs); point k is k steps the positive way round. Null behind the eye. */
  readonly rings: readonly (Float32Array | null)[];
  /** How squarely each ring faces the eye: 1 a full circle, near 0 a line. */
  readonly facing: readonly number[];
  /** Ring radius on screen (pixels). */
  readonly ringRadius: number;
  readonly frame: GizmoFrame;
}

/** What drawing needs of the wireframe projector (wireframe.ts). */
export interface GizmoProjector {
  readonly basis: ViewBasis;
  view(p: Vec3): Vec3;
  screen(v: Vec3): [number, number];
  pixelsPerUnitAt(p: Vec3): number;
}

export interface GizmoLook {
  readonly hover: GizmoPart | null;
  /** The pointer is near: the rings show in full. */
  readonly near: boolean;
}

const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const TURN = Math.PI * 2;
/** A ring's first spoke leans off world Y unless the axis is nearly Y, then off X. */
const NEARLY_UP = 0.9;

export function gizmoFrame(objs: readonly SceneObject[]): GizmoFrame | null {
  const box = unionBox(objs.map(worldBox));
  if (!box) return null;
  const centre = boxSphere(box).center;
  if (objs.length !== 1) {
    return { centre, pivot: centre, sizeAxes: AXES, extents: scale(sub(box.max, box.min), 0.5), turnAxes: AXES, base: [centre[0], box.min[1], centre[2]] };
  }
  const t = objs[0].transform;
  const r = rotationEuler(t.rotation);
  const spin = rotationEuler([0, 0, t.rotation[2]]);
  return {
    centre,
    pivot: t.position,
    sizeAxes: AXES.map((a) => transformDir(r, a)),
    extents: [Math.abs(t.size[0]), Math.abs(t.size[1]), Math.abs(t.size[2])],
    turnAxes: [transformDir(r, AXES[0]), transformDir(spin, AXES[1]), AXES[2]],
    base: [t.position[0], box.min[1], t.position[2]],
  };
}

/** The ring point nearest a screen point: its index and distance. */
export function nearestRingPoint(ring: Float32Array, x: number, y: number): { index: number; distance: number } {
  let index = 0;
  let distance = Infinity;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], ay = ring[i * 2 + 1];
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ax;
    const dy = ring[j * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < distance) {
      distance = d;
      index = t > 0.5 ? j : i;
    }
  }
  return { index, distance };
}

/** The middle of the widest gap between screen directions (radians); up-left with none. */
export function widestGap(angles: readonly number[]): number {
  if (!angles.length) return -Math.PI * 3 / 4;
  const sorted = [...angles].sort((a, b) => a - b);
  let best = 0;
  let at = 0;
  sorted.forEach((a, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TURN;
    if (next - a > best) {
      best = next - a;
      at = a + best / 2;
    }
  });
  return at;
}

const directionOf = (from: readonly [number, number], to: readonly [number, number] | null): number[] => (to ? [Math.atan2(to[1] - from[1], to[0] - from[0])] : []);

/**
 * The axis a ring is drawn about: the true one, or, seen nearly edge-on, one
 * leaned toward the eye until the ring opens to `min` of a circle, so a level
 * camera still shows the Y ring as a flat ellipse rather than a line. It leans
 * the way the axis already points (toward the eye when exactly edge-on), so the
 * ring runs round the screen the same way as the true one.
 */
export function shownAxis(axis: Vec3, eye: Vec3, min: number): Vec3 {
  const c = dot(axis, eye);
  if (Math.abs(c) >= min) return axis;
  const side = normalize(sub(axis, scale(eye, c)));
  return add(scale(side, Math.sqrt(1 - min * min)), scale(eye, c > 0 ? min : -min));
}

/** A circle of `radius` about `trueAxis` through `centre` (leaned by shownAxis), projected; null behind the eye. */
function ring(proj: GizmoProjector, centre: Vec3, trueAxis: Vec3, radius: number): { points: Float32Array; back: boolean[]; facing: number } | null {
  const eye = proj.basis.ortho ? proj.basis.forward : normalize(sub(centre, proj.basis.origin));
  const axis = shownAxis(trueAxis, eye, GIZMO.ringMinFacing);
  const facing = Math.abs(dot(axis, eye));
  const u = normalize(cross(axis, Math.abs(axis[1]) < NEARLY_UP ? AXES[1] : AXES[0]));
  const v = cross(axis, u);
  const depth = proj.view(centre)[2];
  const points = new Float32Array(GIZMO.ringSteps * 2);
  const back: boolean[] = [];
  for (let k = 0; k < GIZMO.ringSteps; k++) {
    const a = (k / GIZMO.ringSteps) * TURN;
    const p = proj.view(add(centre, add(scale(u, radius * Math.cos(a)), scale(v, radius * Math.sin(a)))));
    if (!proj.basis.ortho && p[2] < WIRE.nearPlane) return null;
    points.set(proj.screen(p), k * 2);
    back.push(p[2] > depth);
  }
  return { points, back, facing };
}

function strokeRing(g: CanvasRenderingContext2D, points: Float32Array, back: readonly boolean[], far: boolean): void {
  g.beginPath();
  const n = back.length;
  for (let k = 0; k < n; k++) {
    if (back[k] !== far) continue;
    const j = (k + 1) % n;
    g.moveTo(points[k * 2], points[k * 2 + 1]);
    g.lineTo(points[j * 2], points[j * 2 + 1]);
  }
  g.stroke();
}

function square(g: CanvasRenderingContext2D, p: readonly [number, number], half: number, outline: boolean): void {
  g.fillRect(p[0] - half, p[1] - half, half * 2, half * 2);
  if (outline) g.strokeRect(p[0] - half + 0.5, p[1] - half + 0.5, half * 2 - 1, half * 2 - 1);
}

const isPart = (h: GizmoPart | null, kind: GizmoKind, axis: number): boolean => !!h && h.kind === kind && h.axis === axis;

/**
 * READ ME — the selection's handles, drawn in the move handles' language:
 * thin axis lines with a ball at the tip move, a small cube on each axis
 * resizes along it, a pale square in the widest gap resizes evenly, and three
 * thin rings around them turn. At rest the rings are faint; they come up when
 * the pointer nears the handles, so a quiet selection reads as the move cross.
 */
export function drawGizmo(g: CanvasRenderingContext2D, selected: readonly SceneObject[], proj: GizmoProjector, look: GizmoLook): GizmoHandles | null {
  const frame = gizmoFrame(selected);
  if (!frame) return null;
  const center = frame.centre;
  const v = proj.view(center);
  if (!proj.basis.ortho && v[2] < WIRE.nearPlane) return null;
  const o = proj.screen(v);
  const len = WIRE.gizmoPixels / proj.pixelsPerUnitAt(center);
  const along = (axis: Vec3, k: number): [number, number] | null => {
    const p = proj.screen(proj.view(add(center, scale(axis, len * k))));
    return Math.hypot(p[0] - o[0], p[1] - o[1]) < WIRE.gizmoHandle * 2 * k ? null : p;
  };
  const rings = frame.turnAxes.map((axis) => ring(proj, center, axis, len * GIZMO.ringScale));
  const alpha = look.near || look.hover?.kind === GizmoKind.Rotate ? 1 : GIZMO.ringIdleAlpha;
  rings.forEach((r, i) => {
    if (!r || alpha <= 0) return;
    const hot = isPart(look.hover, GizmoKind.Rotate, i);
    g.strokeStyle = hot ? WIRE.gizmoHover : WIRE.gizmo[i];
    g.lineWidth = hot ? GIZMO.ringHoverWidth : GIZMO.ringWidth;
    g.globalAlpha = alpha * GIZMO.ringBackAlpha;
    strokeRing(g, r.points, r.back, true);
    g.globalAlpha = alpha;
    strokeRing(g, r.points, r.back, false);
  });
  g.globalAlpha = 1;
  const tips = AXES.map((axis) => along(axis, 1));
  const cubes = frame.sizeAxes.map((axis) => along(axis, GIZMO.cubeAt));
  const color = (kind: GizmoKind, i: number) => (isPart(look.hover, kind, i) ? WIRE.gizmoHover : WIRE.gizmo[i]);
  g.lineWidth = 2;
  tips.forEach((tip, i) => {
    if (!tip) return;
    g.strokeStyle = color(GizmoKind.Move, i);
    g.beginPath();
    g.moveTo(o[0], o[1]);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
  });
  // A turned object's own axes leave the move cross: a thin stem leads to each cube.
  g.lineWidth = 1;
  cubes.forEach((c, i) => {
    if (!c) return;
    g.strokeStyle = color(GizmoKind.Resize, i);
    g.beginPath();
    g.moveTo(o[0], o[1]);
    g.lineTo(c[0], c[1]);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    square(g, c, GIZMO.cubeHalf, false);
  });
  tips.forEach((tip, i) => {
    if (!tip) return;
    g.fillStyle = color(GizmoKind.Move, i);
    g.beginPath();
    g.arc(tip[0], tip[1], WIRE.gizmoHandle, 0, TURN);
    g.fill();
  });
  const gap = widestGap([...tips, ...cubes].flatMap((p) => directionOf(o, p)));
  const reach = WIRE.gizmoPixels * GIZMO.cubeAt;
  const even: [number, number] = [o[0] + Math.cos(gap) * reach, o[1] + Math.sin(gap) * reach];
  g.fillStyle = isPart(look.hover, GizmoKind.Resize, EVEN_AXIS) ? WIRE.gizmoHover : GIZMO.evenFill;
  g.strokeStyle = GIZMO.evenLine;
  square(g, even, GIZMO.evenHalf, true);
  return {
    origin: o, tips, worldOrigin: center, worldAxes: AXES, axisLength: len, cubes, even,
    rings: rings.map((r) => r?.points ?? null), facing: rings.map((r) => r?.facing ?? 0), ringRadius: WIRE.gizmoPixels * GIZMO.ringScale, frame,
  };
}
