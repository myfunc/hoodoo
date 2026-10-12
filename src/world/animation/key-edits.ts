import { Ease } from '../../model/scene.enums';
import type { Animation, Camera, Key, Sky, Transform } from '../../model/scene.types';
import { type KeyRef, KeyTrack, isKeyPicked } from './key-selection';
import { frameTime, sameTime, withKey } from './keying';

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

/** The picked keys moved by `delta` seconds (from shiftDelta); a key already where one lands gives way. */
export function withKeysShifted(a: Animation, refs: readonly KeyRef[], delta: number): Animation {
  if (!refs.length || sameTime(delta, 0, a.fps)) return a;
  return mapTracks(a, <T>(keys: readonly Key<T>[], track: KeyTrack, id: string) => {
    const moving = keys.filter((k) => isKeyPicked(refs, { track, id, time: k.time }, a.fps));
    if (!moving.length) return keys;
    let out: readonly Key<T>[] = keys.filter((k) => !moving.includes(k));
    for (const k of moving) out = withKey(out, frameTime(k.time + delta, a.fps), k.value, a.fps, k.ease ?? Ease.Smooth);
    return out;
  });
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
