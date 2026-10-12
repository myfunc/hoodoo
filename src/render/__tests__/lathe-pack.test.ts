import { describe, expect, it } from 'vitest';
import { CORNER_MARK, EAR_TAPER, HEAD_CHUNK } from '../../assets/lathe-head';
import { LATHE_PROFILES } from '../../assets/lathe.profiles';
import { ShapeKind, TextureKind } from '../../model/scene.enums';
import lathe from '../gpu/glsl/36-lathe.glsl?raw';
import textures from '../gpu/glsl/20-textures.glsl?raw';
import { LATHE_CHUNK, LATHE_TEXELS, packLathe } from '../gpu/lathe-pack';
import { TEXEL_FLOATS } from '../gpu/render.constants';

describe('lathe profiles on the GPU', () => {
  const packed = packLathe();
  const texel = (row: number, i: number) => Array.from(packed.data.subarray((row * packed.width + i) * TEXEL_FLOATS, (row * packed.width + i + 1) * TEXEL_FLOATS));

  it('pack a row per profile with its header, chunks and segments', () => {
    expect(packed.rows).toBe(LATHE_PROFILES.length);
    LATHE_PROFILES.forEach((p, row) => {
      const [segs, verts, headAt, copies] = texel(row, LATHE_TEXELS.header);
      const [aspect, blocks, hasHead, segAt] = texel(row, LATHE_TEXELS.info);
      expect(segs).toBe(p.segments.length);
      expect(verts).toBe(p.head?.outline.length ?? 0);
      expect(copies).toBe(p.cut?.copies ?? 0);
      expect(aspect).toBeCloseTo(p.aspect);
      expect(blocks).toBe(p.blocks.length);
      expect(hasHead).toBe(p.head ? 1 : 0);
      expect(segAt).toBe(LATHE_TEXELS.chunks + Math.ceil(segs / LATHE_CHUNK));
      expect(headAt).toBe(segAt + segs * 2);
      const s = p.segments[3];
      expect(texel(row, segAt + 6)).toEqual([s.r0, s.y0, s.r1, s.y1].map(Math.fround));
      // A chunk bounds its segments.
      const [r, y0, y1] = texel(row, LATHE_TEXELS.chunks);
      for (const g of p.segments.slice(0, LATHE_CHUNK)) {
        expect(Math.max(g.r0, g.r1)).toBeLessThanOrEqual(r + 1e-6);
        expect(g.y0).toBeGreaterThanOrEqual(y0 - 1e-6);
        expect(g.y1).toBeLessThanOrEqual(y1 + 1e-6);
      }
    });
  });

  it('pack the head: a point and its normal a texel, then a circle round each chunk of edges', () => {
    LATHE_PROFILES.forEach((p, row) => {
      const head = p.head;
      if (!head) return;
      const [, verts, headAt] = texel(row, LATHE_TEXELS.header);
      const chunksAt = texel(row, LATHE_TEXELS.headMore)[2];
      expect(chunksAt).toBe(headAt + verts);
      expect(texel(row, headAt + 5)).toEqual([...head.outline[5], ...head.normals[5]].map(Math.fround));
      head.chunks.forEach((c, i) => {
        const [cx, cy, r] = texel(row, chunksAt + i);
        for (let k = -1; k < HEAD_CHUNK && i * HEAD_CHUNK + k < verts; k++) {
          const [x, y] = head.outline[(i * HEAD_CHUNK + k + verts) % verts];
          expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(r + 1e-5);
        }
        expect(c.radius).toBeCloseTo(r);
      });
    });
  });

  it('share their constants with the shader', () => {
    expect(lathe).toContain(`#define LATHE_HEAD_CHUNK ${HEAD_CHUNK}\n`);
    expect(lathe).toContain(`#define LATHE_EAR_TAPER ${EAR_TAPER}\n`);
    // The shader tells a corner's half-length normal from a unit one by its squared length.
    expect(CORNER_MARK ** 2).toBeLessThan(0.5);
    expect(lathe).toContain('dot(vi.zw, vi.zw) < 0.5');
    expect(lathe).toContain(`#define K_LATHE ${ShapeKind.Lathe}\n`);
    expect(lathe).toContain(`#define LATHE_CHUNKS_AT ${LATHE_TEXELS.chunks}\n`);
    expect(lathe).toContain(`#define LATHE_CHUNK ${LATHE_CHUNK}\n`);
    expect(lathe).toContain(`latheTexel(row, ${LATHE_TEXELS.floors})`);
    expect(lathe).toContain(`latheTexel(row, ${LATHE_TEXELS.headBox})`);
    expect(textures).toContain(`#define T_POOLBALL ${TextureKind.PoolBall}\n`);
  });
});
