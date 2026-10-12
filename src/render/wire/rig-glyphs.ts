import { type Vec3, add, dot, scale, sub } from '../../core/vec3';
import { ViewKind } from '../../model/scene.enums';
import type { Camera, Scene } from '../../model/scene.types';
import { type ViewBasis, cameraAxes, pivotOf, project } from '../../world/camera-math';
import { rigFlags, sunDirection } from '../../world/rig';
import { Rig } from '../../world/world.enums';
import { WIRE } from './wire.constants';
import type { Frame, WireProjector } from './wireframe';

/**
 * The camera and the sun in the scene window, as Bryce drew its camera in the
 * flat views: a little movie camera with its view cone out to the focus distance
 * and a cross at its aim, and a sun disc on a ring round the middle of the picture
 * (the sun is far away: only its direction counts) with a line showing which way
 * its light falls. Neither shows in the Camera
 * view; the sun shows only in Top, Front and Side. The glyphs are handles: the
 * scene window picks and drags them (input/rig-drag.ts).
 */

const HALF_TURN_DEG = 180;

/** What part of a glyph is under the pointer or held. */
export enum RigPart {
  Camera = 'camera',
  /** The cross at the camera's focus distance: dragging it turns the camera toward it. */
  Aim = 'aim',
  Sun = 'sun',
}

/** Where the sun's glyph is on screen and how it maps back to a direction. */
export interface SunHandle {
  readonly x: number;
  readonly y: number;
  /** The picture's middle and the ring's radius (pixels). */
  readonly ax: number;
  readonly ay: number;
  readonly radius: number;
  /** 1 when the sun is on the far side of the scene from the viewer, -1 on the near side. */
  readonly side: number;
}

/** The glyphs drawn in one view, for picking. */
export interface RigHandles {
  /** Screen segments (x0, y0, x1, y1 …) of the camera body. */
  readonly camera: Float32Array | null;
  readonly aim: readonly [number, number] | null;
  /** The arrow on the picture's edge when the camera is outside it: it picks and drags like the body. */
  readonly edge: readonly [number, number] | null;
  readonly sun: SunHandle | null;
}

export interface RigLook {
  readonly selected: Rig | null;
  readonly hover: RigPart | null;
}

export const NO_RIG: RigHandles = { camera: null, aim: null, edge: null, sun: null };

const CAMERA = {
  color: '#1f7a7a',
  /** Pixels per glyph unit: the body is one unit long. */
  px: 26,
  width: 1.4,
  selectedWidth: 2,
  cone: 'rgba(31, 122, 122, 0.55)',
  coneSelected: 'rgba(208, 32, 42, 0.6)',
  coneDash: [5, 4],
  aimHalf: 5,
  aimRing: 8,
  reelSteps: 12,
} as const;
const SUN = {
  fill: '#ffd23a',
  edge: '#8a5a00',
  line: 'rgba(160, 110, 0, 0.75)',
  dash: [4, 4],
  radius: 6,
  rayFrom: 9,
  rayTo: 13,
  rays: 8,
  /** The ring the sun hangs on, as a share of half the picture's smaller side. */
  orbit: 0.8,
  arrow: 7,
  /** The arrow stops this far short of the picture's middle. */
  arrowGap: 10,
  farAlpha: 0.45,
  width: 1.3,
  selectedWidth: 2.2,
} as const;
const LABEL = { font: 'bold 10px Geneva, Verdana, sans-serif', dx: 10, dy: -10, back: 'rgba(255,255,255,0.78)', padX: 3, height: 13, baseline: 3.5 } as const;
const FOCUS = { color: '#e08a1e', radius: 9, tick: 5, width: 1.5 } as const;
/** The mark of a camera outside the picture: inset from the edge, arrow size, where its name goes. */
const EDGE = { inset: 12, arrow: 7, labelBack: 80, labelUp: 4, pick: 10 } as const;

/** Body box (x right, y up, z forward; z 0 is the lens), the lens hood and two film reels, in glyph units. */
const BODY: { readonly x: number; readonly y: number; readonly back: number } = { x: 0.5, y: 0.38, back: -1 };
const HOOD: { readonly near: number; readonly far: number; readonly length: number } = { near: 0.22, far: 0.36, length: 0.45 };
const REELS: readonly { readonly z: number; readonly r: number }[] = [{ z: -0.72, r: 0.28 }, { z: -0.22, r: 0.22 }];

type Local = readonly [number, number, number];

