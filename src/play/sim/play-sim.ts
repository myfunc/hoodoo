import { Bus } from '../../core/bus';
import { type Vec3, add, lerp3, sub } from '../../core/vec3';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Camera, Scene, Transform } from '../../model/scene.types';
import { frameTime } from '../../world/animation/keying';
import { isAnimated, poseAt } from '../../world/animation/pose';
import { worldBox } from '../../world/bounds';
import { sceneFrames } from '../../world/group-pose';
import { IDENTITY } from '../../world/group-transform';
import { INFINITE_KINDS } from '../../world/objects.factory';
import type { PlayerSettings } from '../../world/player-settings';
import type { Actor, ActorContext, ActorInput, Behaviour } from './actor';
import { SIM_DT } from './clock';
import type { PlayEvents } from './events';
import { FpsActor } from './fps-actor';
import { tuningOf } from './movement';
import { type BodyId, Motion, Physics, type Pose, loadRapier } from './physics';
import { conjQ, eulerOfQuat, mulQ, quatOfEuler, rotateQ, slerpQ } from './quat';
import { SceneBodies } from './scene-bodies';
import { type Take, TakeRecorder, takeLimit } from './take';

/** What the scene window shows for one display frame of play. */
export interface PlayFrame {
  readonly scene: Scene;
  readonly camera: Camera;
}

export interface PlayStart {
  /** The scene as the editor has it, posed at `time`. */
  readonly scene: Scene;
  /** Scene time to start from: the playhead. */
  readonly time: number;
  readonly player: PlayerSettings;
}

/** A fall this many player heights below the lowest thing in the scene ends back at the start. */
const FALL_LIMIT = 50;
const SAME = 1e-6;
const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };

const samePose = (a: Pose, b: Pose): boolean =>
  Math.abs(a.position[0] - b.position[0]) < SAME && Math.abs(a.position[1] - b.position[1]) < SAME && Math.abs(a.position[2] - b.position[2]) < SAME
  && Math.abs(a.rotation[0] - b.rotation[0]) < SAME && Math.abs(a.rotation[1] - b.rotation[1]) < SAME && Math.abs(a.rotation[2] - b.rotation[2]) < SAME;

/** The lowest point of what can be stood on, for the respawn depth. */
function floorOf(scene: Scene): number {
  const ys = scene.objects.map((o) => (INFINITE_KINDS.has(o.kind) ? o.transform.position[1] : worldBox(o).min[1]));
  return Math.min(scene.camera.position[1], ...ys);
}

/**
 * READ ME — one play session's simulation, separate from the editor: it never
 * touches World. Fixed 100 Hz steps (`step`): behaviours, then actors on their
 * input, then keyed objects move to their next pose, then physics; the display
 * asks for `frame(alpha)` between two steps, interpolated. Recording samples the
 * camera and the physical bodies at the scene's frame rate (take.ts).
 */
export class PlaySim {
  readonly events = new Bus<PlayEvents>();
  readonly physics: Physics;
  readonly bodies: SceneBodies;
  player: FpsActor;
  /** Scene time after the last step. */
  time: number;
  private prevTime: number;
  private readonly actors: Actor[] = [];
  private readonly behaviours: Behaviour[] = [];
  private readonly animated: boolean;
  private readonly frames: (g: GroupId) => Transform;
  private prev = new Map<BodyId, Pose>();
  private curr = new Map<BodyId, Pose>();
  private prevEye: Vec3;
  private currEye: Vec3;
  /** Bumps whenever a body moved in a step: the last frame's scene is reused until it does. */
  private version = 0;
  private cached: { version: number; scene: Scene } | null = null;
  private recorder: TakeRecorder | null = null;
  readonly takes: Take[] = [];

  static async create(start: PlayStart): Promise<PlaySim> {
    return new PlaySim(await loadRapier().then((R) => new Physics(R, tuningOf(start.player).gravity, SIM_DT)), start);
  }

