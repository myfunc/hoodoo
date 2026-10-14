import { hexToRgb as h } from '../../core/color';
import { type Vec3, add, scale, sub } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { BooleanMode, Ease, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, ObjectKey, Scene, SceneObject, Sky, TerrainData, Transform } from '../../model/scene.types';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { type Field, field, sample } from '../terrain/heightfield';
import { Noise2D } from '../terrain/noise2d';
import { SHOWCASE_SECONDS, TAU, aimed, loopKeys, orient, phaseKeys, place, showcase, skyPreset } from './kit';

/**
 * "Meadow Day": a whole day in eight seconds over rolling flower meadows. A
 * river winds toward the camera, poplars stand along its banks, and a white
 * windmill turns on a low hill. The sun rises on the right, crosses the sky and
 * sets on the left; the shadows of the mill and the trees sweep round, the mill's
 * window lights up at dusk, the moon and the stars come out, and the morning
 * mist is back on the river at dawn. The camera glides low over the flowers.
 */

const OBJ = TextureMapping.Object;
const FRAMES = SHOWCASE_SECONDS * EMPTY_ANIMATION.fps;

// ---------- The land ----------

/** The meadow's grid: u across (0 left), v from the far edge (0) to the near one (1). */
const LAND = { centre: [0, 2.5, -30] as Vec3, half: [72, 8, 72] as Vec3, res: 192, seed: 1703 };
const ROLL = {
  base: 0.5, swell: 0.2, swellFreq: 2.4, swellOctaves: 4, detail: 0.03, detailFreq: 14, detailOctaves: 3,
  /** The far side climbs into hills: from this v toward the far edge, by this much. */
  backFrom: 0.42, back: 0.3,
};
/** The river's middle line u(v) = at + Σ a·sin(f·v + p), its half-width near and far, and the bed. */
const RIVER = { at: 0.545, slope: 0.16, waves: [[0.05, 8, 1], [0.012, 21, 0.3]] as const, near: 0.03, far: 0.012, banks: 4.5, bed: 0.34, level: 0.38 };
const MILL = { at: [-12, -14] as const, hill: 0.12, hillRadius: 0.07, pad: 0.03, padEdge: 2 };

