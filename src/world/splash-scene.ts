import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import type { Scene, SceneObject } from '../model/scene.types';
import { createObject } from './objects.factory';
import { emptyScene } from './scene.defaults';

/**
 * "Planet Meadows": the splash art and the face of Hoodoo 2 — endless green
 * hills under a daytime sky with planets hanging over the horizon. The picture
 * in src/ui/art/splash.jpg is this scene rendered by tools/make-splash.mjs.
 */
interface Piece {
  readonly entry: string;
  readonly name: string;
  readonly position: Vec3;
  readonly size: Vec3;
  readonly material: string;
  readonly seed?: number;
  readonly rotation?: Vec3;
}

const HILLS: readonly Piece[] = [
  { entry: 'terrain', name: 'Near Hills', position: [0, 1.2, -40], size: [70, 3.2, 26], material: 'Grassy Plain', seed: 21 },
  { entry: 'terrain', name: 'Middle Hills', position: [-30, 3, -110], size: [180, 9, 60], material: 'Grassy Plain', seed: 22 },
  { entry: 'terrain', name: 'Far Hills', position: [40, 6, -230], size: [360, 18, 110], material: 'Grassy Plain', seed: 23 },
];

const RINGED_AT: Vec3 = [130, 150, -500];

const PLANETS: readonly Piece[] = [
  { entry: 'sphere', name: 'Pale Moon', position: [-120, 40, -520], size: [150, 150, 150], material: 'Snowy Peaks' },
  { entry: 'sphere', name: 'Ringed Planet', position: RINGED_AT, size: [38, 38, 38], material: 'Trapper Purple' },
  { entry: 'torus', name: 'Planet Ring', position: RINGED_AT, size: [72, 0.95, 72], material: 'Brushed Steel', rotation: [22, 0, 12] },
  { entry: 'sphere', name: 'Red Moon', position: [40, 210, -560], size: [10, 10, 10], material: 'Mars Soil' },
];

const ROLLING_HILLS = OBJECT_LIBRARY.find((o) => o.name === 'Rolling Hills');
const HAZE = 10;
const CAMERA = { position: [0, 2, 16] as Vec3, yaw: 0, pitch: 7, fov: 56 };
export const SPLASH_DOCUMENT = { width: 1280, height: 800 } as const;

function place(p: Piece): SceneObject {
  const recipe = p.entry === 'terrain' ? ROLLING_HILLS?.recipe : undefined;
  const obj = createObject(createEntry(p.entry), { position: p.position, size: p.size, material: p.material, name: p.name, seed: p.seed ?? 1, recipe });
  return p.rotation ? { ...obj, transform: { ...obj.transform, rotation: p.rotation } } : obj;
}

export function splashScene(): Scene {
  const base = emptyScene();
  const ground = createObject(createEntry('ground'), { seed: 1, material: 'Grassy Plain', name: 'Meadow' });
  const sky = SKY_LIBRARY.find((s) => s.name === 'Soft Sky')?.sky ?? base.sky;
  return {
    ...base,
    sky: { ...sky, hazeAmount: HAZE },
    camera: { ...base.camera, ...CAMERA },
    document: SPLASH_DOCUMENT,
    objects: [ground, ...HILLS.map(place), ...PLANETS.map(place)],
  };
}
