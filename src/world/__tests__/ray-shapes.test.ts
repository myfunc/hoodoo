import { describe, expect, it } from 'vitest';
import { coneT, cubeT, cylinderT, pyramidT, torusT } from '../ray-shapes';

const DOWN = [0, -1, 0] as const;
const ALONG_Z = [0, 0, -1] as const;

describe('CPU ray tests of the primitives', () => {
  it('a torus is hit on its tube and missed through its hole', () => {
    expect(torusT([0, 0, 5], [...ALONG_Z], 0.3)).toBeCloseTo(4, 3);
    expect(torusT([0, 5, 0], [...DOWN], 0.3)).toBe(Infinity);
    expect(torusT([0.7, 5, 0], [...DOWN], 0.3)).toBeCloseTo(4.7, 3);
    // A thin ring: the box around it is no longer a hit.
    expect(torusT([0, 0.5, 5], [...ALONG_Z], 0.025)).toBe(Infinity);
  });

  it('cylinder, cone and pyramid follow their surfaces, not their boxes', () => {
    expect(cylinderT([0.9, 5, 0.9], [...DOWN])).toBe(Infinity);
    expect(cylinderT([0, 0, 5], [...ALONG_Z])).toBeCloseTo(4, 6);
    expect(coneT([0, 0.9, 5], [...ALONG_Z])).toBeCloseTo(5 - 0.05, 6);
    expect(coneT([0.9, 5, 0], [...DOWN])).toBeCloseTo(5 - (1 - 2 * 0.9), 6);
    expect(pyramidT([0, 5, 0], [...DOWN])).toBeCloseTo(4, 6);
    expect(pyramidT([0.9, 0.9, 5], [...ALONG_Z])).toBe(Infinity);
    expect(cubeT([0.9, 0.9, 5], [...ALONG_Z])).toBeCloseTo(4, 6);
  });

  it('from inside, the exit counts', () => {
    expect(cubeT([0, 0, 0], [...ALONG_Z])).toBeCloseTo(1, 6);
    expect(cylinderT([0, 0, 0], [...ALONG_Z])).toBeCloseTo(1, 6);
  });
});
