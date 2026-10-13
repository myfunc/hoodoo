import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { GroupNode, Scene, SceneObject } from '../../model/scene.types';
import { chain, groupIndex } from '../../world/group-tree';

/**
 * READ ME — what physics has to rebuild when the scene changes under play
 * (Sandbox's spawns and edits, and their undo): the objects added, removed or
 * changed in anything but their looks, and every member of a group whose node
 * changed (grouped, ungrouped, made physical). PlaySim.sync builds their bodies
 * again; a change of material or name alone keeps the body.
 */

/** Fields physics never reads: a change to these alone keeps an object's body. */
const LOOKS: ReadonlySet<string> = new Set(['material', 'name', 'family', 'showAsBox']);

/** Objects whose bodies `after` changes, by id (removed ones included). */
export function changedForPhysics(before: Scene, after: Scene): Set<ObjectId> {
  const old = new Map(before.objects.map((o) => [o.id, o]));
  const out = new Set<ObjectId>();
  for (const o of after.objects) {
    const was = old.get(o.id);
    old.delete(o.id);
    if (was !== o && (!was || !sameForPhysics(was, o))) out.add(o.id);
  }
  for (const id of old.keys()) out.add(id);
  if (before.groups !== after.groups) for (const id of groupChanges(before, after)) out.add(id);
  return out;
}

function sameForPhysics(a: SceneObject, b: SceneObject): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (LOOKS.has(k)) continue;
    if (a[k as keyof SceneObject] !== b[k as keyof SceneObject]) return false;
  }
  return true;
}

/** Members (in either scene) of the groups whose nodes differ between the two. */
function groupChanges(before: Scene, after: Scene): ObjectId[] {
  const nodes = (s: Scene) => new Map<GroupId, GroupNode>((s.groups ?? []).map((g) => [g.id, g]));
  const a = nodes(before);
  const b = nodes(after);
  const changed = new Set<GroupId>();
  for (const id of new Set([...a.keys(), ...b.keys()])) if (a.get(id) !== b.get(id)) changed.add(id);
  if (!changed.size) return [];
  const members = (s: Scene) => {
    const index = groupIndex(s);
    return s.objects.filter((o) => chain(index, o.groupId).some((g) => changed.has(g))).map((o) => o.id);
  };
  return [...members(before), ...members(after)];
}
