import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import type { Camera, Key, Scene, SceneObject, Transform } from '../model/scene.types';
import { bakeAnimation, keyTimes } from './animation/bake';
import { lookAt } from './camera-math';
import { demoScene } from './demo-scene';
import { createObject } from './objects.factory';
import { surpriseScene } from './scene-generator';
import { EMPTY_ANIMATION, emptyScene } from './scene.defaults';
import { sunsetGambit } from './showcase/gambit';
import { squashAndStretch } from './showcase/bounce';
import { booleanCarving } from './showcase/carve';
import { playground } from './showcase/playground';
import { miniCity, miniCityNight } from './showcase/mini-city';
import { Feature, type FeatureFlags, isFeatureOn } from './preview-features';
import { hoodooRun } from './showcase/flight';
import { marbleDream } from './showcase/marble';
import { billiardOrrery } from './showcase/orrery';
import { pyramidValley } from './showcase/valley';
import { vaporDesk } from './showcase/vapor';
import { meadowDay } from './showcase/meadow-day';
import { floatingIslands } from './showcase/islands';
import { cityDusk } from './showcase/city-dusk';
import { lighthouseStorm } from './showcase/lighthouse';
import { prismLab } from './showcase/prism-lab';
import { chessEndgame } from './showcase/endgame';
import { desertTemple } from './showcase/temple';
import { dominoRun } from './showcase/domino';
import { SplashClip, SplashKind, splashBase, splashFrame, splashScene } from './splash-scene';

/**
 * The example projects of the start window: the animated showcase first, its featured
 * scene leading, then the Play scenes; the older set is classic (in the tray until the
 * user brings one back). Thumbnails are rendered by
 * tools/make-examples.mjs into src/ui/art/examples/<id>.jpg.
 */
export interface Example {
  readonly id: string;
  /** The scene comes with its animation on (the start window's badge; a test checks it against the build). */
  readonly animated: boolean;
  readonly name: string;
  readonly blurb: string;
  /** Shown larger in the start window: the showcase's front page. */
  readonly featured?: boolean;
  /** Listed only while this preview feature is on (the Play example). */
  readonly feature?: Feature;
  /** An older example: it waits in the start window's tray until the user brings it back. */
  readonly classic?: boolean;
  build(): Scene;
}

const TAU = 2 * Math.PI;
const RAD_PER_DEG = Math.PI / 180;
const EXAMPLE_DOCUMENT = { width: 960, height: 600, fit: true } as const;
const SURPRISE_SEED = 2024;
/** The animated examples keep the Bryce 3D look they were made with. */
const SOFT_SHADOWS = 100;

const withDocument = (scene: Scene, document: Scene['document']): Scene => ({ ...scene, document });
const softened = (scene: Scene, document = scene.document): Scene => ({ ...scene, document, sky: { ...scene.sky, softShadows: SOFT_SHADOWS } });

// ---------- Animated: the splash motions as editable keys ----------

const LOOP_SECONDS = 10;
const LOOP_KEYS = 21;

function splashMotion(kind: SplashKind, loop: boolean): Scene {
  const base = softened(splashBase(kind), EXAMPLE_DOCUMENT);
  const frameAt = (t: number) => splashFrame(base, kind, SplashClip.Loop, t / LOOP_SECONDS);
  const animation = bakeAnimation(base, frameAt, keyTimes(LOOP_SECONDS, LOOP_KEYS), { duration: LOOP_SECONDS, loop });
  return { ...frameAt(0), animation };
}

// ---------- Animated: a flight through the canyon ----------

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
  const scene = softened(demoScene());
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
  const animation = { ...EMPTY_ANIMATION, enabled: true, duration: F.seconds, loop: true, objects, camera };
  return { ...scene, animation, camera: camera[0].value };
}

// ---------- Animated: moons around a ringed planet ----------

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
  const base = emptyScene();
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
  const sky = { ...preset, sunAzimuth: W.sky.azimuth, sunAltitude: W.sky.altitude, softShadows: SOFT_SHADOWS };
  return {
    ...base, sky, objects, document: EXAMPLE_DOCUMENT, camera: camera[0].value,
    animation: { ...EMPTY_ANIMATION, enabled: true, duration: W.seconds, loop: true, objects: tracks, camera },
  };
}

