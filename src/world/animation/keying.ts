import type { Animation, Key, Scene, SceneObject } from '../../model/scene.types';

/**
 * Auto-key, as in Bryce 3D: change something with the playhead past zero and
 * the change becomes a key at that frame. A first change of a still object also
 * keys where it was at zero, so it moves from there. At zero, a still object is
 * simply edited. The camera is keyed once its track exists (Key Camera), so
 * looking around never starts a camera move by accident. With animation off
 * nothing is keyed.
 */

/** Key times sit on frames: two keys closer than half a frame are the same key. */
export const frameTime = (t: number, fps: number): number => Math.round(t * fps) / fps;

const sameTime = (a: number, b: number, fps: number): boolean => Math.abs(a - b) < 0.5 / fps;

/** The keys with `value` set at `time`, replacing a key on the same frame. */
export function withKey<T>(keys: readonly Key<T>[], time: number, value: T, fps: number): Key<T>[] {
  const rest = keys.filter((k) => !sameTime(k.time, time, fps));
  return [...rest, { time, value }].sort((a, b) => a.time - b.time);
}

export function withoutKey<T>(keys: readonly Key<T>[], time: number, fps: number): Key<T>[] {
  return keys.filter((k) => !sameTime(k.time, time, fps));
}

export const hasKeyAt = <T>(keys: readonly Key<T>[], time: number, fps: number): boolean => keys.some((k) => sameTime(k.time, time, fps));

/** A track after its value changed from `before` to `after` at `time`; empty when nothing should be keyed. */
function autoKeyed<T>(keys: readonly Key<T>[], time: number, before: T, after: T, fps: number): readonly Key<T>[] {
  if (keys.length) return withKey(keys, time, after, fps);
  if (time <= 0.5 / fps) return keys;
  return withKey([{ time: 0, value: before }], time, after, fps);
}

const sameTransform = (a: SceneObject, b: SceneObject): boolean => a.transform === b.transform || JSON.stringify(a.transform) === JSON.stringify(b.transform);

/** Tracks of objects that are gone are dropped with them. */
function prunedObjects(a: Animation, alive: ReadonlySet<string>): Animation['objects'] {
  const ids = Object.keys(a.objects);
  if (ids.every((id) => alive.has(id))) return a.objects;
  return Object.fromEntries(ids.filter((id) => alive.has(id)).map((id) => [id, a.objects[id]]));
}

/** The edited scene with auto-keys recorded at `time`; with animation off only the tracks of deleted objects go. */
export function recordKeys(before: Scene, after: Scene, time: number): Scene {
  const a = after.animation;
  let objects = prunedObjects(a, new Set(after.objects.map((o) => o.id)));
  if (!a.enabled) return objects === a.objects ? after : { ...after, animation: { ...a, objects } };
  const t = frameTime(time, a.fps);
  const prior = new Map(before.objects.map((o) => [o.id, o]));
  for (const o of after.objects) {
    const old = prior.get(o.id);
    if (!old || sameTransform(old, o)) continue;
    const keys = autoKeyed(objects[o.id] ?? [], t, old.transform, o.transform, a.fps);
    if (keys.length) objects = { ...objects, [o.id]: keys };
  }
  const camera = a.camera.length && before.camera !== after.camera ? withKey(a.camera, t, after.camera, a.fps) : a.camera;
  const sky = before.sky !== after.sky ? autoKeyed(a.sky, t, before.sky, after.sky, a.fps) : a.sky;
  if (objects === a.objects && camera === a.camera && sky === a.sky) return after;
  return { ...after, animation: { ...a, objects, camera, sky } };
}

/** Every key time of the animation, for the timeline's "next / previous key". */
export function allKeyTimes(a: Animation): number[] {
  const times = [...a.camera, ...a.sky, ...Object.values(a.objects).flat()].map((k) => k.time);
  return [...new Set(times)].sort((x, y) => x - y);
}

/** Keys past a new, shorter duration move onto its end. */
export function withDuration(a: Animation, duration: number): Animation {
  const clip = <T>(keys: readonly Key<T>[]): readonly Key<T>[] => {
    if (keys.every((k) => k.time <= duration)) return keys;
    const inside = keys.filter((k) => k.time < duration);
    const last = keys.filter((k) => k.time >= duration).at(-1);
    return last ? [...inside, { time: duration, value: last.value }] : inside;
  };
  return {
    ...a,
    duration,
    camera: clip(a.camera),
    sky: clip(a.sky),
    objects: Object.fromEntries(Object.entries(a.objects).map(([id, k]) => [id, clip(k)])),
  };
}

/** The key at `from` moved to `to` (on a frame, inside the timeline); a key already there gives way. */
export function retimed<T>(keys: readonly Key<T>[], from: number, to: number, a: Animation): readonly Key<T>[] {
  const moving = keys.find((k) => sameTime(k.time, from, a.fps));
  if (!moving) return keys;
  const time = Math.min(a.duration, Math.max(0, frameTime(to, a.fps)));
  return withKey(withoutKey(keys, from, a.fps), time, moving.value, a.fps);
}
