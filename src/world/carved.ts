import { BooleanMode } from '../model/scene.enums';
import type { GroupId, ObjectId } from '../model/scene.ids';
import type { Scene, SceneObject } from '../model/scene.types';
import { bodyOf, groupBody } from './body-flags';
import { chain, groupIndex } from './group-tree';

/**
 * READ ME — a carved object: a group with boolean parts (Positive, Negative or
 * Intersect members), which the tracer draws as one solid. Play keeps it one:
 * a single body, welded as it were, the cutting parts riding along though they
 * never collide; it is physical when the group is or when any of its solid
 * parts is, and stands still otherwise (the Physics Gun lifts it whole). A
 * carved group inside a bigger one is part of the bigger one's body when that
 * is physical or carved too.
 */

/** Parts that shape the solid without being solid themselves. */
export const isCutter = (o: Pick<SceneObject, 'boolean' | 'groupId'>): boolean =>
  !!o.groupId && (o.boolean === BooleanMode.Negative || o.boolean === BooleanMode.Intersect);

/** The groups that are carved objects: those with a boolean member of their own. */
export function carvedGroups(scene: Pick<Scene, 'objects'>): Set<GroupId> {
  const out = new Set<GroupId>();
  for (const o of scene.objects) if (o.groupId && o.boolean !== BooleanMode.Neutral) out.add(o.groupId);
  return out;
}

/** What the scene makes one body of: the outermost physical or carved group around each object. */
export class BodyGroups {
  private readonly index;
  private readonly carved: Set<GroupId>;

  constructor(private readonly scene: Scene) {
    this.index = groupIndex(scene);
    this.carved = carvedGroups(scene);
  }

  /** The group whose body the object is part of, or null (a body of its own). */
  of(o: Pick<SceneObject, 'groupId'>): GroupId | null {
    return chain(this.index, o.groupId).filter((g) => this.carved.has(g) || groupBody(this.index.get(g)).physical).at(-1) ?? null;
  }

  /** Whether the group's body moves: the group (or one around it) is physical, or a solid part inside is. */
  physical(g: GroupId): boolean {
    if (groupBody(this.index.get(g)).physical) return true;
    return this.scene.objects.some((o) => !isCutter(o) && chain(this.index, o.groupId).includes(g) && bodyOf(o).physical);
  }

  isCarved(g: GroupId): boolean {
    return this.carved.has(g);
  }

  /** The objects of the group's body. */
  members(g: GroupId): ObjectId[] {
    return this.scene.objects.filter((o) => chain(this.index, o.groupId).includes(g)).map((o) => o.id);
  }
}

/** The carved object an object is part of (its outermost carved group), or null. */
export function carvedOf(scene: Scene, o: Pick<SceneObject, 'groupId'>): GroupId | null {
  const carved = carvedGroups(scene);
  return chain(groupIndex(scene), o.groupId).filter((g) => carved.has(g)).at(-1) ?? null;
}
