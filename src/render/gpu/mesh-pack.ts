import type { MeshEntry } from '../../assets/mesh-library';
import { MeshAlpha } from '../../model/mesh.types';
import type { MeshImage } from '../../model/mesh.types';
import { BVH_NODE_FLOATS, meshBvh } from '../../world/mesh-bvh';
import { TEXEL_FLOATS } from './render.constants';

/**
 * The meshes a scene draws as one float texture, read as a list of texels (37-mesh.glsl):
 * a header texel per mesh (where its nodes and triangles start, its texture density), then
 * each mesh's BVH nodes (two texels) and triangles (MESH_TRI_TEXELS each); and their pictures
 * as one RGBA8 texture array of MESH_IMAGE_SIZE² layers.
 */
export const MESH_TEX_WIDTH = 2048;
/** v0, v1, v2 (the first with the picture code), n0 + u0, n1 + u1, n2 + u2, then v0, v1, v2 of the uvs. */
export const MESH_TRI_TEXELS = 7;
const NODE_TEXELS = BVH_NODE_FLOATS / TEXEL_FLOATS;
export const MESH_IMAGE_SIZE = 512;
/** Layers of the picture array: more pictures than this are drawn without theirs. */
export const MAX_MESH_IMAGES = 64;
/** A picture code is its layer plus this times its MeshAlpha (37-mesh.glsl MESH_ALPHA_STEP). */
export const MESH_ALPHA_STEP = 1024;
/** The code of a triangle without a picture. */
const NO_IMAGE = -1;
/** The triangle's texels: its normals (with u) after its corners, then the corners' v. */
const NORMALS_AT = 3;
const V_AT = 6;
const RGBA = 4;

export interface PackedMeshes {
  readonly data: Float32Array;
  readonly rows: number;
  /** The header texel of each mesh by key: an object's shape parameter. */
  readonly slots: ReadonlyMap<string, number>;
  readonly images: Uint8Array;
  readonly layers: number;
}

export function packMeshes(meshes: readonly MeshEntry[]): PackedMeshes {
  const bvhs = meshes.map(meshBvh);
  let texels = meshes.length;
  const bases = meshes.map((m, i) => {
    const nodeBase = texels;
    texels += (bvhs[i].nodes.length / BVH_NODE_FLOATS) * NODE_TEXELS;
    const triBase = texels;
    texels += m.triangles * MESH_TRI_TEXELS;
    return { nodeBase, triBase };
  });
  const rows = Math.max(1, Math.ceil(texels / MESH_TEX_WIDTH));
  const data = new Float32Array(rows * MESH_TEX_WIDTH * TEXEL_FLOATS);
  const pictures: MeshImage[] = [];
  const slots = new Map<string, number>();
  meshes.forEach((m, i) => {
    const { nodeBase, triBase } = bases[i];
    const firstLayer = pictures.length;
    for (const img of m.data.images ?? []) if (pictures.length < MAX_MESH_IMAGES) pictures.push(img);
    data.set([nodeBase, triBase, texelDensity(m), 0], i * TEXEL_FLOATS);
    data.set(bvhs[i].nodes, nodeBase * TEXEL_FLOATS);
    const codes = triangleCodes(m, firstLayer);
    const { positions: p, normals: nr, uvs, indices } = m.data;
    bvhs[i].order.forEach((t, slot) => {
      const at = (triBase + slot * MESH_TRI_TEXELS) * TEXEL_FLOATS;
      const v = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      const flat = nr ? null : faceNormal(p, v);
      for (let k = 0; k < 3; k++) {
        const o = at + k * TEXEL_FLOATS;
        data.set([p[v[k] * 3], p[v[k] * 3 + 1], p[v[k] * 3 + 2], k === 0 ? codes[t] : 0], o);
        const n = flat ?? [nr![v[k] * 3], nr![v[k] * 3 + 1], nr![v[k] * 3 + 2]];
        data.set([n[0], n[1], n[2], uvs ? uvs[v[k] * 2] : 0], o + NORMALS_AT * TEXEL_FLOATS);
      }
      data.set(uvs ? [uvs[v[0] * 2 + 1], uvs[v[1] * 2 + 1], uvs[v[2] * 2 + 1], 0] : [0, 0, 0, 0], at + V_AT * TEXEL_FLOATS);
    });
    slots.set(m.key, i);
  });
  return { data, rows, slots, images: packImages(pictures), layers: Math.max(1, pictures.length) };
}

