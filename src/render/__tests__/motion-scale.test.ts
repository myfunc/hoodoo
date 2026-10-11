import { describe, expect, it } from 'vitest';
import { MOTION_SCALE, MotionScale } from '../gpu/motion-scale';

const FULL = 1000 * 800;
/** Cost per pixel at which a full-size frame takes exactly the budget. */
const FIT = MOTION_SCALE.frameMs / FULL;

describe('Live picture size while moving', () => {
  it('shrinks at once when frames get too expensive', () => {
    const m = new MotionScale(1);
    m.measured(FIT * 4, FULL);
    expect(m.scale).toBeCloseTo(0.5, 5);
  });

  it('climbs back one step at a time after a calm stretch', () => {
    const m = new MotionScale(0.5);
    // Room for exactly the margin: the full calm stretch per step.
    const ideal = 0.5 + MOTION_SCALE.step * MOTION_SCALE.upMargin;
    const cost = FIT / (ideal * ideal);
    for (let i = 0; i < MOTION_SCALE.upFrames - 1; i++) m.measured(cost, FULL);
    expect(m.scale).toBe(0.5);
    m.measured(cost, FULL);
    expect(m.scale).toBe(0.5 + MOTION_SCALE.step);
  });

  it('climbs a long way faster, still one step at a time', () => {
    const m = new MotionScale(0.5);
    let frames = 0;
    let last = m.scale;
    // Half the cost of a full frame at the budget: room to spare all the way up.
    while (m.scale < 1 && frames < MOTION_SCALE.upFrames * 8) {
      m.measured(FIT / 2, FULL);
      frames++;
      expect(m.scale - last).toBeLessThanOrEqual(MOTION_SCALE.step + 1e-9);
      last = m.scale;
    }
    // Eight steps in fewer frames than eight full calm stretches.
    expect(m.scale).toBe(1);
    expect(frames).toBeLessThan(MOTION_SCALE.upFrames * 4);
  });

  it('holds still when the cost wobbles around the budget', () => {
    const m = new MotionScale(1);
    const seen = new Set<number>();
    // ±15% noise around a cost where 0.75 fits the budget.
    const base = FIT / (0.75 * 0.75);
    for (let i = 0; i < 600; i++) {
      m.measured(base * (1 + 0.15 * Math.sin(i * 1.7)), FULL);
      if (i > 60) seen.add(m.scale);
    }
    expect(seen.size).toBe(1);
  });

  it('without timers backs off from a size the GPU cannot keep up with', () => {
    const m = new MotionScale(1);
    // The GPU finishes a frame in time only below 0.7 of full size.
    let changes = 0;
    let last = m.scale;
    for (let i = 0; i < 3000; i++) {
      m.paced(m.scale > 0.7);
      if (m.scale !== last) changes++;
      last = m.scale;
    }
    expect(m.scale).toBeLessThanOrEqual(0.7);
    expect(m.scale).toBeGreaterThan(0.6);
    // A few probes upward, each waiting longer than the last: not a flip every frame.
    expect(changes).toBeLessThan(30);
  });

  it('never leaves its range', () => {
    const m = new MotionScale(0.3);
    m.measured(FIT * 1000, FULL);
    expect(m.scale).toBe(MOTION_SCALE.minScale);
    const n = new MotionScale(1);
    for (let i = 0; i < 200; i++) n.measured(FIT / 10, FULL);
    expect(n.scale).toBe(1);
  });
});
