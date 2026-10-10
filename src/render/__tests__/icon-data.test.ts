import { describe, expect, it } from 'vitest';
import { compose } from '../../core/mat4';
import { Plane, flatArrows } from '../icon-data';

const NORMAL_AXIS: Record<Plane, number> = { [Plane.XY]: 2, [Plane.XZ]: 1, [Plane.YZ]: 0 };

describe('flat camera-cross arrows', () => {
  it.each(Object.values(Plane))('lie in the %s plane: four heads and four stems, centred on it', (plane) => {
    const pieces = flatArrows(plane, 'teal');
    expect(pieces.filter((p) => p.entry === 'pyramid')).toHaveLength(4);
    expect(pieces.filter((p) => p.entry === 'cube')).toHaveLength(4);
    for (const p of pieces) expect(p.position![NORMAL_AXIS[plane]]).toBe(0);
  });

  it('keep each piece thin across the plane once rotated', () => {
    for (const plane of Object.values(Plane)) {
      const axis = NORMAL_AXIS[plane];
      for (const p of flatArrows(plane, 'teal')) {
        const m = compose(p.position!, p.rotation!, p.size!);
        // Half-extent of the rotated box along a world axis: the sum over its three columns.
        const extent = (a: number) => Math.abs(m[a]) + Math.abs(m[4 + a]) + Math.abs(m[8 + a]);
        expect(extent(axis)).toBeLessThan(Math.min(extent((axis + 1) % 3), extent((axis + 2) % 3)));
      }
    }
  });

  it('scale around the given centre', () => {
    const near = flatArrows(Plane.XY, 'teal', 0.5, [0, 0, 1]);
    for (const p of near) expect(p.position![2]).toBe(1);
    const head = near.find((p) => p.entry === 'pyramid' && p.position![0] > 0)!;
    expect(head.position![0]).toBeCloseTo(0.34);
  });
});
