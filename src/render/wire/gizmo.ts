import { rotationEuler, transformDir } from '../../core/mat4';
import { type Vec3, add, cross, dot, normalize, scale, sub } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import { boxSphere, unionBox, worldBox } from '../../world/bounds';
import { hull } from './gizmo-paint';
import { paintBoxed } from './gizmo-paint-box';
import { paintGlossy } from './gizmo-paint-glossy';
import { paintOutline } from './gizmo-paint-outline';
import { paintPebbles } from './gizmo-paint-pebbles';
import { paintSculpted } from './gizmo-paint-sculpted';
import { ACTIVE_GIZMO_STYLE, ASKED_GIZMO_STYLE, GIZMO_SPECS, GizmoLayout, GizmoStyle, type GizmoStyleSpec, PEBBLE } from './gizmo-style';
import {
  BOX_CORNERS, EVEN_AXIS, type GizmoFrame, type GizmoGrip, type GizmoHandles, GizmoKind, type GizmoLook, type GizmoPart, type GizmoProjector,
} from './gizmo.types';
import { GIZMO, WIRE } from './wire.constants';

export { BOX_EDGES, EVEN_AXIS, GizmoKind, samePart } from './gizmo.types';
export type { GizmoFrame, GizmoGrip, GizmoHandles, GizmoLook, GizmoPart, GizmoProjector } from './gizmo.types';

const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const TURN = Math.PI * 2;
/** A ring's first spoke leans off world Y unless the axis is nearly Y, then off X. */
const NEARLY_UP = 0.9;
/** An axis shorter than this on screen, per share of its length, points at the viewer and gets no handle. */
const FORESHORTENED_PX = 12;
/** Box layout: handles closer than this to one already placed (or to the centre) are left out. */
const BOX_SPACING_PX = 15;
/** Box layout: move arrows sit this far outside the box along their axis. */
const ARROW_GAP_PX = 22;

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

type Pt = readonly [number, number];

/** What the layouts place handles from. */
interface Placing {
  readonly spec: GizmoStyleSpec;
  readonly proj: GizmoProjector;
  readonly frame: GizmoFrame;
  readonly origin: Pt;
  readonly tips: readonly (Pt | null)[];
  readonly cubes: readonly (Pt | null)[];
  readonly even: Pt;
  readonly box: readonly (Pt | null)[];
}

type Unindexed = Omit<GizmoGrip, 'part'> & { readonly part: Omit<GizmoPart, 'grip'> };

const grip = (kind: GizmoKind, axis: number, at: Pt, reach: number, detached = false, side = 1): Unindexed => ({ part: { kind, axis }, at, reach, detached, side });

/** On the axes: a tip at the end of each move axis, a resize handle part way along each size axis, the even one in the widest gap. */
function axesGrips(p: Placing): Unindexed[] {
  const { spec } = p;
  return [
    ...p.tips.flatMap((at, i) => (at ? [grip(GizmoKind.Move, i, at, spec.tipReach)] : [])),
    ...p.cubes.flatMap((at, i) => (at ? [grip(GizmoKind.Resize, i, at, spec.cubeReach)] : [])),
    grip(GizmoKind.Resize, EVEN_AXIS, p.even, spec.evenReach),
  ];
}

const far = (a: Pt, b: Pt): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) >= BOX_SPACING_PX;

/**
 * Bryce's selection box: a square on each corner of its outline resizes
 * evenly, one on each face stretches along that face's axis, and a chunky
 * arrow just outside the box along each world axis moves. Corners inside the
 * outline and handles that would land on another (a face facing the eye) are left out.
 */