const MEADOW = material({
  name: 'Flower Meadow',
  textures: [texture(TextureKind.Flowers, 1.4, [h('#2c5c14'), h('#8cbc34'), h('#d85aa8')], { detail: 5 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 92, ambience: 30, specularity: 5 },
});
const RIVER_WATER = material({
  name: 'River Water',
  colors: { diffuse: h('#1f6a9a'), ambient: h('#123e5c') },
  textures: [texture(TextureKind.Ripples, 1.1, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 3 })],
  values: { diffusion: 45, ambience: 25, specularity: 90, reflection: 55, bump: 16 },
  valueSources: { bump: 1 },
});
const FAR_HILLS = material({
  name: 'Far Hills',
  textures: [texture(TextureKind.Altitude, 1, [h('#2a4a2a'), h('#4a6a40'), h('#6a8a68')], { detail: 4 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 85, ambience: 30, specularity: 3 },
});
const RIDGE = { at: [0, -2, -150] as Vec3, half: [190, 18, 34] as Vec3, res: 128, freq: 3, octaves: 5, edge: 0.18, seed: 61 };

// ---------- The windmill ----------

/** A whitewashed tower narrowing toward its conical roof; the rotor faces `facing` degrees round from +X. */
const TOWER = { foot: 2.8, top: 1.95, height: 10.5, sink: 0.6 };
const ROOF = { radius: 2.4, height: 2.6, lift: -0.15 };
const ROTOR = { facing: -52, out: 2.35, rise: 0.6, hub: 0.42, hubLength: 0.6, spar: 0.1, length: 7.2, sailFrom: 1.3, sailWidth: 1.5, cloth: 0.05 };
/** Whole quarter turns per loop: four sails look the same every quarter turn. */
const SPIN_DEGREES = 450;
const SPIN_KEY_STEP = 10;
/** Door and windows: which way each faces (degrees round from +Z) and how high it sits. */
const DOOR = { width: 0.6, height: 1.1, depth: 0.14, yaw: 8 };
const WINDOW = { width: 0.36, height: 0.5, depth: 0.1 };
const WINDOWS: readonly { yaw: number; at: number }[] = [{ yaw: -34, at: 3.4 }, { yaw: -12, at: 6.8 }];
const WHITEWASH = material({
  name: 'Whitewash',
  textures: [texture(TextureKind.Granite, 1.6, [h('#c8bfae'), h('#e8e2d6'), h('#faf6ee')], { detail: 4, mapping: TextureMapping.Follows })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 90, ambience: 22, specularity: 8, bump: 8 },
  valueSources: { bump: 1 },
});
const THATCH = material({
  name: 'Thatch',
  textures: [texture(TextureKind.Wood, 6, [h('#3a2412'), h('#6a4422'), h('#9a6c3a')], { detail: 4, mapping: OBJ })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 88, ambience: 18, specularity: 6, bump: 20 },
  valueSources: { bump: 1 },
});
const SAIL_WOOD = material({ name: 'Sail Wood', colors: { diffuse: h('#4a2c18'), ambient: h('#2a1a0e') }, values: { diffusion: 80, ambience: 15, specularity: 20 } });
const SAIL_CLOTH = material({
  name: 'Sail Cloth',
  textures: [texture(TextureKind.Facade, 2, [h('#3a2a1c'), h('#5a4630'), h('#efe4c8')], { detail: 1, mapping: TextureMapping.Follows })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 90, ambience: 24, specularity: 4 },
});
const DOOR_WOOD = material({ name: 'Door Wood', colors: { diffuse: h('#3a5a6a'), ambient: h('#1a2a32') }, values: { diffusion: 80, ambience: 12, specularity: 25 } });
const WINDOW_GLASS = material({ name: 'Mill Window', colors: { diffuse: h('#1a1c22'), ambient: h('#ffb050'), specular: h('#ffffff') }, values: { diffusion: 40, ambience: 0, specularity: 90, reflection: 30 } });

// ---------- Trees ----------

const BARK = material({ name: 'Bark', colors: { diffuse: h('#4a3a2a'), ambient: h('#2a2018') }, values: { diffusion: 85, ambience: 15, specularity: 4 } });
const LEAVES = material({
  name: 'Leaves',
  textures: [texture(TextureKind.Granite, 2.2, [h('#1c3a10'), h('#365c1a'), h('#5e8a2a')], { detail: 5 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 88, ambience: 20, specularity: 6, bump: 35 },
  valueSources: { bump: 1 },
});
/** Poplars along the river: where along it (v), which bank, and how tall. */
const POPLARS: readonly { v: number; side: number; tall: number }[] = [
  { v: 0.3, side: -1, tall: 1 }, { v: 0.36, side: -1, tall: 0.9 }, { v: 0.42, side: -1, tall: 1.1 },
  { v: 0.47, side: 1, tall: 0.95 }, { v: 0.53, side: 1, tall: 1.05 }, { v: 0.58, side: 1, tall: 0.9 },
];
const POPLAR = { trunk: 0.22, trunkHalf: 0.9, crown: [1.1, 3.8, 1.1] as Vec3, offBank: 0.025 };
/** Round trees: where (x, z) and their size. */
const OAKS: readonly { at: [number, number]; size: number }[] = [
  { at: [-30, -30], size: 1.2 }, { at: [-36, -24], size: 0.9 }, { at: [16, -48], size: 1 }, { at: [-22, 2], size: 0.8 },
];
const OAK = { trunk: 0.35, trunkHalf: 1.2, crowns: [[0, 3.6, 0, 2.6], [1.5, 3.1, 0.6, 1.9], [-1.4, 3.2, -0.5, 2]] as const };

/** A split-rail fence from the near meadow up toward the mill: its posts and two rails. */
const FENCE = { from: [-17, 21] as const, to: [-9, -3] as const, posts: 9, post: [0.12, 0.62, 0.12] as Vec3, rails: [0.35, 0.85] as const, rail: [0.06, 0.08] as const };
const WEATHERED = material({
  name: 'Weathered Wood',
  textures: [texture(TextureKind.Wood, 4, [h('#4a3e30'), h('#7a6a56'), h('#a8987e')], { detail: 4, mapping: OBJ })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 85, ambience: 18, specularity: 8 },
});

// ---------- Sky through the day ----------

interface Hour {
  readonly u: number;
  readonly alt: number;
  readonly az: number;
  readonly sky: string;
  readonly horizon: string;
  readonly sun: string;
  readonly ambient: string;
  readonly haze: string;
  readonly hazeAmount: number;
  readonly fog: number;
  readonly fogColor: string;
  readonly clouds: string;
  readonly cover: number;
  readonly cloudHeight: number;
  /** The mill's window glow, 0..100. */
  readonly glow: number;
}

/**
 * The day as eight stations, a key each: morning, noon, golden hour, sunset,
 * night, dawn. The sun is all but dark where it crosses the horizon, so the
 * moon taking over its light (below the horizon) does not jump.
 */
const DAY: readonly Hour[] = [
  { u: 0, alt: 14, az: 62, sky: '#4a86d0', horizon: '#f6dcb8', sun: '#ffe0b0', ambient: '#8a8a98', haze: '#f2dcc4', hazeAmount: 26, fog: 10, fogColor: '#f4e6d4', clouds: '#fff2e4', cover: 34, cloudHeight: 30, glow: 0 },
  { u: 0.125, alt: 34, az: 96, sky: '#2f6fc8', horizon: '#cfe2f6', sun: '#fff4e0', ambient: '#8a96a8', haze: '#dce8f4', hazeAmount: 18, fog: 4, fogColor: '#e8eef4', clouds: '#ffffff', cover: 46, cloudHeight: 42, glow: 0 },
  { u: 0.25, alt: 48, az: 122, sky: '#2462c4', horizon: '#c4dcf2', sun: '#fffaf0', ambient: '#8e9cb0', haze: '#d8e6f4', hazeAmount: 14, fog: 0, fogColor: '#e8eef4', clouds: '#ffffff', cover: 56, cloudHeight: 55, glow: 0 },
  { u: 0.375, alt: 30, az: 146, sky: '#2f6cc0', horizon: '#d8e4ee', sun: '#fff0d8', ambient: '#8c94a4', haze: '#e0e6ec', hazeAmount: 18, fog: 0, fogColor: '#e8eef4', clouds: '#fff8f0', cover: 50, cloudHeight: 66, glow: 0 },
  { u: 0.5, alt: 8, az: 162, sky: '#4a6cb0', horizon: '#ffc890', sun: '#ffb060', ambient: '#8a6e62', haze: '#ffc8a0', hazeAmount: 34, fog: 0, fogColor: '#ffd0b0', clouds: '#ffd0a8', cover: 42, cloudHeight: 58, glow: 0 },
  { u: 0.5625, alt: 0, az: 170, sky: '#34448a', horizon: '#ff8a5a', sun: '#2a1206', ambient: '#5a4058', haze: '#ff9a70', hazeAmount: 40, fog: 4, fogColor: '#c88a88', clouds: '#ff9a80', cover: 28, cloudHeight: 50, glow: 60 },
  { u: 0.6875, alt: -20, az: 250, sky: '#050a26', horizon: '#1a2852', sun: '#b8c8f0', ambient: '#1c2644', haze: '#1a2852', hazeAmount: 16, fog: 10, fogColor: '#2a3860', clouds: '#4a5a80', cover: 20, cloudHeight: 40, glow: 100 },
  { u: 0.8125, alt: -22, az: 330, sky: '#060c2a', horizon: '#1e2c58', sun: '#b8c8f0', ambient: '#1c2644', haze: '#1e2c58', hazeAmount: 16, fog: 10, fogColor: '#2a3860', clouds: '#4a5a80', cover: 18, cloudHeight: 32, glow: 100 },
  { u: 0.9375, alt: 0, az: 30, sky: '#2a3a7a', horizon: '#ff9c78', sun: '#2a1206', ambient: '#5a4a62', haze: '#f0a088', hazeAmount: 34, fog: 14, fogColor: '#c8a8b0', clouds: '#ffb0a0', cover: 24, cloudHeight: 26, glow: 40 },
];

const SKY_BASE = { mode: SkyMode.SoftSky, stars: true, fogHeight: 0.9 };
const CLOUDS = { cumulus: true, stratus: false, frequency: 30, amplitude: 80 };

// ---------- Camera ----------

/** The camera rounds a flat ellipse low over the near meadow, looking at the mill. */
const CAMERA = { centre: [5, 23] as const, across: 6, along: 3, clearance: 2.2, bob: 0.35, aim: [-5, 8, -14] as Vec3, lens: { fov: 44 }, keys: 16 };

// ---------- Building ----------

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const riverAt = (v: number): number => RIVER.at + RIVER.slope * (v - 0.5) + RIVER.waves.reduce((s, [a, f, p]) => s + a * Math.sin(f * v + p), 0);
const uOf = (x: number): number => ((x - LAND.centre[0]) / LAND.half[0] + 1) / 2;
const vOf = (z: number): number => ((z - LAND.centre[2]) / LAND.half[2] + 1) / 2;

function relief(): Field {
  const R = ROLL;
  const n = LAND.res;
  const noise = new Noise2D(LAND.seed);
  const out = field(n);
  const [mu, mv] = [uOf(MILL.at[0]), vOf(MILL.at[1])];
  for (let z = 0; z < n; z++) {
    const v = z / (n - 1);
    const width = RIVER.far + (RIVER.near - RIVER.far) * v;
    for (let x = 0; x < n; x++) {
      const u = x / (n - 1);
      let y = R.base + R.swell * (2 * noise.fbm(u * R.swellFreq, v * R.swellFreq, R.swellOctaves) - 1) + R.detail * (2 * noise.fbm(u * R.detailFreq, v * R.detailFreq, R.detailOctaves) - 1);
      y += R.back * Math.max(0, (R.backFrom - v) / R.backFrom) ** 2;
      y += MILL.hill * Math.exp(-((u - mu) ** 2 + (v - mv) ** 2) / (MILL.hillRadius * MILL.hillRadius));
      y = RIVER.bed + (y - RIVER.bed) * smoothstep(width, width * RIVER.banks, Math.abs(u - riverAt(v)));
      out.h[z * n + x] = y;
    }
  }
  // A level pad for the mill.
  const top = sample(out, mu, mv);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x / (n - 1) - mu, z / (n - 1) - mv);
      const i = z * n + x;
      out.h[i] = top + (out.h[i] - top) * smoothstep(MILL.pad, MILL.pad * MILL.padEdge, d);
    }
  }
  for (let i = 0; i < out.h.length; i++) out.h[i] = Math.min(1, Math.max(0, out.h[i]));
  return out;
}

let cached: Field | null = null;
const landField = (): Field => (cached ??= relief());

/** The meadow's height at world (x, z). */
const groundY = (x: number, z: number): number => LAND.centre[1] + LAND.half[1] * (2 * sample(landField(), uOf(x), vOf(z)) - 1);
/** The world point on the meadow at grid (u, v). */
const groundAt = (u: number, v: number): Vec3 => {
  const x = LAND.centre[0] + (2 * u - 1) * LAND.half[0];
  const z = LAND.centre[2] + (2 * v - 1) * LAND.half[2];
  return [x, groundY(x, z), z];
};

function ridge(): TerrainData {
  const R = RIDGE;
  const n = R.res;
  const noise = new Noise2D(R.seed);
  const heights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const [u, v] = [x / (n - 1), z / (n - 1)];
      const mound = smoothstep(0, R.edge, Math.min(u, 1 - u)) * smoothstep(0, R.edge * 2, Math.min(v, 1 - v));
      heights[z * n + x] = mound * (0.5 + 0.5 * noise.fbm(u * R.freq, v * R.freq, R.octaves));
    }
  }
  return { resolution: n, heights };
}