export const EXAMPLES: readonly Example[] = [
  { id: 'meadow-day', animated: true, featured: true, name: 'Meadow Day', blurb: 'A day and night over a windmill and flower meadows', build: meadowDay },
  { id: 'city-dusk', animated: true, name: 'City at Dusk', blurb: 'Day to night: windows, street lamps, traffic', build: cityDusk },
  { id: 'islands', animated: true, name: 'Floating Islands', blurb: 'Meadow islands and a balloon over a sea of clouds', build: floatingIslands },
  { id: 'lighthouse', animated: true, name: 'Lighthouse', blurb: 'A beam sweeps the fog as a boat rocks past', build: lighthouseStorm },
  { id: 'prism-lab', animated: true, name: 'Prism Lab', blurb: 'Glass on turntables under sweeping coloured spots', build: prismLab },
  { id: 'endgame', animated: true, name: 'Chess Endgame', blurb: "Philidor's Legacy: a smothered mate under a lamp", build: chessEndgame },
  { id: 'temple', animated: true, name: 'Desert Temple', blurb: 'Sun sweeps a carved temple as its door opens', build: desertTemple },
  { id: 'domino', animated: true, name: 'Domino Run', blurb: 'A ball, 40 dominoes, a toppling tower; push in Play', build: dominoRun },
  { id: 'mini-city', animated: false, name: 'Mini City', blurb: 'Blocks with windows, streets, hills; crates to push in Play', build: miniCity },
  { id: 'mini-city-night', animated: false, name: 'Mini City at Night', blurb: 'The same city under the moon, its windows lit', build: miniCityNight },
  { id: 'playground', animated: true, feature: Feature.Play, name: 'Playground', blurb: 'Play it: a door, a lift, a spinning bridge, a button', build: playground },
  // The older set: in the tray until brought back.
  { classic: true, id: 'canyon', animated: false, name: 'Trapper Keeper Canyon', blurb: 'Strata towers and chrome eggs', build: () => demoScene() },
  { classic: true, id: 'dunes', animated: false, name: 'Golden Dunes', blurb: 'Sunrise fog and three planets', build: () => withDocument(splashScene(SplashKind.Dunes), EXAMPLE_DOCUMENT) },
  { classic: true, id: 'arch', animated: false, name: 'Ring Arch', blurb: 'A planet ring over a starry lake', build: () => withDocument(splashScene(SplashKind.Arch), EXAMPLE_DOCUMENT) },
  { classic: true, id: 'surprise', animated: false, name: 'Checkerboard Desert', blurb: `Stones · Surprise Me #${SURPRISE_SEED}`, build: () => surpriseScene(SURPRISE_SEED) },
  { classic: true, id: 'gambit', animated: true, name: 'Sunset Gambit', blurb: 'Chess and billiards by the sea', build: sunsetGambit },
  { classic: true, id: 'vapor-desk', animated: true, name: 'Vapor Desk', blurb: 'A bell jar, a column and discs on checker decks', build: vaporDesk },
  { classic: true, id: 'pyramid-valley', animated: true, name: 'Pyramid Valley', blurb: 'Golden pyramids beam light over a green valley', build: pyramidValley },
  { classic: true, id: 'marble-dream', animated: true, name: 'Marble Dream', blurb: 'A marble head among glass arches', build: marbleDream },
  { classic: true, id: 'flight', animated: true, name: 'Canyon Flight', blurb: 'The camera flies round the eggs', build: canyonFlight },
  { classic: true, id: 'waltz', animated: true, name: 'Moon Waltz', blurb: 'Two moons orbit a ringed planet', build: moonWaltz },
  { classic: true, id: 'dunes-morning', animated: true, name: 'Dunes Morning', blurb: 'Sun, fog and planets breathe', build: () => splashMotion(SplashKind.Dunes, true) },
  { classic: true, id: 'arch-night', animated: true, name: 'Arch Night', blurb: 'The night sky wheels over the lake', build: () => splashMotion(SplashKind.Arch, false) },
  { classic: true, id: 'orrery', animated: true, name: 'Billiard Orrery', blurb: 'Groups orbit while their moons circle', build: billiardOrrery },
  { classic: true, id: 'squash', animated: true, name: 'Squash & Stretch', blurb: 'Balls bounce and pieces swell: keyed sizes', build: squashAndStretch },
  { classic: true, id: 'hoodoo-run', animated: true, name: 'Hoodoo Run', blurb: 'A fly-through: arches, spires, a mirror ball', build: hoodooRun },
  { classic: true, id: 'carving', animated: true, name: 'Boolean Carving', blurb: 'Keyed cutters bore, round and pierce', build: booleanCarving },
];

/** The examples to offer with these preview features on: one of a feature that is off is not listed. */
export const examplesFor = (flags: FeatureFlags): readonly Example[] => EXAMPLES.filter((e) => !e.feature || isFeatureOn(flags, e.feature));
