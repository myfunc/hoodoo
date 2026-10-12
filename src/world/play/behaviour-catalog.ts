import { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import { ShapeKind } from '../../model/scene.enums';

/**
 * READ ME — what each built-in behaviour is and takes: labels, one-line hints,
 * parameters with their defaults and ranges. The editor builds its rows from
 * this table, files are checked against it (world/play/script-validate.ts),
 * and the simulation reads parameters through `paramOf`. A parameter marked
 * `formula` takes a number or a formula of `t` (world/play/formula.ts).
 */

export interface ParamChoice {
  readonly value: number;
  readonly label: string;
}

export interface ParamDef {
  readonly key: string;
  readonly label: string;
  readonly def: number;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
  /** A closed set shown as a segmented choice (axes, on and off). */
  readonly choices?: readonly ParamChoice[];
  /** Takes a formula of `t` as well as a number. */
  readonly formula?: boolean;
  /** A whole number (a count). */
  readonly whole?: boolean;
  readonly hint: string;
}

export interface BehaviourDef {
  readonly kind: BehaviourKind;
  readonly label: string;
  /** One line: what it does. */
  readonly hint: string;
  readonly params: readonly ParamDef[];
  /** It works with another object or group (Orbit's centre, Spawner's prop); the label of that picker. */
  readonly target?: string;
  /** It answers an event (`on`): what the event does to it. */
  readonly listens?: string;
  /** It sends an event. */
  readonly sends?: boolean;
  /** It moves what it sits on: the thing becomes a kinematic body in Play. */
  readonly moves: boolean;
}

export const AXIS_CHOICES: readonly ParamChoice[] = [{ value: 0, label: 'X' }, { value: 1, label: 'Y' }, { value: 2, label: 'Z' }];
const ON_OFF: readonly ParamChoice[] = [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }];
const TURNS = 3600;
const FAR = 1000;
const LONG = 600;
const MIN_PERIOD = 0.05;
const STRONG = 1000;
const MANY = 1000;
const SPIN_SPEED = 45;
const BOB_PERIOD = 2;
const ORBIT_SPEED = 30;
const ORBIT_RADIUS = 2;
const PATH_SPEED = 2;
const COOLDOWN = 0.5;
const COUNT = 3;
const PUSH_RADIUS = 3;
const PUSH_STRENGTH = 8;

const axis = (def = 1): ParamDef => ({ key: 'axis', label: 'Axis', def, min: 0, max: 2, choices: AXIS_CHOICES, hint: 'The axis it turns about or moves along' });
const MOTION_EVENT = 'Starts and stops it';

