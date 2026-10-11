import type { Camera } from '../model/scene.types';
import { orbit } from '../world/camera-math';
import { OrbitSpeed } from '../world/settings';
import { ORBIT_DEG_PER_PX } from './input.constants';

const ORBIT_PACE: Readonly<Record<OrbitSpeed, number>> = { [OrbitSpeed.Slow]: 0.5, [OrbitSpeed.Normal]: 1, [OrbitSpeed.Fast]: 2 };

/** Mouse drags and trackpad swipes keep their own sensitivity, scaled by Settings. */
export function orbitDrag(camera: Camera, dx: number, dy: number, speed: OrbitSpeed, sensitivity = ORBIT_DEG_PER_PX): Camera {
  const degrees = sensitivity * ORBIT_PACE[speed];
  return orbit(camera, -dx * degrees, dy * degrees);
}
