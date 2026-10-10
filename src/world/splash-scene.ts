import { createEntry } from '../assets/object.catalog';
import { OBJECT_LIBRARY } from '../assets/object.library';
import { SKY_LIBRARY } from '../assets/sky.presets';
import { type Rgb, hexToRgb as h } from '../core/color';
import type { Vec3 } from '../core/vec3';
import type { Camera, Scene, SceneObject, Sky } from '../model/scene.types';
import { createObject } from './objects.factory';
import { emptyScene } from './scene.defaults';

/**
 * The splash art: two Hoodoo scenes and their motion. "Golden Dunes" (morning and
 * day) — a sea of golden fog between green hills, three planets in a row;
 * "Ring Arch" (evening and night) — a planet's ring arching over a starry lake.
 * Each has a welcome clip that ends on the still picture and a seamless loop
 * that starts from it. tools/make-splash.mjs renders them into src/ui/art.
 *
 * The sun never crosses the horizon in any clip: the renderer switches from sun
 * to moonlight at zero altitude, which would flash the whole picture.
 */
export enum SplashKind {
  Dunes = 'dunes',
  Arch = 'arch',
}

export enum SplashClip {
  Intro = 'intro',
  Loop = 'loop',
}

export const SPLASH_FPS = 15;
export const SPLASH_SECONDS: Readonly<Record<SplashClip, number>> = { [SplashClip.Intro]: 5, [SplashClip.Loop]: 10 };
export const SPLASH_DOCUMENT = { width: 1280, height: 800 } as const;
/** Local hours that show the dunes; the rest of the day shows the arch. */
export const DAY_HOURS = { from: 4, to: 16 } as const;

export const splashKindAt = (hour: number): SplashKind =>
  (hour >= DAY_HOURS.from && hour < DAY_HOURS.to ? SplashKind.Dunes : SplashKind.Arch);

interface Piece {
  readonly entry: string;
  readonly name: string;
  readonly position?: Vec3;
  readonly size?: Vec3;
  readonly material: string;
  readonly seed?: number;
  readonly rotation?: Vec3;
  readonly shapeParam?: number;
}

const TAU = 2 * Math.PI;
const RAD_PER_DEG = Math.PI / 180;
const ROLLING_HILLS = OBJECT_LIBRARY.find((o) => o.name === 'Rolling Hills');

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2);
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const wave = (t: number, cycles = 1, phase = 0): number => Math.sin(TAU * cycles * t + phase);

function place(p: Piece): SceneObject {
  const recipe = p.entry === 'terrain' ? ROLLING_HILLS?.recipe : undefined;
  const obj = createObject(createEntry(p.entry), { position: p.position, size: p.size, material: p.material, name: p.name, seed: p.seed ?? 1, recipe });
  const shaped = p.shapeParam === undefined ? obj : { ...obj, shapeParam: p.shapeParam };
  return p.rotation ? { ...shaped, transform: { ...shaped.transform, rotation: p.rotation } } : shaped;
}

const moved = (o: SceneObject, position: Vec3, rotation = o.transform.rotation): SceneObject =>
  ({ ...o, transform: { ...o.transform, position, rotation } });

const offset = (p: Vec3, dx: number, dy: number): Vec3 => [p[0] + dx, p[1] + dy, p[2]];

// ---------- Golden Dunes ----------

const DUNE_PLANETS = ['Pale Planet', 'Red Planet', 'Marble Moon'] as const;