  private constructor(physics: Physics, private readonly start: PlayStart) {
    this.physics = physics;
    const scene = start.scene;
    this.time = start.time;
    this.prevTime = start.time;
    this.animated = isAnimated(scene.animation);
    this.bodies = new SceneBodies(physics, scene, start.player.height);
    this.player = new FpsActor(physics, scene.camera, start.player, floorOf(scene) - FALL_LIMIT * start.player.height);
    this.actors.push(this.player);
    const groupFrames = sceneFrames(scene);
    this.frames = (g) => groupFrames(g) ?? IDENTITY;
    physics.refresh();
    this.snapshot();
    this.prev = this.curr;
    this.prevEye = this.currEye = this.player.eye().position;
  }

  get context(): ActorContext {
    return { physics: this.physics, events: this.events, dt: SIM_DT, time: this.time };
  }

  /** Another actor in the world (an airplane, a bot); the first one added takes the input. */
  addActor(a: Actor): void {
    this.actors.push(a);
  }

  removeActor(a: Actor): void {
    const i = this.actors.indexOf(a);
    if (i > 0) this.actors.splice(i, 1);
    a.dispose(this.context);
  }

  addBehaviour(b: Behaviour): void {
    this.behaviours.push(b);
    b.start?.(this.context);
  }

  /** A player of another size or movement, standing where this one stands and looking the same way. */
  setPlayer(settings: PlayerSettings): void {
    const old = this.player;
    const t = old.tuning;
    const feet = old.state.origin[1] - (old.state.ducked ? t.duckHalf[1] : t.standHalf[1]);
    const eye = old.eye();
    const from = { ...eye, position: [eye.position[0], feet + settings.eyeHeight + t.skin, eye.position[2]] as Vec3 };
    old.dispose();
    this.player = new FpsActor(this.physics, this.start.scene.camera, settings, floorOf(this.start.scene) - FALL_LIMIT * settings.height, from);
    if (this.actors[0] === old) this.actors[0] = this.player;
    this.physics.setGravity(tuningOf(settings).gravity);
    this.prevEye = this.currEye = this.player.eye().position;
  }

  /** The actor the input drives and the camera follows. */
  get driver(): Actor {
    return this.actors[0];
  }

  /** One fixed step of the whole world. */
  step(input: ActorInput): void {
    const ctx = this.context;
    for (const b of this.behaviours) b.step?.(ctx);
    this.actors.forEach((a, i) => a.step(i === 0 ? input : IDLE, ctx));
    if (this.animated) this.bodies.drive(poseAt(this.start.scene, this.time + SIM_DT));
    const { contacts, broken } = this.physics.step();
    for (const c of contacts) this.events.emit('contact', { ...c, tagA: this.physics.tag(c.a), tagB: this.physics.tag(c.b) });
    for (const joint of broken) this.events.emit('jointBroken', { joint });
    for (const a of this.actors) a.afterPhysics?.(ctx);
    this.prevTime = this.time;
    this.time += SIM_DT;
    this.prev = this.curr;
    this.prevEye = this.currEye;
    this.snapshot();
    this.currEye = this.driver.eye().position;
    this.sample();
    this.events.emit('tick', { time: this.time, dt: SIM_DT });
  }

