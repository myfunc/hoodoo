import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import { BooleanMode } from '../model/scene.enums';
import { newGroupId } from '../model/scene.ids';
import type { Scene, SceneObject } from '../model/scene.types';
import { createObject } from './objects.factory';
import { emptyScene } from './scene.defaults';

/**
 * "Trapper Keeper Canyon": the opening scene, after the 90s render-challenge look —
 * strata towers in a turquoise lagoon, floating chrome eggs, an egg on a pedestal.
 */
interface Placement {
  readonly entry: string;
  readonly position: Vec3;
  readonly size: Vec3;
  readonly material: string;
  readonly name: string;
  readonly rotation?: Vec3;
}

const TOWERS: readonly { position: Vec3; size: Vec3; seed: number }[] = [
  { position: [-11, 3.2, -6], size: [5, 6.5, 5], seed: 11 },
  { position: [-6, 2.2, -16], size: [6, 4.5, 6], seed: 23 },
  { position: [10, 3.8, -8], size: [5.5, 7.5, 5.5], seed: 37 },
  { position: [5, 2.4, -20], size: [7, 5, 7], seed: 41 },
  { position: [-1, 1.6, -28], size: [9, 3.5, 9], seed: 53 },
];

const EGGS: readonly Placement[] = [
  { entry: 'sphere-elongated', position: [-5, 7.5, -4], size: [0.8, 1.05, 0.8], material: 'Blue Egg Chrome', name: 'Blue Egg' },
  { entry: 'sphere-elongated', position: [-2.2, 5.6, -12], size: [0.55, 0.72, 0.55], material: 'Neon Marble', name: 'Marble Egg' },
  { entry: 'sphere-elongated', position: [4.6, 7, -9], size: [0.9, 1.15, 0.9], material: 'Trapper Purple', name: 'Purple Egg' },
  { entry: 'sphere-elongated', position: [1.4, 3.1, 2], size: [1.25, 1.6, 1.25], material: 'Trapper Purple', name: 'Pedestal Egg' },
];

const PEDESTAL_BASE: Placement = {
  entry: 'cylinder', position: [1.4, 0.75, 2], size: [0.55, 0.75, 0.55], material: 'Polished Wood', name: 'Pedestal Stem',
};
const PEDESTAL_CUP: Placement = {
  entry: 'cone', position: [1.4, 1.25, 2], size: [1.5, 0.55, 1.5], rotation: [180, 0, 0], material: 'Polished Wood', name: 'Pedestal Cup',
};
const PEDESTAL_CUT: Placement = {
  entry: 'sphere', position: [1.4, 2.6, 2], size: [1.35, 1.35, 1.35], material: 'Default', name: 'Cup Hollow',
};

const SPIRES = OBJECT_LIBRARY.find((o) => o.name === 'Hoodoo Spires');

function place(p: Placement, seed: number): SceneObject {
  const obj = createObject(createEntry(p.entry), { position: p.position, size: p.size, material: p.material, name: p.name, seed });
  return p.rotation ? { ...obj, transform: { ...obj.transform, rotation: p.rotation } } : obj;
}

export function demoScene(): Scene {
  const base = emptyScene();
  const water = createObject(createEntry('water'), { seed: 1, material: 'Turquoise Wave' });
  const towers = TOWERS.map((t, i) =>
    createObject(createEntry('terrain'), {
      position: t.position, size: t.size, seed: t.seed, recipe: SPIRES?.recipe, material: 'Canyon Strata', name: `Strata Tower ${i + 1}`,
    }),
  );
  const eggs = EGGS.map((e, i) => place(e, i));
  const group = newGroupId();
  const cup: SceneObject = { ...place(PEDESTAL_CUP, 0), boolean: BooleanMode.Positive, groupId: group };
  const cut: SceneObject = { ...place(PEDESTAL_CUT, 0), boolean: BooleanMode.Negative, groupId: group };
  const stem = place(PEDESTAL_BASE, 0);
  const sky = SKY_LIBRARY.find((s) => s.name === 'Trapper Keeper')?.sky ?? base.sky;
  return { ...base, sky, objects: [water, ...towers, stem, cup, cut, ...eggs] };
}
