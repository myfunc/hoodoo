import type { Vec3 } from '../../core/vec3';
import { type GroupId, type ObjectId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { localOf } from '../../world/group-pose';
import { PLANE_GROUP, PROPELLER, type PlanePose, planeInScene, planeObjects, propellerAt } from './plane-model';
import { eulerOfQuat } from './quat';

/**
 * READ ME — the plane in a take (take.ts calls this). The scene's "Plane" group
 * is the plane: its keys are the plane's pose (position, turn, and its size as
 * the group's scale), and the propeller's keys turn it about the nose. The first
 * take makes the group and its parts (plane-model.ts), at size 1 under the
 * group's scale; later takes key the same group.
 */

/** Where the plane's keys go. `objects` and `groups` are new to the scene (the first take). */
export interface PlaneTarget {
  readonly group: GroupId;
  readonly propeller: ObjectId;
  /** The propeller's pose inside the group, which its keys turn. */
  readonly propellerLocal: Transform;
  readonly objects: readonly SceneObject[];
  readonly groups: readonly GroupNode[];
}

const ZERO: Vec3 = [0, 0, 0];

const frameOf = (p: PlanePose, hint: Vec3): Transform => ({ position: p.position, rotation: eulerOfQuat(p.rotation, hint), size: [p.size, p.size, p.size] });

/** The scene's recorded plane, or a new one posed at `first`. */
export function planeTarget(scene: Scene, first: PlanePose): PlaneTarget {
  const found = planeInScene(scene);
  const propeller = found ? scene.objects.find((o) => o.id === found.propeller) : undefined;
  if (found && propeller) return { group: found.group, propeller: found.propeller, propellerLocal: localOf(propeller), objects: [], groups: [] };
  const group = newGroupId();
  const parts = planeObjects(1, group);
  const prop = parts.find((o) => o.name === PROPELLER) ?? parts[0];
  const node: GroupNode = { id: group, name: PLANE_GROUP, parentId: null, collapsed: true, transform: frameOf(first, ZERO) };
  return { group, propeller: prop.id, propellerLocal: prop.transform, objects: parts, groups: [node] };
}

/** The keys of the samples that saw the plane: the group's frames (Euler angles kept continuous) and the propeller's turn. */
export function planeKeys(target: PlaneTarget, samples: readonly { readonly time: number; readonly plane?: PlanePose }[]): { group: Key<Transform>[]; propeller: Key<Transform>[] } {
  const group: Key<Transform>[] = [];
  const propeller: Key<Transform>[] = [];
  let hint = ZERO;
  for (const s of samples) {
    if (!s.plane) continue;
    const value = frameOf(s.plane, hint);
    hint = value.rotation;
    group.push({ time: s.time, value });
    propeller.push({ time: s.time, value: propellerAt(target.propellerLocal, s.plane.spin) });
  }
  return { group, propeller };
}
