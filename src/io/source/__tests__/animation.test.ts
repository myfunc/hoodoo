import { describe, expect, it } from 'vitest';
import { BinaryReader } from '../binary';
import { animationValue, decodeAnimation, halfFloat, quaternion48, quaternion64 } from '../mdl-animation';
import { attachmentFrame, boneToModel, findSequence, sequencePose, skinMatrices } from '../animation';
import { eulerQuaternion, multiplyMatrix, poseMatrix, slerp } from '../animation-math';
import { sequenceBlends } from '../mdl.types';
import type { StudioAnimation, StudioBone } from '../mdl.types';
import type { BonePose, SourceModel, SourceSequence } from '../source.types';

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
function bone(name = 'root', parent = -1): StudioBone {
  return { name, parent, flags: 0, position: [1, 2, 3], quat: [0, 0, 0, 1],
    rotation: [0, 0, 0], positionScale: [0.5, 0.5, 0.5], rotationScale: [0.01, 0.01, 0.01], poseToBone: identity() };
}
function animation(overrides: Partial<StudioAnimation> = {}): StudioAnimation {
  return { name: 'test', offset: 0, fps: 30, frames: 6, flags: 0, block: 0, data: 100, sectionOffset: 0, sectionFrames: 0, ...overrides };
}
function bytes(size = 512) { const data = new Uint8Array(size); return { data, view: new DataView(data.buffer), reader: new BinaryReader(data) }; }
function run(data: Uint8Array, view: DataView, at: number, valid: number, total: number, values: number[]) {
  data[at] = valid; data[at + 1] = total;
  values.forEach((value, i) => view.setInt16(at + (i + 1) * 2, value, true));
}
function packQuaternion64(view: DataView, at: number, quat: BonePose['quat']) {
  let packed = quat[3] < 0 ? 1n << 63n : 0n;
  for (let axis = 0; axis < 3; axis++) packed |= BigInt(Math.round(quat[axis] * 1048576.5 + 1048576)) << BigInt(axis * 21);
  view.setBigUint64(at, packed, true);
}
function model(sequences: SourceSequence[] = [], bones: StudioBone[] = [bone()]): SourceModel {
  return { name: 'test', bones, attachments: [{ name: 'muzzle', bone: 0, local: identity() }],
    textures: [], skins: [], meshes: [], poseParameters: [], sequences, animationCount: 1,
    animationPose: () => bones.map(bone => ({ position: bone.position, quat: bone.quat })) };
}
function sequence(overrides: Partial<SourceSequence> = {}): SourceSequence {
  return { name: 'idle', activity: 'ACT_VM_IDLE', frames: 11, fps: 30, looping: false,
    blendParams: [-1, -1], blendSize: [1, 1], animations: [0], events: [], ...overrides };
}

