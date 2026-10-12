import { type Vec3, add, length, lerp3, mul, scale, sub } from '../../core/vec3';
import { BehaviourKind } from '../../model/play.enums';
import type { BehaviourSpec } from '../../model/play.types';
import type { Key, Transform } from '../../model/scene.types';
import { transformAt } from '../../world/animation/pose';
import { type ParamDef, behaviourDef, paramOf } from '../../world/play/behaviour-catalog';
import { paramValue } from '../../world/play/formula';
import { conjQ, eulerOfQuat, mulQ, quatOfEuler, rotateQ } from './quat';

/**
 * READ ME — the behaviours that move what they sit on (Spin, Bob, Orbit, Look
 * at Player, Follow Path, Formula). Each keeps a little state and its own
 * clock `t` (formulas read it), which runs while the motion runs; an `on`
 * event starts and stops it, and a stopped motion holds where it got to.
 * `apply` lays the motion over the pose the thing has inside its group (its
 * keys, its clip, or where it stands), in the group's frame: world points (an
 * Orbit's centre, the player's eye) come in through `toLocal`.
 */

/** What a motion may look at during a step. */
export interface MotionContext {
  readonly dt: number;
  /** The player's eye in the world, or null. */
  readonly eye: Vec3 | null;
  /** Where an object or a group is in the world now, or null. */
  centre(id: string): Vec3 | null;
  /** A world point in the frame of the group around the thing moved. */
  toLocal(p: Vec3): Vec3;
}

export interface MotionRunner {
  readonly spec: BehaviourSpec;
  running: boolean;
  advance(ctx: MotionContext): void;
  apply(local: Transform, ctx: MotionContext): Transform;
}

const TAU = 2 * Math.PI;
const DEG = 180 / Math.PI;
const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** Without a target, an orbit's radius points this way from the spot, across its axis. */
const ACROSS: readonly Vec3[] = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
/** A path is sampled this many times between two keys, and at most this many times in all. */
const PATH_SAMPLES = { perKey: 16, max: 512 } as const;
const MIN_STEP = 1e-6;

const mod = (a: number, b: number): number => a - b * Math.floor(a / b);
const axisOf = (v: number): 0 | 1 | 2 => (v === 0 ? 0 : v === 2 ? 2 : 1);
const turnAbout = (axis: 0 | 1 | 2, deg: number): Vec3 => [axis === 0 ? deg : 0, axis === 1 ? deg : 0, axis === 2 ? deg : 0];

/** The pose turned about its pivot by `deg` about a parent axis. */
function turned(t: Transform, axis: 0 | 1 | 2, deg: number): Transform {
  const q = mulQ(quatOfEuler(turnAbout(axis, deg)), quatOfEuler(t.rotation));
  return { ...t, rotation: eulerOfQuat(q, t.rotation) };
}

/** The common part: the spec's parameters, the clock and the switch. */
abstract class Motion implements MotionRunner {
  running: boolean;
  /** The motion's own clock: seconds it has run. */
  protected t = 0;
  private readonly defs: ReadonlyMap<string, ParamDef>;

  constructor(readonly spec: BehaviourSpec) {
    this.running = !spec.on;
    this.defs = new Map((behaviourDef(spec.kind)?.params ?? []).map((p) => [p.key, p]));
  }

  /** A parameter now (a formula is read at the motion's clock). */
  protected p(key: string): number {
    const def = this.defs.get(key);
    return def ? paramValue(paramOf(this.spec.params, def), { t: this.t }) : 0;
  }

  advance(ctx: MotionContext): void {
    if (!this.running) return;
    this.t += ctx.dt;
    this.tick(ctx.dt);
  }

  protected tick(_dt: number): void {
    // Most motions read only their clock.
  }

  abstract apply(local: Transform, ctx: MotionContext): Transform;
}

class Spin extends Motion {
  private angle = 0;
  protected override tick(dt: number): void {
    this.angle += this.p('speed') * dt;
  }
  apply(local: Transform): Transform {
    return turned(local, axisOf(this.p('axis')), this.angle);
  }
}

class Bob extends Motion {
  private phase = 0;
  protected override tick(dt: number): void {
    this.phase += dt / Math.max(MIN_STEP, this.p('period'));
  }
  apply(local: Transform): Transform {
    const offset = scale(AXES[axisOf(this.p('axis'))], this.p('height') * Math.sin(TAU * this.phase));
    return { ...local, position: add(local.position, offset) };
  }
}

