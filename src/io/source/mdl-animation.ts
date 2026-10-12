import { BinaryReader } from './binary';
import { requireRange } from './mdl-header';
import { blendPose, eulerQuaternion, multiplyQuaternion } from './animation-math';
import type { StudioAnimation, StudioBone } from './mdl.types';
import type { BonePose } from './source.types';
import type { Vec3 } from '../../core/vec3';

const FLAGS = { rawPos: 0x01, rawRot: 0x02, animPos: 0x04, animRot: 0x08, delta: 0x10, rawRot2: 0x20, frameAnimation: 0x40, endBone: 255 } as const;
const DATA = { header: 4, flags: 1, next: 2, valuePtrSize: 6, halfSize: 2, quat48Size: 6, quat64Size: 8, sectionSize: 8, block: 0, index: 4 } as const;
const HALF = { sign: 0x8000, exponentMask: 0x1f, mantissaMask: 0x3ff, exponentShift: 10, bias: 15, subnormalPower: -14, special: 31, divisor: 1024 } as const;
const QUAT = { xyBias: 32768, zBias: 16384, zMask: 32767, sign48: 32768, bits: 21, mask: 2097151n, bias: 1048576, divisor: 1048576.5, signShift: 63n, byteBits: 8n } as const;

export function halfFloat(value: number): number {
  const sign = (value & HALF.sign) ? -1 : 1;
  const exponent = (value >> HALF.exponentShift) & HALF.exponentMask;
  const mantissa = (value & HALF.mantissaMask) / HALF.divisor;
  if (exponent === 0) return sign * mantissa * 2 ** HALF.subnormalPower;
  if (exponent === HALF.special) return mantissa === 0 ? sign * Infinity : NaN;
  return sign * (1 + mantissa) * 2 ** (exponent - HALF.bias);
}

export function quaternion48(reader: BinaryReader, at: number): BonePose['quat'] {
  requireRange(reader, at, DATA.quat48Size);
  const packedZ = reader.u16(at + 4);
  const x = (reader.u16(at) - QUAT.xyBias) / QUAT.xyBias;
  const y = (reader.u16(at + 2) - QUAT.xyBias) / QUAT.xyBias;
  const z = ((packedZ & QUAT.zMask) - QUAT.zBias) / QUAT.zBias;
  const w = Math.sqrt(Math.max(0, 1 - x*x - y*y - z*z));
  return [x, y, z, packedZ & QUAT.sign48 ? -w : w];
}

export function quaternion64(reader: BinaryReader, at: number): BonePose['quat'] {
  requireRange(reader, at, DATA.quat64Size);
  let packed = 0n;
  for (let i = 0; i < DATA.quat64Size; i++) packed |= BigInt(reader.u8(at + i)) << (BigInt(i) * QUAT.byteBits);
  const components = [0, 1, 2].map(axis => (Number((packed >> BigInt(axis * QUAT.bits)) & QUAT.mask) - QUAT.bias) / QUAT.divisor);
  const [x, y, z] = components, w = Math.sqrt(Math.max(0, 1 - x*x - y*y - z*z));
  return [x, y, z, packed >> QUAT.signShift ? -w : w];
}

/** READ ME — RLE headers are valid/total bytes; held frames repeat the last sample. */
export function animationValue(reader: BinaryReader, at: number, frame: number): number {
  let remaining = frame;
  while (true) {
    requireRange(reader, at, DATA.halfSize);
    const valid = reader.u8(at), total = reader.u8(at + 1);
    if (total === 0 || valid === 0 || valid > total) throw new Error('Invalid MDL animation run');
    requireRange(reader, at + DATA.halfSize, valid * DATA.halfSize);
    if (remaining < total) return reader.i16(at + (1 + Math.min(remaining, valid - 1)) * DATA.halfSize);
    remaining -= total;
    at += (valid + 1) * DATA.halfSize;
  }
}

function animatedVector(reader: BinaryReader, at: number, frame: number, base: Vec3, scale: Vec3): Vec3 {
  requireRange(reader, at, DATA.valuePtrSize);
  const values = [0, 1, 2].map(axis => {
    const offset = reader.i16(at + axis * DATA.halfSize);
    return base[axis] + (offset ? animationValue(reader, at + offset, frame) * scale[axis] : 0);
  });
  return [values[0], values[1], values[2]];
}