const DUNES_PIECES: readonly Piece[] = [
  { entry: 'ground', name: 'Meadow', material: 'Grassy Plain' },
  { entry: 'terrain', name: 'Near Hills', position: [0, 3.12, -40], size: [70, 8.32, 26], material: 'Grassy Plain', seed: 131 },
  { entry: 'terrain', name: 'Middle Hills', position: [-30, 7.8, -110], size: [180, 23.4, 60], material: 'Grassy Plain', seed: 132 },
  { entry: 'terrain', name: 'Far Hills', position: [40, 15.6, -230], size: [360, 46.8, 110], material: 'Grassy Plain', seed: 133 },
  { entry: 'sphere', name: DUNE_PLANETS[0], position: [-150, 95, -480], size: [55, 55, 55], material: 'Snowy Peaks' },
  { entry: 'sphere', name: DUNE_PLANETS[1], position: [-20, 140, -500], size: [30, 30, 30], material: 'Mars Soil' },
  { entry: 'sphere', name: DUNE_PLANETS[2], position: [95, 170, -520], size: [14, 14, 14], material: 'Neon Marble' },
];

const DUNES_CAMERA = { position: [0, 9, 16] as Vec3, yaw: 0, pitch: 3, fov: 58 };
const DUNES_SKY = { sunAzimuth: 170, fogHeight: 2.4, cloudColor: h('#ffd0a0') };

/** Sky colours by sun height: low = ember dusk, high = pale gold morning. */
const DUNE_LIGHT = {
  lowSun: 1,
  highSun: 15,
  sky: [h('#141a40'), h('#4a6aa8')],
  horizon: [h('#c0402a'), h('#ffc890')],
  haze: [h('#a04838'), h('#ffd8a8')],
  fog: [h('#7a4a5a'), h('#ffd0a0')],
  ambient: [h('#2a2a40'), h('#7a8a6a')],
} as const;

interface DunesState {
  readonly sun: number;
  readonly fog: number;
  readonly fogHeight: number;
  readonly haze: number;
  readonly clouds: number;
  /** Per planet: offset from its place, x and y. */
  readonly planets: readonly (readonly [number, number])[];
  readonly cameraLift: number;
  readonly cameraBack: number;
}

/** The loop: the sun rises and sets twice (staying above the horizon), fog and clouds breathe, planets drift on closed paths. */
const DUNES_LOOP = {
  sun: { mid: 8, swing: 5, cycles: 2 },
  fog: { mid: 30, swing: 10 },
  fogHeight: { swing: 0.8, phase: 1.2 },
  haze: { mid: 28, swing: 8, phase: 2.4 },
  clouds: { mid: 24, swing: 20, phase: 0.6 },
  planets: [{ x: 30, y: 12, cycles: 1, phase: 0 }, { x: 24, y: 16, cycles: 1, phase: 1 }, { x: 26, y: 14, cycles: 2, phase: 0 }],
} as const;

function dunesLoop(t: number): DunesState {
  const L = DUNES_LOOP;
  return {
    sun: L.sun.mid + L.sun.swing * wave(t, L.sun.cycles),
    fog: L.fog.mid + L.fog.swing * wave(t),
    fogHeight: DUNES_SKY.fogHeight + L.fogHeight.swing * wave(t, 1, L.fogHeight.phase),
    haze: L.haze.mid + L.haze.swing * wave(t, 1, L.haze.phase),
    clouds: L.clouds.mid + L.clouds.swing * wave(t, 1, L.clouds.phase),
    planets: L.planets.map((p) => [p.x * wave(t, p.cycles, p.phase), p.y * Math.cos(TAU * p.cycles * t + p.phase)] as const),
    cameraLift: 0,
    cameraBack: 0,
  };
}

/** The welcome starts at dawn: sun on the horizon, deep fog, planets low, the camera further back. */
const DUNES_DAWN: DunesState = {
  sun: 1, fog: 62, fogHeight: 5, haze: 40, clouds: 30,
  planets: [[0, -50], [0, -40], [0, -30]],
  cameraLift: 1.5, cameraBack: 10,
};

function mixDunes(a: DunesState, b: DunesState, k: number): DunesState {
  return {
    sun: lerp(a.sun, b.sun, k), fog: lerp(a.fog, b.fog, k), fogHeight: lerp(a.fogHeight, b.fogHeight, k),
    haze: lerp(a.haze, b.haze, k), clouds: lerp(a.clouds, b.clouds, k),
    planets: a.planets.map((p, i) => [lerp(p[0], b.planets[i][0], k), lerp(p[1], b.planets[i][1], k)] as const),
    cameraLift: lerp(a.cameraLift, b.cameraLift, k), cameraBack: lerp(a.cameraBack, b.cameraBack, k),
  };
}

