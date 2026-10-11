import type { GroupId, ObjectId } from '../model/scene.ids';
import type { GroupNode, Scene, SceneObject } from '../model/scene.types';
import { GROUP_NAME, SCENE_LIMITS } from './scene.validate';

/**
 * READ ME — the Object Tree (preview): groups nest. An object points at its
 * innermost group, a group at its parent. Plain groups (top level, default name,
 * unfolded) need no table entry, so a scene without nesting keeps the flat shape
 * of every older file. Functions here are pure; World records their results,
 * each as one undo step. Groups have no transform of their own: moving a group
 * moves its objects.
 */

type GroupedScene = Pick<Scene, 'objects' | 'groups'>;

/** What a selection is made of: whole groups where every object inside is picked, single objects elsewhere. */
export interface TreeItems {
  readonly objects: readonly ObjectId[];
  readonly groups: readonly GroupId[];
}

/** One line of the scene list in tree form. */
export interface TreeRow {
  readonly depth: number;
  /** The group of a group row; null on an object row. */
  readonly group: GroupNode | null;
  readonly object: SceneObject | null;
  /** What the row stands for: the object itself, or every object inside the group. */
  readonly members: readonly SceneObject[];
}

const plainGroup = (id: GroupId): GroupNode => ({ id, name: GROUP_NAME, parentId: null, collapsed: false });
const isPlain = (g: GroupNode): boolean => g.parentId === null && g.name === GROUP_NAME && !g.collapsed;

/** Every group of the scene by id: the table plus the plain groups objects point at. */
export function groupIndex(scene: GroupedScene): Map<GroupId, GroupNode> {
  const index = new Map((scene.groups ?? []).map((g) => [g.id, g]));
  for (const o of scene.objects) if (o.groupId && !index.has(o.groupId)) index.set(o.groupId, plainGroup(o.groupId));
  return index;
}

/** The group and the groups around it, innermost first; empty for null. Stops at a loop. */
export function chain(index: ReadonlyMap<GroupId, GroupNode>, id: GroupId | null): GroupId[] {
  const out: GroupId[] = [];
  for (let at = id; at && !out.includes(at); at = index.get(at)?.parentId ?? null) out.push(at);
  return out;
}

/** The table worth keeping: groups that still hold objects and are not plain (or hold a group that is not). */
export function tidyGroups(objects: readonly SceneObject[], nodes: Iterable<GroupNode>): GroupNode[] {
  const index = new Map([...nodes].map((g) => [g.id, g]));
  const used = new Set<GroupId>();
  for (const o of objects) for (const g of chain(index, o.groupId)) used.add(g);
  const parents = new Set([...used].map((g) => index.get(g)?.parentId));
  return [...index.values()].filter((g) => used.has(g.id) && (!isPlain(g) || parents.has(g.id)));
}

/** The scene with new objects and groups; no `groups` key when every group is plain. */
export function withGroups(scene: Scene, objects: readonly SceneObject[], nodes: Iterable<GroupNode>): Scene {
  const groups = tidyGroups(objects, nodes);
  const { groups: _previous, ...rest } = scene;
  return groups.length ? { ...rest, objects, groups } : { ...rest, objects };
}

/** Object ids inside the group, at any depth, in scene order. */
export function subtree(scene: GroupedScene, id: GroupId): ObjectId[] {
  const index = groupIndex(scene);
  return scene.objects.filter((o) => chain(index, o.groupId).includes(id)).map((o) => o.id);
}

/** Bryce's rule, nested: one member selects its outermost group with everything inside. */
export function familyOf(scene: GroupedScene, id: ObjectId): ObjectId[] {
  const obj = scene.objects.find((o) => o.id === id);
  if (!obj?.groupId) return [id];
  const outer = chain(groupIndex(scene), obj.groupId).at(-1) ?? obj.groupId;
  return subtree(scene, outer);
}

/** The fewest whole groups and single objects that make up the selection. */
export function coverItems(scene: GroupedScene, ids: ReadonlySet<ObjectId>): TreeItems {
  const index = groupIndex(scene);
  const total = new Map<GroupId, number>();
  const picked = new Map<GroupId, number>();
  for (const o of scene.objects) {
    for (const g of chain(index, o.groupId)) {
      total.set(g, (total.get(g) ?? 0) + 1);
      if (ids.has(o.id)) picked.set(g, (picked.get(g) ?? 0) + 1);
    }
  }
  const objects: ObjectId[] = [];
  const groups = new Set<GroupId>();
  for (const o of scene.objects) {
    if (!ids.has(o.id)) continue;
    // A group is whole when all its objects are picked; then so is every group inside it.
    let whole: GroupId | null = null;
    for (const g of chain(index, o.groupId)) {
      if (picked.get(g) !== total.get(g)) break;
      whole = g;
    }
    if (whole) groups.add(whole);
    else objects.push(o.id);
  }
  return { objects, groups: [...groups] };
}

/** The innermost group that holds all the given parents (null is the top level). */
function commonParent(index: ReadonlyMap<GroupId, GroupNode>, parents: readonly (GroupId | null)[]): GroupId | null {
  const [first, ...rest] = parents.map((p) => chain(index, p));
  return first.find((g) => rest.every((c) => c.includes(g))) ?? null;
}

/** The scene, or null when an object would sit deeper than the depth limit. */
function checked(scene: Scene, objects: readonly SceneObject[], index: ReadonlyMap<GroupId, GroupNode>): Scene | null {
  if (objects.some((o) => chain(index, o.groupId).length > SCENE_LIMITS.groupDepth)) return null;
  return withGroups(scene, objects, index.values());
}

