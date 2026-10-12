import { BinaryReader } from './binary';
import { requireRange, table } from './mdl-header';

const HEADER = { version: 7, size: 36, checksum: 16, lods: 20, bodies: 28 } as const;
const BODY = { size: 8, models: 0 } as const;
const MODEL = { size: 8, lods: 0 } as const;
const LOD = { size: 12, meshes: 0 } as const;
const MESH = { size: 9, groups: 0 } as const;
const GROUP = { sizes: [25, 33], vertices: 0, vertexAt: 4, indices: 8, indexAt: 12, strips: 16, stripAt: 20, size: 25 } as const;
const STRIP = { sizes: [27, 35], indices: 0, indexAt: 4, vertices: 8, vertexAt: 12, bones: 16, flags: 18, changes: 19, changeAt: 23, size: 27, triangles: 1, triangleStrip: 2 } as const;
const VERTEX = { size: 9, original: 4 } as const;
const SHORT_SIZE = 2;
const BONE_CHANGE_SIZE = 8;

function inside(reader: BinaryReader, at: number, size: number): boolean {
  return Number.isSafeInteger(at) && Number.isSafeInteger(size) && at >= 0 && size >= 0 && at + size <= reader.size;
}

function validStrip(reader: BinaryReader, at: number, group: number): boolean {
  if (!inside(reader, at, STRIP.size)) return false;
  const indices = reader.i32(at + STRIP.indices), start = reader.i32(at + STRIP.indexAt);
  const vertices = reader.i32(at + STRIP.vertices), first = reader.i32(at + STRIP.vertexAt);
  const flags = reader.u8(at + STRIP.flags);
  const changes = reader.i32(at + STRIP.changes);
  return indices >= 0 && start >= 0 && start + indices <= reader.i32(group + GROUP.indices)
    && vertices >= 0 && first >= 0 && first + vertices <= reader.i32(group + GROUP.vertices)
    && (flags === STRIP.triangles || flags === STRIP.triangleStrip)
    && (flags !== STRIP.triangles || indices % 3 === 0)
    && changes >= 0 && inside(reader, at + reader.i32(at + STRIP.changeAt), changes * BONE_CHANGE_SIZE);
}

function stripStride(reader: BinaryReader, group: number): number | null {
  const count = reader.i32(group + GROUP.strips), at = group + reader.i32(group + GROUP.stripAt);
  if (count < 0) return null;
  for (const stride of STRIP.sizes) {
    if (inside(reader, at, count * stride) && Array.from({ length: count }, (_, i) => validStrip(reader, at + i * stride, group)).every(Boolean)) return stride;
  }
  return null;
}

function validGroup(reader: BinaryReader, at: number): boolean {
  if (!inside(reader, at, GROUP.size)) return false;
  const vertices = reader.i32(at + GROUP.vertices), indices = reader.i32(at + GROUP.indices);
  if (!inside(reader, at + reader.i32(at + GROUP.vertexAt), vertices * VERTEX.size)
    || !inside(reader, at + reader.i32(at + GROUP.indexAt), indices * SHORT_SIZE)
    || stripStride(reader, at) === null) return false;
  const indexAt = at + reader.i32(at + GROUP.indexAt);
  for (let i = 0; i < indices; i++) if (reader.u16(indexAt + i * SHORT_SIZE) >= vertices) return false;
  return true;
}

function groups(reader: BinaryReader, mesh: number): number[] {
  const count = reader.i32(mesh), at = mesh + reader.i32(mesh + 4);
  if (count < 0) throw new Error('Invalid VTX strip group count');
  for (const stride of GROUP.sizes) {
    if (!inside(reader, at, count * stride)) continue;
    const result = Array.from({ length: count }, (_, i) => at + i * stride);
    if (result.every(group => validGroup(reader, group))) return result;
  }
  throw new Error('Invalid VTX strip group layout');
}

function meshTriangles(reader: BinaryReader, mesh: number): Uint32Array {
  const triangles: number[] = [];
  for (const group of groups(reader, mesh)) {
    const vertexAt = group + reader.i32(group + GROUP.vertexAt);
    const indexAt = group + reader.i32(group + GROUP.indexAt);
    const stripAt = group + reader.i32(group + GROUP.stripAt);
    const stride = stripStride(reader, group)!;
    const original = (index: number) => {
      const vertex = reader.u16(indexAt + index * SHORT_SIZE);
      return reader.u16(vertexAt + vertex * VERTEX.size + VERTEX.original);
    };
    for (let i = 0; i < reader.i32(group + GROUP.strips); i++) {
      const strip = stripAt + i * stride;
      const start = reader.i32(strip + STRIP.indexAt), count = reader.i32(strip + STRIP.indices);
      const list = reader.u8(strip + STRIP.flags) === STRIP.triangles;
      for (let j = 0; j + 2 < count; j += list ? 3 : 1) {
        let a = original(start + j), b = original(start + j + 1);
        const c = original(start + j + 2);
        if (!list && j % 2 !== 0) [a, b] = [b, a];
        if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
      }
    }
  }
  return new Uint32Array(triangles);
}

/** READ ME — LOD-zero triangles use MDL mesh-local vertex ids, not hardware bone ids. */
export function parseVtx(bytes: Uint8Array) {
  const reader = new BinaryReader(bytes);
  requireRange(reader, 0, HEADER.size);
  if (reader.i32(0) !== HEADER.version) throw new Error('Unsupported VTX version');
  if (reader.i32(HEADER.lods) < 1) throw new Error('Missing VTX LOD zero');
  const bodyParts = table(reader, HEADER.bodies, BODY.size).map(body =>
    table(reader, BODY.models, MODEL.size, body).map(model => {
      const lod = table(reader, MODEL.lods, LOD.size, model)[0];
      if (lod === undefined) throw new Error('Missing VTX model LOD zero');
      return table(reader, LOD.meshes, MESH.size, lod).map(mesh => meshTriangles(reader, mesh));
    }));
  return { checksum: reader.i32(HEADER.checksum), bodyParts };
}
