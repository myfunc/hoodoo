import { BinaryReader } from './binary';
import type { Vec3 } from '../../core/vec3';

export const STUDIO = {
  magic: 'IDST', minVersion: 44, maxVersion: 49, headerSize: 408,
  version: 4, checksum: 8, name: 12, nameSize: 64, length: 76,
  bones: 156, animations: 180, sequences: 188, textures: 204,
  directories: 212, skinRefs: 220, skinFamilies: 224, skins: 228,
  bodyParts: 232, attachments: 240, poseParameters: 300, includes: 336,
  boneSize: 216, attachmentSize: 92, textureSize: 64, poseSize: 20,
  bodySize: 16, modelSize: 148, meshSize: 116, includeSize: 8,
  animationSize: 100, sequenceSize: 212, eventSize: 80,
  floatSize: 4, shortSize: 2, matrixSize: 12,
} as const;

/** READ ME — validate ranges before following serialized, relative pointers. */
export function requireRange(reader: BinaryReader, at: number, size: number): void {
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || at + size > reader.size) {
    throw new Error(`Source model range outside file: ${at} + ${size} / ${reader.size}`);
  }
}

export function table(reader: BinaryReader, pair: number, stride: number, base = 0): number[] {
  const count = reader.i32(base + pair);
  const at = base + reader.i32(base + pair + STUDIO.floatSize);
  requireRange(reader, at, count * stride);
  return Array.from({ length: count }, (_, i) => at + i * stride);
}

export function relativeString(reader: BinaryReader, at: number, field = 0): string {
  const offset = reader.i32(at + field);
  if (offset === 0) return '';
  requireRange(reader, at + offset, 1);
  return reader.cstring(at + offset);
}

export function readVec3(reader: BinaryReader, at: number): Vec3 {
  return [reader.f32(at), reader.f32(at + STUDIO.floatSize), reader.f32(at + STUDIO.floatSize * 2)];
}

export function studioReader(bytes: Uint8Array): BinaryReader {
  const reader = new BinaryReader(bytes);
  requireRange(reader, 0, STUDIO.headerSize);
  if (reader.fixedString(0, 4) !== STUDIO.magic) throw new Error('Invalid MDL signature');
  const version = reader.i32(STUDIO.version);
  if (version < STUDIO.minVersion || version > STUDIO.maxVersion) throw new Error(`Unsupported MDL version: ${version}`);
  requireRange(reader, 0, reader.i32(STUDIO.length));
  return reader;
}
