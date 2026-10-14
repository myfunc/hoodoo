import type { MeshEntry } from '../assets/mesh-library';
import type { Vec3 } from '../core/vec3';
import { BVH_NODE_FLOATS, meshBvh } from './mesh-bvh';

/** Closer than this along the ray is the ray's own start, not a hit. */
const NEAR = 1e-6;
/** A ray this parallel to an axis is treated as almost parallel (no division by zero). */
const AXIS_EPS = 1e-12;
/** A triangle this edge-on to the ray is missed. */
const EDGE_ON = 1e-24;
/** Barycentric slack: a ray down a shared edge hits one of its triangles, never the crack between. */
const SLACK = 1e-7;

/** Ray (in the mesh's unit box) against a library mesh's triangles: the nearest t, or Infinity. */
export function meshT(entry: MeshEntry, o: Vec3, d: Vec3): number {
  const { nodes, order } = meshBvh(entry);
  const p = entry.data.positions;
  const idx = entry.data.indices;
  const inv = d.map((x) => 1 / (Math.abs(x) > AXIS_EPS ? x : AXIS_EPS));
  let best = Infinity;
  const stack = [0];
  while (stack.length) {
    const n = stack.pop()! * BVH_NODE_FLOATS;
    if (boxT(nodes, n, o, inv) >= best) continue;
    const first = nodes[n + 3];
    const count = nodes[n + BVH_NODE_FLOATS - 1];
    if (count === 0) {
      stack.push(first, first + 1);
      continue;
    }
    for (let i = first; i < first + count; i++) {
      const t = triT(p, idx, order[i], o, d);
      if (t > NEAR && t < best) best = t;
    }
  }
  return best;
}

/** Where the ray enters node `n`'s box, Infinity if it misses. */
function boxT(nodes: Float32Array, n: number, o: Vec3, inv: readonly number[]): number {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const u = (nodes[n + a] - o[a]) * inv[a];
    const v = (nodes[n + 4 + a] - o[a]) * inv[a];
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
  }
  return t1 >= Math.max(t0, 0) ? t0 : Infinity;
}

/** Möller–Trumbore: t along the ray to triangle `t`, Infinity if it misses. */
function triT(p: Float32Array, idx: Uint32Array, t: number, o: Vec3, d: Vec3): number {
  const a = idx[t * 3] * 3;
  const b = idx[t * 3 + 1] * 3;
  const c = idx[t * 3 + 2] * 3;
  const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
  const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
  const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
  if (Math.abs(det) < EDGE_ON) return Infinity;
  const tv = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]];
  const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
  if (u < -SLACK || u > 1 + SLACK) return Infinity;
  const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
  const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
  if (v < -SLACK || u + v > 1 + SLACK) return Infinity;
  return (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
}
