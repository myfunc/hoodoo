import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import { Studio } from '../model/scene.enums';
import type { Camera, Key, Scene, SceneObject, Transform } from '../model/scene.types';
import { bakeAnimation, keyTimes } from './animation/bake';
import { lookAt } from './camera-math';
import { demoScene } from './demo-scene';
import { createObject } from './objects.factory';
import { surpriseScene } from './scene-generator';
import { EMPTY_ANIMATION, emptyScene } from './scene.defaults';
import { SplashClip, SplashKind, splashBase, splashFrame, splashScene } from './splash-scene';

/**
 * The example projects of the start window: finished scenes for each studio,
 * the Hoodoo 3D ones with their animation already on the timeline. Thumbnails
 * are rendered by tools/make-examples.mjs into src/ui/art/examples/<id>.jpg.
 */
export interface Example {
  readonly id: string;
  readonly studio: Studio;
  readonly name: string;
  readonly blurb: string;
  build(): Scene;
}

const TAU = 2 * Math.PI;
const RAD_PER_DEG = Math.PI / 180;
const EXAMPLE_DOCUMENT = { width: 960, height: 600 } as const;
const SURPRISE_SEED = 2024;

const inStudio = (scene: Scene, studio: Studio, document = scene.document): Scene => ({ ...scene, studio, document });

// ---------- Hoodoo 3D: the splash motions as editable keys ----------

const LOOP_SECONDS = 10;
const LOOP_KEYS = 21;

function splashMotion(kind: SplashKind, loop: boolean): Scene {
  const base = inStudio(splashBase(kind), Studio.ThreeD, EXAMPLE_DOCUMENT);
  const frameAt = (t: number) => splashFrame(base, kind, SplashClip.Loop, t / LOOP_SECONDS);
  const animation = bakeAnimation(base, frameAt, keyTimes(LOOP_SECONDS, LOOP_KEYS), { duration: LOOP_SECONDS, loop });
  return { ...frameAt(0), animation };
}

// ---------- Hoodoo 3D: a flight through the canyon ----------

const FLIGHT = {
  seconds: 8,
  aim: [0, 4, -6] as Vec3,
  /** Camera stops, the last one back at the start so the loop closes. */
  path: [[0, 2.4, 18], [-8, 4.5, 13], [0, 6.5, 9], [8, 4.5, 13], [0, 2.4, 18]] as const,
  bob: { height: 0.7, tilt: 7, step: 2 },
} as const;

const keyed = <T>(values: readonly T[], seconds: number): Key<T>[] =>
  values.map((value, i) => ({ time: (seconds * i) / (values.length - 1), value }));

function aimed(c: Camera, from: Vec3, at: Vec3): Camera {
  return lookAt({ ...c, position: from }, at);
}

function canyonFlight(): Scene {
  const scene = inStudio(demoScene(), Studio.ThreeD);
  const F = FLIGHT;
  const camera = keyed(F.path.map((p) => aimed(scene.camera, [p[0], p[1], p[2]], F.aim)), F.seconds);
  const eggs = scene.objects.filter((o) => o.name.endsWith('Egg') && o.name !== 'Pedestal Egg');
  const steps = F.seconds / F.bob.step;
  const objects = Object.fromEntries(eggs.map((egg, n) => {
    const t = egg.transform;
    const values: Transform[] = Array.from({ length: steps + 1 }, (_, i) => {
      const phase = (TAU * i) / steps + n;
      return { ...t, position: [t.position[0], t.position[1] + F.bob.height * Math.sin(phase), t.position[2]], rotation: [0, 0, F.bob.tilt * Math.cos(phase)] };
    });
    // The loop closes exactly: the last key repeats the first.
    values[steps] = values[0];
    return [egg.id, keyed(values, F.seconds)];
  }));
  const animation = { ...EMPTY_ANIMATION, duration: F.seconds, loop: true, objects, camera };
  return { ...scene, animation, camera: camera[0].value };
}

// ---------- Hoodoo 3D: moons around a ringed planet ----------

const WALTZ = {
  seconds: 8,
  planet: [0, 13, -42] as Vec3,
  /** Orbits: radius, tilt of the orbit (degrees), turns per loop, size, material. */
  moons: [
    { name: 'Snow Moon', radius: 13, tilt: 12, turns: 1, size: 1.5, material: 'Snowy Peaks' },
    { name: 'Marble Moon', radius: 8, tilt: -20, turns: 2, size: 0.8, material: 'Neon Marble' },
  ],
  keysPerTurn: 12,
  planetSize: [7, 7, 7] as Vec3,
  ring: { size: [12.5, 1.5, 12.5] as Vec3, tube: 0.025, tilt: [-16, 0, 18] as Vec3 },
  /** Golden hour with the sun behind the camera's left shoulder, so the planet is lit. */
  sky: { preset: 'Golden Hour', azimuth: 25, altitude: 16 },
  hills: { position: [0, 3, -90] as Vec3, size: [160, 9, 40] as Vec3, seed: 77 },
  /** The camera looks this far below the planet's centre, so the sea shows. */
  aimDrop: 3,
  camera: [[0, 2.2, 20], [4, 3.6, 13], [0, 2.2, 20]] as const,
} as const;

