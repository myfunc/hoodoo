import type { BodyId, JointId } from './physics';

/**
 * The play session's event bus (core/bus): what triggers, behaviours, tools and
 * the HUD listen to. Payloads name bodies by id and by tag (the scene object or
 * group they stand for).
 */
export interface PlayEvents {
  /** After every fixed step; `time` is the scene time the step ended at. */
  tick: { readonly time: number; readonly dt: number };
  /** Two bodies began or stopped touching (bodies created with `events`, and sensors). */
  contact: { readonly a: BodyId; readonly b: BodyId; readonly tagA: string | null; readonly tagB: string | null; readonly started: boolean };
  /** An actor left the ground by jumping, or came down on it. */
  jump: { readonly actor: string };
  land: { readonly actor: string; readonly speed: number };
  /** A joint pulled apart past its limit and is gone. */
  jointBroken: { readonly joint: JointId };
  /** Recording began or ended at this scene time. */
  record: { readonly on: boolean; readonly time: number };
  /** A named event of the scene's scripts (trigger zones, buttons, counters; behaviours.ts); `from` is the sender's id. */
  signal: { readonly name: string; readonly from: string };
}
