import { describe, expect, it } from 'vitest';
import { registerMesh } from '../../assets/mesh-library';
import { ShapeKind } from '../../model/scene.enums';
import { meshObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { drumMesh, grilleMesh } from '../../world/__tests__/mesh-fixture';
import { MESH_ALPHA_STEP, MESH_TRI_TEXELS, packMeshes, texelDensity } from '../gpu/mesh-pack';
import { OBJ_TEXELS, TEXEL_FLOATS } from '../gpu/render.constants';
import { packScene } from '../gpu/scene-packer';
import { meshLines } from '../wire/mesh-wire';

/** The header texel of an object row (kind, boolean, group, flags) and its params (layer, shape param, ...). */
const HEADER = 3;
const PARAMS = 4;

describe('mesh packing', () => {
  const drum = registerMesh('test:drum', drumMesh());
  const grille = registerMesh('test:grille', grilleMesh());

  it('writes a header per mesh and each triangle with its picture code', () => {
    const p = packMeshes([drum, grille]);
    expect(p.slots.get('test:drum')).toBe(0);
    expect(p.slots.get('test:grille')).toBe(1);
    expect(p.layers).toBe(2);
    const head = (i: number) => p.data.subarray(i * TEXEL_FLOATS, (i + 1) * TEXEL_FLOATS);
    // The grille's two triangles wear layer 1, cut out.
    const triBase = head(1)[1];
    for (let t = 0; t < grille.triangles; t++) expect(p.data[(triBase + t * MESH_TRI_TEXELS) * TEXEL_FLOATS + 3]).toBe(1 + MESH_ALPHA_STEP);
    expect(texelDensity(drum)).toBeGreaterThan(0);
  });

  it('draws an unknown mesh as its box and a known one by its slot', () => {
    const known = meshObject(drum);
    const unknown = { ...known, mesh: 'test:nowhere' };
    const p = packScene({ ...emptyScene(), objects: [known, unknown] }, new Map([['test:drum', 0]]));
    const row = (i: number, texel: number) => p.objects[(i * OBJ_TEXELS + texel) * TEXEL_FLOATS];
    expect(row(0, HEADER)).toBe(ShapeKind.Mesh);
    expect(p.objects[(0 * OBJ_TEXELS + PARAMS) * TEXEL_FLOATS + 1]).toBe(0);
    expect(row(1, HEADER)).toBe(ShapeKind.Cube);
  });

  it('outlines creases and borders, not every triangle', () => {
    const lines = meshLines(drum)!;
    expect(lines.length / 2).toBeLessThan(drum.triangles);
    expect(lines.length).toBeGreaterThan(0);
  });

});
