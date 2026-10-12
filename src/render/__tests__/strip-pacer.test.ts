import { describe, expect, it } from 'vitest';
import { STRIP_PACE, StripPacer } from '../gpu/strip-pacer';

const BUDGET = 14;

describe('StripPacer', () => {
  it('starts small, and the timer can only make a tick smaller', () => {
    const p = new StripPacer();
    expect(p.next(0, BUDGET)).toBe(STRIP_PACE.startPixels);
    expect(p.next(BUDGET / 20000, BUDGET)).toBe(20000);
    expect(p.next(BUDGET / 1000, BUDGET)).toBe(STRIP_PACE.minPixels);
    expect(p.next(BUDGET / 1e9, BUDGET)).toBe(STRIP_PACE.startPixels);
  });

  it('grows at most twofold a tick while ticks come back early, whatever the timer predicts', () => {
    const p = new StripPacer();
    let n = p.next(1e-9, BUDGET);
    for (let i = 0; i < 4; i++) {
      p.queued(n);
      p.finished(1, BUDGET);
      const next = p.next(1e-9, BUDGET);
      expect(next).toBe(n * STRIP_PACE.maxGrowth);
      n = next;
    }
  });

  it('shrinks a tick that ran over to what would have fitted the budget', () => {
    const p = new StripPacer();
    p.queued(300000);
    p.finished(BUDGET * 10, BUDGET);
    expect(p.next(0, BUDGET)).toBe(30000);
    // A tick of a second (a stale cost, a scene ten times dearer) leaves only the floor.
    p.queued(30000);
    p.finished(1000, BUDGET);
    expect(p.next(0, BUDGET)).toBe(STRIP_PACE.minPixels);
  });

  it('keeps its size when the fence time is unknown, and counts each tick once', () => {
    const p = new StripPacer();
    p.queued(100000);
    p.finished(null, BUDGET);
    expect(p.next(0, BUDGET)).toBe(STRIP_PACE.startPixels);
    p.finished(1, BUDGET);
    expect(p.next(0, BUDGET)).toBe(STRIP_PACE.startPixels);
  });

  it('starts a change from a share of the size reached, however many changes come in a row', () => {
    const p = new StripPacer();
    p.queued(400000);
    p.finished(BUDGET, BUDGET);
    expect(p.next(0, BUDGET)).toBe(400000);
    p.restart();
    p.restart();
    p.restart();
    expect(p.next(0, BUDGET)).toBe(400000 * STRIP_PACE.restartShare);
  });

  it('watches the fence for a few budgets', () => {
    expect(StripPacer.watchMs(BUDGET)).toBe(BUDGET * STRIP_PACE.watchBudgets);
  });
});
