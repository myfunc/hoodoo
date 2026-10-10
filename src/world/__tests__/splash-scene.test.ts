import { describe, expect, it } from 'vitest';
import { ShapeKind } from '../../model/scene.enums';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { SPLASH_DOCUMENT, splashScene } from '../splash-scene';

describe('splash scene', () => {
  it('builds every piece, with heights for its rolling-hill terrains', () => {
    const scene = splashScene();
    const terrains = scene.objects.filter((o) => o.kind === ShapeKind.Terrain);
    expect(terrains.length).toBeGreaterThan(0);
    for (const t of terrains) expect(t.terrain?.heights.length).toBeGreaterThan(0);
    expect(scene.document).toEqual(SPLASH_DOCUMENT);
  });

  it('survives a file round-trip, so it opens like any saved scene', () => {
    const scene = splashScene();
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    expect(back.document).toEqual(SPLASH_DOCUMENT);
  });
});
