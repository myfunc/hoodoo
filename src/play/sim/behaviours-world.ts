import type { Vec3 } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import type { ClipPlayer } from './behaviours-clip';
import type { FpsActor } from './fps-actor';
import type { BodyId, Physics } from './physics';

/**
 * What event behaviours and trigger zones may touch while playing: the
 * physics, the scene as posed this step, clips, visibility and solidity of
 * objects, and the event bus. PlayScripts (behaviours.ts) provides it.
 */
export interface ScriptWorld {
  readonly physics: Physics;
  /** The scene this step, clips and motions applied. */
  readonly posed: Scene;
  /** The walker while it is the one driven, or null (an airplane flies). */
  walker(): FpsActor | null;
  /** The eye of whoever is driven. */
  eye(): Vec3;
  /** An object of the posed scene. */
  object(id: string): SceneObject | undefined;
  /** Where an object or a group is in the world now (a physical one where its body is). */
  centre(id: string): Vec3 | null;
  /** The dynamic bodies of an object or a group. */
  dynamicBodies(id: string): BodyId[];
  /** Every dynamic body in play. */
  allDynamic(): BodyId[];
  /** The clip of an object or a group, or null. */
  clip(id: string): ClipPlayer | null;
  setShown(id: string, shown: boolean): void;
  setSolid(id: string, solid: boolean): void;
  /** A named event from an object or a group; it reaches its listeners within the step. */
  send(name: string, from: string): void;
}

/** An event behaviour (Spawner, Button, Counter, Push): it may tick, look after physics, and answer its event. */
export interface Reactor {
  /** The event it answers, if any. */
  readonly on?: string;
  start?(w: ScriptWorld): void;
  step?(dt: number, w: ScriptWorld): void;
  afterPhysics?(w: ScriptWorld): void;
  signal?(w: ScriptWorld): void;
}
