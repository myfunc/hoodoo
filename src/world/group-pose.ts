import type { GroupId } from '../model/scene.ids';
import type { GroupNode, Scene, SceneObject, Transform } from '../model/scene.types';
import { composeTransforms, isIdentity, sameTransform } from './group-transform';

/**
 * READ ME — where objects are in the world. Groups carry transforms and objects
 * keep their pose inside their group (`local`); `placed` writes every object's
 * world pose into its `transform`, so the renderer, picking, wires and the tools
 * read one field and never compose anything themselves. World and poseAt call it
 * on every scene they record.
 */

type GroupedScene = Pick<Scene, 'objects' | 'groups'>;

/** The world pose of a group (null: nothing moves it; the identity all the way up). */
export type FrameOf = (id: GroupId | null) => Transform | null;

/** World poses of groups, composed through their parents; a loop in the table ends the chain. */
export function framesOf(groups: Iterable<GroupNode>): FrameOf {
  const table = new Map([...groups].map((g) => [g.id, g]));
  const memo = new Map<GroupId, Transform | null>();
  const visiting = new Set<GroupId>();
  const frame: FrameOf = (id) => {
    if (!id) return null;
    const known = memo.get(id);
    if (known !== undefined) return known;
    const node = table.get(id);
    if (!node || visiting.has(id)) return null;
    visiting.add(id);
    const parent = frame(node.parentId);
    const own = node.transform && !isIdentity(node.transform) ? node.transform : null;
    const out = own ? (parent ? composeTransforms(parent, own) : own) : parent;
    memo.set(id, out);
    return out;
  };
  return frame;
}

export const sceneFrames = (scene: GroupedScene): FrameOf => framesOf(scene.groups ?? []);

/** The object's pose inside its group. */
export const localOf = (o: SceneObject): Transform => o.local ?? o.transform;

/** The object without a separate local pose: its transform is its local pose. */
export function withoutLocal(o: SceneObject, transform: Transform): SceneObject {
  const { local: _local, ...rest } = o;
  return { ...rest, transform };
}

/** The scene with every object's `transform` set to its world pose; the same scene when nothing moves. */
export function placed(scene: Scene): Scene {
  const frame = sceneFrames(scene);
  let changed = false;
  const objects = scene.objects.map((o) => {
    const f = frame(o.groupId);
    if (!f) {
      if (o.local === undefined) return o;
      changed = true;
      return withoutLocal(o, o.local);
    }
    const local = localOf(o);
    const world = composeTransforms(f, local);
    if (o.local !== undefined && sameTransform(o.transform, world, 0)) return o;
    changed = true;
    return { ...o, local, transform: world };
  });
  return changed ? { ...scene, objects } : scene;
}
