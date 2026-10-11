import { describe, expect, it } from 'vitest';
import { orbit } from '../../world/camera-math';
import { DEFAULT_CAMERA } from '../../world/scene.defaults';
import { OrbitSpeed } from '../../world/settings';
import { ORBIT_DEG_PER_PX, TRACKPAD_ORBIT_DEG_PER_PX } from '../input.constants';
import { orbitDrag } from '../orbit-drag';

describe('orbit drag', () => {
  it('keep Normal exactly as before and scale both turn axes', () => {
    const dx = 20;
    const dy = 10;
    for (const sensitivity of [ORBIT_DEG_PER_PX, TRACKPAD_ORBIT_DEG_PER_PX]) {
      expect(orbitDrag(DEFAULT_CAMERA, dx, dy, OrbitSpeed.Normal, sensitivity))
        .toEqual(orbit(DEFAULT_CAMERA, -dx * sensitivity, dy * sensitivity));
      const slow = orbitDrag(DEFAULT_CAMERA, dx, dy, OrbitSpeed.Slow, sensitivity);
      const fast = orbitDrag(DEFAULT_CAMERA, dx, dy, OrbitSpeed.Fast, sensitivity);
      expect(fast.yaw - DEFAULT_CAMERA.yaw).toBeCloseTo(4 * (slow.yaw - DEFAULT_CAMERA.yaw));
      expect(fast.pitch - DEFAULT_CAMERA.pitch).toBeCloseTo(4 * (slow.pitch - DEFAULT_CAMERA.pitch));
    }
  });
});
