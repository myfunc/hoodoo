/**
 * A minimal WebM (Matroska) writer for one VP8/VP9 video track: EBML header,
 * Segment with Info, Tracks and Clusters of SimpleBlocks. Enough for every
 * browser and video player; no cues, so seeking scans (fine for short movies).
 * Spec: https://www.matroska.org/technical/elements.html
 */
export interface EncodedFrame {
  readonly data: Uint8Array;
  /** Presentation time in milliseconds. */
  readonly timeMs: number;
  readonly key: boolean;
}

export interface WebmTrack {
  readonly codec: 'V_VP8' | 'V_VP9';
  readonly width: number;
  readonly height: number;
}

const ID = {
  ebml: 0x1a45dfa3, ebmlVersion: 0x4286, ebmlReadVersion: 0x42f7, maxIdLength: 0x42f2, maxSizeLength: 0x42f3,
  docType: 0x4282, docTypeVersion: 0x4287, docTypeReadVersion: 0x4285,
  segment: 0x18538067, info: 0x1549a966, timecodeScale: 0x2ad7b1, duration: 0x4489, muxingApp: 0x4d80, writingApp: 0x5741,
  tracks: 0x1654ae6b, trackEntry: 0xae, trackNumber: 0xd7, trackUid: 0x73c5, trackType: 0x83, codecId: 0x86, flagLacing: 0x9c,
  video: 0xe0, pixelWidth: 0xb0, pixelHeight: 0xba,
  cluster: 0x1f43b675, timecode: 0xe7, simpleBlock: 0xa3,
} as const;

const NS_PER_MS = 1000000;
const TRACK = 1;
const VIDEO_TYPE = 1;
const EBML_LEVEL = 1;
const MAX_ID_BYTES = 4;
const MAX_SIZE_BYTES = 8;
const WEBM_VERSION = 2;
const KEY_FLAG = 0x80;
const BITS_PER_BYTE = 8;
/** Value bits per byte of an EBML variable-size integer. */
const VINT_BITS = 7;
const BYTE = 256;
const MAX_BYTE = 0xff;
/** SimpleBlock times are int16 offsets from their cluster. */
const MAX_CLUSTER_MS = 30000;
const APP = 'Hoodoo';
const FLOAT64_BYTES = 8;

type Part = Uint8Array;

function concat(parts: readonly Part[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Unsigned big-endian integer in the fewest bytes (at least one). */
function uint(v: number): Uint8Array {
  const bytes: number[] = [];
  let n = v;
  do {
    bytes.unshift(n % BYTE);
    n = Math.floor(n / BYTE);
  } while (n > 0);
  return Uint8Array.from(bytes);
}

function idBytes(id: number): Uint8Array {
  return uint(id);
}

/** EBML variable-size integer: a length marker in the first byte, then the value. */
export function vint(size: number): Uint8Array {
  for (let len = 1; len <= MAX_SIZE_BYTES; len++) {
    const max = 2 ** (len * VINT_BITS) - 2;
    if (size <= max) {
      const out = new Uint8Array(len);
      let n = size;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = n % BYTE;
        n = Math.floor(n / BYTE);
      }
      out[0] |= 1 << (MAX_SIZE_BYTES - len);
      return out;
    }
  }
  throw new RangeError(`EBML size ${size} is too large`);
}

const element = (id: number, payload: Uint8Array): Uint8Array => concat([idBytes(id), vint(payload.length), payload]);
const master = (id: number, children: readonly Part[]): Uint8Array => element(id, concat(children));
const uintEl = (id: number, v: number): Uint8Array => element(id, uint(v));
const textEl = (id: number, s: string): Uint8Array => element(id, new TextEncoder().encode(s));

function floatEl(id: number, v: number): Uint8Array {
  const b = new Uint8Array(FLOAT64_BYTES);
  new DataView(b.buffer).setFloat64(0, v);
  return element(id, b);
}

function simpleBlock(f: EncodedFrame, clusterMs: number): Uint8Array {
  const rel = Math.round(f.timeMs - clusterMs);
  const head = Uint8Array.from([KEY_FLAG | TRACK, (rel >> BITS_PER_BYTE) & MAX_BYTE, rel & MAX_BYTE, f.key ? KEY_FLAG : 0]);
  return element(ID.simpleBlock, concat([head, f.data]));
}

/** Clusters start at key frames (and at least every MAX_CLUSTER_MS) so players can start anywhere a cluster does. */
function clusters(frames: readonly EncodedFrame[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  let blocks: Uint8Array[] = [];
  const flush = () => {
    if (blocks.length) out.push(master(ID.cluster, [uintEl(ID.timecode, Math.round(start)), ...blocks]));
    blocks = [];
  };
  for (const f of frames) {
    if (!blocks.length || f.key || f.timeMs - start >= MAX_CLUSTER_MS) {
      flush();
      start = f.timeMs;
    }
    blocks.push(simpleBlock(f, start));
  }
  flush();
  return out;
}

export function muxWebm(track: WebmTrack, frames: readonly EncodedFrame[], durationMs: number): Uint8Array<ArrayBuffer> {
  const header = master(ID.ebml, [
    uintEl(ID.ebmlVersion, EBML_LEVEL), uintEl(ID.ebmlReadVersion, EBML_LEVEL),
    uintEl(ID.maxIdLength, MAX_ID_BYTES), uintEl(ID.maxSizeLength, MAX_SIZE_BYTES),
    textEl(ID.docType, 'webm'), uintEl(ID.docTypeVersion, WEBM_VERSION), uintEl(ID.docTypeReadVersion, WEBM_VERSION),
  ]);
  const info = master(ID.info, [uintEl(ID.timecodeScale, NS_PER_MS), floatEl(ID.duration, durationMs), textEl(ID.muxingApp, APP), textEl(ID.writingApp, APP)]);
  const tracks = master(ID.tracks, [master(ID.trackEntry, [
    uintEl(ID.trackNumber, TRACK), uintEl(ID.trackUid, TRACK), uintEl(ID.trackType, VIDEO_TYPE), uintEl(ID.flagLacing, 0),
    textEl(ID.codecId, track.codec),
    master(ID.video, [uintEl(ID.pixelWidth, track.width), uintEl(ID.pixelHeight, track.height)]),
  ])]);
  return concat([header, master(ID.segment, [info, tracks, ...clusters(frames)])]);
}
