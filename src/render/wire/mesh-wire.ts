import type { MeshEntry } from '../../assets/mesh-library';
import type { Vec3 } from '../../core/vec3';

/** Faces meeting at more than this bend (cosine of the angle between their normals) draw their edge. */
const CREASE_COS = Math.cos((35 * Math.PI) / 180);
/** Corners closer than this (unit box) are one corner: a mesh's seams do not draw edges. */
const WELD = 1e-4;
/** More lines than this and the wireframe shows the box instead (a dense mesh would be a smudge). */
const MAX_LINES = 6000;

/**
 * A mesh's outline in the wireframe: its creases and open borders (not every triangle's
 * edge), in the unit box like every shape's. Null when there are too many to read.
 */
export function meshLines(entry: MeshEntry): Vec3[] | null {
  const p = entry.data.positions;
  const idx = entry.data.indices;
  const corner = new Map<string, number>();
  const weld = (v: number): number => {
    const key = `${Math.round(p[v * 3] / WELD)},${Math.round(p[v * 3 + 1] / WELD)},${Math.round(p[v * 3 + 2] / WELD)}`;
    let id = corner.get(key);
    if (id === undefined) {
      id = v;
      corner.set(key, id);
    }
    return id;
  };
  const edges = new Map<string, { a: number; b: number; normals: Vec3[] }>();
  for (let t = 0; t < entry.triangles; t++) {
    const v = [weld(idx[t * 3]), weld(idx[t * 3 + 1]), weld(idx[t * 3 + 2])];
    const n = faceNormal(p, v);
    for (let k = 0; k < 3; k++) {
      const a = Math.min(v[k], v[(k + 1) % 3]);
      const b = Math.max(v[k], v[(k + 1) % 3]);
      if (a === b) continue;
      const key = `${a}:${b}`;
      const e = edges.get(key) ?? { a, b, normals: [] };
      e.normals.push(n);
      edges.set(key, e);
    }
  }
  const out: Vec3[] = [];
  for (const e of edges.values()) {
    const [n0, n1] = e.normals;
    const crease = e.normals.length !== 2 || n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < CREASE_COS;
    if (!crease) continue;
    if (out.length / 2 >= MAX_LINES) return null;
    out.push(at(p, e.a), at(p, e.b));
  }
  return out;
}

const at = (p: Float32Array, v: number): Vec3 => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];

function faceNormal(p: Float32Array, v: readonly number[]): Vec3 {
  const [a, b, c] = v.map((i) => at(p, i));
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}
