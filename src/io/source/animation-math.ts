import { lerp3 } from '../../core/vec3';
import type { Vec3 } from '../../core/vec3';
import type { BonePose, Matrix3x4 } from './source.types';

type Quaternion = BonePose['quat'];
const SLERP_NEAR = 0.9995;
const MATRIX_SIZE = 12;

/** READ ME — Source RadianEuler is roll, pitch, yaw around X, Y, Z. */
export function eulerQuaternion(euler: Vec3): Quaternion {
  const [roll, pitch, yaw] = euler.map(angle => angle * 0.5);
  const sr = Math.sin(roll), cr = Math.cos(roll), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
}

export function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
}

export function slerp(a: Quaternion, b: Quaternion, amount: number): Quaternion {
  let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  let left = 1 - amount, right = amount;
  if (dot < SLERP_NEAR) {
    const angle = Math.acos(dot), denominator = Math.sin(angle);
    left = Math.sin((1 - amount) * angle) / denominator;
    right = Math.sin(amount * angle) / denominator;
  }
  const q = a.map((value, i) => value * left + b[i] * right * sign);
  const length = Math.hypot(...q) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function blendPose(a: BonePose, b: BonePose, amount: number): BonePose {
  return { position: lerp3(a.position, b.position, amount), quat: slerp(a.quat, b.quat, amount) };
}

export function poseMatrix(pose: BonePose): Matrix3x4 {
  const [x, y, z, w] = pose.quat, [px, py, pz] = pose.position;
  return new Float32Array([
    1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w), px,
    2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w), py,
    2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y), pz,
  ]);
}

export function multiplyMatrix(a: Matrix3x4, b: Matrix3x4): Matrix3x4 {
  const out = new Float32Array(MATRIX_SIZE);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const at = row * 4;
    out[at + col] = a[at] * b[col] + a[at + 1] * b[4 + col] + a[at + 2] * b[2 * 4 + col];
    if (col === 3) out[at + col] += a[at + 3];
  }
  return out;
}
