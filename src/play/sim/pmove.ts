import { type Vec3, ZERO3, add, cross, dot, length, scale, sub } from '../../core/vec3';
import type { Tuning } from './movement';

/**
 * READ ME — Half-Life 1's player movement (pm_shared.c), ported line for line
 * where it matters: PM_Friction, PM_Accelerate, PM_AirAccelerate, PM_FlyMove,
 * PM_WalkMove with its step-up, PM_CatagorizePosition, PM_Jump, PM_Duck and the
 * order PM_PlayerMove runs them in. Y is up here (Z in Half-Life). Collision is
 * a `Tracer`: a box swept through the world, as the engine's hull traces were.
 * One addition from Source: after a walk the player is pressed down a step
 * height onto the ground (StayOnGround), so slopes and stairs down hold.
 * Noclip is PM_NoClip with Source's acceleration (FullNoClipMove), flying where
 * the view points; `freeSpot` finds where a hull fits when it ends inside.
 */

/** What a sweep of the hull met. */
export interface Trace {
  /** Share of the move done, 0..1. */
  readonly fraction: number;
  readonly end: Vec3;
  /** The surface's normal, facing the hull; zero when nothing was hit. */
  readonly normal: Vec3;
  /** The hull started inside something: it cannot move. */
  readonly startSolid: boolean;
  /** The body hit (a physics handle), or null. */
  readonly body: number | null;
  /** Where it touched, on the surface; null when nothing was hit. */
  readonly point: Vec3 | null;
}

export interface Tracer {
  /**
   * Sweeps an axis-aligned box of half-extents `half` from `start` to `end`. A box that starts inside
   * something and moves out of it is not held by it; `start` = `end` asks whether the box fits there.
   */
  trace(start: Vec3, end: Vec3, half: Vec3): Trace;
}

/** A body the player ran into this step, and how fast. */
export interface Touch {
  readonly body: number;
  readonly normal: Vec3;
  readonly point: Vec3 | null;
  readonly velocity: Vec3;
}

/** One step of noclip input: the walk's keys, Space and Ctrl as up and down, Shift for speed, the view's pitch. */
export interface FlyCmd {
  readonly forward: number;
  readonly side: number;
  /** Up (+) and down, -1..1. */
  readonly up: number;
  readonly fast: boolean;
  readonly yaw: number;
  /** Degrees above the horizon, Hoodoo's camera pitch. */
  readonly pitch: number;
}

/** One step of input, as Half-Life's usercmd. */
export interface UserCmd {
  /** Wished motion, -1..1: forward (+) and back, right (+) and left. */
  readonly forward: number;
  readonly side: number;
  readonly jump: boolean;
  readonly duck: boolean;
  /** Heading in degrees, Hoodoo's camera yaw. */
  readonly yaw: number;
}

export interface PlayerState {
  /** Centre of the hull. */
  origin: Vec3;
  velocity: Vec3;
  /** The body stood on, or null in the air. */
  ground: number | null;
  groundNormal: Vec3;
  /** The ducked hull is in use (FL_DUCKING). */
  ducked: boolean;
  /** Going down: the view lowers before the hull changes (bInDuck). */
  inDuck: boolean;
  duckTimer: number;
  /** Jump is held since the last jump: no pogo stick. */
  jumpHeld: boolean;
  /** Eye above the hull centre. */
  view: number;
  /** Velocity of what the player stands on (conveyors); zero for now. */
  baseVelocity: Vec3;
  /** Bodies hit during the step. */
  touched: Touch[];
  /** The step's events: a jump left the ground, a fall ended on it. */
  jumped: boolean;
  landed: boolean;
}

