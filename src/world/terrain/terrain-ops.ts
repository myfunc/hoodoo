import { Rng } from '../../core/rng';
import { TerrainOp } from '../../model/scene.enums';
import { type Field, at, boxBlur, clamped, clone, field, minMax, normalized, radius } from './heightfield';
import { Noise2D } from './noise2d';
import {
  AMOUNT_MAX, CANYON, CRATER, ERODE, FRACTAL, ISLAND, MESA, MOUNDS, PLATEAUS, RAISE, RIDGES, SHARPEN, SMOOTH, SPIKES,
} from './terrain-ops.constants';

/** One terrain editor operation: a pure function of the field, the dial amount and a seed. */
type Operation = (f: Field, a: number, seed: number) => Field;

const unit = (amount: number): number => Math.min(1, Math.max(0, amount / AMOUNT_MAX));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function addNoise(f: Field, a: number, seed: number, ridged: boolean): Field {
  const noise = new Noise2D(seed);
  const cfg = ridged ? RIDGES : FRACTAL;
  const out = clone(f);
  for (let z = 0; z < f.res; z++) {
    for (let x = 0; x < f.res; x++) {
      const u = (x / f.res) * cfg.baseFrequency;
      const v = (z / f.res) * cfg.baseFrequency;
      const n = ridged ? noise.ridged(u, v, cfg.octaves) : noise.fbm(u, v, cfg.octaves);
      out.h[z * f.res + x] += (n - 0.5) * unit(a);
    }
  }
  return out;
}

/** Thermal erosion: material slides to the lowest neighbour while the slope exceeds the talus. */
function erode(f: Field, a: number): Field {
  let cur = clone(f);
  const n = f.res;
  const iterations = Math.round(unit(a) * ERODE.maxIterations);
  for (let it = 0; it < iterations; it++) {
    const next = clone(cur);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const h = at(cur, x, z);
        let lowest = h;
        let lx = x;
        let lz = z;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nh = at(cur, x + dx, z + dz);
            if (nh < lowest) { lowest = nh; lx = x + dx; lz = z + dz; }
          }
        }
        const diff = h - lowest;
        if (diff > ERODE.talus && lx >= 0 && lz >= 0 && lx < n && lz < n) {
          const move = (diff - ERODE.talus) * ERODE.carry * (1 / 2);
          next.h[z * n + x] -= move;
          next.h[lz * n + lx] += move;
        }
      }
    }
    const rain = boxBlur(next);
    for (let i = 0; i < next.h.length; i++) next.h[i] += (rain.h[i] - next.h[i]) * ERODE.rainSmooth * unit(a);
    cur = next;
  }
  return cur;
}

function smooth(f: Field, a: number): Field {
  let cur = f;
  const passes = Math.max(1, Math.round(unit(a) * SMOOTH.maxPasses));
  for (let i = 0; i < passes; i++) cur = boxBlur(cur);
  return cur;
}

function sharpen(f: Field, a: number): Field {
  const blur = boxBlur(f);
  const out = clone(f);
  const gain = unit(a) * SHARPEN.maxGain;
  for (let i = 0; i < out.h.length; i++) out.h[i] += (f.h[i] - blur.h[i]) * gain;
  return out;
}

function stamp(f: Field, count: number, seed: number, shape: (rng: Rng) => { r: number; peak: number; sharp: boolean }): Field {
  const rng = new Rng(seed);
  const out = clone(f);
  const n = f.res;
  for (let i = 0; i < count; i++) {
    const cx = rng.next();
    const cz = rng.next();
    const { r, peak, sharp } = shape(rng);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x / (n - 1) - cx, z / (n - 1) - cz) / r;
        if (d >= 1) continue;
        const k = sharp ? 1 - d : (1 - d * d) * (1 - d * d);
        out.h[z * n + x] += peak * k;
      }
    }
  }
  return out;
}

const spikes: Operation = (f, a, seed) =>
  stamp(f, Math.round(unit(a) * SPIKES.maxCount), seed, (rng) => ({
    r: rng.range(SPIKES.minRadius, SPIKES.maxRadius),
    peak: rng.range(SPIKES.minHeight, 1),
    sharp: true,
  }));

const mounds: Operation = (f, a, seed) =>
  stamp(f, Math.round(unit(a) * MOUNDS.maxCount), seed, (rng) => ({
    r: rng.range(MOUNDS.minRadius, MOUNDS.maxRadius),
    peak: rng.range(0, MOUNDS.height),
    sharp: false,
  }));

function plateaus(f: Field, a: number): Field {
  const src = normalized(f);
  const levels = Math.round(PLATEAUS.minLevels + (1 - unit(a)) * (PLATEAUS.maxLevels - PLATEAUS.minLevels));
  const out = field(f.res);
  for (let i = 0; i < src.h.length; i++) {
    const s = src.h[i] * levels;
    const base = Math.floor(s);
    const frac = smoothstep(1 - PLATEAUS.softness, 1, s - base);
    out.h[i] = (base + frac) / levels;
  }
  return out;
}