describe('Source animation decoding', () => {
  it('decodes half floats, Quaternion48 and Quaternion64 with the sign of w', () => {
    expect(halfFloat(0x3c00)).toBe(1); expect(halfFloat(0xc000)).toBe(-2);
    expect(halfFloat(1)).toBe(2 ** -24); expect(halfFloat(0x7c00)).toBe(Infinity);
    const { view, reader } = bytes();
    view.setUint16(0, 32768 + 16384, true); view.setUint16(2, 32768, true); view.setUint16(4, 16384 | 32768, true);
    expect(quaternion48(reader, 0)).toEqual([0.5, 0, 0, -Math.sqrt(0.75)]);
    packQuaternion64(view, 8, [0.25, -0.5, 0, -Math.sqrt(0.6875)]);
    const q = quaternion64(reader, 8);
    expect(q[0]).toBeCloseTo(0.25, 5); expect(q[1]).toBeCloseTo(-0.5, 5); expect(q[3]).toBeLessThan(0);
  });

  it('reads valid/total runs, holds values and interpolates across run boundaries', () => {
    const { data, view, reader } = bytes();
    data[100] = 0; data[101] = 4; view.setInt16(104, 6, true);
    run(data, view, 110, 2, 4, [10, 20]); run(data, view, 116, 1, 2, [30]);
    expect(animationValue(reader, 110, 2)).toBe(20);
    expect(animationValue(reader, 110, 4)).toBe(30);
    expect(decodeAnimation(reader, [bone(), bone('other')], animation(), 3.5)[0].position).toEqual([13.5, 2, 3]);
    expect(decodeAnimation(reader, [bone(), bone('other')], animation(), 3.5)[1].position).toEqual([1, 2, 3]);
    expect(() => animationValue(reader, 120, 0)).toThrow('run');
  });

  it('reads rotation before position and applies scale plus rest Euler angles', () => {
    const { data, view, reader } = bytes();
    data[100] = 0; data[101] = 12;
    view.setInt16(104, 12, true); view.setInt16(110, 10, true);
    run(data, view, 116, 1, 6, [50]); run(data, view, 120, 1, 6, [8]);
    const rest = { ...bone(), rotation: [0.2, 0, 0] as const };
    const pose = decodeAnimation(reader, [rest], animation(), 0)[0];
    expect(pose.position).toEqual([5, 2, 3]);
    expect(pose.quat[0]).toBeCloseTo(Math.sin(0.7 / 2));
  });

  it.each([2, 32])('reads raw rotation flag %i before raw Vector48 positions', flag => {
    const { data, view, reader } = bytes();
    data[100] = 0; data[101] = flag | 1;
    let at = 104;
    if (flag === 2) {
      view.setUint16(at, 32768, true); view.setUint16(at + 2, 32768, true); view.setUint16(at + 4, 16384, true); at += 6;
    } else { packQuaternion64(view, at, [0, 0, 0, 1]); at += 8; }
    view.setUint16(at, 0x3c00, true); view.setUint16(at + 2, 0x4000, true); view.setUint16(at + 4, 0x4200, true);
    const pose = decodeAnimation(reader, [bone()], animation(), 0)[0];
    expect(pose.position).toEqual([1, 2, 3]); expect(pose.quat).toEqual([0, 0, 0, 1]);
  });

  it('composes delta transforms with rest and treats the empty-chain sentinel as rest', () => {
    const { data, view, reader } = bytes();
    data[100] = 0; data[101] = 1 | 16;
    view.setUint16(104, 0x4000, true);
    const pose = decodeAnimation(reader, [bone()], animation(), 0)[0];
    expect(pose.position).toEqual([3, 2, 3]); expect(pose.quat).toEqual([0, 0, 0, 1]);
    data[100] = 255; data[101] = 0;
    expect(decodeAnimation(reader, [bone()], animation(), 0)[0].position).toEqual([1, 2, 3]);
  });

  it('interpolates section boundaries and uses the separate terminal frame', () => {
    const { data, view, reader } = bytes();
    for (const [index, at] of [100, 140, 180, 220].entries()) {
      view.setInt32(40 + index * 8 + 4, at, true); data[at + 1] = 1;
      view.setUint16(at + 4, [0x0000, 0x4000, 0x4400, 0x4800][index], true);
    }
    const desc = animation({ frames: 5, sectionOffset: 40, sectionFrames: 2 });
    expect(decodeAnimation(reader, [bone()], desc, 1.5)[0].position[0]).toBe(1);
    expect(decodeAnimation(reader, [bone()], desc, 2)[0].position[0]).toBe(2);
    expect(decodeAnimation(reader, [bone()], desc, 4)[0].position[0]).toBe(8);
    view.setInt32(48, 1, true);
    expect(decodeAnimation(reader, [bone()], desc, 2)[0].position).toEqual([1, 2, 3]);
  });

  it('returns rest for external blocks and rejects invalid chains', () => {
    const { data, view, reader } = bytes();
    expect(decodeAnimation(reader, [bone()], animation({ block: 1 }), 0)[0].position).toEqual([1, 2, 3]);
    data[100] = 10;
    expect(() => decodeAnimation(reader, [bone()], animation(), 0)).toThrow('bone');
    data[100] = 0; view.setInt16(102, -4, true);
    expect(() => decodeAnimation(reader, [bone()], animation(), 0)).toThrow('next');
  });
});

