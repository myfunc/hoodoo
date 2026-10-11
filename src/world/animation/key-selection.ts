import { type Vec3, add } from '../../core/vec3';
import type { Animation, Key, Transform } from '../../model/scene.types';
import { SelectMode } from '../world.enums';
import { sameTime } from './keying';

/**
 * Selected keys: picked on the motion paths or on the timeline ruler, then moved
 * together or deleted in one step. A selection names keys by track and time, so it
 * outlives redraws; it is session state (EditorStore), never part of undo.
 */

export enum KeyTrack {
  Object = 'object',
  Camera = 'camera',
  Sky = 'sky',
}

/** One key of one track. `id` is the object id, or '' for the camera and the sky. */
export interface KeyRef {
  readonly track: KeyTrack;
  readonly id: string;
  readonly time: number;
}

export const sameKey = (a: KeyRef, b: KeyRef, fps: number): boolean => a.track === b.track && a.id === b.id && sameTime(a.time, b.time, fps);

export const isKeyPicked = (picked: readonly KeyRef[], ref: KeyRef, fps: number): boolean => picked.some((r) => sameKey(r, ref, fps));

function trackKeys(a: Animation, track: KeyTrack, id: string): readonly Key<unknown>[] {
  if (track === KeyTrack.Camera) return a.camera;
  if (track === KeyTrack.Sky) return a.sky;
  return a.objects[id] ?? [];
}

/** The selection after picking `refs`: replacing it, adding to it or toggling each key. */
export function pickKeys(picked: readonly KeyRef[], refs: readonly KeyRef[], mode: SelectMode, fps: number): KeyRef[] {
  const unique = refs.filter((r, i) => !isKeyPicked(refs.slice(0, i), r, fps));
  const out = mode === SelectMode.Replace ? [] : [...picked];
  for (const r of unique) {
    const at = out.findIndex((x) => sameKey(x, r, fps));
    if (at < 0) out.push(r);
    else if (mode === SelectMode.Toggle) out.splice(at, 1);
  }
  return out;
}

const refsOf = (a: Animation, track: KeyTrack, id: string): KeyRef[] => trackKeys(a, track, id).map((k) => ({ track, id, time: k.time }));

/** Every key of the given objects; with none given, of every animated object, the camera and the sky. */
export function allKeyRefs(a: Animation, ids: readonly string[]): KeyRef[] {
  if (ids.length) return ids.flatMap((id) => refsOf(a, KeyTrack.Object, id));
  return [
    ...Object.keys(a.objects).flatMap((id) => refsOf(a, KeyTrack.Object, id)),
    ...refsOf(a, KeyTrack.Camera, ''),
    ...refsOf(a, KeyTrack.Sky, ''),
  ];
}

/** The picked keys that still exist (an undo or a retime may take some away); the same array when all do. */
export function liveKeyRefs(a: Animation, picked: readonly KeyRef[]): readonly KeyRef[] {
  if (!a.enabled) return picked.length ? [] : picked;
  const live = picked.filter((r) => trackKeys(a, r.track, r.id).some((k) => sameTime(k.time, r.time, a.fps)));
  return live.length === picked.length ? picked : live;
}

/** The timeline without the given keys; an object track left empty goes with them. */
export function withoutKeys(a: Animation, refs: readonly KeyRef[]): Animation {
  const keep = <T>(keys: readonly Key<T>[], track: KeyTrack, id: string): readonly Key<T>[] =>
    keys.filter((k) => !isKeyPicked(refs, { track, id, time: k.time }, a.fps));
  const objects: Record<string, readonly Key<Transform>[]> = {};
  for (const [id, keys] of Object.entries(a.objects)) {
    const left = keep(keys, KeyTrack.Object, id);
    if (left.length) objects[id] = left;
  }
  return { ...a, objects, camera: keep(a.camera, KeyTrack.Camera, ''), sky: keep(a.sky, KeyTrack.Sky, '') };
}

/** The timeline with the positions of the given object and camera keys shifted by `delta` (sky keys have none). */
export function withKeysMoved(a: Animation, refs: readonly KeyRef[], delta: Vec3): Animation {
  const shift = <T extends { readonly position: Vec3 }>(keys: readonly Key<T>[], track: KeyTrack, id: string): readonly Key<T>[] =>
    keys.map((k) => (isKeyPicked(refs, { track, id, time: k.time }, a.fps) ? { ...k, value: { ...k.value, position: add(k.value.position, delta) } } : k));
  const objects = Object.fromEntries(Object.entries(a.objects).map(([id, keys]) => [id, shift(keys, KeyTrack.Object, id)]));
  return { ...a, objects, camera: shift(a.camera, KeyTrack.Camera, '') };
}