/** Every behaviour, in the order the Add menu lists them. */
export const BEHAVIOURS: readonly BehaviourDef[] = [
  {
    kind: BehaviourKind.Spin, label: 'Spin', hint: 'Turns round and round about its pivot', moves: true, listens: MOTION_EVENT,
    params: [{ key: 'speed', label: 'Speed', def: SPIN_SPEED, min: -TURNS, max: TURNS, unit: '°/s', formula: true, hint: 'Degrees a second; a formula of t too' }, axis()],
  },
  {
    kind: BehaviourKind.Bob, label: 'Bob', hint: 'Rises and sinks, a wave along an axis', moves: true, listens: MOTION_EVENT,
    params: [
      { key: 'height', label: 'Height', def: 0.5, min: -FAR, max: FAR, formula: true, hint: 'How far it goes each way' },
      { key: 'period', label: 'Period', def: BOB_PERIOD, min: MIN_PERIOD, max: LONG, unit: 's', hint: 'Seconds for one wave' },
      axis(),
    ],
  },
  {
    kind: BehaviourKind.Orbit, label: 'Orbit', hint: 'Circles its target, or its own spot at Radius', moves: true, listens: MOTION_EVENT, target: 'Around',
    params: [
      { key: 'speed', label: 'Speed', def: ORBIT_SPEED, min: -TURNS, max: TURNS, unit: '°/s', formula: true, hint: 'Degrees a second' },
      { key: 'radius', label: 'Radius', def: ORBIT_RADIUS, min: 0, max: FAR, hint: 'Without a target: how far from its spot' },
      axis(),
      { key: 'turn', label: 'Turn', def: 0, min: 0, max: 1, choices: ON_OFF, hint: 'Turns with the circle, as a carousel does' },
    ],
  },
  {
    kind: BehaviourKind.LookAt, label: 'Look at Player', hint: 'Turns its front (+Z) to the player', moves: true, listens: MOTION_EVENT,
    params: [
      { key: 'tilt', label: 'Tilt', def: 0, min: 0, max: 1, choices: ON_OFF, hint: 'Also tips up and down, not only round' },
      { key: 'offset', label: 'Offset', def: 0, min: -TURNS, max: TURNS, unit: '°', hint: 'Turns the front this far round' },
    ],
  },
  {
    kind: BehaviourKind.Path, label: 'Follow Path', hint: 'Travels the path of its own keys at a speed', moves: true, listens: MOTION_EVENT,
    params: [
      { key: 'speed', label: 'Speed', def: PATH_SPEED, min: -FAR, max: FAR, unit: 'u/s', formula: true, hint: 'Units a second along the path' },
      { key: 'pingpong', label: 'Back', def: 0, min: 0, max: 1, choices: ON_OFF, hint: 'Off: round again from the start; On: there and back' },
      { key: 'face', label: 'Face', def: 1, min: 0, max: 1, choices: ON_OFF, hint: 'Turns to face the way it goes' },
    ],
  },
  {
    kind: BehaviourKind.Formula, label: 'Formula', hint: 'Moves and turns by formulas of t, e.g. sin(t)*2', moves: true, listens: MOTION_EVENT,
    params: [
      { key: 'x', label: 'X', def: 0, min: -FAR, max: FAR, formula: true, hint: 'Offset along X' },
      { key: 'y', label: 'Y', def: 0, min: -FAR, max: FAR, formula: true, hint: 'Offset along Y' },
      { key: 'z', label: 'Z', def: 0, min: -FAR, max: FAR, formula: true, hint: 'Offset along Z' },
      { key: 'rx', label: 'Turn X', def: 0, min: -TURNS, max: TURNS, formula: true, hint: 'Degrees about X' },
      { key: 'ry', label: 'Turn Y', def: 0, min: -TURNS, max: TURNS, formula: true, hint: 'Degrees about Y' },
      { key: 'rz', label: 'Turn Z', def: 0, min: -TURNS, max: TURNS, formula: true, hint: 'Degrees about Z' },
    ],
  },
  {
    kind: BehaviourKind.Spawner, label: 'Spawner', hint: 'Drops its prop again from the start, every Interval or on an event', moves: false, target: 'Prop',
    listens: 'Drops the prop (it waits until the first one)',
    params: [{ key: 'interval', label: 'Every', def: 0, min: 0, max: LONG, unit: 's', hint: 'Seconds between drops; 0 drops on events only' }],
  },
  {
    kind: BehaviourKind.Button, label: 'Button', hint: 'Sends its event when the player touches it', moves: false, sends: true,
    params: [{ key: 'cooldown', label: 'Rest', def: COOLDOWN, min: 0, max: LONG, unit: 's', hint: 'Seconds before it can be pressed again' }],
  },
  {
    kind: BehaviourKind.Counter, label: 'Counter', hint: 'Sends its event after Count events, then counts again', moves: false, sends: true, listens: 'Counts one',
    params: [{ key: 'count', label: 'Count', def: COUNT, min: 1, max: MANY, whole: true, hint: 'Events to wait for' }],
  },
  {
    kind: BehaviourKind.Push, label: 'Push', hint: 'Pushes the player and physical things away (an explosion)', moves: false, listens: 'Pushes once',
    params: [
      { key: 'radius', label: 'Radius', def: PUSH_RADIUS, min: 0, max: FAR, hint: 'How far it reaches' },
      { key: 'strength', label: 'Strength', def: PUSH_STRENGTH, min: -STRONG, max: STRONG, unit: 'u/s', formula: true, hint: 'Speed it gives at its centre, less further out' },
      { key: 'up', label: 'Up', def: 0, min: 0, max: 1, choices: ON_OFF, hint: 'Off: outward from its centre; On: straight up' },
      { key: 'interval', label: 'Every', def: 0, min: 0, max: LONG, unit: 's', hint: 'Seconds between pushes; 0 pushes on events only' },
    ],
  },
];

