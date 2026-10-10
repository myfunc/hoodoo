import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import { rgb } from '../core/color';
import type { Vec3 } from '../core/vec3';
import type { Scene, SceneObject } from '../model/scene.types';
import { createObject } from './objects.factory';
import { emptyScene } from './scene.defaults';

/**
 * "Planet Meadows": the splash art and the face of Hoodoo 2 — endless green
 * hills under a vapor-sunset sky, a lava planet with a marbled ring rising over
 * the horizon. The picture in src/ui/art/splash.jpg is this scene rendered by
 * tools/make-splash.mjs.
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
  { entry: 'terrain', name: 'Near Hills', position: [0, 1.2, -40], size: [70, 3.2, 26], material: 'Grassy Plain', seed: 31 },
  { entry: 'terrain', name: 'Middle Hills', position: [-30, 3, -110], size: [180, 9, 60], material: 'Grassy Plain', seed: 32 },
  { entry: 'terrain', name: 'Far Hills', position: [40, 6, -230], size: [360, 18, 110], material: 'Grassy Plain', seed: 33 },
];

const RINGED_AT: Vec3 = [70, 95, -420];

const PLANETS: readonly Piece[] = [
  { entry: 'sphere', name: 'Lava Planet', position: RINGED_AT, size: [105, 105, 105], material: 'Lava Lamp' },
  { entry: 'torus', name: 'Planet Ring', position: RINGED_AT, size: [200, 2.6, 200], material: 'Neon Marble', rotation: [22, 0, 8] },
  { entry: 'sphere', name: 'Purple Moon', position: [-150, 150, -520], size: [30, 30, 30], material: 'Trapper Purple' },
];

const ROLLING_HILLS = OBJECT_LIBRARY.find((o) => o.name === 'Rolling Hills');
/** Vapor Sunset, lit whiter and higher so the meadows stay green under the pink sky. */
const SKY_CHANGES = { hazeAmount: 14, sunAltitude: 28, sunColor: rgb(1, 0.9, 0.82), ambientColor: rgb(0.48, 0.58, 0.56) };
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
  const sky = SKY_LIBRARY.find((s) => s.name === 'Vapor Sunset')?.sky ?? base.sky;
  return {
    ...base,
    sky: { ...sky, ...SKY_CHANGES },
    camera: { ...base.camera, ...CAMERA },
    document: SPLASH_DOCUMENT,
    objects: [ground, ...HILLS.map(place), ...PLANETS.map(place)],
  };
}
