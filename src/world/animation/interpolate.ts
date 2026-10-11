import type { Rgb } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import type { Key } from '../../model/scene.types';

/**
 * Smooth key interpolation: cubic Hermite with Catmull-Rom tangents on uneven
 * times, flat at the first and last key so motion eases in and out — unless the
 * timeline loops and the track ends where it began: then it flows through the
 * seam without stopping. Paths
 * (positions) may curve past a key; everything else is held between its two
 * neighbouring keys, so a dial or a colour never overshoots.
 */

const FULL_TURN = 360;
const HALF_TURN = 180;

/** Index of the last key at or before `t` (keys sorted by time, at least one). */
export function segmentAt<T>(keys: readonly Key<T>[], t: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Segment {
  readonly i: number;
  /** 0..1 inside the segment. */
  readonly s: number;
  readonly dt: number;
}

/** The segment `t` falls in, or null when `t` is before the first or after the last key. */
function locate<T>(keys: readonly Key<T>[], t: number): Segment | null {
  if (keys.length < 2 || t <= keys[0].time || t >= keys[keys.length - 1].time) return null;
  const i = segmentAt(keys, t);
  const dt = keys[i + 1].time - keys[i].time;
  return { i, s: dt > 0 ? (t - keys[i].time) / dt : 0, dt };
}

const CLOSED_EPS = 1e-6;

/** Tangent at key i of a scalar channel (value per second). A closed track wraps round at its ends. */
function tangent(times: readonly number[], values: readonly number[], i: number, closed: boolean): number {
  const last = values.length - 1;
  if (i > 0 && i < last) {
    const span = times[i + 1] - times[i - 1];
    return span > 0 ? (values[i + 1] - values[i - 1]) / span : 0;
  }
  if (!closed) return 0;
  const span = times[1] - times[0] + times[last] - times[last - 1];
  return span > 0 ? (values[1] - values[last - 1]) / span : 0;
}

function hermite(p0: number, m0: number, p1: number, m1: number, s: number, dt: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * dt * m0 + (3 * s2 - 2 * s3) * p1 + (s3 - s2) * dt * m1;
}

export interface ChannelOptions {
  /** Hold the value between its two neighbouring keys (no overshoot). */
  readonly bounded?: boolean;
  /** Degrees: each key is taken the short way round from the one before it. */
  readonly angle?: boolean;
  /** The timeline loops: a track that ends on its first value flows through the seam. */
  readonly loop?: boolean;
}

/** Unwraps angles so consecutive keys never differ by more than half a turn. */
function unwrapped(values: readonly number[]): number[] {
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    let v = values[i];
    while (v - out[i - 1] > HALF_TURN) v -= FULL_TURN;
    while (v - out[i - 1] < -HALF_TURN) v += FULL_TURN;
    out.push(v);
  }
  return out;
}

/** One numeric channel of a track at time `t`. */
export function channelAt<T>(keys: readonly Key<T>[], t: number, read: (v: T) => number, opts: ChannelOptions = {}): number {
  const first = read(keys[0].value);
  const seg = locate(keys, t);
  if (!seg) return t <= keys[0].time ? first : read(keys[keys.length - 1].value);
  const raw = keys.map((k) => read(k.value));
  const values = opts.angle ? unwrapped(raw) : raw;
  const times = keys.map((k) => k.time);
  const { i, s, dt } = seg;
  const closed = !!opts.loop && values.length > 2 && Math.abs(values[0] - values[values.length - 1]) < CLOSED_EPS;
  const v = hermite(values[i], tangent(times, values, i, closed), values[i + 1], tangent(times, values, i + 1, closed), s, dt);
  if (!opts.bounded) return v;
  return Math.min(Math.max(values[i], values[i + 1]), Math.max(Math.min(values[i], values[i + 1]), v));
}

export function vec3At<T>(keys: readonly Key<T>[], t: number, read: (v: T) => Vec3, opts: ChannelOptions = {}): Vec3 {
  return [0, 1, 2].map((axis) => channelAt(keys, t, (v) => read(v)[axis], opts)) as unknown as Vec3;
}

export function rgbAt<T>(keys: readonly Key<T>[], t: number, read: (v: T) => Rgb, loop = false): Rgb {
  return vec3At(keys, t, read, { bounded: true, loop });
}

/** Switches (sky mode, stars) take the value of the last key at or before `t`. */
export function stepAt<T, V>(keys: readonly Key<T>[], t: number, read: (v: T) => V): V {
  return read(keys[segmentAt(keys, t)].value);
}
