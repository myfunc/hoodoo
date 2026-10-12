import { describe, expect, it } from 'vitest';
import { LatheProfile } from '../../model/scene.enums';
import { knightSpec } from '../chess.profiles';
import { KNIGHT_HEADS, KNIGHT_STYLE, KnightStyle } from '../knight.heads';
import { compileProfile } from '../lathe';
import { CORNER_MARK, type CompiledHead, compileHead, fieldAt, headSdf, outlineDistance, smoothLoop } from '../lathe-head';
import { LATHE_PROFILES } from '../lathe.profiles';

const STYLES = Object.values(KnightStyle);
/** A unit square, corners sharp, then a circle of plain points. */
const SQUARE = compileHead({
  outline: [[0, 0, true], [10, 0, true], [10, 10, true], [0, 10, true]],
  width: { base: 3, perX: 0, perY: 0, min: 3, max: 3 },
  bevel: { base: 0, perX: 0, perY: 0, min: 0, max: 0 },
  slope: 1,
  soft: 0,
  ears: { from: 100, half: 0, thick: 0 },
  dents: [],
}, 0, 1);
const CIRCLE = compileHead({
  outline: Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * 10, Math.sin((i / 16) * Math.PI * 2) * 10] as const),
  width: { base: 3, perX: 0, perY: 0, min: 3, max: 3 },
  bevel: { base: 0, perX: 0, perY: 0, min: 0, max: 0 },
  slope: 1,
  soft: 0,
  ears: { from: 100, half: 0, thick: 0 },
  dents: [],
}, 0, 1);
const dist = (h: CompiledHead, x: number, y: number) => outlineDistance(h.outline, h.normals, x, y);
const gradientAngle = (h: CompiledHead, x: number, y: number) => {
  const e = 1e-6;
  return Math.atan2(dist(h, x, y + e) - dist(h, x, y - e), dist(h, x + e, y) - dist(h, x - e, y));
};

describe('carved heads', () => {
  it('turn their side view counter-clockwise and mark the sharp corners', () => {
    const { points, corners } = smoothLoop([[0, 0, true], [0, 10, true], [10, 10, true], [10, 0, true]]);
    const area = points.reduce((s, p, i) => s + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0);
    expect(area).toBeGreaterThan(0);
    expect(corners.filter(Boolean)).toHaveLength(4);
    const lengths = SQUARE.normals.map((n) => Math.hypot(...n));
    expect(lengths.filter((l) => Math.abs(l - CORNER_MARK) < 1e-9)).toHaveLength(4);
    expect(lengths.filter((l) => Math.abs(l - 1) < 1e-9)).toHaveLength(lengths.length - 4);
  });

  it('measure the side view: negative inside, the true distance on flat sides and round sharp corners', () => {
    expect(dist(SQUARE, 5, 5)).toBeCloseTo(-5);
    expect(dist(SQUARE, 5, 12)).toBeCloseTo(2);
    expect(dist(SQUARE, 13, 14)).toBeCloseTo(5);
    expect(dist(SQUARE, 9, 9)).toBeCloseTo(-1);
  });

  it('bend each edge so the surface turns smoothly, not in flat steps', () => {
    // Just inside a 16-sided circle the gradient follows the angle round it, not each edge's own.
    for (let a = 0.05; a < Math.PI * 2; a += 0.1) {
      const r = 9.8;
      const turn = gradientAngle(CIRCLE, Math.cos(a) * r, Math.sin(a) * r);
      const off = Math.abs(Math.atan2(Math.sin(turn - a), Math.cos(turn - a)));
      expect(off).toBeLessThan(0.05);
    }
  });

  it('carve the head: inside its width, nothing past it, a gap between the ears', () => {
    const head = LATHE_PROFILES[LatheProfile.Knight].head!;
    const [x0, y0, x1, y1] = head.box;
    const mid: [number, number] = [(x0 + x1) / 2 - (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.55];
    expect(headSdf(head, [mid[0], mid[1], 0])).toBeLessThan(0);
    expect(headSdf(head, [mid[0], mid[1], head.width.max * 1.2])).toBeGreaterThan(0);
    expect(headSdf(head, [x0 + (x1 - x0) * 0.3, (head.ears.from + y1) / 2, 0])).toBeGreaterThan(0);
    // Each hollow sits on the surface: its centre lies `radius - depth` outside.
    for (const [x, y, z] of head.dents) expect(headSdf(head, [x, y, z], false)).toBeGreaterThan(0);
    for (const [x, y, z, r] of head.dents) expect(headSdf(head, [x, y, z - r], false)).toBeLessThan(0);
  });

  it('come in five styles, each wider at the cheek than at the muzzle, the tournament head by default', () => {
    expect(STYLES).toHaveLength(5);
    expect(KNIGHT_STYLE).toBe(KnightStyle.Tournament);
    expect(LATHE_PROFILES[LatheProfile.Knight]).toEqual(compileProfile(knightSpec(KnightStyle.Tournament)));
    for (const style of STYLES) {
      const h = KNIGHT_HEADS[style];
      // Wide and firm: the cheek is at least 19 mm across, the muzzle narrower but still broad.
      expect(fieldAt(h.width, 6, 42) * 2).toBeGreaterThanOrEqual(19);
      expect(fieldAt(h.width, 21, 41)).toBeLessThan(fieldAt(h.width, 6, 42));
      expect(fieldAt(h.width, 21, 41) * 2).toBeGreaterThan(13);
      const p = compileProfile(knightSpec(style));
      expect(p.head!.dents.length).toBeLessThanOrEqual(4);
      expect(p.head!.grooves.length).toBeLessThanOrEqual(2);
    }
  });
});
