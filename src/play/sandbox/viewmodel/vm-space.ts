import type { Vec3 } from '../../../core/vec3';
import type { Matrix3x4, SourceModel } from '../../../io/source/source.types';
import type { GunPose } from './vm-motion';

/**
 * Frames for the gun in the hands. Source models live in X forward, Y left,
 * Z up (inches); the GPU's view space is x right, y up, z toward the viewer.
 * The viewmodel sits at the eye, so its model space is the view turned by the
 * gun's pose. Source measures the viewmodel's field of view horizontally on a
 * 4:3 screen and keeps that vertical angle on wider screens.
 */

const DEG = Math.PI / 180;
const MAT34 = 12;
const MAT4 = 16;
/** Source's 4:3 reference screen for field-of-view numbers. */
const REFERENCE_ASPECT = 4 / 3;
/** Clip planes for the hands, in inches. */
export const VM_CLIP = { near: 1, far: 1024 } as const;

/** Source's AngleMatrix: columns forward, left, up for pitch (down positive), yaw, roll in degrees. */
export function angleMatrix(pitch: number, yaw: number, roll: number): number[] {
  const [sp, cp] = [Math.sin(pitch * DEG), Math.cos(pitch * DEG)];
  const [sy, cy] = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
  const [sr, cr] = [Math.sin(roll * DEG), Math.cos(roll * DEG)];
  // Row-major 3×3: rows are the x, y, z components of the forward, left and up columns.
  return [
    cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy,
    cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy,
    -sp, sr * cp, cr * cp,
  ];
}

/**
 * Column-major 4×4 from the gun's model space (Source axes, at the eye) to GPU
 * view space: the gun's turn, then its offset along forward/right/up, then the
 * swap of axes (x = −left, y = up, z = −forward).
 */
export function viewmodelMatrix(p: GunPose): Float32Array {
  const r = angleMatrix(p.pitch, p.yaw, p.roll);
  // Source position of the gun's origin: forward is +x, right is −y, up is +z.
  const t = [p.forward, -p.right, p.up];
  const out = new Float32Array(MAT4);
  // Source row i of the turned frame → GPU axis: gpuX = −srcY, gpuY = srcZ, gpuZ = −srcX.
  const rows = [[1, -1], [2, 1], [0, -1]] as const;
  rows.forEach(([src, sign], gpu) => {
    for (let c = 0; c < 3; c++) out[c * 4 + gpu] = sign * r[src * 3 + c];
    out[3 * 4 + gpu] = sign * t[src];
  });
  out[MAT4 - 1] = 1;
  return out;
}

/** Vertical field of view (degrees) for a Source viewmodel FOV number. */
export const vmVerticalFov = (sourceFov: number): number => (2 * Math.atan(Math.tan((sourceFov * DEG) / 2) / REFERENCE_ASPECT)) / DEG;

/** Column-major perspective projection; `fovY` in degrees. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovY * DEG) / 2);
  const out = new Float32Array(MAT4);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** A point of the viewmodel, in GPU view space, moved to where it shows with the world's field of view (Source's FormatViewModelAttachment). */
export function toWorldFov(p: Vec3, vmHalfTan: number, worldHalfTan: number): Vec3 {
  const k = vmHalfTan / worldHalfTan;
  return [p[0] * k, p[1] * k, p[2]];
}

/** Column-major 4×4 times a point. */
export function transform4(m: Float32Array, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** 3×4 (rows [r0 r1 r2 t]) times 3×4. */
export function mul34(a: Matrix3x4, b: Matrix3x4): Matrix3x4 {
  const out = new Float32Array(MAT34);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = c === 3 ? a[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) v += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = v;
    }
  }
  return out;
}

/** A 3×4 frame's origin. */
export const originOf = (m: Matrix3x4): Vec3 => [m[3], m[7], m[11]];

/**
 * Bone-merge: the arms take the pose of the gun's bones with the same names
 * (ValveBiped hands and fingers); bones the gun lacks follow their parent at rest.
 */
export function mergedBones(arms: SourceModel, gun: SourceModel, gunBones: readonly Matrix3x4[], armsRest: readonly Matrix3x4[]): Matrix3x4[] {
  const byName = new Map(gun.bones.map((b, i) => [b.name.toLowerCase(), i]));
  const out: Matrix3x4[] = [];
  arms.bones.forEach((b, i) => {
    const g = byName.get(b.name.toLowerCase());
    if (g !== undefined) out.push(gunBones[g]);
    else if (b.parent >= 0) out.push(mul34(out[b.parent], relativeRest(armsRest, i, b.parent)));
    else out.push(armsRest[i]);
  });
  return out;
}

/** A bone's rest frame relative to its parent's rest frame. */
function relativeRest(rest: readonly Matrix3x4[], bone: number, parent: number): Matrix3x4 {
  return mul34(invert34(rest[parent]), rest[bone]);
}

/** Inverse of a rigid 3×4 (rotation and translation). */
export function invert34(m: Matrix3x4): Matrix3x4 {
  const out = new Float32Array(MAT34);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 4 + c] = m[c * 4 + r];
  for (let r = 0; r < 3; r++) out[r * 4 + 3] = -(out[r * 4] * m[3] + out[r * 4 + 1] * m[7] + out[r * 4 + 2] * m[11]);
  return out;
}

/** Skinning matrices for the GPU: bone-to-model × pose-to-bone, packed 12 floats per bone. */
export function skinning(model: SourceModel, boneToModel: readonly Matrix3x4[]): Float32Array {
  const out = new Float32Array(model.bones.length * MAT34);
  model.bones.forEach((b, i) => out.set(mul34(boneToModel[i], b.poseToBone), i * MAT34));
  return out;
}
