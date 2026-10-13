import { type Vec3, add, sub } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene } from '../../model/scene.types';
import { worldBox } from '../../world/bounds';
import { type BodyId, Motion, type Physics, type Pose } from './physics';
import { type Quat, mulQ, rotateQ } from './quat';
import { type SceneBodies, turnBetween } from './scene-bodies';

/**
 * READ ME — an edit that leaves objects where they stand (a new size, a new shape)
 * still builds their bodies again (PlaySim.sync), from the scene. The new body
 * takes the old one's place in play: where play has it (the old body's move since
 * it was built, applied to the new one), its speed, frozen or not, and, when it
 * moves, its lowest point, so a prop that grows on the floor grows up from it
 * instead of into it. A fixed body stays where the scene puts it.
 */

/** What a body leaves to the body built in its place. */
export interface Carried {
  /** The old body's turn and shift since it was built. */
  readonly move: Quat;
  readonly shift: Vec3;
  readonly linear: Vec3;
  readonly angular: Vec3;
  /** It moved by itself: a prop (picked up, if the scene has it fixed). */
  readonly moving: boolean;
  /** Frozen by the player: a prop held still until unfrozen. */
  readonly frozen: boolean;
  /** Its lowest point in the world. */
  readonly low: number;
}

/** The lowest point of a body's objects of `scene`, at a pose. */
function lowest(bodies: SceneBodies, body: BodyId, pose: Pose, scene: Scene): number {
  const objects = new Map(scene.objects.map((o) => [o.id, o]));
  let low = Infinity;
  for (const [id, transform] of bodies.transforms(new Map([[body, pose]]))) {
    const o = objects.get(id);
    if (o) low = Math.min(low, worldBox({ ...o, transform }).min[1]);
  }
  return low;
}

/** Before the bodies are built again: what each moving or fixed body of these objects leaves, by its first object here. */
export function takeUp(physics: Physics, bodies: SceneBodies, before: Scene, ids: Iterable<ObjectId>): Map<ObjectId, Carried> {
  const out = new Map<ObjectId, Carried>();
  const seen = new Set<BodyId>();
  for (const id of ids) {
    const item = bodies.itemOf(id);
    if (!item || item.motion === Motion.Kinematic || seen.has(item.body)) continue;
    seen.add(item.body);
    const pose = physics.pose(item.body);
    const move = turnBetween(item.start.rotation, pose.rotation);
    const { linear, angular } = physics.velocity(item.body);
    out.set(id, {
      move, shift: sub(pose.position, rotateQ(move, item.start.position)), linear, angular, moving: item.motion === Motion.Dynamic,
      frozen: item.motion === Motion.Dynamic && physics.motion(item.body) === Motion.Fixed,
      low: lowest(bodies, item.body, pose, before),
    });
  }
  return out;
}

/** After: each new body of those objects takes up what its old one left; a prop the scene has fixed stays a prop. */
export function putDown(physics: Physics, bodies: SceneBodies, after: Scene, carried: ReadonlyMap<ObjectId, Carried>): void {
  const objects = new Map(after.objects.map((o) => [o.id, o]));
  const done = new Set<BodyId>();
  for (const [id, c] of carried) {
    const item = bodies.itemOf(id);
    if (!item || !c.moving || item.motion === Motion.Kinematic || done.has(item.body)) continue;
    done.add(item.body);
    if (item.motion === Motion.Fixed) bodies.release(item.body, (o) => objects.get(o));
    const at: Pose = { position: add(rotateQ(c.move, item.start.position), c.shift), rotation: mulQ(c.move, item.start.rotation) };
    const sink = c.low - lowest(bodies, item.body, at, after);
    physics.teleport(item.body, Number.isFinite(sink) && sink > 0 ? { ...at, position: add(at.position, [0, sink, 0]) } : at);
    physics.setVelocity(item.body, c.linear, c.angular);
    if (c.frozen) physics.setFrozen(item.body, true);
  }
}
