import type { Vec3 } from '../../core/vec3';
import { boneToModel, findSequence, sequencePose, skinMatrices } from './animation';
import { loadMaterial, paramBool, texturePath } from './material';
import { loadModel } from './model';
import { parsePhy } from './phy';
import type { SourceFiles, SourceModel } from './source.types';
import { decodeVtf } from './vtf';

/**
 * READ ME — a Half-Life 2 / Garry's Mod prop (models/props_*.mdl) as Hoodoo
 * takes it: its triangles posed at rest (bone-weighted, as the game draws a
 * static prop), turned from Source's axes (x forward, y left, z up, inches) to
 * Hoodoo's (y up, world units, a 72-inch player 1.8 tall), one group of
 * triangles per material with that material's picture as RGBA, and its
 * collision (.phy) as convex pieces with the mass and surface the game gives
 * it. The ray tracer's mesh (render) and the physics' hulls (play/sim) read
 * this; it is kept here until the scene's own mesh format is settled.
 */

/** World units per Half-Life inch: Hoodoo's 1.8-unit person is Half-Life's 72-inch hull. */
export const PROP_SCALE = 0.025;

export interface PropMaterial {
  /** The material's path (materials/models/props_c17/oil_drum001.vmt). */
  readonly name: string;
  /** Its base texture, RGBA8 `width × height × 4`; a mid grey 1×1 when the files lack it. */
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** $translucent: alpha blends; $alphatest: alpha cuts. */
  readonly translucent: boolean;
  readonly alphaTest: boolean;
}

export interface PropMesh {
  readonly path: string;
  /** x y z per vertex, world units, Hoodoo's axes, the prop's own origin. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** u v per vertex as the model stores them (v down the picture). */
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Runs of `indices` drawn with one material. */
  readonly groups: readonly { readonly start: number; readonly count: number; readonly material: number }[];
  readonly materials: readonly PropMaterial[];
  readonly min: Vec3;
  readonly max: Vec3;
  /** Convex pieces for physics, each x y z points in world units (empty: no collision model). */
  readonly hulls: readonly Float32Array[];
  /** Kilograms from the collision model (0 when it names none). */
  readonly mass: number;
  /** The Source surface ("wood_crate"), for steps, knocks and scrapes. */
  readonly surfaceprop: string;
}

const MDL = '.mdl';
const PHY = '.phy';
const XYZ = 3;
const UV = 2;
const BONES_PER_VERTEX = 3;
const MATRIX = 12;
const GREY: Uint8Array = new Uint8Array([128, 128, 128, 255]);
const DEFAULT_SURFACE = 'default';
const REST = 'ACT_IDLE';