function dunesFrame(base: Scene, s: DunesState): Scene {
  const L = DUNE_LIGHT;
  const k = Math.min(1, Math.max(0, (s.sun - L.lowSun) / (L.highSun - L.lowSun)));
  const sky: Sky = {
    ...base.sky,
    sunAltitude: s.sun, fogAmount: s.fog, fogHeight: s.fogHeight, hazeAmount: s.haze,
    skyColor: mixRgb(L.sky[0], L.sky[1], k), horizonColor: mixRgb(L.horizon[0], L.horizon[1], k),
    hazeColor: mixRgb(L.haze[0], L.haze[1], k), fogColor: mixRgb(L.fog[0], L.fog[1], k),
    ambientColor: mixRgb(L.ambient[0], L.ambient[1], k),
    clouds: { ...base.sky.clouds, cover: s.clouds },
  };
  const objects = base.objects.map((o) => {
    const i = DUNE_PLANETS.indexOf(o.name as (typeof DUNE_PLANETS)[number]);
    return i < 0 ? o : moved(o, offset(o.transform.position, s.planets[i][0], s.planets[i][1]));
  });
  const p = base.camera.position;
  const camera: Camera = { ...base.camera, position: [p[0], p[1] + s.cameraLift, p[2] + s.cameraBack] };
  return { ...base, sky, objects, camera };
}

function dunesScene(): Scene {
  const base = emptyScene();
  const preset = SKY_LIBRARY.find((s) => s.name === 'Golden Hour')?.sky ?? base.sky;
  const sky: Sky = { ...preset, sunAzimuth: DUNES_SKY.sunAzimuth, clouds: { ...preset.clouds, color: DUNES_SKY.cloudColor } };
  return { ...base, sky, camera: { ...base.camera, ...DUNES_CAMERA }, document: SPLASH_DOCUMENT, objects: DUNES_PIECES.map(place) };
}

// ---------- Ring Arch ----------

const RING_AT: Vec3 = [0, -350, -1800];
const RING_TILT = 74;
const ARCH_NAMES = { rings: ['Outer Ring', 'Inner Ring'], moon: 'Snow Moon', small: 'Marble Moon' } as const;

const ARCH_PIECES: readonly Piece[] = [
  { entry: 'ground', name: 'Meadow', material: 'Grassy Plain' },
  { entry: 'water', name: 'Lake', position: [0, 0.45, 0], material: 'Mirror Lake' },
  { entry: 'terrain', name: 'Near Hills', position: [0, 1.2, -40], size: [70, 3.2, 26], material: 'Grassy Plain', seed: 111 },
  { entry: 'terrain', name: 'Middle Hills', position: [-30, 3, -110], size: [180, 9, 60], material: 'Grassy Plain', seed: 112 },
  { entry: 'terrain', name: 'Far Hills', position: [40, 6, -230], size: [360, 18, 110], material: 'Grassy Plain', seed: 113 },
  { entry: 'torus', name: ARCH_NAMES.rings[0], position: RING_AT, size: [1500, 225, 1500], material: 'Glow White', rotation: [RING_TILT, 0, 0], shapeParam: 0.035 },
  { entry: 'torus', name: ARCH_NAMES.rings[1], position: RING_AT, size: [1380, 207, 1380], material: 'Glow White', rotation: [RING_TILT, 0, 0], shapeParam: 0.012 },
  { entry: 'sphere', name: ARCH_NAMES.moon, position: [300, 380, -1400], size: [70, 70, 70], material: 'Snowy Peaks' },
  { entry: 'sphere', name: ARCH_NAMES.small, position: [-320, 470, -1600], size: [22, 22, 22], material: 'Neon Marble' },
];

