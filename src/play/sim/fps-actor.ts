import { type Vec3, ZERO3, add, dot, length, scale, sub } from '../../core/vec3';
import type { PlayerSettings } from '../../world/player-settings';
import { type Actor, type ActorContext, type ActorInput, Button, type Eye } from './actor';
import { type Tuning, tuningOf } from './movement';
import { type BodyId, Layer, Motion, type Physics, type Pose } from './physics';
import { type PlayerState, type Tracer, eyeOf, freeSpot, hullOf, newPlayer, noclipMove, playerMove, unstick } from './pmove';
import { IDENTITY_Q, conjQ, mulQ, rotateQ } from './quat';
import { ShapeType } from './shapes';

/** Degrees the view turns per pixel at sensitivity 1 (Half-Life's 3 × m_yaw 0.022 per count, about two counts a pixel). */
const DEG_PER_PX = 0.12;
const PITCH_LIMIT = 89;
/** Platforms moving into the player shove it this many times per step at most. */
const PUSHES = 2;
/** How far, in player heights, a hull inside something looks for a place to stand. */
const FREE_REACH = 8;
/** Steps stuck before the wider look (half a second): a door pressing on the player usually moves on first. */
const STUCK_STEPS = 50;
/** Steps the HUD says why noclip stayed on. */
const NOTICE_STEPS = 200;
/** SmoothViewOnStairs: the eye catches up this many Half-Life units a second. */
const STAIRS = { speed: 150 } as const;
const NOCLIP_LABEL = 'Noclip';
const NO_ROOM = 'no room to stand here';

/**
 * READ ME — the first-person walker: Half-Life's movement (pmove.ts) on the
 * physics layer. Its hull sweeps against the world and the props; what it runs
 * into is pushed with the player's momentum (80 kg at human size, scaling with
 * the cube of the height); what it stands on carries it when keys move it, and
 * a moving platform shoves it out of the way. Its own box in the physics world
 * only meets props, so a crate dropped on the player rests on its head.
 *
 * Noclip (V, or `setNoclip` from Sandbox): Garry's Mod's fly mode. The view
 * steers, Space rises, Ctrl sinks, Shift speeds; no gravity, nothing collides
 * and the box stops pushing props. Turning it off inside something moves the
 * player to the nearest place the hull fits (`freeSpot`); with none near,
 * noclip stays on and the HUD line says so. A spawn, a teleport or a fall back
 * to the start inside something is placed the same way on the next step.
 */
export class FpsActor implements Actor {
  readonly id = 'player';
  readonly tuning: Tuning;
  readonly state: PlayerState;
  yaw: number;
  pitch: number;
  private readonly body: BodyId;
  private readonly tracer: Tracer;
  private readonly spawn: { origin: Vec3; yaw: number; pitch: number };
  private wasDucked = false;
  /** The kinematic body under the player and where it was before the step. */
  private carrier: { body: BodyId; pose: Pose } | null = null;
  private flying = false;
  /** V was down last step: a press toggles noclip once. */
  private viewHeld = false;
  /** Steps left showing why noclip stayed on. */
  private notice = 0;
  /** Steps the hull has been stuck with no near way out. */
  private stuck = 0;
  /** The height the eye is drawn from (C_BasePlayer::SmoothViewOnStairs): it follows the body over a step instead of jumping. */
  private viewZ: number | null = null;
  private grounded = false;
  /** Placed somewhere new (spawn, teleport, respawn): the next step moves it out of anything it is in. */
  private settle = true;

  /** `spawn`: the eye at the start (and after a fall); `from`: where the eye is now when the player changes mid-play. */
  constructor(private readonly physics: Physics, spawn: Eye, private readonly settings: PlayerSettings, private readonly killY: number, from: Eye = spawn) {
    this.tuning = tuningOf(settings);
    const t = this.tuning;
    const below = (e: Eye): Vec3 => [e.position[0], e.position[1] - t.standView, e.position[2]];
    this.spawn = { origin: below(spawn), yaw: spawn.yaw, pitch: spawn.pitch };
    const origin = below(from);
    this.yaw = from.yaw;
    this.pitch = from.pitch;
    this.state = newPlayer(origin, t);
    this.body = physics.addBody({ motion: Motion.Kinematic, position: origin, shapes: [{ type: ShapeType.Box, half: t.standHalf }], layer: Layer.Player, collidesWith: Layer.Prop, tag: this.id });
    this.tracer = { trace: (s, e, h) => physics.traceBox(s, e, h, t.skin, { exclude: this.body }) };
  }

