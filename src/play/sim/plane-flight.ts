import { type Vec3, add, cross, dot, length, normalize, scale, sub } from '../../core/vec3';
import type { PlaneSettings } from '../../world/plane-settings';
import { HUMAN_HEIGHT } from '../../world/player-settings';
import { type Quat, mulQ, rotateQ } from './quat';

/**
 * READ ME — the toy plane's flight, free of the physics engine (plane-actor.ts
 * adds the world: collisions, the ground, props). Arcade, tuned for joy rather
 * than for truth:
 *
 * - The throttle (0..1) pushes along the nose against a drag that grows with
 *   speed squared, so full throttle settles at `maxSpeed`. Space boosts.
 * - Lift turns the velocity toward the nose without costing speed. It can pull
 *   `gravity · (speed / stallSpeed)²`, up to `maxLoad` g: above the stall speed
 *   the plane goes where it points; below it the weight wins, it mushes down,
 *   and the nose swings toward where it falls until the speed comes back (a
 *   forgiving stall: hands off is enough to recover).
 * - Climbing slows it and diving speeds it up, by `climbCost` of gravity.
 * - The stick sets pitch and roll rates; banking turns the heading by itself
 *   (coordinated yaw). Let go and the wings level and the nose eases to the horizon.
 * - On the ground the wheels roll: rolling friction, brakes at idle, the roll
 *   stick steers, and the nose lifts only once there is speed enough to fly.
 *
 * The plane's frame: the nose along −Z, up +Y, the right wing +X.
 */

/** Every number of the plane's feel, at a human player's size (1.8 units tall) and speed scale 1: units, seconds, degrees. */
export const PLANE = {
  /** The hull: a ball this big around the plane's centre; the wheels touch its bottom. */
  hullRadius: 0.6,
  /** Kilograms, for pushing props (it grows with the cube of the size). */
  mass: 220,
  /** Below this airspeed lift cannot carry the weight. */
  stallSpeed: 4.5,
  /** Spawned in the air at this speed, on this throttle. */
  cruiseSpeed: 11,
  cruiseThrottle: 0.5,
  /** Full throttle in level flight settles here. */
  maxSpeed: 16,
  /** Full throttle's push (units/s²); the drag that stops it at `maxSpeed` follows from it. */
  thrust: 6.4,
  gravity: 9.8,
  /** The share of gravity a climb costs and a dive gives (1: all of it). */
  climbCost: 0.55,
  /** Lift holds at most this many g: the tightest pull at speed. */
  maxLoad: 4,
  /** Sideways and sinking motion fades this fast (per second): the falling speed of a stall stays sane. */
  sideDrag: 0.6,
  /** Nothing goes faster than this many times `maxSpeed`. */
  speedCap: 3,
  /** Idle to full throttle in this many seconds. */
  throttleTime: 1.2,
  boost: { accel: 22, time: 0.8, cooldown: 2.2 },
  /** Degrees a second at full stick, at the stall speed or faster. */
  pitchRate: 115,
  rollRate: 210,
  /** Heading change a second at 90° of bank. */
  turnRate: 80,
  /** How fast the rates follow the stick (per second). */
  response: 9,
  /** Below the stall speed the controls keep this share of their bite. */
  minAuthority: 0.35,
  /** A stick within this of the centre is let go. */
  deadZone: 0.04,
  /** Hands off: after `levelDelay` seconds the bank and the climb ease away at these rates (per second). */
  levelDelay: 0.2,
  levelRoll: 2.2,
  levelPitch: 0.8,
  /** In a stall, and just after a bump, the nose swings toward where the plane goes (per second). */
  weathervane: 2.5,
  recoilTurn: 9,
  ground: {
    /** Rolling friction, and the brakes at idle (per second). */
    friction: 0.15,
    brake: 1.6,
    idle: 0.05,
    /** Degrees a second the roll stick steers the wheels. */
    steerRate: 70,
    /** The nose may lift from this share of the stall speed, at this share of the pitch rate. */
    rotate: 0.85,
    rotateRate: 0.5,
    /** Wings and nose settle level this fast (per second). */
    settle: 6,
  },
  /** Mouse: stick per pixel at sensitivity 1, and how fast the stick springs back to the centre (per second). */
  mouse: { stick: 0.02, spring: 9 },
  /**
   * Touching down: a floor (its normal up at least `floor`) met slower than `land` with the wings near
   * level (the plane's up at least `upright`) takes the wheels; they leave it rising faster than `leave`.
   * `probe` is how far below the hull the wheels still feel the ground; `start`, in hull radii, how near
   * the ground must be under the spawn point to start on it.
   */
  touch: { floor: 0.7, land: 4, upright: 0.75, leave: 0.4, probe: 0.15, start: 4 },
  /**
   * Bumps: the share of the speed into a wall that bounces back, of the speed along it that is kept, the
   * recoil's seconds, and a wobble (degrees, Hz, fading per second). Props take a softer knock
   * (`propRestitution`); one under `heavy` times the plane's mass is pushed away and the plane flies on.
   */
  bump: { restitution: 0.45, scrape: 0.8, recoil: 0.35, wobble: 14, wobbleHz: 2.5, wobbleFade: 3.5, skin: 0.01, propRestitution: 0.2, heavy: 2 },
  /** The chase camera: behind, above, the point it looks at ahead of the nose, its lag (seconds) and how near walls it may go. */
  chase: { distance: 4.8, height: 1.3, lookAhead: 2, lag: 0.12, upLag: 0.3, clearance: 0.3 },
  /** The cockpit eye above the fuselage, a little behind the centre. */
  cockpit: { up: 0.5, back: 0.04 },
  /** Field of view, degrees: chase, cockpit, and the kick at full boost speed (smoothed over `lag` seconds). */
  fov: { chase: 62, cockpit: 74, kick: 16, lag: 0.35 },
  /** The propeller's turns a second: at idle, at full throttle, and more while boosting. */
  propeller: { idle: 2.5, full: 7, boost: 2 },
} as const;

