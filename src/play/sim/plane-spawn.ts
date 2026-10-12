import { type Vec3, add, dot, scale, sub } from '../../core/vec3';
import type { Scene } from '../../model/scene.types';
import { transformAt } from '../../world/animation/pose';
import { sceneFrames } from '../../world/group-pose';
import type { Eye } from './actor';
import type { PlaneStart } from './plane-actor';
import { type FlightTuning, NOSE, PLANE, headingQ } from './plane-flight';
import type { PlaneInScene } from './plane-model';
import type { Physics } from './physics';
import { type Quat, quatOfEuler, rotateQ } from './quat';

const DEG = Math.PI / 180;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Throttle that holds `speed` in level flight (thrust against drag). */
const holding = (t: FlightTuning, speed: number): number => clamp01((speed / t.maxSpeed) ** 2);

/** On the ground when it is near under `at`: the ball resting on it, standing still. */
function landed(physics: Physics, t: FlightTuning, at: Vec3, rotation: Quat): PlaneStart | null {
  const r = t.hullRadius;
  const below = physics.raycast(at, [0, -1, 0], r * PLANE.touch.start);
  if (!below || below.normal[1] < PLANE.touch.floor) return null;
  const lift = (r + PLANE.bump.skin * t.size) / below.normal[1];
  return { position: [at[0], below.point[1] + lift, at[2]], rotation, speed: 0, throttle: 0, ground: below.normal };
}

/** The plane a take recorded, where the scene has it at `time`, as fast as its keys carry it there. */
function recordedStart(physics: Physics, scene: Scene, time: number, t: FlightTuning, rec: PlaneInScene): PlaneStart | null {
  const frame = sceneFrames(scene)(rec.group);
  if (!frame) return null;
  const rotation = quatOfEuler(frame.rotation);
  const a = scene.animation;
  const keys = a.groups?.[rec.group];
  let speed = 0;
  if (a.enabled && keys?.length) {
    const dt = 1 / a.fps;
    speed = Math.max(0, dot(sub(transformAt(keys, time + dt).position, transformAt(keys, time).position), rotateQ(rotation, NOSE)) / dt);
  }
  if (speed < t.stallSpeed) {
    const ground = landed(physics, t, frame.position, rotation);
    if (ground) return ground;
  }
  return { position: frame.position, rotation, speed, throttle: holding(t, speed) };
}

/**
 * READ ME — where the plane starts. With a plane a take recorded, at the
 * playhead it is there and flying as its keys move it (`recorded`, only when
 * Play starts with the plane). Otherwise ahead of the eye, about where the
 * chase camera would see it, so the view hardly jumps: on the ground when the
 * ground is near under that spot (a take-off), else in the air at cruise speed.
 */
export function planeStart(physics: Physics, scene: Scene, time: number, eye: Eye, t: FlightTuning, recorded: PlaneInScene | null): PlaneStart {
  const fromTake = recorded ? recordedStart(physics, scene, time, t, recorded) : null;
  if (fromTake) return fromTake;
  const yaw = eye.yaw * DEG;
  const flat: Vec3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const want = add(eye.position, add(scale(flat, PLANE.chase.distance * t.size), [0, -PLANE.chase.height * t.size, 0]));
  const sweep = physics.traceBall(eye.position, want, t.hullRadius, PLANE.bump.skin * t.size);
  const at = sweep.startSolid ? eye.position : sweep.end;
  const rotation = headingQ(eye.yaw);
  return landed(physics, t, at, rotation) ?? { position: at, rotation, speed: t.cruiseSpeed, throttle: holding(t, t.cruiseSpeed) };
}
