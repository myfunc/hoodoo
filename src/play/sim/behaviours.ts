import type { Bus } from '../../core/bus';
import { Logger } from '../../core/log';
import { type Vec3, ZERO3, add, lerp3, scale } from '../../core/vec3';
import type { PlayScript } from '../../model/play.types';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { isAnimated, poseAt, transformAt } from '../../world/animation/pose';
import { type Box, unionBox, worldBox } from '../../world/bounds';
import { localOf, placed, sceneFrames } from '../../world/group-pose';
import { IDENTITY } from '../../world/group-transform';
import { groupIndex, subtree, withGroups } from '../../world/group-tree';
import { hasScripts, movedByScript, shownByRules } from '../../world/play/scripts';
import type { ActorContext } from './actor';
import { ClipPlayer } from './behaviours-clip';
import { reactorOf } from './behaviours-events';
import { type MotionContext, type MotionRunner, motionOf, pointInFrame } from './behaviours-motion';
import type { Reactor, ScriptWorld } from './behaviours-world';
import type { PlayEvents } from './events';
import type { FpsActor } from './fps-actor';
import { ALL_LAYERS, type BodyId, Layer, Motion, type Physics } from './physics';
import { eulerOfQuat, quatOfEuler, slerpQ } from './quat';
import type { SceneBodies } from './scene-bodies';
import { TriggerZones } from './triggers';

const logger = Logger.create('Play scripts');

/** Events handled in one step at most: a loop of events (a counter that counts what it sends) stops here. */
const MAX_SIGNALS = 64;

/** What the play session gives the scripts. */
export interface ScriptHost {
  readonly physics: Physics;
  readonly bodies: SceneBodies;
  readonly events: Bus<PlayEvents>;
  /** The walker while it is the one driven, or null. */
  walker(): FpsActor | null;
  /** The eye of whoever is driven. */
  eye(): Vec3;
}

/** An object or a group that a clip or a motion moves. */
interface Mover {
  readonly id: string;
  readonly group: boolean;
  /** The group around it: world points come into its frame. */
  readonly parent: GroupId | null;
  readonly keys: readonly Key<Transform>[];
  readonly clip: ClipPlayer | null;
  readonly motions: readonly MotionRunner[];
}

function lerpTransform(a: Transform, b: Transform, alpha: number): Transform {
  if (a === b) return b;
  const rotation = eulerOfQuat(slerpQ(quatOfEuler(a.rotation), quatOfEuler(b.rotation), alpha), b.rotation);
  return { position: lerp3(a.position, b.position, alpha), rotation, size: lerp3(a.size, b.size, alpha) };
}

/**
 * READ ME — Play's scripts at work (docs/play-mode.md): clips, behaviours and
 * trigger zones of the scene, run on the session's fixed steps. `step` (before
 * the actors) moves every clip and motion on and poses the scene: objects and
 * groups with a clip take their keys at the clip's time, motions lay over that,
 * everything else follows the playhead; the session drives kinematic bodies
 * from `posed`. `afterPhysics` runs the zones and the buttons, then hands out
 * the events sent meanwhile. `dress` gives the picture between two steps:
 * moved objects interpolated, shown and hidden ones as the rules left them.
 * Nothing here touches the editor's scene.
 */
