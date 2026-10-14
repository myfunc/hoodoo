import { type Vec3, add, scale } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { JointKind } from '../../model/scene.enums';
import type { GroupNode, Scene, SceneJoint, SceneObject, Sky, Transform } from '../../model/scene.types';
import { bodyOf, withBody } from '../../world/body-flags';
import { BodyGroups, carvedOf } from '../../world/carved';
import { subtree } from '../../world/group-tree';
import { jointsOf } from '../../world/joints';
import { sameTransform } from '../../world/group-transform';
import type { World } from '../../world/world';
import { Layer } from '../sim/physics';
import type { PlaySim } from '../sim/play-sim';
import { SPAWN_LIMIT, type SpawnSpot, placed, tracedCount } from './spawn';
import type { SpawnItem } from './spawn-lists';
import { aimOf } from './weapons/grip';

/**
 * READ ME — Sandbox's edits of the editor's scene (docs/sandbox-mode.md, Building
 * scenes): spawns and the Tool Gun's changes, each one History step, so what is
 * built in Garry's Mod mode stays after play and the editor's History lists it;
 * PlaySim.sync gives the new and changed objects their bodies. Z takes back only
 * the steps of this session. It remembers each object as play began with it or as
 * it was spawned, which is what the tools' R gives back.
 */

/** How far a spawn's aim looks for a surface, and where one lands with none, in player units (HL units). */
const SPAWN_REACH = { surface: 4096, miss: 160 } as const;
const UP: Vec3 = [0, 1, 0];
/** The oldest entry of the session's History list. */
const PLAY_BEGAN = 'Play began';

export class SceneEdits {
  /** Told just before objects go (the Remover's dissolve shows them where play has them). */
  removing: ((ids: ReadonlySet<ObjectId>) => void) | null = null;
  /** History's position when play began: Z stops there. */
  private readonly first: number;
  /** Objects spawned or picked up this session: where physics leaves them is kept when play ends. */
  private readonly touched = new Set<ObjectId>();
  private readonly originals: Map<ObjectId, SceneObject>;

  constructor(private readonly world: World, private readonly sim: PlaySim) {
    this.first = world.historyState().position;
    this.originals = new Map(world.scene.objects.map((o) => [o.id, o]));
  }

  /** The object as play began with it, or as it was spawned. */
  original(id: ObjectId): SceneObject | null {
    return this.originals.get(id) ?? null;
  }

  /** The Tool Gun changes objects: one History step; they stay where play has them. */
  change(ids: ReadonlySet<ObjectId>, label: string, fn: (o: SceneObject) => SceneObject): void {
    this.world.updateObjects(ids, label, fn);
    this.touch(ids);
  }

  /** The editor's scene as it is now. */
  get scene(): Scene {
    return this.world.scene;
  }

  /** Whether the object moves in play: physical itself, or a carved object made physical as a whole. */
  physical(id: ObjectId): boolean {
    const o = this.world.object(id);
    if (!o) return false;
    const g = carvedOf(this.world.scene, o);
    return g ? new BodyGroups(this.world.scene).physical(g) : bodyOf(o).physical;
  }

  /** Physical on or off, one History step; a carved object's part switches the whole object (its group and its parts' own flags). */
  setPhysical(id: ObjectId, on: boolean): void {
    const o = this.world.object(id);
    if (!o) return;
    const g = carvedOf(this.world.scene, o);
    if (!g) {
      this.change(new Set([id]), `${on ? 'Physical' : 'Static'} ${o.name}`, (x) => withBody(x, { physical: on }));
      return;
    }
    const members = new Set(subtree(this.world.scene, g));
    this.world.beginGesture(`${on ? 'Physical' : 'Static'} ${o.name}`);
    this.world.setGroupBody(g, { physical: on });
    if (!on) this.world.updateObjects(new Set(this.world.scene.objects.filter((x) => members.has(x.id) && bodyOf(x).physical).map((x) => x.id)), 'Physics', (x) => withBody(x, { physical: false }), true);
    this.world.endGesture();
  }

  /** Solid on or off: one History step. */
  setSolid(id: ObjectId, on: boolean): void {
    const o = this.world.object(id);
    if (o) this.change(new Set([id]), `${on ? 'Solid' : 'Not solid'} ${o.name}`, (x) => withBody(x, { solid: on }));
  }

  /** The sky over the world (the spawn menu's Sky tab): one History step. */
  setSky(sky: Sky, label: string): void {
    this.world.setSky(sky, label);
  }

  /** A brush stroke begins: its changes until `endStroke` are one History step. */
  beginStroke(label: string): void {
    this.world.beginGesture(label);
  }

  endStroke(): void {
    this.world.endGesture();
  }

  /** A Constraints tool's joint: one History step. */
  addJoint(joint: SceneJoint, label: string): void {
    this.world.setJoints([...(this.world.scene.joints ?? []), joint], label);
  }

