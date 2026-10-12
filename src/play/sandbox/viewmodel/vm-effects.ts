import { type Vec3, add, cross, length, normalize, scale, sub } from '../../../core/vec3';
import { SPRITE_STRIDE } from './vm-gpu';

/**
 * Vertex lists for Source's additive effects, in GPU view space (the eye at the
 * origin looking down −z): sprites that face the viewer and beams drawn as a
 * ribbon along a quadratic curve (Source's DrawBeamQuadratic: 16 segments, the
 * texture scrolling along the beam, both ends faded to black).
 */

export type Rgba = readonly [number, number, number, number];

const BEAM_SEGMENTS = 16;
const QUAD_VERTICES = 6;
/** Corners of a quad as two triangles: (u, v) pairs. */
const QUAD: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
const MIN_LENGTH = 1e-6;

/** Collects vertices for one texture's draw call. */
export class SpriteBatch {
  private data: number[] = [];

  get vertices(): Float32Array {
    return Float32Array.from(this.data);
  }

  clear(): void {
    this.data = [];
  }

  private vertex(p: Vec3, u: number, v: number, c: Rgba): void {
    this.data.push(p[0], p[1], p[2], u, v, c[0], c[1], c[2], c[3]);
  }

  /** A square facing the viewer at `centre`, `size` across (Source sprite scale × texture size), turned by `roll` radians. */
  sprite(centre: Vec3, size: number, color: Rgba, roll = 0): void {
    const h = size / 2;
    const [c, s] = [Math.cos(roll) * h, Math.sin(roll) * h];
    for (const [u, v] of QUAD) {
      const [x, y] = [u * 2 - 1, v * 2 - 1];
      this.vertex([centre[0] + x * c - y * s, centre[1] + x * s + y * c, centre[2]], u, v, color);
    }
  }

  /**
   * A beam along the quadratic curve start → control → end, `width` across,
   * facing the viewer; the texture's v runs along it from `scroll`.
   */
  quadraticBeam(start: Vec3, control: Vec3, end: Vec3, width: number, color: Rgba, scroll: number): void {
    const points: Vec3[] = [];
    for (let i = 0; i <= BEAM_SEGMENTS; i++) {
      const t = i / BEAM_SEGMENTS;
      const k = 1 - t;
      points.push(add(add(scale(start, k * k), scale(control, 2 * t * k)), scale(end, t * t)));
    }
    const sides = points.map((p, i) => {
      const along = sub(points[Math.min(i + 1, BEAM_SEGMENTS)], points[Math.max(i - 1, 0)]);
      const side = cross(along, p);
      return length(side) < MIN_LENGTH ? ([0, 0, 0] as Vec3) : scale(normalize(side), width / 2);
    });
    const u = scroll - Math.floor(scroll);
    for (let i = 0; i < BEAM_SEGMENTS; i++) {
      const [a, b] = [i, i + 1];
      const ends = (j: number): Rgba => (j === 0 || j === BEAM_SEGMENTS ? [0, 0, 0, color[3]] : color);
      const va = u - a / BEAM_SEGMENTS;
      const vb = u - b / BEAM_SEGMENTS;
      const corners: [Vec3, number, number, Rgba][] = [
        [add(points[a], sides[a]), 0, va, ends(a)], [sub(points[a], sides[a]), 1, va, ends(a)], [sub(points[b], sides[b]), 1, vb, ends(b)],
        [add(points[a], sides[a]), 0, va, ends(a)], [sub(points[b], sides[b]), 1, vb, ends(b)], [add(points[b], sides[b]), 0, vb, ends(b)],
      ];
      for (const [p, cu, cv, col] of corners) this.vertex(p, cu, cv, col);
    }
  }

  get count(): number {
    return this.data.length / SPRITE_STRIDE;
  }
}

/** Vertices per sprite, for sizing. */
export const SPRITE_VERTICES = QUAD_VERTICES;
