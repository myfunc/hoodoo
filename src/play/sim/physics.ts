import { Layer } from './layers';
import type RAPIER from '@dimforge/rapier3d-compat';
import { type Vec3, ZERO3, add, dot, length, scale, sub } from '../../core/vec3';
import type { Trace } from './pmove';
import { IDENTITY_Q, type Quat, conjQ, mulQ, rotateQ } from './quat';
import { type ShapeSpec, ShapeType } from './shapes';

/**
 * READ ME — the physics layer: a thin wrapper over Rapier (WASM), loaded only
 * when Play starts. Everything outside speaks Hoodoo's terms: bodies are ids
 * with a tag (the scene object or group they stand for), shapes are ShapeSpec,
 * poses are a position and a quaternion. Bodies are Fixed, Kinematic (moved by
 * keys) or Dynamic (physical). Layers say who collides with whom; joints, holds
 * (a body pulled toward a target that still collides), freezing, CCD, rays and
 * the player's hull sweeps are all here. Queries see the world as of the last
 * `step`: a body added or moved in between is found after the next one.
 * A terrain is only its surface to Rapier, and Rapier's overlap query does not
 * see height fields at all: the queries here ask each terrain for a contact and
 * also count a hull under its surface, inside the ground the picture shows, as
 * overlapping (`inTerrain`).
 */

export type Rapier = typeof RAPIER;
export type BodyId = number;
export type JointId = number;

export enum Motion {
  Fixed = 'fixed',
  Kinematic = 'kinematic',
  Dynamic = 'dynamic',
}

/** Collision layers (layers.ts), here for what already reads them from physics. */
export { Layer };
export const ALL_LAYERS = 0xffff;
const GROUP_SHIFT = 16;

export interface Pose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

export interface BodySpec {
  readonly motion: Motion;
  readonly position: Vec3;
  readonly rotation?: Quat;
  readonly shapes: readonly ShapeSpec[];
  /** Kilograms over all shapes (dynamic bodies); absent: Rapier's density 1 per cubic unit. */
  readonly mass?: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly layer?: Layer;
  readonly collidesWith?: number;
  /** Continuous collision for fast bodies (thrown props). */
  readonly ccd?: boolean;
  /** Linear and angular damping per second (dynamic bodies): a pushed ball rolls to a stop. */
  readonly damping?: readonly [linear: number, angular: number];
  /** Only reports overlaps (trigger zones); nothing bumps into it. */
  readonly sensor?: boolean;
  /** Its contacts start and stop events (`step` returns them). */
  readonly events?: boolean;
  /** What it stands for in the scene: an object or group id. */
  readonly tag?: string;
}

export interface RayHit {
  readonly body: BodyId;
  readonly tag: string | null;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

export interface QueryOptions {
  /** Layers a query meets (default: the world and props). */
  readonly layers?: number;
  readonly exclude?: BodyId;
}

export interface ContactEvent {
  readonly a: BodyId;
  readonly b: BodyId;
  readonly started: boolean;
}

export enum JointType {
  /** Glued together (weld). */
  Weld = 'weld',
  /** Turning about `axis` (hinges, wheels); a motor can drive it. */
  Axis = 'axis',
  /** Turning freely about the anchor (ballsocket). */
  Ball = 'ball',
  /** At most `length` apart. */
  Rope = 'rope',
}

export interface JointSpec {
  readonly type: JointType;
  readonly a: BodyId;
  readonly b: BodyId;
  /** Anchors in each body's own frame. */
  readonly anchorA: Vec3;
  readonly anchorB: Vec3;
  /** Axis joints: the axis in body A's frame. */
  readonly axis?: Vec3;
  readonly length?: number;
  /** Axis joints: target speed (radians a second) and the force it may use; with speed 0, friction. */
  readonly motor?: { readonly speed: number; readonly force: number };
  /**
   * The joint breaks under more than this force (kg·units/s²). Rapier reports no joint forces, so it is
   * estimated from how fast the anchors move apart before a step: knocks and yanks break joints, a steady load does not.
   */
  readonly breakForce?: number;
  /** The two bodies still collide with each other (off by default). */
  readonly collide?: boolean;
}

/** How strongly a motor holds its speed (damping of Rapier's velocity motor). */
const MOTOR_DAMPING = 50;
/** How hard a held body follows its target: the share of the gap closed each step, and a speed limit. */
const HOLD = { gain: 0.5, maxSpeed: 60 } as const;
/** Default damping [linear, angular] per second: air drag is slight, rolling resistance stops a ball in a few seconds. */
const DAMPING = [0.05, 0.6] as const;
const MIN_LENGTH = 1e-9;
const MAX_TRACE_TRIES = 4;
/** A move this close to parallel to a surface it touches slides along it (the normal has float noise). */
const PARALLEL = 1e-3;
/** Rapier's shape kinds made of many pieces (ShapeType's numbers): leaving one piece says nothing of the others. */
const PIECEWISE = new Set([4, 6, 7, 8]);
const UP: Vec3 = [0, 1, 0];

let loading: Promise<Rapier> | null = null;

/** Rapier's module, fetched and started once (a separate chunk: the editor never loads it). */
export function loadRapier(): Promise<Rapier> {
  loading ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = (m.default ?? m) as Rapier;
    await R.init();
    return R;
  });
  return loading;
}

