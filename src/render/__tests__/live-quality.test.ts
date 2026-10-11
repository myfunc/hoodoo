import { describe, expect, it } from 'vitest';
import { LiveQuality } from '../../world/world.enums';
import { LIVE_MODES, raysWorth } from '../gpu/live-quality';

describe('Live quality', () => {
  it('Fast is the 0.6.3 preview: the interaction tracer, nothing reused or refined', () => {
    const m = LIVE_MODES[LiveQuality.Fast];
    expect(m.fast).toBe(true);
    expect(m.refine).toBe(false);
    expect(m.keep).toBe(0);
  });

  it('Full traces with the full tracer at the settled depth; Detailed goes deeper and reuses frames', () => {
    const full = LIVE_MODES[LiveQuality.Full];
    const detailed = LIVE_MODES[LiveQuality.Detailed];
    expect(full.fast).toBe(false);
    expect(full.bounces).toBe(LIVE_MODES[LiveQuality.Fast].bounces);
    expect(detailed.fast).toBe(false);
    expect(detailed.bounces).toBeGreaterThan(full.bounces);
    expect(detailed.keep).toBeGreaterThan(0);
    expect(detailed.keep).toBeLessThan(1);
  });

  it('a fresh frame is worth one ray', () => {
    expect(raysWorth(0, 0.75)).toBe(1);
    expect(raysWorth(5, 0)).toBe(1);
  });

  it('frames kept under a still camera add up to (1 + keep) / (1 − keep) rays, never more than a plain average', () => {
    const keep = 0.75;
    let worth = 1;
    for (let i = 0; i < 200; i++) worth = raysWorth(worth, keep);
    // The fixed point of w = 1 / (keep² / w + (1 − keep)²).
    expect(worth).toBeCloseTo((1 + keep) / (1 - keep), 3);
    let plain = 1;
    let kept = 1;
    for (let i = 0; i < 4; i++) {
      plain += 1;
      kept = raysWorth(kept, keep);
      expect(kept).toBeLessThanOrEqual(plain);
    }
  });
});