const DEG = Math.PI / 180;
const TINY = 1e-6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

/** The flight's numbers for one plane: the table at its size and the user's settings. */
export interface FlightTuning {
  /** Size factor: the player's height over a human's. */
  readonly size: number;
  readonly hullRadius: number;
  readonly mass: number;
  readonly stallSpeed: number;
  readonly cruiseSpeed: number;
  readonly maxSpeed: number;
  readonly thrust: number;
  /** Drag per speed squared: full thrust balances it at `maxSpeed`. */
  readonly drag: number;
  readonly gravity: number;
  readonly speedCap: number;
  readonly boostAccel: number;
  /** Rates in degrees a second. */
  readonly pitchRate: number;
  readonly rollRate: number;
  readonly turnRate: number;
  readonly steerRate: number;
}

/** Lengths scale with the size; speeds and gravity with the size and the speed scale, so loops keep their shape. */
export function flightTuning(height: number, settings: PlaneSettings): FlightTuning {
  const size = height / HUMAN_HEIGHT;
  const speed = size * settings.speedScale;
  const turn = settings.turnRate;
  const thrust = PLANE.thrust * speed;
  const maxSpeed = PLANE.maxSpeed * speed;
  return {
    size,
    hullRadius: PLANE.hullRadius * size,
    mass: PLANE.mass * size ** 3,
    stallSpeed: PLANE.stallSpeed * speed,
    cruiseSpeed: PLANE.cruiseSpeed * speed,
    maxSpeed,
    thrust,
    drag: thrust / (maxSpeed * maxSpeed),
    gravity: PLANE.gravity * speed,
    speedCap: PLANE.speedCap * maxSpeed,
    boostAccel: PLANE.boost.accel * speed,
    pitchRate: PLANE.pitchRate * turn,
    rollRate: PLANE.rollRate * turn,
    turnRate: PLANE.turnRate * turn,
    steerRate: PLANE.ground.steerRate * turn,
  };
}

/** The plane in flight; `flightStep` changes it in place (as pmove does the walker). */
export interface FlightState {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  /** 0..1. */
  throttle: number;
  /** Turn rates now, degrees a second: nose up +, right wing down +. */
  pitchRate: number;
  rollRate: number;
  /** Seconds of boost left, and until the next one may start. */
  boost: number;
  cooldown: number;
  /** The ground's normal under the wheels, or null in the air (plane-actor.ts finds it). */
  ground: Vec3 | null;
  /** Seconds the stick has been let go. */
  handsOff: number;
  /** Seconds left of a bump's recoil, while the nose swings to where the plane goes. */
  recoil: number;
}

