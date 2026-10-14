import type { Vec3 } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import { bodyOf } from '../../world/body-flags';
import { carvedOf } from '../../world/carved';
import { subtree } from '../../world/group-tree';
import { contraption } from '../../world/joints';
import { raycast } from '../../world/raycast';
import type { World } from '../../world/world';
import { Motion } from '../sim/physics';
import type { PlaySim } from '../sim/play-sim';
import type { SandboxJoints } from './joints';
import type { SceneEdits } from './scene-edits';
import { decalsOn, normalAt } from './tool-aim';
import type { ToolContext, ToolHit } from './tools/tool';

/**
 * READ ME — what the Tool Gun's tools see: the aim traced through the picture's
 * objects as play has them now (without a range limit, through water and clouds
 * as Garry's Mod's shots go), and their access to the scene: the edits, what
 * moves, what is joined or one carved object, joints' anchors, decals.
 */

/** Planes the Tool Gun's aim passes through when they are not solid. */
const SEE_THROUGH: ReadonlySet<ShapeKind> = new Set([ShapeKind.WaterPlane, ShapeKind.CloudPlane]);

export class ToolHost {
  constructor(
    private readonly world: World,
    private readonly sim: PlaySim,
    private readonly edits: SceneEdits,
    private readonly joints: SandboxJoints,
  ) {}

  /** The object the aim meets, where and with the surface's normal there, or null. */
  trace(eye: Vec3, aim: Vec3): ToolHit | null {
    const scene = this.sim.frame(1).scene;
    const skip = new Set(scene.objects.filter((o) => SEE_THROUGH.has(o.kind) && !bodyOf(o).solid).map((o) => o.id));
    const opts = { includePlanes: true, includeLights: false, skip };
    const hit = raycast(scene, eye, aim, opts);
    const object = hit ? this.world.object(hit.id) : undefined;
    if (!hit || !object) return null;
    return { object, point: hit.point, ...normalAt(scene, eye, aim, hit, opts) };
  }

  context(): ToolContext {
    const { bodies } = this.sim;
    const world = this.world;
    return {
      edits: this.edits,
      moving: (id) => (bodies.itemOf(id)?.motion ?? Motion.Fixed) !== Motion.Fixed,
      joined: (id) => bodies.sharing(contraption(world.scene, bodies.sharing([id]))),
      anchor: (id, point) => this.joints.anchorOf(id, point),
      pose: (id) => this.sim.frame(1).scene.objects.find((o) => o.id === id)?.transform ?? null,
      decalsOn: (id) => decalsOn(world.scene, id),
      carved: (id) => {
        const o = world.object(id);
        return !!o && carvedOf(world.scene, o) !== null;
      },
      whole: (id) => {
        const o = world.object(id);
        const g = o ? carvedOf(world.scene, o) : null;
        return new Set(g ? subtree(world.scene, g) : [id]);
      },
    };
  }
}
