import { blendPose, multiplyMatrix, poseMatrix } from './animation-math';
import { sequenceBlends } from './mdl.types';
import type { BonePose, Matrix3x4, SourceModel, SourceSequence } from './source.types';

const MATRIX_SIZE = 12;

function blendCoordinate(model: SourceModel, sequence: SourceSequence, axis: number, values: Readonly<Record<number, number>>): number {
  const parameter = model.poseParameters[sequence.blendParams[axis]];
  if (!parameter || sequence.blendSize[axis] <= 1) return 0;
  const bounds = sequenceBlends.get(sequence);
  const start = bounds?.start[axis] ?? parameter.start, end = bounds?.end[axis] ?? parameter.end;
  let value = values[sequence.blendParams[axis]] ?? parameter.start;
  if (parameter.loop > 0) {
    const center = (parameter.start + parameter.end) * 0.5;
    const low = center - parameter.loop * 0.5;
    value -= parameter.loop * Math.floor((value - low) / parameter.loop);
  }
  const fraction = end === start ? 0 : (value - start) / (end - start);
  return Math.max(0, Math.min(1, fraction)) * (sequence.blendSize[axis] - 1);
}

/** READ ME — cycle is normalized; pose values use each parameter's native units. */
export function sequencePose(model: SourceModel, sequenceIndex: number, cycle: number, poseParameterValues: Readonly<Record<number, number>> = {}): BonePose[] {
  const sequence = model.sequences[sequenceIndex];
  if (!sequence) return model.bones.map(bone => ({ position: bone.position, quat: bone.quat }));
  const finiteCycle = Number.isFinite(cycle) ? cycle : 0;
  const time = sequence.looping ? finiteCycle - Math.floor(finiteCycle) : Math.max(0, Math.min(1, finiteCycle));
  const frame = time * Math.max(0, sequence.frames - 1);
  const x = blendCoordinate(model, sequence, 0, poseParameterValues);
  const y = blendCoordinate(model, sequence, 1, poseParameterValues);
  const left = Math.floor(x), bottom = Math.floor(y);
  const right = Math.min(left + 1, sequence.blendSize[0] - 1), top = Math.min(bottom + 1, sequence.blendSize[1] - 1);
  const pose = (column: number, row: number) => model.animationPose(sequence.animations[row * sequence.blendSize[0] + column], frame);
  const a = pose(left, bottom);
  if (left === right && bottom === top) return a;
  const b = left === right ? a : pose(right, bottom);
  if (bottom === top) return a.map((bone, index) => blendPose(bone, b[index], x - left));
  const c = pose(left, top), d = left === right ? c : pose(right, top);
  return a.map((bone, index) => blendPose(blendPose(bone, b[index], x - left), blendPose(c[index], d[index], x - left), y - bottom));
}

/** READ ME — parents may appear after children; cycles are rejected. */
export function boneToModel(model: SourceModel, poses: readonly BonePose[]): Matrix3x4[] {
  const matrices: Matrix3x4[] = new Array(model.bones.length);
  const visiting = new Set<number>();
  const resolve = (index: number): Matrix3x4 => {
    if (matrices[index]) return matrices[index];
    if (visiting.has(index)) throw new Error('Cyclic Source bone hierarchy');
    const bone = model.bones[index];
    if (!bone) throw new Error('Invalid Source bone parent');
    visiting.add(index);
    const local = poseMatrix(poses[index] ?? bone);
    const result = bone.parent < 0 ? local : multiplyMatrix(resolve(bone.parent), local);
    visiting.delete(index); matrices[index] = result;
    return result;
  };
  return model.bones.map((_, index) => resolve(index));
}

/** READ ME — packed row-major frames convert rest-model positions into posed-model positions. */
export function skinMatrices(model: SourceModel, frames: readonly Matrix3x4[]): Float32Array {
  if (frames.length !== model.bones.length) throw new Error('Source skin matrix count mismatch');
  const result = new Float32Array(frames.length * MATRIX_SIZE);
  frames.forEach((frame, index) => result.set(multiplyMatrix(frame, model.bones[index].poseToBone), index * MATRIX_SIZE));
  return result;
}

export function findSequence(model: SourceModel, nameOrActivity: string): number {
  const query = nameOrActivity.toLowerCase();
  return model.sequences.findIndex(sequence => sequence.name.toLowerCase() === query || sequence.activity.toLowerCase() === query);
}

/** READ ME — attachments use their owning bone's current frame. */
export function attachmentFrame(model: SourceModel, nameOrIndex: string | number, frames: readonly Matrix3x4[]): Matrix3x4 | null {
  const attachment = typeof nameOrIndex === 'number' ? model.attachments[nameOrIndex]
    : model.attachments.find(item => item.name.toLowerCase() === nameOrIndex.toLowerCase());
  const bone = attachment && frames[attachment.bone];
  return attachment && bone ? multiplyMatrix(bone, attachment.local) : null;
}