function boxGrips(p: Placing): Unindexed[] {
  const { spec, proj, frame } = p;
  const out: Unindexed[] = [];
  const taken: Pt[] = [];
  const place = (at: Pt | null, make: (at: Pt) => Unindexed) => {
    if (!at || !taken.every((t) => far(t, at))) return;
    taken.push(at);
    out.push(make(at));
  };
  const centre = proj.screen(proj.view(frame.pivot));
  taken.push(centre);
  const order = frame.sizeAxes.flatMap((_, i) => [1, -1].map((side) => ({ i, side })));
  for (const { i, side } of order) {
    const v = proj.view(add(frame.pivot, scale(frame.sizeAxes[i], frame.extents[i] * side)));
    place(proj.basis.ortho || v[2] >= WIRE.nearPlane ? proj.screen(v) : null, (at) => grip(GizmoKind.Resize, i, at, spec.cubeReach, false, side));
  }
  const shown = p.box.filter((c): c is Pt => c !== null);
  const outline = hull(shown);
  const depths = boxPoints(frame).map((c) => proj.view(c)[2]);
  const corners = p.box.map((at, k) => ({ at, depth: depths[k] })).filter((c) => c.at && outline.includes(c.at)).sort((a, b) => a.depth - b.depth);
  for (const c of corners) place(c.at, (at) => grip(GizmoKind.Resize, EVEN_AXIS, at, spec.evenReach));
  p.tips.forEach((tip, i) => {
    if (!tip) return;
    const len = Math.hypot(tip[0] - p.origin[0], tip[1] - p.origin[1]);
    const dir: Pt = [(tip[0] - p.origin[0]) / len, (tip[1] - p.origin[1]) / len];
    const reach = Math.max(0, ...shown.map((c) => (c[0] - p.origin[0]) * dir[0] + (c[1] - p.origin[1]) * dir[1]));
    out.push(grip(GizmoKind.Move, i, [p.origin[0] + dir[0] * (reach + ARROW_GAP_PX), p.origin[1] + dir[1] * (reach + ARROW_GAP_PX)], spec.tipReach));
  });
  return out;
}

/**
 * The pebbles: a small palette right of the selection under the A / M / E
 * tags, a column per axis with a move, a stretch and a turn pebble, and one
 * wide even-resize pebble under them. An axis pointing at the viewer greys
 * out its move and stretch pebbles.
 */
function pebbleGrips(p: Placing): Unindexed[] {
  const { spec, proj } = p;
  const shown = p.box.filter((c): c is Pt => c !== null);
  const xs = shown.length ? shown.map((c) => c[0]) : [p.origin[0]];
  const ys = shown.length ? shown.map((c) => c[1]) : [p.origin[1]];
  const width = PEBBLE.w * 3 + PEBBLE.gap * 2;
  const height = PEBBLE.h * 4 + PEBBLE.gap * 3;
  const f = proj.frame;
  const left = Math.max(f.x + PEBBLE.margin, Math.min(Math.max(...xs) + PEBBLE.apart, f.x + f.w - width - PEBBLE.margin));
  const top = Math.max(f.y + PEBBLE.margin, Math.min(Math.max(Math.min(...ys), f.y) + PEBBLE.belowTags, f.y + f.h - height - PEBBLE.margin));
  const cell = (col: number, row: number): Pt => [left + PEBBLE.w / 2 + col * (PEBBLE.w + PEBBLE.gap), top + PEBBLE.h / 2 + row * (PEBBLE.h + PEBBLE.gap)];
  const rows = [GizmoKind.Move, GizmoKind.Resize, GizmoKind.Rotate];
  const out = rows.flatMap((kind, row) => [0, 1, 2].flatMap((i) => {
    const usable = kind === GizmoKind.Move ? p.tips[i] : kind === GizmoKind.Resize ? p.cubes[i] : true;
    return [grip(kind, i, cell(i, row), usable ? spec.cubeReach : 0, true)];
  }));
  out.push(grip(GizmoKind.Resize, EVEN_AXIS, [left + width / 2, cell(1, rows.length)[1]], spec.evenReach, true));
  return out;
}

const LAYOUTS: Readonly<Record<GizmoLayout, (p: Placing) => Unindexed[]>> = {
  [GizmoLayout.Axes]: axesGrips,
  [GizmoLayout.Box]: boxGrips,
  [GizmoLayout.Pebbles]: pebbleGrips,
};

/** The box's corners in world space (bit 0 X, bit 1 Y, bit 2 Z on the far side). */
function boxPoints(f: GizmoFrame): Vec3[] {
  return Array.from({ length: BOX_CORNERS }, (_, k) => f.sizeAxes.reduce(
    (p, axis, i) => add(p, scale(axis, f.extents[i] * (k & (1 << i) ? 1 : -1))), f.pivot));
}