function boxLines(x: number, y: number, z0: number, z1: number, x1 = x, y1 = y): Local[] {
  const a: Local[] = [[-x, -y, z0], [x, -y, z0], [x, y, z0], [-x, y, z0]];
  const b: Local[] = [[-x1, -y1, z1], [x1, -y1, z1], [x1, y1, z1], [-x1, y1, z1]];
  const out: Local[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    out.push(a[i], a[j], b[i], b[j], a[i], b[i]);
  }
  return out;
}

function reelLines(): Local[] {
  const out: Local[] = [];
  for (const reel of REELS) {
    const cy = BODY.y + reel.r;
    for (let i = 0; i < CAMERA.reelSteps; i++) {
      const a = (i / CAMERA.reelSteps) * Math.PI * 2;
      const b = ((i + 1) / CAMERA.reelSteps) * Math.PI * 2;
      out.push([0, cy + Math.sin(a) * reel.r, reel.z + Math.cos(a) * reel.r], [0, cy + Math.sin(b) * reel.r, reel.z + Math.cos(b) * reel.r]);
    }
  }
  return out;
}

/** The camera glyph as pairs of points: line i runs from point 2i to point 2i+1. */
const CAMERA_LINES: readonly Local[] = [...boxLines(BODY.x, BODY.y, BODY.back, 0), ...boxLines(HOOD.near, HOOD.near, 0, HOOD.length, HOOD.far, HOOD.far), ...reelLines()];

/** The glyph's point in the world: `s` world units per glyph unit. */
function placeLocal(c: Camera, s: number, p: Local): Vec3 {
  const { forward, right, up } = cameraAxes(c);
  return add(c.position, add(scale(right, p[0] * s), add(scale(up, p[1] * s), scale(forward, p[2] * s))));
}

function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  g.font = LABEL.font;
  const w = g.measureText(text).width + LABEL.padX * 2;
  g.fillStyle = LABEL.back;
  g.fillRect(x + LABEL.dx, y + LABEL.dy - LABEL.height / 2, w, LABEL.height);
  g.fillStyle = color;
  g.fillText(text, x + LABEL.dx + LABEL.padX, y + LABEL.dy + LABEL.baseline);
}

function line(g: CanvasRenderingContext2D, proj: WireProjector, a: Vec3, b: Vec3, out?: number[]): void {
  const s = proj.segment(proj.view(a), proj.view(b));
  if (!s) return;
  g.moveTo(s[0], s[1]);
  g.lineTo(s[2], s[3]);
  out?.push(...s);
}

function drawCamera(g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, look: RigLook): Pick<RigHandles, 'camera' | 'aim' | 'edge'> {
  const c = scene.camera;
  const selected = look.selected === Rig.Camera;
  const lit = (part: RigPart) => look.hover === part;
  const color = selected ? WIRE.selected : lit(RigPart.Camera) ? WIRE.hover : CAMERA.color;
  const s = CAMERA.px / proj.pixelsPerUnitAt(c.position);
  // The view cone: from the lens to the frame at the focus distance, where the aim cross sits.
  const { forward, right, up } = cameraAxes(c);
  const half = Math.tan((c.fov * Math.PI) / HALF_TURN_DEG / 2);
  const aspect = scene.document.width / scene.document.height;
  const far = (dx: number, dy: number) => add(c.position, scale(add(forward, add(scale(right, dx * half * aspect), scale(up, dy * half))), c.focus));
  const corners = [far(-1, -1), far(1, -1), far(1, 1), far(-1, 1)];
  g.strokeStyle = selected ? CAMERA.coneSelected : CAMERA.cone;
  g.lineWidth = 1;
  g.setLineDash(CAMERA.coneDash as unknown as number[]);
  g.beginPath();
  corners.forEach((p, i) => {
    line(g, proj, c.position, p);
    line(g, proj, p, corners[(i + 1) % corners.length]);
  });
  g.stroke();
  g.setLineDash([]);
  const segs: number[] = [];
  g.strokeStyle = color;
  g.lineWidth = selected ? CAMERA.selectedWidth : CAMERA.width;
  g.beginPath();
  for (let i = 0; i < CAMERA_LINES.length; i += 2) line(g, proj, placeLocal(c, s, CAMERA_LINES[i]), placeLocal(c, s, CAMERA_LINES[i + 1]), segs);
  g.stroke();
  const pv = proj.view(pivotOf(c));
  const aim = proj.basis.ortho || pv[2] > WIRE.nearPlane ? proj.screen(pv) : null;
  if (aim) {
    const k = CAMERA.aimHalf;
    g.strokeStyle = lit(RigPart.Aim) ? WIRE.hover : color;
    g.lineWidth = CAMERA.width;
    g.beginPath();
    g.moveTo(aim[0] - k, aim[1]);
    g.lineTo(aim[0] + k, aim[1]);
    g.moveTo(aim[0], aim[1] - k);
    g.lineTo(aim[0], aim[1] + k);
    if (lit(RigPart.Aim) || selected) g.arc(aim[0], aim[1], CAMERA.aimRing, 0, Math.PI * 2);
    g.stroke();
  }
  const at = proj.view(c.position);
  const seen = proj.basis.ortho || at[2] > WIRE.nearPlane;
  const [x, y] = seen ? proj.screen(at) : [proj.frame.x + proj.frame.w / 2, proj.frame.y + proj.frame.h];
  const edge = offFrame(proj.frame, x, y);
  if (edge) drawEdgeMark(g, edge, x, y, color);
  else if (seen) drawLabel(g, 'Camera', x, y, color);
  return { camera: segs.length ? new Float32Array(segs) : null, aim, edge };
}

