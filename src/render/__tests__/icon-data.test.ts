import { describe, expect, it } from 'vitest';
import { compose } from '../../core/mat4';
import { CONTROL_ICON_DATA, CROSS_ARROW, type PieceData, Plane, flatArrows } from '../icon-data';

const NORMAL_AXIS: Record<Plane, number> = { [Plane.XY]: 2, [Plane.XZ]: 1, [Plane.YZ]: 0 };

describe('flat camera-cross arrows', () => {
  it.each(Object.values(Plane))('lie in the %s plane: four heads and four stems, centred on it', (plane) => {
    const pieces = flatArrows(plane, 'teal');
    expect(pieces.filter((p) => p.entry === 'pyramid')).toHaveLength(4);
    expect(pieces.filter((p) => p.entry === 'cube')).toHaveLength(4);
    for (const p of pieces) expect(p.position![NORMAL_AXIS[plane]]).toBe(0);
  });

  it('point along the plane once rotated: no piece reaches further across it than along it', () => {
    for (const plane of Object.values(Plane)) {
      const axis = NORMAL_AXIS[plane];
      for (const p of flatArrows(plane, 'teal')) {
        const m = compose(p.position!, p.rotation!, p.size!);
        // Half-extent of the rotated box along a world axis: the sum over its three columns.
        const extent = (a: number) => Math.abs(m[a]) + Math.abs(m[4 + a]) + Math.abs(m[8 + a]);
        expect(extent(axis)).toBeLessThan(Math.max(extent((axis + 1) % 3), extent((axis + 2) % 3)));
      }
    }
  });

  it('scale around the given centre', () => {
    const near = flatArrows(Plane.XY, 'teal', { k: 0.5, centre: [0, 0, 1] });
    for (const p of near) expect(p.position![2]).toBe(1);
    const head = near.find((p) => p.entry === 'pyramid' && p.position![0] > 0)!;
    expect(head.position![0]).toBeCloseTo(CROSS_ARROW.headAt * 0.5);
  });
});

describe('trackball relief', () => {
  const [ball, ...relief] = CONTROL_ICON_DATA.trackball.pieces;
  const r = ball.size![0];
  const dist = (p: PieceData) => Math.hypot(...p.position!);

  it('is a ball with four arrows: a pole cap, stem blocks and a head each', () => {
    expect(ball.entry).toBe('sphere');
    expect(relief.filter((p) => p.entry === 'cone')).toHaveLength(4);
    expect(relief.filter((p) => p.entry === 'cube').length % 4).toBe(1);
  });

  it('hugs the ball: every piece is centred on its surface, none floats in front of it', () => {
    for (const p of relief) expect(Math.abs(dist(p) - r)).toBeLessThan(r * 0.05);
  });

  it('lays every piece tangent to the ball: its local z axis points out from the centre', () => {
    for (const p of relief) {
      const m = compose([0, 0, 0], p.rotation!, [1, 1, 1]);
      const z = [m[8], m[9], m[10]];
      const out = p.position!.map((v) => v / dist(p));
      expect(z[0] * out[0] + z[1] * out[1] + z[2] * out[2]).toBeCloseTo(1, 5);
    }
  });

  it('keeps the arrow tips inside the ball outline', () => {
    for (const p of relief.filter((a) => a.entry === 'cone')) {
      const radial = Math.hypot(p.position![0], p.position![1]);
      expect(radial + p.size![1]).toBeLessThan(r);
    }
  });
});