/** Loads a prop model and its collision; `skin` picks the skin family. */
export async function loadStaticProp(files: SourceFiles, path: string, skin = 0): Promise<PropMesh> {
  const model = await loadModel(files, path);
  const seq = Math.max(0, findSequence(model, REST));
  const frames = boneToModel(model, model.sequences.length ? sequencePose(model, seq, 0) : model.bones.map((b) => ({ position: b.position, quat: b.quat })));
  const skinning = skinMatrices(model, frames);
  const family = model.skins[skin] ?? model.skins[0] ?? [];
  const slotOf = (material: number) => family[material] ?? material;
  // Body part 0's first model: what the game shows by default.
  const meshes = model.meshes.filter((m) => m.model === 0);
  const slots = [...new Set(meshes.map((m) => slotOf(m.material)))];
  const vertexCount = meshes.reduce((n, m) => n + m.positions.length / XYZ, 0);
  const positions = new Float32Array(vertexCount * XYZ);
  const normals = new Float32Array(vertexCount * XYZ);
  const uvs = new Float32Array(vertexCount * UV);
  const indexCount = meshes.reduce((n, m) => n + m.indices.length, 0);
  const indices = new Uint32Array(indexCount);
  const groups: { start: number; count: number; material: number }[] = [];
  let v0 = 0;
  let i0 = 0;
  // Meshes of one material together, so a material is one group.
  for (const slot of slots) {
    const start = i0;
    for (const m of meshes.filter((x) => slotOf(x.material) === slot)) {
      const n = m.positions.length / XYZ;
      for (let v = 0; v < n; v++) {
        const p = skinned(skinning, m.bones, m.weights, v, m.positions, true);
        const q = skinned(skinning, m.bones, m.weights, v, m.normals, false);
        positions.set(toHoodoo(p, PROP_SCALE), (v0 + v) * XYZ);
        normals.set(normalised(toHoodoo(q, 1)), (v0 + v) * XYZ);
        uvs.set(m.uvs.subarray(v * UV, v * UV + UV), (v0 + v) * UV);
      }
      for (let k = 0; k < m.indices.length; k++) indices[i0 + k] = m.indices[k] + v0;
      v0 += n;
      i0 += m.indices.length;
    }
    groups.push({ start, count: i0 - start, material: slots.indexOf(slot) });
  }
  const [materials, phy] = await Promise.all([
    Promise.all(slots.map((s) => propMaterial(files, model, s))),
    files.has(path.replace(MDL, PHY)) ? files.read(path.replace(MDL, PHY)).then((b) => (b ? parsePhy(b) : null)) : null,
  ]);
  const hulls = (phy?.pieces ?? []).map((piece) => {
    const out = new Float32Array(piece.length);
    for (let k = 0; k < piece.length; k += XYZ) out.set(toHoodoo([piece[k], piece[k + 1], piece[k + 2]], PROP_SCALE), k);
    return out;
  });
  return {
    path, positions, normals, uvs, indices, groups, materials, ...bounds(positions), hulls,
    mass: phy?.mass ?? 0, surfaceprop: phy?.surfaceprop ?? DEFAULT_SURFACE,
  };
}

/** Source's axes (x forward, y left, z up) to Hoodoo's (x, y up, z): right-handed both ways. */
export function toHoodoo(p: readonly number[], scale: number): Vec3 {
  return [p[0] * scale, p[2] * scale, -p[1] * scale];
}

/** A vertex's point (or direction) through its bones' rest matrices, by weight. */
function skinned(m: Float32Array, bones: Uint8Array, weights: Float32Array, v: number, data: Float32Array, point: boolean): number[] {
  const [x, y, z] = [data[v * XYZ], data[v * XYZ + 1], data[v * XYZ + 2]];
  const out = [0, 0, 0];
  for (let k = 0; k < BONES_PER_VERTEX; k++) {
    const w = weights[v * BONES_PER_VERTEX + k];
    if (!w) continue;
    const b = bones[v * BONES_PER_VERTEX + k] * MATRIX;
    for (let r = 0; r < XYZ; r++) {
      const row = b + r * (XYZ + 1);
      out[r] += w * (m[row] * x + m[row + 1] * y + m[row + 2] * z + (point ? m[row + XYZ] : 0));
    }
  }
  return out;
}

function normalised(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function bounds(p: Float32Array): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.length; k += XYZ) {
    for (let a = 0; a < XYZ; a++) {
      min[a] = Math.min(min[a], p[k + a]);
      max[a] = Math.max(max[a], p[k + a]);
    }
  }
  return p.length ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** A texture slot's material: the first candidate the files have, its base texture decoded. */
async function propMaterial(files: SourceFiles, model: SourceModel, slot: number): Promise<PropMaterial> {
  const s = model.textures[slot];
  const path = s?.candidates.find((c) => files.has(c)) ?? null;
  const plain = { name: path ?? s?.name ?? '', rgba: GREY, width: 1, height: 1, translucent: false, alphaTest: false };
  if (!path) return plain;
  const m = await loadMaterial(files, path);
  const base = m.params.get('$basetexture');
  const bytes = base ? await files.read(texturePath(base)) : null;
  if (!bytes) return { ...plain, translucent: paramBool(m, '$translucent'), alphaTest: paramBool(m, '$alphatest') };
  const t = decodeVtf(bytes);
  return { name: path, rgba: t.rgba(), width: t.width, height: t.height, translucent: paramBool(m, '$translucent'), alphaTest: paramBool(m, '$alphatest') };
}

