import { Rng } from '../../core/rng';

/**
 * Tileable 3D gradient noise baked into a texture: the shader reads one trilinear
 * sample instead of hashing eight lattice corners (faster, and far less code to compile).
 * Same construction as the old GLSL gnoise: gradients in [-1,1]^3, quintic fade.
 */
export const NOISE_SIZE = 64;
/** Lattice cells across the texture; the shader samples at p / NOISE_PERIOD. */
export const NOISE_PERIOD = 16;
const SEED = 1996;
const COMPONENTS = 3;

/** Quintic smoothstep 6t^5 - 15t^4 + 10t^3 (Perlin's improved fade). */
const FADE = { a: 6, b: 15, c: 10 } as const;
const fade = (t: number) => t * t * t * (t * (t * FADE.a - FADE.b) + FADE.c);

let baked: Float32Array | null = null;

/** Baked once per page; both engines upload the same data. */
export function bakeNoise(): Float32Array {
  baked ??= bake();
  return baked;
}

function bake(): Float32Array {
  const rng = new Rng(SEED);
  const grads = new Float32Array(NOISE_PERIOD ** 3 * COMPONENTS);
  for (let i = 0; i < grads.length; i++) grads[i] = rng.next() * 2 - 1;
  const g = (x: number, y: number, z: number) => {
    const wrap = (v: number) => ((v % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    return ((wrap(z) * NOISE_PERIOD + wrap(y)) * NOISE_PERIOD + wrap(x)) * COMPONENTS;
  };
  const out = new Float32Array(NOISE_SIZE ** 3);
  const scale = NOISE_PERIOD / NOISE_SIZE;
  let o = 0;
  for (let z = 0; z < NOISE_SIZE; z++) {
    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        const px = x * scale, py = y * scale, pz = z * scale;
        const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
        const fx = px - ix, fy = py - iy, fz = pz - iz;
        const corner = (dx: number, dy: number, dz: number) => {
          const k = g(ix + dx, iy + dy, iz + dz);
          return grads[k] * (fx - dx) + grads[k + 1] * (fy - dy) + grads[k + 2] * (fz - dz);
        };
        const ux = fade(fx), uy = fade(fy), uz = fade(fz);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        out[o++] = lerp(
          lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), ux), lerp(corner(0, 1, 0), corner(1, 1, 0), ux), uy),
          lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), ux), lerp(corner(0, 1, 1), corner(1, 1, 1), ux), uy),
          uz,
        );
      }
    }
  }
  return out;
}
