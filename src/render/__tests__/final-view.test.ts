import { describe, expect, it } from 'vitest';
import { ShadowQuality } from '../../world/render-setup';
import { emptyScene } from '../../world/scene.defaults';
import { MOTION_PASS, SHADOW_RAYS, costChanged, motionScale, planTick, remainingMs } from '../gpu/final-view';

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

  it('draw a moving picture at a size whose pass fits a frame, in steps, never too small', () => {
    expect(motionScale(0)).toBe(1);
    expect(motionScale(MOTION_PASS.frameMs)).toBe(1);
    expect(motionScale(MOTION_PASS.frameMs * 4)).toBe(0.5);
    expect(motionScale(48)).toBe(0.5);
    expect(motionScale(1e6)).toBe(MOTION_PASS.minScale);
  });

  it('find the cost again for other objects or another sky, not for a moved camera', () => {
    const scene = emptyScene();
    expect(costChanged(null, scene)).toBe(true);
    expect(costChanged(scene, { ...scene, camera: { ...scene.camera, yaw: 10 } })).toBe(false);
    expect(costChanged(scene, { ...scene, sky: { ...scene.sky } })).toBe(true);
  });
});
