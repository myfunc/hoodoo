const MULBERRY = { increment: 0x6d2b79f5, shiftA: 15, shiftB: 7, orB: 61, shiftC: 14 } as const;
const UINT32_RANGE = 4294967296;
const MAX_SEED = 0x7fffffff;

/** Deterministic mulberry32 generator so seeds reproduce terrains and stones. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += MULBERRY.increment);
    t = Math.imul(t ^ (t >>> MULBERRY.shiftA), t | 1);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY.shiftB), t | MULBERRY.orB);
    return ((t ^ (t >>> MULBERRY.shiftC)) >>> 0) / UINT32_RANGE;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

export const randomSeed = (): number => Math.floor(Math.random() * MAX_SEED);
