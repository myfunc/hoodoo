import { type Vec3, ZERO3, add, length, scale, sub } from '../../../core/vec3';
import type { Pose } from '../../sim/physics';
import { type Quat, conjQ, eulerOfQuat, mulQ, quatOfEuler, rotateQ } from '../../sim/quat';

/**
 * The Physics Gun's grip as plain math (no physics): where a held body should
 * be, how fast to move it there, and how E with the mouse turns it.
 */

const DEG = Math.PI / 180;
const MIN_LENGTH = 1e-9;
const UP: Vec3 = [0, 1, 0];
const RIGHT: Vec3 = [1, 0, 0];

/** The unit aim of a view (Hoodoo's camera angles: heading about Y, pitch up). */
export function aimOf(yaw: number, pitch: number): Vec3 {
  const [y, p] = [yaw * DEG, pitch * DEG];
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

/** The player's heading as a turn about the vertical. */
export const headingQ = (yaw: number): Quat => quatOfEuler([0, yaw, 0]);

function axisAngle(axis: Vec3, rad: number): Quat {
  const s = Math.sin(rad / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
}

export interface Grip {
  readonly body: number;
  /** The grabbed point in the body's own frame. */
  readonly local: Vec3;
  /** How far along the aim that point is held. */
  readonly distance: number;
  /** The body's turn relative to the player's heading: it turns as the player turns, not as the player looks up. */
  readonly turn: Quat;
}

/** Taking hold of `body` at `point`, seen from `eye` with heading `yaw`. */
export function gripOf(body: number, pose: Pose, point: Vec3, eye: Vec3, yaw: number): Grip {
  return {
    body,
    local: rotateQ(conjQ(pose.rotation), sub(point, pose.position)),
    distance: length(sub(point, eye)),
    turn: mulQ(conjQ(headingQ(yaw)), pose.rotation),
  };
}

/** Where the held body belongs: its grabbed point on the aim at the grip's distance. */
export function holdTarget(g: Grip, eye: Vec3, aim: Vec3, yaw: number): Pose {
  const rotation = mulQ(headingQ(yaw), g.turn);
  return { position: sub(add(eye, scale(aim, g.distance)), rotateQ(rotation, g.local)), rotation };
}

/** Velocities that close `gain` of the gap to the target in one step; the linear one is capped. */
export function pullToward(now: Pose, target: Pose, dt: number, gain: number, maxSpeed: number): { linear: Vec3; angular: Vec3 } {
  let linear = scale(sub(target.position, now.position), gain / dt);
  if (length(linear) > maxSpeed) linear = scale(linear, maxSpeed / length(linear));
  const d = mulQ(target.rotation, conjQ(now.rotation));
  const s = d[3] < 0 ? -1 : 1;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(d[3])));
  const axisLen = Math.hypot(d[0], d[1], d[2]);
  const angular: Vec3 = axisLen > MIN_LENGTH ? scale([d[0] * s, d[1] * s, d[2] * s], (angle * gain) / dt / axisLen) : ZERO3;
  return { linear, angular };
}

/** E and the mouse: sideways turns the body about the vertical, up and down tips it toward the player. */
export function turned(turn: Quat, dx: number, dy: number, degPerPx: number): Quat {
  return mulQ(axisAngle(RIGHT, dy * degPerPx * DEG), mulQ(axisAngle(UP, -dx * degPerPx * DEG), turn));
}

/** The turn with the body's world angles rounded to whole steps (Shift with E: Garry's Mod's gm_snapangles). */
export function snapped(turn: Quat, yaw: number, stepDeg: number): Quat {
  const world = eulerOfQuat(mulQ(headingQ(yaw), turn), ZERO3);
  const round = world.map((a) => Math.round(a / stepDeg) * stepDeg) as unknown as Vec3;
  return mulQ(conjQ(headingQ(yaw)), quatOfEuler(round));
}

/** The grip pushed away (steps < 0) or pulled closer (steps > 0), kept between `min` and `max`. */
export const reached = (g: Grip, steps: number, step: number, min: number, max: number): Grip =>
  ({ ...g, distance: Math.min(max, Math.max(min, g.distance - steps * step)) });
