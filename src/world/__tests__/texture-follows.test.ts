import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { TextureMapping } from '../../model/scene.enums';
import { createObject } from '../objects.factory';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { emptyScene } from '../scene.defaults';

describe('textures that follow their object', () => {
  it('are how a new object starts: no texture of it stays behind in the world', () => {
    const o = createObject(createEntry('sphere'), { seed: 3, material: 'Canyon Strata' });
    const mappings = o.material.textures.flatMap((t) => (t ? [t.mapping] : []));
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings).not.toContain(TextureMapping.World);
  });

  it('travel in the scene file', () => {
    const o = createObject(createEntry('sphere'), { seed: 3, material: 'Canyon Strata' });
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene({ ...emptyScene(), objects: [o] }))));
    expect(back.objects[0].material.textures.map((t) => t?.mapping)).toEqual(o.material.textures.map((t) => t?.mapping));
  });
});