describe('Source posing helpers', () => {
  it('bilinearly blends native parameter units through sequence-specific ranges', () => {
    const seq = sequence({ blendParams: [0, 1], blendSize: [2, 2], animations: [0, 1, 2, 3] });
    sequenceBlends.set(seq, { start: [-10, 50], end: [10, 100] });
    const base = model([seq]);
    const sampled: number[] = [];
    const blended: SourceModel = { ...base, animationCount: 4,
      poseParameters: [{ name: 'x', start: -20, end: 20, loop: 0 }, { name: 'y', start: 0, end: 100, loop: 0 }],
      animationPose: (index, frame) => { sampled.push(frame); return [{ position: [index * 10, 0, 0], quat: eulerQuaternion([0, 0, index % 2 * Math.PI / 2]) }]; },
    };
    const pose = sequencePose(blended, 0, 0.25, { 0: 0, 1: 75 })[0];
    expect(pose.position).toEqual([15, 0, 0]); expect(sampled).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(pose.quat[2]).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(sequencePose(blended, 0, 0, { 0: -99, 1: 50 })[0].position[0]).toBe(0);
    expect(sequencePose(blended, 0, 0, { 0: 99, 1: 100 })[0].position[0]).toBe(30);
  });

  it('wraps looping cycles and parameters, clamps nonlooping cycles, finds activities', () => {
    const seq = sequence({ looping: true, blendParams: [0, -1], blendSize: [2, 1], animations: [0, 1] });
    const sampled: number[] = [];
    const base: SourceModel = { ...model([seq]), poseParameters: [{ name: 'yaw', start: -180, end: 180, loop: 360 }],
      animationPose: (index, frame) => { sampled.push(frame); return [{ position: [index, 0, 0], quat: [0, 0, 0, 1] }]; } };
    expect(sequencePose(base, 0, -0.25, { 0: 360 })[0].position[0]).toBe(0.5);
    expect(sampled[0]).toBe(7.5); expect(findSequence(base, 'act_vm_idle')).toBe(0);
    expect(findSequence(base, 'IDLE')).toBe(0); expect(findSequence(base, 'missing')).toBe(-1);
    const nonloop = { ...base, sequences: [sequence()] };
    sampled.length = 0; sequencePose(nonloop, 0, 2); expect(sampled[0]).toBe(10);
    expect(sequencePose(base, -1, 0)[0].position).toEqual([1, 2, 3]);
  });

  it('uses shortest-arc quaternion slerp', () => {
    expect(slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.5)).toEqual([0, 0, 0, 1]);
    const q = slerp([0, 0, 0, 1], [0, 0, 1, 0], 0.5);
    expect(q[2]).toBeCloseTo(Math.SQRT1_2); expect(q[3]).toBeCloseTo(Math.SQRT1_2);
  });

  it('chains parent times child even out of order and cancels rest bind matrices', () => {
    const root = { ...bone('root'), position: [10, 0, 0] as const, quat: eulerQuaternion([0, 0, Math.PI / 2]) };
    const child = { ...bone('child', 1), position: [2, 0, 0] as const };
    const base = model([], [child, root]);
    const frames = boneToModel(base, base.bones);
    expect(frames[0][3]).toBeCloseTo(10); expect(frames[0][7]).toBeCloseTo(2);
    const inverse = new Float32Array([0, 1, 0, -2, -1, 0, 0, 10, 0, 0, 1, 0]);
    const bound = { ...base, bones: [{ ...child, poseToBone: inverse }, root] };
    const skin = skinMatrices(bound, frames);
    Array.from(skin.slice(0, 12)).forEach((value, index) => expect(value).toBeCloseTo(identity()[index]));
    const attachment = attachmentFrame(base, 'MUZZLE', frames)!;
    expect(attachment[7]).toBeCloseTo(2); expect(attachmentFrame(base, 'none', frames)).toBeNull();
    expect(() => boneToModel(model([], [{ ...child, parent: 0 }]), [child])).toThrow('Cyclic');
    expect(() => skinMatrices(base, [])).toThrow('count');
  });

  it('keeps Source row-major translation during matrix composition', () => {
    const a = poseMatrix({ position: [1, 2, 3], quat: [0, 0, 0, 1] });
    const b = poseMatrix({ position: [4, 5, 6], quat: [0, 0, 0, 1] });
    const c = multiplyMatrix(a, b);
    expect([c[3], c[7], c[11]]).toEqual([5, 7, 9]);
  });
});