/** Where the selection's handles sit on screen in a style's layout; null when nothing shows. */
export function layoutGizmo(selected: readonly SceneObject[], proj: GizmoProjector, style: GizmoStyle): GizmoHandles | null {
  const spec = GIZMO_SPECS[style];
  const frame = gizmoFrame(selected);
  if (!frame) return null;
  const center = frame.centre;
  const v = proj.view(center);
  if (!proj.basis.ortho && v[2] < WIRE.nearPlane) return null;
  const o = proj.screen(v);
  const ppu = proj.pixelsPerUnitAt(center);
  const len = spec.axisPx / ppu;
  const along = (axis: Vec3, k: number): [number, number] | null => {
    const p = proj.screen(proj.view(add(center, scale(axis, len * k))));
    return Math.hypot(p[0] - o[0], p[1] - o[1]) < FORESHORTENED_PX * k ? null : p;
  };
  const tips = AXES.map((axis) => along(axis, 1));
  const cubes = frame.sizeAxes.map((axis) => along(axis, spec.cubeAt));
  const gap = widestGap([...tips, ...cubes].flatMap((p) => directionOf(o, p)));
  const reach = spec.axisPx * spec.cubeAt;
  const even: [number, number] = [o[0] + Math.cos(gap) * reach, o[1] + Math.sin(gap) * reach];
  const box = boxPoints(frame).map((c) => {
    const cv = proj.view(c);
    return proj.basis.ortho || cv[2] >= WIRE.nearPlane ? proj.screen(cv) : null;
  });
  const boxReach = Math.max(0, ...box.map((c) => (c ? Math.hypot(c[0] - o[0], c[1] - o[1]) : 0)));
  const ringRadius = spec.layout === GizmoLayout.Box ? boxReach + spec.ringScale : spec.axisPx * spec.ringScale;
  const rings = frame.turnAxes.map((axis) => ring(proj, center, axis, ringRadius / ppu));
  const placed = LAYOUTS[spec.layout]({ spec, proj, frame, origin: o, tips, cubes, even, box });
  const grips: GizmoGrip[] = placed.map((g, i) => ({ ...g, part: { ...g.part, grip: i } }));
  return {
    origin: o, tips, worldOrigin: center, worldAxes: AXES, axisLength: len, cubes, even,
    rings: rings.map((r) => r?.points ?? null), ringBack: rings.map((r) => r?.back ?? null), facing: rings.map((r) => r?.facing ?? 0),
    ringRadius, ringReach: spec.ringReach, nearBand: spec.nearBand, grips, box, pixelsPerUnit: ppu, frame,
  };
}

/** Each look's painter: draws the laid-out handles, the hovered one lit. */
const PAINTERS: Readonly<Record<GizmoStyle, (g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook, proj: GizmoProjector) => void>> = {
  [GizmoStyle.Glossy]: paintGlossy,
  [GizmoStyle.Box]: paintBoxed,
  [GizmoStyle.Outline]: paintOutline,
  [GizmoStyle.Pebbles]: paintPebbles,
  [GizmoStyle.Sculpted]: paintSculpted,
};

/**
 * READ ME — the selection's handles: move along an axis, stretch along an
 * axis (Shift evenly, Alt from the far side), resize evenly, turn on a ring
 * (Shift in 15° steps). gizmo-style.ts picks where they sit and how they look;
 * the handles returned are what picking (input/pick.ts) and the drags
 * (input/gizmo-drag.ts) read.
 */
export function drawGizmo(g: CanvasRenderingContext2D, selected: readonly SceneObject[], proj: GizmoProjector, look: GizmoLook, chosen?: GizmoStyle): GizmoHandles | null {
  const style = ASKED_GIZMO_STYLE || !chosen ? ACTIVE_GIZMO_STYLE : chosen;
  const h = layoutGizmo(selected, proj, style);
  if (h) PAINTERS[style](g, h, look, proj);
  return h;
}
