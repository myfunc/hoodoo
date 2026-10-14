import { describe, expect, it } from 'vitest';
import { meshEntry, registerMesh, unregisterMesh } from '../../assets/mesh-library';
import { ShapeKind } from '../../model/scene.enums';
import { BVH_NODE_FLOATS, meshBvh } from '../mesh-bvh';
import { meshObject } from '../objects.factory';
import { raycast } from '../raycast';
import { emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { drumMesh } from './mesh-fixture';

describe('mesh library', () => {
  it('fits a mesh to the unit box and keeps its own size and centre', () => {
    const shifted = drumMesh();
    const positions = shifted.positions.map((v, i) => (i % 3 === 1 ? v * 10 + 5 : v));
    const e = registerMesh('test:tall', { ...shifted, positions });
    expect(e.half[1]).toBeCloseTo(14);
    expect(e.centre[1]).toBeCloseTo(5);
    expect(Math.max(...e.data.positions)).toBeCloseTo(1);
    expect(Math.min(...e.data.positions)).toBeCloseTo(-1);
    // A lid's normal stays straight up; the sides' stay level.
    const n = e.data.normals!;
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1);
    unregisterMesh('test:tall');
    expect(meshEntry('test:tall')).toBeUndefined();
  });

  it('refuses arrays that do not fit together', () => {
    const d = drumMesh();
    expect(() => registerMesh('bad', { ...d, indices: new Uint32Array([0, 1]) })).toThrow();
    expect(() => registerMesh('bad', { ...d, indices: new Uint32Array([0, 1, 1e6]) })).toThrow();
    expect(() => registerMesh('bad', { ...d, parts: [{ start: 0, count: 3, image: 5 }] })).toThrow();
  });
});

describe('mesh BVH', () => {
  const e = registerMesh('test:drum', drumMesh());

  it('holds every triangle once, inside boxes nested in their parents', () => {
    const { nodes, order } = meshBvh(e);
    expect([...order].sort((a, b) => a - b)).toEqual([...Array(e.triangles).keys()]);
    const seen: number[] = [];
    const walk = (node: number, parent: Float32Array | null) => {
      const box = nodes.subarray(node * BVH_NODE_FLOATS, (node + 1) * BVH_NODE_FLOATS);
      if (parent) for (let a = 0; a < 3; a++) {
        expect(box[a]).toBeGreaterThanOrEqual(parent[a] - 1e-6);
        expect(box[4 + a]).toBeLessThanOrEqual(parent[4 + a] + 1e-6);
      }
      if (box[7] > 0) for (let i = box[3]; i < box[3] + box[7]; i++) seen.push(order[i]);
      else { walk(box[3], box); walk(box[3] + 1, box); }
    };
    walk(0, null);
    expect(seen.length).toBe(e.triangles);
  });

  it('picks the drum where its side is, past its box corner', () => {
    const scene = { ...emptyScene(), objects: [meshObject(e, { position: [0, 0, 0] })] };
    const hit = raycast(scene, [0, 0, 10], [0, 0, -1], { includePlanes: false, includeLights: false });
    expect(hit?.t).toBeGreaterThan(8.9);
    expect(hit?.t).toBeLessThan(9.05);
    // Through the box's corner, outside the round side: a box would be hit, the drum is not.
    expect(raycast(scene, [1.02, 0, 10], [0, 0, -1], { includePlanes: false, includeLights: false })).toBeNull();
  });
});

describe('mesh objects', () => {
  const drum = registerMesh('test:drum', drumMesh());

  it('keeps a mesh object’s key through a file', () => {
    const scene = { ...emptyScene(), objects: [meshObject(drum)] };
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.objects[0].kind).toBe(ShapeKind.Mesh);
    expect(back.objects[0].mesh).toBe('test:drum');
  });
});
