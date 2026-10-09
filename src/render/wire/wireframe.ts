import { compose, transformPoint } from '../../core/mat4';
import { type Vec3, add, cross, dot, normalize, scale, sub } from '../../core/vec3';
import { BooleanMode } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene, SceneObject } from '../../model/scene.types';
import { boxSphere, objectMatrix, unionBox, worldBox } from '../../world/bounds';
import type { ViewBasis } from '../../world/camera-math';
import { WIRE, FAMILY_COLORS } from './wire.constants';
import { drawsInWorldUnits, wireLines } from './wire-shapes';

/** Where the projected picture lands on the canvas (CSS pixels). */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface WireOptions {
  readonly selection: ReadonlySet<ObjectId>;
  readonly hover: ObjectId | null;
  readonly depthCue: boolean;
  readonly grid: boolean;
  readonly gizmo: boolean;
  readonly gizmoHover: number;
  readonly shadeOutside: boolean;
  readonly overRender: boolean;
}

export interface GizmoHandles {
  readonly origin: readonly [number, number];
  /** Screen end points of the X, Y, Z axes; null when an axis points at the viewer. */
  readonly tips: readonly ([number, number] | null)[];
  readonly worldOrigin: Vec3;
  readonly worldAxes: readonly Vec3[];
  /** World length of each drawn axis. */
  readonly axisLength: number;
}

/** Screen-space segments drawn for each object, kept for picking. */
export type SegmentIndex = Map<ObjectId, Float32Array>;

const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export class WireProjector {
  constructor(readonly basis: ViewBasis, readonly frame: Frame) {}

  /** View-space coordinates: right, up, depth. */
  view(p: Vec3): Vec3 {
    const rel = sub(p, this.basis.origin);
    return [dot(rel, this.basis.right), dot(rel, this.basis.up), dot(rel, this.basis.forward)];
  }

  screen(v: Vec3): [number, number] {
    const b = this.basis;
    const k = b.ortho ? 1 : v[2];
    const nx = v[0] / (k * b.halfHeight * b.aspect);
    const ny = v[1] / (k * b.halfHeight);
    return [this.frame.x + ((nx + 1) / 2) * this.frame.w, this.frame.y + ((1 - ny) / 2) * this.frame.h];
  }

  /** Clips a view-space segment against the near plane; null when fully behind. */
  segment(a: Vec3, b: Vec3): [number, number, number, number] | null {
    if (this.basis.ortho) {
      const pa = this.screen(a);
      const pb = this.screen(b);
      return [pa[0], pa[1], pb[0], pb[1]];
    }
    const near = WIRE.nearPlane;
    if (a[2] < near && b[2] < near) return null;
    let p = a;
    let q = b;
    if (p[2] < near) p = clipNear(p, q, near);
    else if (q[2] < near) q = clipNear(q, p, near);
    const pa = this.screen(p);
    const pb = this.screen(q);
    return [pa[0], pa[1], pb[0], pb[1]];
  }

  pixelsPerUnitAt(p: Vec3): number {
    const depth = this.basis.ortho ? 1 : Math.max(this.view(p)[2], WIRE.nearPlane);
    return this.frame.h / (2 * this.basis.halfHeight * depth);
  }
}

function clipNear(behind: Vec3, front: Vec3, near: number): Vec3 {
  const t = (near - behind[2]) / (front[2] - behind[2]);
  return [behind[0] + (front[0] - behind[0]) * t, behind[1] + (front[1] - behind[1]) * t, near];
}

function objectStyle(o: SceneObject, opts: WireOptions): { color: string; width: number; dash: readonly number[] } {
  const selected = opts.selection.has(o.id);
  const color = selected ? WIRE.selected : o.id === opts.hover ? WIRE.hover : FAMILY_COLORS[o.family];
  const dash = o.groupId && o.boolean === BooleanMode.Negative ? WIRE.negativeDash : o.groupId && o.boolean === BooleanMode.Intersect ? WIRE.intersectDash : [];
  return { color, width: selected ? WIRE.selectedWidth : WIRE.lineWidth, dash };
}

/**
 * READ ME — draws the Bryce wireframe view into a 2D canvas: pink ground grid,
 * blue horizon, depth-cued object lattices, red selection, optional gizmo.
 * Returns the projected segments so the input layer can pick by proximity.
 */
