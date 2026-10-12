import { describe, expect, it } from 'vitest';
import { ShadowQuality } from '../../world/render-setup';
import { SHADOW_RAYS, planTick, remainingMs } from '../gpu/final-view';

describe('Render View passes', () => {
  it('queue whole passes when they fit the frame budget, never more than the target needs or eight', () => {
    expect(planTick(100 * 50 * 3.5, 100, 50, 0, 64)).toEqual({ passes: 3, rows: 0 });
    expect(planTick(100 * 50 * 3.5, 100, 50, 0, 2)).toEqual({ passes: 2, rows: 0 });
    expect(planTick(100 * 50 * 100, 100, 50, 0, 1000)).toEqual({ passes: 8, rows: 0 });
  });

  it('cut a pass that does not fit into strips of rows, finishing the rows left', () => {
    expect(planTick(100 * 20, 100, 50, 0, 64)).toEqual({ passes: 0, rows: 20 });
    expect(planTick(100 * 20, 100, 50, 40, 64)).toEqual({ passes: 0, rows: 10 });
    // A pass under way is finished strip by strip even if a whole pass would fit now.
    expect(planTick(100 * 50 * 4, 100, 50, 10, 64)).toEqual({ passes: 0, rows: 40 });
    expect(planTick(1, 100, 50, 0, 64)).toEqual({ passes: 0, rows: 1 });
  });

  it('count the time left from the measured pass', () => {
    expect(remainingMs(16, 64, 50)).toBe(2400);
    expect(remainingMs(64, 64, 50)).toBe(0);
    expect(remainingMs(70, 64, 50)).toBe(0);
  });

  it('draw hard, one or four shadow rays per light', () => {
    expect(SHADOW_RAYS[ShadowQuality.Off]).toBe(0);
    expect(SHADOW_RAYS[ShadowQuality.Low]).toBe(1);
    expect(SHADOW_RAYS[ShadowQuality.High]).toBeGreaterThan(1);
  });
});
