import { describe, expect, it } from 'vitest';
import { MIN_NOTCH_GAP, notchAt, notchSteps, notchStride, stepAt } from '../history-panel';

describe('history timeline', () => {
  it('spreads the steps from end to end, a lone step in the middle', () => {
    expect(notchAt(0, 5)).toBe(0);
    expect(notchAt(2, 5)).toBe(0.5);
    expect(notchAt(4, 5)).toBe(1);
    expect(notchAt(0, 1)).toBe(0.5);
  });

  it('picks the nearest step under the pointer, clamped to the rail', () => {
    expect(stepAt(0, 5)).toBe(0);
    expect(stepAt(0.4, 5)).toBe(2);
    expect(stepAt(0.9, 5)).toBe(4);
    expect(stepAt(-0.3, 5)).toBe(0);
    expect(stepAt(1.7, 5)).toBe(4);
    expect(stepAt(0.7, 1)).toBe(0);
  });

  it('draws every notch while they fit and thins them out when they would crowd', () => {
    expect(notchStride(15, 150)).toBe(1);
    const stride = notchStride(200, 150);
    expect(stride).toBeGreaterThan(1);
    // The drawn notches never sit closer than the minimum gap.
    expect((150 / 199) * stride).toBeGreaterThanOrEqual(MIN_NOTCH_GAP);
    expect(notchStride(200, 0)).toBe(1);
  });

  it('always keeps the first and the last step', () => {
    expect(notchSteps(5, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(notchSteps(10, 4)).toEqual([0, 4, 8, 9]);
    expect(notchSteps(9, 4)).toEqual([0, 4, 8]);
    expect(notchSteps(0, 1)).toEqual([]);
  });
});
