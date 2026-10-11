import { describe, expect, it } from 'vitest';
import { dot, length } from '../../core/vec3';
import { shownAxis, widestGap } from '../wire/gizmo';

describe('gizmo layout', () => {
  it('a ring that faces the eye is drawn as it is', () => {
    expect(shownAxis([0, 0, 1], [0, 0, -1], 0.3)).toEqual([0, 0, 1]);
  });

  it('a ring seen edge-on leans toward the eye just enough to open, keeping its side', () => {
    const eye = [0, -0.1, -0.995] as const;
    const a = shownAxis([0, 1, 0], eye, 0.3);
    expect(length(a)).toBeCloseTo(1, 6);
    expect(dot(a, eye)).toBeCloseTo(-0.3, 4);
    expect(a[1]).toBeGreaterThan(0.9);
    const b = shownAxis([1, 0, 0], [0, 0, -1], 0.3);
    expect(dot(b, [0, 0, -1])).toBeCloseTo(-0.3, 6);
  });

  it('the even square goes in the widest gap between the axes on screen', () => {
    expect(widestGap([0, Math.PI / 2])).toBeCloseTo(Math.PI * 1.25);
    expect(widestGap([-Math.PI / 2, Math.PI / 2, Math.PI])).toBeCloseTo(0);
  });
});
