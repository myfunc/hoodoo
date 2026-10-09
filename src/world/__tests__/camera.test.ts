import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA } from '../scene.defaults';
import { cameraBasis, lookAt, orbit, pivotOf, project } from '../camera-math';

describe('camera math', () => {
  it('orbit keeps the pivot', () => {
    const before = pivotOf(DEFAULT_CAMERA);
    const after = pivotOf(orbit(DEFAULT_CAMERA, 40, 15));
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i]));
  });

  it('projects the look-at target to the centre', () => {
    const cam = lookAt(DEFAULT_CAMERA, [3, 1, -4]);
    const p = project(cameraBasis(cam, 4 / 3), [3, 1, -4]);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.depth).toBeGreaterThan(0);
  });
});
