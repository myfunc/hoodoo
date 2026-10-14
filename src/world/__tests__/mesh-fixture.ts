import { MeshAlpha, type MeshData, type MeshImage } from '../../model/mesh.types';

/** A ridged oil drum (smooth normals, a painted picture) and a grille cut out of a card: test meshes. */
export function drumMesh(segments = 32, rings = 12): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const y = 1 - 2 * v;
    // Two ridges round the drum.
    const radius = 1 + (Math.abs(v - 1 / 3) < 0.03 || Math.abs(v - 2 / 3) < 0.03 ? 0.04 : 0);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, y * 1.4, Math.sin(a) * radius);
      normals.push(Math.cos(a), 0, Math.sin(a));
      uvs.push(s / segments, v);
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const side = indices.length;
  // The lids: a fan each, flat normals, no picture.
  for (const top of [1, -1]) {
    const centre = positions.length / 3;
    positions.push(0, top * 1.4, 0); normals.push(0, top, 0); uvs.push(0.5, 0.5);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a), top * 1.4, Math.sin(a)); normals.push(0, top, 0); uvs.push(0.5, 0.5);
    }
    for (let s = 0; s < segments; s++) indices.push(centre, centre + 1 + s, centre + 2 + s);
  }
  const lids = indices.length - side;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    parts: [{ start: 0, count: side, image: 0 }, { start: side, count: lids, image: -1 }],
    images: [paint(64)],
  };
}

/** A square card with round holes (a grille) whose picture's alpha cuts them out. */
export function grilleMesh(): MeshData {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    parts: [{ start: 0, count: 6, image: 0, alpha: MeshAlpha.Cutout }],
    images: [holes(64, 8)],
  };
}

/** Red paint with a yellow band and dark stripes along v. */
function paint(size: number): MeshImage {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = y / size;
      const band = v > 0.42 && v < 0.58;
      const stripe = Math.abs(v - 0.1) < 0.02 || Math.abs(v - 0.9) < 0.02;
      const c = stripe ? [40, 30, 25] : band ? [235, 190, 40] : [170, 35, 25];
      data.set([...c, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

function holes(size: number, cells: number): MeshImage {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) / size) * cells % 1 - 0.5;
      const fy = ((y + 0.5) / size) * cells % 1 - 0.5;
      data.set([200, 200, 210, Math.hypot(fx, fy) < 0.3 ? 0 : 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}
