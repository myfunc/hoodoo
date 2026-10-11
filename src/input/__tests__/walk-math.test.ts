import { describe, expect, it } from 'vitest';
import { length } from '../../core/vec3';
import { FLY_KEYS, WALK_KEYS } from '../bindings';
import { FLY_FAST } from '../input.constants';
import { ScrollDevice } from '../scroll-device';
import { approach, dragResizeFactor, panSpeed, scrollResizeFactor, settled, walkIntent, walkSpeed } from '../walk-math';

const FRAME_60 = 1 / 60;
const FRAME_144 = 1 / 144;

/** Advances a walk from rest for `seconds` in steps of `dt`; returns the distance and the final speed. */
function run(dt: number, seconds: number, target = 10): { distance: number; speed: number } {
  let v = [0, 0, 0] as const as readonly [number, number, number];
  let distance = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    v = approach(v, [0, 0, target], dt);
    distance += v[2] * dt;
  }
  return { distance, speed: v[2] };
}

describe('walk math', () => {
  it('reads the held keys as a unit direction: opposite keys cancel, diagonals are no faster', () => {
    expect(walkIntent(['KeyW'], WALK_KEYS)).toEqual([0, 0, 1]);
    expect(walkIntent(['KeyW', 'KeyS'], WALK_KEYS)).toEqual([0, 0, 0]);
    expect(length(walkIntent(['KeyW', 'KeyD', 'KeyR'], WALK_KEYS))).toBeCloseTo(1);
    expect(walkIntent(['KeyR'], WALK_KEYS)).toEqual([0, 1, 0]);
    expect(walkIntent(['KeyE'], WALK_KEYS)).toEqual([0, 0, 0]);
    expect(walkIntent(['KeyE'], FLY_KEYS)).toEqual([0, 1, 0]);
  });

  it('eases to full speed and walks the same distance at any frame rate', () => {
    const slow = run(FRAME_60, 1);
    const fast = run(FRAME_144, 1);
    expect(slow.speed).toBeCloseTo(10, 2);
    expect(fast.distance).toBeCloseTo(slow.distance, 1);
    // Smooth start: the first frame is far from full speed.
    expect(approach([0, 0, 0], [0, 0, 10], FRAME_60)[2]).toBeLessThan(2);
  });

  it('coasts to a stop', () => {
    let v = [0, 0, 10] as readonly [number, number, number];
    for (let i = 0; i < 60; i++) v = approach(v, [0, 0, 0], FRAME_60);
    expect(settled(v, 10)).toBe(true);
    expect(settled([0, 0, 5], 10)).toBe(false);
  });

  it('scales the speed with the scene and Shift', () => {
    expect(walkSpeed(1000, false)).toBeGreaterThan(walkSpeed(50, false) * 10);
    expect(walkSpeed(0, false)).toBeGreaterThan(0);
    expect(walkSpeed(100, true)).toBeCloseTo(walkSpeed(100, false) * FLY_FAST);
    expect(panSpeed(80, false)).toBeCloseTo(panSpeed(20, false) * 4);
  });

  it('resizes by the drag distance: right grows, left shrinks, back to the press is the start', () => {
    expect(dragResizeFactor(0)).toBe(1);
    expect(dragResizeFactor(200)).toBeCloseTo(2);
    expect(dragResizeFactor(-200)).toBeCloseTo(0.5);
    expect(dragResizeFactor(-100000)).toBeGreaterThan(0);
  });

  it('steps a wheel notch and glides a trackpad or pinch, scrolling away grows', () => {
    const up = scrollResizeFactor(-100, ScrollDevice.Wheel);
    expect(up).toBeCloseTo(1.1);
    expect(scrollResizeFactor(-3, ScrollDevice.Wheel)).toBe(up);
    expect(up * scrollResizeFactor(100, ScrollDevice.Wheel)).toBeCloseTo(1);
    expect(scrollResizeFactor(0, ScrollDevice.Wheel)).toBe(1);
    const glide = scrollResizeFactor(-5, ScrollDevice.Trackpad);
    expect(glide).toBeGreaterThan(1);
    expect(glide).toBeLessThan(up);
    expect(scrollResizeFactor(4, ScrollDevice.Pinch)).toBeLessThan(1);
  });
});