/** Where a camera outside the picture is marked on its edge, or null when it is inside. */
function offFrame(f: Frame, x: number, y: number): [number, number] | null {
  const m = EDGE.inset;
  if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return null;
  return [Math.max(f.x + m, Math.min(f.x + f.w - m, x)), Math.max(f.y + m, Math.min(f.y + f.h - m, y))];
}

/** A camera outside the picture: an arrow on the edge pointing at it, named. */
function drawEdgeMark(g: CanvasRenderingContext2D, at: readonly [number, number], x: number, y: number, color: string): void {
  const len = Math.hypot(x - at[0], y - at[1]) || 1;
  const ux = (x - at[0]) / len;
  const uy = (y - at[1]) / len;
  const tip: [number, number] = [at[0] + ux * EDGE.arrow, at[1] + uy * EDGE.arrow];
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(tip[0], tip[1]);
  g.lineTo(at[0] - uy * EDGE.arrow, at[1] + ux * EDGE.arrow);
  g.lineTo(at[0] + uy * EDGE.arrow, at[1] - ux * EDGE.arrow);
  g.closePath();
  g.fill();
  const flip = ux > 0 ? -1 : 1;
  drawLabel(g, 'Camera', at[0] + (flip < 0 ? -EDGE.labelBack : 0), at[1] + (uy > 0 ? -EDGE.labelUp : EDGE.labelUp), color);
}

function drawSun(g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, look: RigLook): SunHandle {
  const b = proj.basis;
  const dir = sunDirection(scene.sky);
  const ax = proj.frame.x + proj.frame.w / 2;
  const ay = proj.frame.y + proj.frame.h / 2;
  const radius = (Math.min(proj.frame.w, proj.frame.h) / 2) * SUN.orbit;
  const x = ax + dot(dir, b.right) * radius;
  const y = ay - dot(dir, b.up) * radius;
  const side = dot(dir, b.forward) > 0 ? 1 : -1;
  const selected = look.selected === Rig.Sun;
  const edge = selected ? WIRE.selected : look.hover === RigPart.Sun ? WIRE.hover : SUN.edge;
  g.save();
  if (side > 0) g.globalAlpha = SUN.farAlpha;
  // The light's way: from the sun toward the middle of the scene, with an arrow head.
  const len = Math.hypot(ax - x, ay - y);
  if (len > SUN.rayTo + SUN.arrowGap) {
    const ux = (ax - x) / len;
    const uy = (ay - y) / len;
    const tx = ax - ux * SUN.arrowGap;
    const ty = ay - uy * SUN.arrowGap;
    g.strokeStyle = selected ? WIRE.selected : SUN.line;
    g.lineWidth = 1;
    g.setLineDash(SUN.dash as unknown as number[]);
    g.beginPath();
    g.moveTo(x + ux * SUN.rayTo, y + uy * SUN.rayTo);
    g.lineTo(tx, ty);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx - ux * SUN.arrow - uy * SUN.arrow / 2, ty - uy * SUN.arrow + ux * SUN.arrow / 2);
    g.lineTo(tx - ux * SUN.arrow + uy * SUN.arrow / 2, ty - uy * SUN.arrow - ux * SUN.arrow / 2);
    g.closePath();
    g.fillStyle = selected ? WIRE.selected : SUN.line;
    g.fill();
  }
  g.lineWidth = selected ? SUN.selectedWidth : SUN.width;
  g.strokeStyle = edge;
  g.beginPath();
  for (let i = 0; i < SUN.rays; i++) {
    const a = (i / SUN.rays) * Math.PI * 2;
    g.moveTo(x + Math.cos(a) * SUN.rayFrom, y + Math.sin(a) * SUN.rayFrom);
    g.lineTo(x + Math.cos(a) * SUN.rayTo, y + Math.sin(a) * SUN.rayTo);
  }
  g.stroke();
  g.beginPath();
  g.arc(x, y, SUN.radius, 0, Math.PI * 2);
  g.fillStyle = SUN.fill;
  g.fill();
  g.stroke();
  drawLabel(g, 'Sun', x, y, edge);
  g.restore();
  return { x, y, ax, ay, radius, side };
}