function shift(sign: number): Operation {
  return (f, a) => {
    const out = clone(f);
    for (let i = 0; i < out.h.length; i++) out.h[i] += sign * unit(a) * RAISE.maxStep;
    return clamped(out);
  };
}

function clip(f: Field, a: number): Field {
  const src = normalized(f);
  const top = 1 - unit(a) * (1 / 2);
  for (let i = 0; i < src.h.length; i++) src.h[i] = Math.min(src.h[i], top);
  return src;
}

function mesa(f: Field, a: number): Field {
  const src = normalized(f);
  const w = MESA.maxWidth - unit(a) * (MESA.maxWidth - MESA.minWidth);
  for (let i = 0; i < src.h.length; i++) src.h[i] = smoothstep(MESA.threshold - w, MESA.threshold + w, src.h[i]);
  return src;
}

function canyon(f: Field, a: number, seed: number): Field {
  const noise = new Noise2D(seed);
  const out = normalized(f);
  const n = f.res;
  const width = CANYON.maxWidth - unit(a) * (CANYON.maxWidth - CANYON.minWidth);
  for (let z = 0; z < n; z++) {
    const v = z / (n - 1);
    const centre = 0.5 + CANYON.meander * Math.sin(v * Math.PI * CANYON.waves) + (noise.fbm(v * CANYON.wobble, 0, 3) - 0.5) * CANYON.meander;
    for (let x = 0; x < n; x++) {
      const d = Math.abs(x / (n - 1) - centre);
      const wall = smoothstep(width * (1 / 2), width, d);
      out.h[z * n + x] = out.h[z * n + x] * (1 / 2) + (1 / 2) * wall * (out.h[z * n + x] * (1 / 2) + (1 / 2));
    }
  }
  return out;
}

function radial(f: Field, a: number, profile: (r: number) => number): Field {
  const out = clone(f);
  for (let z = 0; z < f.res; z++) {
    for (let x = 0; x < f.res; x++) out.h[z * f.res + x] += unit(a) * profile(radius(f.res, x, z));
  }
  return out;
}

const cone: Operation = (f, a) => radial(f, a, (r) => Math.max(0, 1 - r));

const crater: Operation = (f, a) =>
  radial(f, a, (r) => {
    const bowl = r < CRATER.radius ? -(1 - (r / CRATER.radius) ** 2) : 0;
    const rim = Math.exp(-(((r - CRATER.radius) / CRATER.rim) ** 2)) * CRATER.rim * 2;
    return bowl + rim;
  });

function island(f: Field, a: number): Field {
  const out = clone(f);
  const inner = ISLAND.edge * (1 - unit(a));
  const [lo] = minMax(f);
  for (let z = 0; z < f.res; z++) {
    for (let x = 0; x < f.res; x++) {
      const k = 1 - smoothstep(inner, ISLAND.edge, radius(f.res, x, z));
      const i = z * f.res + x;
      out.h[i] = lo + (out.h[i] - lo) * k;
    }
  }
  return out;
}

function flatten(f: Field, a: number): Field {
  const out = clone(f);
  const mean = f.h.reduce((s, v) => s + v, 0) / f.h.length;
  for (let i = 0; i < out.h.length; i++) out.h[i] += (mean - out.h[i]) * unit(a);
  return out;
}

function invert(f: Field): Field {
  const src = normalized(f);
  for (let i = 0; i < src.h.length; i++) src.h[i] = 1 - src.h[i];
  return src;
}

const OPERATIONS: Readonly<Record<TerrainOp, Operation>> = {
  [TerrainOp.Fractal]: (f, a, s) => addNoise(f, a, s, false),
  [TerrainOp.Ridges]: (f, a, s) => addNoise(f, a, s, true),
  [TerrainOp.Erode]: erode,
  [TerrainOp.Smooth]: smooth,
  [TerrainOp.Sharpen]: sharpen,
  [TerrainOp.Invert]: invert,
  [TerrainOp.Spikes]: spikes,
  [TerrainOp.Mounds]: mounds,
  [TerrainOp.Plateaus]: plateaus,
  [TerrainOp.Raise]: shift(1),
  [TerrainOp.Lower]: shift(-1),
  [TerrainOp.Clip]: clip,
  [TerrainOp.Mesa]: mesa,
  [TerrainOp.Canyon]: canyon,
  [TerrainOp.Crater]: crater,
  [TerrainOp.Cone]: cone,
  [TerrainOp.Flatten]: flatten,
  [TerrainOp.Normalize]: (f) => normalized(f),
  [TerrainOp.Island]: island,
};

/** Applies one operation; a result that leaves 0..1 is rescaled back into it, keeping its shape. */
export function applyTerrainOp(f: Field, op: TerrainOp, amount: number, seed: number): Field {
  const out = OPERATIONS[op](f, amount, seed);
  const [lo, hi] = minMax(out);
  return lo < 0 || hi > 1 ? normalized(out) : out;
}