const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const rv = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const rq = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
const groups = (layer: number, with_: number): number => ((layer & ALL_LAYERS) << GROUP_SHIFT) | (with_ & ALL_LAYERS);
const pairKey = (a: BodyId, b: BodyId): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Half-extents less half the skin: touching is not overlapping. */
const inset = (half: Vec3, skin: number): Vec3 => [Math.max(half[0] - skin / 2, MIN_LENGTH), Math.max(half[1] - skin / 2, MIN_LENGTH), Math.max(half[2] - skin / 2, MIN_LENGTH)];

interface Joint {
  readonly joint: RAPIER.ImpulseJoint;
  readonly spec: JointSpec;
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly tags = new Map<BodyId, string>();
  private readonly holds = new Map<BodyId, Pose>();
  private readonly joints = new Map<JointId, Joint>();
  private readonly apart = new Set<string>();
  private readonly events: RAPIER.EventQueue;
  private readonly boxes = new Map<string, RAPIER.Cuboid>();
  private readonly balls = new Map<number, RAPIER.Ball>();
  private readonly hooks: RAPIER.PhysicsHooks;
  /** Height fields (terrains) and their extent in their own frame: X and Z half-widths, the highest point. */
  private readonly fields = new Map<RAPIER.Collider, Vec3>();

  constructor(private readonly R: Rapier, gravity: number, readonly dt: number) {
    this.world = new R.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = dt;
    this.events = new R.EventQueue(true);
    this.hooks = {
      filterContactPair: (_c1, _c2, b1, b2) => (this.apart.has(pairKey(b1, b2)) ? null : R.SolverFlags.COMPUTE_IMPULSE),
      filterIntersectionPair: (_c1, _c2, b1, b2) => !this.apart.has(pairKey(b1, b2)),
    };
  }

  addBody(spec: BodySpec): BodyId {
    const R = this.R;
    const desc = spec.motion === Motion.Dynamic ? R.RigidBodyDesc.dynamic() : spec.motion === Motion.Kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed();
    desc.setTranslation(spec.position[0], spec.position[1], spec.position[2]).setRotation(rq(spec.rotation ?? IDENTITY_Q)).setCcdEnabled(spec.ccd === true);
    const [linear, angular] = spec.damping ?? DAMPING;
    desc.setLinearDamping(linear).setAngularDamping(angular);
    const body = this.world.createRigidBody(desc);
    const share = spec.mass !== undefined && spec.shapes.length ? spec.mass / spec.shapes.length : undefined;
    const layer = spec.layer ?? (spec.motion === Motion.Dynamic ? Layer.Prop : Layer.World);
    for (const s of spec.shapes) {
      const c = this.colliderDesc(s);
      if (!c) continue;
      c.setCollisionGroups(groups(s.layer ?? layer, s.collidesWith ?? spec.collidesWith ?? ALL_LAYERS)).setSensor(spec.sensor === true);
      if (share !== undefined) c.setMass(share);
      if (spec.friction !== undefined) c.setFriction(spec.friction);
      if (spec.restitution !== undefined) c.setRestitution(spec.restitution);
      if (spec.events) c.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(c, body);
      if (s.type === ShapeType.HeightField) this.fields.set(collider, [s.scale[0] / 2, s.scale[1] * s.heights.reduce((m, h) => Math.max(m, h), 0), s.scale[2] / 2]);
    }
    if (spec.tag !== undefined) this.tags.set(body.handle, spec.tag);
    return body.handle;
  }

