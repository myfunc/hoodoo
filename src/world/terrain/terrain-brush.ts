import { type Field, at, clone } from './heightfield';
import { BRUSH } from './terrain-ops.constants';

export enum BrushMode {
  Raise = 'raise',
  Lower = 'lower',
  Smooth = 'smooth',
  Flatten = 'flatten',
}

export interface BrushStroke {
  readonly mode: BrushMode;
  /** Centre in 0..1 field space. */
  readonly u: number;
  readonly v: number;
  /** Radius in 0..1 field space. */
  readonly radius: number;
  /** Height change at the centre per dab, 0..1. */
  readonly strength: number;
  /** Target height for Flatten. */
  readonly level: number;
}

/** One dab of the terrain editor's paint brush with a smooth falloff. */
export function brushDab(f: Field, stroke: BrushStroke): Field {
  const out = clone(f);
  const n = f.res;
  const cx = stroke.u * (n - 1);
  const cz = stroke.v * (n - 1);
  const r = Math.max(1, stroke.radius * (n - 1));
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(n - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r));
  const z1 = Math.min(n - 1, Math.ceil(cz + r));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d >= 1) continue;
      const k = (1 - d * d) ** 2 * stroke.strength;
      const i = z * n + x;
      const h = f.h[i];
      out.h[i] = Math.min(1, Math.max(0, apply(stroke, f, x, z, h, k)));
    }
  }
  return out;
}

function apply(stroke: BrushStroke, f: Field, x: number, z: number, h: number, k: number): number {
  switch (stroke.mode) {
    case BrushMode.Raise:
      return h + k;
    case BrushMode.Lower:
      return h - k;
    case BrushMode.Flatten:
      return h + (stroke.level - h) * Math.min(1, k * BRUSH.smoothMix * 2);
    case BrushMode.Smooth: {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += at(f, x + dx, z + dz);
      return h + (s / (3 * 3) - h) * Math.min(1, k * BRUSH.smoothMix * 2 * 2);
    }
  }
}
