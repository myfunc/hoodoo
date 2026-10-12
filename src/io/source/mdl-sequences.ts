import { BinaryReader } from './binary';
import { STUDIO, relativeString, requireRange, table } from './mdl-header';
import { sequenceBlends } from './mdl.types';
import type { StudioAnimation } from './mdl.types';
import type { SourcePoseParameter, SourceSequence } from './source.types';

const ANIM = { name: 4, fps: 8, flags: 12, frames: 16, block: 52, data: 56, sections: 80, sectionFrames: 84 } as const;
const SEQ = {
  name: 4, activity: 8, flags: 12, events: 24, animationIndex: 60,
  sizeX: 68, sizeY: 72, paramX: 76, paramY: 80, startX: 84,
  startY: 88, endX: 92, endY: 96, looping: 1,
} as const;
const POSE = { start: 8, end: 12, loop: 16 } as const;
const EVENT = { cycle: 0, id: 4, options: 12, optionsSize: 64 } as const;

/** READ ME — indices refer to this MDL's animations until include merging. */
export function readAnimations(reader: BinaryReader): StudioAnimation[] {
  return table(reader, STUDIO.animations, STUDIO.animationSize).map(offset => ({
    name: relativeString(reader, offset, ANIM.name), offset,
    fps: reader.f32(offset + ANIM.fps), flags: reader.i32(offset + ANIM.flags),
    frames: reader.i32(offset + ANIM.frames), block: reader.i32(offset + ANIM.block),
    data: reader.i32(offset + ANIM.data), sectionOffset: reader.i32(offset + ANIM.sections),
    sectionFrames: reader.i32(offset + ANIM.sectionFrames),
  }));
}

export function readPoseParameters(reader: BinaryReader): SourcePoseParameter[] {
  return table(reader, STUDIO.poseParameters, STUDIO.poseSize).map(at => ({
    name: relativeString(reader, at), start: reader.f32(at + POSE.start),
    end: reader.f32(at + POSE.end), loop: reader.f32(at + POSE.loop),
  }));
}

export function readSequences(reader: BinaryReader, animations: readonly StudioAnimation[]): SourceSequence[] {
  return table(reader, STUDIO.sequences, STUDIO.sequenceSize).map(at => {
    const blendSize: [number, number] = [reader.i32(at + SEQ.sizeX), reader.i32(at + SEQ.sizeY)];
    if (blendSize.some(size => size < 1)) throw new Error('Invalid sequence blend grid');
    const index = at + reader.i32(at + SEQ.animationIndex);
    const count = blendSize[0] * blendSize[1];
    requireRange(reader, index, count * STUDIO.shortSize);
    const indices = Array.from({ length: count }, (_, i) => reader.i16(index + i * STUDIO.shortSize));
    const first = animations[indices[0]];
    const frames = first?.frames ?? 1;
    const sequence: SourceSequence = {
      name: relativeString(reader, at, SEQ.name), activity: relativeString(reader, at, SEQ.activity),
      fps: first?.fps ?? 0, frames, looping: (reader.i32(at + SEQ.flags) & SEQ.looping) !== 0,
      blendParams: [reader.i32(at + SEQ.paramX), reader.i32(at + SEQ.paramY)],
      blendSize, animations: indices,
      events: table(reader, SEQ.events, STUDIO.eventSize, at).map(event => ({
        frame: reader.f32(event + EVENT.cycle) * Math.max(0, frames - 1),
        event: reader.i32(event + EVENT.id), options: reader.fixedString(event + EVENT.options, EVENT.optionsSize),
      })),
    };
    sequenceBlends.set(sequence, {
      start: [reader.f32(at + SEQ.startX), reader.f32(at + SEQ.startY)],
      end: [reader.f32(at + SEQ.endX), reader.f32(at + SEQ.endY)],
    });
    return sequence;
  });
}