  removeBody(id: BodyId): void {
    const b = this.body(id);
    for (const c of this.fields.keys()) if (c.parent()?.handle === id) this.fields.delete(c);
    if (b) this.world.removeRigidBody(b);
    this.tags.delete(id);
    this.holds.delete(id);
  }

  /** The scene object or group a body stands for. */
  tag(id: BodyId): string | null {
    return this.tags.get(id) ?? null;
  }

  motion(id: BodyId): Motion | null {
    const b = this.body(id);
    if (!b) return null;
    return b.isDynamic() ? Motion.Dynamic : b.isKinematic() ? Motion.Kinematic : Motion.Fixed;
  }

  pose(id: BodyId): Pose {
    const b = this.body(id);
    if (!b) return { position: ZERO3, rotation: IDENTITY_Q };
    const r = b.rotation();
    return { position: v3(b.translation()), rotation: [r.x, r.y, r.z, r.w] };
  }

  /** Puts a body somewhere at once (a kinematic body: where it goes in the next step). */
  setPose(id: BodyId, pose: Pose): void {
    const b = this.body(id);
    if (!b) return;
    if (b.isKinematic()) {
      b.setNextKinematicTranslation(rv(pose.position));
      b.setNextKinematicRotation(rq(pose.rotation));
      return;
    }
    b.setTranslation(rv(pose.position), true);
    b.setRotation(rq(pose.rotation), true);
  }

  /** Puts a body somewhere at once with nothing in between: a kinematic body jumps there instead of sweeping. */
  teleport(id: BodyId, pose: Pose): void {
    const b = this.body(id);
    if (!b) return;
    b.setTranslation(rv(pose.position), true);
    b.setRotation(rq(pose.rotation), true);
    if (b.isKinematic()) {
      b.setNextKinematicTranslation(rv(pose.position));
      b.setNextKinematicRotation(rq(pose.rotation));
    }
  }

  velocity(id: BodyId): { linear: Vec3; angular: Vec3 } {
    const b = this.body(id);
    return b ? { linear: v3(b.linvel()), angular: v3(b.angvel()) } : { linear: ZERO3, angular: ZERO3 };
  }

  setVelocity(id: BodyId, linear: Vec3, angular?: Vec3): void {
    const b = this.body(id);
    b?.setLinvel(rv(linear), true);
    if (angular) b?.setAngvel(rv(angular), true);
  }

  /** The velocity of the body's material at a world point (a platform under the player). */
  velocityAt(id: BodyId, point: Vec3): Vec3 {
    const b = this.body(id);
    return b ? v3(b.velocityAtPoint(rv(point))) : ZERO3;
  }

  mass(id: BodyId): number {
    return this.body(id)?.mass() ?? 0;
  }

  /** An impulse (kg·units/s), at a world point or at the centre of mass. */
  applyImpulse(id: BodyId, impulse: Vec3, point?: Vec3): void {
    const b = this.body(id);
    if (!b?.isDynamic()) return;
    if (point) b.applyImpulseAtPoint(rv(impulse), rv(point), true);
    else b.applyImpulse(rv(impulse), true);
  }

