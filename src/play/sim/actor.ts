import type { Bus } from '../../core/bus';
import type { Vec3 } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
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
  /** Switches the view (the plane: chase or cockpit). */
  View = 'view',
}

/** One fixed step of input. */
export interface ActorInput {
  /** Wished motion from the keys, -1..1: right, up, forward. */
  readonly move: Vec3;
  readonly buttons: ReadonlySet<Button>;
  /** Wheel notches since the last step: + towards the user (down), − away. */
  readonly wheel: number;
  /** The arrow keys, -1..1: right, up (the plane pitches and rolls on them). */
  readonly arrows?: readonly [number, number];
}

/** Where an actor looks from: the camera follows it. Angles in degrees, as Hoodoo's camera. */
export interface Eye {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly bank: number;
  /** Field of view in degrees (the plane widens it with speed); absent: the scene camera's. */
  readonly fov?: number;
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
  /**
   * The eye `alpha` of the way from the last step to the next, for an actor whose
   * view turns in steps (the plane's chase camera); without it the position is
   * interpolated and the angles are `eye()`'s, which the mouse turns at once.
   */
  view?(alpha: number): Eye;
  /** Objects the actor shows in the picture (the plane), posed `alpha` of the way from the last step. */
  figure?(alpha: number): readonly SceneObject[];
  /** One short line for the HUD (speed, altitude…), or empty. */
  readout?(): string;
  /** A 0..1 bar after the readout (the plane's throttle); `hot` while it boosts. */
  gauge?(): { readonly level: number; readonly hot: boolean };
  dispose(ctx: ActorContext): void;
}

/** Scripts that react to the session: triggers, doors, platforms (later tasks). */
export interface Behaviour {
  start?(ctx: ActorContext): void;
  /** Every fixed step, before the actors. */
  step?(ctx: ActorContext): void;
  dispose?(ctx: ActorContext): void;
}