function land(): SceneObject[] {
  const f = landField();
  const level = LAND.centre[1] + LAND.half[1] * (2 * RIVER.level - 1);
  return [
    { ...place({ entry: 'terrain', name: 'Flower Meadow', material: 'Default', position: LAND.centre, size: LAND.half }), material: MEADOW, terrain: { resolution: f.res, heights: new Float32Array(f.h) } },
    { ...place({ entry: 'water', name: 'River', material: 'Default', position: [0, level, 0] }), material: RIVER_WATER },
    { ...place({ entry: 'terrain', name: 'Far Hills', material: 'Default', position: RIDGE.at, size: RIDGE.half }), material: FAR_HILLS, terrain: ridge() },
  ];
}

const own = (o: SceneObject, m: typeof MEADOW): SceneObject => ({ ...o, material: m });
const HALF_TURN = 180;
const DEG = Math.PI / HALF_TURN;

/** The tower (a cone cut level), its roof, door and windows; returns the windows too, for their keys. */
function tower(): { objects: SceneObject[]; group: GroupNode; windows: SceneObject[] } {
  const T = TOWER;
  const [x, z] = MILL.at;
  const foot = groundY(x, z) - T.sink;
  const coneHalf = (T.height * T.foot) / (T.foot - T.top) / 2;
  const id: GroupId = newGroupId();
  const cone = own(place({ entry: 'cone', name: 'Mill Tower', material: 'Default', position: [x, foot + coneHalf, z], size: [T.foot, coneHalf, T.foot] }), WHITEWASH);
  const cut = place({ entry: 'cube', name: 'Tower Cut', material: 'Default', position: [x, foot + T.height + coneHalf, z], size: [T.foot * 2, coneHalf, T.foot * 2] });
  const top = foot + T.height;
  const R = ROOF;
  const roof = own(place({ entry: 'cone', name: 'Mill Roof', material: 'Default', position: [x, top + R.lift + R.height / 2, z], size: [R.radius, R.height / 2, R.radius] }), THATCH);
  const ground = groundY(x, z);
  const radiusAt = (y: number) => T.foot + (T.top - T.foot) * ((y - foot) / T.height);
  /** A flat piece on the wall at height y above the ground, turned to face `yaw`. */
  const onWall = (name: string, yaw: number, y: number, half: Vec3, m: typeof MEADOW): SceneObject => {
    const r = radiusAt(ground + y);
    const at: Vec3 = [x + Math.sin(yaw * DEG) * r, ground + y, z + Math.cos(yaw * DEG) * r];
    return own(place({ entry: 'cube', name, material: 'Default', position: at, size: half, rotation: [0, yaw, 0] }), m);
  };
  const door = onWall('Mill Door', DOOR.yaw, DOOR.height, [DOOR.width, DOOR.height, DOOR.depth], DOOR_WOOD);
  const windows = WINDOWS.map((w, i) => onWall(`Mill Window ${i + 1}`, w.yaw, w.at, [WINDOW.width, WINDOW.height, WINDOW.depth], WINDOW_GLASS));
  const group: GroupNode = { id, name: 'Mill Tower', parentId: null, collapsed: true };
  return { objects: [{ ...cone, groupId: id, boolean: BooleanMode.Positive }, { ...cut, groupId: id, boolean: BooleanMode.Negative }, roof, door, ...windows], group, windows };
}

