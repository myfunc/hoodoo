import type { Vec3 } from '../core/vec3';
import type { MeshData, MeshPart } from '../model/mesh.types';

/**
 * The meshes this page knows, by key (SceneObject.mesh). Registering one fits it to the
 * unit box an object's transform stretches (-1..1 on each axis), so a Mesh object is sized
 * like any other; `half` keeps its own half-size, for objects at the model's true size.
 */
export interface MeshEntry {
  readonly key: string;
  /** The mesh fitted to -1..1 on each axis, its normals turned to match. */
  readonly data: MeshData;
  readonly parts: readonly MeshPart[];
  /** Half-size and centre of its box in its own units. */
  readonly half: Vec3;
  readonly centre: Vec3;
  readonly triangles: number;
  /** Changes when the key is registered again with other data. */
  readonly version: number;
}

/** An axis this much thinner than the widest stays this thin, not flat: its normals stay finite. */
const MIN_HALF_SHARE = 1e-4;

const entries = new Map<string, MeshEntry>();
const listeners = new Set<() => void>();
let versions = 0;

/** Runs `listener` after each registration or removal. */
export function onMeshesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function meshEntry(key: string | undefined): MeshEntry | undefined {
  return key === undefined ? undefined : entries.get(key);
}

/** Changes with every registration or removal: what an engine compares to know its copy is stale. */
export function meshLibraryVersion(): number {
  return versions;
}

export function meshKeys(): string[] {
  return [...entries.keys()];
}

/** Adds (or replaces) the mesh under `key`; throws when its arrays do not fit together. */
export function registerMesh(key: string, mesh: MeshData): MeshEntry {
  checkMesh(mesh);
  const { min, max } = extent(mesh.positions);
  const widest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const half = [0, 1, 2].map((i) => Math.max((max[i] - min[i]) / 2, widest * MIN_HALF_SHARE, Number.MIN_VALUE)) as unknown as Vec3;
  const centre = [0, 1, 2].map((i) => (max[i] + min[i]) / 2) as unknown as Vec3;
  const positions = mesh.positions.map((v, i) => (v - centre[i % 3]) / half[i % 3]);
  const normals = mesh.normals ? fitNormals(mesh.normals, half) : undefined;
  const triangles = mesh.indices.length / 3;
  const parts = mesh.parts?.length ? mesh.parts : [{ start: 0, count: mesh.indices.length, image: -1 }];
  const entry: MeshEntry = { key, data: { ...mesh, positions, normals }, parts, half, centre, triangles, version: ++versions };
  entries.set(key, entry);
  for (const l of listeners) l();
  return entry;
}

export function unregisterMesh(key: string): void {
  if (!entries.delete(key)) return;
  versions++;
  for (const l of listeners) l();
}

/** A normal of a mesh squeezed by 1 / half on each axis turns by half (the inverse transpose). */
function fitNormals(normals: Float32Array, half: Vec3): Float32Array {
  const out = new Float32Array(normals.length);
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i] * half[0];
    const y = normals[i + 1] * half[1];
    const z = normals[i + 2] * half[2];
    const l = Math.hypot(x, y, z) || 1;
    out[i] = x / l; out[i + 1] = y / l; out[i + 2] = z / l;
  }
  return out;
}

function extent(p: Float32Array): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3], p[i]);
    max[i % 3] = Math.max(max[i % 3], p[i]);
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

function checkMesh(m: MeshData): void {
  const vertices = m.positions.length / 3;
  if (!vertices || m.positions.length % 3) throw new Error('A mesh needs x, y, z per vertex');
  if (!m.indices.length || m.indices.length % 3) throw new Error('A mesh needs three indices per triangle');
  if (m.normals && m.normals.length !== m.positions.length) throw new Error('A mesh needs a normal per vertex');
  if (m.uvs && m.uvs.length !== vertices * 2) throw new Error('A mesh needs u, v per vertex');
  for (const i of m.indices) if (i >= vertices) throw new Error('A mesh index points past its vertices');
  for (const p of m.parts ?? []) {
    if (p.start % 3 || p.count % 3 || p.start + p.count > m.indices.length) throw new Error('A mesh part runs past its triangles');
    if (p.image >= (m.images?.length ?? 0)) throw new Error('A mesh part wears a picture it does not have');
  }
}
