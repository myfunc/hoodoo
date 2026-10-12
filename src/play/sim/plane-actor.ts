import { type Vec3, add, dot, length, lerp3, normalize, scale, sub } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import type { PlaneSettings } from '../../world/plane-settings';
import type { PlayerSettings } from '../../world/player-settings';
import { type Actor, type ActorContext, type ActorInput, Button, type Eye } from './actor';
import { type Clear, PlaneCamera, type View, eyeOfView, lerpView } from './plane-camera';
import { type FlightControls, type FlightState, type FlightTuning, PLANE, axesOf, axisQ, flightStep, flightTuning, newFlight } from './plane-flight';
import { COCKPIT_HIDES, type PlanePose, planeObjects, posedParts } from './plane-model';
import { type BodyId, Layer, Motion, type Physics, type Pose } from './physics';
import { type Quat, mulQ, slerpQ } from './quat';
import { ShapeType } from './shapes';

/** Where a plane starts: its frame, its speed along the nose, its throttle, and the ground's normal when it stands on it. */
export interface PlaneStart {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly speed: number;
  readonly throttle: number;
  readonly ground?: Vec3 | null;
}

/** Degrees the propeller turns per revolution. */
const TURN = 360;
/** Collision sweeps per step: the move, and slides along what it met. */
const SLIDES = 3;
/** The feelers past the hull ball, in the plane's frame at a human's size: the spinner and the wing tips. */
const FEELERS: readonly Vec3[] = [[0, 0, -0.95], [-1.15, -0.08, -0.12], [1.15, -0.08, -0.12]];
const WOBBLE_AXIS: Vec3 = [0.3, 0, -1];
const MIN_LENGTH = 1e-6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const WOBBLE_UNIT = normalize(WOBBLE_AXIS);

/**
 * READ ME — the plane as the player (docs/play-mode.md). The flight is
 * plane-flight.ts; this adds the world. The plane is a kinematic ball in the
 * physics world (so props falling on it meet it) and moves by sweeping that
 * ball along its velocity: a floor met gently with the wings level takes the
 * wheels; anything else bounces it back with a wobble and swings the nose
 * clear — never a crash. Three feelers (spinner, wing tips) keep the parts
 * outside the ball from poking into walls. Physical props it meets take an
 * impulse shared by mass and are knocked away; only one much heavier than
 * the plane bounces it like a wall. The mouse is a
 * stick that springs back; the keys and arrows add to it. V switches chase and
 * cockpit views, R starts over, Space boosts.
 */
export class PlaneActor implements Actor {
  readonly id = 'plane';
  readonly flight: FlightState;
  tuning: FlightTuning;
  private readonly body: BodyId;
  private readonly parts: SceneObject[];
  private readonly camera = new PlaneCamera();
  private readonly clear: Clear;
  /** The mouse's stick: roll, pitch (nose up +), −1..1. */
  private readonly stick: [number, number] = [0, 0];
  private held = { view: false, reset: false };
  private spin = 0;
  private prevSpin = 0;
  private prevPose: Pose;
  private prevView: View;
  private currView: View;
  private lastEye: Eye | undefined;
  private wobble = { amplitude: 0, time: 0 };

  constructor(private readonly physics: Physics, private settings: PlaneSettings, private player: PlayerSettings, readonly spawn: PlaneStart, private readonly killY: number, from: PlaneStart = spawn) {
    this.tuning = flightTuning(player.height, settings);
    this.flight = { ...newFlight(from.position, from.rotation, from.speed, from.throttle), ground: from.ground ?? null };
    this.parts = planeObjects(this.tuning.size);
    this.body = physics.addBody({ motion: Motion.Kinematic, position: from.position, shapes: [{ type: ShapeType.Ball, radius: this.tuning.hullRadius }], layer: Layer.Player, collidesWith: Layer.Prop, tag: this.id });
    this.clear = (a, b) => this.clearPath(a, b);
    this.prevPose = this.pose();
    this.currView = this.prevView = this.camera.snap(this.subject(), this.clear);
  }

  /** The user's plane settings changed mid-flight: the same plane flies on with them. */
  configure(settings: PlaneSettings, player: PlayerSettings): void {
    this.settings = settings;
    this.player = player;
    this.tuning = flightTuning(player.height, settings);
  }

  get cockpit(): boolean {
    return this.camera.cockpit;
  }

  /** Where the plane is and how it flies now, to start another plane there. */
  state(): PlaneStart {
    const f = this.flight;
    return { position: f.position, rotation: f.rotation, speed: dot(f.velocity, axesOf(f.rotation).forward), throttle: f.throttle, ground: f.ground };
  }

  look(dx: number, dy: number): void {
    const k = PLANE.mouse.stick * this.player.sensitivity;
    this.stick[0] = clamp(this.stick[0] + dx * k, -1, 1);
    this.stick[1] = clamp(this.stick[1] - dy * k, -1, 1);
  }