/**
 * Draws the camera (not in the Camera view) and the sun (Top, Front and Side only)
 * unless they are hidden; returns their handles for picking.
 */
export function drawRig(g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, kind: ViewKind, look: RigLook): RigHandles {
  if (kind === ViewKind.Camera) return NO_RIG;
  g.save();
  const camera = rigFlags(scene, Rig.Camera).hidden ? NO_RIG : drawCamera(g, scene, proj, look);
  const sun = proj.basis.ortho && !rigFlags(scene, Rig.Sun).hidden ? drawSun(g, scene, proj, look) : null;
  g.restore();
  return { camera: camera.camera, aim: camera.aim, edge: camera.edge, sun };
}

/** Inside the screen box of the glyph's lines (the camera is small: a press anywhere on it counts). */
function insideBox(segs: Float32Array, x: number, y: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    minX = Math.min(minX, segs[i]);
    maxX = Math.max(maxX, segs[i]);
    minY = Math.min(minY, segs[i + 1]);
    maxY = Math.max(maxY, segs[i + 1]);
  }
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function nearSegments(segs: Float32Array, x: number, y: number, radius: number): boolean {
  for (let i = 0; i < segs.length; i += 4) {
    const dx = segs[i + 2] - segs[i];
    const dy = segs[i + 3] - segs[i + 1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - segs[i]) * dx + (y - segs[i + 1]) * dy) / len2)) : 0;
    if (Math.hypot(x - (segs[i] + dx * t), y - (segs[i + 1] + dy * t)) <= radius) return true;
  }
  return false;
}

/** The glyph part under a point: the sun disc, the aim cross, then the camera body. */
export function rigPartAt(h: RigHandles | null, x: number, y: number, radius: number): RigPart | null {
  if (!h) return null;
  if (h.sun && Math.hypot(h.sun.x - x, h.sun.y - y) <= SUN.rayTo + radius) return RigPart.Sun;
  if (h.aim && Math.hypot(h.aim[0] - x, h.aim[1] - y) <= CAMERA.aimHalf + radius) return RigPart.Aim;
  if (h.camera && (insideBox(h.camera, x, y) || nearSegments(h.camera, x, y, radius))) return RigPart.Camera;
  if (h.edge && Math.hypot(h.edge[0] - x, h.edge[1] - y) <= EDGE.pick + radius) return RigPart.Camera;
  return null;
}

/** Where the lens is sharp: a reticle at the camera's focus distance (pivot) when it has depth of field. */
export function drawFocusReticle(g: CanvasRenderingContext2D, frame: Frame, basis: ViewBasis, cam: Camera): void {
  if (cam.aperture <= 0) return;
  const p = project(basis, pivotOf(cam));
  if (p.depth <= 0) return;
  const x = frame.x + ((p.x + 1) / 2) * frame.w;
  const y = frame.y + ((1 - p.y) / 2) * frame.h;
  g.save();
  g.strokeStyle = FOCUS.color;
  g.lineWidth = FOCUS.width;
  g.beginPath();
  g.arc(x, y, FOCUS.radius, 0, Math.PI * 2);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    g.moveTo(x + dx * FOCUS.radius, y + dy * FOCUS.radius);
    g.lineTo(x + dx * (FOCUS.radius + FOCUS.tick), y + dy * (FOCUS.radius + FOCUS.tick));
  }
  g.stroke();
  g.restore();
}

/** The world shift of a drag in a view: in its plane for flat views, at `depthOf`'s distance for perspective ones. */
export function dragDelta(basis: ViewBasis, frame: Frame, depthOf: Vec3, dx: number, dy: number): Vec3 {
  const depth = basis.ortho ? 1 : Math.max(dot(sub(depthOf, basis.origin), basis.forward), 1);
  const k = (2 * basis.halfHeight * depth) / frame.h;
  return add(scale(basis.right, dx * k), scale(basis.up, -dy * k));
}
