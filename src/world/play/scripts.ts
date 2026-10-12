import { createEntry } from '../../assets/object.catalog';
import type { Vec3 } from '../../core/vec3';
import { BehaviourKind, ClipMode, ClipStart, ZoneAction } from '../../model/play.enums';
import type { BehaviourSpec, Clip, PlayScript, TriggerZone } from '../../model/play.types';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { GroupNode, Scene, SceneObject } from '../../model/scene.types';
import { chain, groupIndex, subtree } from '../group-tree';
import { createObject } from '../objects.factory';
import { behaviourDef } from './behaviour-catalog';

/**
 * READ ME — Play scripts in the scene (docs/play-mode.md): which objects and
 * groups have a clip or behaviours, which objects are trigger zones, and the
 * small edits the editor makes to them. A zone is a Cube or a Sphere with a
 * `zone` field: dashed in the wireframe, left out of every render, never solid.
 */

export const ZONE_NAME = 'Trigger Zone';
/** A new zone: two units each way, standing on the ground. */
const ZONE_SIZE: Vec3 = [1, 1, 1];

export const isZone = (o: Pick<SceneObject, 'zone'>): boolean => o.zone !== undefined;

/** A script whose clip or behaviours move what it sits on (a kinematic body in Play). */
export const scriptMoves = (s: PlayScript | undefined): boolean =>
  !!s && (!!s.clip || !!s.behaviours?.some((b) => behaviourDef(b.kind)?.moves));

/** Whether a script moves an object: its own, or one of the groups around it. */
export function movedByScript(scene: Pick<Scene, 'objects' | 'groups'>): (o: SceneObject) => boolean {
  const index = groupIndex(scene);
  const moving = new Set([...index.values()].filter((g) => scriptMoves(g.script)).map((g) => g.id));
  return (o) => scriptMoves(o.script) || (moving.size > 0 && chain(index, o.groupId).some((g) => moving.has(g)));
}

/** Anything for Play's scripts to do: a script on an object or a group, or a trigger zone. */
export const hasScripts = (scene: Pick<Scene, 'objects' | 'groups'>): boolean =>
  scene.objects.some((o) => o.script || o.zone) || !!scene.groups?.some((g) => g.script);

/** An object or a group, by id: what scripts refer to. */
export type ScriptRef = { readonly object: ObjectId } | { readonly group: GroupId };

/** The keys of an object's or a group's track, by time. */
export function trackTimes(scene: Scene, ref: ScriptRef): number[] {
  const a = scene.animation;
  const keys = 'object' in ref ? a.objects[ref.object] : a.groups?.[ref.group];
  return (keys ?? []).map((k) => k.time);
}

/** A first clip over the whole track: it loops as soon as Play starts. */
export function defaultClip(times: readonly number[]): Clip | null {
  if (times.length < 2) return null;
  return { from: times[0], to: times[times.length - 1], mode: ClipMode.Loop, speed: 1, start: ClipStart.Auto };
}

/** A new behaviour with its defaults (parameters absent mean the catalog's). */
export const newBehaviour = (kind: BehaviourKind): BehaviourSpec => ({ kind, params: {} });

/** The script tidied: an empty one is null. */
function tidy(s: PlayScript): PlayScript | null {
  const behaviours = s.behaviours?.length ? s.behaviours : undefined;
  if (!s.clip && !behaviours) return null;
  return { ...(s.clip ? { clip: s.clip } : {}), ...(behaviours ? { behaviours } : {}) };
}

/** The object or group with its script changed; the field goes away when nothing is left. */
export function withScript<T extends SceneObject | GroupNode>(item: T, patch: (s: PlayScript) => PlayScript): T {
  const next = tidy(patch(item.script ?? {}));
  const { script: _old, ...rest } = item;
  return (next ? { ...rest, script: next } : rest) as T;
}

/** The object as a trigger zone with these rules, or no longer a zone (null). */
export function withZone(o: SceneObject, zone: TriggerZone | null): SceneObject {
  const { zone: _old, ...rest } = o;
  return zone ? { ...rest, zone } : rest;
}

/** A new trigger zone standing at `at` (its foot on the ground), a box with no rules yet. */
export function createTriggerZone(at: Vec3, name = ZONE_NAME): SceneObject {
  const o = createObject(createEntry('cube'), { seed: 1, name, size: ZONE_SIZE, position: [at[0], at[1] + ZONE_SIZE[1], at[2]] });
  return { ...o, zone: { rules: [] } };
}

/** The objects a rule shows (hidden ones that appear in Play): they get their bodies from the start. */
export function shownByRules(scene: Pick<Scene, 'objects' | 'groups'>): Set<ObjectId> {
  const out = new Set<ObjectId>();
  const ids = new Set(scene.objects.map((o) => o.id as string));
  for (const o of scene.objects) {
    for (const r of o.zone?.rules ?? []) {
      if (r.action !== ZoneAction.Show || !r.target) continue;
      if (ids.has(r.target)) out.add(r.target as ObjectId);
      else for (const id of subtree(scene, r.target as GroupId)) out.add(id);
    }
  }
  return out;
}

/** What a picker of targets lists: every object and named group, by name. */
export function scriptTargets(scene: Pick<Scene, 'objects' | 'groups'>): { id: string; name: string }[] {
  const groups = [...groupIndex(scene).values()].map((g) => ({ id: g.id as string, name: `${g.name} (group)` }));
  return [...scene.objects.map((o) => ({ id: o.id as string, name: o.name })), ...groups];
}

/** The name of what an id stands for, or null when it is gone. */
export function refName(scene: Pick<Scene, 'objects' | 'groups'>, id: string | undefined): string | null {
  if (!id) return null;
  const o = scene.objects.find((x) => x.id === id);
  if (o) return o.name;
  return groupIndex(scene).get(id as GroupId)?.name ?? null;
}

/** Behaviours of a kind that sit on an object or a group. */
export const behavioursOf = (s: PlayScript | undefined, kind: BehaviourKind): BehaviourSpec[] => (s?.behaviours ?? []).filter((b) => b.kind === kind);
