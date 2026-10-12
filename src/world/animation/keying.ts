import { Ease } from '../../model/scene.enums';
import type { Animation, Key, ObjectKey, Scene, SceneObject, Transform } from '../../model/scene.types';
import { localOf } from '../group-pose';
import { groupIndex } from '../group-tree';
import { IDENTITY } from '../group-transform';
import { PROP_CHANNELS, type PropChannel, PropGroup, holdsChannel, sameProp } from './prop-channels';

/**
 * Auto-key, as in Bryce 3D: change something with the playhead past zero and
 * the change becomes a key at that frame. A first change of a still object also
 * keys where it was at zero, so it moves from there. At zero, a still object is
 * simply edited. The camera is keyed once its track exists (Key Camera), so
 * looking around never starts a camera move by accident; a selected camera
 * (world/rig) is keyed like an object, from its first change. With animation off
 * nothing is keyed. Objects are keyed by their pose inside their group, groups
 * by their own transform (world/group-edits decides which of them an edit moved).
 * A changed material, light or visibility keys just the values that changed
 * (animation/prop-channels), on the key of that frame.
 */

/** Key times sit on frames: two keys closer than half a frame are the same key. */
export const frameTime = (t: number, fps: number): number => Math.round(t * fps) / fps;

export const sameTime = (a: number, b: number, fps: number): boolean => Math.abs(a - b) < 0.5 / fps;

/** Half a frame: a time this close to zero is zero. */
const half = (fps: number): number => 0.5 / fps;

/** The keys with `value` set at `time`, replacing a key on the same frame (which keeps its ease, unless one is given). */
export function withKey<T>(keys: readonly Key<T>[], time: number, value: T, fps: number, ease = keys.find((k) => sameTime(k.time, time, fps))?.ease ?? Ease.Smooth): Key<T>[] {
  const rest = keys.filter((k) => !sameTime(k.time, time, fps));
  return [...rest, { time, value, ...(ease !== Ease.Smooth ? { ease } : {}) }].sort((a, b) => a.time - b.time);
}

export function withoutKey<T>(keys: readonly Key<T>[], time: number, fps: number): Key<T>[] {
  return keys.filter((k) => !sameTime(k.time, time, fps));
}

export const hasKeyAt = <T>(keys: readonly Key<T>[], time: number, fps: number): boolean => keys.some((k) => sameTime(k.time, time, fps));

/** The keys with the pose `value` at `time`; a key already there keeps what else it holds. */
export function withPose(keys: readonly Key<ObjectKey>[], time: number, value: Transform, fps: number): Key<ObjectKey>[] {
  const at = keys.find((k) => sameTime(k.time, time, fps));
  return withKey(keys, time, at ? { ...at.value, ...value } : value, fps);
}

/**
 * The keys with `v` on one channel at `time`: the key there takes it, or a new
 * key is made with the pose the track has there (`pose`), so nothing moves.
 */
export function withChannelKey(keys: readonly Key<ObjectKey>[], time: number, ch: PropChannel, v: unknown, fps: number, pose: (t: number) => Transform): Key<ObjectKey>[] {
  const at = keys.find((k) => sameTime(k.time, time, fps));
  if (at) return keys.map((k) => (k === at ? { ...k, value: ch.toKey(k.value, v) } : k));
  const p = pose(time);
  return withKey(keys, time, ch.toKey({ position: p.position, rotation: p.rotation, size: p.size }, v), fps);
}

/** One channel keyed with `now` at `time`; its first key past zero also keys `was` at zero, so it changes from there. */
export function keyedChannel(keys: readonly Key<ObjectKey>[], time: number, ch: PropChannel, was: unknown, now: unknown, fps: number, pose: (t: number) => Transform): Key<ObjectKey>[] {
  const from = !holdsChannel(ch, keys) && time > half(fps) ? withChannelKey(keys, 0, ch, was, fps, pose) : keys;
  return withChannelKey(from, time, ch, now, fps, pose);
}

/**
 * The keys after the object's material, light or visibility changed from
 * `before` to `after` at `time`: each changed channel is keyed there
 * (keyedChannel). At zero a channel without keys is simply edited. Visibility
 * is keyed only once its channel has a key (hiding something to work around it
 * is not a key), as the camera is keyed only once it has a track.
 */
export function keyedProps(keys: readonly Key<ObjectKey>[], time: number, before: SceneObject, after: SceneObject, fps: number, pose: (t: number) => Transform): readonly Key<ObjectKey>[] {
  // Most edits leave these alone: nothing to compare, channel by channel.
  if (before.material === after.material && before.light === after.light && before.hidden === after.hidden) return keys;
  let out = keys;
  for (const ch of PROP_CHANNELS) {
    const was = ch.ofObject(before);
    const now = ch.ofObject(after);
    if (was === undefined || now === undefined || sameProp(was, now)) continue;
    if (!holdsChannel(ch, out) && (ch.group === PropGroup.Visibility || time <= half(fps))) continue;
    out = keyedChannel(out, time, ch, was, now, fps, pose);
  }
  return out;
}

