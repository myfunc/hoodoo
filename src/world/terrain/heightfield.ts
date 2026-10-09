/** Square heightfield helpers over row-major Float32Array (index = z * res + x). */
export interface Field {
  readonly res: number;
  readonly h: Float32Array;
}

export const field = (res: number, h?: Float32Array): Field => ({ res, h: h ?? new Float32Array(res * res) });

export const clone = (f: Field): Field => ({ res: f.res, h: new Float32Array(f.h) });

export const at = (f: Field, x: number, z: number): number => {
  const cx = Math.min(f.res - 1, Math.max(0, x));
  const cz = Math.min(f.res - 1, Math.max(0, z));
  return f.h[cz * f.res + cx];
};

/** Bilinear sample with u, v in 0..1. */
export function sample(f: Field, u: number, v: number): number {
  const x = u * (f.res - 1);
  const z = v * (f.res - 1);
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const a = at(f, x0, z0) * (1 - tx) + at(f, x0 + 1, z0) * tx;
  const b = at(f, x0, z0 + 1) * (1 - tx) + at(f, x0 + 1, z0 + 1) * tx;
  return a * (1 - tz) + b * tz;
}

export function minMax(f: Field): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f.h) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function normalized(f: Field): Field {
  const [lo, hi] = minMax(f);
  const span = hi - lo;
  const out = field(f.res);
  if (span <= 0) return out;
  for (let i = 0; i < f.h.length; i++) out.h[i] = (f.h[i] - lo) / span;
  return out;
}

export function clamped(f: Field): Field {
  const out = clone(f);
  for (let i = 0; i < out.h.length; i++) out.h[i] = Math.min(1, Math.max(0, out.h[i]));
  return out;
}

export function boxBlur(f: Field): Field {
  const out = field(f.res);
  const n = f.res;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += at(f, x + dx, z + dz);
      out.h[z * n + x] = s / (3 * 3);
    }
  }
  return out;
}

export function resample(f: Field, res: number): Field {
  const out = field(res);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) out.h[z * res + x] = sample(f, x / (res - 1), z / (res - 1));
  }
  return out;
}

/** Distance from the field centre in 0..1 at the edge midpoints, √2 at corners. */
export const radius = (res: number, x: number, z: number): number => {
  const half = (res - 1) / 2;
  return Math.hypot((x - half) / half, (z - half) / half);
};