function animationLocation(reader: BinaryReader, animation: StudioAnimation, frame: number): { at: number; frame: number; unsupported: boolean } {
  let block = animation.block, index = animation.data, localFrame = frame;
  if (animation.sectionFrames > 0) {
    // The final frame lives in the extra terminal section, as in studio.cpp.
    let section = Math.floor(frame / animation.sectionFrames);
    localFrame = frame - section * animation.sectionFrames;
    if (animation.frames > animation.sectionFrames && frame === animation.frames - 1) {
      section = Math.floor(animation.frames / animation.sectionFrames) + 1;
      localFrame = 0;
    }
    const at = animation.offset + animation.sectionOffset + section * DATA.sectionSize;
    requireRange(reader, at, DATA.sectionSize);
    block = reader.i32(at + DATA.block); index = reader.i32(at + DATA.index);
  }
  return { at: index ? animation.offset + index : 0, frame: localFrame,
    unsupported: block > 0 || (animation.flags & FLAGS.frameAnimation) !== 0 };
}

function integerPose(reader: BinaryReader, bones: readonly StudioBone[], animation: StudioAnimation, frame: number): BonePose[] {
  const poses: BonePose[] = bones.map(bone => ({ position: bone.position, quat: bone.quat }));
  const location = animationLocation(reader, animation, frame);
  if (location.unsupported || location.at === 0) return poses;
  let at = location.at;
  const visited = new Set<number>();
  while (at !== 0) {
    if (visited.has(at)) throw new Error('Cyclic MDL animation chain');
    visited.add(at);
    requireRange(reader, at, DATA.header);
    const boneIndex = reader.u8(at), bone = bones[boneIndex], flags = reader.u8(at + DATA.flags);
    if (boneIndex === FLAGS.endBone) break;
    if (!bone) throw new Error('Invalid MDL animation bone');
    const delta = (flags & FLAGS.delta) !== 0;
    let cursor = at + DATA.header;
    let quat: BonePose['quat'] = delta ? [0, 0, 0, 1] : bone.quat;
    let position: Vec3 = delta ? [0, 0, 0] : bone.position;
    if (flags & FLAGS.rawRot2) { quat = quaternion64(reader, cursor); cursor += DATA.quat64Size; }
    else if (flags & FLAGS.rawRot) { quat = quaternion48(reader, cursor); cursor += DATA.quat48Size; }
    else if (flags & FLAGS.animRot) {
      quat = eulerQuaternion(animatedVector(reader, cursor, location.frame, delta ? [0, 0, 0] : bone.rotation, bone.rotationScale));
      cursor += DATA.valuePtrSize;
    }
    if (flags & FLAGS.rawPos) {
      requireRange(reader, cursor, DATA.valuePtrSize);
      position = [halfFloat(reader.u16(cursor)), halfFloat(reader.u16(cursor + 2)), halfFloat(reader.u16(cursor + 4))];
    } else if (flags & FLAGS.animPos) position = animatedVector(reader, cursor, location.frame, delta ? [0, 0, 0] : bone.position, bone.positionScale);
    if (delta) {
      position = [position[0] + bone.position[0], position[1] + bone.position[1], position[2] + bone.position[2]];
      quat = multiplyQuaternion(bone.quat, quat);
    }
    poses[boneIndex] = { position, quat };
    const next = reader.i16(at + DATA.next);
    if (next < 0) throw new Error('Invalid MDL animation next offset');
    at = next ? at + next : 0;
  }
  return poses;
}

/** READ ME — local sections decode at integer frames, then positions and turns interpolate. */
export function decodeAnimation(reader: BinaryReader, bones: readonly StudioBone[], animation: StudioAnimation, frame: number): BonePose[] {
  const clamped = Math.max(0, Math.min(animation.frames - 1, Number.isFinite(frame) ? frame : 0));
  const first = Math.floor(clamped), amount = clamped - first;
  const a = integerPose(reader, bones, animation, first);
  if (amount === 0) return a;
  const b = integerPose(reader, bones, animation, Math.min(animation.frames - 1, first + 1));
  return a.map((pose, i) => blendPose(pose, b[i], amount));
}

export function unsupportedAnimations(reader: BinaryReader, animations: readonly StudioAnimation[]): string[] {
  return animations.filter(animation => {
    if (animation.block > 0 || (animation.flags & FLAGS.frameAnimation) !== 0) return true;
    if (animation.sectionFrames <= 0) return false;
    const sections = Math.floor(animation.frames / animation.sectionFrames) + 2;
    requireRange(reader, animation.offset + animation.sectionOffset, sections * DATA.sectionSize);
    for (let i = 0; i < sections; i++) if (reader.i32(animation.offset + animation.sectionOffset + i * DATA.sectionSize) > 0) return true;
    return false;
  }).map(animation => animation.name);
}