/** Where the rotor's hub turns, and the Euler turn of the rotor at spin `deg` (its axis is its own X). */
function hub(): Vec3 {
  const [x, z] = MILL.at;
  const f = ROTOR.facing * DEG;
  return [x + Math.cos(f) * ROTOR.out, groundY(x, z) - TOWER.sink + TOWER.height + ROTOR.rise, z - Math.sin(f) * ROTOR.out];
}
const rotorTurn = (deg: number): Vec3 => [deg, ROTOR.facing, 0];

/** One rotor: hub and four sails round the group's origin (the hub), in its own Y-Z plane. */
function rotor(name: string): { objects: SceneObject[]; group: GroupNode } {
  const R = ROTOR;
  const id: GroupId = newGroupId();
  const parts: SceneObject[] = [own(place({ entry: 'cylinder', name: `${name} Hub`, material: 'Default', position: [0, 0, 0], size: [R.hub, R.hubLength, R.hub], rotation: [0, 0, HALF_TURN / 2] }), SAIL_WOOD)];
  for (let k = 0; k < 4; k++) {
    const phi = (k * HALF_TURN) / 2;
    const [c, s] = [Math.cos(phi * DEG), Math.sin(phi * DEG)];
    const along = (d: number, side: number): Vec3 => [0, c * d - s * side, s * d + c * side];
    parts.push(own(place({ entry: 'cube', name: `${name} Stock ${k + 1}`, material: 'Default', position: along(R.length / 2, 0), size: [R.spar, R.length / 2, R.spar], rotation: [phi, 0, 0] }), SAIL_WOOD));
    const mid = (R.sailFrom + R.length) / 2;
    parts.push(own(place({ entry: 'cube', name: `${name} Sail ${k + 1}`, material: 'Default', position: along(mid, R.sailWidth / 2 + R.spar), size: [R.cloth, (R.length - R.sailFrom) / 2, R.sailWidth / 2], rotation: [phi, 0, 0] }), SAIL_CLOTH));
  }
  return { objects: parts.map((o) => ({ ...o, groupId: id })), group: { id, name, parentId: null, collapsed: true } };
}

