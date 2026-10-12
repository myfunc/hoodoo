/**
 * Every enum of Play mode's scripts in one place (canon C3): clips, behaviours
 * and trigger zones (docs/play-mode.md). The values are written in scene files,
 * so they never change; new members are appended.
 */

/** How an object's or a group's own clip plays. */
export enum ClipMode {
  /** From the first key to the last, then again from the first. */
  Loop = 'loop',
  /** There and back, over and over. */
  PingPong = 'pingpong',
  /** Once to the end, then it waits (a door). */
  Once = 'once',
}

/** When a clip starts playing. */
export enum ClipStart {
  /** As Play starts. */
  Auto = 'auto',
  /** When a trigger zone or an event tells it to. */
  Trigger = 'trigger',
}

/** The built-in behaviours: motions that move what they sit on, and the ones that work with events and props. */
export enum BehaviourKind {
  Spin = 'spin',
  Bob = 'bob',
  Orbit = 'orbit',
  LookAt = 'look-at',
  Path = 'path',
  Formula = 'formula',
  Spawner = 'spawner',
  Button = 'button',
  Counter = 'counter',
  Push = 'push',
}

/** Who a trigger zone notices. */
export enum ZoneWho {
  Player = 'player',
  /** Any physical (dynamic) body. */
  Physical = 'physical',
  /** One object or group, by id. */
  Named = 'named',
}

/** The moment a rule fires. */
export enum ZoneEdge {
  Enter = 'enter',
  Leave = 'leave',
  /** Every step while inside. */
  Stay = 'stay',
}

/** What a rule does. */
export enum ZoneAction {
  /** The target's clip plays toward its end. */
  Forward = 'forward',
  /** The target's clip plays back toward its start. */
  Backward = 'backward',
  Toggle = 'toggle',
  Solid = 'solid',
  NotSolid = 'not-solid',
  /** Whoever came in gets a push (a velocity change). */
  Impulse = 'impulse',
  /** Whoever came in moves to the target (a marker). */
  Teleport = 'teleport',
  Show = 'show',
  Hide = 'hide',
  /** A named event on the play event bus. */
  Send = 'send',
}
