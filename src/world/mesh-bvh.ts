import type { MeshEntry } from '../assets/mesh-library';

/**
 * A bounding volume hierarchy over a mesh's triangles (binned surface-area heuristic),
 * shared by the ray tracer (render/gpu/mesh-pack.ts) and picking (world/raycast.ts).
 * Eight floats a node: min x, y, z, then `first`, max x, y, z, then `count`. A leaf has
 * count > 0 triangles from order[first]; an inner node has count 0 and its children at
 * `first` and `first + 1`.
 */
export interface MeshBvh {
  readonly nodes: Float32Array;
  /** Triangle indices in leaf order. */
  readonly order: Uint32Array;
  readonly depth: number;
}

export const BVH_NODE_FLOATS = 8;
/** Triangles a leaf may hold before it is split. */
const LEAF_TRIS = 4;
/** A leaf this full is split even when the heuristic says it need not be. */
const MAX_LEAF_TRIS = 16;
const BINS = 12;
/** Deeper than this the tracer's stack overflows (MESH_STACK in 37-mesh.glsl): the rest stays one leaf. */
export const MAX_BVH_DEPTH = 30;
/** The heuristic's cost of visiting a node against that of testing one triangle. */
const TRAVERSAL_COST = 1;

const cache = new WeakMap<MeshEntry, MeshBvh>();

export function meshBvh(entry: MeshEntry): MeshBvh {
  let bvh = cache.get(entry);
  if (!bvh) {
    bvh = buildBvh(entry.data.positions, entry.data.indices);
    cache.set(entry, bvh);
  }
  return bvh;
}

interface Box { min: [number, number, number]; max: [number, number, number] }
const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const area = (b: Box): number => {
  const x = b.max[0] - b.min[0];
  const y = b.max[1] - b.min[1];
  const z = b.max[2] - b.min[2];
  return x < 0 ? 0 : 2 * (x * y + y * z + z * x);
};

export function buildBvh(positions: Float32Array, indices: Uint32Array): MeshBvh {
  const count = indices.length / 3;
  const lo = new Float32Array(count * 3);
  const hi = new Float32Array(count * 3);
  const mid = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    for (let a = 0; a < 3; a++) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = positions[indices[t * 3 + k] * 3 + a];
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }
      lo[t * 3 + a] = mn;
      hi[t * 3 + a] = mx;
      mid[t * 3 + a] = (mn + mx) / 2;
    }
  }
  const order = new Uint32Array(count).map((_, i) => i);
  const nodes: number[] = [];
  const grow = (b: Box, t: number) => {
    for (let a = 0; a < 3; a++) {
      b.min[a] = Math.min(b.min[a], lo[t * 3 + a]);
      b.max[a] = Math.max(b.max[a], hi[t * 3 + a]);
    }
  };
  const write = (node: number, b: Box, first: number, n: number) => {
    const at = node * BVH_NODE_FLOATS;
    [...b.min, first, ...b.max, n].forEach((v, k) => { nodes[at + k] = v; });
  };
  let used = 1;
  let depthMax = 0;
  const todo: { node: number; start: number; end: number; depth: number }[] = [{ node: 0, start: 0, end: count, depth: 0 }];
  while (todo.length) {
    const { node, start, end, depth } = todo.pop()!;
    depthMax = Math.max(depthMax, depth);
    const box = emptyBox();
    const cbox = emptyBox();
    for (let i = start; i < end; i++) {
      const t = order[i];
      grow(box, t);
      for (let a = 0; a < 3; a++) {
        cbox.min[a] = Math.min(cbox.min[a], mid[t * 3 + a]);
        cbox.max[a] = Math.max(cbox.max[a], mid[t * 3 + a]);
      }
    }
    const n = end - start;
    const split = n > LEAF_TRIS && depth < MAX_BVH_DEPTH ? bestSplit(order, start, end, cbox, mid, grow, area(box)) : null;
    if (!split || (split.cost >= n && n <= MAX_LEAF_TRIS)) {
      write(node, box, start, n);
      continue;
    }
    // Partition by the chosen plane; a split that leaves one side empty falls back to the middle.
    let m = start;
    for (let i = start; i < end; i++) {
      if (mid[order[i] * 3 + split.axis] < split.at) {
        const tmp = order[m]; order[m] = order[i]; order[i] = tmp;
        m++;
      }
    }
    if (m === start || m === end) m = start + (n >> 1);
    const left = used;
    used += 2;
    write(node, box, left, 0);
    todo.push({ node: left, start, end: m, depth: depth + 1 }, { node: left + 1, start: m, end, depth: depth + 1 });
  }
  return { nodes: new Float32Array(nodes), order, depth: depthMax };
}

function bestSplit(order: Uint32Array, start: number, end: number, cbox: Box, mid: Float32Array, grow: (b: Box, t: number) => void, parentArea: number): { axis: number; at: number; cost: number } | null {
  let best: { axis: number; at: number; cost: number } | null = null;
  for (let axis = 0; axis < 3; axis++) {
    const lo = cbox.min[axis];
    const span = cbox.max[axis] - lo;
    if (!(span > 0)) continue;
    const bins = Array.from({ length: BINS }, () => ({ box: emptyBox(), n: 0 }));
    for (let i = start; i < end; i++) {
      const t = order[i];
      const b = Math.min(BINS - 1, Math.floor(((mid[t * 3 + axis] - lo) / span) * BINS));
      bins[b].n++;
      grow(bins[b].box, t);
    }
    // Sweep from both ends: area and count of everything left and right of each plane.
    const rightArea = new Array<number>(BINS).fill(0);
    const rightN = new Array<number>(BINS).fill(0);
    const acc = emptyBox();
    let accN = 0;
    for (let b = BINS - 1; b > 0; b--) {
      merge(acc, bins[b].box);
      accN += bins[b].n;
      rightArea[b] = area(acc);
      rightN[b] = accN;
    }
    const left = emptyBox();
    let leftN = 0;
    for (let b = 1; b < BINS; b++) {
      merge(left, bins[b - 1].box);
      leftN += bins[b - 1].n;
      if (!leftN || !rightN[b]) continue;
      const cost = TRAVERSAL_COST + (area(left) * leftN + rightArea[b] * rightN[b]) / Math.max(parentArea, Number.MIN_VALUE);
      if (!best || cost < best.cost) best = { axis, at: lo + (span * b) / BINS, cost };
    }
  }
  return best;
}

function merge(into: Box, b: Box): void {
  for (let a = 0; a < 3; a++) {
    into.min[a] = Math.min(into.min[a], b.min[a]);
    into.max[a] = Math.max(into.max[a], b.max[a]);
  }
}