  /** A force for the next step only (thrusters push every step). */
  applyForce(id: BodyId, force: Vec3, point?: Vec3): void {
    const b = this.body(id);
    if (!b?.isDynamic()) return;
    if (point) b.addForceAtPoint(rv(force), rv(point), true);
    else b.addForce(rv(force), true);
  }

  /** Frozen: the body stays where it is as a fixed one, and comes back dynamic as it was. */
  setFrozen(id: BodyId, frozen: boolean): void {
    const b = this.body(id);
    if (!b || b.isKinematic()) return;
    b.setBodyType(frozen ? this.R.RigidBodyType.Fixed : this.R.RigidBodyType.Dynamic, true);
  }

  /** Gravity pulls down this hard (units/s²): it follows the player's size. */
  setGravity(gravity: number): void {
    this.world.gravity = { x: 0, y: -gravity, z: 0 };
  }

  /** New half-extents for a body made of one box (the player's hull when it ducks). */
  setBoxHalf(id: BodyId, half: Vec3): void {
    this.eachCollider(id, (c) => c.setHalfExtents(rv(half)));
  }

  setCcd(id: BodyId, on: boolean): void {
    this.body(id)?.enableCcd(on);
  }

  setLayer(id: BodyId, layer: Layer, collidesWith = ALL_LAYERS): void {
    this.eachCollider(id, (c) => c.setCollisionGroups(groups(layer, collidesWith)));
  }

  /** Two bodies pass through each other (no-collide), or collide again. */
  setNoCollide(a: BodyId, b: BodyId, on: boolean): void {
    if (on) this.apart.add(pairKey(a, b));
    else this.apart.delete(pairKey(a, b));
    const hooks = this.R.ActiveHooks.FILTER_CONTACT_PAIRS | this.R.ActiveHooks.FILTER_INTERSECTION_PAIRS;
    for (const id of [a, b]) this.eachCollider(id, (c) => c.setActiveHooks(hooks));
  }

  /** Pulls a dynamic body toward `target` every step while it keeps colliding (a physgun's grip); null lets go. */
  hold(id: BodyId, target: Pose | null): void {
    if (target) this.holds.set(id, target);
    else this.holds.delete(id);
  }

  addJoint(spec: JointSpec): JointId | null {
    const R = this.R;
    const [a, b] = [this.body(spec.a), this.body(spec.b)];
    if (!a || !b) return null;
    const [pa, pb] = [rv(spec.anchorA), rv(spec.anchorB)];
    const data = spec.type === JointType.Weld
      ? R.JointData.fixed(pa, rq(conjQ(this.pose(spec.a).rotation)), pb, rq(conjQ(this.pose(spec.b).rotation)))
      : spec.type === JointType.Axis ? R.JointData.revolute(pa, pb, rv(spec.axis ?? [0, 1, 0]))
        : spec.type === JointType.Ball ? R.JointData.spherical(pa, pb)
          : R.JointData.rope(spec.length ?? length(sub(this.worldPoint(spec.b, spec.anchorB), this.worldPoint(spec.a, spec.anchorA))), pa, pb);
    const joint = this.world.createImpulseJoint(data, a, b, true);
    joint.setContactsEnabled(spec.collide === true);
    if (spec.motor && spec.type === JointType.Axis) this.motorOf(joint, spec.motor);
    this.joints.set(joint.handle, { joint, spec });
    return joint.handle;
  }

  removeJoint(id: JointId): void {
    const j = this.joints.get(id);
    if (j?.joint.isValid()) this.world.removeImpulseJoint(j.joint, true);
    this.joints.delete(id);
  }

  setMotor(id: JointId, speed: number, force: number): void {
    const j = this.joints.get(id);
    if (j && j.spec.type === JointType.Axis) this.motorOf(j.joint, { speed, force });
  }