  step(input: ActorInput, ctx: ActorContext): void {
    const f = this.flight;
    const dt = ctx.dt;
    this.prevPose = this.pose();
    this.prevView = this.currView;
    this.prevSpin = this.spin;
    if (this.pressed('view', input.buttons.has(Button.View))) {
      this.camera.cockpit = !this.camera.cockpit;
      this.currView = this.prevView = this.camera.snap(this.subject(), this.clear);
    }
    if (this.pressed('reset', input.buttons.has(Button.Reload))) this.respawn();
    flightStep(f, this.controls(input), this.tuning, dt);
    const spring = Math.exp(-PLANE.mouse.spring * dt);
    this.stick[0] *= spring;
    this.stick[1] *= spring;
    if (f.ground) this.keepOnGround(f.ground);
    this.move(dt);
    this.findGround();
    if (f.position[1] < this.killY) this.respawn();
    const p = PLANE.propeller;
    this.spin += (p.idle + (p.full - p.idle) * f.throttle + (f.boost > 0 ? p.boost : 0)) * TURN * dt;
    this.wobble.time += dt;
    this.wobble.amplitude *= Math.exp(-PLANE.bump.wobbleFade * dt);
    this.physics.setPose(this.body, { position: f.position, rotation: f.rotation });
    this.currView = this.camera.step(this.subject(), dt, this.clear);
  }

  eye(): Eye {
    return this.view(1);
  }

  view(alpha: number): Eye {
    this.lastEye = eyeOfView(lerpView(this.prevView, this.currView, alpha), this.lastEye);
    return this.lastEye;
  }

  figure(alpha: number): readonly SceneObject[] {
    return posedParts(this.parts, this.poseAt(alpha), this.prevSpin + (this.spin - this.prevSpin) * alpha, this.camera.cockpit ? COCKPIT_HIDES : undefined);
  }

  /** What a take records of the plane, `alpha` of the way through the last step. */
  record(alpha: number): PlanePose {
    const pose = this.poseAt(alpha);
    return { position: pose.position, rotation: pose.rotation, size: this.tuning.size, spin: this.prevSpin + (this.spin - this.prevSpin) * alpha };
  }

  /** Speed and height above what is below, in scene units. */
  readout(): string {
    return `SPD ${length(this.flight.velocity).toFixed(1)} · ALT ${this.altitude().toFixed(1)}`;
  }

  gauge(): { level: number; hot: boolean } {
    return { level: this.flight.throttle, hot: this.flight.boost > 0 };
  }

  dispose(): void {
    this.physics.removeBody(this.body);
  }

  /** The plane as drawn: its frame with the wobble of a bump. */
  pose(): Pose {
    const f = this.flight;
    const w = this.wobble;
    const angle = w.amplitude * Math.sin(2 * Math.PI * PLANE.bump.wobbleHz * w.time);
    return { position: f.position, rotation: w.amplitude > MIN_LENGTH ? mulQ(f.rotation, axisQ(WOBBLE_UNIT, angle)) : f.rotation };
  }

  private poseAt(alpha: number): Pose {
    const now = this.pose();
    return { position: lerp3(this.prevPose.position, now.position, alpha), rotation: slerpQ(this.prevPose.rotation, now.rotation, alpha) };
  }

  private subject() {
    const t = this.tuning;
    return { pose: this.pose(), speed: length(this.flight.velocity), size: t.size, cruise: t.cruiseSpeed, maxSpeed: t.maxSpeed };
  }

  /** A button's press, once (held keys repeat every step). */
  private pressed(which: 'view' | 'reset', down: boolean): boolean {
    const was = this.held[which];
    this.held = { ...this.held, [which]: down };
    return down && !was;
  }

  private controls(input: ActorInput): FlightControls {
    const [ax, ay] = input.arrows ?? [0, 0];
    const invert = this.settings.invertPitch ? -1 : 1;
    return {
      pitch: clamp(this.stick[1] + ay, -1, 1) * invert,
      roll: clamp(this.stick[0] + ax + input.move[0], -1, 1),
      throttle: clamp(input.move[2] + input.move[1], -1, 1),
      boost: input.buttons.has(Button.Jump),
    };
  }

  /** Rolling: nothing pushes the wheels into the ground. */
  private keepOnGround(n: Vec3): void {
    const into = dot(this.flight.velocity, n);
    if (into < 0) this.flight.velocity = sub(this.flight.velocity, scale(n, into));
  }

