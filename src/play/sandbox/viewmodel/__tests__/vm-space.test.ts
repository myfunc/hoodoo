import { describe, expect, it } from 'vitest';
import { Bob, Lag, REST_POSE } from '../vm-motion';
import { angleMatrix, invert34, mul34, perspective, transform4, viewmodelMatrix, vmVerticalFov } from '../vm-space';

const close = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe('viewmodel frames', () => {
  it('Source angles: pitch down tips forward below the horizon, yaw turns forward to the left', () => {
    const down = angleMatrix(30, 0, 0);
    // Forward is the first column.
    close([down[0], down[3], down[6]], [Math.cos(Math.PI / 6), 0, -0.5]);
    const left = angleMatrix(0, 90, 0);
    close([left[0], left[3], left[6]], [0, 1, 0]);
  });

  it('the gun frame maps Source forward to −z, left to −x and up to +y on the GPU', () => {
    const m = viewmodelMatrix(REST_POSE);
    close(transform4(m, [10, 0, 0]), [0, 0, -10]);
    close(transform4(m, [0, 10, 0]), [-10, 0, 0]);
    close(transform4(m, [0, 0, 10]), [0, 10, 0]);
    const moved = viewmodelMatrix({ ...REST_POSE, forward: 2, right: 3, up: 1 });
    close(transform4(moved, [0, 0, 0]), [3, 1, -2]);
  });

  it('a viewmodel FOV of 54 on the 4:3 reference is about 41.9° tall', () => {
    expect(vmVerticalFov(54)).toBeCloseTo(41.86, 1);
    const p = perspective(60, 1.5, 1, 100);
    expect(p[5]).toBeCloseTo(1 / Math.tan(Math.PI / 6), 6);
  });

  it('3×4 inverse undoes a frame', () => {
    const r = angleMatrix(10, 20, 30);
    const m = Float32Array.from([r[0], r[1], r[2], 5, r[3], r[4], r[5], -2, r[6], r[7], r[8], 7]);
    close(Array.from(mul34(m, invert34(m))), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 1e-5);
  });
});

describe('viewmodel motion', () => {
  it('does not bob standing still and bobs within Source’s limits at full speed', () => {
    const bob = new Bob();
    bob.update(0.1, 0);
    expect(bob.apply(REST_POSE)).toEqual({ ...REST_POSE });
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 200; i++) {
      bob.update(0.01, 320);
      lo = Math.min(lo, bob.vertical);
      hi = Math.max(hi, bob.vertical);
    }
    expect(hi).toBeLessThanOrEqual(4);
    expect(lo).toBeGreaterThanOrEqual(-7);
    expect(hi - lo).toBeGreaterThan(1);
  });

  it('the gun trails a quick turn and settles', () => {
    const lag = new Lag();
    const axes = (yaw: number) => {
      const f: [number, number, number] = [-Math.sin(yaw), 0, -Math.cos(yaw)];
      return { forward: f, right: [Math.cos(yaw), 0, -Math.sin(yaw)] as [number, number, number], up: [0, 1, 0] as [number, number, number] };
    };
    lag.update(0.01, axes(0));
    lag.update(0.01, axes(0.2));
    const p = lag.apply(REST_POSE, axes(0.2), 0);
    // Turning left (yaw up) leaves the gun to the right.
    expect(p.right).toBeGreaterThan(0.1);
    for (let i = 0; i < 200; i++) lag.update(0.01, axes(0.2));
    expect(Math.abs(lag.apply(REST_POSE, axes(0.2), 0).right)).toBeLessThan(1e-3);
  });
});
