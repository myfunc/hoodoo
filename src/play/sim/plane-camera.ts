import { type Vec3, add, cross, dot, length, lerp3, normalize, scale, sub } from '../../core/vec3';
import type { Eye } from './actor';
import { NOSE, PLANE, axesOf } from './plane-flight';
import type { Pose } from './physics';
import { type Quat, rotateQ, slerpQ } from './quat';

/**
 * READ ME — the plane's cameras. Chase: behind and above the plane, lagging
 * softly (its place eases toward the spot behind the tail, so speed pulls it
 * back and turns swing it out); its up leans with the plane's up but keeps
 * some of the sky's while the plane is upright, so a bank tilts the horizon
 * half as much and a loop still goes all the way round. It stays in front of
 * walls and terrain. Cockpit: the pilot's eyes, turning with the plane. Both
 * widen with speed (the FOV kick). Views are quaternions until the end, where
 * `eyeOfView` reads them as Hoodoo's yaw, pitch and bank.
 */

/** A camera pose: where it is, how it is turned (it looks along −Z), how wide. */
export interface View {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly fov: number;
}

const DEG = Math.PI / 180;
const TINY = 1e-6;
/** Looking this close to straight up or down, the yaw is kept from before (it means nothing there). */
const STRAIGHT = 1e-4;
const FULL_TURN = 360;
const UP: Vec3 = [0, 1, 0];
const BACK: Vec3 = [0, 0, 1];
/** The boost lifts the top speed by about this share: the FOV kick is full there. */
const BOOST_TOP = 1.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const ease = (dt: number, lag: number): number => 1 - Math.exp(-dt / lag);
const near = (a: number, hint: number): number => a + FULL_TURN * Math.round((hint - a) / FULL_TURN);

/** The rotation of a frame with these unit axes (columns x, y, z). */
function quatOfAxes(x: Vec3, y: Vec3, z: Vec3): Quat {
  const trace = x[0] + y[1] + z[2];
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]);
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]);
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]);
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}

/** The turn that looks along `forward` with its up as near `up` as it goes. */
export function lookRotation(forward: Vec3, up: Vec3): Quat {
  const f = normalize(forward);
  let r = cross(f, up);
  if (length(r) < TINY) r = cross(f, Math.abs(f[2]) < 1 / 2 ? BACK : UP);
  const right = normalize(r);
  return quatOfAxes(right, cross(right, f), scale(f, -1));
}

/** Hoodoo's camera angles for a view (world/camera-math cameraAxes, read backwards), each nearest `hint`'s. */
export function eyeOfView(v: View, hint?: Eye): Eye {
  const f = rotateQ(v.rotation, NOSE);
  const up = rotateQ(v.rotation, UP);
  const pitch = Math.asin(Math.min(1, Math.max(-1, f[1])));
  const yaw = Math.hypot(f[0], f[2]) > STRAIGHT ? Math.atan2(-f[0], -f[2]) : (hint?.yaw ?? 0) * DEG;
  const flatRight: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const right = cross(f, up);
  const bank = Math.atan2(dot(right, cross(flatRight, f)), dot(right, flatRight));
  const [y, b] = [yaw / DEG, bank / DEG];
  return { position: v.position, yaw: hint ? near(y, hint.yaw) : y, pitch: pitch / DEG, bank: hint ? near(b, hint.bank) : b, fov: v.fov };
}

export const lerpView = (a: View, b: View, t: number): View => ({
  position: lerp3(a.position, b.position, t), rotation: slerpQ(a.rotation, b.rotation, t), fov: a.fov + (b.fov - a.fov) * t,
});

/** How the plane sits for its cameras: its frame (with any wobble), speed, and size factor. */
export interface Subject {
  readonly pose: Pose;
  readonly speed: number;
  readonly size: number;
  readonly cruise: number;
  readonly maxSpeed: number;
}

/** Where the eye may go from `from` toward `to` without passing into the world (the physics layer answers). */
export type Clear = (from: Vec3, to: Vec3) => Vec3;

/** The chase and cockpit cameras of one plane; `step` once a fixed step, `snap` after a jump. */
export class PlaneCamera {
  cockpit = false;
  private position: Vec3 = [0, 0, 0];
  private up: Vec3 = UP;
  private kick = 0;

  /** Jumps to where the camera settles behind the plane. */
  snap(s: Subject, clear: Clear): View {
    const { up } = axesOf(s.pose.rotation);
    this.up = this.wantUp(up);
    this.position = this.behind(s, clear);
    this.kick = this.kickOf(s);
    return this.view(s);
  }

  step(s: Subject, dt: number, clear: Clear): View {
    const { up } = axesOf(s.pose.rotation);
    const blended = lerp3(this.up, this.wantUp(up), ease(dt, PLANE.chase.upLag));
    this.up = length(blended) > TINY ? normalize(blended) : this.wantUp(up);
    this.position = lerp3(this.position, this.behind(s, clear), ease(dt, PLANE.chase.lag));
    this.kick += (this.kickOf(s) - this.kick) * ease(dt, PLANE.fov.lag);
    return this.view(s);
  }

  private view(s: Subject): View {
    if (this.cockpit) {
      const c = PLANE.cockpit;
      return { position: add(s.pose.position, rotateQ(s.pose.rotation, [0, c.up * s.size, c.back * s.size])), rotation: s.pose.rotation, fov: PLANE.fov.cockpit + this.kick };
    }
    const look = add(s.pose.position, scale(rotateQ(s.pose.rotation, NOSE), PLANE.chase.lookAhead * s.size));
    const ahead = sub(look, this.position);
    const rotation = length(ahead) > TINY ? lookRotation(ahead, this.up) : s.pose.rotation;
    return { position: this.position, rotation, fov: PLANE.fov.chase + this.kick };
  }

  /** The camera's up: the plane's, with the sky's added while the plane is upright. */
  private wantUp(planeUp: Vec3): Vec3 {
    return normalize(add(planeUp, scale(UP, Math.max(0, planeUp[1]))));
  }

  private behind(s: Subject, clear: Clear): Vec3 {
    const c = PLANE.chase;
    const back = scale(rotateQ(s.pose.rotation, NOSE), -c.distance * s.size);
    return clear(s.pose.position, add(add(s.pose.position, back), scale(this.up, c.height * s.size)));
  }

  private kickOf(s: Subject): number {
    const top = s.maxSpeed * BOOST_TOP;
    return PLANE.fov.kick * clamp01((s.speed - s.cruise) / Math.max(TINY, top - s.cruise));
  }
}
