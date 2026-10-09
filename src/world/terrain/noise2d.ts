import { Rng } from '../../core/rng';

const LATTICE = 256;
const LATTICE_MASK = LATTICE - 1;
const OCTAVE_GAIN = 0.5;
const OCTAVE_LACUNARITY = 2;

/** Seeded value noise on a 256-wrap lattice with smoothstep interpolation. */
export class Noise2D {
  private readonly table = new Float32Array(LATTICE * LATTICE);

  constructor(seed: number) {
    const rng = new Rng(seed);
    for (let i = 0; i < this.table.length; i++) this.table[i] = rng.next();
  }

  value(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const v = (i: number, j: number) => this.table[((j & LATTICE_MASK) * LATTICE) + (i & LATTICE_MASK)];
    const a = v(xi, yi) * (1 - sx) + v(xi + 1, yi) * sx;
    const b = v(xi, yi + 1) * (1 - sx) + v(xi + 1, yi + 1) * sx;
    return a * (1 - sy) + b * sy;
  }

  /** Fractal sum normalised to 0..1. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.value(x * freq, y * freq) * amp;
      norm += amp;
      amp *= OCTAVE_GAIN;
      freq *= OCTAVE_LACUNARITY;
    }
    return sum / norm;
  }

  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      const r = 1 - Math.abs(this.value(x * freq, y * freq) * 2 - 1);
      sum += r * r * amp;
      norm += amp;
      amp *= OCTAVE_GAIN;
      freq *= OCTAVE_LACUNARITY;
    }
    return sum / norm;
  }
}
