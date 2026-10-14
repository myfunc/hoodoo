import { type Vec3, add, sub } from '../../core/vec3';
import { JointKind } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene, SceneJoint } from '../../model/scene.types';
import { type BodyId, type JointId, JointType } from '../sim/physics';
import type { PlaySim } from '../sim/play-sim';
import { conjQ, rotateQ } from '../sim/quat';

/**
 * READ ME — the scene's joints (world/joints.ts) in Play's physics: a Weld is a
 * fixed joint that keeps the two bodies as they are now, a Ball Socket turns
 * about its pivot, a No-Collide lets the pair pass through each other. They are
 * built again after every change of the scene under play (PlaySim.sync builds
 * bodies again, and a rebuilt body loses its joints), so a weld always holds the
 * bodies as play has them. Anchors live in each object's own frame: from an
 * aimed point with `anchorOf`, back to its body's frame here.
 */

const TYPES: Readonly<Partial<Record<JointKind, JointType>>> = { [JointKind.Weld]: JointType.Weld, [JointKind.BallSocket]: JointType.Ball };

export class SandboxJoints {
  private live: JointId[] = [];
  private apart: (readonly [BodyId, BodyId])[] = [];

  constructor(private readonly sim: PlaySim) {}

  /** Physics' joints for the scene's: the old ones go, the scene's are made again. */
  sync(scene: Scene): void {
    this.clear();
    for (const j of scene.joints ?? []) this.build(j);
  }

  dispose(): void {
    this.clear();
  }

  /** A point the aim met on an object, in the object's own frame; null when it has no body. */
  anchorOf(id: ObjectId, world: Vec3): Vec3 | null {
    const at = this.member(id);
    if (!at) return null;
    const pose = this.sim.physics.pose(at.body);
    const inBody = rotateQ(conjQ(pose.rotation), sub(world, pose.position));
    return rotateQ(conjQ(at.turn), sub(inBody, at.offset));
  }

  private build(j: SceneJoint): void {
    if (!j.b) return;
    const [a, b] = [this.member(j.a), this.member(j.b)];
    if (!a || !b || a.body === b.body) return;
    const physics = this.sim.physics;
    if (j.kind === JointKind.NoCollide) {
      physics.setNoCollide(a.body, b.body, true);
      this.apart.push([a.body, b.body]);
      return;
    }
    const type = TYPES[j.kind];
    if (!type) return;
    const id = physics.addJoint({
      type, a: a.body, b: b.body, anchorA: a.toBody(j.anchorA), anchorB: b.toBody(j.anchorB),
      ...(j.forceLimit ? { breakForce: j.forceLimit } : {}), collide: j.collide === true,
    });
    if (id !== null) this.live.push(id);
  }

  private clear(): void {
    for (const id of this.live) this.sim.physics.removeJoint(id);
    for (const [a, b] of this.apart) this.sim.physics.setNoCollide(a, b, false);
    this.live = [];
    this.apart = [];
  }

  /** The object's body and where it sits in it. */
  private member(id: ObjectId) {
    const item = this.sim.bodies.itemOf(id);
    const m = item?.members.find((x) => x.id === id);
    if (!item || !m) return null;
    return { body: item.body, offset: m.offset, turn: m.turn, toBody: (p: Vec3): Vec3 => add(m.offset, rotateQ(m.turn, p)) };
  }
}