  look(dx: number, dy: number): void {
    const k = DEG_PER_PX * this.settings.sensitivity;
    this.yaw -= dx * k;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * k));
  }

  /** Noclip is on: flying through everything. */
  get noclip(): boolean {
    return this.flying;
  }

  /**
   * Noclip on or off. Off lands where the player is, or at the nearest place within eight heights
   * where the hull fits; with none, noclip stays on, the HUD says so, and the answer is false.
   */
  setNoclip(on: boolean): boolean {
    if (on === this.flying) return true;
    const p = this.state;
    if (on) {
      this.flying = true;
      this.notice = 0;
      this.carrier = null;
      p.ground = null;
      this.physics.setLayer(this.body, Layer.Player, 0);
      return true;
    }
    const spot = this.place(false);
    if (!spot) {
      this.notice = NOTICE_STEPS;
      return false;
    }
    if (spot !== p.origin) p.velocity = ZERO3;
    p.origin = spot;
    this.flying = false;
    this.notice = 0;
    this.physics.setLayer(this.body, Layer.Player, Layer.Prop);
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
    return true;
  }

  step(input: ActorInput, ctx: ActorContext): void {
    const p = this.state;
    const view = input.buttons.has(Button.View);
    if (view && !this.viewHeld) this.setNoclip(!this.flying);
    this.viewHeld = view;
    if (this.notice > 0) this.notice--;
    if (this.flying) {
      this.fly(input, ctx.dt);
      return;
    }
    if (this.settle) {
      this.settle = false;
      const spot = this.place(false);
      if (spot) p.origin = spot;
    }
    const ground = p.ground;
    this.carrier = ground !== null && this.physics.motion(ground) === Motion.Kinematic ? { body: ground, pose: this.physics.pose(ground) } : null;
    const fall = -p.velocity[1];
    // A wheel notch is a jump press for one step: the wheel bind Half-Life players bunny hop with.
    playerMove(p, { forward: input.move[2], side: input.move[0], jump: input.buttons.has(Button.Jump) || input.wheel !== 0, duck: input.buttons.has(Button.Duck), yaw: this.yaw }, this.tuning, this.tracer, ctx.dt);
    if (p.jumped) ctx.events.emit('jump', { actor: this.id });
    if (p.landed) ctx.events.emit('land', { actor: this.id, speed: fall });
    this.push();
    this.lean(ctx.dt);
    if (p.ducked !== this.wasDucked) {
      this.wasDucked = p.ducked;
      this.physics.setBoxHalf(this.body, hullOf(p, this.tuning));
    }
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
  }

  afterPhysics(): void {
    const p = this.state;
    const t = this.tuning;
    if (this.flying) {
      this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
      return;
    }
    if (this.carrier && p.ground === this.carrier.body) {
      const now = this.physics.pose(this.carrier.body);
      const before = this.carrier.pose;
      const moved = add(rotateQ(mulQ(now.rotation, conjQ(before.rotation)), sub(p.origin, before.position)), now.position);
      p.origin = this.tracer.trace(p.origin, moved, hullOf(p, t)).end;
    }
    // A shove is a sweep too: a platform pushes the player up to a wall, never through it.
    for (let i = 0; i < PUSHES; i++) {
      const pusher = this.physics.overlapsBox(p.origin, hullOf(p, t), t.skin, { layers: Layer.World, exclude: this.body });
      if (pusher === null || this.physics.motion(pusher) !== Motion.Kinematic) break;
      p.origin = this.tracer.trace(p.origin, add(p.origin, scale(this.physics.velocityAt(pusher, p.origin), this.physics.dt)), hullOf(p, t)).end;
    }
    this.unstuck();
    if (p.origin[1] < this.killY) this.respawn();
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
    this.smoothView();
  }

  /**
   * Source's smoothed stairs: on ground that does not move, a step up or down moves the eye at
   * 150 units a second after the body, never more than a step behind; anywhere else it is where the body is.
   */
  private smoothView(): void {
    const p = this.state;
    const z = p.origin[1];
    const still = p.ground !== null && this.physics.motion(p.ground) === Motion.Fixed;
    if (!still || !this.grounded || this.viewZ === null || this.viewZ === z) this.viewZ = z;
    else {
      const t = this.tuning;
      const up = z > this.viewZ;
      const moved = this.viewZ + (up ? 1 : -1) * STAIRS.speed * t.unit * this.physics.dt;
      this.viewZ = up ? Math.max(Math.min(moved, z), z - t.stepSize) : Math.min(Math.max(moved, z), z + t.stepSize);
    }
    this.grounded = p.ground !== null;
  }

  eye(): Eye {
    const at = eyeOf(this.state);
    const lag = this.viewZ === null || this.flying ? 0 : this.viewZ - this.state.origin[1];
    return { position: [at[0], at[1] + lag, at[2]], yaw: this.yaw, pitch: this.pitch, bank: 0 };
  }

  /** A velocity change (a jump pad, a blast): an upward one lifts the player off the ground. */
  kick(dv: Vec3): void {
    const p = this.state;
    p.velocity = add(p.velocity, dv);
    if (dv[1] > 0) p.ground = null;
  }

  /** The player's feet at `feet`, standing still, looking the same way (a teleporter); out of anything there on the next step. */
  teleport(feet: Vec3): void {
    const p = this.state;
    p.origin = [feet[0], feet[1] + hullOf(p, this.tuning)[1] + this.tuning.skin, feet[2]];
    this.viewZ = null;
    p.velocity = [0, 0, 0];
    p.ground = null;
    this.settle = true;
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
  }

  /** Ground speed in Half-Life units a second, the speedometer of bunny hoppers; in noclip the speed through the air. */
  get speed(): number {
    const v = this.state.velocity;
    return (this.flying ? length(v) : Math.hypot(v[0], v[2])) / this.tuning.unit;
  }

  readout(): string {
    const speed = `${Math.round(this.speed)} u/s`;
    if (!this.flying) return speed;
    return `${NOCLIP_LABEL} · ${this.notice > 0 ? NO_ROOM : speed}`;
  }

  dispose(): void {
    this.physics.removeBody(this.body);
  }

  /** Props the player ran into take its momentum, shared by mass (a perfectly soft knock). */
  private push(): void {
    const hits = new Map<BodyId, { speed: number; normal: Vec3; point: Vec3 | null }>();
    for (const touch of this.state.touched) {
      if (this.physics.motion(touch.body) !== Motion.Dynamic) continue;
      const speed = -dot(touch.velocity, touch.normal);
      if (speed > (hits.get(touch.body)?.speed ?? 0)) hits.set(touch.body, { speed, normal: touch.normal, point: touch.point });
    }
    const mp = this.tuning.mass;
    for (const [body, h] of hits) {
      const mb = this.physics.mass(body);
      this.physics.applyImpulse(body, scale(h.normal, -h.speed * ((mp * mb) / (mp + mb))), h.point ?? undefined);
    }
  }

  /** Standing on a prop presses it down with the player's weight (a seesaw tips). */
  private lean(dt: number): void {
    const p = this.state;
    if (p.ground === null || this.physics.motion(p.ground) !== Motion.Dynamic) return;
    const feet: Vec3 = [p.origin[0], p.origin[1] - hullOf(p, this.tuning)[1], p.origin[2]];
    this.physics.applyImpulse(p.ground, [0, -this.tuning.mass * this.tuning.gravity * dt, 0], feet);
  }

  private respawn(): void {
    const p = this.state;
    p.origin = this.spawn.origin;
    p.velocity = [0, 0, 0];
    this.yaw = this.spawn.yaw;
    this.pitch = this.spawn.pitch;
    p.ground = null;
    this.settle = true;
  }

  /** Noclip's flight on this step's keys: the view steers, Space and Ctrl (or C) rise and sink, Shift speeds. */
  private fly(input: ActorInput, dt: number): void {
    const b = input.buttons;
    const up = (b.has(Button.Jump) ? 1 : 0) - (b.has(Button.Duck) ? 1 : 0);
    noclipMove(this.state, { forward: input.move[2], side: input.move[0], up, fast: b.has(Button.Speed), yaw: this.yaw, pitch: this.pitch }, this.tuning, dt);
    this.physics.setPose(this.body, { position: this.state.origin, rotation: IDENTITY_Q });
  }

  /** Where the hull fits nearest the player now (itself when it fits), or null; `straight`: by an open path first. */
  private place(straight: boolean): Vec3 | null {
    const p = this.state;
    return freeSpot(p.origin, hullOf(p, this.tuning), this.tracer, FREE_REACH * this.settings.height, straight);
  }

  /** Half-Life's nudge out of what the hull is in; stuck for half a second, the nearest open place, reached straight if it can be. */
  private unstuck(): void {
    const p = this.state;
    if (unstick(p, this.tuning, this.tracer)) {
      this.stuck = 0;
      return;
    }
    if (++this.stuck < STUCK_STEPS) return;
    this.stuck = 0;
    const spot = this.place(true);
    if (!spot) return;
    p.origin = spot;
    p.velocity = ZERO3;
  }
}
