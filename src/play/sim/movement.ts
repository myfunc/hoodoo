import type { Vec3 } from '../../core/vec3';
import { HL_HULL, HUMAN_HEIGHT, type PlayerSettings } from '../../world/player-settings';

/**
 * Half-Life 1's movement variables (pm_shared.c and the server cvars), in its
 * own units: inches and seconds. `tuningOf` scales every length and speed by
 * the player's height, so the same movement fits a player of any size.
 */
export const HL = {
  gravity: 800,
  friction: 4,
  edgeFriction: 2,
  stopSpeed: 100,
  accelerate: 10,
  airAccelerate: 10,
  /** PM_AirAccelerate caps the wished speed in the air at 30: what makes strafing and bunny hops work. */
  airWishCap: 30,
  maxSpeed: 320,
  maxVelocity: 2000,
  stepSize: 18,
  /** cl_forwardspeed and cl_sidespeed: a held key asks for 400, the server clamps to maxspeed. */
  keySpeed: 400,
  duckSpeed: 0.333,
  duckTime: 0.4,
  /** A surface whose normal points up at least this much is ground (about 45.6°). */
  floorNormal: 0.7,
  /** Ducked hull height and eye height, from the feet. */
  duckHeight: 36,
  duckEye: 30,
  groundProbe: 2,
  /** Rising faster than this, the player is not on the ground (a share of the jump speed below). */
  fastUp: 180,
  stopEpsilon: 0.1,
  /** PM_WalkMove stops a walk slower than this. */
  minWalkSpeed: 1,
  edgeAhead: 16,
  edgeDown: 34,
  /** The gap traces keep from surfaces (DIST_EPSILON). */
  skin: 0.03125,
  /** Player mass for pushing physical bodies, kilograms at human size. */
  mass: 80,
} as const;

/** sqrt(2 · 800 · 45): Half-Life's jump speed, which `fastUp` is a share of. */
const HL_JUMP_SPEED = Math.sqrt(2 * HL.gravity * HL_HULL.jump);
const MASS_EXPONENT = 3;

/** The movement of one player in world units: Half-Life's numbers scaled to its size and the user's factors. */
export interface Tuning {
  /** World units per Half-Life unit (player height / 72). */
  readonly unit: number;
  readonly gravity: number;
  readonly friction: number;
  readonly edgeFriction: number;
  readonly stopSpeed: number;
  readonly accelerate: number;
  readonly airAccelerate: number;
  readonly airWishCap: number;
  readonly maxSpeed: number;
  readonly maxVelocity: number;
  readonly keySpeed: number;
  readonly stepSize: number;
  readonly jumpSpeed: number;
  readonly fastUp: number;
  readonly floorNormal: number;
  readonly duckSpeed: number;
  readonly duckTime: number;
  readonly groundProbe: number;
  readonly stopEpsilon: number;
  readonly minWalkSpeed: number;
  readonly edgeAhead: number;
  readonly edgeDown: number;
  readonly skin: number;
  /** Half-extents of the standing and the ducked hull (an axis-aligned box, as in Half-Life). */
  readonly standHalf: Vec3;
  readonly duckHalf: Vec3;
  /** Eye above the hull centre, standing and ducked. */
  readonly standView: number;
  readonly duckView: number;
  readonly mass: number;
}

/** The movement of a player with these settings. */
export function tuningOf(p: PlayerSettings): Tuning {
  const unit = p.height / HL_HULL.height;
  const speed = unit * p.speedScale;
  const gravity = HL.gravity * unit * p.gravityScale;
  const jumpSpeed = Math.sqrt(2 * gravity * p.jumpHeight);
  const duckHeight = (HL.duckHeight / HL_HULL.height) * p.height;
  const duckEye = Math.min(duckHeight, p.eyeHeight * (HL.duckEye / HL_HULL.eye));
  return {
    unit,
    gravity,
    friction: HL.friction,
    edgeFriction: HL.edgeFriction,
    stopSpeed: HL.stopSpeed * speed,
    accelerate: HL.accelerate,
    airAccelerate: HL.airAccelerate,
    airWishCap: HL.airWishCap * speed,
    maxSpeed: HL.maxSpeed * speed,
    maxVelocity: HL.maxVelocity * Math.max(speed, jumpSpeed / HL_JUMP_SPEED),
    keySpeed: HL.keySpeed * speed,
    stepSize: HL.stepSize * unit,
    jumpSpeed,
    fastUp: (HL.fastUp / HL_JUMP_SPEED) * jumpSpeed,
    floorNormal: HL.floorNormal,
    duckSpeed: HL.duckSpeed,
    duckTime: HL.duckTime,
    groundProbe: HL.groundProbe * unit,
    stopEpsilon: HL.stopEpsilon * speed,
    minWalkSpeed: HL.minWalkSpeed * speed,
    edgeAhead: HL.edgeAhead * unit,
    edgeDown: HL.edgeDown * unit,
    skin: HL.skin * unit,
    standHalf: [p.radius, p.height / 2, p.radius],
    duckHalf: [p.radius, duckHeight / 2, p.radius],
    standView: p.eyeHeight - p.height / 2,
    duckView: duckEye - duckHeight / 2,
    mass: HL.mass * (p.height / HUMAN_HEIGHT) ** MASS_EXPONENT,
  };
}
