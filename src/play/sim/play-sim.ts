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
import { DEFAULT_PLANE, PlayActor, type PlaneSettings } from '../../world/plane-settings';
import type { PlayerSettings } from '../../world/player-settings';
import type { Actor, ActorContext, ActorInput, Behaviour } from './actor';
import { PlayScripts } from './behaviours';
import { SIM_DT } from './clock';
import type { PlayEvents } from './events';
import { FpsActor } from './fps-actor';
import { tuningOf } from './movement';
import { PlaneActor } from './plane-actor';
import { flightTuning } from './plane-flight';
import { type PlaneInScene, planeInScene } from './plane-model';
import { planeStart } from './plane-spawn';
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
  /** Who the keys drive at the start (absent: the walker), and how the plane flies. */
  readonly actor?: PlayActor;
  readonly plane?: PlaneSettings;
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
  /** The walker (while the plane flies, the one that walked last). */
  player: FpsActor;
  /** The plane, while it is the driver. */
  plane: PlaneActor | null = null;
  /** Scene time after the last step. */
  time: number;
  private prevTime: number;
  private readonly actors: Actor[] = [];
  private readonly behaviours: Behaviour[] = [];
  /** The scene's clips, behaviours and trigger zones, or null when it has none. */
  readonly scripts: PlayScripts | null;
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
  /** The plane a take recorded before: not solid, and hidden while the plane flies (it is the same plane). */
  private readonly recorded: PlaneInScene | null;
  private playerNow: PlayerSettings;
  private planeNow: PlaneSettings;

  static async create(start: PlayStart): Promise<PlaySim> {
    return new PlaySim(await loadRapier().then((R) => new Physics(R, tuningOf(start.player).gravity, SIM_DT)), start);
  }

  private constructor(physics: Physics, private readonly start: PlayStart) {
    this.physics = physics;
    const scene = start.scene;
    this.time = start.time;
    this.prevTime = start.time;
    this.animated = isAnimated(scene.animation);
    this.recorded = planeInScene(scene);
    this.playerNow = start.player;
    this.planeNow = start.plane ?? DEFAULT_PLANE;
    this.bodies = new SceneBodies(physics, scene, start.player.height, this.recorded?.members);
    this.player = new FpsActor(physics, scene.camera, start.player, floorOf(scene) - FALL_LIMIT * start.player.height);
    this.actors.push(this.player);
    const groupFrames = sceneFrames(scene);
    this.frames = (g) => groupFrames(g) ?? IDENTITY;
    // Clips, behaviours and trigger zones (behaviours.ts): what they move starts where they put it.
    this.scripts = PlayScripts.of(scene, start.time, {
      physics, bodies: this.bodies, events: this.events,
      walker: () => (this.driver === this.player ? this.player : null), eye: () => this.driver.eye().position,
    });
    if (this.scripts) this.bodies.place(this.scripts.posed);
    physics.refresh();
    if (start.actor === PlayActor.Plane) this.fly(true);
    this.snapshot();
    this.prev = this.curr;
    this.prevEye = this.currEye = this.driver.eye().position;
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

  /** A player of another size or movement, standing where this one stands and looking the same way (a flying plane takes the new size). */
  setPlayer(settings: PlayerSettings): void {
    this.playerNow = settings;
    if (this.plane) {
      this.physics.setGravity(tuningOf(settings).gravity);
      this.fly(false, this.plane);
      return;
    }
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

  /** Who the keys drive from now on: the plane starts ahead of the walker's eye, the walker where the plane is. */
  setActor(actor: PlayActor): void {
    if ((actor === PlayActor.Plane) === (this.plane !== null)) return;
    if (actor === PlayActor.Plane) {
      this.fly(false);
      return;
    }
    const plane = this.plane;
    if (!plane) return;
    const at = plane.flight.position;
    const eye = { position: at, yaw: plane.eye().yaw, pitch: 0, bank: 0 };
    plane.dispose();
    this.plane = null;
    this.player = new FpsActor(this.physics, this.start.scene.camera, this.playerNow, floorOf(this.start.scene) - FALL_LIMIT * this.playerNow.height, eye);
    this.actors[0] = this.player;
    this.moved();
  }

  /** The plane flies on with new settings (speed, turn rate, pitch direction). */
  setPlane(settings: PlaneSettings): void {
    this.planeNow = settings;
    this.plane?.configure(settings, this.playerNow);
  }

  /**
   * The plane takes the keys: at the start, from the plane a take recorded (at the playhead) or ahead
   * of the camera; later, ahead of the walker; `from`, a plane of another size in the same place.
   */
  private fly(first: boolean, from?: PlaneActor): void {
    const killY = floorOf(this.start.scene) - FALL_LIMIT * this.playerNow.height;
    const eye = this.driver.eye();
    const tuning = flightTuning(this.playerNow.height, this.planeNow);
    const start = from?.spawn ?? planeStart(this.physics, this.start.scene, this.time, eye, tuning, first ? this.recorded : null);
    const old = this.driver;
    old.dispose(this.context);
    this.plane = new PlaneActor(this.physics, this.planeNow, this.playerNow, start, killY, from?.state());
    this.actors[0] = this.plane;
    this.moved();
  }

  /** The driver changed: nothing is interpolated from the old one, and the picture is drawn again. */
  private moved(): void {
    this.prevEye = this.currEye = this.driver.eye().position;
    this.version++;
  }

  /** The actor the input drives and the camera follows. */
  get driver(): Actor {
    return this.actors[0];
  }

  /** One fixed step of the whole world. */
  step(input: ActorInput): void {
    const ctx = this.context;
    for (const b of this.behaviours) b.step?.(ctx);
    this.scripts?.step(ctx);
    this.actors.forEach((a, i) => a.step(i === 0 ? input : IDLE, ctx));
    if (this.scripts) this.bodies.drive(this.scripts.posed);
    else if (this.animated) this.bodies.drive(poseAt(this.start.scene, this.time + SIM_DT));
    const { contacts, broken } = this.physics.step();
    for (const c of contacts) this.events.emit('contact', { ...c, tagA: this.physics.tag(c.a), tagB: this.physics.tag(c.b) });
    for (const joint of broken) this.events.emit('jointBroken', { joint });
    for (const a of this.actors) a.afterPhysics?.(ctx);
    this.scripts?.afterPhysics();
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
    const camera: Camera = { ...this.cameraAt(alpha, this.start.scene.camera), aperture: 0 };
    const scene = this.sceneAt(alpha);
    // What the driver shows of itself (the plane) joins the picture every frame.
    const figure = this.driver.figure?.(alpha);
    return { scene: figure?.length ? { ...scene, objects: [...scene.objects, ...figure] } : scene, camera };
  }

  /** The scene with the bodies `alpha` of the way through the step; the last one again while nothing moved. */
  private sceneAt(alpha: number): Scene {
    if (!this.animated && !this.scripts && this.cached?.version === this.version) return this.cached.scene;
    const time = this.prevTime + (this.time - this.prevTime) * alpha;
    const keyed = this.animated ? poseAt(this.start.scene, time) : this.start.scene;
    const posed = this.scripts ? this.scripts.dress(keyed, alpha) : keyed;
    const moved = this.bodies.transforms(this.posesAt(alpha, Motion.Dynamic));
    const hidden = this.plane ? this.recorded?.members : undefined;
    const shown = hidden ? posed.objects.filter((o) => !hidden.has(o.id)) : posed.objects;
    const scene = moved.size || shown !== posed.objects ? { ...posed, objects: shown.map((o) => { const t = moved.get(o.id); return t ? { ...o, transform: t } : o; }) } : posed;
    this.cached = { version: this.version, scene };
    return scene;
  }

  /** The driver's eye as a camera `alpha` of the way through the step (the walker's angles are the mouse's, now). */
  private cameraAt(alpha: number, base: Camera): Camera {
    const view = this.driver.view?.(alpha);
    const eye = view ?? this.driver.eye();
    const position = view ? view.position : lerp3(this.prevEye, this.currEye, alpha);
    return { ...base, position, yaw: eye.yaw, pitch: eye.pitch, bank: eye.bank, ...(eye.fov !== undefined ? { fov: eye.fov } : {}) };
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
    this.scripts?.dispose();
    for (const a of this.actors) a.dispose(ctx);
    this.physics.dispose();
  }

  /** Scene time jumps to `t`; keyed objects jump with it, and nothing is interpolated across the jump. */
  private rewind(t: number): void {
    this.time = t;
    this.prevTime = t;
    if (this.scripts) this.bodies.place(this.scripts.rewind(t));
    else if (this.animated) this.bodies.place(poseAt(this.start.scene, t));
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
      const camera = this.cameraAt(alpha, base);
      const poses = this.posesAt(alpha, Motion.Dynamic);
      const objects = new Map<ObjectId, Transform>();
      const groups = new Map<GroupId, Transform>();
      for (const [body, pose] of poses) {
        const item = this.bodies.items.get(body);
        if (!item) continue;
        if (item.group) groups.set(item.group, this.groupFrame(item.group, item.start, pose));
        else for (const [id, t] of this.bodies.transforms(new Map([[body, pose]]))) objects.set(id, t);
      }
      r.add({ time, camera, objects, groups, ...(this.plane ? { plane: this.plane.record(alpha) } : {}) });
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
