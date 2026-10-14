import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { BooleanMode } from '../../model/scene.enums';
import type { SceneObject } from '../../model/scene.types';
import { cameraBasis } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { DEFAULT_CAMERA, emptyScene } from '../../world/scene.defaults';
import { MAX_OBJECTS } from '../gpu/render.constants';
import { ObjectBudget, PLACE, placeOf } from '../object-budget';

const ASPECT = 1.6;
const SPREAD = 4;

/** A cube at x, z. */
const cube = (x: number, z: number, i: number): SceneObject => {
  const o = createObject(createEntry('cube'), { seed: i + 1 });
  return { ...o, transform: { ...o.transform, position: [x, 0.5, z] } };
};

/** A grid of `n` cubes reaching away from the default camera (it looks down -z from z = 18). */
const field = (n: number) => Array.from({ length: n }, (_, i) => cube((i % 20) * SPREAD - 40, 10 - Math.floor(i / 20) * SPREAD, i));
const basis = cameraBasis(DEFAULT_CAMERA, ASPECT);

describe('the objects a picture draws', () => {
  it('a scene within the limits goes as it is', () => {
    const scene = { ...emptyScene(), objects: field(MAX_OBJECTS) };
    expect(new ObjectBudget().pick(scene, basis)).toBe(scene);
  });

  it('past them: at most the limit, never more than a place draws, the same snapshot while nothing changes', () => {
    const scene = { ...emptyScene(), objects: field(600) };
    const budget = new ObjectBudget();
    const picked = budget.pick(scene, basis);
    expect(picked.objects.length).toBeLessThanOrEqual(MAX_OBJECTS);
    const perPlace = new Map<string, number>();
    for (const o of picked.objects) perPlace.set(placeOf(o), (perPlace.get(placeOf(o)) ?? 0) + 1);
    expect(Math.max(...perPlace.values())).toBeLessThanOrEqual(PLACE.drawnPerPlace);
    expect(budget.pick(scene, basis)).toBe(picked);
  });

  it('takes the nearest in view first, and a cutting group whole', () => {
    const near = cube(0, 8, 9001);
    const g = 'g-cut' as SceneObject['groupId'];
    const hole = { ...cube(1, 8, 9002), groupId: g, boolean: BooleanMode.Negative };
    const body = { ...cube(1, 8, 9003), groupId: g, boolean: BooleanMode.Positive };
    const scene = { ...emptyScene(), objects: [...field(600), near, hole, body] };
    const ids = new Set(new ObjectBudget().pick(scene, basis).objects.map((o) => o.id));
    expect(ids.has(near.id)).toBe(true);
    expect(ids.has(hole.id) && ids.has(body.id)).toBe(true);
  });
});