/** A name no group has yet: Group 1, Group 2… */
export function freshGroupName(scene: GroupedScene): string {
  const taken = new Set([...groupIndex(scene).values()].map((g) => g.name));
  let n = 1;
  while (taken.has(`${GROUP_NAME} ${n}`)) n++;
  return `${GROUP_NAME} ${n}`;
}

/** Groups the selection's items into a new group inside their common parent; null for fewer than two items. */
export function grouped(scene: Scene, ids: ReadonlySet<ObjectId>, id: GroupId, name: string): Scene | null {
  const items = coverItems(scene, ids);
  if (items.objects.length + items.groups.length < 2) return null;
  const index = groupIndex(scene);
  const moved = new Set(items.objects);
  const parents = [
    ...scene.objects.filter((o) => moved.has(o.id)).map((o) => o.groupId),
    ...items.groups.map((g) => index.get(g)?.parentId ?? null),
  ];
  index.set(id, { id, name, parentId: commonParent(index, parents), collapsed: false });
  for (const g of items.groups) index.set(g, { ...(index.get(g) ?? plainGroup(g)), parentId: id });
  return checked(scene, scene.objects.map((o) => (moved.has(o.id) ? { ...o, groupId: id } : o)), index);
}

/** Dissolves the selected groups (or the groups of single selected objects); their children move up one level. */
export function ungrouped(scene: Scene, ids: ReadonlySet<ObjectId>): Scene | null {
  const index = groupIndex(scene);
  const items = coverItems(scene, ids);
  const gone = new Set(items.groups);
  const picked = new Set(items.objects);
  for (const o of scene.objects) if (picked.has(o.id) && o.groupId) gone.add(o.groupId);
  if (!gone.size) return null;
  const lift = (g: GroupId | null): GroupId | null => chain(index, g).find((x) => !gone.has(x)) ?? null;
  const objects = scene.objects.map((o) => (o.groupId && gone.has(o.groupId) ? { ...o, groupId: lift(o.groupId) } : o));
  const nodes = [...index.values()].filter((g) => !gone.has(g.id)).map((g) => (g.parentId && gone.has(g.parentId) ? { ...g, parentId: lift(g.parentId) } : g));
  return withGroups(scene, objects, nodes);
}

/**
 * Moves objects and groups into `target` (null: the top level). Null when nothing
 * would change, the target is missing, a group would go inside itself, or the
 * tree would grow deeper than the limit.
 */
export function reparented(scene: Scene, items: TreeItems, target: GroupId | null): Scene | null {
  const index = groupIndex(scene);
  if (target !== null && !index.has(target)) return null;
  const above = chain(index, target);
  if (items.groups.some((g) => above.includes(g))) return null;
  const moved = new Set(items.objects);
  let changed = false;
  const objects = scene.objects.map((o) => {
    if (!moved.has(o.id) || o.groupId === target) return o;
    changed = true;
    return { ...o, groupId: target };
  });
  for (const g of items.groups) {
    const node = index.get(g);
    if (!node || node.parentId === target) continue;
    changed = true;
    index.set(g, { ...node, parentId: target });
  }
  return changed ? checked(scene, objects, index) : null;
}

/** The scene with one group's entry changed (name, folding). */
export function withGroup(scene: Scene, id: GroupId, patch: Partial<Omit<GroupNode, 'id' | 'parentId'>>): Scene {
  const index = groupIndex(scene);
  const node = index.get(id);
  if (node) index.set(id, { ...node, ...patch });
  return withGroups(scene, scene.objects, index.values());
}

/** Fresh groups for copies: every group around the copied objects gets a new id, keeping names and nesting. */
export function cloneGroups(index: ReadonlyMap<GroupId, GroupNode>, objects: readonly SceneObject[], mint: () => GroupId): { map: Map<GroupId, GroupId>; nodes: GroupNode[] } {
  const map = new Map<GroupId, GroupId>();
  for (const o of objects) for (const g of chain(index, o.groupId)) if (!map.has(g)) map.set(g, mint());
  const nodes = [...map].map(([from, to]) => {
    const node = index.get(from) ?? plainGroup(from);
    return { ...node, id: to, parentId: node.parentId ? (map.get(node.parentId) ?? null) : null };
  });
  return { map, nodes };
}

/** The scene list as a tree: groups first met where their first object stands, folded groups without children. */
export function treeRows(scene: GroupedScene): TreeRow[] {
  const index = groupIndex(scene);
  const children = new Map<GroupId | null, (GroupId | SceneObject)[]>();
  const members = new Map<GroupId, SceneObject[]>();
  const place = (parent: GroupId | null, child: GroupId | SceneObject) => {
    const list = children.get(parent) ?? [];
    if (!list.includes(child)) list.push(child);
    children.set(parent, list);
  };
  for (const o of scene.objects) {
    const outward = chain(index, o.groupId);
    outward.forEach((g, i) => {
      place(outward[i + 1] ?? null, g);
      const list = members.get(g) ?? [];
      list.push(o);
      members.set(g, list);
    });
    place(o.groupId, o);
  }
  const rows: TreeRow[] = [];
  const visit = (parent: GroupId | null, depth: number) => {
    for (const child of children.get(parent) ?? []) {
      if (typeof child !== 'string') {
        rows.push({ depth, group: null, object: child, members: [child] });
        continue;
      }
      const group = index.get(child) ?? plainGroup(child);
      rows.push({ depth, group, object: null, members: members.get(child) ?? [] });
      if (!group.collapsed) visit(child, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
