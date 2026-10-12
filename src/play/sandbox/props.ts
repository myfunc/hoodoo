import { ZERO3 } from '../../core/vec3';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene, SceneObject } from '../../model/scene.types';
import { canBePhysical, massOf } from '../../world/body-flags';
import { type BodyId, Motion } from '../sim/physics';
import type { PlaySim } from '../sim/play-sim';

/**
 * READ ME — Sandbox's view of the scene's bodies as props. The Physics Gun takes
 * anything finite and unlocked that keys do not move: Physical props, and the
 * scene's other objects, which are frozen props until picked up (a fixed body
 * becomes dynamic with its object's mass). Terrains, planes and locked objects
 * are the map. Freezing turns a prop fixed where it is; the player's frozen
 * props are remembered so a double R lets them all go.
 */
export class Props {
  private readonly objects: ReadonlyMap<ObjectId, SceneObject>;
  /** Bodies the player froze. */
  private readonly frozen = new Set<BodyId>();

  constructor(private readonly sim: PlaySim, scene: Scene) {
    this.objects = new Map(scene.objects.map((o) => [o.id, o]));
  }

  /** Whether the Physics Gun may take this body. */
  grabbable(body: BodyId): boolean {
    const item = this.sim.bodies.items.get(body);
    if (!item || item.motion === Motion.Kinematic) return false;
    return item.members.every((m) => {
      const o = this.objects.get(m.id);
      return !!o && canBePhysical(o.kind) && !o.locked;
    });
  }

  /** A prop that stays put: frozen by the player, or a scene object never picked up. */
  isFrozen(body: BodyId): boolean {
    return this.grabbable(body) && this.sim.physics.motion(body) === Motion.Fixed;
  }

  /** The name the notices use: the object's, or the group's first member's. */
  name(body: BodyId): string {
    const item = this.sim.bodies.items.get(body);
    return (item && this.objects.get(item.members[0].id)?.name) ?? 'Prop';
  }

  /** Moving freely: a fixed scene object becomes a prop with its own mass, a frozen prop thaws. */
  unfreeze(body: BodyId): void {
    const { physics, bodies } = this.sim;
    const item = bodies.items.get(body);
    if (!item) return;
    physics.setFrozen(body, false);
    if (item.motion === Motion.Fixed) {
      const mass = item.members.reduce((s, m) => s + massOf(this.objects.get(m.id) as SceneObject), 0);
      const rb = physics.world.getRigidBody(body);
      const n = rb?.numColliders() ?? 0;
      for (let i = 0; i < n; i++) rb?.collider(i).setMass(mass / n);
      physics.setCcd(body, true);
      bodies.setMotion(body, Motion.Dynamic);
    }
    this.frozen.delete(body);
  }

  /** Stops it where it is, a fixed body until unfrozen. */
  freeze(body: BodyId): void {
    this.sim.physics.setVelocity(body, ZERO3, ZERO3);
    this.sim.physics.setFrozen(body, true);
    this.frozen.add(body);
  }

  /** Lets every prop the player froze go; how many there were. */
  unfreezeAll(): number {
    const all = [...this.frozen];
    for (const b of all) this.unfreeze(b);
    return all.length;
  }

  /** Gravity off while the Physics Gun holds a body, so it hangs where it is aimed. */
  setFloating(body: BodyId, on: boolean): void {
    this.sim.physics.world.getRigidBody(body)?.setGravityScale(on ? 0 : 1, true);
  }
}
