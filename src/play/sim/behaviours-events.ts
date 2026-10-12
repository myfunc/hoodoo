import { type Vec3, UP3, ZERO3, length, normalize, scale, sub } from '../../core/vec3';
import { BehaviourKind } from '../../model/play.enums';
import type { BehaviourSpec } from '../../model/play.types';
import type { Box } from '../../world/bounds';
import { type ParamDef, behaviourDef, paramOf } from '../../world/play/behaviour-catalog';
import { paramValue } from '../../world/play/formula';
import type { Reactor, ScriptWorld } from './behaviours-world';
import type { BodyId, Pose } from './physics';
import { hullOf } from './pmove';

/**
 * READ ME — the behaviours that work with events and props rather than move
 * what they sit on. Spawner drops its prop again from where it started (every
 * Interval, or on its event; with an event it holds the prop until the first);
 * Button sends its event when the player touches it; Counter sends its event
 * after Count of its own; Push gives the player and physical things a shove
 * away from it (or up), weaker toward its edge.
 */

/** Seconds off a Button before touching it again is a new press. */
const RELEASE = 0.25;
/** Things closer than this to a Push's centre go straight up. */
const MIN_DISTANCE = 1e-4;

/** Reads a behaviour's parameters at its own clock. */
class Params {
  /** Seconds since play began, for formulas. */
  protected t = 0;
  private readonly defs: ReadonlyMap<string, ParamDef>;

  constructor(readonly spec: BehaviourSpec) {
    this.defs = new Map((behaviourDef(spec.kind)?.params ?? []).map((p) => [p.key, p]));
  }

  protected p(key: string): number {
    const def = this.defs.get(key);
    return def ? paramValue(paramOf(this.spec.params, def), { t: this.t }) : 0;
  }
}

/** A countdown that fires every `interval` seconds (0: never). */
function every(state: { timer: number }, interval: number, dt: number): boolean {
  if (interval <= 0) return false;
  state.timer += dt;
  if (state.timer < interval) return false;
  state.timer %= interval;
  return true;
}

class Spawner extends Params implements Reactor {
  readonly on?: string;
  private body: BodyId | null = null;
  /** Where the prop drops from: its pose as play began. */
  private home: Pose | null = null;
  private readonly clock = { timer: 0 };

  constructor(spec: BehaviourSpec, private readonly self: string) {
    super(spec);
    this.on = spec.on;
  }

  start(w: ScriptWorld): void {
    this.body = w.dynamicBodies(this.spec.target ?? this.self)[0] ?? null;
    if (this.body === null) return;
    this.home = w.physics.pose(this.body);
    // Waiting for its event: the prop hangs where it is until the first drop.
    if (this.on) w.physics.setFrozen(this.body, true);
  }

  step(dt: number, w: ScriptWorld): void {
    this.t += dt;
    if (every(this.clock, this.p('interval'), dt)) this.drop(w);
  }

  signal(w: ScriptWorld): void {
    this.drop(w);
  }

  private drop(w: ScriptWorld): void {
    if (this.body === null || !this.home) return;
    w.physics.setFrozen(this.body, false);
    w.physics.teleport(this.body, this.home);
    w.physics.setVelocity(this.body, ZERO3, ZERO3);
  }
}

class Button extends Params implements Reactor {
  private touching = false;
  private rest = 0;
  /** Seconds the player has been off it: a press needs a release first, so a bump while standing on it is not one. */
  private away = Infinity;

  constructor(spec: BehaviourSpec, private readonly self: string, private readonly box: (id: string) => Box | null) {
    super(spec);
  }

  step(dt: number): void {
    this.t += dt;
    this.rest = Math.max(0, this.rest - dt);
    if (!this.touching) this.away += dt;
  }

  afterPhysics(w: ScriptWorld): void {
    const walker = w.walker();
    const b = this.box(this.self);
    if (!walker || !b) return;
    const p = walker.state;
    const half = hullOf(p, walker.tuning);
    // Standing on it counts: the hull keeps a skin above what it stands on.
    const reach = walker.tuning.groundProbe;
    const touching = [0, 1, 2].every((i) => p.origin[i] + half[i] + reach >= b.min[i] && p.origin[i] - half[i] - reach <= b.max[i]);
    if (touching && !this.touching && this.away >= RELEASE && this.rest <= 0 && this.spec.send) {
      w.send(this.spec.send, this.self);
      this.rest = this.p('cooldown');
    }
    if (touching) this.away = 0;
    this.touching = touching;
  }
}

class Counter extends Params implements Reactor {
  readonly on?: string;
  private count = 0;

  constructor(spec: BehaviourSpec, private readonly self: string) {
    super(spec);
    this.on = spec.on;
  }

  step(dt: number): void {
    this.t += dt;
  }

  signal(w: ScriptWorld): void {
    this.count++;
    if (this.count < Math.max(1, Math.round(this.p('count')))) return;
    this.count = 0;
    if (this.spec.send) w.send(this.spec.send, this.self);
  }
}

class Push extends Params implements Reactor {
  readonly on?: string;
  private readonly clock = { timer: 0 };

  constructor(spec: BehaviourSpec, private readonly self: string) {
    super(spec);
    this.on = spec.on;
  }

  step(dt: number, w: ScriptWorld): void {
    this.t += dt;
    if (every(this.clock, this.p('interval'), dt)) this.fire(w);
  }

  signal(w: ScriptWorld): void {
    this.fire(w);
  }

  /** The way and the share of the strength a thing at `p` gets, or null out of reach. */
  private shove(centre: Vec3, p: Vec3): { dir: Vec3; k: number } | null {
    const radius = this.p('radius');
    const d = sub(p, centre);
    const dist = length(d);
    if (radius <= 0 || dist > radius) return null;
    return { dir: this.p('up') || dist < MIN_DISTANCE ? UP3 : normalize(d), k: 1 - dist / radius };
  }

  private fire(w: ScriptWorld): void {
    const centre = w.centre(this.self);
    if (!centre) return;
    const strength = this.p('strength');
    const own = new Set(w.dynamicBodies(this.self));
    for (const body of w.allDynamic()) {
      if (own.has(body)) continue;
      const s = this.shove(centre, w.physics.pose(body).position);
      if (s) w.physics.applyImpulse(body, scale(s.dir, strength * s.k * w.physics.mass(body)));
    }
    const walker = w.walker();
    const s = walker ? this.shove(centre, walker.state.origin) : null;
    if (walker && s) walker.kick(scale(s.dir, strength * s.k));
  }
}

/** The runner of an event behaviour on an object or a group, or null for motions. */
export function reactorOf(spec: BehaviourSpec, self: string, box: (id: string) => Box | null): Reactor | null {
  switch (spec.kind) {
    case BehaviourKind.Spawner: return new Spawner(spec, self);
    case BehaviourKind.Button: return new Button(spec, self, box);
    case BehaviourKind.Counter: return new Counter(spec, self);
    case BehaviourKind.Push: return new Push(spec, self);
    default: return null;
  }
}
