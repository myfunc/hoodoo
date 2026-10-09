import { describe, expect, it } from 'vitest';
import { muxWebm, vint } from '../webm-muxer';

interface El { id: number; start: number; size: number }

/** Reads one EBML element header at `at`: id bytes keep their marker, sizes drop it. */
function readEl(b: Uint8Array, at: number): El {
  let idLen = 1;
  while (!(b[at] & (0x80 >> (idLen - 1)))) idLen++;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i];
  const s = at + idLen;
  let sizeLen = 1;
  while (!(b[s] & (0x80 >> (sizeLen - 1)))) sizeLen++;
  let size = b[s] & (0xff >> sizeLen);
  for (let i = 1; i < sizeLen; i++) size = size * 256 + b[s + i];
  return { id, start: s + sizeLen, size };
}

function children(b: Uint8Array, parent: El): El[] {
  const out: El[] = [];
  for (let at = parent.start; at < parent.start + parent.size;) {
    const e = readEl(b, at);
    out.push(e);
    at = e.start + e.size;
  }
  return out;
}

describe('webm muxer', () => {
  it('encodes EBML sizes with a length marker', () => {
    expect([...vint(5)]).toEqual([0x85]);
    expect([...vint(200)]).toEqual([0x40, 200]);
  });

  it('writes a header, a segment with info and tracks, and one block per frame', () => {
    const frames = [0, 1, 2, 3].map((i) => ({ data: new Uint8Array([i, i, i]), timeMs: i * 40, key: i % 2 === 0 }));
    const b = muxWebm({ codec: 'V_VP9', width: 64, height: 48 }, frames, 160);
    const top = children(b, { id: 0, start: 0, size: b.length });
    expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const seg = children(b, top[1]);
    expect(seg.slice(0, 2).map((e) => e.id)).toEqual([0x1549a966, 0x1654ae6b]);
    const clusters = seg.filter((e) => e.id === 0x1f43b675);
    expect(clusters).toHaveLength(2);
    const blocks = clusters.flatMap((c) => children(b, c).filter((e) => e.id === 0xa3));
    expect(blocks).toHaveLength(4);
    expect(blocks.map((e) => b[e.start + 3] === 0x80)).toEqual([true, false, true, false]);
    expect([...b.subarray(blocks[1].start + 4, blocks[1].start + 7)]).toEqual([1, 1, 1]);
  });
});
