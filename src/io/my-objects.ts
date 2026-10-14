import { type Vec3, sub } from '../core/vec3';
import { type GroupId, type JointId, type ObjectId, newGroupId, newJointId, newObjectId } from '../model/scene.ids';
import type { GroupNode, Scene, SceneJoint, SceneObject } from '../model/scene.types';
import { unionBox, worldBox } from '../world/bounds';
import { chain, groupIndex } from '../world/group-tree';
import { contraption } from '../world/joints';
import { emptyScene } from '../world/scene.defaults';
import { deserializeScene, serializeScene } from '../world/scene.serialize';

/**
 * READ ME — My Objects: the player's own library of things built in the scene
 * (Sandbox's object menu › Save to My Objects), kept in this browser. An item is
 * an object as the player sees it — with the groups it is in (a carved object, a
 * board), whatever is welded to it, and the joints between them — stored as a
 * small scene file standing at the origin on its bottom. Taking one out gives
 * fresh ids every time, so many copies can stand in one scene.
 */

const KEY = 'hoodoo.my-objects.v1';
/** At most this many items, the oldest dropped first. */
const KEEP = 120;
const ID_RADIX = 36;
const ID_CHARS = 8;

export interface MyObject {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  /** A scene file holding just the item, standing at the origin. */
  readonly file: unknown;
}

/** What one copy of an item adds to a scene: fresh ids, standing at the origin. */
export interface MyObjectBuild {
  readonly objects: SceneObject[];
  readonly groups: GroupNode[];
  readonly joints: SceneJoint[];
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function myObjects(store: Store = localStorage): MyObject[] {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as MyObject[]) : [];
  } catch {
    return [];
  }
}

/** The objects an item of `id` is made of in `scene`: its outermost group, what is welded to it, their groups. */
export function itemOf(scene: Scene, id: ObjectId): { objects: SceneObject[]; groups: GroupNode[]; joints: SceneJoint[] } {
  const index = groupIndex(scene);
  const top = (o: SceneObject) => chain(index, o.groupId).at(-1) ?? null;
  const o = scene.objects.find((x) => x.id === id);
  if (!o) return { objects: [], groups: [], joints: [] };
  // The whole outermost group, then everything welded to it, then their whole groups again.
  const withGroups = (ids: Set<ObjectId>) => {
    const tops = new Set([...ids].map((i) => scene.objects.find((x) => x.id === i)).flatMap((x) => (x && top(x) ? [top(x) as GroupId] : [])));
    return new Set(scene.objects.filter((x) => ids.has(x.id) || (top(x) && tops.has(top(x) as GroupId))).map((x) => x.id));
  };
  const ids = withGroups(contraption(scene, withGroups(new Set([id]))));
  const objects = scene.objects.filter((x) => ids.has(x.id));
  const used = new Set(objects.flatMap((x) => chain(index, x.groupId)));
  const groups = [...index.values()].filter((g) => used.has(g.id));
  const joints = (scene.joints ?? []).filter((j) => ids.has(j.a) && j.b !== null && ids.has(j.b));
  return { objects, groups, joints };
}

/** Keeps an item under a name: it stands at the origin on its bottom, groups without pivots of their own. */
export function saveMyObject(name: string, part: { objects: readonly SceneObject[]; groups: readonly GroupNode[]; joints: readonly SceneJoint[] }, store: Store = localStorage): MyObject | null {
  const box = unionBox(part.objects.map(worldBox));
  if (!box) return null;
  const base: Vec3 = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
  const objects = part.objects.map(({ local: _local, ...o }) => ({ ...o, transform: { ...o.transform, position: sub(o.transform.position, base) } }));
  const groups = part.groups.map(({ transform: _t, script: _s, ...g }) => ({ ...g, collapsed: true }));
  const scene: Scene = { ...emptyScene(), objects, groups, ...(part.joints.length ? { joints: [...part.joints] } : {}) };
  const item: MyObject = { id: Math.random().toString(ID_RADIX).slice(2, 2 + ID_CHARS), name, savedAt: new Date().toISOString(), file: serializeScene(scene) };
  const all = [...myObjects(store), item].slice(-KEEP);
  try {
    store.setItem(KEY, JSON.stringify(all));
  } catch {
    return null;
  }
  return item;
}

export function removeMyObject(id: string, store: Store = localStorage): void {
  store.setItem(KEY, JSON.stringify(myObjects(store).filter((i) => i.id !== id)));
}

/** One copy of an item: every object, group and joint with a fresh id, standing at the origin. */
export function buildMyObject(item: MyObject): MyObjectBuild {
  const scene = deserializeScene(item.file);
  const objectIds = new Map<ObjectId, ObjectId>(scene.objects.map((o) => [o.id, newObjectId()]));
  const groupIds = new Map<GroupId, GroupId>((scene.groups ?? []).map((g) => [g.id, newGroupId()]));
  const group = (g: GroupId | null) => (g ? groupIds.get(g) ?? null : null);
  return {
    objects: scene.objects.map((o) => ({ ...o, id: objectIds.get(o.id) as ObjectId, groupId: group(o.groupId) })),
    groups: (scene.groups ?? []).map((g) => ({ ...g, id: groupIds.get(g.id) as GroupId, parentId: group(g.parentId) })),
    joints: (scene.joints ?? []).map((j) => ({
      ...j, id: newJointId() as JointId, a: objectIds.get(j.a) as ObjectId, b: j.b ? (objectIds.get(j.b) as ObjectId) : null,
    })),
  };
}