export function drawWireframe(g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, opts: WireOptions): { segments: SegmentIndex; gizmo: GizmoHandles | null } {
  const segments: SegmentIndex = new Map();
  if (opts.grid) drawGrid(g, proj);
  if (!proj.basis.ortho && !opts.overRender) drawHorizon(g, proj);
  // Over a rendered picture Bryce shows only what you are working on.
  const visible = scene.objects.filter((o) => !o.hidden && (!opts.overRender || opts.selection.has(o.id) || o.id === opts.hover));
  const depths = visible.map((o) => proj.view(o.transform.position)[2]);
  const near = Math.min(...depths, 1);
  const far = Math.max(...depths, near + 1);
  for (const o of visible) {
    const style = objectStyle(o, opts);
    const m = drawsInWorldUnits(o) ? compose(o.transform.position, o.transform.rotation, [1, 1, 1]) : objectMatrix(o);
    const lines = wireLines(o);
    const out = new Float32Array(lines.length * 2);
    let n = 0;
    const cue = opts.depthCue && !opts.selection.has(o.id)
      ? 1 - ((proj.view(o.transform.position)[2] - near) / (far - near)) * (1 - WIRE.depthCueFloor)
      : 1;
    g.globalAlpha = opts.overRender ? 1 : cue;
    g.strokeStyle = style.color;
    g.lineWidth = style.width;
    g.setLineDash(style.dash as number[]);
    g.beginPath();
    for (let i = 0; i < lines.length; i += 2) {
      const s = proj.segment(proj.view(transformPoint(m, lines[i])), proj.view(transformPoint(m, lines[i + 1])));
      if (!s) continue;
      g.moveTo(s[0], s[1]);
      g.lineTo(s[2], s[3]);
      out.set(s, n);
      n += 4;
    }
    g.stroke();
    segments.set(o.id, out.subarray(0, n));
  }
  g.globalAlpha = 1;
  g.setLineDash([]);
  const gizmo = opts.gizmo ? drawGizmo(g, scene, proj, opts) : null;
  if (opts.shadeOutside) shadeOutside(g, proj.frame);
  return { segments, gizmo };
}

function drawGrid(g: CanvasRenderingContext2D, proj: WireProjector): void {
  const step = WIRE.gridStep;
  const ext = proj.basis.ortho ? Math.ceil((proj.basis.halfHeight * proj.basis.aspect) / step) * step + step * WIRE.orthoGridLines / 2 : WIRE.gridExtent;
  const center = proj.basis.ortho ? proj.basis.origin : [0, 0, 0];
  const cx = Math.round(center[0] / step) * step;
  const cz = Math.round(center[2] / step) * step;
  g.lineWidth = 1;
  g.beginPath();
  for (let t = -ext; t <= ext; t += step) {
    for (const [a, b] of [
      [[cx + t, 0, cz - ext], [cx + t, 0, cz + ext]],
      [[cx - ext, 0, cz + t], [cx + ext, 0, cz + t]],
    ] as [Vec3, Vec3][]) {
      const s = proj.segment(proj.view(a), proj.view(b));
      if (s) { g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); }
    }
  }
  g.strokeStyle = WIRE.grid;
  g.stroke();
}

function drawHorizon(g: CanvasRenderingContext2D, proj: WireProjector): void {
  const f = proj.basis.forward;
  const flat = normalize([f[0], 0, f[2]]);
  if (flat[0] === 0 && flat[2] === 0) return;
  const side = cross(flat, [0, 1, 0]);
  const far = WIRE.horizonFar;
  const eye = proj.basis.origin;
  const pts = [-WIRE.horizonSpread, WIRE.horizonSpread].map((k) => {
    const dir = normalize(add(flat, scale(side, k)));
    return proj.screen(proj.view([eye[0] + dir[0] * far, 0, eye[2] + dir[2] * far]));
  });
  const [a, b] = pts;
  if (Math.abs(b[0] - a[0]) < WIRE.parallelEps) return;
  const slope = (b[1] - a[1]) / (b[0] - a[0]);
  const w = g.canvas.width;
  g.strokeStyle = WIRE.horizon;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, a[1] - slope * a[0]);
  g.lineTo(w, a[1] + slope * (w - a[0]));
  g.stroke();
}

function drawGizmo(g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, opts: WireOptions): GizmoHandles | null {
  const selected = scene.objects.filter((o) => opts.selection.has(o.id) && !o.hidden);
  const box = unionBox(selected.map(worldBox));
  if (!box) return null;
  const center = boxSphere(box).center;
  const v = proj.view(center);
  if (!proj.basis.ortho && v[2] < WIRE.nearPlane) return null;
  const o = proj.screen(v);
  const ppu = proj.pixelsPerUnitAt(center);
  const len = WIRE.gizmoPixels / ppu;
  const tips = AXES.map((axis, i) => {
    const tip = proj.screen(proj.view(add(center, scale(axis, len))));
    const dx = tip[0] - o[0];
    const dy = tip[1] - o[1];
    if (Math.hypot(dx, dy) < WIRE.gizmoHandle * 2) return null;
    g.strokeStyle = opts.gizmoHover === i ? WIRE.gizmoHover : WIRE.gizmo[i];
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(o[0], o[1]);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
    g.beginPath();
    g.arc(tip[0], tip[1], WIRE.gizmoHandle, 0, Math.PI * 2);
    g.fill();
    return tip;
  });
  return { origin: o, tips, worldOrigin: center, worldAxes: AXES, axisLength: len };
}

function shadeOutside(g: CanvasRenderingContext2D, f: Frame): void {
  const w = g.canvas.width;
  const h = g.canvas.height;
  g.fillStyle = WIRE.frameShade;
  g.fillRect(0, 0, w, f.y);
  g.fillRect(0, f.y + f.h, w, h - f.y - f.h);
  g.fillRect(0, f.y, f.x, f.h);
  g.fillRect(f.x + f.w, f.y, w - f.x - f.w, f.h);
  g.strokeStyle = WIRE.frameLine;
  g.lineWidth = 1;
  g.strokeRect(Math.round(f.x) - 0.5, Math.round(f.y) - 0.5, Math.round(f.w) + 1, Math.round(f.h) + 1);
}