function piece(entry: string, name: string, material: string, position: Vec3, size?: Vec3, seed = 1): SceneObject {
  const recipe = entry === 'terrain' ? OBJECT_LIBRARY.find((o) => o.name === 'Rolling Hills')?.recipe : undefined;
  return createObject(createEntry(entry), { name, material, position, size, seed, recipe });
}

function moonWaltz(): Scene {
  const base = emptyScene(Studio.ThreeD);
  const W = WALTZ;
  const p = W.planet;
  const planet = piece('sphere', 'Ringed Planet', 'Mars Soil', p, W.planetSize);
  const ring = { ...piece('torus', 'Planet Ring', 'Glow White', p, W.ring.size), shapeParam: W.ring.tube };
  const tiltedRing = { ...ring, transform: { ...ring.transform, rotation: W.ring.tilt } };
  const moons = W.moons.map((m) => piece('sphere', m.name, m.material, [p[0] + m.radius, p[1], p[2]], [m.size, m.size, m.size]));
  const objects = [
    piece('water', 'Mirror Sea', 'Mirror Lake', [0, 0, 0]),
    piece('terrain', 'Far Hills', 'Alpine Meadow', W.hills.position, W.hills.size, W.hills.seed),
    planet, tiltedRing, ...moons,
  ];
  const tracks = Object.fromEntries(W.moons.map((m, i) => {
    const n = W.keysPerTurn * m.turns;
    const tilt = m.tilt * RAD_PER_DEG;
    const values: Transform[] = Array.from({ length: n + 1 }, (_, k) => {
      const a = (TAU * m.turns * k) / n;
      const x = m.radius * Math.cos(a);
      const z = m.radius * Math.sin(a);
      return { ...moons[i].transform, position: [p[0] + x, p[1] + z * Math.sin(tilt), p[2] + z * Math.cos(tilt)] };
    });
    values[n] = values[0];
    return [moons[i].id, keyed(values, W.seconds)];
  }));
  const camera = keyed(W.camera.map((c) => aimed(base.camera, [c[0], c[1], c[2]], [p[0], p[1] - W.aimDrop, p[2]])), W.seconds);
  const preset = SKY_LIBRARY.find((s) => s.name === W.sky.preset)?.sky ?? base.sky;
  const sky = { ...preset, sunAzimuth: W.sky.azimuth, sunAltitude: W.sky.altitude };
  return {
    ...base, sky, objects, document: EXAMPLE_DOCUMENT, camera: camera[0].value,
    animation: { ...EMPTY_ANIMATION, duration: W.seconds, loop: true, objects: tracks, camera },
  };
}

export const EXAMPLES: readonly Example[] = [
  { id: 'canyon', studio: Studio.Two, name: 'Trapper Keeper Canyon', blurb: 'Strata towers and chrome eggs in a lagoon', build: () => demoScene() },
  { id: 'dunes', studio: Studio.Two, name: 'Golden Dunes', blurb: 'Sunrise fog between hills, three planets', build: () => inStudio(splashScene(SplashKind.Dunes), Studio.Two, EXAMPLE_DOCUMENT) },
  { id: 'arch', studio: Studio.Two, name: 'Ring Arch', blurb: 'A planet ring over a starry lake', build: () => inStudio(splashScene(SplashKind.Arch), Studio.Two, EXAMPLE_DOCUMENT) },
  { id: 'surprise', studio: Studio.Two, name: 'Checkerboard Desert', blurb: `Stones on chrome checkers · Surprise #${SURPRISE_SEED}`, build: () => surpriseScene(SURPRISE_SEED) },
  { id: 'flight', studio: Studio.ThreeD, name: 'Canyon Flight', blurb: 'The camera flies round bobbing eggs', build: canyonFlight },
  { id: 'waltz', studio: Studio.ThreeD, name: 'Moon Waltz', blurb: 'Two moons orbit a ringed planet', build: moonWaltz },
  { id: 'dunes-morning', studio: Studio.ThreeD, name: 'Dunes Morning', blurb: 'Sun, fog and planets breathe in a loop', build: () => splashMotion(SplashKind.Dunes, true) },
  { id: 'arch-night', studio: Studio.ThreeD, name: 'Arch Night', blurb: 'The night sky wheels over the lake', build: () => splashMotion(SplashKind.Arch, false) },
];
