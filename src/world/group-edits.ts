import { type Mat4, invert, multiply } from '../core/mat4';
import { add, sub } from '../core/vec3';
import type { GroupId, ObjectId } from '../model/scene.ids';
import type { GroupNode, Key, Scene, SceneObject, Transform } from '../model/scene.types';
import { boxSphere, unionBox, worldBox } from './bounds';
import { chain, groupIndex, withGroups } from './group-tree';
import { framesOf, localOf, placed, sceneFrames, withoutLocal } from './group-pose';
import { IDENTITY, frameDelta, fromFrame, inFrame, isIdentity, matrixOf, sameTransform, transformOfMatrix } from './group-transform';

/**
 * READ ME — what an edit means inside groups. The tools change world poses
 * (`transform`); World passes every edit through `settled` before recording it:
 * - When every object of a group moved together (one rigid move, turn or even
 *   resize), the GROUP moves: its transform changes and the objects keep their
 *   poses inside it, so a moon orbiting inside a group keeps orbiting while the
 *   group flies. The outermost such group wins. A group without keys first gets
 *   its pivot at the centre of what it holds, so it turns about its middle.
 * - Any other changed object gets a new local pose, read through its groups.
 * - A change of the tree (grouping, moving into or out of a group) keeps every
 *   object and group where it is in the world and re-reads its keys in the new
 *   parent; nothing is keyed.
 */

export interface Settled {
  /** The scene before the edit; a group may have a new pivot (it looks the same). */
  readonly before: Scene;
  readonly after: Scene;
  /** False for a change of the tree: the moves it implies are not keyed. */
  readonly keyed: boolean;
}

/** Matrices closer than this (relative) are the same move. */
const FIT_EPS = 1e-6;

type Frame = Transform | null;

const sameFrame = (a: Frame, b: Frame): boolean => (a && b ? sameTransform(a, b) : (a ?? b) === null || isIdentity((a ?? b) as Transform));

const reKeyed = (keys: readonly Key<Transform>[], fn: (t: Transform) => Transform): Key<Transform>[] => keys.map((k) => ({ ...k, value: fn(k.value) }));

function sameMatrix(a: Mat4, b: Mat4): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > FIT_EPS * (1 + Math.abs(b[i]))) return false;
  return true;
}

/** The node with this transform; none when it is the identity. */
function withPivot(node: GroupNode, t: Transform): GroupNode {
  const { transform: _old, ...rest } = node;
  return isIdentity(t) ? rest : { ...rest, transform: t };
}

/** Objects inside each group, at any depth. */
function membersOf(scene: Pick<Scene, 'objects' | 'groups'>, index: ReadonlyMap<GroupId, GroupNode>): Map<GroupId, SceneObject[]> {
  const out = new Map<GroupId, SceneObject[]>();
  for (const o of scene.objects) {
    for (const g of chain(index, o.groupId)) {
      const list = out.get(g) ?? [];
      list.push(o);
      out.set(g, list);
    }
  }
  return out;
}

/** Groups whose every object moved by one and the same matrix: that matrix, outermost groups only. */
function rigidMoves(before: Scene, next: Scene): Map<GroupId, Mat4> {
  const out = new Map<GroupId, Mat4>();
  const prior = new Map(before.objects.map((o) => [o.id, o]));
  const index = groupIndex(next);
  const members = membersOf(next, index);
  const outerFirst = [...members.keys()].sort((x, y) => chain(index, x).length - chain(index, y).length);
  for (const g of outerFirst) {
    if (chain(index, g).some((up) => out.has(up))) continue;
    const pairs = (members.get(g) ?? []).map((o) => [prior.get(o.id), o] as const);
    if (!pairs.length || pairs.some(([old, o]) => !old || sameTransform(old.transform, o.transform))) continue;
    const [first] = pairs;
    const move = multiply(matrixOf(first[1].transform), invert(matrixOf((first[0] as SceneObject).transform)));
    if (pairs.every(([old, o]) => sameMatrix(multiply(move, matrixOf((old as SceneObject).transform)), matrixOf(o.transform)))) out.set(g, move);
  }
  return out;
}

/** The scene with group `g`'s pivot at the centre of what it holds; nothing moves in the world. */
export function repivoted(scene: Scene, g: GroupId): Scene {
  const index = groupIndex(scene);
  const node = index.get(g);
  const box = unionBox(scene.objects.filter((o) => chain(index, o.groupId).includes(g)).map(worldBox));
  if (!node || !box) return scene;
  const parent = sceneFrames(scene)(node.parentId);
  const center = boxSphere(box).center;
  const pivot = parent ? frameDelta(parent, sub(center, parent.position)) : center;
  const own = node.transform ?? IDENTITY;
  const shift = frameDelta(own, sub(own.position, pivot));
  const moved = (t: Transform): Transform => ({ ...t, position: add(t.position, shift) });
  index.set(g, withPivot(node, { ...own, position: pivot }));
  const a = scene.animation;
  const groupTracks = { ...(a.groups ?? {}) };
  for (const child of [...index.values()].filter((c) => c.parentId === g)) {
    index.set(child.id, withPivot(child, moved(child.transform ?? IDENTITY)));
    if (groupTracks[child.id]) groupTracks[child.id] = reKeyed(groupTracks[child.id], moved);
  }
  const objectTracks = { ...a.objects };
  const objects = scene.objects.map((o) => {
    if (o.groupId !== g) return o;
    if (objectTracks[o.id]) objectTracks[o.id] = reKeyed(objectTracks[o.id], moved);
    return { ...o, local: moved(localOf(o)) };
  });
  const animation = { ...a, objects: objectTracks, ...(a.groups ? { groups: groupTracks } : {}) };
  return withGroups({ ...scene, animation }, objects, index.values());
}

