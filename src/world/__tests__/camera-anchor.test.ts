import { describe, expect, it } from 'vitest';
import { type Vec3, dot, length, normalize, sub } from '../../core/vec3';
import { cameraAxes, dollyToward, orbitAbout } from '../camera-math';
import { DEFAULT_CAMERA } from '../scene.defaults';

/** Where a point sits in the picture: its direction in the camera's own axes. */
function seen(c: typeof DEFAULT_CAMERA, p: Vec3): Vec3 {
  const a = cameraAxes(c);
  const d = normalize(sub(p, c.position));
  return [dot(d, a.right), dot(d, a.up), dot(d, a.forward)];
}

const POINT: Vec3 = [3, 0.5, -4];
const CLOSE = 6;

describe('camera round a point', () => {
  it('orbits keeping the grabbed point where it was in the picture, at the same distance', () => {
    const c = DEFAULT_CAMERA;
    const next = orbitAbout(c, POINT, 35, -12);
    seen(next, POINT).forEach((v, i) => expect(v).toBeCloseTo(seen(c, POINT)[i], CLOSE));
    expect(length(sub(next.position, POINT))).toBeCloseTo(length(sub(c.position, POINT)), CLOSE);
    expect(next.yaw).toBe(c.yaw + 35);
  });

  it('zooms toward the point under the pointer, which stays put, and focuses on it', () => {
    const c = DEFAULT_CAMERA;
    const next = dollyToward(c, POINT, 0.5);
    seen(next, POINT).forEach((v, i) => expect(v).toBeCloseTo(seen(c, POINT)[i], CLOSE));
    expect(length(sub(next.position, POINT))).toBeCloseTo(length(sub(c.position, POINT)) / 2, CLOSE);
    expect(next.focus).toBeCloseTo(dot(sub(POINT, next.position), cameraAxes(next).forward), CLOSE);
  });
});
