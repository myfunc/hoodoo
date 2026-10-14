import { type Vec3, add, cross, normalize, scale, sub } from '../../../core/vec3';
import type { SourceMesh } from '../../../io/source/source.types';

/**
 * READ ME — simple solids for Sandbox's own guns (own-guns.ts), built straight
 * into Source mesh form: positions and normals in the model's space (inches;
 * X forward, Y left, Z up), each vertex bound wholly to one bone, a material
 * slot per mesh. Prisms run along an axis between two points, with a radius at
 * each end (a cone or a tapered body), turned by `twist` around that axis.
 */

const FULL_TURN = Math.PI * 2;
const BONES_PER_VERTEX = 3;
/** A side vector when the axis runs along Z. */
const ALT_UP: Vec3 = [1, 0, 0];
const UP: Vec3 = [0, 0, 1];
const PARALLEL = 0.99;
const MIN_LENGTH = 1e-6;

interface Part {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

/** Collects solids per material slot and bone, then hands out one mesh per pair. */
export class MeshBuilder {
  private readonly parts = new Map<string, Part & { readonly slot: number; readonly bone: number }>();

  /** A box from its centre, half sizes along its own axes (forward, left, up), turned into `axes`. */
  box(slot: number, bone: number, centre: Vec3, half: Vec3, axes: readonly [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]): this {
    const p = this.part(slot, bone);
    const at = (x: number, y: number, z: number): Vec3 => add(centre, add(add(scale(axes[0], x * half[0]), scale(axes[1], y * half[1])), scale(axes[2], z * half[2])));
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        const n = scale(axes[axis], sign);
        const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
        const corner = (a: number, b: number): Vec3 => {
          const c: [number, number, number] = [0, 0, 0];
          c[axis] = sign;
          c[u] = a;
          c[v] = b;
          return at(c[0], c[1], c[2]);
        };
        const quad = sign > 0 ? [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] : [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];
        quadInto(p, quad, n);
      }
    }
    return this;
  }

  /** A prism of `sides` from `a` to `b`, radius `ra` at a and `rb` at b, capped at both ends. */
  prism(slot: number, bone: number, a: Vec3, b: Vec3, ra: number, rb: number, sides: number, twist = 0): this {
    const p = this.part(slot, bone);
    const axis = normalize(sub(b, a));
    const side = normalize(cross(Math.abs(axis[2]) > PARALLEL ? ALT_UP : UP, axis));
    const up = cross(axis, side);
    const ring = (centre: Vec3, r: number) => Array.from({ length: sides }, (_, i) => {
      const t = twist + (i / sides) * FULL_TURN;
      return add(centre, add(scale(side, Math.cos(t) * r), scale(up, Math.sin(t) * r)));
    });
    const [ringA, ringB] = [ring(a, ra), ring(b, rb)];
    const slope = (ra - rb) / Math.max(MIN_LENGTH, Math.hypot(...sub(b, a)));
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const mid = twist + ((i + 0.5) / sides) * FULL_TURN;
      const out = normalize(add(add(scale(side, Math.cos(mid)), scale(up, Math.sin(mid))), scale(axis, slope)));
      quadInto(p, [ringA[i], ringA[j], ringB[j], ringB[i]], out);
    }
    if (ra > 0) fanInto(p, a, [...ringA].reverse(), scale(axis, -1));
    if (rb > 0) fanInto(p, b, ringB, axis);
    return this;
  }

  /** A sphere (UV sphere, smooth normals). */
  sphere(slot: number, bone: number, centre: Vec3, r: number, segments: number): this {
    const p = this.part(slot, bone);
    const base = p.positions.length / 3;
    const rows = Math.max(2, Math.round(segments / 2));
    for (let y = 0; y <= rows; y++) {
      const v = (y / rows) * Math.PI;
      for (let x = 0; x <= segments; x++) {
        const u = (x / segments) * FULL_TURN;
        const n: Vec3 = [Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u), Math.cos(v)];
        vertexInto(p, add(centre, scale(n, r)), n, x / segments, y / rows);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < segments; x++) {
        const i = base + y * (segments + 1) + x;
        const k = i + segments + 1;
        p.indices.push(i, k, i + 1, i + 1, k, k + 1);
      }
    }
    return this;
  }

  /** A ring (torus) around `axis` through `centre`: radius `r`, tube radius `tube`. */
  ring(slot: number, bone: number, centre: Vec3, axis: Vec3, r: number, tube: number, segments: number, tubeSides: number): this {
    const p = this.part(slot, bone);
    const ax = normalize(axis);
    const side = normalize(cross(Math.abs(ax[2]) > PARALLEL ? ALT_UP : UP, ax));
    const up = cross(ax, side);
    const base = p.positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * FULL_TURN;
      const dir = add(scale(side, Math.cos(t)), scale(up, Math.sin(t)));
      for (let j = 0; j <= tubeSides; j++) {
        const s = (j / tubeSides) * FULL_TURN;
        const n = normalize(add(scale(dir, Math.cos(s)), scale(ax, Math.sin(s))));
        vertexInto(p, add(add(centre, scale(dir, r)), scale(n, tube)), n, i / segments, j / tubeSides);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < tubeSides; j++) {
        const a = base + i * (tubeSides + 1) + j;
        const b = a + tubeSides + 1;
        p.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return this;
  }

  /** A flat quad, corners in order (counter-clockwise seen from the front), its texture's u along the first edge. */
  quad(slot: number, bone: number, corners: readonly [Vec3, Vec3, Vec3, Vec3]): this {
    const p = this.part(slot, bone);
    const n = normalize(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0])));
    quadInto(p, corners, n);
    return this;
  }

  meshes(): SourceMesh[] {
    return [...this.parts.values()].map((p) => {
      const count = p.positions.length / 3;
      const bones = new Uint8Array(count * BONES_PER_VERTEX);
      const weights = new Float32Array(count * BONES_PER_VERTEX);
      for (let v = 0; v < count; v++) {
        bones[v * BONES_PER_VERTEX] = p.bone;
        weights[v * BONES_PER_VERTEX] = 1;
      }
      return {
        bodyPart: 0, model: 0, material: p.slot,
        positions: Float32Array.from(p.positions), normals: Float32Array.from(p.normals), tangents: new Float32Array(0),
        uvs: Float32Array.from(p.uvs), bones, weights, indices: Uint32Array.from(p.indices),
      };
    });
  }

  private part(slot: number, bone: number): Part {
    const key = `${slot}:${bone}`;
    let p = this.parts.get(key);
    if (!p) {
      p = { slot, bone, positions: [], normals: [], uvs: [], indices: [] };
      this.parts.set(key, p);
    }
    return p;
  }
}

function vertexInto(p: Part, pos: Vec3, n: Vec3, u: number, v: number): void {
  p.positions.push(pos[0], pos[1], pos[2]);
  p.normals.push(n[0], n[1], n[2]);
  p.uvs.push(u, v);
}

/** A flat quad; uv (0,0) at the first corner, u along the first edge. */
function quadInto(p: Part, q: readonly Vec3[], n: Vec3): void {
  const base = p.positions.length / 3;
  const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
  q.forEach((c, i) => vertexInto(p, c, n, uv[i][0], uv[i][1]));
  p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function fanInto(p: Part, centre: Vec3, ring: readonly Vec3[], n: Vec3): void {
  const base = p.positions.length / 3;
  vertexInto(p, centre, n, 0.5, 0.5);
  ring.forEach((c) => vertexInto(p, c, n, 0.5, 0.5));
  for (let i = 0; i < ring.length; i++) p.indices.push(base, base + 1 + i, base + 1 + ((i + 1) % ring.length));
}