/** One step's stick: pitch (nose up +) and roll (right wing down +) −1..1, throttle change −1..1, boost held. */
export interface FlightControls {
  readonly pitch: number;
  readonly roll: number;
  readonly throttle: number;
  readonly boost: boolean;
}

export const NOSE: Vec3 = [0, 0, -1];
const RIGHT: Vec3 = [1, 0, 0];
const UP: Vec3 = [0, 1, 0];

export function axesOf(q: Quat): { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3 } {
  return { forward: rotateQ(q, NOSE), right: rotateQ(q, RIGHT), up: rotateQ(q, UP) };
}

/** A turn of `deg` degrees about a unit axis. */
export function axisQ(axis: Vec3, deg: number): Quat {
  const h = (deg * DEG) / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** The plane flying level along `heading` degrees (0: toward −Z, 90: toward −X, as the camera's yaw). */
export const headingQ = (heading: number): Quat => axisQ(UP, heading);

/** Bank in degrees, right wing down +; ±180 upside down. */
export function bankOf(q: Quat): number {
  const { right, up } = axesOf(q);
  return Math.atan2(-right[1], up[1]) / DEG;
}

/** The nose above the horizon, degrees. */
export const elevationOf = (q: Quat): number => Math.asin(clamp(axesOf(q).forward[1], -1, 1)) / DEG;

/** Heading in degrees (as the camera's yaw). */
export function headingOf(q: Quat): number {
  const f = axesOf(q).forward;
  return Math.atan2(-f[0], -f[2]) / DEG;
}

/** How much of the weight lift can carry at this airspeed, 0..1. */
export const support = (t: FlightTuning, airspeed: number): number => clamp01((airspeed / t.stallSpeed) ** 2);

export function newFlight(position: Vec3, rotation: Quat, speed: number, throttle: number): FlightState {
  return {
    position, rotation, velocity: scale(rotateQ(rotation, NOSE), speed), throttle,
    pitchRate: 0, rollRate: 0, boost: 0, cooldown: 0, ground: null, handsOff: 0, recoil: 0,
  };
}

/** `v` turned toward the unit vector `to` by at most `rad` radians. */
function turnToward(v: Vec3, to: Vec3, rad: number): Vec3 {
  const len = length(v);
  if (len < TINY) return v;
  const from = scale(v, 1 / len);
  const angle = Math.acos(clamp(dot(from, to), -1, 1));
  if (angle < TINY) return v;
  const axis = cross(from, to);
  // Exactly opposite: any axis across will do.
  const unit = length(axis) < TINY ? normalize(cross(from, Math.abs(from[1]) < 1 / 2 ? UP : RIGHT)) : normalize(axis);
  return scale(rotateQ(axisQ(unit, Math.min(angle, rad) / DEG), from), len);
}

/** The attitude turned so the nose swings toward `dir` by at most `rad` radians. */
function noseToward(q: Quat, dir: Vec3, rad: number): Quat {
  const f = rotateQ(q, NOSE);
  const angle = Math.acos(clamp(dot(f, dir), -1, 1));
  const axis = cross(f, dir);
  if (angle < TINY || length(axis) < TINY) return q;
  return mulQ(axisQ(normalize(axis), Math.min(angle, rad) / DEG), q);
}

/** The stick's wishes after hands-off levelling and the ground's limits, degrees a second. */
function wishes(s: FlightState, c: FlightControls, t: FlightTuning, airspeed: number): { pitch: number; roll: number } {
  const { forward, right, up } = axesOf(s.rotation);
  const authority = Math.max(PLANE.minAuthority, clamp01(airspeed / t.stallSpeed));
  const bank = Math.atan2(-right[1], up[1]) / DEG;
  const elevation = Math.asin(clamp(forward[1], -1, 1)) / DEG;
  if (s.ground) {
    // Wheels down: the roll stick steers instead, and the nose rises only with flying speed.
    const lift = c.pitch > 0 && airspeed >= t.stallSpeed * PLANE.ground.rotate;
    return { pitch: lift ? c.pitch * t.pitchRate * PLANE.ground.rotateRate : -elevation * PLANE.ground.settle, roll: -bank * PLANE.ground.settle };
  }
  let pitch = c.pitch * t.pitchRate * authority;
  let roll = c.roll * t.rollRate * authority;
  if (s.handsOff > PLANE.levelDelay) {
    // Pitching moves the nose toward the plane's up: it levels the climb only as far as up points up.
    const horizontal = Math.sqrt(Math.max(0, 1 - forward[1] * forward[1]));
    roll = clamp(-bank * PLANE.levelRoll * horizontal, -t.rollRate / 2, t.rollRate / 2);
    pitch = clamp(-elevation * PLANE.levelPitch * up[1], -t.pitchRate / 2, t.pitchRate / 2);
  }
  return { pitch, roll };
}

/** One fixed step of flight: controls, attitude, then velocity. The position is the caller's (it collides). */
export function flightStep(s: FlightState, c: FlightControls, t: FlightTuning, dt: number): void {
  s.throttle = clamp01(s.throttle + (c.throttle * dt) / PLANE.throttleTime);
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.boost = Math.max(0, s.boost - dt);
  s.recoil = Math.max(0, s.recoil - dt);
  if (c.boost && s.cooldown === 0) {
    s.boost = PLANE.boost.time;
    s.cooldown = PLANE.boost.time + PLANE.boost.cooldown;
  }
  s.handsOff = Math.abs(c.pitch) + Math.abs(c.roll) < PLANE.deadZone ? s.handsOff + dt : 0;

  // Attitude: the rates follow the stick; banking turns the heading; a stall or a bump swings the nose.
  const airspeed = dot(s.velocity, rotateQ(s.rotation, NOSE));
  const lifted = support(t, airspeed);
  const wish = wishes(s, c, t, airspeed);
  const follow = 1 - Math.exp(-PLANE.response * dt);
  s.pitchRate += (wish.pitch - s.pitchRate) * follow;
  s.rollRate += (wish.roll - s.rollRate) * follow;
  let q = mulQ(s.rotation, mulQ(axisQ(RIGHT, s.pitchRate * dt), axisQ(NOSE, s.rollRate * dt)));
  const right = rotateQ(q, RIGHT);
  const turn = s.ground ? c.roll * t.steerRate : -right[1] * t.turnRate * lifted;
  q = mulQ(axisQ(UP, -turn * dt), q);
  const speed = length(s.velocity);
  if (speed > TINY && !s.ground) {
    const swing = PLANE.weathervane * (1 - lifted) + (s.recoil > 0 ? PLANE.recoilTurn : 0);
    q = noseToward(q, scale(s.velocity, 1 / speed), swing * dt);
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  s.rotation = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];

  // Velocity: gravity, the share of it a climb costs, thrust against drag, then lift bends it toward the nose.
  const forward = rotateQ(s.rotation, NOSE);
  let v = add(s.velocity, [0, -t.gravity * dt, 0]);
  v = add(v, scale(forward, t.gravity * forward[1] * (1 - PLANE.climbCost) * dt));
  const along = dot(v, forward);
  const push = s.throttle * t.thrust + (s.boost > 0 ? t.boostAccel : 0) - t.drag * along * Math.abs(along);
  v = add(v, scale(forward, push * dt));
  const ahead = Math.max(0, dot(v, forward));
  const lift = Math.min(PLANE.maxLoad * t.gravity, t.gravity * (ahead / t.stallSpeed) ** 2);
  const now = length(v);
  if (now > TINY) v = turnToward(v, forward, (lift * dt) / now);
  const side = sub(v, scale(forward, dot(v, forward)));
  v = sub(v, scale(side, Math.min(1, PLANE.sideDrag * dt)));
  if (s.ground) {
    const idle = s.throttle < PLANE.ground.idle && s.boost === 0;
    v = scale(v, Math.exp(-(PLANE.ground.friction + (idle ? PLANE.ground.brake : 0)) * dt));
  }
  const fast = length(v);
  s.velocity = fast > t.speedCap ? scale(v, t.speedCap / fast) : v;
}
