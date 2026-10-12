import { describe, expect, it } from 'vitest';
import { LatheProfile } from '../../model/scene.enums';
import { CHESS_SPECS } from '../chess.profiles';
import { arc, compileProfile, inCut, notches, radiusAt, slit, tessellate } from '../lathe';
import { LATHE_PROFILES, latheIndex, latheProfile } from '../lathe.profiles';

const EPS = 1e-9;

describe('lathe profiles', () => {
  it('compile a cylinder to the unit box: height -1..1, aspect = radius / half-height', () => {
    const p = compileProfile({ name: 'Drum', outline: [[0, 0, true], [5, 0, true], [5, 20, true], [0, 20, true]] });
    expect(p.aspect).toBeCloseTo(0.5);
    expect(p.halfSize).toEqual([5, 10, 5]);
    expect(p.segments[0].y0).toBeCloseTo(-1);
    expect(p.segments.at(-1)!.y1).toBeCloseTo(1);
    expect(radiusAt(p.segments, 0)).toBeCloseTo(0.5);
    expect(radiusAt(p.segments, 1.5)).toBe(-1);
    // Corners keep their own normals: the side faces straight out, the top straight up.
    const side = p.segments.filter((s) => s.r0 === s.r1 && s.r0 > 0);
    const top = p.segments.filter((s) => s.y0 === s.y1 && s.r1 < s.r0);
    expect(side[0].n0[0]).toBeCloseTo(1);
    expect(side.at(-1)!.n1[1]).toBeCloseTo(0);
    expect(top[0].n0[1]).toBeCloseTo(1);
  });

  it('smooth curves through plain points, never letting the height go down', () => {
    const { points } = tessellate([[0, 0, true], [4, 0, true], [6, 3], [3, 6], [5, 9], [0, 12, true]]);
    for (let i = 1; i < points.length; i++) expect(points[i][1]).toBeGreaterThanOrEqual(points[i - 1][1]);
    expect(points.at(-1)).toEqual([0, 12]);
    expect(points.length).toBeGreaterThan(6);
  });

  it('draw arcs on the circle', () => {
    for (const [r, y] of arc(0, 10, 4, -60, 90, 6)) expect(Math.hypot(r, y - 10)).toBeCloseTo(4);
  });

  it.each(LATHE_PROFILES.map((p) => [p.name, p] as const))('%s spans the unit box from the axis to the axis', (_, p) => {
    expect(p.segments[0].r0).toBe(0);
    expect(p.segments.at(-1)!.r1).toBeCloseTo(0);
    const ys = p.segments.flatMap((s) => [s.y0, s.y1]);
    expect(Math.min(...ys)).toBeCloseTo(-1);
    expect(Math.max(...ys, ...p.blocks.map((b) => b.center[1] + b.half[1]), ...(p.head ? [p.head.box[3]] : []))).toBeCloseTo(1);
    for (let i = 1; i < p.segments.length; i++) {
      expect(p.segments[i].y0).toBeCloseTo(p.segments[i - 1].y1);
      expect(p.segments[i].r0).toBeCloseTo(p.segments[i - 1].r1);
    }
    for (const s of p.segments) {
      expect(Math.max(s.r0, s.r1)).toBeLessThanOrEqual(p.aspect + EPS);
      expect(Math.hypot(...s.n0)).toBeCloseTo(1);
    }
  });

  it('follow the Staunton heights: king > queen > bishop > knight > rook > pawn', () => {
    const height = (k: LatheProfile) => LATHE_PROFILES[k].halfSize[1];
    const order = [LatheProfile.King, LatheProfile.Queen, LatheProfile.Bishop, LatheProfile.Knight, LatheProfile.Rook, LatheProfile.Pawn];
    for (let i = 1; i < order.length; i++) expect(height(order[i])).toBeLessThan(height(order[i - 1]));
    expect(CHESS_SPECS.map((s) => s.name)).toEqual(['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King']);
  });

  it('give the rook, bishop and queen cuts above their collars, the king a cross, the knight a head', () => {
    const p = (k: LatheProfile) => LATHE_PROFILES[k];
    expect(p(LatheProfile.Pawn).cutFloor).toBe(Infinity);
    for (const k of [LatheProfile.Rook, LatheProfile.Bishop, LatheProfile.Queen]) expect(p(k).cutFloor).toBeGreaterThan(0);
    expect(p(LatheProfile.Rook).cut!.copies).toBe(6);
    expect(p(LatheProfile.King).blocks).toHaveLength(2);
    expect(p(LatheProfile.King).blockFloor).toBeGreaterThan(0.5);
    expect(p(LatheProfile.Knight).head!.outline.length).toBeGreaterThan(20);
  });

  it('cut notches all round and a slit on one side', () => {
    const crown = notches(4, 10, 1, 2);
    expect(inCut(crown, [5, 11, 0])).toBe(true);
    expect(inCut(crown, [0, 11, -5])).toBe(true);
    expect(inCut(crown, [5, 9, 0])).toBe(false);
    expect(inCut(crown, [5, 11, 2])).toBe(false);
    expect(inCut(crown, [1, 11, 0])).toBe(false);
    const cut = slit([0, 10], [0, 1], 0.5, -1, 5);
    expect(inCut(cut, [3, 10.2, 0])).toBe(true);
    expect(inCut(cut, [-3, 10.2, 0])).toBe(false);
    expect(inCut(cut, [3, 11, 0])).toBe(false);
  });

  it('read any number as a profile, kept in range', () => {
    expect(latheIndex(2.4)).toBe(LatheProfile.Knight);
    expect(latheIndex(-3)).toBe(LatheProfile.Pawn);
    expect(latheIndex(99)).toBe(LatheProfile.Pedestal);
    expect(latheIndex(Number.NaN)).toBe(LatheProfile.Pawn);
    expect(latheProfile(LatheProfile.Queen).name).toBe('Queen');
    expect(latheProfile(LatheProfile.Column).name).toBe('Column');
  });

  it('flutes a column with V grooves round its shaft, not its base or capital', () => {
    const column = latheProfile(LatheProfile.Column);
    const cut = column.cut!;
    expect(cut.copies).toBe(20);
    // On the surface of the shaft halfway up: inside a groove on its middle line, solid between two grooves.
    const r = radiusAt(column.segments, 0) - 0.005;
    const between = Math.PI / cut.copies;
    expect(inCut(cut, [r, 0, 0])).toBe(true);
    expect(inCut(cut, [r * Math.cos(between), 0, r * Math.sin(between)])).toBe(false);
    expect(inCut(cut, [r, 0.97, 0])).toBe(false);
    expect(inCut(cut, [r, -0.97, 0])).toBe(false);
  });
});