const LAST = (FRAMES - 1) / FRAMES;

/**
 * The sails turn on and on, but every track must end where it began. Two rotors
 * take turns: the first turns all loop and hides for its last frame while it
 * winds back; the second shows only in that frame, a quarter turn on, the same
 * picture. Linear keys keep the turn steady.
 */
function sails(): { objects: SceneObject[]; groups: GroupNode[]; groupKeys: Record<string, Key<Transform>[]>; objectKeys: Record<string, Key<ObjectKey>[]> } {
  const centre = hub();
  const a = rotor('Sails');
  const b = rotor('Sails Relay');
  const pose = (deg: number): Transform => ({ position: centre, rotation: rotorTurn(deg), size: [1, 1, 1] });
  const steps = Array.from({ length: FRAMES / SPIN_KEY_STEP }, (_, i) => i * SPIN_KEY_STEP);
  const at = (f: number) => f / EMPTY_ANIMATION.fps;
  const lin = <T>(time: number, value: T): Key<T> => ({ time, value, ease: Ease.Linear });
  const aKeys = [...steps.map((f) => lin(at(f), pose((SPIN_DEGREES * f) / FRAMES))), lin(at(FRAMES - 1), pose(SPIN_DEGREES * LAST)), lin(SHOWCASE_SECONDS, pose(0))];
  const bKeys = [lin(0, pose(SPIN_DEGREES)), lin(at(FRAMES - 1), pose(SPIN_DEGREES * LAST)), lin(SHOWCASE_SECONDS, pose(SPIN_DEGREES))];
  const shown = (o: SceneObject, from: boolean): Key<ObjectKey>[] => [
    { time: 0, value: { ...o.transform, hidden: !from } },
    { time: at(FRAMES - 1), value: { ...o.transform, hidden: from } },
    { time: SHOWCASE_SECONDS, value: { ...o.transform, hidden: !from } },
  ];
  const objectKeys = Object.fromEntries([...a.objects.map((o) => [o.id, shown(o, true)]), ...b.objects.map((o) => [o.id, shown(o, false)])]);
  return {
    objects: [...a.objects, ...b.objects.map((o) => ({ ...o, hidden: true }))],
    groups: [{ ...a.group, transform: aKeys[0].value }, { ...b.group, transform: bKeys[0].value }],
    groupKeys: { [a.group.id]: aKeys, [b.group.id]: bKeys },
    objectKeys,
  };
}

