import { BinaryReader } from './binary';
import { requireRange, readVec3 } from './mdl-header';

const HEADER = {
  magic: 'IDSV', version: 4, checksum: 8, lods: 12, vertices: 16,
  fixups: 48, fixupIndex: 52, data: 56, tangents: 60, size: 64, maxLods: 8,
} as const;
const VERTEX = { size: 48, weights: 0, bones: 12, count: 15, position: 16, normal: 28, uv: 40 } as const;
const FIXUP = { size: 12, lod: 0, source: 4, count: 8 } as const;
const TANGENT_SIZE = 16;
const FLOAT_SIZE = 4;

/** READ ME — rebuild LOD zero in fixup order; indices address that rebuilt list. */
export function parseVvd(bytes: Uint8Array) {
  const reader = new BinaryReader(bytes);
  requireRange(reader, 0, HEADER.size);
  if (reader.fixedString(0, 4) !== HEADER.magic || reader.i32(4) !== HEADER.version) throw new Error('Unsupported VVD header');
  const lods = reader.i32(HEADER.lods);
  if (lods < 1 || lods > HEADER.maxLods) throw new Error('Invalid VVD LOD count');
  const count = reader.i32(HEADER.vertices);
  const data = reader.i32(HEADER.data);
  const tangentAt = reader.i32(HEADER.tangents);
  requireRange(reader, data, count * VERTEX.size);
  if (tangentAt !== 0) requireRange(reader, tangentAt, count * TANGENT_SIZE);
  const fixupCount = reader.i32(HEADER.fixups);
  const fixupAt = reader.i32(HEADER.fixupIndex);
  requireRange(reader, fixupAt, fixupCount * FIXUP.size);
  const source: number[] = [];
  if (fixupCount === 0) {
    for (let i = 0; i < count; i++) source.push(i);
  } else {
    for (let i = 0; i < fixupCount; i++) {
      const at = fixupAt + i * FIXUP.size;
      const first = reader.i32(at + FIXUP.source), length = reader.i32(at + FIXUP.count);
      if (first < 0 || length < 0 || first + length > count) throw new Error('Invalid VVD fixup');
      if (reader.i32(at + FIXUP.lod) >= 0) for (let v = 0; v < length; v++) source.push(first + v);
    }
  }
  if (source.length !== count) throw new Error('VVD fixup vertex count mismatch');
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const weights = new Float32Array(count * 3), bones = new Uint8Array(count * 3);
  const uvs = new Float32Array(count * 2), tangents = new Float32Array(tangentAt ? count * 4 : 0);
  source.forEach((vertex, i) => {
    const at = data + vertex * VERTEX.size;
    const influences = reader.u8(at + VERTEX.count);
    if (influences > 3) throw new Error('Unsupported VVD bone count');
    positions.set(readVec3(reader, at + VERTEX.position), i * 3);
    normals.set(readVec3(reader, at + VERTEX.normal), i * 3);
    for (let b = 0; b < 3; b++) {
      weights[i * 3 + b] = b < influences ? reader.f32(at + VERTEX.weights + b * FLOAT_SIZE) : 0;
      bones[i * 3 + b] = b < influences ? reader.u8(at + VERTEX.bones + b) : 0;
    }
    uvs.set(reader.floats(at + VERTEX.uv, 2), i * 2);
    if (tangentAt) tangents.set(reader.floats(tangentAt + vertex * TANGENT_SIZE, 4), i * 4);
  });
  return { checksum: reader.i32(HEADER.checksum), positions, normals, weights, bones, uvs, tangents };
}
