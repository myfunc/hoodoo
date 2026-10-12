import type { Animation, Key } from '../../model/scene.types';
import { ANIMATION_LIMITS } from '../scene.validate';
import { allKeyTimes, frameTime, sameTime } from './keying';

/**
 * The length of the scene. Changing it keeps every key at its time: keys past a
 * shorter end wait there (the timeline shows them greyed) until the scene grows
 * again, or until they are scaled to fit.
 */

/** The shortest step the end marker snaps to; longer scenes snap to coarser ones. */
const LENGTH_STEPS = [0.1, 0.5, 1, 5, 10, 30, 60] as const;
const TENTHS = 10;

/** A length inside the limits, on a tenth of a second. */
export function clampLength(seconds: number): number {
  const { min, max } = ANIMATION_LIMITS.duration;
  return Math.min(max, Math.max(min, Math.round(seconds * TENTHS) / TENTHS));
}

/** The snap step for an end marker drawn at `pxPerSecond`: the finest one at least `minPx` wide. */
export function lengthStep(pxPerSecond: number, minPx: number): number {
  return LENGTH_STEPS.find((s) => s * pxPerSecond >= minPx) ?? LENGTH_STEPS[LENGTH_STEPS.length - 1];
}

/** The timeline with a new length; every key stays where it is. */
export const withLength = (a: Animation, duration: number): Animation => (duration === a.duration ? a : { ...a, duration });

/** The time of the latest key, 0 without keys. */
export const lastKeyTime = (a: Animation): number => allKeyTimes(a).at(-1) ?? 0;

/** Keys that lie past the end (more than half a frame). */
export function keysPastEnd(a: Animation): number {
  const past = (keys: readonly Key<unknown>[]) => keys.filter((k) => k.time > a.duration && !sameTime(k.time, a.duration, a.fps)).length;
  return [a.camera, a.sky, ...Object.values(a.objects), ...Object.values(a.groups ?? {})].reduce((n, keys) => n + past(keys), 0);
}

/** Each key's time times `factor`, on a frame no later than `end`; keys that land on one frame merge into the later one. */
function scaled<T>(keys: readonly Key<T>[], factor: number, end: number, fps: number): readonly Key<T>[] {
  const out: Key<T>[] = [];
  for (const k of keys) {
    const time = Math.min(end, frameTime(k.time * factor, fps));
    if (out.length && sameTime(out[out.length - 1].time, time, fps)) out.pop();
    out.push({ time, value: k.value });
  }
  return out;
}

/** The keys squeezed (or stretched) so the latest one sits on the end; the motion keeps its shape. */
export function withKeysFitted(a: Animation): Animation {
  const last = lastKeyTime(a);
  if (last <= 0 || sameTime(last, a.duration, a.fps)) return a;
  const f = a.duration / last;
  const track = <T>(keys: readonly Key<T>[]) => scaled(keys, f, a.duration, a.fps);
  const tracks = <T>(r: Readonly<Record<string, readonly Key<T>[]>>) => Object.fromEntries(Object.entries(r).map(([id, k]) => [id, track(k)]));
  return {
    ...a,
    camera: track(a.camera),
    sky: track(a.sky),
    objects: tracks(a.objects),
    ...(a.groups ? { groups: tracks(a.groups) } : {}),
  };
}