const ARCH_CAMERA = { position: [0, 1.2, 16] as Vec3, yaw: 0, pitch: 12, fov: 72 };
const ARCH_SKY: Partial<Sky> = {
  sunAzimuth: 150, sunAltitude: -2, skyColor: h('#05081e'), horizonColor: h('#3a3a8a'), hazeColor: h('#4a3a8a'),
  hazeAmount: 25, ambientColor: h('#3a4a70'), sunColor: h('#c0c8ff'),
};
/** The welcome begins in late dusk: a lighter sky and horizon that darken into the night colours. */
const ARCH_DUSK = { sky: h('#2a3470'), horizon: h('#c07aa0'), haze: h('#9a6a9a') } as const;

interface ArchState {
  /** Degrees the landscape turns around the camera: the stars stay, so the sky seems to wheel. */
  readonly turn: number;
  readonly sun: number;
  readonly tilt: number;
  readonly moon: readonly [number, number];
  readonly small: readonly [number, number];
  readonly glow: number;
  readonly dusk: number;
  readonly pitch: number;
  readonly fov: number;
}

/** The loop: a night time-lapse. Everything but the turn is periodic; splashFramePlan fades the turn's seam. */
const ARCH_LOOP = {
  turn: -9, sun: { mid: -2.5, swing: 1.5 }, tilt: 1.2,
  moon: { x: -60, y: 30 }, small: { x: 40, y: -25 },
} as const;

function archLoop(t: number): ArchState {
  const L = ARCH_LOOP;
  return {
    turn: L.turn * t,
    sun: L.sun.mid + L.sun.swing * wave(t),
    tilt: L.tilt * wave(t),
    moon: [L.moon.x * wave(t), L.moon.y * (1 - Math.cos(TAU * t))],
    small: [L.small.x * wave(t, 2), L.small.y * wave(t)],
    glow: 1, dusk: 0, pitch: ARCH_CAMERA.pitch, fov: ARCH_CAMERA.fov,
  };
}

const ARCH_EVENING: ArchState = { turn: 0, sun: -0.4, tilt: 0, moon: [80, -60], small: [0, 0], glow: 0, dusk: 1, pitch: 2, fov: 60 };

function mixArch(a: ArchState, b: ArchState, k: number): ArchState {
  return {
    turn: lerp(a.turn, b.turn, k), sun: lerp(a.sun, b.sun, k), tilt: lerp(a.tilt, b.tilt, k),
    moon: [lerp(a.moon[0], b.moon[0], k), lerp(a.moon[1], b.moon[1], k)],
    small: [lerp(a.small[0], b.small[0], k), lerp(a.small[1], b.small[1], k)],
    glow: lerp(a.glow, b.glow, k), dusk: lerp(a.dusk, b.dusk, k), pitch: lerp(a.pitch, b.pitch, k), fov: lerp(a.fov, b.fov, k),
  };
}

function rotateAbout(p: Vec3, deg: number, c: Vec3): Vec3 {
  const a = deg * RAD_PER_DEG;
  const x = p[0] - c[0];
  const z = p[2] - c[2];
  return [c[0] + x * Math.cos(a) + z * Math.sin(a), p[1], c[2] - x * Math.sin(a) + z * Math.cos(a)];
}

const dimmed = (o: SceneObject, k: number): SceneObject => ({
  ...o,
  material: { ...o.material, colors: { ...o.material.colors, ambient: mixRgb([0, 0, 0], o.material.colors.ambient, k), diffuse: mixRgb([0, 0, 0], o.material.colors.diffuse, k) } },
});

