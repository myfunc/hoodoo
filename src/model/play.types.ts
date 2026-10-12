import type { Vec3 } from '../core/vec3';
import type { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from './play.enums';

/**
 * Play mode's scripts as a scene keeps them (docs/play-mode.md): data only,
 * never code. They act only while playing; in the editor the timeline stays
 * the source of keyed motion.
 */

/** A number, or a formula of the time `t` such as `sin(t*2)*0.5` (world/play/formula.ts). */
export type Param = number | string;

/** An object's or a group's own clip: a stretch of its keys that plays on its own clock in Play. */
export interface Clip {
  /** Seconds on the timeline: the keys it plays from and to (from before to). */
  readonly from: number;
  readonly to: number;
  readonly mode: ClipMode;
  /** 1 plays as keyed, 2 twice as fast. */
  readonly speed: number;
  readonly start: ClipStart;
  /** An event that plays it (forward, or back from its end; a loop starts and stops). */
  readonly on?: string;
}

/** One built-in behaviour with its parameters (world/play/behaviour-catalog.ts names them). */
export interface BehaviourSpec {
  readonly kind: BehaviourKind;
  /** By the catalog's keys; absent ones take the catalog's defaults. */
  readonly params: Readonly<Record<string, Param>>;
  /** The object or group it works with: what an Orbit circles, the prop a Spawner drops. */
  readonly target?: string;
  /** An event it answers: a motion starts and stops, a Spawner drops, a Counter counts, a Push fires. */
  readonly on?: string;
  /** The event it sends (Button, Counter). */
  readonly send?: string;
}

/** What an object or a group does by itself while playing. */
export interface PlayScript {
  readonly clip?: Clip;
  readonly behaviours?: readonly BehaviourSpec[];
}

/** When [who] [edge], then [action]. */
export interface ZoneRule {
  readonly who: ZoneWho;
  /** Named: the object or group. */
  readonly name?: string;
  readonly edge: ZoneEdge;
  readonly action: ZoneAction;
  /** The object or group acted on (clips, solid, show and hide); a Teleport's marker. */
  readonly target?: string;
  /** Impulse: the velocity given, units a second. */
  readonly vector?: Vec3;
  /** Send: the event's name. */
  readonly event?: string;
}

/** A trigger zone: an invisible box or sphere (a Cube or a Sphere object) whose rules fire in Play. */
export interface TriggerZone {
  readonly rules: readonly ZoneRule[];
}