/** Each triangle's picture code: its layer plus MESH_ALPHA_STEP × its alpha mode, or NO_IMAGE. */
function triangleCodes(m: MeshEntry, firstLayer: number): Float32Array {
  const codes = new Float32Array(m.triangles).fill(NO_IMAGE);
  if (!m.data.uvs) return codes;
  for (const part of m.parts) {
    const layer = part.image < 0 ? -1 : firstLayer + part.image;
    if (layer < 0 || layer >= MAX_MESH_IMAGES) continue;
    const code = layer + MESH_ALPHA_STEP * (part.alpha ?? MeshAlpha.Opaque);
    codes.fill(code, part.start / 3, (part.start + part.count) / 3);
  }
  return codes;
}

function faceNormal(p: Float32Array, v: readonly number[]): number[] {
  const e1 = [0, 1, 2].map((a) => p[v[1] * 3 + a] - p[v[0] * 3 + a]);
  const e2 = [0, 1, 2].map((a) => p[v[2] * 3 + a] - p[v[0] * 3 + a]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return n.map((x) => x / l);
}

/**
 * Picture texels per unit of the mesh's box along its surface (the square root of the
 * pictures' area over the surface's): the shader picks a mip level from it.
 */
export function texelDensity(m: MeshEntry): number {
  const { positions: p, uvs, indices } = m.data;
  if (!uvs) return 0;
  let surface = 0;
  let picture = 0;
  for (let t = 0; t < m.triangles; t++) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    const e1 = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k]);
    surface += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    const du1 = uvs[b * 2] - uvs[a * 2];
    const dv1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
    const du2 = uvs[c * 2] - uvs[a * 2];
    const dv2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
    picture += Math.abs(du1 * dv2 - du2 * dv1) / 2;
  }
  return surface > 0 ? Math.sqrt(picture / surface) * MESH_IMAGE_SIZE : 0;
}

/** Every picture resampled to MESH_IMAGE_SIZE² (bilinear), one layer after another. */
function packImages(pictures: readonly MeshImage[]): Uint8Array {
  const s = MESH_IMAGE_SIZE;
  const out = new Uint8Array(Math.max(1, pictures.length) * s * s * RGBA);
  pictures.forEach((img, layer) => {
    const base = layer * s * s * RGBA;
    for (let y = 0; y < s; y++) {
      const fy = Math.max(0, ((y + 0.5) / s) * img.height - 0.5);
      const y0 = Math.min(img.height - 1, Math.floor(fy));
      const y1 = Math.min(img.height - 1, y0 + 1);
      const wy = fy - y0;
      for (let x = 0; x < s; x++) {
        const fx = Math.max(0, ((x + 0.5) / s) * img.width - 0.5);
        const x0 = Math.min(img.width - 1, Math.floor(fx));
        const x1 = Math.min(img.width - 1, x0 + 1);
        const wx = fx - x0;
        for (let c = 0; c < RGBA; c++) {
          const at = (yy: number, xx: number) => img.data[(yy * img.width + xx) * RGBA + c];
          const top = at(y0, x0) * (1 - wx) + at(y0, x1) * wx;
          const bottom = at(y1, x0) * (1 - wx) + at(y1, x1) * wx;
          out[base + (y * s + x) * RGBA + c] = Math.round(top * (1 - wy) + bottom * wy);
        }
      }
    }
  });
  return out;
}