  /** The picture `alpha` of the way from the last step to the next: bodies and eye interpolated, keys posed. */
  frame(alpha: number): PlayFrame {
    const eye = this.driver.eye();
    const camera: Camera = { ...this.start.scene.camera, position: lerp3(this.prevEye, this.currEye, alpha), yaw: eye.yaw, pitch: eye.pitch, bank: eye.bank, aperture: 0 };
    if (!this.animated && this.cached?.version === this.version) return { scene: this.cached.scene, camera };
    const time = this.prevTime + (this.time - this.prevTime) * alpha;
    const posed = this.animated ? poseAt(this.start.scene, time) : this.start.scene;
    const moved = this.bodies.transforms(this.posesAt(alpha, Motion.Dynamic));
    const scene = moved.size ? { ...posed, objects: posed.objects.map((o) => { const t = moved.get(o.id); return t ? { ...o, transform: t } : o; }) } : posed;
    this.cached = { version: this.version, scene };
    return { scene, camera };
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** Scene time the take being recorded began at, or null. */
  get takeStart(): number | null {
    return this.recorder?.start ?? null;
  }

  /**
   * Record on: scene time goes back to the playhead (keyed objects with it), and
   * samples run from there at the scene's frame rate, so the take plays back
   * with the animation as it was seen. Off: the take is kept for exit; a later
   * take starts at the playhead again and replaces the keys it covers.
   */
  record(on: boolean): void {
    if (on === this.recording) return;
    const a = this.start.scene.animation;
    if (on) {
      const begin = frameTime(this.start.time, a.fps);
      this.rewind(begin);
      this.recorder = new TakeRecorder(begin, a.fps, takeLimit(a, begin));
    } else {
      if (this.recorder && this.recorder.samples.length > 1) this.takes.push(this.recorder.take());
      this.recorder = null;
    }
    this.events.emit('record', { on, time: this.time });
  }

  dispose(): void {
    const ctx = this.context;
    for (const b of this.behaviours) b.dispose?.(ctx);
    for (const a of this.actors) a.dispose(ctx);
    this.physics.dispose();
  }

  /** Scene time jumps to `t`; keyed objects jump with it, and nothing is interpolated across the jump. */
  private rewind(t: number): void {
    this.time = t;
    this.prevTime = t;
    if (this.animated) this.bodies.place(poseAt(this.start.scene, t));
    this.snapshot();
    this.prev = this.curr;
    this.prevEye = this.currEye;
  }

  /** Poses of moving bodies, `alpha` of the way through the last step. */
  private posesAt(alpha: number, motion?: Motion): Map<BodyId, Pose> {
    const out = new Map<BodyId, Pose>();
    for (const [id, now] of this.curr) {
      if (motion && this.bodies.items.get(id)?.motion !== motion) continue;
      const before = this.prev.get(id) ?? now;
      out.set(id, { position: lerp3(before.position, now.position, alpha), rotation: slerpQ(before.rotation, now.rotation, alpha) });
    }
    return out;
  }

  private snapshot(): void {
    const next = new Map<BodyId, Pose>();
    let moved = false;
    for (const item of this.bodies.moving()) {
      const pose = this.physics.pose(item.body);
      const before = this.curr.get(item.body);
      if (!before || !samePose(before, pose)) moved = true;
      next.set(item.body, pose);
    }
    this.curr = next;
    if (moved) this.version++;
  }

  /** Writes the samples due during the last step into the take. */
  private sample(): void {
    const r = this.recorder;
    if (!r) return;
    const base = this.start.scene.camera;
    for (const time of r.due(this.time)) {
      const alpha = Math.min(1, Math.max(0, (time - this.prevTime) / SIM_DT));
      const eye = this.driver.eye();
      const camera: Camera = { ...base, position: lerp3(this.prevEye, this.currEye, alpha), yaw: eye.yaw, pitch: eye.pitch, bank: eye.bank };
      const poses = this.posesAt(alpha, Motion.Dynamic);
      const objects = new Map<ObjectId, Transform>();
      const groups = new Map<GroupId, Transform>();
      for (const [body, pose] of poses) {
        const item = this.bodies.items.get(body);
        if (!item) continue;
        if (item.group) groups.set(item.group, this.groupFrame(item.group, item.start, pose));
        else for (const [id, t] of this.bodies.transforms(new Map([[body, pose]]))) objects.set(id, t);
      }
      r.add({ time, camera, objects, groups });
    }
    if (r.full) this.record(false);
  }

  /** A physical group's world frame: its frame at the start, carried by the body's motion since. */
  private groupFrame(g: GroupId, start: Pose, now: Pose): Transform {
    const f = this.frames(g);
    const turn = mulQ(now.rotation, conjQ(start.rotation));
    return {
      position: add(now.position, rotateQ(turn, sub(f.position, start.position))),
      rotation: eulerOfQuat(mulQ(turn, quatOfEuler(f.rotation)), f.rotation),
      size: f.size,
    };
  }
}
