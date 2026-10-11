import { CUT_PLANES, type LatheProfileData } from '../../assets/lathe';
import { LATHE_PROFILES } from '../../assets/lathe.profiles';
import { TEXEL_FLOATS } from './render.constants';

/**
 * The Lathe profiles as one float texture, a row each (36-lathe.glsl): a header,
 * the cut's planes, the blocks, the head's parameters, then two texels per
 * outline segment and the head's side view, two points a texel.
 */
export const LATHE_TEXELS = {
  header: 0,
  info: 1,
  cut: 2,
  blocks: 6,
  headThickness: 10,
  headShape: 11,
  headBox: 12,
  dents: 13,
  /** Lowest height of the cuts and of the blocks: rays that stay below skip them. */
  floors: 15,
  /** Then one bounding texel per CHUNK segments (largest radius, lowest and highest point), then the segments. */
  chunks: 16,
} as const;
/** Segments under one bounding cylinder: a ray that misses it skips them all. Keep in sync with LATHE_CHUNK. */
export const LATHE_CHUNK = 8;
const MAX_BLOCKS = 2;
const MAX_DENTS = 2;
/** A plane that every point satisfies (0 < 1): fills a cut's unused slots. */
const OPEN_PLANE = [0, 0, 0, 1] as const;
/** Stands in for Infinity (no cut, no blocks) in the float texture. */
const NEVER = 1e9;

export interface PackedLathe {
  readonly width: number;
  readonly rows: number;
  readonly data: Float32Array;
}

const chunkCount = (p: LatheProfileData): number => Math.ceil(p.segments.length / LATHE_CHUNK);
const segmentsAt = (p: LatheProfileData): number => LATHE_TEXELS.chunks + chunkCount(p);
const headAt = (p: LatheProfileData): number => segmentsAt(p) + p.segments.length * 2;
const texelsOf = (p: LatheProfileData): number => headAt(p) + Math.ceil((p.head?.outline.length ?? 0) / 2);

function packRow(out: Float32Array, base: number, p: LatheProfileData): void {
  const put = (texel: number, v: readonly number[]) => out.set(v, base + texel * TEXEL_FLOATS);
  const head = p.head;
  if (p.blocks.length > MAX_BLOCKS || (p.cut?.planes.length ?? 0) > CUT_PLANES || (head?.dents.length ?? 0) > MAX_DENTS) {
    throw new Error(`Lathe profile ${p.name} has more parts than the shader reads`);
  }
  put(LATHE_TEXELS.header, [p.segments.length, head?.outline.length ?? 0, headAt(p), p.cut?.copies ?? 0]);
  put(LATHE_TEXELS.info, [p.aspect, p.blocks.length, head ? 1 : 0, segmentsAt(p)]);
  put(LATHE_TEXELS.floors, [Math.min(p.cutFloor, NEVER), Math.min(p.blockFloor, NEVER), 0, 0]);
  for (let i = 0; i < CUT_PLANES; i++) put(LATHE_TEXELS.cut + i, p.cut?.planes[i] ?? OPEN_PLANE);
  p.blocks.forEach((b, i) => {
    put(LATHE_TEXELS.blocks + i * 2, [...b.center, 0]);
    put(LATHE_TEXELS.blocks + i * 2 + 1, [...b.half, 0]);
  });
  if (head) {
    const t = head.thickness;
    put(LATHE_TEXELS.headThickness, [t.base, t.perX, t.perY, t.min]);
    put(LATHE_TEXELS.headShape, [t.max, head.round, head.earGap.from, head.earGap.half]);
    put(LATHE_TEXELS.headBox, head.box);
    head.dents.forEach((d, i) => put(LATHE_TEXELS.dents + i, d));
    put(headAt(p), head.outline.flat());
  }
  for (let c = 0; c < chunkCount(p); c++) {
    const part = p.segments.slice(c * LATHE_CHUNK, (c + 1) * LATHE_CHUNK);
    put(LATHE_TEXELS.chunks + c, [Math.max(...part.map((s) => Math.max(s.r0, s.r1))), part[0].y0, part[part.length - 1].y1, 0]);
  }
  const at = segmentsAt(p);
  p.segments.forEach((s, i) => {
    put(at + i * 2, [s.r0, s.y0, s.r1, s.y1]);
    put(at + i * 2 + 1, [...s.n0, ...s.n1]);
  });
}

/** Built once per page: the profiles never change while it runs. */
let packed: PackedLathe | null = null;

export function packLathe(profiles: readonly LatheProfileData[] = LATHE_PROFILES): PackedLathe {
  if (profiles === LATHE_PROFILES && packed) return packed;
  const width = Math.max(...profiles.map(texelsOf));
  const data = new Float32Array(width * profiles.length * TEXEL_FLOATS);
  profiles.forEach((p, row) => packRow(data, row * width * TEXEL_FLOATS, p));
  const result = { width, rows: profiles.length, data };
  if (profiles === LATHE_PROFILES) packed = result;
  return result;
}