  /** The first body along a ray (`dir` need not be unit length; distance is along it). */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number, opts: QueryOptions = {}): RayHit | null {
    const l = length(dir);
    if (l < MIN_LENGTH) return null;
    const unit = scale(dir, 1 / l);
    const ray = new this.R.Ray(rv(origin), rv(unit));
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, this.R.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL_LAYERS, opts.layers ?? Layer.World | Layer.Prop), undefined, this.body(opts.exclude ?? -1) ?? undefined);
    if (!hit) return null;
    const body = hit.collider.parent()?.handle ?? -1;
    return { body, tag: this.tag(body), point: add(origin, scale(unit, hit.timeOfImpact)), normal: v3(hit.normal), distance: hit.timeOfImpact };
  }

  /**
   * The player's hull sweep (pmove's Tracer): an axis-aligned box from `start` to `end` that stops
   * `skin` short of what it meets. Touching something while moving away from it does not block.
   */
  traceBox(start: Vec3, end: Vec3, half: Vec3, skin: number, opts: QueryOptions = {}): Trace {
    return this.sweep(this.box(half), this.box(inset(half, skin)), start, end, skin, opts);
  }

  /** The plane's hull sweep: a ball from `start` to `end`, as `traceBox` (a ball turns with nothing). */
  traceBall(start: Vec3, end: Vec3, radius: number, skin: number, opts: QueryOptions = {}): Trace {
    return this.sweep(this.ball(radius), this.ball(Math.max(radius - skin / 2, MIN_LENGTH)), start, end, skin, opts);
  }

  /** A body overlapping the box (shrunk by half the skin, so touching is not overlapping), or null. */
  overlapsBox(center: Vec3, half: Vec3, skin: number, opts: QueryOptions = {}): BodyId | null {
    return this.overlaps(center, this.box(inset(half, skin)), opts);
  }

  /** One fixed step: holds pull, joints past their limit break, Rapier integrates. Returns the contact events and broken joints. */
  step(): { contacts: ContactEvent[]; broken: JointId[] } {
    for (const [id, target] of this.holds) this.pull(id, target);
    const broken = this.breakJoints();
    this.world.step(this.events, this.hooks);
    const contacts: ContactEvent[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.world.getCollider(h1)?.parent()?.handle ?? -1;
      const b = this.world.getCollider(h2)?.parent()?.handle ?? -1;
      contacts.push({ a, b, started });
    });
    this.world.bodies.forEach((body) => body.resetForces(false));
    return { contacts, broken };
  }

  /** Updates what queries see without moving anything (after adding bodies, before the first step). */
  refresh(): void {
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = this.dt;
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }

  /** A point of a body's frame in the world. */
  worldPoint(id: BodyId, local: Vec3): Vec3 {
    const p = this.pose(id);
    return add(p.position, rotateQ(p.rotation, local));
  }

  private body(id: BodyId): RAPIER.RigidBody | null {
    return id >= 0 ? (this.world.getRigidBody(id) ?? null) : null;
  }

  private eachCollider(id: BodyId, fn: (c: RAPIER.Collider) => void): void {
    const b = this.body(id);
    if (b) for (let i = 0; i < b.numColliders(); i++) fn(b.collider(i));
  }

  private box(half: Vec3): RAPIER.Cuboid {
    const key = half.join(',');
    let s = this.boxes.get(key);
    if (!s) {
      s = new this.R.Cuboid(half[0], half[1], half[2]);
      this.boxes.set(key, s);
    }
    return s;
  }

  private ball(radius: number): RAPIER.Ball {
    let s = this.balls.get(radius);
    if (!s) {
      s = new this.R.Ball(radius);
      this.balls.set(radius, s);
    }
    return s;
  }

  /**
   * `shape` swept unturned from `start` to `end`, stopping `skin` short of what it meets; `inner` (the
   * shape less half the skin) tells a start inside something. A move along or away from a surface it
   * already touches (the ground under a walk) looks again without the skin, so the rest of that body
   * still stops it: a terrain's wall ahead, the floor under a slide down a cliff. Only a convex piece
   * met exactly and not entered is passed by whole (it cannot be met again on a straight path); a
   * terrain met so is stepped off by the skin first.
   */
  private sweep(shape: RAPIER.Shape, inner: RAPIER.Shape, start: Vec3, end: Vec3, skin: number, opts: QueryOptions): Trace {
    const dir = sub(end, start);
    const len = length(dir);
    const filter = groups(ALL_LAYERS, opts.layers ?? Layer.World | Layer.Prop);
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const exclude = this.body(opts.exclude ?? -1) ?? undefined;
    const free = (from: Vec3): Trace => ({ fraction: 1, end: add(from, dir), normal: ZERO3, startSolid: false, body: null, point: null });
    if (len < MIN_LENGTH) return this.overlaps(start, inner, opts) === null ? free(start) : { ...free(start), end: start, fraction: 0, startSolid: true };
    const passed = new Set<number>();
    const skip = (c: RAPIER.Collider) => !passed.has(c.handle);
    const cast = (from: Vec3, gap: number) => this.world.castShape(rv(from), rq(IDENTITY_Q), rv(dir), shape, gap, 1, false, flags, filter, undefined, exclude, passed.size ? skip : undefined);
    const into = (hit: RAPIER.ColliderShapeCastHit) => dot(dir, v3(hit.normal1)) < -PARALLEL * len;
    const met = (from: Vec3, hit: RAPIER.ColliderShapeCastHit, fraction: number): Trace => {
      const out = { fraction, end: add(from, scale(dir, fraction)), normal: v3(hit.normal1), startSolid: false, body: hit.collider.parent()?.handle ?? -1, point: v3(hit.witness1) };
      return fraction === 0 && this.overlaps(from, inner, opts) !== null ? { ...out, startSolid: true } : out;
    };
    let from = start;
    let last: RAPIER.ColliderShapeCastHit | null = null;
    for (let i = 0; i < MAX_TRACE_TRIES; i++) {
      const hit = cast(from, skin);
      if (!hit) return free(from);
      if (hit.time_of_impact > 0 || into(hit)) return met(from, hit, hit.time_of_impact);
      const ahead = cast(from, 0);
      if (!ahead) return free(from);
      if (ahead.time_of_impact > 0) return met(from, ahead, Math.max(0, ahead.time_of_impact - skin / len));
      if (into(ahead)) return met(from, ahead, 0);
      last = ahead;
      if (PIECEWISE.has(ahead.collider.shape.type)) from = add(from, scale(v3(ahead.normal1), skin));
      else passed.add(ahead.collider.handle);
    }
    // Wedged between surfaces it touches: it stays (never through).
    return last ? met(from, last, 0) : free(from);
  }

  /** A body overlapping `shape` at `center`, or a terrain it is in; null when it is free. */
  private overlaps(center: Vec3, shape: RAPIER.Shape, opts: QueryOptions): BodyId | null {
    const layers = opts.layers ?? Layer.World | Layer.Prop;
    const c = this.world.intersectionWithShape(rv(center), rq(IDENTITY_Q), shape, this.R.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL_LAYERS, layers), undefined, this.body(opts.exclude ?? -1) ?? undefined);
    if (c) return c.parent()?.handle ?? -1;
    return this.inTerrain(center, shape, layers, opts.exclude);
  }

  /**
   * The terrain `shape` at `center` is in: crossing its surface (a contact, which Rapier's overlap
   * query skips for height fields), or wholly under it, between its base and its surface.
   */
  private inTerrain(center: Vec3, shape: RAPIER.Shape, layers: number, exclude?: BodyId): BodyId | null {
    for (const [c, [hx, hy, hz]] of this.fields) {
      const body = c.parent()?.handle ?? -1;
      const g = c.collisionGroups();
      if (body === exclude || !c.isEnabled() || !((g >>> GROUP_SHIFT) & layers) || !(g & ALL_LAYERS)) continue;
      const contact = c.contactShape(shape, rv(center), rq(IDENTITY_Q), 0);
      if (contact && contact.distance < 0) return body;
      const t = c.translation();
      const r = c.rotation();
      const turn: Quat = [r.x, r.y, r.z, r.w];
      const local = rotateQ(conjQ(turn), sub(center, v3(t)));
      if (Math.abs(local[0]) > hx || Math.abs(local[2]) > hz || local[1] < -MIN_LENGTH || local[1] > hy) continue;
      const ray = new this.R.Ray(rv(center), rv(rotateQ(turn, UP)));
      // Nothing of the field is above `hy`: a ray twice that long reaches the top with room for float error.
      if (c.castRay(ray, 2 * hy, true) >= 0) return body;
    }
    return null;
  }

  private motorOf(joint: RAPIER.ImpulseJoint, m: { speed: number; force: number }): void {
    const j = joint as RAPIER.RevoluteImpulseJoint;
    j.configureMotorVelocity(m.speed, MOTOR_DAMPING);
    j.setMotorMaxForce(m.force);
  }

  /** Closes part of the gap to the target as a velocity, so the body still collides on the way. */
  private pull(id: BodyId, target: Pose): void {
    const b = this.body(id);
    if (!b?.isDynamic()) return;
    const now = this.pose(id);
    const cap = (v: Vec3) => (length(v) > HOLD.maxSpeed ? scale(v, HOLD.maxSpeed / length(v)) : v);
    const linear = cap(scale(sub(target.position, now.position), HOLD.gain / this.dt));
    const d = mulQ(target.rotation, conjQ(now.rotation));
    const s = d[3] < 0 ? -1 : 1;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(d[3])));
    const axisLen = Math.hypot(d[0], d[1], d[2]);
    const angular: Vec3 = axisLen > MIN_LENGTH ? scale([d[0] * s, d[1] * s, d[2] * s], (angle * HOLD.gain) / this.dt / axisLen) : ZERO3;
    b.setLinvel(rv(linear), true);
    b.setAngvel(rv(angular), true);
  }

  /** Joints whose anchors part faster than their break force allows (the force to stop them within a step). */
  private breakJoints(): JointId[] {
    const broken: JointId[] = [];
    for (const [id, { spec }] of this.joints) {
      if (spec.breakForce === undefined) continue;
      const [pa, pb] = [this.worldPoint(spec.a, spec.anchorA), this.worldPoint(spec.b, spec.anchorB)];
      const apart = sub(this.velocityAt(spec.b, pb), this.velocityAt(spec.a, pa));
      const [ma, mb] = [this.mass(spec.a), this.mass(spec.b)];
      const inv = (ma > 0 && this.motion(spec.a) === Motion.Dynamic ? 1 / ma : 0) + (mb > 0 && this.motion(spec.b) === Motion.Dynamic ? 1 / mb : 0);
      if (inv > 0 && length(apart) / inv / this.dt > spec.breakForce) broken.push(id);
    }
    for (const id of broken) this.removeJoint(id);
    return broken;
  }

  private colliderDesc(s: ShapeSpec): RAPIER.ColliderDesc | null {
    const R = this.R;
    let c: RAPIER.ColliderDesc | null;
    switch (s.type) {
      case ShapeType.Ball: c = R.ColliderDesc.ball(s.radius); break;
      case ShapeType.Box: c = R.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]); break;
      case ShapeType.Cylinder: c = R.ColliderDesc.cylinder(s.halfHeight, s.radius); break;
      case ShapeType.Cone: c = R.ColliderDesc.cone(s.halfHeight, s.radius); break;
      case ShapeType.Hull: c = R.ColliderDesc.convexHull(s.points); break;
      case ShapeType.Mesh: c = R.ColliderDesc.trimesh(s.vertices, s.indices); break;
      case ShapeType.HeightField: c = R.ColliderDesc.heightfield(s.rows, s.cols, s.heights, rv(s.scale)); break;
      case ShapeType.HalfSpace: c = new R.ColliderDesc(new R.HalfSpace(rv(s.normal))); break;
    }
    if (!c) return null;
    if (s.offset) c.setTranslation(s.offset[0], s.offset[1], s.offset[2]);
    if (s.rotation) c.setRotation(rq(s.rotation));
    return c;
  }
}
