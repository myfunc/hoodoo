import { BinaryReader } from './binary';
import { parseKeyValues } from './keyvalues';
import type { KeyValues } from './source.types';

/**
 * READ ME — a Source model's collision (.phy): what Half-Life 2's physics
 * holds a prop by. The file is a header, then one block per solid (a bone's
 * body) — a "VPHY" header and an IVP compact surface: convex pieces ("ledges"),
 * each a ring of triangles over its points — then a text block naming each
 * solid's mass and surface. The pieces come out as points in the model's own
 * frame, inches, Source's axes (IVP keeps metres and its own axes).
 */

export interface PhyData {
  /** Convex pieces, each its points as x y z triples (inches, Source axes, the model's frame). */
  readonly pieces: readonly Float32Array[];
  /** Kilograms, all solids together; 0 when the file names none. */
  readonly mass: number;
  /** The first solid's surface ("metal_barrel"), or "default". */
  readonly surfaceprop: string;
}

const VPHY = 0x59485056;
/** Byte sizes and offsets of IVP's structs. */
const HEADER = { solidCount: 8 } as const;
const VPHY_HEADER = 28;
const SURFACE = { size: 48, ledgeTreeRoot: 32 } as const;
const LEDGE = { size: 16, triangles: 12 } as const;
const TRIANGLE = 16;
const EDGE_BYTES = 4;
const EDGES = 3;
const POINT = 16;
const POINT_INDEX = 0xffff;
/** IVP keeps metres; Source inches. */
const INCHES_PER_METRE = 39.3700787;
const DEFAULT_SURFACE = 'default';
const decoder = new TextDecoder('latin1');

export function parsePhy(bytes: Uint8Array): PhyData {
  const r = new BinaryReader(bytes);
  const solids = r.i32(HEADER.solidCount);
  let at = r.i32(0);
  const pieces: Float32Array[] = [];
  for (let s = 0; s < solids && at + EDGE_BYTES <= r.size; s++) {
    const size = r.i32(at);
    const start = at + EDGE_BYTES;
    const surface = r.u32(start) === VPHY ? start + VPHY_HEADER : start;
    pieces.push(...ledges(r, surface, Math.min(start + size, r.size)));
    at = start + size;
  }
  const text = parseKeyValues(decoder.decode(bytes.subarray(Math.min(at, bytes.length))));
  const solidNodes = text.filter((n) => n.key.toLowerCase() === 'solid');
  const value = (n: KeyValues, key: string) => n.children.find((c) => c.key.toLowerCase() === key)?.value ?? null;
  const mass = solidNodes.reduce((sum, n) => sum + (Number(value(n, 'mass')) || 0), 0);
  return { pieces, mass, surfaceprop: (solidNodes.length && value(solidNodes[0], 'surfaceprop')) || DEFAULT_SURFACE };
}

/**
 * The convex pieces of one compact surface. Ledges follow one another, each its header and
 * triangles; their points lie in one pool after the last, which is where the walk stops.
 */
function ledges(r: BinaryReader, surface: number, end: number): Float32Array[] {
  const out: Float32Array[] = [];
  let stop = Math.min(surface + r.i32(surface + SURFACE.ledgeTreeRoot), end);
  let ledge = surface + SURFACE.size;
  while (ledge + LEDGE.size <= stop) {
    const pointsAt = ledge + r.i32(ledge);
    stop = Math.min(stop, pointsAt);
    const triangles = r.i16(ledge + LEDGE.triangles);
    if (triangles <= 0) break;
    const used = new Set<number>();
    for (let t = 0; t < triangles; t++) {
      const tri = ledge + LEDGE.size + t * TRIANGLE;
      for (let e = 1; e <= EDGES; e++) used.add(r.u32(tri + e * EDGE_BYTES) & POINT_INDEX);
    }
    const points = new Float32Array(used.size * EDGES);
    let k = 0;
    for (const i of used) {
      const p = pointsAt + i * POINT;
      if (p + POINT > end) continue;
      // IVP (metres; x, y down, z) to Source (inches; x, y, z up).
      const [x, y, z] = [r.f32(p), r.f32(p + EDGE_BYTES), r.f32(p + 2 * EDGE_BYTES)];
      points.set([x * INCHES_PER_METRE, z * INCHES_PER_METRE, -y * INCHES_PER_METRE], k++ * EDGES);
    }
    if (k) out.push(points.subarray(0, k * EDGES));
    ledge += LEDGE.size + triangles * TRIANGLE;
  }
  return out;
}