export class PlayScripts implements ScriptWorld {
  readonly physics: Physics;
  posed: Scene;
  readonly zones: TriggerZones;
  private readonly movers: Mover[] = [];
  private readonly moved: ReadonlySet<ObjectId>;
  private readonly reactors: Reactor[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();
  private readonly queue: string[] = [];
  /** Visibility set by rules, by object; absent: as in the scene. */
  private readonly shown = new Map<ObjectId, boolean>();
  /** Bodies a rule made not solid. */
  private readonly ghosts = new Set<BodyId>();
  /** The posed scene's objects by id. */
  private readonly byId = new Map<string, SceneObject>();
  private prev = new Map<ObjectId, Transform>();
  private curr = new Map<ObjectId, Transform>();
  private readonly animated: boolean;
  private readonly off: () => void;
  private warned = false;

  /** The scripts of a scene, or null when it has none. */
  static of(scene: Scene, time: number, host: ScriptHost): PlayScripts | null {
    return hasScripts(scene) ? new PlayScripts(scene, time, host) : null;
  }

  private constructor(private readonly scene: Scene, time: number, private readonly host: ScriptHost) {
    this.physics = host.physics;
    this.animated = isAnimated(scene.animation);
    const a = scene.animation;
    for (const g of groupIndex(scene).values()) if (g.script) this.add(g.id, true, g.parentId, g.script, a.groups?.[g.id] ?? []);
    for (const o of scene.objects) if (o.script) this.add(o.id, false, o.groupId, o.script, a.objects[o.id] ?? []);
    const moves = movedByScript(scene);
    this.moved = new Set(scene.objects.filter(moves).map((o) => o.id));
    this.zones = new TriggerZones(scene);
    this.off = host.events.on('signal', ({ name }) => this.queue.push(name));
    this.posed = scene;
    this.index();
    this.posed = this.repose(time);
    this.index();
    this.curr = this.transforms();
    this.prev = this.curr;
    // Hidden objects that a rule shows have bodies from the start, without collisions until then.
    for (const id of shownByRules(scene)) this.refresh(id);
    for (const r of this.reactors) r.start?.(this);
  }

  get moverCount(): number {
    return this.movers.length;
  }

  /** One fixed step's motion: clips and motions move on, and the scene is posed at the step's end. */
  step(ctx: ActorContext): void {
    const m = this.motionContext(null, ctx.dt);
    for (const mover of this.movers) {
      mover.clip?.step(ctx.dt);
      for (const motion of mover.motions) motion.advance(m);
    }
    this.posed = this.repose(ctx.time + ctx.dt);
    this.index();
    this.prev = this.curr;
    this.curr = this.transforms();
    for (const r of this.reactors) r.step?.(ctx.dt, this);
  }

  /** After physics: zones and buttons look at the world, then the events sent meanwhile reach their listeners. */
  afterPhysics(): void {
    this.zones.afterPhysics(this);
    for (const r of this.reactors) r.afterPhysics?.(this);
    this.drain();
  }

  /** The scene as posed at `time` with the scripts as they are (Record moved the playhead back). */
  rewind(time: number): Scene {
    this.posed = this.repose(time);
    this.index();
    this.curr = this.transforms();
    this.prev = this.curr;
    return this.posed;
  }

  /** The picture `alpha` of the way through the last step: moved objects in between, visibility as rules set it. */
  dress(scene: Scene, alpha: number): Scene {
    if (!this.moved.size && !this.shown.size) return scene;
    let changed = false;
    const objects = scene.objects.map((o) => {
      const b = this.curr.get(o.id);
      const shown = this.shown.get(o.id);
      if (!b && (shown === undefined || shown === !o.hidden)) return o;
      changed = true;
      const moved = b ? { ...o, transform: lerpTransform(this.prev.get(o.id) ?? b, b, alpha) } : o;
      return shown === undefined ? moved : { ...moved, hidden: !shown };
    });
    return changed ? { ...scene, objects } : scene;
  }

  dispose(): void {
    this.off();
  }

  // ---------- ScriptWorld ----------

  walker(): FpsActor | null {
    return this.host.walker();
  }

  eye(): Vec3 {
    return this.host.eye();
  }

  object(id: string): SceneObject | undefined {
    return this.byId.get(id);
  }

  centre(id: string): Vec3 | null {
    const own = this.groupBody(id);
    if (own !== null) return this.physics.pose(own).position;
    const ids = this.byId.has(id) ? [id as ObjectId] : subtree(this.posed, id as GroupId);
    const points = ids.map((x) => this.objectCentre(x)).filter((p): p is Vec3 => p !== null);
    return points.length ? scale(points.reduce((s, p) => add(s, p), ZERO3), 1 / points.length) : null;
  }

  dynamicBodies(id: string): BodyId[] {
    const own = this.groupBody(id);
    if (own !== null) return [own];
    const ids = this.byId.has(id) ? [id as ObjectId] : subtree(this.posed, id as GroupId);
    const items = ids.map((x) => this.host.bodies.itemOf(x)).filter((i) => i?.motion === Motion.Dynamic);
    return [...new Set(items.map((i) => i?.body as BodyId))];
  }

  allDynamic(): BodyId[] {
    return this.host.bodies.moving().filter((i) => i.motion === Motion.Dynamic).map((i) => i.body);
  }

  clip(id: string): ClipPlayer | null {
    return this.movers.find((m) => m.id === id)?.clip ?? null;
  }

  setShown(id: string, shown: boolean): void {
    for (const o of this.membersOf(id)) {
      this.shown.set(o, shown);
      this.refresh(o);
    }
  }

  setSolid(id: string, solid: boolean): void {
    for (const o of this.membersOf(id)) {
      const body = this.host.bodies.itemOf(o)?.body;
      if (body === undefined) continue;
      if (solid) this.ghosts.delete(body);
      else this.ghosts.add(body);
      this.refresh(o);
    }
  }

  send(name: string, from: string): void {
    this.host.events.emit('signal', { name, from });
  }

  /** An object's or a group's box in the world now (a Button's touch area). */
  box(id: string): Box | null {
    const o = this.byId.get(id);
    if (o) return worldBox(o);
    return unionBox(subtree(this.posed, id as GroupId).map((x) => this.byId.get(x)).filter((x): x is SceneObject => !!x).map(worldBox));
  }

  // ---------- inside ----------

  private add(id: string, group: boolean, parent: GroupId | null, script: PlayScript, keys: readonly Key<Transform>[]): void {
    const clip = script.clip && keys.length >= 2 ? new ClipPlayer(script.clip) : null;
    if (clip?.clip.on) this.listen(clip.clip.on, () => clip.toggle());
    const motions: MotionRunner[] = [];
    for (const spec of script.behaviours ?? []) {
      const motion = motionOf(spec, keys);
      if (motion) {
        motions.push(motion);
        if (spec.on) this.listen(spec.on, () => { motion.running = !motion.running; });
        continue;
      }
      const reactor = reactorOf(spec, id, (x) => this.box(x));
      if (!reactor) continue;
      this.reactors.push(reactor);
      if (reactor.on) this.listen(reactor.on, () => reactor.signal?.(this));
    }
    if (clip || motions.length) this.movers.push({ id, group, parent, keys, clip, motions });
  }

  private index(): void {
    this.byId.clear();
    for (const o of this.posed.objects) this.byId.set(o.id, o);
  }

  private listen(name: string, f: () => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), f]);
  }

  /** Hands the waiting events to their listeners; what a listener sends is handled in the same pass. */
  private drain(): void {
    for (let n = 0; this.queue.length; n++) {
      if (n >= MAX_SIGNALS) {
        if (!this.warned) logger.warn('events keep sending each other; the rest of this step\'s are dropped', { waiting: this.queue.length });
        this.warned = true;
        this.queue.length = 0;
        return;
      }
      const name = this.queue.shift() as string;
      for (const f of this.listeners.get(name) ?? []) f();
    }
  }

  private motionContext(parent: GroupId | null, dt: number): MotionContext {
    return { dt, eye: this.host.eye(), centre: (id) => this.centre(id), toLocal: this.toLocal(parent) };
  }

  private toLocal(parent: GroupId | null): (p: Vec3) => Vec3 {
    const frame = parent ? sceneFrames(this.posed)(parent) : null;
    return (p) => pointInFrame(frame, p);
  }

  /** The scene at `time`: the playhead's keys, then clips and motions over the objects and groups they move. */
  private repose(time: number): Scene {
    const base = this.animated ? poseAt(this.scene, time) : this.scene;
    if (!this.movers.length) return base;
    const index = groupIndex(base);
    const objects = new Map(base.objects.map((o) => [o.id as string, o]));
    const locals = new Map<string, Transform>();
    for (const m of this.movers) {
      const own = m.group ? (index.get(m.id as GroupId)?.transform ?? IDENTITY) : objects.get(m.id);
      if (!own) continue;
      let local = m.clip ? transformAt(m.keys, m.clip.time) : 'id' in own ? localOf(own) : own;
      const ctx = this.motionContext(m.parent, 0);
      for (const motion of m.motions) local = motion.apply(local, ctx);
      locals.set(m.id, local);
    }
    const posedObjects = base.objects.map((o) => { const l = locals.get(o.id); return l ? { ...o, local: l } : o; });
    const nodes = [...index.values()].map((g) => { const l = locals.get(g.id); return l ? { ...g, transform: l } : g; });
    return placed(withGroups(base, posedObjects, nodes));
  }

  private transforms(): Map<ObjectId, Transform> {
    const out = new Map<ObjectId, Transform>();
    if (!this.moved.size) return out;
    for (const o of this.posed.objects) if (this.moved.has(o.id)) out.set(o.id, o.transform);
    return out;
  }

  /** The dynamic body of a physical group, or null. */
  private groupBody(id: string): BodyId | null {
    if (this.byId.has(id)) return null;
    for (const item of this.host.bodies.items.values()) if (item.group === id && item.motion === Motion.Dynamic) return item.body;
    return null;
  }

  /** Where an object is now: on its body if it is physical, else as posed. */
  private objectCentre(id: ObjectId): Vec3 | null {
    const item = this.host.bodies.itemOf(id);
    if (item?.motion === Motion.Dynamic) return this.host.bodies.transforms(new Map([[item.body, this.physics.pose(item.body)]])).get(id)?.position ?? null;
    return this.byId.get(id)?.transform.position ?? null;
  }

  private membersOf(id: string): ObjectId[] {
    return this.byId.has(id) ? [id as ObjectId] : subtree(this.posed, id as GroupId);
  }

  /** A body collides unless a rule made it not solid or every object it stands for is hidden. */
  private refresh(id: ObjectId): void {
    const item = this.host.bodies.itemOf(id);
    if (!item) return;
    const hidden = (o: ObjectId) => this.shown.get(o) === undefined ? this.byId.get(o)?.hidden === true : !this.shown.get(o);
    const solid = !this.ghosts.has(item.body) && !item.members.every((m) => hidden(m.id));
    this.physics.setLayer(item.body, item.motion === Motion.Dynamic ? Layer.Prop : Layer.World, solid ? ALL_LAYERS : 0);
  }
}
