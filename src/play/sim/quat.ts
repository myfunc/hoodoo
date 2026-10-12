import { identity } from '../../core/mat4';
import { type Vec3, add, cross, scale } from '../../core/vec3';
import { eulerOf } from '../../world/group-transform';

/** A unit quaternion [x, y, z, w]: how bodies turn in the physics layer. */
export type Quat = readonly [number, number, number, number];

export const IDENTITY_Q: Quat = [0, 0, 0, 1];
const DEG = Math.PI / 180;
const LINEAR_SLERP = 0.9995;

export function mulQ(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export const conjQ = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

const axisQ = (axis: 0 | 1 | 2, rad: number): Quat => {
  const s = Math.sin(rad / 2);
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(rad / 2)];
};

/** Euler degrees, X then Y then Z (core/mat4's rotationEuler), as a quaternion. */
export const quatOfEuler = (deg: Vec3): Quat => mulQ(axisQ(2, deg[2] * DEG), mulQ(axisQ(1, deg[1] * DEG), axisQ(0, deg[0] * DEG)));

/** The vector turned by q. */
export function rotateQ(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** Euler degrees of q, the answer nearest `hint` (so a tumbling body's keys turn the short way). */
export function eulerOfQuat(q: Quat, hint: Vec3): Vec3 {
  const [x, y, z] = [rotateQ(q, [1, 0, 0]), rotateQ(q, [0, 1, 0]), rotateQ(q, [0, 0, 1])];
  const m = identity();
  m.set([...x, 0, ...y, 0, ...z, 0], 0);
  return eulerOf(m, hint);
}

/** Spherical interpolation, the short way round. */
export function slerpQ(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > LINEAR_SLERP) {
    const q = a.map((c, i) => c + (b[i] * s - c) * t);
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  const th = Math.acos(d);
  const k0 = Math.sin((1 - t) * th) / Math.sin(th);
  const k1 = (Math.sin(t * th) / Math.sin(th)) * s;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
}

/** Whether two quaternions turn the same, within `eps`. */
export const sameQ = (a: Quat, b: Quat, eps: number): boolean => Math.abs(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) - 1) < eps;