  /** Takes the object's joints of these kinds away, one History step; false when it had none. */
  removeJointsOf(id: ObjectId, kinds: ReadonlySet<JointKind>, label: string): boolean {
    const gone = new Set(jointsOf(this.world.scene, id, kinds).map((j) => j.id));
    if (!gone.size) return false;
    this.world.setJoints((this.world.scene.joints ?? []).filter((j) => !gone.has(j.id)), label);
    return true;
  }

  /** Objects the Tool Gun makes (a decal): one History step; they stay after play. */
  add(objects: readonly SceneObject[], label: string): void {
    this.world.addObjects(objects, label);
    for (const o of objects) {
      this.touched.add(o.id);
      this.originals.set(o.id, o);
    }
  }

  /** A decal on a lone prop: prop and decal one new group (the decal a boolean part), one History step. */
  decorate(prop: ObjectId, group: GroupNode, decal: SceneObject): void {
    this.world.beginGesture('Decal');
    this.world.updateObjects(new Set([prop]), 'Decal', (o) => ({ ...o, groupId: group.id }));
    this.world.addObjects([decal], 'Decal', [group]);
    this.world.endGesture();
    this.touched.add(decal.id);
    this.touched.add(prop);
    this.originals.set(decal.id, decal);
  }

  /** The Remover: one History step. */
  remove(ids: ReadonlySet<ObjectId>, label: string): void {
    this.removing?.(ids);
    this.world.removeObjects(ids, label);
  }

  /** The item where the player aims; false when the props limit refuses it. */
  spawn(item: SpawnItem): boolean {
    const built = item.build();
    if (tracedCount(this.world.scene) + built.objects.length > SPAWN_LIMIT) return false;
    const eye = this.sim.driver.eye();
    const aim = aimOf(eye.yaw, eye.pitch);
    const unit = this.sim.player.tuning.unit;
    const hit = this.sim.physics.raycast(eye.position, aim, SPAWN_REACH.surface * unit, { layers: Layer.World | Layer.Prop });
    const spot: SpawnSpot = hit ? { point: hit.point, normal: hit.normal } : { point: add(eye.position, scale(aim, SPAWN_REACH.miss * unit)), normal: UP };
    const objects = placed(built.objects, eye.yaw, spot);
    const label = `Spawn ${item.name}`;
    // The player's own items bring their welds: objects and joints one History step.
    if (built.joints?.length) this.world.beginGesture(label);
    this.world.addObjects(objects, label, built.groups);
    if (built.joints?.length) {
      this.world.setJoints([...(this.world.scene.joints ?? []), ...built.joints], label);
      this.world.endGesture();
    }
    for (const o of objects) {
      this.touched.add(o.id);
      this.originals.set(o.id, o);
    }
    return true;
  }

  /** The Physics Gun holds these objects' body: they stay where play leaves them. */
  touch(ids: Iterable<ObjectId>): void {
    for (const id of ids) this.touched.add(id);
  }

  /** Play ends: the objects spawned or picked up stay where physics left them, one History step. */
  keep(): void {
    const now = new Map(this.sim.frame(1).scene.objects.map((o) => [o.id, o.transform]));
    const scene = this.world.scene;
    const moved = new Map<ObjectId, Transform>();
    for (const o of scene.objects) {
      const t = now.get(o.id);
      if (t && this.touched.has(o.id) && !sameTransform(t, o.transform)) moved.set(o.id, t);
    }
    this.world.placeObjects(moved, 'Props at rest');
  }

  /** This session's History steps, newest first. */
  get labels(): string[] {
    const { labels, position } = this.world.historyState();
    return labels.slice(this.first + 1, position + 1).reverse();
  }

  /** Puts back the step undone last: its label, or null when there is none. */
  redo(): string | null {
    const { labels, position } = this.world.historyState();
    if (!this.world.canRedo()) return null;
    this.world.redo();
    return labels[position + 1] ?? null;
  }

  /** This session's History, newest first: each step, whether it is the current one or undone; the last is where play began. */
  steps(): { readonly label: string; readonly position: number; readonly current: boolean; readonly undone: boolean }[] {
    const { labels, position } = this.world.historyState();
    const out = [];
    for (let i = labels.length - 1; i >= this.first; i--) out.push({ label: i === this.first ? PLAY_BEGAN : labels[i], position: i, current: i === position, undone: i > position });
    return out;
  }

  /** Back or forward to a step of this session (never before play began). */
  jumpTo(position: number): void {
    if (position >= this.first) this.world.jumpTo(position);
  }

  /** Takes back this session's newest step: its label, or null when none is left. */
  undo(): string | null {
    const { labels, position } = this.world.historyState();
    if (position <= this.first || !this.world.canUndo()) return null;
    this.world.undo();
    return labels[position];
  }
}
