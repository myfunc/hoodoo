import { type Vec3, add, cross, dot, normalize, scale, sub } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { Camera, OrthoView } from '../model/scene.types';

const DEG = Math.PI / 180;
const PITCH_LIMIT = 89;
const ORTHO_DEPTH = 500;
export const MIN_FOCUS = 0.5;
export const MIN_SPAN = 0.5;

/** A camera or orthographic view reduced to what projection and ray generation need. */
export interface ViewBasis {
  readonly origin: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly ortho: boolean;
  /** Perspective: tan(fov/2). Orthographic: half of the view height in world units. */
  readonly halfHeight: number;
  readonly aspect: number;
  /** Thin lens: aperture radius and focus distance in world units; radius 0 is a pinhole. */
  readonly lens: readonly [number, number];
}

const sameVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Whether two bases frame exactly the same picture. */
export function sameBasis(a: ViewBasis, b: ViewBasis): boolean {
  return a.ortho === b.ortho && a.halfHeight === b.halfHeight && a.aspect === b.aspect
    && a.lens[0] === b.lens[0] && a.lens[1] === b.lens[1]
    && sameVec(a.origin, b.origin) && sameVec(a.forward, b.forward) && sameVec(a.right, b.right) && sameVec(a.up, b.up);
}

/** At aperture 100 the lens radius is this fraction of the focus distance. */
const MAX_LENS_RATIO = 0.06;
const APERTURE_DIAL = 100;
const PINHOLE: readonly [number, number] = [0, 0];

/** The dial is squared so the first steps give the subtle blur that is most often wanted. */
export function lensOf(c: Camera): readonly [number, number] {
  const k = Math.max(0, Math.min(1, c.aperture / APERTURE_DIAL));
  return k > 0 ? [k * k * MAX_LENS_RATIO * c.focus, c.focus] : PINHOLE;
}

export function cameraAxes(c: Camera): { forward: Vec3; right: Vec3; up: Vec3 } {
  const yaw = c.yaw * DEG;
  const pitch = c.pitch * DEG;
  const bank = c.bank * DEG;
  const forward: Vec3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const flatRight: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const flatUp = cross(flatRight, forward);
  const right = add(scale(flatRight, Math.cos(bank)), scale(flatUp, Math.sin(bank)));
  const up = normalize(cross(right, forward));
  return { forward, right: normalize(right), up };
}

export function cameraBasis(c: Camera, aspect: number): ViewBasis {
  const axes = cameraAxes(c);
  return { origin: c.position, ...axes, ortho: false, halfHeight: Math.tan((c.fov * DEG) / 2), aspect, lens: lensOf(c) };
}

const ORTHO_AXES: Record<ViewKind.Top | ViewKind.Front | ViewKind.Side, { forward: Vec3; up: Vec3 }> = {
  [ViewKind.Top]: { forward: [0, -1, 0], up: [0, 0, -1] },
  [ViewKind.Front]: { forward: [0, 0, -1], up: [0, 1, 0] },
  [ViewKind.Side]: { forward: [-1, 0, 0], up: [0, 1, 0] },
};

export function orthoBasis(kind: ViewKind.Top | ViewKind.Front | ViewKind.Side, v: OrthoView, aspect: number): ViewBasis {
  const { forward, up } = ORTHO_AXES[kind];
  const right = cross(forward, up);
  return { origin: sub(v.center, scale(forward, ORTHO_DEPTH)), forward, right, up, ortho: true, halfHeight: v.span / 2, aspect, lens: PINHOLE };
}

export const pivotOf = (c: Camera): Vec3 => add(c.position, scale(cameraAxes(c).forward, c.focus));

/** Trackball: rotate the camera around its pivot. */
export function orbit(c: Camera, dYaw: number, dPitch: number): Camera {
  const pivot = pivotOf(c);
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + dPitch));
  const next = { ...c, yaw: c.yaw + dYaw, pitch };
  return { ...next, position: sub(pivot, scale(cameraAxes(next).forward, c.focus)) };
}

/** Turn in place (Bryce's camera rotation crosses). */
export function look(c: Camera, dYaw: number, dPitch: number, dBank = 0): Camera {
  return { ...c, yaw: c.yaw + dYaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + dPitch)), bank: c.bank + dBank };
}

/** Moves along the camera's own right / up / forward axes. */
export function translateLocal(c: Camera, dx: number, dy: number, dz: number): Camera {
  const { forward, right, up } = cameraAxes(c);
  const delta = add(add(scale(right, dx), scale(up, dy)), scale(forward, dz));
  return { ...c, position: add(c.position, delta) };
}

/** Moves on the ground plane, the Bryce XZ cross. */
export function translateFlat(c: Camera, dx: number, dz: number): Camera {
  const { forward, right } = cameraAxes(c);
  const f = normalize([forward[0], 0, forward[2]]);
  const r = normalize([right[0], 0, right[2]]);
  return { ...c, position: add(c.position, add(scale(r, dx), scale(f, dz))) };
}

/** Dolly toward the pivot; the pivot stays put. */
export function dolly(c: Camera, factor: number): Camera {
  const pivot = pivotOf(c);
  const focus = Math.max(MIN_FOCUS, c.focus * factor);
  return { ...c, focus, position: sub(pivot, scale(cameraAxes(c).forward, focus)) };
}

export function lookAt(c: Camera, target: Vec3): Camera {
  const d = sub(target, c.position);
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist === 0) return c;
  const yaw = Math.atan2(-d[0], -d[2]) / DEG;
  const pitch = Math.asin(d[1] / dist) / DEG;
  return { ...c, yaw, pitch, focus: dist };
}

/** Frames a bounding sphere: keeps the viewing direction, backs off until it fits. */
export function frameSphere(c: Camera, center: Vec3, radius: number): Camera {
  const dist = Math.max(MIN_FOCUS, radius / Math.sin((c.fov * DEG) / 2));
  const { forward } = cameraAxes(c);
  return { ...c, focus: dist, position: sub(center, scale(forward, dist)) };
}

/** Projects a world point to normalised device coords (-1..1, y up) and view depth. */
export function project(b: ViewBasis, p: Vec3): { x: number; y: number; depth: number } {
  const rel = sub(p, b.origin);
  const depth = dot(rel, b.forward);
  const rx = dot(rel, b.right);
  const ry = dot(rel, b.up);
  if (b.ortho) return { x: rx / (b.halfHeight * b.aspect), y: ry / b.halfHeight, depth };
  return { x: rx / (depth * b.halfHeight * b.aspect), y: ry / (depth * b.halfHeight), depth };
}

/** Ray through normalised device coords. */
export function rayAt(b: ViewBasis, x: number, y: number): { origin: Vec3; dir: Vec3 } {
  const sx = x * b.halfHeight * b.aspect;
  const sy = y * b.halfHeight;
  if (b.ortho) return { origin: add(add(b.origin, scale(b.right, sx)), scale(b.up, sy)), dir: b.forward };
  return { origin: b.origin, dir: normalize(add(add(b.forward, scale(b.right, sx)), scale(b.up, sy))) };
}
