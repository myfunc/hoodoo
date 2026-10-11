import type { ObjectId } from '../../model/scene.ids';
import type { Animation, Key, Scene, Transform } from '../../model/scene.types';
import { chain, coverItems, groupIndex } from '../group-tree';
import { KeyTrack, isCyclic, trackKeys, trackName } from './key-selection';
import { withKey } from './keying';

/**
 * Tracks of the selection, and closed paths. A whole group selected stands for
 * its own track; inside it (or when it has none) for the tracks of what it holds.
 * Close Path Loop makes a track end where it began — a key at the end of the
 * timeline repeating the first — and marks it cyclic, so it flows through the
 * seam (interpolate: the loop wrap of closed tracks). Open Path undoes both.
 */

export interface TrackRef {
  readonly track: KeyTrack.Object | KeyTrack.Group;
  readonly id: string;
}

export enum PathLoop {
  /** Nothing selected moves along a path. */
  None = 'none',
  Open = 'open',
  Closed = 'closed',
}

const hasTrack = (a: Animation, r: TrackRef): boolean => trackKeys(a, r.track, r.id).length > 0;

/**
 * The animated tracks the selection stands for, groups first: every group and
 * object track inside the whole groups, and the single objects. Nothing
 * selected: every object and group track.
 */
export function selectionTracks(scene: Scene, ids: ReadonlySet<ObjectId>): TrackRef[] {
  const a = scene.animation;
  const all = (track: TrackRef['track'], tracks: Animation['groups']) => Object.keys(tracks ?? {}).map((id) => ({ track, id }));
  if (!ids.size) return [...all(KeyTrack.Group, a.groups), ...all(KeyTrack.Object, a.objects)].filter((r) => hasTrack(a, r));
  const items = coverItems(scene, ids);
  const index = groupIndex(scene);
  const inside = (g: string) => items.groups.some((w) => chain(index, g as never).includes(w));
  const groups = [...index.keys()].filter(inside).map((id) => ({ track: KeyTrack.Group as const, id }));
  const objects = scene.objects.filter((o) => ids.has(o.id)).map((o) => ({ track: KeyTrack.Object as const, id: o.id as string }));
  return [...groups, ...objects].filter((r) => hasTrack(a, r));
}

/** The tracks a loop command acts on: a whole group with a track stands for itself alone. */
export function loopTracks(scene: Scene, ids: ReadonlySet<ObjectId>): TrackRef[] {
  if (!ids.size) return [];
  const a = scene.animation;
  const tracks = selectionTracks(scene, ids).filter((r) => trackKeys(a, r.track, r.id).length > 1);
  const index = groupIndex(scene);
  const keyed = new Set(tracks.filter((r) => r.track === KeyTrack.Group).map((r) => r.id));
  // Inside a keyed group only the group's own path loops; objects in groups without keys loop their own paths.
  const outer = (r: TrackRef) => {
    const groupId = r.track === KeyTrack.Group ? (index.get(r.id as never)?.parentId ?? null) : (scene.objects.find((o) => o.id === r.id)?.groupId ?? null);
    return !chain(index, groupId).some((g) => keyed.has(g));
  };
  return tracks.filter(outer);
}

export function pathLoopOf(a: Animation, tracks: readonly TrackRef[]): PathLoop {
  if (!tracks.length) return PathLoop.None;
  return tracks.every((r) => isCyclic(a, r.track, r.id)) ? PathLoop.Closed : PathLoop.Open;
}

/** The keys ending at the end of the timeline on the first key's value (a key already there is aligned). */
export function closedKeys<T>(keys: readonly Key<T>[], a: Animation): readonly Key<T>[] {
  return keys.length < 2 ? keys : withKey(keys, a.duration, keys[0].value, a.fps);
}

/** The keys without the closing key: the last one, when it repeats the first and others remain between. */
export function openedKeys<T>(keys: readonly Key<T>[]): readonly Key<T>[] {
  const last = keys.at(-1);
  if (keys.length < 3 || !last || JSON.stringify(last.value) !== JSON.stringify(keys[0].value)) return keys;
  return keys.slice(0, -1);
}

/** The timeline with these paths closed into loops (the timeline loops too) or opened again. */
export function withPathLoop(a: Animation, tracks: readonly TrackRef[], closed: boolean): Animation {
  const objects: Record<string, readonly Key<Transform>[]> = { ...a.objects };
  const groups: Record<string, readonly Key<Transform>[]> = { ...(a.groups ?? {}) };
  const names = new Set(a.cyclic ?? []);
  for (const r of tracks) {
    const table = r.track === KeyTrack.Group ? groups : objects;
    const keys = table[r.id];
    if (!keys || keys.length < 2) continue;
    table[r.id] = closed ? closedKeys(keys, a) : openedKeys(keys);
    if (closed) names.add(trackName(r.track, r.id));
    else names.delete(trackName(r.track, r.id));
  }
  const { cyclic: _old, ...rest } = a;
  return {
    ...rest,
    loop: closed || a.loop,
    objects,
    ...(a.groups ? { groups } : {}),
    ...(names.size ? { cyclic: [...names] } : {}),
  };
}
