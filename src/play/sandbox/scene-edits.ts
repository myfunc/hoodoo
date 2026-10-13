import { type Vec3, add, scale } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { Transform } from '../../model/scene.types';
import { sameTransform } from '../../world/group-transform';
import type { World } from '../../world/world';
import { Layer } from '../sim/physics';
import type { PlaySim } from '../sim/play-sim';
import { SPAWN_LIMIT, type SpawnSpot, placed, tracedCount } from './spawn';
import type { SpawnItem } from './spawn-lists';
import { aimOf } from './weapons/grip';

/**
 * READ ME — Sandbox's edits of the editor's scene (docs/sandbox-mode.md, Building
 * scenes): each is one History step, so what is built in Garry's Mod mode stays
 * after play and the editor's History lists it; PlaySim.sync gives the new and
 * changed objects their bodies. Z takes back only the steps of this session.
 */

/** How far a spawn's aim looks for a surface, and where one lands with none, in player units (HL units). */
const SPAWN_REACH = { surface: 4096, miss: 160 } as const;
const UP: Vec3 = [0, 1, 0];

export class SceneEdits {
  /** History's position when play began: Z stops there. */
  private readonly first: number;
  /** Objects spawned or picked up this session: where physics leaves them is kept when play ends. */
  private readonly touched = new Set<ObjectId>();

  constructor(private readonly world: World, private readonly sim: PlaySim) {
    this.first = world.historyState().position;
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
    this.world.addObjects(objects, `Spawn ${item.name}`, built.groups);
    for (const o of objects) this.touched.add(o.id);
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

  /** Takes back this session's newest step: its label, or null when none is left. */
  undo(): string | null {
    const { labels, position } = this.world.historyState();
    if (position <= this.first || !this.world.canUndo()) return null;
    this.world.undo();
    return labels[position];
  }
}