function fence(): SceneObject[] {
  const F = FENCE;
  const posts: Vec3[] = Array.from({ length: F.posts }, (_, i) => {
    const t = i / (F.posts - 1);
    const x = F.from[0] + (F.to[0] - F.from[0]) * t;
    const z = F.from[1] + (F.to[1] - F.from[1]) * t;
    return [x, groundY(x, z), z];
  });
  const out = posts.map((p, i) => own(place({ entry: 'cube', name: `Fence Post ${i + 1}`, material: 'Default', position: [p[0], p[1] + F.post[1] * (1 - F.rails[0] / 2), p[2]], size: F.post }), WEATHERED));
  posts.slice(1).forEach((b, i) => {
    const a = posts[i];
    const d = sub(b, a);
    const half = Math.hypot(d[0], d[1], d[2]) / 2;
    const turn = orient(d, [0, 1, 0]);
    F.rails.forEach((r, k) => {
      const mid = add(add(a, scale(d, 0.5)), [0, r * F.post[1] * 2, 0]);
      out.push(own(place({ entry: 'cube', name: `Fence Rail ${i + 1}${k ? 'b' : 'a'}`, material: 'Default', position: mid, size: [F.rail[1], half, F.rail[0]], rotation: turn }), WEATHERED));
    });
  });
  return out;
}