/** A transform edit: whole groups that moved rigidly move as groups; other changed objects get new local poses. */
function edited(before: Scene, next: Scene): Settled {
  const moves = rigidMoves(before, next);
  let b = before;
  let n = next;
  const untouchedTimeline = next.animation === before.animation && next.groups === before.groups;
  for (const g of moves.keys()) {
    if (!untouchedTimeline || b.animation.groups?.[g]?.length) continue;
    b = repivoted(b, g);
    n = { ...n, groups: b.groups, animation: b.animation };
  }
  const frame = sceneFrames(b);
  const index = groupIndex(n);
  const kept = new Set<ObjectId>();
  for (const [g, move] of moves) {
    const node = index.get(g);
    const world = frame(g) ?? IDENTITY;
    const to = node && transformOfMatrix(multiply(move, matrixOf(world)), world.rotation);
    if (!node || !to) continue;
    index.set(g, withPivot(node, fromFrame(frame(node.parentId), to, { world, local: node.transform ?? IDENTITY })));
    for (const o of n.objects) if (chain(index, o.groupId).includes(g)) kept.add(o.id);
  }
  const grouped = withGroups(n, n.objects, index.values());
  const frames = sceneFrames(grouped);
  const prior = new Map(b.objects.map((o) => [o.id, o]));
  const objects = grouped.objects.map((o) => {
    const old = prior.get(o.id);
    if (old && kept.has(o.id)) return { ...o, local: localOf(old) };
    const f = frames(o.groupId);
    if (!f) return o.local === undefined ? o : withoutLocal(o, o.transform);
    if (old && old.transform === o.transform) return o;
    return { ...o, local: fromFrame(f, o.transform, old && { world: old.transform, local: localOf(old) }) };
  });
  return { before: b, after: placed({ ...grouped, objects }), keyed: true };
}

/** Objects keep their groups and groups their parents (new objects and groups may come). */
function sameTree(before: Scene, next: Scene): boolean {
  const prior = new Map(before.objects.map((o) => [o.id, o.groupId]));
  if (next.objects.some((o) => prior.has(o.id) && prior.get(o.id) !== o.groupId)) return false;
  const was = groupIndex(before);
  return [...groupIndex(next).values()].every((g) => {
    const old = was.get(g.id);
    return !old || old.parentId === g.parentId;
  });
}

/** A change of the tree: everything stays where it is in the world; poses and keys are re-read in their new parents. */
function regrouped(before: Scene, next: Scene): Scene {
  const was = sceneFrames(before);
  const wasIndex = groupIndex(before);
  const index = groupIndex(next);
  const a = next.animation;
  const groupTracks = { ...(a.groups ?? {}) };
  const objectTracks = { ...a.objects };
  const outerFirst = [...index.keys()].sort((x, y) => chain(index, x).length - chain(index, y).length);
  for (const id of outerFirst) {
    const node = index.get(id) as GroupNode;
    const old = wasIndex.get(id);
    if (!old) continue;
    const from = was(old.parentId);
    const to = framesOf(index.values())(node.parentId);
    if (sameFrame(from, to)) continue;
    const reframe = (t: Transform): Transform => fromFrame(to, inFrame(from, t));
    index.set(id, withPivot(node, reframe(old.transform ?? IDENTITY)));
    if (groupTracks[id]) groupTracks[id] = reKeyed(groupTracks[id], reframe);
  }
  const frames = framesOf(index.values());
  const prior = new Map(before.objects.map((o) => [o.id, o]));
  const objects = next.objects.map((o) => {
    const old = prior.get(o.id);
    const f = frames(o.groupId);
    const from = old ? was(old.groupId) : null;
    if (old && sameFrame(from, f)) return o;
    if (old && objectTracks[o.id]) objectTracks[o.id] = reKeyed(objectTracks[o.id], (t) => fromFrame(f, inFrame(from, t)));
    return f ? { ...o, local: fromFrame(f, o.transform) } : withoutLocal(o, o.transform);
  });
  const animation = { ...a, objects: objectTracks, ...(a.groups ? { groups: groupTracks } : {}) };
  return placed(withGroups({ ...next, animation }, objects, index.values()));
}

/** The edit as World records it: groups move as groups, objects keep their poses inside them (see READ ME). */
export function settled(before: Scene, next: Scene): Settled {
  if (next.objects === before.objects && next.groups === before.groups) return { before, after: next, keyed: true };
  if (!sameTree(before, next)) return { before, after: regrouped(before, next), keyed: false };
  return edited(before, next);
}