class Orbit extends Motion {
  private angle = 0;
  private offset: Vec3 | null = null;
  protected override tick(dt: number): void {
    this.angle += this.p('speed') * dt;
  }
  apply(local: Transform, ctx: MotionContext): Transform {
    const axis = axisOf(this.p('axis'));
    const target = this.spec.target ? ctx.centre(this.spec.target) : null;
    const centre = target ? ctx.toLocal(target) : local.position;
    // The first step fixes the arm: from the target to where it stood, or Radius across the axis.
    this.offset ??= target ? sub(local.position, centre) : scale(ACROSS[axis], this.p('radius'));
    const arm = rotateQ(quatOfEuler(turnAbout(axis, this.angle)), this.offset);
    const moved = { ...local, position: add(centre, arm) };
    return this.p('turn') ? turned(moved, axis, this.angle) : moved;
  }
}

class LookAt extends Motion {
  apply(local: Transform, ctx: MotionContext): Transform {
    if (!ctx.eye) return local;
    const d = sub(ctx.toLocal(ctx.eye), local.position);
    if (length(d) < MIN_STEP) return local;
    const yaw = Math.atan2(d[0], d[2]) * DEG + this.p('offset');
    const pitch = this.p('tilt') ? -Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG : 0;
    return { ...local, rotation: [pitch, yaw, 0] };
  }
}

/** Follow Path: the positions of its own keys as a line walked at a speed. */
class FollowPath extends Motion {
  private s = 0;
  private readonly points: Vec3[];
  /** Distance along the line at each point. */
  private readonly along: number[] = [];

  constructor(spec: BehaviourSpec, keys: readonly Key<Transform>[]) {
    super(spec);
    this.points = sampled(keys);
    this.points.forEach((p, i) => this.along.push(i ? this.along[i - 1] + length(sub(p, this.points[i - 1])) : 0));
  }

  protected override tick(dt: number): void {
    this.s += this.p('speed') * dt;
  }

  apply(local: Transform): Transform {
    const total = this.along[this.along.length - 1] ?? 0;
    if (total < MIN_STEP) return local;
    const pingpong = this.p('pingpong') !== 0;
    const u = mod(this.s, pingpong ? 2 * total : total);
    const returning = pingpong && u > total;
    const s = returning ? 2 * total - u : u;
    let i = 1;
    while (i < this.along.length - 1 && this.along[i] < s) i++;
    const [a, b] = [this.points[i - 1], this.points[i]];
    const seg = this.along[i] - this.along[i - 1];
    const position = lerp3(a, b, seg > MIN_STEP ? (s - this.along[i - 1]) / seg : 0);
    if (!this.p('face')) return { ...local, position };
    // Heading back along the line: going back on a ping-pong, or at a negative speed.
    const way = returning !== this.p('speed') < 0 ? sub(a, b) : sub(b, a);
    return { ...local, position, rotation: [local.rotation[0], Math.atan2(way[0], way[2]) * DEG, local.rotation[2]] };
  }
}

function sampled(keys: readonly Key<Transform>[]): Vec3[] {
  if (keys.length < 2) return [];
  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const n = Math.min(PATH_SAMPLES.max, (keys.length - 1) * PATH_SAMPLES.perKey);
  return Array.from({ length: n + 1 }, (_, i) => transformAt(keys, first + ((last - first) * i) / n).position);
}

class Formula extends Motion {
  apply(local: Transform): Transform {
    const offset: Vec3 = [this.p('x'), this.p('y'), this.p('z')];
    const turn: Vec3 = [this.p('rx'), this.p('ry'), this.p('rz')];
    return { ...local, position: add(local.position, offset), rotation: add(local.rotation, turn) };
  }
}

/** The runner of a motion behaviour, or null for the other kinds. `keys`: the thing's own track (Follow Path). */
export function motionOf(spec: BehaviourSpec, keys: readonly Key<Transform>[]): MotionRunner | null {
  switch (spec.kind) {
    case BehaviourKind.Spin: return new Spin(spec);
    case BehaviourKind.Bob: return new Bob(spec);
    case BehaviourKind.Orbit: return new Orbit(spec);
    case BehaviourKind.LookAt: return new LookAt(spec);
    case BehaviourKind.Path: return new FollowPath(spec, keys);
    case BehaviourKind.Formula: return new Formula(spec);
    default: return null;
  }
}

/** A world point in a group's frame (position, rotation, and size read as a scale), or as it is at the top level. */
export function pointInFrame(frame: Transform | null, p: Vec3): Vec3 {
  if (!frame) return p;
  const local = rotateQ(conjQ(quatOfEuler(frame.rotation)), sub(p, frame.position));
  const s = frame.size;
  return mul(local, [s[0] ? 1 / s[0] : 0, s[1] ? 1 / s[1] : 0, s[2] ? 1 / s[2] : 0]);
}