function poplar(i: number): SceneObject[] {
  const p = POPLARS[i];
  const width = RIVER.far + (RIVER.near - RIVER.far) * p.v;
  const [x, y, z] = groundAt(riverAt(p.v) + p.side * (width * RIVER.banks + POPLAR.offBank), p.v);
  const P = POPLAR;
  const crown: Vec3 = [P.crown[0] * p.tall, P.crown[1] * p.tall, P.crown[2] * p.tall];
  return [
    own(place({ entry: 'cylinder', name: `Poplar Trunk ${i + 1}`, material: 'Default', position: [x, y + P.trunkHalf, z], size: [P.trunk, P.trunkHalf, P.trunk] }), BARK),
    own(place({ entry: 'sphere', name: `Poplar ${i + 1}`, material: 'Default', position: [x, y + P.trunkHalf + crown[1], z], size: crown, seed: i + 1 }), LEAVES),
  ];
}

function oak(i: number): SceneObject[] {
  const t = OAKS[i];
  const [x, z] = t.at;
  const y = groundY(x, z);
  const s = t.size;
  return [
    own(place({ entry: 'cylinder', name: `Oak Trunk ${i + 1}`, material: 'Default', position: [x, y + OAK.trunkHalf * s, z], size: [OAK.trunk * s, OAK.trunkHalf * s, OAK.trunk * s] }), BARK),
    ...OAK.crowns.map(([cx, cy, cz, r], k) => own(place({ entry: 'sphere', name: `Oak ${i + 1} Crown ${k + 1}`, material: 'Default', position: [x + cx * s, y + cy * s, z + cz * s], size: [r * s, r * s, r * s] }), LEAVES)),
  ];
}

const skyOf = (base: Sky, d: Hour): Sky => ({
  ...base,
  ...SKY_BASE,
  sunAltitude: d.alt,
  sunAzimuth: d.az,
  skyColor: h(d.sky),
  horizonColor: h(d.horizon),
  sunColor: h(d.sun),
  ambientColor: h(d.ambient),
  hazeColor: h(d.haze),
  hazeAmount: d.hazeAmount,
  fogAmount: d.fog,
  fogColor: h(d.fogColor),
  clouds: { ...base.clouds, ...CLOUDS, color: h(d.clouds), cover: d.cover, height: d.cloudHeight },
});

const hourAt = (u: number): Hour => DAY.reduce((best, d) => (Math.abs(d.u - u) < Math.abs(best.u - u) ? d : best));

/** The day's keys; the seam's two keys are linear so the sun does not pause at dawn. */
function dayKeys(base: Sky): Key<Sky>[] {
  const keys = phaseKeys(DAY.map((d) => d.u), (u) => skyOf(base, hourAt(u)));
  return keys.map((k, i) => (i === 0 || i === keys.length - 1 ? { ...k, ease: Ease.Linear } : k));
}

function windowKeys(w: SceneObject): Key<ObjectKey>[] {
  return phaseKeys(DAY.map((d) => d.u), (u) => ({ ...w.transform, material: { values: { ambience: hourAt(u).glow } } }));
}

function cameraAt(u: number) {
  const C = CAMERA;
  const a = TAU * u;
  const x = C.centre[0] + C.across * Math.sin(a);
  const z = C.centre[1] + C.along * Math.cos(a);
  return aimed([x, groundY(x, z) + C.clearance + C.bob * Math.sin(2 * a), z], C.aim, C.lens);
}

export function meadowDay(): Scene {
  const mill = tower();
  const rotors = sails();
  const objects: SceneObject[] = [
    ...land(),
    ...mill.objects,
    ...rotors.objects,
    ...fence(),
    ...POPLARS.flatMap((_, i) => poplar(i)),
    ...OAKS.flatMap((_, i) => oak(i)),
  ];
  const sky = dayKeys(skyPreset('Soft Sky'));
  const camera = loopKeys(CAMERA.keys, cameraAt);
  return showcase(
    { objects, groups: [mill.group, ...rotors.groups], sky: sky[0].value, camera: camera[0].value },
    { objects: { ...rotors.objectKeys, ...Object.fromEntries(mill.windows.map((w) => [w.id, windowKeys(w)])) }, groups: rotors.groupKeys, camera, sky },
  );
}