function archFrame(base: Scene, s: ArchState): Scene {
  const c = base.camera.position;
  const objects = base.objects.map((o) => {
    let pos = o.transform.position;
    let rot = o.transform.rotation;
    let obj = o;
    if ((ARCH_NAMES.rings as readonly string[]).includes(o.name)) {
      rot = [rot[0] + s.tilt, rot[1], rot[2]];
      obj = dimmed(o, s.glow);
    }
    if (o.name === ARCH_NAMES.moon) pos = offset(pos, s.moon[0], s.moon[1]);
    if (o.name === ARCH_NAMES.small) pos = offset(pos, s.small[0], s.small[1]);
    return moved(obj, rotateAbout(pos, s.turn, c), [rot[0], rot[1] + s.turn, rot[2]]);
  });
  const night = base.sky;
  const sky: Sky = {
    ...night,
    sunAzimuth: night.sunAzimuth + s.turn, sunAltitude: s.sun,
    skyColor: mixRgb(night.skyColor, ARCH_DUSK.sky, s.dusk),
    horizonColor: mixRgb(night.horizonColor, ARCH_DUSK.horizon, s.dusk),
    hazeColor: mixRgb(night.hazeColor, ARCH_DUSK.haze, s.dusk),
  };
  return { ...base, objects, sky, camera: { ...base.camera, pitch: s.pitch, fov: s.fov } };
}

function archScene(): Scene {
  const base = emptyScene();
  const preset = SKY_LIBRARY.find((s) => s.name === 'Moonlit Night')?.sky ?? base.sky;
  return { ...base, sky: { ...preset, ...ARCH_SKY }, camera: { ...base.camera, ...ARCH_CAMERA }, document: SPLASH_DOCUMENT, objects: ARCH_PIECES.map(place) };
}

// ---------- public ----------

/** The scene at rest, before any motion; build it once (terrains are costly), then ask for frames. */
export function splashBase(kind: SplashKind): Scene {
  return kind === SplashKind.Dunes ? dunesScene() : archScene();
}

/**
 * The picture at time `t` of a clip: 0..1 over the clip (a loop's seam asks for t
 * just below 0). The intro's last frame equals the loop's first, and that is the still.
 */
export function splashFrame(base: Scene, kind: SplashKind, clip: SplashClip, t: number): Scene {
  if (kind === SplashKind.Dunes) {
    return dunesFrame(base, clip === SplashClip.Loop ? dunesLoop(t) : mixDunes(DUNES_DAWN, dunesLoop(0), ease(Math.min(1, t))));
  }
  return archFrame(base, clip === SplashClip.Loop ? archLoop(t) : mixArch(ARCH_EVENING, archLoop(0), ease(Math.min(1, t))));
}

/** Seconds at the end of a loop that fade into the time just before its start; the arch's turn is not periodic. */
const SEAM_SECONDS: Readonly<Record<SplashKind, number>> = { [SplashKind.Dunes]: 0, [SplashKind.Arch]: 1.5 };

/** One frame of a clip: the picture at `t`, optionally mixed with the picture at `blend.t` by `blend.weight`. */
export interface PlannedFrame {
  readonly t: number;
  readonly blend?: { readonly t: number; readonly weight: number };
}

/**
 * Every frame of a clip, in order. An intro runs t = 0..1 and ends exactly on the
 * still. A loop starts exactly on the still (t = 0) and closes on itself; where its
 * motion is not periodic, its last frames fade toward the time just before t = 0,
 * so the last frame leads into the first.
 */
export function splashFramePlan(kind: SplashKind, clip: SplashClip): PlannedFrame[] {
  const n = SPLASH_SECONDS[clip] * SPLASH_FPS;
  if (clip === SplashClip.Intro) return Array.from({ length: n }, (_, i) => ({ t: i / (n - 1) }));
  const seam = Math.round(SEAM_SECONDS[kind] * SPLASH_FPS);
  return Array.from({ length: n }, (_, i) => {
    const into = i - (n - seam);
    return into < 0 ? { t: i / n } : { t: i / n, blend: { t: (i - n) / n, weight: (into + 1) / seam } };
  });
}

/** The still picture: where the welcome ends and the loop begins. */
export const splashScene = (kind: SplashKind): Scene => splashFrame(splashBase(kind), kind, SplashClip.Loop, 0);