  /** Sweeps the hull along the velocity; what it meets bounces it, carries its wheels or is pushed. Then the feelers. */
  private move(dt: number): void {
    const f = this.flight;
    const r = this.tuning.hullRadius;
    const skin = PLANE.bump.skin * this.tuning.size;
    let left = dt;
    for (let i = 0; i < SLIDES && left > 0; i++) {
      const tr = this.physics.traceBall(f.position, add(f.position, scale(f.velocity, left)), r, skin, { exclude: this.body });
      if (tr.startSolid) {
        this.unstick();
        return;
      }
      f.position = tr.end;
      if (tr.fraction >= 1 || tr.body === null) break;
      // A prop knocked away moves in the physics step: the plane goes on from here next step.
      if (!this.meet(tr.normal, tr.body, tr.point)) break;
      left *= 1 - tr.fraction;
    }
    const { forward, right, up } = axesOf(f.rotation);
    for (const local of FEELERS) {
      const reach = scale(local, this.tuning.size);
      const dir = add(scale(forward, -reach[2]), add(scale(right, reach[0]), scale(up, reach[1])));
      const span = length(dir);
      const hit = this.physics.raycast(f.position, dir, span, { exclude: this.body });
      if (!hit) continue;
      const depth = (span - hit.distance) * Math.max(0, -dot(normalize(dir), hit.normal));
      f.position = add(f.position, scale(hit.normal, depth));
      this.meet(hit.normal, hit.body, hit.point);
    }
  }

  /** The plane met a surface with this outward normal; false when it was a prop (it moves out of the way in the physics step). */
  private meet(n: Vec3, body: BodyId, point: Vec3 | null): boolean {
    const f = this.flight;
    const into = -dot(f.velocity, n);
    if (into <= 0) return true;
    const touch = PLANE.touch;
    if (n[1] >= touch.floor && into <= touch.land * this.tuning.size * this.settings.speedScale && axesOf(f.rotation).up[1] >= touch.upright) {
      f.velocity = add(f.velocity, scale(n, into));
      f.ground = n;
      return true;
    }
    const b = PLANE.bump;
    const prop = this.physics.motion(body) === Motion.Dynamic;
    if (prop) {
      const [mp, mb] = [this.tuning.mass, this.physics.mass(body)];
      const j = (1 + b.propRestitution) * into * ((mp * mb) / (mp + mb));
      this.physics.applyImpulse(body, scale(n, -j), point ?? undefined);
      f.velocity = add(f.velocity, scale(n, j / mp));
      this.shake(j / mp);
      // Lighter than the plane, or not much heavier: knocked away, and the plane flies (or rolls) on.
      if (mb < mp * b.heavy) return false;
    } else {
      const along = add(f.velocity, scale(n, into));
      f.velocity = add(scale(along, b.scrape), scale(n, into * b.restitution));
      this.shake(into);
    }
    f.recoil = b.recoil;
    f.ground = null;
    return !prop;
  }

  private shake(speed: number): void {
    const share = Math.min(1, speed / this.tuning.cruiseSpeed);
    this.wobble = { amplitude: Math.max(this.wobble.amplitude, PLANE.bump.wobble * share), time: 0 };
  }

  /** Started inside something (a prop landed on it, a keyed wall moved in): out the way up, slowly. */
  private unstick(): void {
    const f = this.flight;
    f.position = add(f.position, [0, this.tuning.hullRadius / 2, 0]);
    f.velocity = scale(f.velocity, 1 / 2);
  }

  /** The wheels stay on a floor just below while the plane is not climbing away from it. */
  private findGround(): void {
    const f = this.flight;
    const r = this.tuning.hullRadius;
    const touch = PLANE.touch;
    const reach = r + touch.probe * this.tuning.size;
    // Straight down a slope is longer than across it: the ray reaches as far as the steepest floor needs.
    const hit = f.ground ? this.physics.raycast(f.position, [0, -1, 0], reach / touch.floor, { exclude: this.body }) : null;
    const n = hit?.normal;
    if (!hit || !n || n[1] < touch.floor || hit.distance * n[1] > reach || dot(f.velocity, n) > touch.leave * this.tuning.size) {
      f.ground = null;
      return;
    }
    f.ground = n;
    const gap = hit.distance * n[1];
    f.position = [f.position[0], f.position[1] + (r + PLANE.bump.skin * this.tuning.size - gap) / n[1], f.position[2]];
  }

  /** Height above what is below (or above the fall limit when nothing is). */
  private altitude(): number {
    const f = this.flight;
    const far = Math.max(0, f.position[1] - this.killY);
    const hit = this.physics.raycast(f.position, [0, -1, 0], far, { exclude: this.body });
    return Math.max(0, (hit ? hit.distance : far) - this.tuning.hullRadius);
  }

  /** The chase eye goes no further than the first wall between it and the plane. */
  private clearPath(from: Vec3, to: Vec3): Vec3 {
    const d = sub(to, from);
    const span = length(d);
    if (span < MIN_LENGTH) return to;
    const hit = this.physics.raycast(from, d, span, { layers: Layer.World, exclude: this.body });
    if (!hit) return to;
    return add(from, scale(d, Math.max(0, hit.distance - PLANE.chase.clearance * this.tuning.size) / span));
  }

  private respawn(): void {
    const s = this.spawn;
    Object.assign(this.flight, newFlight(s.position, s.rotation, s.speed, s.throttle), { ground: s.ground ?? null });
    this.physics.teleport(this.body, { position: s.position, rotation: s.rotation });
    this.wobble = { amplitude: 0, time: 0 };
    this.prevPose = this.pose();
    this.currView = this.prevView = this.camera.snap(this.subject(), this.clear);
    this.lastEye = undefined;
  }
}