const MAX_CLIP_PLANES = 5;
const NUM_BUMPS = 4;
const DEG = Math.PI / 180;
/** PM_FlyMove's result bits. */
export const BLOCKED = { floor: 1, wall: 2, all: 4 } as const;
/** Ways out when the hull starts inside something (PM_CheckStuck): up first, then aside, as shares of the step height. */
const UNSTICK: readonly Vec3[] = [
  [0, 0.25, 0], [0, 0.5, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [0, 2, 0], [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2], [0, 4, 0], [0, -0.5, 0],
];

/** Lifts tried first, in skins (Half-Life's 1/32 unit), for a hull only a hair inside what it stands on. */
const SKIN_LIFTS = [1, 2, 4] as const;

export function newPlayer(origin: Vec3, t: Tuning): PlayerState {
  return {
    origin, velocity: ZERO3, ground: null, groundNormal: ZERO3, ducked: false, inDuck: false, duckTimer: 0,
    jumpHeld: false, view: t.standView, baseVelocity: ZERO3, touched: [], jumped: false, landed: false,
  };
}

export const hullOf = (p: PlayerState, t: Tuning): Vec3 => (p.ducked ? t.duckHalf : t.standHalf);

/** The eye: the hull centre plus the view offset. */
export const eyeOf = (p: PlayerState): Vec3 => [p.origin[0], p.origin[1] + p.view, p.origin[2]];

const flat = (v: Vec3): Vec3 => [v[0], 0, v[2]];
const withY = (v: Vec3, y: number): Vec3 => [v[0], y, v[2]];
const isZero = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;
/** The 26 ways to the cells around one, up first and down last: `freeSpot` walks out along them. */
const AROUND: readonly Vec3[] = [1, 0, -1].flatMap((y) => [0, 1, -1].flatMap((x) => [0, 1, -1].map((z): Vec3 => [x, y, z])))
  .filter((d) => !isZero(d)).map((d) => scale(d, 1 / length(d)));

/** Heading as flat forward and right vectors (camera-math's convention). */
export function moveAxes(yawDeg: number): { forward: Vec3; right: Vec3 } {
  const y = yawDeg * DEG;
  return { forward: [-Math.sin(y), 0, -Math.cos(y)], right: [Math.cos(y), 0, -Math.sin(y)] };
}

/** Where the view points, pitch included (camera-math's cameraAxes without bank). */
function viewForward(yawDeg: number, pitchDeg: number): Vec3 {
  const [y, p] = [yawDeg * DEG, pitchDeg * DEG];
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

/** PM_ClipVelocity: the velocity along the plane, bounced by `overbounce`; tiny components snap to zero. */
export function clipVelocity(v: Vec3, normal: Vec3, overbounce: number, stopEpsilon: number): Vec3 {
  const backoff = dot(v, normal) * overbounce;
  const out = sub(v, scale(normal, backoff));
  return out.map((c) => (c > -stopEpsilon && c < stopEpsilon ? 0 : c)) as unknown as Vec3;
}

/** PM_Accelerate: speed added toward `wishdir`, never past `wishspeed` along it. */
export function accelerate(v: Vec3, wishdir: Vec3, wishspeed: number, accel: number, dt: number): Vec3 {
  const addspeed = wishspeed - dot(v, wishdir);
  if (addspeed <= 0) return v;
  const accelspeed = Math.min(accel * dt * wishspeed, addspeed);
  return add(v, scale(wishdir, accelspeed));
}

/**
 * PM_AirAccelerate: the same, but the speed along `wishdir` is capped at 30 while
 * the push is sized by the full wish. Turning the view while strafing keeps the
 * velocity almost square to `wishdir`, so every step adds speed: air strafing.
 */
export function airAccelerate(v: Vec3, wishdir: Vec3, wishspeed: number, accel: number, cap: number, dt: number): Vec3 {
  const addspeed = Math.min(wishspeed, cap) - dot(v, wishdir);
  if (addspeed <= 0) return v;
  const accelspeed = Math.min(accel * wishspeed * dt, addspeed);
  return add(v, scale(wishdir, accelspeed));
}

/** PM_Friction on the ground: twice as strong at a ledge (edgefriction), never below stopspeed's worth. */
export function friction(p: PlayerState, t: Tuning, tracer: Tracer, dt: number): void {
  const speed = length(p.velocity);
  if (speed < t.stopEpsilon) return;
  let drop = 0;
  if (p.ground !== null) {
    const ahead = scale(flat(p.velocity), t.edgeAhead / speed);
    const half = hullOf(p, t);
    const start = add(withY(p.origin, p.origin[1] - half[1]), ahead);
    const edge = tracer.trace(start, withY(start, start[1] - t.edgeDown), half).fraction === 1;
    const f = t.friction * (edge ? t.edgeFriction : 1);
    drop = Math.max(speed, t.stopSpeed) * f * dt;
  }
  p.velocity = scale(p.velocity, Math.max(speed - drop, 0) / speed);
}

function touch(p: PlayerState, tr: Trace): void {
  if (tr.body !== null) p.touched.push({ body: tr.body, normal: tr.normal, point: tr.point, velocity: p.velocity });
}

/** PM_FlyMove: slide along what the move hits, up to four bumps and five planes. */
export function flyMove(p: PlayerState, t: Tuning, tracer: Tracer, dt: number): number {
  const half = hullOf(p, t);
  const planes: Vec3[] = [];
  const primal = p.velocity;
  let original = p.velocity;
  let blocked = 0;
  let allFraction = 0;
  let timeLeft = dt;
  for (let bump = 0; bump < NUM_BUMPS; bump++) {
    if (isZero(p.velocity)) break;
    const tr = tracer.trace(p.origin, add(p.origin, scale(p.velocity, timeLeft)), half);
    allFraction += tr.fraction;
    if (tr.startSolid) {
      p.velocity = ZERO3;
      return BLOCKED.all;
    }
    if (tr.fraction > 0) {
      p.origin = tr.end;
      original = p.velocity;
      planes.length = 0;
    }
    if (tr.fraction === 1) break;
    touch(p, tr);
    if (tr.normal[1] > t.floorNormal) blocked |= BLOCKED.floor;
    if (tr.normal[1] === 0) blocked |= BLOCKED.wall;
    timeLeft -= timeLeft * tr.fraction;
    if (planes.length >= MAX_CLIP_PLANES) {
      p.velocity = ZERO3;
      break;
    }
    planes.push(tr.normal);
    if (p.ground === null) {
      // In the air each plane reflects the velocity once (floors keep the change).
      let next = original;
      for (const n of planes) {
        next = clipVelocity(original, n, 1, t.stopEpsilon);
        if (n[1] > t.floorNormal) original = next;
      }
      p.velocity = next;
      original = next;
      continue;
    }
    // On the ground: the first plane whose slide leaves every other plane behind, or the crease of two.
    let i = 0;
    for (; i < planes.length; i++) {
      p.velocity = clipVelocity(original, planes[i], 1, t.stopEpsilon);
      if (planes.every((n, j) => j === i || dot(p.velocity, n) >= 0)) break;
    }
    if (i === planes.length) {
      if (planes.length !== 2) {
        p.velocity = ZERO3;
        break;
      }
      const dir = cross(planes[0], planes[1]);
      p.velocity = scale(dir, dot(dir, p.velocity));
    }
    if (dot(p.velocity, primal) <= 0) {
      p.velocity = ZERO3;
      break;
    }
  }
  if (allFraction === 0) p.velocity = ZERO3;
  return blocked;
}

/** Wished direction and speed of the command, clamped to maxspeed (slower ducked). */
function wish(p: PlayerState, cmd: UserCmd, t: Tuning): { dir: Vec3; speed: number } {
  const { forward, right } = moveAxes(cmd.yaw);
  const k = t.keySpeed * (p.ducked ? t.duckSpeed : 1);
  const v = add(scale(forward, cmd.forward * k), scale(right, cmd.side * k));
  const speed = length(v);
  if (speed === 0) return { dir: ZERO3, speed: 0 };
  return { dir: scale(v, 1 / speed), speed: Math.min(speed, t.maxSpeed) };
}

/** PM_WalkMove: accelerate on the ground, then move, trying the step up when that goes farther. */
export function walkMove(p: PlayerState, cmd: UserCmd, t: Tuning, tracer: Tracer, dt: number): void {
  const w = wish(p, cmd, t);
  p.velocity = withY(p.velocity, 0);
  p.velocity = withY(accelerate(p.velocity, w.dir, w.speed, t.accelerate, dt), 0);
  p.velocity = add(p.velocity, p.baseVelocity);
  if (length(p.velocity) < t.minWalkSpeed) {
    p.velocity = ZERO3;
    return;
  }
  const half = hullOf(p, t);
  const direct = tracer.trace(p.origin, withY(add(p.origin, scale(p.velocity, dt)), p.origin[1]), half);
  if (direct.fraction === 1) {
    p.origin = direct.end;
    return;
  }
  const original = p.origin;
  const originalVel = p.velocity;
  flyMove(p, t, tracer, dt);
  const down = p.origin;
  const downVel = p.velocity;
  // Again from one step up, then pressed down onto the step.
  p.origin = original;
  p.velocity = originalVel;
  const up = tracer.trace(p.origin, withY(p.origin, p.origin[1] + t.stepSize), half);
  if (!up.startSolid) p.origin = up.end;
  flyMove(p, t, tracer, dt);
  const press = tracer.trace(p.origin, withY(p.origin, p.origin[1] - t.stepSize), half);
  const flatDist = (a: Vec3) => (a[0] - original[0]) ** 2 + (a[2] - original[2]) ** 2;
  if (press.normal[1] < t.floorNormal) {
    p.origin = down;
    p.velocity = downVel;
    return;
  }
  if (!press.startSolid) p.origin = press.end;
  if (flatDist(down) > flatDist(p.origin)) {
    p.origin = down;
    p.velocity = downVel;
  } else p.velocity = withY(p.velocity, downVel[1]);
}

/** Source's StayOnGround: a walk that ends within a step above the ground ends on it. */
export function stayOnGround(p: PlayerState, t: Tuning, tracer: Tracer): void {
  const half = hullOf(p, t);
  const start = tracer.trace(p.origin, withY(p.origin, p.origin[1] + t.groundProbe), half).end;
  const tr = tracer.trace(start, withY(start, start[1] - t.stepSize - t.groundProbe), half);
  if (tr.fraction > 0 && tr.fraction < 1 && !tr.startSolid && tr.normal[1] >= t.floorNormal) p.origin = tr.end;
}

/** PM_AirMove: air acceleration, then slide. */
export function airMove(p: PlayerState, cmd: UserCmd, t: Tuning, tracer: Tracer, dt: number): void {
  const w = wish(p, cmd, t);
  p.velocity = airAccelerate(p.velocity, w.dir, w.speed, t.airAccelerate, t.airWishCap, dt);
  p.velocity = add(p.velocity, p.baseVelocity);
  flyMove(p, t, tracer, dt);
}

/** PM_CatagorizePosition: on the ground when a surface no steeper than 45.6° is within two units below. */
export function categorize(p: PlayerState, t: Tuning, tracer: Tracer): void {
  const wasOnGround = p.ground !== null;
  if (p.velocity[1] > t.fastUp) {
    p.ground = null;
    return;
  }
  const tr = tracer.trace(p.origin, withY(p.origin, p.origin[1] - t.groundProbe), hullOf(p, t));
  p.ground = tr.normal[1] < t.floorNormal ? null : tr.body;
  p.groundNormal = p.ground === null ? ZERO3 : tr.normal;
  if (p.ground !== null && !tr.startSolid) p.origin = tr.end;
  if (p.ground !== null && !wasOnGround) p.landed = true;
}

/** PM_Jump: from the ground only, once per press; the speed reaches the jump height. */
export function jump(p: PlayerState, cmd: UserCmd, t: Tuning, dt: number): void {
  if (!cmd.jump) {
    p.jumpHeld = false;
    return;
  }
  if (p.ground === null || p.jumpHeld) {
    p.jumpHeld = true;
    return;
  }
  p.ground = null;
  p.velocity = withY(p.velocity, t.jumpSpeed - t.gravity * dt * 0.5);
  p.jumpHeld = true;
  p.jumped = true;
}

/** Smoothstep of the duck: PM_SplineFraction. */
const spline = (x: number): number => x * x * (3 - 2 * x);

function fits(origin: Vec3, half: Vec3, tracer: Tracer): boolean {
  return !tracer.trace(origin, origin, half).startSolid;
}

/** PM_Duck: on the ground the view lowers over 0.4 s, then the hull halves; in the air at once (a duck jump lifts the legs). */
export function duck(p: PlayerState, cmd: UserCmd, t: Tuning, tracer: Tracer, dt: number): void {
  const lift = t.standHalf[1] - t.duckHalf[1];
  if (cmd.duck) {
    if (!p.ducked && !p.inDuck) {
      p.inDuck = true;
      p.duckTimer = 0;
    }
    if (!p.inDuck) return;
    p.duckTimer += dt;
    if (p.duckTimer < t.duckTime && p.ground !== null) {
      p.view = t.standView + (t.duckView - lift - t.standView) * spline(p.duckTimer / t.duckTime);
      return;
    }
    p.ducked = true;
    p.inDuck = false;
    p.view = t.duckView;
    if (p.ground !== null) {
      p.origin = withY(p.origin, p.origin[1] - lift);
      categorize(p, t, tracer);
    }
    return;
  }
  if (!p.ducked && !p.inDuck) return;
  const origin = p.ground !== null && p.ducked ? withY(p.origin, p.origin[1] + lift) : p.origin;
  // Standing up needs room for the whole hull; under a low ceiling the player stays ducked.
  if (p.ducked && !fits(origin, t.standHalf, tracer)) return;
  p.ducked = false;
  p.inDuck = false;
  p.view = t.standView;
  p.origin = origin;
  categorize(p, t, tracer);
}

/** PM_CheckVelocity: no component beyond sv_maxvelocity. */
function checkVelocity(p: PlayerState, t: Tuning): void {
  p.velocity = p.velocity.map((c) => Math.max(-t.maxVelocity, Math.min(t.maxVelocity, c))) as unknown as Vec3;
}

/** The hull goes straight from `from` to `to` meeting nothing but what it starts in and leaves. */
function clear(from: Vec3, to: Vec3, half: Vec3, tracer: Tracer): boolean {
  const tr = tracer.trace(from, to, half);
  return !tr.startSolid && tr.fraction === 1;
}

/**
 * PM_CheckStuck: a hull that starts inside something is nudged to the nearest free place; false when
 * none is near. A place counts only when the way to it is clear, so a nudge never crosses a thin wall.
 */
export function unstick(p: PlayerState, t: Tuning, tracer: Tracer): boolean {
  const half = hullOf(p, t);
  if (fits(p.origin, half, tracer)) return true;
  // A hair inside (a sweep onto a curved top stops a fraction short of exact): lift it out by that hair,
  // not by a share of a step, which would drop the player again and bounce the view.
  for (const skins of SKIN_LIFTS) {
    const at = add(p.origin, [0, skins * t.skin, 0]);
    if (fits(at, half, tracer)) {
      p.origin = at;
      return true;
    }
  }
  for (const d of UNSTICK) {
    const at = add(p.origin, scale(d, t.stepSize));
    if (fits(at, half, tracer) && clear(p.origin, at, half, tracer)) {
      p.origin = at;
      return true;
    }
  }
  return false;
}

/**
 * The nearest place within `reach` where a hull of `half` fits, walking out from `origin` in steps of
 * its smaller half-extent along 26 ways (up first); `origin` itself when it fits, null when nothing
 * near does. `straight`: first only places the hull can get to in a straight line, then any.
 */
export function freeSpot(origin: Vec3, half: Vec3, tracer: Tracer, reach: number, straight = false): Vec3 | null {
  if (fits(origin, half, tracer)) return origin;
  const step = Math.min(half[0], half[1]);
  const rings = Math.ceil(reach / step);
  for (const way of straight ? [true, false] : [false]) {
    for (let k = 1; k <= rings; k++) {
      for (const d of AROUND) {
        const at = add(origin, scale(d, k * step));
        if (fits(at, half, tracer) && (!way || clear(origin, at, half, tracer))) return at;
      }
    }
  }
  return null;
}

/**
 * Noclip: PM_NoClip's flight where the view points (Space and Ctrl straight up and down), with Source's
 * FullNoClipMove feel: it accelerates toward the wished speed and friction bleeds the rest, at least a
 * quarter of the top speed's worth, so letting go stops it in about half a second. No gravity, nothing
 * collides, nothing is stood on.
 */
export function noclipMove(p: PlayerState, cmd: FlyCmd, t: Tuning, dt: number): void {
  const wish = add(add(scale(viewForward(cmd.yaw, cmd.pitch), cmd.forward), scale(moveAxes(cmd.yaw).right, cmd.side)), [0, cmd.up, 0]);
  const top = t.noclipSpeed * (cmd.fast ? t.noclipFast : 1);
  const amount = length(wish);
  if (amount > 0) p.velocity = accelerate(p.velocity, scale(wish, 1 / amount), Math.min(amount, 1) * top, t.noclipAccelerate, dt);
  const speed = length(p.velocity);
  if (speed < t.minWalkSpeed) p.velocity = ZERO3;
  else {
    const drop = Math.max(speed, top / 4) * t.noclipFriction * dt;
    p.velocity = scale(p.velocity, Math.max(speed - drop, 0) / speed);
  }
  p.origin = add(p.origin, scale(p.velocity, dt));
  p.ground = null;
  p.touched = [];
  p.jumped = false;
  p.landed = false;
}

/** PM_PlayerMove for a walking player, in Half-Life's order. */
export function playerMove(p: PlayerState, cmd: UserCmd, t: Tuning, tracer: Tracer, dt: number): void {
  p.touched = [];
  p.jumped = false;
  p.landed = false;
  unstick(p, t, tracer);
  categorize(p, t, tracer);
  duck(p, cmd, t, tracer, dt);
  const halfGravity = t.gravity * dt * 0.5;
  p.velocity = withY(p.velocity, p.velocity[1] - halfGravity);
  jump(p, cmd, t, dt);
  // Friction before any base velocity: on a conveyor, standing still stays still on it.
  if (p.ground !== null) {
    p.velocity = withY(p.velocity, 0);
    friction(p, t, tracer, dt);
  }
  checkVelocity(p, t);
  if (p.ground !== null) {
    walkMove(p, cmd, t, tracer, dt);
    stayOnGround(p, t, tracer);
  } else airMove(p, cmd, t, tracer, dt);
  categorize(p, t, tracer);
  p.velocity = sub(p.velocity, p.baseVelocity);
  checkVelocity(p, t);
  p.velocity = withY(p.velocity, p.velocity[1] - halfGravity);
  if (p.ground !== null) p.velocity = withY(p.velocity, 0);
}
