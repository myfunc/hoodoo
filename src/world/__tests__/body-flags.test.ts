import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Scene, SceneObject } from '../../model/scene.types';
import { DEFAULT_DENSITY, bodyOf, canBePhysical, groupBody, massOf, withBody } from '../body-flags';
import { groupIndex } from '../group-tree';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { World } from '../world';

const make = (entry: string): SceneObject => createObject(createEntry(entry), { seed: 1 });
const roundTrip = (scene: Scene) => deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));

describe('Play body flags', () => {
  it('default by kind: objects and ground solid, water not, nothing physical', () => {
    expect(bodyOf(make('cube'))).toEqual({ solid: true, physical: false });
    expect(bodyOf(make('ground'))).toEqual({ solid: true, physical: false });
    expect(bodyOf(make('terrain'))).toEqual({ solid: true, physical: false });
    expect(bodyOf(make('water'))).toEqual({ solid: false, physical: false });
    expect(bodyOf(make('radial'))).toEqual({ solid: false, physical: false });
    expect(canBePhysical(make('ground').kind)).toBe(false);
  });

  it('physical implies solid, and a default body is not stored', () => {
    const ball = withBody(make('sphere'), { physical: true, solid: false });
    expect(bodyOf(ball)).toEqual({ solid: true, physical: true });
    expect(withBody(ball, { physical: false }).body).toBeUndefined();
    expect(withBody(make('ground'), { physical: true }).body).toBeUndefined();
  });

  it('mass: given, or the volume at the default density', () => {
    const cube = make('cube');
    expect(massOf(cube)).toBeCloseTo(8 * DEFAULT_DENSITY);
    expect(massOf(withBody(cube, { physical: true, mass: 3 }))).toBe(3);
  });

  it('are saved, and files without them open as before', () => {
    const ball = withBody(make('sphere'), { physical: true, mass: 2.5 });
    const water = withBody(make('water'), { solid: true });
    const scene = { ...emptyScene(), objects: [ball, water, make('cube')] };
    const back = roundTrip(scene);
    expect(back.objects.map((o) => o.body)).toEqual([{ solid: true, physical: true, mass: 2.5 }, { solid: true, physical: false }, undefined]);
    const file = JSON.parse(JSON.stringify(serializeScene(scene)));
    for (const o of file.scene.objects) delete o.body;
    expect(deserializeScene(file).objects.every((o) => o.body === undefined)).toBe(true);
  });

  it('drops broken flags instead of refusing the file', () => {
    const file = JSON.parse(JSON.stringify(serializeScene({ ...emptyScene(), objects: [make('cube')] })));
    file.scene.objects[0].body = { solid: 'yes', physical: 1 };
    expect(deserializeScene(file).objects[0].body).toBeUndefined();
  });

  it('a group can be one physical body, in one undo step, and is saved', () => {
    const w = new World(emptyScene());
    const [a, b] = [make('cube'), make('sphere')];
    w.addObjects([a, b], 'Create');
    const g = w.group(new Set([a.id, b.id]), true)!;
    w.setGroupBody(g, { physical: true });
    expect(groupBody(groupIndex(w.scene).get(g)).physical).toBe(true);
    expect(groupBody(groupIndex(roundTrip(w.scene)).get(g)).physical).toBe(true);
    w.undo();
    expect(groupBody(groupIndex(w.scene).get(g)).physical).toBe(false);
  });
});
