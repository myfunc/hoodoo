import { describe, expect, it } from 'vitest';
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

  it('share their constants with the shader', () => {
    expect(lathe).toContain(`#define K_LATHE ${ShapeKind.Lathe}\n`);
    expect(lathe).toContain(`#define LATHE_CHUNKS_AT ${LATHE_TEXELS.chunks}\n`);
    expect(lathe).toContain(`#define LATHE_CHUNK ${LATHE_CHUNK}\n`);
    expect(lathe).toContain(`latheTexel(row, ${LATHE_TEXELS.floors})`);
    expect(lathe).toContain(`latheTexel(row, ${LATHE_TEXELS.headBox})`);
    expect(textures).toContain(`#define T_POOLBALL ${TextureKind.PoolBall}\n`);
  });
});