const BY_KIND = new Map(BEHAVIOURS.map((b) => [b.kind, b]));

export const behaviourDef = (kind: BehaviourKind): BehaviourDef | undefined => BY_KIND.get(kind);

/** A parameter of a behaviour as stored, or its default. */
export function paramOf(params: Readonly<Record<string, number | string>>, def: ParamDef): number | string {
  const v = Object.prototype.hasOwnProperty.call(params, def.key) ? params[def.key] : undefined;
  return v === undefined ? def.def : v;
}

/** The kinds a trigger zone can be: a box or a sphere. */
export const ZONE_KINDS: ReadonlySet<ShapeKind> = new Set([ShapeKind.Cube, ShapeKind.Sphere]);

/** Limits for files and the editor. */
export const SCRIPT_LIMITS = { behaviours: 8, rules: 16, event: 24, speed: { min: 0.05, max: 20 }, impulse: 1000 } as const;

export const CLIP_MODES: readonly { readonly value: ClipMode; readonly label: string; readonly title: string }[] = [
  { value: ClipMode.Loop, label: 'Loop', title: 'From the first key to the last, again and again' },
  { value: ClipMode.PingPong, label: 'Ping-pong', title: 'There and back, over and over' },
  { value: ClipMode.Once, label: 'Once', title: 'To the end, then it waits: a trigger plays it back' },
];

export const CLIP_STARTS: readonly { readonly value: ClipStart; readonly label: string; readonly title: string }[] = [
  { value: ClipStart.Auto, label: 'Auto', title: 'Plays as Play starts' },
  { value: ClipStart.Trigger, label: 'On trigger', title: 'Waits for a trigger zone or its event' },
];

export const ZONE_WHO: readonly { readonly value: ZoneWho; readonly label: string }[] = [
  { value: ZoneWho.Player, label: 'Player' },
  { value: ZoneWho.Physical, label: 'Any physical' },
  { value: ZoneWho.Named, label: 'Object…' },
];

export const ZONE_EDGES: readonly { readonly value: ZoneEdge; readonly label: string }[] = [
  { value: ZoneEdge.Enter, label: 'enters' },
  { value: ZoneEdge.Leave, label: 'leaves' },
  { value: ZoneEdge.Stay, label: 'stays' },
];

/** What a rule does, and what it needs: a target object, a vector or an event name. */
export const ZONE_ACTIONS: readonly { readonly value: ZoneAction; readonly label: string; readonly needs: 'target' | 'marker' | 'vector' | 'event' }[] = [
  { value: ZoneAction.Forward, label: 'play forward', needs: 'target' },
  { value: ZoneAction.Backward, label: 'play backward', needs: 'target' },
  { value: ZoneAction.Toggle, label: 'toggle clip', needs: 'target' },
  { value: ZoneAction.Solid, label: 'make solid', needs: 'target' },
  { value: ZoneAction.NotSolid, label: 'make not solid', needs: 'target' },
  { value: ZoneAction.Impulse, label: 'push it', needs: 'vector' },
  { value: ZoneAction.Teleport, label: 'teleport to', needs: 'marker' },
  { value: ZoneAction.Show, label: 'show', needs: 'target' },
  { value: ZoneAction.Hide, label: 'hide', needs: 'target' },
  { value: ZoneAction.Send, label: 'send event', needs: 'event' },
];

export const zoneActionInfo = (a: ZoneAction) => ZONE_ACTIONS.find((x) => x.value === a) ?? ZONE_ACTIONS[0];
