import type { GroupId, ObjectId, SmartGroupId } from '../model/scene.ids';
import type { Scene, SceneObject } from '../model/scene.types';
import { type GroupedScene, chain, groupIndex, subtree } from './group-tree';
import { smartGroupOf, smartMembers } from './smart-groups';

/**
 * Edit Group: a group (or a smart group's members) worked on apart from the rest of
 * the scene. Only its members are drawn, picked and selected; the rest shows as faint
 * wires. Inside a group a click picks a member, or the whole of a group nested in it,
 * and new objects join it. The scope is editor state, not part of the scene or its undo.
 */
export type EditScope = { readonly group: GroupId } | { readonly smart: SmartGroupId };

export const sameScope = (a: EditScope | null, b: EditScope | null): boolean =>
  a === b || (!!a && !!b && ('group' in a ? 'group' in b && a.group === b.group : 'smart' in b && a.smart === b.smart));

/** The members of the scope in this scene; empty when its group or smart group is gone. */
export function scopeMembers(scene: Scene, scope: EditScope): Set<ObjectId> {
  if ('group' in scope) return new Set(subtree(scene, scope.group));
  const smart = smartGroupOf(scene, scope.smart);
  return new Set(smart ? smartMembers(scene, smart).map((o) => o.id) : []);
}

/** The scope still has something to edit: its group is in the scene, its smart group too. */
export function scopeAlive(scene: Scene, scope: EditScope): boolean {
  return 'group' in scope ? groupIndex(scene).has(scope.group) : !!smartGroupOf(scene, scope.smart);
}

export function scopeName(scene: Scene, scope: EditScope): string {
  return 'group' in scope ? (groupIndex(scene).get(scope.group)?.name ?? '') : (smartGroupOf(scene, scope.smart)?.name ?? '');
}

/** The group's name and the names of the groups around it, outermost first. */
export function scopePath(scene: GroupedScene, scope: { readonly group: GroupId }): string[] {
  const index = groupIndex(scene);
  return chain(index, scope.group).reverse().map((id) => index.get(id)?.name ?? '');
}

/** The scope one level out: the group around a group, nothing around a top group or a smart group. */
export function parentScope(scene: GroupedScene, scope: EditScope): EditScope | null {
  if (!('group' in scope)) return null;
  const parent = groupIndex(scene).get(scope.group)?.parentId ?? null;
  return parent ? { group: parent } : null;
}

/**
 * What a click on `id` selects inside the scope: in a group, the member alone or the
 * outermost group nested in it with everything inside (Bryce's rule, one level down);
 * in a smart group, the member alone. Nothing outside the scope.
 */
export function scopeFamily(scene: GroupedScene, scope: EditScope, members: ReadonlySet<ObjectId>, id: ObjectId): ObjectId[] {
  if (!members.has(id)) return [];
  if ('smart' in scope) return [id];
  const obj = scene.objects.find((o) => o.id === id);
  const outward = chain(groupIndex(scene), obj?.groupId ?? null);
  const at = outward.indexOf(scope.group);
  const outer = at > 0 ? outward[at - 1] : null;
  return outer ? subtree(scene, outer) : [id];
}

/** The group nested directly in the scope's group that holds `id`, for a double click to step into; null when there is none. */
export function innerGroupOf(scene: GroupedScene, scope: EditScope | null, id: ObjectId): GroupId | null {
  const obj = scene.objects.find((o) => o.id === id);
  const outward = chain(groupIndex(scene), obj?.groupId ?? null);
  if (!scope) return outward.at(-1) ?? null;
  if (!('group' in scope)) return null;
  const at = outward.indexOf(scope.group);
  return at > 0 ? outward[at - 1] : null;
}

/** The scene with only the scope's members, for the picture and for picking. */
export function scopedScene(scene: Scene, members: ReadonlySet<ObjectId>): Scene {
  return { ...scene, objects: scene.objects.filter((o) => members.has(o.id)) };
}

/** The objects outside the scope, drawn as faint wires. */
export const outsideScope = (scene: Scene, members: ReadonlySet<ObjectId>): SceneObject[] => scene.objects.filter((o) => !members.has(o.id));
