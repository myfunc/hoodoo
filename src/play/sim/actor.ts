import type { Bus } from '../../core/bus';
import type { Vec3 } from '../../core/vec3';
import type { PlayEvents } from './events';
import type { Physics } from './physics';

/** Buttons an actor may read; the input maps keys and mouse buttons onto them. */
export enum Button {
  Jump = 'jump',
  Duck = 'duck',
  Use = 'use',
  Attack = 'attack',
  Attack2 = 'attack2',
  Reload = 'reload',
}

/** One fixed step of input. */
export interface ActorInput {
  /** Wished motion from the keys, -1..1: right, up, forward. */
  readonly move: Vec3;
  readonly buttons: ReadonlySet<Button>;
  /** Wheel notches since the last step: + towards the user (down), − away. */
  readonly wheel: number;
}

/** Where an actor looks from: the camera follows it. Angles in degrees, as Hoodoo's camera. */
export interface Eye {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly bank: number;
}

/** What an actor may use during a step. */
export interface ActorContext {
  readonly physics: Physics;
  readonly events: Bus<PlayEvents>;
  readonly dt: number;
  /** Scene time at the start of the step. */
  readonly time: number;
}

/**
 * READ ME — something the player drives: the FPS walker (fps-actor.ts), later
 * the airplane or a physgun-carrying player. The session gives the actor the
 * mouse every frame (`look`, applied at once so turning never lags) and the
 * keys every fixed step (`step`, before physics); `afterPhysics` runs once the
 * world has moved (platforms carry, pushers push). The camera is `eye()`,
 * interpolated between steps by the session.
 */
export interface Actor {
  readonly id: string;
  /** Mouse motion in pixels, scaled by the user's sensitivity. */
  look(dx: number, dy: number): void;
  step(input: ActorInput, ctx: ActorContext): void;
  afterPhysics?(ctx: ActorContext): void;
  eye(): Eye;
  /** One short line for the HUD (speed, altitude…), or empty. */
  readout?(): string;
  dispose(ctx: ActorContext): void;
}

/** Scripts that react to the session: triggers, doors, platforms (later tasks). */
export interface Behaviour {
  start?(ctx: ActorContext): void;
  /** Every fixed step, before the actors. */
  step?(ctx: ActorContext): void;
  dispose?(ctx: ActorContext): void;
}
