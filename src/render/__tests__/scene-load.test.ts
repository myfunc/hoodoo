import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { demoScene } from '../../world/demo-scene';
import { MAX_LIGHTS, MAX_OBJECTS } from '../gpu/render.constants';
import { packedObjects } from '../gpu/scene-packer';
import { sceneLoad } from '../scene-load';

const many = (id: string, n: number) => Array.from({ length: n }, (_, i) => createObject(createEntry(id), { seed: i + 1 }));
const OVER = 10;

describe('scene load', () => {
  it('counts what the tracer draws, as the packer does', () => {
    const scene = demoScene();
    expect(sceneLoad(scene).objects).toBe(packedObjects(scene).length);
    expect(sceneLoad(scene).tips).toEqual([]);
  });

  it('names the objects and lights past the limits, and what to do', () => {
    const scene = { ...emptyScene(), objects: [...many('cube', MAX_OBJECTS + OVER), ...many('radial', MAX_LIGHTS + 1)] };
    const l = sceneLoad(scene);
    expect(l.objects).toBe(MAX_OBJECTS);
    expect(l.leftOut).toBe(OVER);
    expect(l.lightsLeftOut).toBe(1);
    expect(l.share).toBeGreaterThan(1);
    expect(l.tips[0]).toContain(`${MAX_OBJECTS + OVER} objects`);
  });
});