/** A track after its value changed from `before` to `after` at `time`; empty when nothing should be keyed. */
function autoKeyed<T>(keys: readonly Key<T>[], time: number, before: T, after: T, fps: number): readonly Key<T>[] {
  if (keys.length) return withKey(keys, time, after, fps);
  if (time <= 0.5 / fps) return keys;
  return withKey([{ time: 0, value: before }], time, after, fps);
}

const samePose = (a: Transform, b: Transform): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** An object track after its pose changed at `time`: like autoKeyed, a key already there keeping its other values. */
function posed(keys: readonly Key<ObjectKey>[], time: number, before: Transform, after: Transform, fps: number): readonly Key<ObjectKey>[] {
  if (keys.length) return withPose(keys, time, after, fps);
  return autoKeyed(keys, time, before, after, fps);
}

type Tracks = Readonly<Record<string, readonly Key<ObjectKey>[]>>;

/** Tracks of objects or groups that are gone are dropped with them. */
function pruned(tracks: Tracks, alive: ReadonlySet<string>): Tracks {
  const ids = Object.keys(tracks);
  if (ids.every((id) => alive.has(id))) return tracks;
  return Object.fromEntries(ids.filter((id) => alive.has(id)).map((id) => [id, tracks[id]]));
}

/**
 * The edited scene with auto-keys recorded at `time`. With animation off, or
 * `poses` false (a change of the tree, which moves nothing), only the tracks of
 * deleted objects and groups go. `cameraSelected`: the camera is keyed like an object.
 */
export function recordKeys(before: Scene, after: Scene, time: number, poses = true, cameraSelected = false): Scene {
  const a = after.animation;
  const index = groupIndex(after);
  let objects = pruned(a.objects, new Set(after.objects.map((o) => o.id)));
  let groups = a.groups && pruned(a.groups, new Set(index.keys()));
  const done = (camera = a.camera, sky = a.sky): Scene => {
    if (objects === a.objects && groups === a.groups && camera === a.camera && sky === a.sky) return after;
    return { ...after, animation: { ...a, objects, ...(groups ? { groups } : {}), camera, sky } };
  };
  if (!a.enabled || !poses) return done();
  const t = frameTime(time, a.fps);
  const prior = new Map(before.objects.map((o) => [o.id, o]));
  for (const o of after.objects) {
    const old = prior.get(o.id);
    if (!old) continue;
    const track = objects[o.id] ?? [];
    const moved = samePose(localOf(old), localOf(o)) ? track : posed(track, t, localOf(old), localOf(o), a.fps);
    // A new key for a material or light holds the pose there: at the playhead the
    // object's own, at zero the first key's (the track holds it before that key).
    const first = moved[0]?.value;
    const pose = (at: number): Transform => (at > half(a.fps) ? localOf(o) : first ? { position: first.position, rotation: first.rotation, size: first.size } : localOf(old));
    const keys = keyedProps(moved, t, old, o, a.fps, pose);
    if (keys !== track) objects = { ...objects, [o.id]: keys };
  }
  const was = groupIndex(before);
  for (const g of index.values()) {
    const old = was.get(g.id);
    const from = old?.transform ?? IDENTITY;
    const to = g.transform ?? IDENTITY;
    if (!old || samePose(from, to)) continue;
    const keys = autoKeyed(groups?.[g.id] ?? [], t, from, to, a.fps);
    if (keys.length) groups = { ...groups, [g.id]: keys };
  }
  const cameraMoved = before.camera !== after.camera;
  const cameraKeys = cameraSelected ? autoKeyed(a.camera, t, before.camera, after.camera, a.fps) : a.camera.length ? withKey(a.camera, t, after.camera, a.fps) : a.camera;
  const camera = cameraMoved ? cameraKeys : a.camera;
  const sky = before.sky !== after.sky ? autoKeyed(a.sky, t, before.sky, after.sky, a.fps) : a.sky;
  return done(camera, sky);
}

/** Every key time of the animation, for the timeline's "next / previous key". */
export function allKeyTimes(a: Animation): number[] {
  const times = [...a.camera, ...a.sky, ...Object.values(a.objects).flat(), ...Object.values(a.groups ?? {}).flat()].map((k) => k.time);
  return [...new Set(times)].sort((x, y) => x - y);
}

/** The key at `from` moved to `to` (on a frame, inside the timeline); a key already there gives way. */
export function retimed<T>(keys: readonly Key<T>[], from: number, to: number, a: Animation): readonly Key<T>[] {
  const moving = keys.find((k) => sameTime(k.time, from, a.fps));
  if (!moving) return keys;
  const time = Math.min(a.duration, Math.max(0, frameTime(to, a.fps)));
  return withKey(withoutKey(keys, from, a.fps), time, moving.value, a.fps, moving.ease ?? Ease.Smooth);
}
