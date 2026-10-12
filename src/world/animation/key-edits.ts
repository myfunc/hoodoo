import { Ease } from '../../model/scene.enums';
import type { Animation, Camera, Key, ObjectKey, Sky, Transform } from '../../model/scene.types';
import { type KeyRef, KeyTrack, isKeyPicked } from './key-selection';
import { frameTime, sameTime, withKey } from './keying';
import { PROP_CHANNELS } from './prop-channels';

/**
 * Edits of picked keys from the timeline: moved together in time, given an ease,
 * or a whole track replaced (a value typed into the key inspector). Each returns
 * a new timeline; the caller records it as one undo step.
 */

type TrackFn = <T>(keys: readonly Key<T>[], track: KeyTrack, id: string) => readonly Key<T>[];

/** The timeline with every track passed through `fn`. */
function mapTracks(a: Animation, fn: TrackFn): Animation {
  const table = (all: Readonly<Record<string, readonly Key<Transform>[]>>, track: KeyTrack) =>
    Object.fromEntries(Object.entries(all).map(([id, keys]) => [id, fn(keys, track, id)]));
  return {
    ...a,
    objects: table(a.objects, KeyTrack.Object),
    ...(a.groups ? { groups: table(a.groups, KeyTrack.Group) } : {}),
    camera: fn(a.camera, KeyTrack.Camera, ''),
    sky: fn(a.sky, KeyTrack.Sky, ''),
  };
}

/**
 * The shift the picked keys can make together, on whole frames: none goes before
 * zero or past the end, so they keep their spacing (keys already past the end
 * may only come back).
 */
export function shiftDelta(a: Animation, refs: readonly KeyRef[], delta: number): number {
  if (!refs.length) return 0;
  const times = refs.map((r) => r.time);
  const lo = -Math.min(...times);
  const hi = Math.max(0, a.duration - Math.max(...times));
  return frameTime(Math.min(hi, Math.max(lo, delta)), a.fps);
}

/**
 * READ ME — the merge rule. Picked keys move together by one shift, so they never
 * meet each other; a key that lands on a frame where its track already holds one
 * merges with it rather than dropping it whole: the moved key's values and ease
 * win, and what only the resting key held (an object key's material, light or
 * visibility values) stays on the merged key. Camera, sky and group keys hold
 * every value, so there the moved key takes the frame. Passing over a key on the
 * way changes nothing: a drag is worked out from where it began. One undo step
 * brings the resting key back.
 */
export function mergedObjectKey(resting: ObjectKey, moved: ObjectKey): ObjectKey {
  let out = moved;
  for (const ch of PROP_CHANNELS) {
    const v = ch.inKey(resting);
    if (v !== undefined && ch.inKey(out) === undefined) out = ch.toKey(out, v);
  }
  return out;
}

/** The keys with `k` set down on its frame, merged with a key resting there (the merge rule above). */
function landed<T>(keys: readonly Key<T>[], k: Key<T>, track: KeyTrack, fps: number): readonly Key<T>[] {
  const resting = keys.find((x) => sameTime(x.time, k.time, fps));
  const value = resting && track === KeyTrack.Object ? (mergedObjectKey(resting.value as ObjectKey, k.value as ObjectKey) as T) : k.value;
  return withKey(keys, k.time, value, fps, k.ease ?? Ease.Smooth);
}

/** The picked keys of one track, and the keys that stay where they are while they move (or are copied). */
function split<T>(keys: readonly Key<T>[], refs: readonly KeyRef[], track: KeyTrack, id: string, fps: number, copy: boolean) {
  const moving = keys.filter((k) => isKeyPicked(refs, { track, id, time: k.time }, fps));
  return { moving, resting: copy ? keys : keys.filter((k) => !moving.includes(k)) };
}

/**
 * The picked keys moved by `delta` seconds (from shiftDelta); with `copy` they stay
 * and copies land `delta` away. Where one lands on a key, the two merge (above).
 */
export function withKeysShifted(a: Animation, refs: readonly KeyRef[], delta: number, copy = false): Animation {
  if (!refs.length || sameTime(delta, 0, a.fps)) return a;
  return mapTracks(a, <T>(keys: readonly Key<T>[], track: KeyTrack, id: string) => {
    const { moving, resting } = split(keys, refs, track, id, a.fps, copy);
    if (!moving.length) return keys;
    let out = resting;
    for (const k of moving) out = landed(out, { ...k, time: frameTime(k.time + delta, a.fps) }, track, a.fps);
    return out;
  });
}

/** How many of the picked keys would land on a key that is already there, moved (or copied) by `delta`. */
export function landings(a: Animation, refs: readonly KeyRef[], delta: number, copy = false): number {
  if (!refs.length || sameTime(delta, 0, a.fps)) return 0;
  const tracks = [
    ...Object.entries(a.objects).map(([id, keys]) => ({ track: KeyTrack.Object, id, keys })),
    ...Object.entries(a.groups ?? {}).map(([id, keys]) => ({ track: KeyTrack.Group, id, keys })),
    { track: KeyTrack.Camera, id: '', keys: a.camera as readonly Key<unknown>[] },
    { track: KeyTrack.Sky, id: '', keys: a.sky as readonly Key<unknown>[] },
  ];
  return tracks.reduce((n, { track, id, keys }) => {
    const { moving, resting } = split<unknown>(keys, refs, track, id, a.fps, copy);
    return n + moving.filter((k) => resting.some((r) => sameTime(r.time, k.time + delta, a.fps))).length;
  }, 0);
}

/** The picked refs after a shift by `delta`. */
export const shiftedRefs = (refs: readonly KeyRef[], delta: number, fps: number): KeyRef[] =>
  refs.map((r) => ({ ...r, time: frameTime(r.time + delta, fps) }));

/** A key with this ease; Smooth, the default, is not written down. */
export function withEase<T>(k: Key<T>, ease: Ease): Key<T> {
  const { ease: _old, ...rest } = k;
  return ease === Ease.Smooth ? rest : { ...rest, ease };
}

/** The picked keys with this ease. */
export function withKeysEased(a: Animation, refs: readonly KeyRef[], ease: Ease): Animation {
  if (!refs.length) return a;
  return mapTracks(a, <T>(keys: readonly Key<T>[], track: KeyTrack, id: string) =>
    keys.some((k) => isKeyPicked(refs, { track, id, time: k.time }, a.fps))
      ? keys.map((k) => (isKeyPicked(refs, { track, id, time: k.time }, a.fps) ? withEase(k, ease) : k))
      : keys);
}

/** The ease the picked keys share, or null when they differ (or none is picked). */
export function sharedEase(a: Animation, refs: readonly KeyRef[], keysOf: (r: KeyRef) => readonly Key<unknown>[]): Ease | null {
  const eases = new Set(refs.map((r) => keysOf(r).find((k) => sameTime(k.time, r.time, a.fps))?.ease ?? Ease.Smooth));
  return eases.size === 1 ? [...eases][0] : null;
}

/** The timeline with one track replaced; an object or group track left empty goes. */
export function withTrack(a: Animation, track: KeyTrack, id: string, keys: readonly Key<unknown>[]): Animation {
  if (track === KeyTrack.Camera) return { ...a, camera: keys as readonly Key<Camera>[] };
  if (track === KeyTrack.Sky) return { ...a, sky: keys as readonly Key<Sky>[] };
  const name = track === KeyTrack.Group ? 'groups' : 'objects';
  const table: Record<string, readonly Key<Transform>[]> = { ...(a[name] ?? {}) };
  if (keys.length) table[id] = keys as readonly Key<Transform>[];
  else delete table[id];
  return { ...a, [name]: table };
}
