import { type Mat4, compose, multiply, rotationEuler, transformDir } from '../core/mat4';
import { type Vec3, add, length, mul, sub } from '../core/vec3';
import type { Transform } from '../model/scene.types';

/**
 * READ ME — transforms inside groups. A group carries a pivot inside its parent:
 * position, rotation and `size` read as a scale factor. A member's world pose is
 * the group's world pose composed with its own pose inside the group (local).
 * Rotations compose exactly. A primitive cannot shear, so a turned member of an
 * unevenly stretched group keeps its shape and takes the stretch measured along
 * its own axes; uniform scale (what the tools make) is exact.
 */

export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] };

const RAD = 180 / Math.PI;
const FULL_TURN = 360;
const HALF_TURN = 180;
/** Below this cos(Y) the X and Z turns act about one axis (gimbal lock). */
const GIMBAL = 1e-9;
/** Two transforms closer than this in every number are the same pose. */
const SAME_EPS = 1e-9;
/** A matrix whose axes lean on each other more than this is sheared: no transform reaches it. */
const SHEAR_EPS = 1e-6;

const isZero = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;
const isUniform = (v: Vec3): boolean => v[0] === v[1] && v[1] === v[2];
const near = (a: Vec3, b: Vec3, eps: number): boolean => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;

export const isIdentity = (t: Transform): boolean => isZero(t.position) && isZero(t.rotation) && t.size[0] === 1 && t.size[1] === 1 && t.size[2] === 1;

export function sameTransform(a: Transform, b: Transform, eps = SAME_EPS): boolean {
  return a === b || (near(a.position, b.position, eps) && near(a.rotation, b.rotation, eps) && near(a.size, b.size, eps));
}

export const matrixOf = (t: Transform): Mat4 => compose(t.position, t.rotation, t.size);

function transposed(m: Mat4): Mat4 {
  const out = new Float64Array(m);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = m[r * 4 + c];
  out[12] = out[13] = out[14] = 0;
  return out;
}

const column = (m: Mat4, c: number): Vec3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];

/** `a` plus whole turns, as close to `hint` as it gets. */
const wrapNear = (a: number, hint: number): number => a + FULL_TURN * Math.round((hint - a) / FULL_TURN);

/**
 * Euler degrees (X then Y then Z, as rotationEuler) of the rotation part of `m`;
 * of the two equal answers, the one nearest `hint`, so keys keep turning the short way.
 */
export function eulerOf(m: Mat4, hint: Vec3): Vec3 {
  const r = (row: number, col: number) => m[col * 4 + row];
  const y = Math.asin(Math.max(-1, Math.min(1, -r(2, 0))));
  const candidates: Vec3[] = Math.abs(Math.cos(y)) < GIMBAL
    ? [[0, y * RAD, Math.atan2(-r(0, 1), r(1, 1)) * RAD]]
    : (() => {
      const x = Math.atan2(r(2, 1), r(2, 2)) * RAD;
      const z = Math.atan2(r(1, 0), r(0, 0)) * RAD;
      return [[x, y * RAD, z], [x + HALF_TURN, HALF_TURN - y * RAD, z + HALF_TURN]];
    })();
  let best: Vec3 = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const w: Vec3 = [wrapNear(c[0], hint[0]), wrapNear(c[1], hint[1]), wrapNear(c[2], hint[2])];
    const d = Math.abs(w[0] - hint[0]) + Math.abs(w[1] - hint[1]) + Math.abs(w[2] - hint[2]);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

/** How much a group's scale stretches a member's axis `i`, the member turned by `turn`. */
const stretch = (scale: Vec3, turn: Mat4, i: number): number => length(mul(scale, column(turn, i)));

/** A point of the parent's space placed in the world through `frame`. */
export const framePoint = (frame: Transform, p: Vec3): Vec3 => add(frame.position, transformDir(rotationEuler(frame.rotation), mul(frame.size, p)));

/** A world direction (a drag) read in the space of `frame`. */
export function frameDelta(frame: Transform, v: Vec3): Vec3 {
  const d = transformDir(transposed(rotationEuler(frame.rotation)), v);
  return [d[0] / frame.size[0], d[1] / frame.size[1], d[2] / frame.size[2]];
}

/** The world pose of `child`, posed inside `parent`. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  const turn = rotationEuler(child.rotation);
  const position = framePoint(parent, child.position);
  const rotation = isZero(parent.rotation) ? child.rotation : eulerOf(multiply(rotationEuler(parent.rotation), turn), add(parent.rotation, child.rotation));
  const size: Vec3 = isUniform(parent.size)
    ? [child.size[0] * parent.size[0], child.size[1] * parent.size[0], child.size[2] * parent.size[0]]
    : [0, 1, 2].map((i) => child.size[i] * stretch(parent.size, turn, i)) as unknown as Vec3;
  return { position, rotation, size };
}

/**
 * The pose inside `parent` that composes back to `world`: the inverse of
 * composeTransforms. `prior` (the same thing before an edit) keeps the parts
 * the edit did not change exactly as they were.
 */
export function relativeTransform(parent: Transform, world: Transform, prior?: { readonly world: Transform; readonly local: Transform }): Transform {
  const back = transposed(rotationEuler(parent.rotation));
  const position = frameDelta(parent, sub(world.position, parent.position));
  const keepTurn = prior && near(prior.world.rotation, world.rotation, SAME_EPS);
  const hint = prior?.local.rotation ?? sub(world.rotation, parent.rotation);
  const rotation = keepTurn ? prior.local.rotation : isZero(parent.rotation) ? world.rotation : eulerOf(multiply(back, rotationEuler(world.rotation)), hint);
  if (keepTurn && near(prior.world.size, world.size, SAME_EPS)) return { position, rotation, size: prior.local.size };
  const turn = rotationEuler(rotation);
  const size: Vec3 = isUniform(parent.size)
    ? [world.size[0] / parent.size[0], world.size[1] / parent.size[0], world.size[2] / parent.size[0]]
    : [0, 1, 2].map((i) => world.size[i] / stretch(parent.size, turn, i)) as unknown as Vec3;
  return { position, rotation, size };
}

/** `t` in the world through `frame` (null: the world itself). */
export const inFrame = (frame: Transform | null, t: Transform): Transform => (frame ? composeTransforms(frame, t) : t);

/** `world` read inside `frame` (null: the world itself). */
export const fromFrame = (frame: Transform | null, world: Transform, prior?: { readonly world: Transform; readonly local: Transform }): Transform =>
  (frame ? relativeTransform(frame, world, prior) : world);

/** A transform with the given matrix, or null when the matrix is sheared or mirrored. */
export function transformOfMatrix(m: Mat4, hint: Vec3): Transform | null {
  const axes = [column(m, 0), column(m, 1), column(m, 2)];
  const size = axes.map(length) as unknown as Vec3;
  if (size.some((s) => s < SHEAR_EPS)) return null;
  const unit = axes.map((a, i) => a.map((v) => v / size[i]) as unknown as Vec3);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(unit[i][0] * unit[j][0] + unit[i][1] * unit[j][1] + unit[i][2] * unit[j][2]) > SHEAR_EPS) return null;
  }
  const turn = new Float64Array(m);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) turn[c * 4 + r] = unit[c][r];
  const [a, b, c] = unit;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (det < 0) return null;
  return { position: [m[12], m[13], m[14]], rotation: eulerOf(turn, hint), size };
}
