import { type Vec3, add, dot, scale, sub } from '../../core/vec3';
import type { PlayerSettings } from '../../world/player-settings';
import { type Actor, type ActorContext, type ActorInput, Button, type Eye } from './actor';
import { type Tuning, tuningOf } from './movement';
import { type BodyId, Layer, Motion, type Physics, type Pose } from './physics';
import { type PlayerState, type Tracer, eyeOf, hullOf, newPlayer, playerMove, unstick } from './pmove';
import { IDENTITY_Q, conjQ, mulQ, rotateQ } from './quat';
import { ShapeType } from './shapes';

/** Degrees the view turns per pixel at sensitivity 1 (Half-Life's 3 × m_yaw 0.022 per count, about two counts a pixel). */
const DEG_PER_PX = 0.12;
const PITCH_LIMIT = 89;
/** Platforms moving into the player shove it this many times per step at most. */
const PUSHES = 2;

/**
 * READ ME — the first-person walker: Half-Life's movement (pmove.ts) on the
 * physics layer. Its hull sweeps against the world and the props; what it runs
 * into is pushed with the player's momentum (80 kg at human size, scaling with
 * the cube of the height); what it stands on carries it when keys move it, and
 * a moving platform shoves it out of the way. Its own box in the physics world
 * only meets props, so a crate dropped on the player rests on its head.
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

  step(input: ActorInput, ctx: ActorContext): void {
    const p = this.state;
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
    if (this.carrier && p.ground === this.carrier.body) {
      const now = this.physics.pose(this.carrier.body);
      const before = this.carrier.pose;
      const moved = add(rotateQ(mulQ(now.rotation, conjQ(before.rotation)), sub(p.origin, before.position)), now.position);
      p.origin = this.tracer.trace(p.origin, moved, hullOf(p, t)).end;
    }
    for (let i = 0; i < PUSHES; i++) {
      const pusher = this.physics.overlapsBox(p.origin, hullOf(p, t), t.skin, { layers: Layer.World, exclude: this.body });
      if (pusher === null || this.physics.motion(pusher) !== Motion.Kinematic) break;
      p.origin = add(p.origin, scale(this.physics.velocityAt(pusher, p.origin), this.physics.dt));
    }
    unstick(p, t, this.tracer);
    if (p.origin[1] < this.killY) this.respawn();
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
  }

  eye(): Eye {
    return { position: eyeOf(this.state), yaw: this.yaw, pitch: this.pitch, bank: 0 };
  }

  /** A velocity change (a jump pad, a blast): an upward one lifts the player off the ground. */
  kick(dv: Vec3): void {
    const p = this.state;
    p.velocity = add(p.velocity, dv);
    if (dv[1] > 0) p.ground = null;
  }

  /** The player's feet at `feet`, standing still, looking the same way (a teleporter). */
  teleport(feet: Vec3): void {
    const p = this.state;
    p.origin = [feet[0], feet[1] + hullOf(p, this.tuning)[1] + this.tuning.skin, feet[2]];
    p.velocity = [0, 0, 0];
    p.ground = null;
    this.physics.setPose(this.body, { position: p.origin, rotation: IDENTITY_Q });
  }

  /** Ground speed in Half-Life units a second, the speedometer of bunny hoppers. */
  get speed(): number {
    return Math.hypot(this.state.velocity[0], this.state.velocity[2]) / this.tuning.unit;
  }

  readout(): string {
    return `${Math.round(this.speed)} u/s`;
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
  }
}
