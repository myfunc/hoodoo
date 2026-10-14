import type { Vec3 } from '../core/vec3';
import { JointKind } from '../model/scene.enums';
import { type ObjectId, asJointId, asObjectId } from '../model/scene.ids';
import type { Scene, SceneJoint } from '../model/scene.types';

/**
 * READ ME — Sandbox's joints as the scene keeps them (model SceneJoint): read
 * back from a file, dropped with the objects they hold, and walked as a graph
 * (a contraption: everything joined to an object, directly or through others).
 * Play turns them into physics (play/sandbox/joints.ts).
 */

/** At most this many joints in a scene. */
export const MAX_JOINTS = 400;
const KINDS: ReadonlySet<unknown> = new Set(Object.values(JointKind));
const ANCHOR_LIMIT = 1e6;

/** The joints of a file that are well formed and hold objects the scene has. */
export function jointTable(v: unknown, objects: ReadonlySet<string>): SceneJoint[] {
  if (!Array.isArray(v)) return [];
  const out: SceneJoint[] = [];
  const seen = new Set<string>();
  for (const raw of v.slice(0, MAX_JOINTS)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const [a, b] = [r.a, r.b];
    if (typeof r.id !== 'string' || seen.has(r.id) || !KINDS.has(r.kind)) continue;
    if (typeof a !== 'string' || !objects.has(a) || (b !== null && (typeof b !== 'string' || !objects.has(b) || b === a))) continue;
    const anchorA = anchor(r.anchorA);
    const anchorB = anchor(r.anchorB);
    if (!anchorA || !anchorB) continue;
    seen.add(r.id);
    const forceLimit = typeof r.forceLimit === 'number' && r.forceLimit > 0 && Number.isFinite(r.forceLimit) ? r.forceLimit : undefined;
    out.push({
      id: asJointId(r.id), kind: r.kind as JointKind, a: asObjectId(a), b: b === null ? null : asObjectId(b as string), anchorA, anchorB,
      ...(forceLimit ? { forceLimit } : {}), ...(r.collide === true ? { collide: true } : {}),
    });
  }
  return out;
}

function anchor(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < ANCHOR_LIMIT)) return null;
  return [v[0], v[1], v[2]];
}

/** The scene without the joints that hold any of these objects. */
export function withoutJointsOf(scene: Scene, ids: ReadonlySet<ObjectId>): Scene {
  if (!scene.joints?.length) return scene;
  return withJoints(scene, scene.joints.filter((j) => !ids.has(j.a) && !(j.b && ids.has(j.b))));
}

/** The scene with this joint table (none: the field goes). */
export function withJoints(scene: Scene, joints: readonly SceneJoint[]): Scene {
  const { joints: _previous, ...rest } = scene;
  return joints.length ? { ...rest, joints } : rest;
}

/** The joints that hold this object, of the given kinds (all when none given). */
export function jointsOf(scene: Scene, id: ObjectId, kinds?: ReadonlySet<JointKind>): SceneJoint[] {
  return (scene.joints ?? []).filter((j) => (j.a === id || j.b === id) && (!kinds || kinds.has(j.kind)));
}

/** The objects joined to these, directly or through others, them included (No-Collide joins nothing). */
export function contraption(scene: Scene, ids: Iterable<ObjectId>): Set<ObjectId> {
  const out = new Set(ids);
  const links = (scene.joints ?? []).filter((j) => j.kind !== JointKind.NoCollide && j.b);
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of links) {
      const b = j.b as ObjectId;
      if (out.has(j.a) !== out.has(b)) {
        out.add(j.a);
        out.add(b);
        grew = true;
      }
    }
  }
  return out;
}

